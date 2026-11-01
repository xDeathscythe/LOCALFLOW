use serde_json::{json, Value};

#[cfg(windows)]
#[path = "meeting_audio.rs"]
mod audio;
#[cfg(windows)]
#[path = "meeting_probe.rs"]
mod probe;
#[path = "meeting_wav.rs"]
mod wav;

#[cfg(windows)]
mod controller {
    use super::*;
    use std::{
        path::PathBuf,
        sync::{mpsc, Arc, Mutex, OnceLock},
        thread::{self, JoinHandle},
        time::{Duration, Instant},
    };
    use tauri::Manager;
    use windows::Win32::{
        Foundation::WAIT_OBJECT_0,
        Media::Audio::{eCapture, eRender},
        System::Threading::*,
    };

    type Reply = mpsc::Sender<Result<Value, String>>;
    struct Command(Value, Reply);
    #[derive(Default)]
    struct Controller {
        sender: Option<mpsc::Sender<Command>>,
        thread: Option<JoinHandle<()>>,
        status: Arc<Mutex<Value>>,
    }
    static RECORDER: OnceLock<Mutex<Controller>> = OnceLock::new();
    fn recorder() -> &'static Mutex<Controller> {
        RECORDER.get_or_init(|| Mutex::new(Controller::default()))
    }

    fn notify(app: &tauri::AppHandle, event: Value) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let bridge = app.state::<crate::Desktop>().bridge.clone();
            if let Err(error) = bridge
                .call(&app, "meeting-native-event", json!([event]))
                .await
            {
                eprintln!("Meeting host event: {error}");
            }
        });
    }

    fn directory(value: &Value) -> Result<PathBuf, String> {
        let id = value["sessionId"]
            .as_str()
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            })
            .ok_or("Invalid meeting session ID.")?;
        let expected = crate::paths::profile()?
            .join("meetings")
            .join(id)
            .join("audio");
        std::fs::create_dir_all(&expected).map_err(|e| e.to_string())?;
        let canonical = dunce::canonicalize(&expected).map_err(|e| e.to_string())?;
        let base = dunce::canonicalize(crate::paths::profile()?).map_err(|e| e.to_string())?;
        if !canonical.starts_with(base.join("meetings")) {
            return Err("Meeting audio path leaves the LocalFlow profile.".into());
        }
        if let Some(requested) = value["directory"].as_str() {
            let requested = dunce::canonicalize(requested)
                .map_err(|e| format!("Meeting directory is unavailable: {e}"))?;
            if requested != canonical {
                return Err("Meeting audio directory does not match its session.".into());
            }
        }
        if std::fs::read_dir(&canonical)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
        {
            return Err(
                "This meeting already has audio. Recover it before starting a new session.".into(),
            );
        }
        Ok(canonical)
    }

    pub fn dispatch(app: tauri::AppHandle, mut value: Value) -> Result<Value, String> {
        let action = value["action"]
            .as_str()
            .ok_or("Missing meeting action.")?
            .to_owned();
        if matches!(action.as_str(), "probe" | "sources") {
            return probe::probe();
        }
        let mut manager = recorder().lock().map_err(|e| e.to_string())?;
        if action == "status" {
            let state = manager.status.lock().map_err(|e| e.to_string())?.clone();
            return Ok(if state.is_null() {
                json!({"state":"idle"})
            } else {
                state
            });
        }
        if action == "start" {
            if manager
                .thread
                .as_ref()
                .is_some_and(|thread| !thread.is_finished())
            {
                let state = manager.status.lock().map_err(|e| e.to_string())?.clone();
                if state["sessionId"] == value["sessionId"] {
                    return Ok(state);
                }
                return Err("Another meeting is already being recorded.".into());
            }
            if let Some(thread) = manager.thread.take() {
                let _ = thread.join();
            }
            let mode = value["loopbackMode"]
                .as_str()
                .unwrap_or("process")
                .to_owned();
            if !matches!(mode.as_str(), "process" | "system") {
                return Err("Unknown meeting audio source mode.".into());
            }
            if mode == "process" {
                let pid = value["processId"]
                    .as_u64()
                    .filter(|pid| *pid > 0 && *pid <= u32::MAX as u64)
                    .ok_or("Choose the application whose audio should be recorded.")?
                    as u32;
                if pid == std::process::id() || probe::process_path(pid).is_none() {
                    return Err("The selected application is no longer available.".into());
                }
            }
            let seconds = value["chunkSeconds"].as_u64().unwrap_or(15);
            if !(5..=30).contains(&seconds) {
                return Err("Meeting chunks must be between 5 and 30 seconds.".into());
            }
            value["chunkSeconds"] = json!(seconds);
            value["loopbackMode"] = json!(mode);
            let path = directory(&value)?;
            value["directory"] = json!(path);
            let state = manager.status.clone();
            *state.lock().map_err(|e| e.to_string())? =
                json!({"state":"starting","sessionId":value["sessionId"]});
            let (sender, receiver) = mpsc::channel();
            let (ready, result) = mpsc::channel();
            manager.sender = Some(sender.clone());
            manager.thread = Some(thread::spawn(move || {
                run(app, value, path, receiver, ready, state)
            }));
            return match result.recv_timeout(Duration::from_secs(20)) {
                Ok(result) => result,
                Err(_) => {
                    let (reply, _) = mpsc::channel();
                    let _ = sender.send(Command(json!({"action":"stop"}), reply));
                    Err("Meeting audio initialization timed out; recording was cancelled.".into())
                }
            };
        }
        if !matches!(action.as_str(), "pause" | "resume" | "stop" | "mute") {
            return Err("Unknown meeting action.".into());
        }
        let current = manager.status.lock().map_err(|e| e.to_string())?.clone();
        if let Some(id) = value["sessionId"].as_str() {
            if current["sessionId"] != id {
                return Err("The active recording belongs to another meeting.".into());
            }
        }
        if manager
            .thread
            .as_ref()
            .is_none_or(|thread| thread.is_finished())
        {
            return if action == "stop" {
                Ok(current)
            } else {
                Err("No meeting recording is active.".into())
            };
        }
        let (reply, result) = mpsc::channel();
        manager
            .sender
            .as_ref()
            .ok_or("Meeting recorder is unavailable.")?
            .send(Command(value, reply))
            .map_err(|e| e.to_string())?;
        // The native thread flushes WAVs and the manifest before acknowledging stop/pause.
        result
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| "Meeting recorder did not acknowledge the command.".to_owned())?
    }

    fn publish(
        app: &tauri::AppHandle,
        session_id: &str,
        mut events: Vec<Value>,
        chunks: &mut Vec<Value>,
    ) {
        for mut event in events.drain(..) {
            event["sessionId"] = json!(session_id);
            if event["type"] == "chunk" {
                chunks.push(event.clone());
            }
            notify(app, event);
        }
    }

    struct Runtime {
        config: Value,
        directory: PathBuf,
        streams: [Option<audio::Stream>; 2],
        indices: [u64; 2],
        errors: [Option<String>; 2],
        chunks: Vec<Value>,
        paused: bool,
        muted: bool,
        origin: u64,
        start: Instant,
        fatal: bool,
    }
    impl Runtime {
        fn snapshot(&self, state: &str) -> Value {
            json!({"sessionId":self.config["sessionId"],"state":state,"elapsedMs":self.start.elapsed().as_millis() as u64,
                "muted":self.muted,"microphoneDeviceId":self.streams[0].as_ref().and_then(|s|s.device_id.clone()),
                "processId":self.config["processId"],"loopbackMode":self.config["loopbackMode"],"directory":self.directory,
                "errors":self.errors.iter().flatten().collect::<Vec<_>>(),
                "sources":([0,1].map(|index| json!({"source":if index==0 {"microphone"} else {"remote"},"available":self.streams[index].is_some(),
                    "peak":self.streams[index].as_ref().map(|s|s.peak).unwrap_or(0.0),"error":self.errors[index],
                    "echoCancellation":self.streams[index].as_ref().map(|s|s.echo_cancellation)})))})
        }
        fn events(&mut self, app: &tauri::AppHandle, events: Vec<Value>) {
            publish(
                app,
                self.config["sessionId"].as_str().unwrap(),
                events,
                &mut self.chunks,
            );
        }
        fn finish_source(
            &mut self,
            app: &tauri::AppHandle,
            index: usize,
            drain: bool,
        ) -> Result<(), String> {
            let Some(stream) = &mut self.streams[index] else {
                return Ok(());
            };
            let stop = stream.stop();
            let packets = if drain {
                stream.drain(self.origin, index == 0 && self.muted)
            } else {
                Ok(Vec::new())
            };
            let chunk = stream.finish();
            self.indices[index] = stream.index();
            if let Ok(packets) = packets.as_ref() {
                self.events(app, packets.clone());
            }
            if let Ok(Some(chunk)) = chunk.as_ref() {
                self.events(app, vec![chunk.clone()]);
            }
            chunk?;
            packets?;
            stop
        }
        fn source_error(&mut self, app: &tauri::AppHandle, index: usize, error: String) {
            let _ = self.finish_source(app, index, false);
            self.fatal |= self.streams[index]
                .as_ref()
                .is_some_and(|stream| stream.storage_failed);
            self.streams[index] = None;
            if self.errors[index].as_ref() != Some(&error) {
                self.events(app, vec![json!({"type":"source-error","source":if index==0 {"microphone"} else {"remote"},"message":error,"error":error,"fatal":self.fatal,"startMs":self.start.elapsed().as_millis() as u64})]);
            }
            self.errors[index] = Some(error);
        }
        fn reconnect(&mut self, app: &tauri::AppHandle, index: usize) {
            let source = if index == 0 { "microphone" } else { "remote" };
            match audio::Stream::open(&self.config, &self.directory, source) {
                Ok(mut stream) => {
                    stream.set_index(self.indices[index]);
                    if let Err(error) = if self.paused { Ok(()) } else { stream.start() } {
                        self.source_error(app, index, error);
                        return;
                    }
                    self.streams[index] = Some(stream);
                    self.errors[index] = None;
                    self.events(app, vec![json!({"type":"source-restored","source":source,"startMs":self.start.elapsed().as_millis() as u64})]);
                }
                Err(error) => self.source_error(app, index, error),
            }
        }
        fn command(&mut self, app: &tauri::AppHandle, value: &Value) -> Result<Value, String> {
            match value["action"].as_str().unwrap_or_default() {
                "mute" => {
                    self.muted = value["muted"]
                        .as_bool()
                        .ok_or("Invalid microphone mute state.")?;
                }
                "pause" if !self.paused => {
                    for index in 0..2 {
                        if let Err(error) = self.finish_source(app, index, true) {
                            self.source_error(app, index, error);
                        }
                        if let Some(stream) = &self.streams[index] {
                            stream.reset()?;
                        }
                    }
                    self.paused = true;
                }
                "resume" if self.paused => {
                    for index in 0..2 {
                        if let Some(stream) = &self.streams[index] {
                            if let Err(error) = stream.start() {
                                self.source_error(app, index, error);
                            }
                        }
                    }
                    self.paused = false;
                }
                "stop" => {
                    for index in 0..2 {
                        if let Err(error) = self.finish_source(app, index, true) {
                            self.source_error(app, index, error);
                        }
                    }
                    let mut state = self.snapshot("stopped");
                    state["chunks"] = json!(self.chunks);
                    return Ok(state);
                }
                _ => {}
            }
            Ok(self.snapshot(if self.paused { "paused" } else { "recording" }))
        }
    }

    fn run(
        app: tauri::AppHandle,
        config: Value,
        directory: PathBuf,
        commands: mpsc::Receiver<Command>,
        ready: Reply,
        status: Arc<Mutex<Value>>,
    ) {
        let initialized = (|| -> Result<_, String> {
            let com = probe::Com::new()?;
            // Open both streams before starting either; no successful partial start is reported.
            let microphone = audio::Stream::open(&config, &directory, "microphone")?;
            let remote = audio::Stream::open(&config, &directory, "remote")?;
            let origin = audio::qpc_100ns()?;
            microphone.start()?;
            remote.start()?;
            Ok((
                com,
                Runtime {
                    config: config.clone(),
                    directory,
                    streams: [Some(microphone), Some(remote)],
                    indices: [0, 0],
                    errors: [None, None],
                    chunks: Vec::new(),
                    paused: false,
                    muted: false,
                    origin,
                    start: Instant::now(),
                    fatal: false,
                },
            ))
        })();
        let (_com, mut runtime) = match initialized {
            Ok(value) => value,
            Err(error) => {
                let state =
                    json!({"sessionId":config["sessionId"],"state":"error","errors":[error]});
                *status.lock().unwrap() = state.clone();
                let _ = ready.send(Err(error));
                notify(
                    &app,
                    json!({"type":"state","sessionId":config["sessionId"],"state":"error","status":state}),
                );
                return;
            }
        };
        let state = runtime.snapshot("recording");
        *status.lock().unwrap() = state.clone();
        let _ = ready.send(Ok(state.clone()));
        notify(
            &app,
            json!({"type":"state","sessionId":config["sessionId"],"state":"recording","status":state}),
        );
        let process = config["processId"].as_u64().and_then(|pid| unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                pid as u32,
            )
            .ok()
            .map(probe::Handle)
        });
        let mut process_ended = false;
        let mut reported = Instant::now();
        let mut devices_checked = Instant::now();
        loop {
            while let Ok(Command(value, reply)) = commands.try_recv() {
                let stop = value["action"] == "stop";
                let result = runtime.command(&app, &value);
                if let Ok(state) = &result {
                    *status.lock().unwrap() = state.clone();
                    notify(
                        &app,
                        json!({"type":"state","sessionId":config["sessionId"],"state":state["state"],"status":state}),
                    );
                }
                let _ = reply.send(result);
                if stop {
                    return;
                }
            }
            if !runtime.paused {
                for index in 0..2 {
                    if let Some(stream) = &mut runtime.streams[index] {
                        match stream.drain(runtime.origin, index == 0 && runtime.muted) {
                            Ok(events) => runtime.events(&app, events),
                            Err(error) => runtime.source_error(&app, index, error),
                        }
                    }
                }
            }
            if runtime.fatal {
                let mut state = runtime
                    .command(&app, &json!({"action":"stop"}))
                    .unwrap_or_else(|_| runtime.snapshot("error"));
                state["state"] = json!("error");
                *status.lock().unwrap() = state.clone();
                notify(
                    &app,
                    json!({"type":"state","sessionId":config["sessionId"],"state":"error","status":state}),
                );
                return;
            }
            if devices_checked.elapsed() >= Duration::from_secs(2) {
                // Process loopback follows output changes itself; endpoint streams must be reopened.
                for (index, flow) in [(0, eCapture), (1, eRender)] {
                    let follows_default = if index == 0 {
                        config["microphoneDeviceId"].as_str().is_none()
                    } else {
                        config["loopbackMode"] == "system"
                    };
                    if follows_default {
                        if let Ok(current) = unsafe { probe::default_id(flow) } {
                            if runtime.streams[index]
                                .as_ref()
                                .is_some_and(|stream| stream.device_id.as_ref() != Some(&current))
                            {
                                if let Err(error) = runtime.finish_source(&app, index, true) {
                                    runtime.source_error(&app, index, error);
                                }
                                runtime.streams[index] = None;
                                runtime.events(&app, vec![json!({"type":"gap","source":if index==0 {"microphone"} else {"remote"},"reason":"default-device-changed","startMs":runtime.start.elapsed().as_millis() as u64})]);
                            }
                        }
                    }
                }
                for index in 0..2 {
                    if !runtime.fatal && runtime.streams[index].is_none() {
                        runtime.reconnect(&app, index);
                    }
                }
                if !process_ended
                    && process.as_ref().is_some_and(|handle| unsafe {
                        WaitForSingleObject(handle.0, 0) == WAIT_OBJECT_0
                    })
                {
                    process_ended = true;
                    runtime.events(&app, vec![json!({"type":"process-ended","processId":config["processId"],"startMs":runtime.start.elapsed().as_millis() as u64})]);
                }
                devices_checked = Instant::now();
            }
            if reported.elapsed() >= Duration::from_secs(1) {
                let state = runtime.snapshot(if runtime.paused {
                    "paused"
                } else {
                    "recording"
                });
                *status.lock().unwrap() = state.clone();
                notify(
                    &app,
                    json!({"type":"state","sessionId":config["sessionId"],"state":state["state"],"status":state}),
                );
                reported = Instant::now();
            }
            let handles: Vec<_> = runtime
                .streams
                .iter()
                .flatten()
                .map(|stream| stream.event.0)
                .collect();
            if runtime.paused || handles.is_empty() {
                thread::sleep(Duration::from_millis(40));
            } else {
                unsafe {
                    WaitForMultipleObjects(&handles, false, 40);
                }
            }
        }
    }
}

pub async fn dispatch(app: &tauri::AppHandle, value: Value) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || controller::dispatch(app, value))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        if matches!(value["action"].as_str(), Some("probe" | "sources")) {
            Ok(json!({"supported":false,"devices":[],"sessions":[],"candidates":[]}))
        } else {
            Err("Native meeting recording currently requires Windows.".into())
        }
    }
}
