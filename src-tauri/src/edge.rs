use serde_json::{json, Value};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
fn settings() -> Result<Value, String> {
    Ok(
        std::fs::read(crate::paths::profile()?.join("edge-panel.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(json!({"enabled":true,"autoHide":true})),
    )
}
pub fn create(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("edge").is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "edge", WebviewUrl::App("edge.html".into()))
        .data_directory(crate::paths::webview()?)
        .title("LocalFlow Edge")
        .inner_size(5., 146.)
        .visible(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .focusable(false)
        .build()
        .map_err(|e| e.to_string())?;
    let preferences = settings()?;
    update(
        app,
        json!({"enabled":preferences["enabled"],"autoHide":preferences["autoHide"],"theme":crate::native::theme()?,"selected":"microphone","recording":false,"starting":false,"elapsedSeconds":0,"hover":false}),
    )?;
    Ok(())
}
pub fn update(app: &tauri::AppHandle, value: Value) -> Result<(), String> {
    let desktop = app.state::<crate::Desktop>();
    let mut state = desktop.edge.lock().unwrap();
    let mut changed = false;
    for (key, value) in value.as_object().ok_or("Invalid edge state")? {
        changed |= state[key] != *value;
        state[key] = value.clone();
    }
    let expanded = json!(
        state["autoHide"] == false
            || state["hover"] == true
            || state["recording"] == true
            || state["starting"] == true
            || state["agentListening"] == true
            || state["busy"] == true
    );
    changed |= state["expanded"] != expanded;
    state["expanded"] = expanded;
    if let Some(window) = app.get_webview_window("edge") {
        let width = if state["expanded"] == true { 31. } else { 5. };
        if let Some(monitor) = app
            .get_webview_window("main")
            .and_then(|main| main.current_monitor().ok().flatten())
        {
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            let size = tauri::PhysicalSize::new(
                (width * scale).round() as u32,
                (146. * scale).round() as u32,
            );
            if window.inner_size().map_err(|e| e.to_string())? != size {
                window.set_size(size).map_err(|e| e.to_string())?;
            }
            let position = tauri::PhysicalPosition::new(
                area.position.x + area.size.width as i32 - (width * scale) as i32,
                area.position.y + (79. * scale) as i32,
            );
            if window.outer_position().map_err(|e| e.to_string())? != position {
                window.set_position(position).map_err(|e| e.to_string())?;
            }
        }
        let visible = state["enabled"] != false;
        if window.is_visible().map_err(|e| e.to_string())? != visible {
            if visible {
                window.show()
            } else {
                window.hide()
            }
            .map_err(|e| e.to_string())?;
        }
        if changed {
            window
                .emit("edge-state", &*state)
                .map_err(|e| e.to_string())?;
        }
    }
    let main_hidden = app.get_webview_window("main").is_none_or(|window| {
        !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false)
    });
    let recording = state["enabled"] == false
        && main_hidden
        && (state["recording"] == true || state["starting"] == true);
    let created = recording && app.get_webview_window("recording").is_none();
    if created {
        WebviewWindowBuilder::new(app, "recording", WebviewUrl::App("recording.html".into()))
            .data_directory(crate::paths::webview()?)
            .title("LocalFlow dictation")
            .inner_size(144., 42.)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focusable(false)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
    }
    if let Some(window) = app.get_webview_window("recording") {
        if recording {
            if let Some(monitor) = app
                .get_webview_window("main")
                .and_then(|main| main.current_monitor().ok().flatten())
            {
                let area = monitor.work_area();
                let scale = monitor.scale_factor();
                let position = tauri::PhysicalPosition::new(
                    area.position.x + (area.size.width as i32 - (144. * scale) as i32) / 2,
                    area.position.y + area.size.height as i32 - (60. * scale) as i32,
                );
                if window.outer_position().map_err(|e| e.to_string())? != position {
                    window.set_position(position).map_err(|e| e.to_string())?;
                }
            }
            if !window.is_visible().map_err(|e| e.to_string())? {
                window.show().map_err(|e| e.to_string())?;
            }
            if changed || created {
                window
                    .emit("recording-state", &*state)
                    .map_err(|e| e.to_string())?;
            }
        } else {
            window.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
pub fn ready(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let state = app.state::<crate::Desktop>().edge.lock().unwrap().clone();
    app.emit_to(label, &format!("{label}-state"), state)
        .map_err(|error| error.to_string())
}
pub fn dispatch(app: &tauri::AppHandle, method: &str, value: &Value) -> Result<Value, String> {
    match method {
        "get-edge-settings" => return settings(),
        "set-edge-settings" => {
            if !value["enabled"].is_boolean() || !value["autoHide"].is_boolean() {
                return Err("Invalid edge settings".into());
            }
            let file = crate::paths::profile()?.join("edge-panel.json");
            let temp = file.with_extension("json.tmp");
            std::fs::write(&temp, value.to_string()).map_err(|e| e.to_string())?;
            std::fs::rename(temp, file).map_err(|e| e.to_string())?;
            update(
                app,
                json!({"enabled":value["enabled"],"autoHide":value["autoHide"],"hover":false}),
            )?;
            return Ok(value.clone());
        }
        "edge-ready" => ready(app, "edge")?,
        "edge-hover" => update(app, json!({"hover":value.is_number()}))?,
        "edge-action" => {
            let action = value.as_str().ok_or("Invalid action")?;
            if !["agent", "microphone", "notes"].contains(&action) {
                return Err("Invalid action".into());
            }
            update(app, json!({"selected":action}))?;
            if action != "microphone" {
                crate::show(app);
            }
            app.emit_to("main", "edge-action", action)
                .map_err(|e| e.to_string())?;
        }
        "overlay-state" => {
            let state = value.as_object().ok_or("Invalid recording state")?;
            let allowed = [
                "recording",
                "starting",
                "agentListening",
                "recordingTarget",
                "elapsedSeconds",
                "selected",
            ];
            let state: serde_json::Map<String, Value> = state
                .iter()
                .filter(|(key, _)| allowed.contains(&key.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            update(app, Value::Object(state))?;
        }
        "agent-state" => {
            if value["type"] == "busy" {
                update(app, json!({"busy":value["busy"]}))?;
            }
            if value["type"] == "voice" {
                update(app, json!({"voice":value["active"]}))?;
            }
            if value["type"] == "approval" {
                crate::show(app);
            }
        }
        _ => return Err("Unknown edge action".into()),
    }
    Ok(Value::Null)
}
