use serde_json::{json, Value};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;

pub fn theme() -> Result<String, String> {
    let file = crate::paths::profile()?.join("appearance.json");
    Ok(std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value["theme"].as_str().map(str::to_owned))
        .filter(|theme| ["dark", "light", "static-black", "static-white"].contains(&theme.as_str()))
        .unwrap_or("dark".into()))
}
pub fn appearance(window: &WebviewWindow, theme: &str) -> Result<(), String> {
    let glass = matches!(theme, "dark" | "light");
    let light = matches!(theme, "light" | "static-white");
    window
        .set_background_color(Some(if glass {
            tauri::window::Color(0, 0, 0, 0)
        } else if light {
            tauri::window::Color(255, 255, 255, 255)
        } else {
            tauri::window::Color(0, 0, 0, 255)
        }))
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE,
            DWMWCP_ROUND,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let dark = i32::from(!light);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark as *const _ as _,
            4,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &DWMWCP_ROUND as *const _ as _,
            4,
        );
        #[repr(C)]
        struct Accent {
            state: i32,
            flags: i32,
            color: u32,
            animation: i32,
        }
        #[repr(C)]
        struct Composition {
            attribute: i32,
            data: *mut std::ffi::c_void,
            size: usize,
        }
        let mut accent = Accent {
            state: if glass { 3 } else { 0 },
            flags: 2,
            color: 0,
            animation: 0,
        };
        let composition = Composition {
            attribute: 19,
            data: &mut accent as *mut _ as _,
            size: std::mem::size_of::<Accent>(),
        };
        use windows::{
            core::{s, w},
            Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
        };
        if let Ok(module) = GetModuleHandleW(w!("user32.dll")) {
            if let Some(address) = GetProcAddress(module, s!("SetWindowCompositionAttribute")) {
                let set: unsafe extern "system" fn(
                    windows::Win32::Foundation::HWND,
                    *const Composition,
                ) -> i32 = std::mem::transmute(address);
                set(hwnd, &composition);
            }
        }
    }
    Ok(())
}
fn text(value: &Value) -> Result<&str, String> {
    value
        .as_str()
        .filter(|v| v.len() <= 2_000_000)
        .ok_or("Invalid text.".into())
}
pub fn microphone(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    window
        .with_webview(|platform| unsafe {
            use webview2_com::{
                Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler,
            };
            let configure = || -> windows::core::Result<()> {
                let view = platform.controller().CoreWebView2()?;
                let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
                    if let Some(args) = args {
                        let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                        args.PermissionKind(&mut kind)?;
                        args.SetState(if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                            COREWEBVIEW2_PERMISSION_STATE_ALLOW
                        } else {
                            COREWEBVIEW2_PERMISSION_STATE_DENY
                        })?;
                    }
                    Ok(())
                }));
                let mut token = 0;
                view.add_PermissionRequested(&handler, &mut token)?;
                Ok(())
            };
            if let Err(error) = configure() {
                eprintln!("Microphone permission setup: {error}");
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub async fn dispatch(app: &tauri::AppHandle, method: &str, args: Value) -> Result<Value, String> {
    let first = &args[0];
    match method {
        "get-appearance" => Ok(json!(theme()?)),
        "set-appearance" => {
            let theme = text(first)?;
            if !["dark", "light", "static-black", "static-white"].contains(&theme) {
                return Err("Unknown appearance theme.".into());
            }
            let root = crate::paths::profile()?;
            std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            let temporary = root.join("appearance.json.tmp");
            std::fs::write(&temporary, json!({"theme":theme}).to_string())
                .map_err(|e| e.to_string())?;
            std::fs::rename(temporary, root.join("appearance.json")).map_err(|e| e.to_string())?;
            appearance(
                &app.get_webview_window("main")
                    .ok_or("Main window unavailable")?,
                theme,
            )?;
            crate::edge::update(app, json!({"theme":theme}))?;
            Ok(json!(theme))
        }
        "window-minimize" => {
            app.get_webview_window("main")
                .ok_or("Window unavailable")?
                .minimize()
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "window-maximize" => {
            let window = app.get_webview_window("main").ok_or("Window unavailable")?;
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "window-hide" => {
            let window = app.get_webview_window("main").ok_or("Window unavailable")?;
            window.hide().map_err(|e| e.to_string())?;
            tauri::Emitter::emit(&window, "window-visibility", false).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "application-quit" => {
            crate::quit(app.clone());
            Ok(Value::Null)
        }
        "open-dialog" => {
            let app = app.clone();
            let value = first.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let mut picker = app
                    .dialog()
                    .file()
                    .set_title(value["title"].as_str().unwrap_or("Choose file"));
                let extensions: Vec<&str> = value["extensions"]
                    .as_array()
                    .map(|values| values.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                if !extensions.is_empty() {
                    picker = picker.add_filter("Files", &extensions);
                }
                let files = if value["directory"] == true {
                    picker.blocking_pick_folder().into_iter().collect()
                } else if value["multiple"] == true {
                    picker.blocking_pick_files().unwrap_or_default()
                } else {
                    picker.blocking_pick_file().into_iter().collect::<Vec<_>>()
                };
                Ok(json!(files
                    .into_iter()
                    .filter_map(|file| file.into_path().ok())
                    .collect::<Vec<_>>()))
            })
            .await
            .map_err(|e| e.to_string())?
        }
        "select-audio-file" => {
            let value = Box::pin(dispatch(app, "open-dialog", json!([{"title":"Choose audio","extensions":["wav","mp3","m4a","mp4","webm","ogg","aac","flac"]}]))).await?;
            Ok(value[0].clone())
        }
        "save-dialog" => {
            let app = app.clone();
            let value = first.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let mut picker = app
                    .dialog()
                    .file()
                    .set_title(value["title"].as_str().unwrap_or("Save file"))
                    .set_file_name(value["defaultName"].as_str().unwrap_or("LocalFlow"));
                let extensions: Vec<&str> = value["extensions"]
                    .as_array()
                    .map(|values| values.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                if !extensions.is_empty() {
                    picker = picker.add_filter("Files", &extensions);
                }
                Ok(picker
                    .blocking_save_file()
                    .and_then(|file| file.into_path().ok())
                    .map(|p| json!(p))
                    .unwrap_or(Value::Null))
            })
            .await
            .map_err(|e| e.to_string())?
        }
        "confirm-model" => {
            let app = app.clone();
            let model = text(first)?.to_owned();
            tauri::async_runtime::spawn_blocking(move || Ok(json!(app.dialog().message(format!("{model} is not installed. Download this model now? The current model remains selected if you cancel.")).title("Download transcription model").buttons(MessageDialogButtons::OkCancel).blocking_show()))).await.map_err(|e| e.to_string())?
        }
        "copy-text" => {
            app.clipboard()
                .write_text(text(first)?)
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "open-url" => {
            let url = text(first)?;
            if !["https:", "http:", "mailto:"]
                .iter()
                .any(|prefix| url.starts_with(prefix))
            {
                return Err("Unsupported link.".into());
            }
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "open-path" => {
            app.opener()
                .open_path(text(first)?, None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(json!(""))
        }
        "reveal-path" => {
            app.opener()
                .reveal_item_in_dir(text(first)?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "capture-screen" => crate::capture::capture(app, first),
        "print-pdf" => crate::pdf::export(app, first.clone()).await,
        "cleanup-transport" => {
            if app.get_webview_window("cleanup").is_none() {
                let desktop = app.state::<crate::Desktop>();
                let id = desktop
                    .sequence
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let (send, receive) = tokio::sync::oneshot::channel();
                desktop
                    .pending
                    .lock()
                    .unwrap()
                    .insert(id, ("cleanup".into(), send));
                let initialization = format!("window.__LOCALFLOW_READY_ID={id};");
                let result = WebviewWindowBuilder::new(
                    app,
                    "cleanup",
                    WebviewUrl::App("cleanup.html".into()),
                )
                .visible(false)
                .initialization_script(initialization)
                .build();
                if let Err(error) = result {
                    desktop.pending.lock().unwrap().remove(&id);
                    return Err(error.to_string());
                }
                let ready = tokio::time::timeout(std::time::Duration::from_secs(20), receive).await;
                desktop.pending.lock().unwrap().remove(&id);
                ready
                    .map_err(|_| "Could not initialize cleanup transport")?
                    .map_err(|e| e.to_string())??;
            }
            crate::frontend(app, "cleanup", text(first)?, args[1].clone()).await
        }
        "cleanup-close" => {
            if let Some(window) = app.get_webview_window("cleanup") {
                window.close().map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "recording-stop" => {
            tauri::Emitter::emit_to(app, "main", "recording-overlay-stop", ())
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "recording-ready" => {
            crate::edge::update(app, json!({}))?;
            Ok(Value::Null)
        }
        "get-edge-settings" | "set-edge-settings" | "edge-ready" | "edge-hover" | "edge-action"
        | "overlay-state" | "agent-state" => crate::edge::dispatch(app, method, first),
        _ => Err("Unknown desktop operation.".into()),
    }
}
