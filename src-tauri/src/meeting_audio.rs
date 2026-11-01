use super::{probe, wav::ChunkWriter};
use serde_json::{json, Value};
use std::{mem::ManuallyDrop, path::Path, sync::mpsc, time::Duration};
use windows::{
    core::{implement, Interface, Ref, PCWSTR},
    Win32::{
        Media::Audio::*,
        System::{
            Com::{StructuredStorage::*, *},
            Performance::*,
            Threading::*,
            Variant::VT_BLOB,
        },
    },
};

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Activation(mpsc::Sender<()>);
impl IActivateAudioInterfaceCompletionHandler_Impl for Activation_Impl {
    fn ActivateCompleted(
        &self,
        _: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

fn process_loopback(pid: u32) -> Result<IAudioClient, String> {
    let mut parameters = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // This PROPVARIANT borrows the activation structure; it must not free its blob.
    let variant = ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of_val(&parameters) as u32,
                        pBlobData: &mut parameters as *mut _ as *mut u8,
                    },
                },
                ..Default::default()
            }),
        },
    });
    let (send, receive) = mpsc::channel();
    let handler: IActivateAudioInterfaceCompletionHandler = Activation(send).into();
    unsafe {
        let operation = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*variant),
            &handler,
        )
        .map_err(|e| format!("Process audio capture is unavailable: {e}"))?;
        receive
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Windows did not activate process audio capture in time.")?;
        let mut status = windows::core::HRESULT(0);
        let mut object = None;
        operation
            .GetActivateResult(&mut status, &mut object)
            .map_err(|e| e.to_string())?;
        status
            .ok()
            .map_err(|e| format!("Process audio capture could not start: {e}"))?;
        object
            .ok_or("Windows returned no process audio interface.")?
            .cast()
            .map_err(|e| e.to_string())
    }
}

pub(super) fn process_loopback_support() -> Result<(), String> {
    // Ask the actual API, without initializing or starting an audio stream. An OS
    // version alone cannot establish that the interface is currently available.
    static AVAILABLE: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    if AVAILABLE.get().is_some() {
        return Ok(());
    }
    process_loopback(std::process::id()).map(|_| {
        let _ = AVAILABLE.set(());
    })
}

pub fn qpc_100ns() -> Result<u64, String> {
    unsafe {
        let (mut ticks, mut frequency) = (0, 0);
        QueryPerformanceCounter(&mut ticks).map_err(|e| e.to_string())?;
        QueryPerformanceFrequency(&mut frequency).map_err(|e| e.to_string())?;
        Ok(((ticks as u128 * 10_000_000) / frequency as u128) as u64)
    }
}

pub struct Stream {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    pub event: probe::Handle,
    pub source: &'static str,
    pub device_id: Option<String>,
    pub rate: u32,
    pub channels: u16,
    pub echo_cancellation: &'static str,
    pub peak: f32,
    pub storage_failed: bool,
    writer: ChunkWriter,
    zeroes: Vec<u8>,
}

