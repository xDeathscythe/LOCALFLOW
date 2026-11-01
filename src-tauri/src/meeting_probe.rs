use serde_json::{json, Value};
use std::{collections::HashMap, path::Path};
use windows::{
    core::{Interface, PWSTR},
    Win32::{
        Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
        Foundation::{CloseHandle, HANDLE},
        Media::Audio::*,
        System::{
            Com::{StructuredStorage::*, *},
            Diagnostics::ToolHelp::*,
            Threading::*,
        },
    },
};

pub struct Com;
impl Com {
    pub fn new() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }.map_err(|e| e.to_string())?;
        Ok(Self)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub struct Handle(pub HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

pub unsafe fn owned_string(value: PWSTR) -> String {
    let text = value.to_string().unwrap_or_default();
    CoTaskMemFree(Some(value.0.cast()));
    text
}

pub unsafe fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
}

pub unsafe fn device_id(device: &IMMDevice) -> windows::core::Result<String> {
    Ok(owned_string(device.GetId()?))
}

pub unsafe fn default_id(flow: EDataFlow) -> windows::core::Result<String> {
    device_id(&enumerator()?.GetDefaultAudioEndpoint(flow, eCommunications)?)
}

pub fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?);
        let mut path = vec![0u16; 32768];
        let mut size = path.len() as u32;
        QueryFullProcessImageNameW(
            handle.0,
            PROCESS_NAME_WIN32,
            PWSTR(path.as_mut_ptr()),
            &mut size,
        )
        .ok()?;
        Some(String::from_utf16_lossy(&path[..size as usize]))
    }
}

fn process_tree() -> HashMap<u32, (u32, String)> {
    let mut tree = HashMap::new();
    unsafe {
        let Ok(handle) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return tree;
        };
        let handle = Handle(handle);
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(handle.0, &mut entry).is_ok() {
            loop {
                let size = entry
                    .szExeFile
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(entry.szExeFile.len());
                tree.insert(
                    entry.th32ProcessID,
                    (
                        entry.th32ParentProcessID,
                        String::from_utf16_lossy(&entry.szExeFile[..size]),
                    ),
                );
                if Process32NextW(handle.0, &mut entry).is_err() {
                    break;
                }
            }
        }
    }
    tree
}

fn own_process(tree: &HashMap<u32, (u32, String)>, mut pid: u32) -> bool {
    for _ in 0..64 {
        if pid == std::process::id() {
            return true;
        }
        let Some((parent, _)) = tree.get(&pid) else {
            break;
        };
        if *parent == pid || *parent == 0 {
            break;
        }
        pid = *parent;
    }
    false
}

// Group Chromium-style child audio processes by executable identity, never by UI text.
fn application_pid(tree: &HashMap<u32, (u32, String)>, mut pid: u32) -> u32 {
    for _ in 0..64 {
        let Some((parent, name)) = tree.get(&pid) else {
            break;
        };
        let Some((_, parent_name)) = tree.get(parent) else {
            break;
        };
        if *parent == pid || !name.eq_ignore_ascii_case(parent_name) {
            break;
        }
        pid = *parent;
    }
    pid
}

pub fn probe() -> Result<Value, String> {
    let _com = Com::new()?;
    let process_loopback = super::audio::process_loopback_support();
    let tree = process_tree();
    let mut devices = Vec::new();
    let mut sessions = Vec::new();
    let mut warnings = Vec::new();
    unsafe {
        let manager = enumerator().map_err(|e| e.to_string())?;
        for (flow, kind) in [(eCapture, "microphone"), (eRender, "remote")] {
            let default = default_id(flow).unwrap_or_default();
            let endpoints = manager
                .EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)
                .map_err(|e| e.to_string())?;
            for index in 0..endpoints.GetCount().map_err(|e| e.to_string())? {
                let device = endpoints.Item(index).map_err(|e| e.to_string())?;
                let id = device_id(&device).map_err(|e| e.to_string())?;
                let label = (|| -> windows::core::Result<String> {
                    let store = device.OpenPropertyStore(STGM_READ)?;
                    let property = store.GetValue(&PKEY_Device_FriendlyName)?;
                    PropVariantToStringAlloc(&property).map(|value| owned_string(value))
                })()
                .unwrap_or_else(|_| id.clone());
                devices.push(json!({"id":id,"label":label,"source":kind,"default":id == default}));
                let result = (|| -> windows::core::Result<()> {
                    let audio: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
                    let list = audio.GetSessionEnumerator()?;
                    for index in 0..list.GetCount()? {
                        let control: IAudioSessionControl2 = list.GetSession(index)?.cast()?;
                        let process_id = control.GetProcessId()?;
                        if process_id == 0 || own_process(&tree, process_id) {
                            continue;
                        }
                        let root = application_pid(&tree, process_id);
                        let executable = process_path(root).unwrap_or_default();
                        let application = Path::new(&executable)
                            .file_name()
                            .and_then(|p| p.to_str())
                            .map(str::to_owned)
                            .or_else(|| tree.get(&root).map(|p| p.1.clone()))
                            .unwrap_or_else(|| root.to_string());
                        sessions.push(json!({
                            "id":owned_string(control.GetSessionInstanceIdentifier()?),
                            "deviceId":id,"source":kind,"processId":root,"audioProcessId":process_id,
                            "application":application,"executable":executable,
                            "active":control.GetState()? == AudioSessionStateActive
                        }));
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    warnings.push(format!("Audio sessions on {label}: {error}"));
                }
            }
        }
    }
    let mut candidates = Vec::new();
    for capture in sessions
        .iter()
        .filter(|s| s["source"] == "microphone" && s["active"] == true)
    {
        let render = sessions.iter().find(|s| {
            s["processId"] == capture["processId"] && s["source"] == "remote" && s["active"] == true
        });
        if let Some(render) = render {
            candidates.push(json!({
                "callId":format!("{}:{}:{}", capture["processId"], capture["id"].as_str().unwrap_or_default(), render["id"].as_str().unwrap_or_default()),
                "processId":capture["processId"],"application":capture["application"],
                "microphoneDeviceId":capture["deviceId"],"capture":true,"render":true,
                "confirmedCall":false,"confidence":"audio-activity"
            }));
        }
    }
    Ok(
        json!({"supported":true,"processLoopback":process_loopback.is_ok(),"processLoopbackError":process_loopback.err(),"processLoopbackMinimumWindowsBuild":20348,"devices":devices,"sessions":sessions,"candidates":candidates,"warnings":warnings}),
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn probe_does_not_open_capture_streams() {
        let result = super::probe().expect("Windows audio enumeration");
        assert!(result["devices"].is_array());
        for candidate in result["candidates"].as_array().unwrap() {
            assert_eq!(candidate["confirmedCall"], false);
        }
    }
}
