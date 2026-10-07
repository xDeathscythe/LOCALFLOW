#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod assets;
mod bridge;
mod capture;
mod edge;
mod edge_region;
mod meeting;
mod native;
mod paths;
mod pdf;
mod uploads;

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tokio::sync::oneshot;

struct Desktop {
    bridge: Arc<bridge::Bridge>,
    pending: Mutex<HashMap<u64, (String, oneshot::Sender<Result<Value, String>>)>>,
    sequence: AtomicU64,
    quitting: std::sync::atomic::AtomicBool,
    edge: Mutex<Value>,
}

#[tauri::command]
async fn host_call(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    method: String,
    args: Value,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("This operation belongs to the main window.".into());
    }
    app.state::<Desktop>()
        .bridge
        .call(&app, &method, args)
        .await
}
#[tauri::command]
async fn native_call(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    method: String,
    args: Value,
) -> Result<Value, String> {
    if window.label() != "main"
        && !(window.label() == "edge"
            && matches!(method.as_str(), "edge-hover" | "edge-action" | "edge-ready" | "edge-region" | "edge-meeting-action"))
        && !(window.label() == "recording"
            && matches!(method.as_str(), "recording-stop" | "recording-ready"))
    {
        return Err("This operation belongs to the main window.".into());
    }
    native::dispatch(&app, &method, args).await
}
#[tauri::command]
fn frontend_reply(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: u64,
    value: Value,
    error: Option<String>,
) -> Result<(), String> {
    let pending = app.state::<Desktop>();
    // Replies are scoped to the window requested by the host.
    let mut pending = pending.pending.lock().unwrap();
    if pending
        .get(&id)
        .is_some_and(|(label, _)| label == window.label())
    {
        if let Some((_, send)) = pending.remove(&id) {
            let _ = send.send(error.map_or_else(|| Ok(value), Err));
        }
    }
    Ok(())
}
pub async fn frontend(
    app: &tauri::AppHandle,
    label: &str,
    method: &str,
    args: Value,
) -> Result<Value, String> {
    let state = app.state::<Desktop>();
    let id = state.sequence.fetch_add(1, Ordering::Relaxed);
    let (send, receive) = oneshot::channel();
    state
        .pending
        .lock()
        .unwrap()
        .insert(id, (label.to_owned(), send));
    if let Err(error) = app.emit_to(
        label,
        "desktop-request",
        json!({"id":id,"method":method,"args":args}),
    ) {
        state.pending.lock().unwrap().remove(&id);
        return Err(error.to_string());
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(180), receive).await;
    state.pending.lock().unwrap().remove(&id);
    result
        .map_err(|_| "Desktop operation timed out.".to_owned())?
        .map_err(|_| "Desktop operation stopped.".to_owned())?
}
#[tauri::command]
async fn desktop_ready(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Invalid startup window.".into());
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window.as_ref().set_focus().map_err(|e| e.to_string())?;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = handle
            .state::<Desktop>()
            .bridge
            .call(&handle, "desktop-ready", json!([]))
            .await;
        if let Err(error) = result {
            let _ = handle.emit_to("main", "host-error", error);
        }
    });
    edge::create(&app)?;
    Ok(())
}
#[tauri::command]
async fn save_audio_buffer(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Audio belongs to the main window.".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Send binary audio.".into());
    };
    if bytes.is_empty() || bytes.len() > 512_000_000 {
        return Err("Invalid audio size.".into());
    }
    let extension = request
        .headers()
        .get("x-audio-extension")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("webm")
        .trim_start_matches('.');
    if !["webm", "wav", "mp4", "m4a", "ogg", "mp3", "flac"].contains(&extension) {
        return Err("Unsupported audio type.".into());
    }
    let root = paths::profile()?.join("runtime/temp");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.join(format!(
        "recording-{}-{}.{}",
        std::process::id(),
        app.state::<Desktop>()
            .sequence
            .fetch_add(1, Ordering::Relaxed),
        extension
    ));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.as_ref().set_focus();
        let _ = window.emit("window-visibility", true);
    }
}
fn quit(app: tauri::AppHandle) {
    if app
        .state::<Desktop>()
        .quitting
        .swap(true, Ordering::Relaxed)
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let result = async {
            frontend(&app, "main", "flush", json!([])).await?;
            app.state::<Desktop>()
                .bridge
                .call(&app, "close", json!([]))
                .await
        }
        .await;
        if let Err(error) = result {
            app.state::<Desktop>()
                .quitting
                .store(false, Ordering::Relaxed);
            show(&app);
            let _ = app.emit_to(
                "main",
                "host-error",
                format!("Could not save before quitting: {error}"),
            );
            return;
        }
        app.state::<Desktop>().bridge.stop();
        app.exit(0);
    });
}
fn main() {
    let mut context = tauri::generate_context!();
    // An explicitly selected profile has its own instance lock (also used by isolated tests).
    if let Some(profile) = std::env::var_os("LOCALFLOW_USER_DATA") {
        use sha2::{Digest, Sha256};
        let path = std::path::PathBuf::from(profile);
        std::fs::create_dir_all(&path).expect("Could not create LocalFlow profile");
        let selected = path
            .canonicalize()
            .expect("Could not resolve LocalFlow profile");
        let normal = std::env::var_os("APPDATA")
            .map(|root| std::path::PathBuf::from(root).join("localflow"))
            .and_then(|path| path.canonicalize().ok());
        if normal.as_ref() != Some(&selected) {
            let hash = format!(
                "{:x}",
                Sha256::digest(selected.to_string_lossy().to_lowercase().as_bytes())
            );
            context
                .config_mut()
                .identifier
                .push_str(&format!(".profile{}", &hash[..16]));
        }
    }
    let desktop = Desktop {
        bridge: bridge::Bridge::new(),
        pending: Mutex::new(HashMap::new()),
        sequence: AtomicU64::new(1),
        quitting: std::sync::atomic::AtomicBool::new(false),
        edge: Mutex::new(json!({})),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_clipboard_manager::init())
        .manage(desktop)
        .register_uri_scheme_protocol("localflow-asset", |_, request| assets::response(request))
        .invoke_handler(tauri::generate_handler![host_call, native_call, frontend_reply, desktop_ready, save_audio_buffer, uploads::upload_note_assets])
        .setup(|app| {
            let theme = native::theme()?;
            let initialization = format!("window.__LOCALFLOW_THEME={};", serde_json::to_string(&theme)?);
            let preferences:Value=std::fs::read(paths::profile()?.join("ui-settings.json")).ok().and_then(|bytes|serde_json::from_slice(&bytes).ok()).unwrap_or(json!({}));
            let preferences=format!("try{{if(!localStorage.getItem('localflow.native-settings-migrated')){{for(const[k,v]of Object.entries({preferences}))if(k.startsWith('localflow.')&&typeof v==='string'&&localStorage.getItem(k)===null)localStorage.setItem(k,v);localStorage.setItem('localflow.native-settings-migrated','1');}}}}catch{{}}");
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .data_directory(paths::webview()?)
                .title("LocalFlow").inner_size(1240., 860.).min_inner_size(1060., 720.)
                .visible(false).transparent(true).decorations(false).initialization_script(&initialization).initialization_script(&preferences)
                .on_navigation(|url| url.host_str()==Some("tauri.localhost")||url.scheme()=="tauri"||(cfg!(debug_assertions)&&matches!(url.host_str(),Some("localhost")|Some("127.0.0.1"))))
                .background_color(tauri::window::Color(0, 0, 0, 0)).build()?;
            native::appearance(&window, &theme)?;
            native::microphone(&window)?;
            let show_item = MenuItem::with_id(app, "show", "Show LocalFlow", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            TrayIconBuilder::new().icon(tauri::image::Image::from_bytes(include_bytes!("../../assets/localflow-logo-32.png"))?).tooltip("LocalFlow")
                .menu(&menu).on_menu_event(|app, event| match event.id.as_ref() { "show" => show(app), "quit" => quit(app.clone()), _ => {} }).build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if matches!(event,tauri::WindowEvent::Moved(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
                    let _ = edge::update(window.app_handle(), json!({}));
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event { if !window.state::<Desktop>().quitting.load(Ordering::Relaxed) { api.prevent_close(); let _ = window.hide(); let _ = window.emit("window-visibility", false); } }
                if let tauri::WindowEvent::Focused(true) = event { let _ = window.emit("window-visibility", true); }
                if let tauri::WindowEvent::Focused(false) = event {
                    let app=window.app_handle().clone();tauri::async_runtime::spawn(async move{let _=app.state::<Desktop>().bridge.call(&app,"set-shortcut-capture",json!([false])).await;});
                }
            }
        })
        .build(context).expect("Could not initialize LocalFlow")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event { if !app.state::<Desktop>().quitting.load(Ordering::Relaxed) { api.prevent_exit(); quit(app.clone()); } }
            if let tauri::RunEvent::Exit = event { app.state::<Desktop>().bridge.stop(); }
        });
}