impl Stream {
    pub fn open(value: &Value, directory: &Path, source: &'static str) -> Result<Self, String> {
        let microphone = source == "microphone";
        let process = !microphone && value["loopbackMode"] != "system";
        let (rate, channels) = if microphone { (16000, 1) } else { (48000, 2) };
        let format = WAVEFORMATEX {
            wFormatTag: 1,
            nChannels: channels,
            nSamplesPerSec: rate,
            nAvgBytesPerSec: rate * u32::from(channels) * 2,
            nBlockAlign: channels * 2,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        let (client, device_id): (IAudioClient, _) = unsafe {
            if process {
                (
                    process_loopback(
                        value["processId"]
                            .as_u64()
                            .ok_or("Choose an application to record.")?
                            as u32,
                    )?,
                    None,
                )
            } else {
                let manager = probe::enumerator().map_err(|e| e.to_string())?;
                let device =
                    if let Some(id) = value["microphoneDeviceId"].as_str().filter(|_| microphone) {
                        let id: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
                        manager.GetDevice(PCWSTR(id.as_ptr()))
                    } else {
                        manager.GetDefaultAudioEndpoint(
                            if microphone { eCapture } else { eRender },
                            eCommunications,
                        )
                    }
                    .map_err(|e| format!("{source} device is unavailable: {e}"))?;
                (
                    device
                        .Activate(CLSCTX_ALL, None)
                        .map_err(|e| format!("Cannot open {source}: {e}"))?,
                    Some(probe::device_id(&device).map_err(|e| e.to_string())?),
                )
            }
        };
        unsafe {
            if microphone {
                let client2: IAudioClient2 = client.cast().map_err(|e| e.to_string())?;
                client2
                    .SetClientProperties(&AudioClientProperties {
                        cbSize: std::mem::size_of::<AudioClientProperties>() as u32,
                        eCategory: AudioCategory_Communications,
                        ..Default::default()
                    })
                    .map_err(|e| {
                        format!("Microphone communications processing is unavailable: {e}")
                    })?;
            }
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
                        | if microphone {
                            0
                        } else {
                            AUDCLNT_STREAMFLAGS_LOOPBACK
                        },
                    1_000_000,
                    0,
                    &format,
                    None,
                )
                .map_err(|e| format!("Cannot initialize {source} audio: {e}"))?;
            let event =
                probe::Handle(CreateEventW(None, false, false, None).map_err(|e| e.to_string())?);
            client.SetEventHandle(event.0).map_err(|e| e.to_string())?;
            let capture = client.GetService().map_err(|e| e.to_string())?;
            let echo_cancellation = if microphone {
                match client.GetService::<IAcousticEchoCancellationControl>() {
                    Ok(aec) => {
                        let output: Vec<u16> = probe::default_id(eRender)
                            .unwrap_or_default()
                            .encode_utf16()
                            .chain(Some(0))
                            .collect();
                        if aec
                            .SetEchoCancellationRenderEndpoint(PCWSTR(output.as_ptr()))
                            .is_ok()
                        {
                            "device-managed"
                        } else {
                            "unavailable"
                        }
                    }
                    Err(_) => "unavailable",
                }
            } else {
                "not-applicable"
            };
            Ok(Self {
                client,
                capture,
                event,
                source,
                device_id,
                rate,
                channels,
                echo_cancellation,
                peak: 0.0,
                storage_failed: false,
                writer: ChunkWriter::new(
                    directory,
                    value["sessionId"].as_str().unwrap(),
                    source,
                    rate,
                    channels,
                    value["chunkSeconds"].as_u64().unwrap_or(15),
                ),
                zeroes: Vec::new(),
            })
        }
    }

    pub fn start(&self) -> Result<(), String> {
        unsafe { self.client.Start() }.map_err(|e| format!("Cannot start {}: {e}", self.source))
    }
    pub fn stop(&self) -> Result<(), String> {
        unsafe { self.client.Stop() }.map_err(|e| format!("Cannot stop {}: {e}", self.source))
    }
    pub fn reset(&self) -> Result<(), String> {
        unsafe { self.client.Reset() }.map_err(|e| format!("Cannot reset {}: {e}", self.source))
    }
    pub fn finish(&mut self) -> Result<Option<Value>, String> {
        let result = self.writer.finish();
        self.storage_failed |= result.is_err();
        result
    }
    pub fn index(&self) -> u64 {
        self.writer.index()
    }
    pub fn set_index(&mut self, index: u64) {
        self.writer.set_index(index);
    }

