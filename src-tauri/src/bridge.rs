use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

type Reply = oneshot::Sender<Result<Value, String>>;
pub struct Bridge {
    input: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, Reply>>,
    sequence: AtomicU64,
    #[cfg(windows)]
    job: Mutex<Option<std::os::windows::io::OwnedHandle>>,
}
impl Bridge {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            input: Mutex::new(None),
            child: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(1),
            #[cfg(windows)]
            job: Mutex::new(None),
        })
    }
    fn send(&self, packet: Value) -> Result<(), String> {
        let mut input = self.input.lock().map_err(|e| e.to_string())?;
        let writer = input.as_mut().ok_or("LocalFlow host is unavailable.")?;
        if std::env::var_os("LOCALFLOW_DEBUG_BRIDGE").is_some() {
            eprintln!("[bridge] send {} {}", packet["id"], packet["method"]);
        }
        writeln!(writer, "{}", packet).map_err(|e| e.to_string())
    }
    pub fn start(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        let mut slot = self.child.lock().map_err(|e| e.to_string())?;
        if slot.is_some() {
            return Ok(());
        }
        let root = crate::paths::root(app)?;
        let directory = crate::paths::profile()?;
        let node = crate::paths::node(&root)?;
        let mut command = Command::new(node);
        command
            .arg(root.join("desktop/service.cjs"))
            .current_dir(&root)
            .env("LOCALFLOW_USER_DATA", &directory)
            .env("LOCALFLOW_APP_ROOT", &root)
            .env(
                "LOCALFLOW_PACKAGED",
                std::env::var("LOCALFLOW_PACKAGED").unwrap_or_else(|_| {
                    if cfg!(debug_assertions) {
                        "0".into()
                    } else {
                        "1".into()
                    }
                }),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Could not start LocalFlow host: {e}"))?;
        #[cfg(windows)]
        {
            use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
            use windows::Win32::{Foundation::HANDLE, System::JobObjects::*};
            let attach = || -> windows::core::Result<OwnedHandle> {
                unsafe {
                    let job = CreateJobObjectW(None, None)?;
                    let owner = OwnedHandle::from_raw_handle(job.0);
                    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    SetInformationJobObject(
                        job,
                        JobObjectExtendedLimitInformation,
                        &limits as *const _ as _,
                        std::mem::size_of_val(&limits) as u32,
                    )?;
                    AssignProcessToJobObject(job, HANDLE(child.as_raw_handle()))?;
                    Ok(owner)
                }
            };
            match attach() {
                Ok(job) => *self.job.lock().unwrap() = Some(job),
                Err(error) => {
                    let _ = child.kill();
                    return Err(format!("Could not supervise LocalFlow processes: {error}"));
                }
            }
        }
        let output = child.stdout.take().ok_or("Host output unavailable")?;
        let errors = child.stderr.take().ok_or("Host errors unavailable")?;
        *self.input.lock().unwrap() = child.stdin.take();
        *slot = Some(child);
        let this = self.clone();
        let handle = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                let Ok(packet) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if std::env::var_os("LOCALFLOW_DEBUG_BRIDGE").is_some() {
                    eprintln!("[bridge] receive {} {}", packet["id"], packet["event"]);
                }
                if let Some(id) = packet["id"].as_u64() {
                    if let Some(reply) = this.pending.lock().unwrap().remove(&id) {
                        let result = if let Some(error) = packet["error"].as_str() {
                            Err(error.to_owned())
                        } else {
                            Ok(packet["value"].clone())
                        };
                        let _ = reply.send(result);
                    }
                } else if let Some(name) = packet["event"].as_str() {
                    let _ = handle.emit_to("main", name, &packet["value"]);
                    if name == "edge-state" {
                        let _ = handle.emit_to("edge", name, &packet["value"]);
                    }
                } else if packet["native"].is_string() {
                    let this = this.clone();
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let result = crate::native::dispatch(
                            &handle,
                            packet["native"].as_str().unwrap(),
                            packet["args"].clone(),
                        )
                        .await;
                        let reply = match result {
                            Ok(value) => json!({"nativeId":packet["nativeId"], "value":value}),
                            Err(error) => json!({"nativeId":packet["nativeId"], "error":error}),
                        };
                        let _ = this.send(reply);
                    });
                }
            }
            for (_, reply) in this.pending.lock().unwrap().drain() {
                let _ = reply.send(Err("LocalFlow host stopped.".into()));
            }
            *this.input.lock().unwrap() = None;
            this.child.lock().unwrap().take();
            let _ = handle.emit_to(
                "main",
                "host-error",
                "LocalFlow host stopped. Your saved data remains on disk.",
            );
        });
        std::thread::spawn(move || {
            for line in BufReader::new(errors).lines().map_while(Result::ok) {
                eprintln!("[host] {line}");
            }
        });
        Ok(())
    }
    pub async fn call(
        self: &Arc<Self>,
        app: &AppHandle,
        method: &str,
        args: Value,
    ) -> Result<Value, String> {
        self.start(app)?;
        let id = self.sequence.fetch_add(1, Ordering::Relaxed);
        let (send, receive) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, send);
        if let Err(error) = self.send(json!({"id":id, "method":method, "args":args})) {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        let result = tokio::time::timeout(Duration::from_secs(1800), receive).await;
        self.pending.lock().unwrap().remove(&id);
        result
            .map_err(|_| "LocalFlow operation timed out.".to_owned())?
            .map_err(|_| "LocalFlow host stopped.".to_owned())?
    }
    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill.exe")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