    pub fn drain(&mut self, origin: u64, muted: bool) -> Result<Vec<Value>, String> {
        let mut events = Vec::new();
        unsafe {
            while self
                .capture
                .GetNextPacketSize()
                .map_err(|e| format!("{} source disconnected: {e}", self.source))?
                > 0
            {
                let (mut data, mut frames, mut flags, mut position) =
                    (std::ptr::null_mut(), 0, 0, 0);
                self.capture
                    .GetBuffer(
                        &mut data,
                        &mut frames,
                        &mut flags,
                        None,
                        Some(&mut position),
                    )
                    .map_err(|e| e.to_string())?;
                let write: Result<(), String> = (|| {
                    let timestamp_error = flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 != 0;
                    let start_ms = if timestamp_error || position == 0 {
                        self.writer
                            .expected_ms()
                            .unwrap_or(qpc_100ns()?.saturating_sub(origin) as f64 / 10_000.0)
                    } else {
                        position.saturating_sub(origin) as f64 / 10_000.0
                    };
                    let discontinuity =
                        flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0;
                    let gap_ms = self
                        .writer
                        .expected_ms()
                        .map(|expected| start_ms - expected)
                        .unwrap_or(0.0);
                    if discontinuity || gap_ms.abs() > 80.0 {
                        events.extend(self.finish()?);
                        events.push(json!({"type":"gap","source":self.source,"startMs":start_ms,"durationMs":gap_ms.max(0.0),"reason":"audio-discontinuity","timestampEstimated":timestamp_error}));
                    }
                    let length = frames as usize * usize::from(self.channels) * 2;
                    // A broken audio driver must not cause an unbounded allocation or invalid read.
                    if length > self.rate as usize * usize::from(self.channels) * 2 * 5 {
                        return Err("Windows returned an oversized audio packet.".into());
                    }
                    let silent = muted || flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                    let bytes = if silent {
                        self.zeroes.resize(length, 0);
                        &self.zeroes[..length]
                    } else {
                        if data.is_null() && length > 0 {
                            return Err("Windows returned an empty audio buffer.".into());
                        }
                        if length == 0 {
                            &[]
                        } else {
                            std::slice::from_raw_parts(data, length)
                        }
                    };
                    self.peak = bytes
                        .chunks_exact(2)
                        .map(|v| i16::from_le_bytes([v[0], v[1]]).unsigned_abs())
                        .max()
                        .unwrap_or(0) as f32
                        / 32768.0;
                    let chunks = self.writer.write(bytes, start_ms);
                    self.storage_failed |= chunks.is_err();
                    events.extend(chunks?);
                    Ok(())
                })();
                let release = self
                    .capture
                    .ReleaseBuffer(frames)
                    .map_err(|e| e.to_string());
                write?;
                release?;
            }
        }
        Ok(events)
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn process_loopback_activation_does_not_capture() {
        let _com = super::probe::Com::new().unwrap();
        let client = super::process_loopback(std::process::id())
            .expect("Native process loopback activation");
        drop(client);
    }

    #[test]
    #[ignore = "Requires an installed microphone; initializes the format without starting capture"]
    fn microphone_format_initializes_without_recording() {
        let _com = super::probe::Com::new().unwrap();
        let config = serde_json::json!({"sessionId":"format-test","chunkSeconds":15});
        let stream = super::Stream::open(&config, &std::env::temp_dir(), "microphone")
            .expect("Initialize microphone PCM16 and communications processing");
        assert_eq!(stream.rate, 16000);
        assert_eq!(stream.channels, 1);
        assert!(stream.device_id.is_some());
        eprintln!(
            "Microphone native format initialized; AEC: {}. Capture was not started.",
            stream.echo_cancellation
        );
    }

    #[test]
    fn process_loopback_captures_only_this_test_process() {
        let _com = super::probe::Com::new().unwrap();
        let root = std::env::temp_dir().join(format!(
            "localflow-loopback-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let config = serde_json::json!({"sessionId":"native-test","processId":std::process::id(),"loopbackMode":"process","chunkSeconds":15});
        let mut stream = super::Stream::open(&config, &root, "remote")
            .expect("Initialize process loopback format");
        let origin = super::qpc_100ns().unwrap();
        stream.start().expect("Start test-process loopback only");
        let mut events = Vec::new();
        for _ in 0..10 {
            std::thread::sleep(std::time::Duration::from_millis(20));
            events.extend(stream.drain(origin, false).expect("Read process packets"));
        }
        stream.stop().unwrap();
        events.extend(stream.drain(origin, false).unwrap());
        events.extend(stream.finish().unwrap());
        for event in events.iter().filter(|e| e["type"] == "chunk") {
            assert_eq!(event["source"], "remote");
            let bytes = std::fs::read(event["path"].as_str().unwrap()).unwrap();
            // Windows' PCM converter can dither digital silence by one least significant bit.
            assert!(
                bytes[44..]
                    .chunks_exact(2)
                    .all(|sample| i16::from_le_bytes([sample[0], sample[1]]).unsigned_abs() <= 1),
                "Unrelated application audio must not be captured"
            );
        }
        drop(stream);
        std::fs::remove_dir_all(root).unwrap();
    }
}
