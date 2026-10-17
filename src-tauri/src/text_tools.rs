use serde_json::{json, Value};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub fn is_window(label: &str) -> bool {
    matches!(label, "text-capture" | "text-toast")
}
fn close(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) { let _ = window.destroy(); }
}
fn point() -> (i32, i32) {
    let mut p = windows::Win32::Foundation::POINT::default();
    unsafe { let _ = windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut p); }
    (p.x, p.y)
}

// UI Automation reads only the explicit selection. Password controls are excluded.
fn selection(x: i32, y: i32) -> windows::core::Result<String> {
    use windows::{core::Interface, Win32::{System::Com::*, UI::Accessibility::*, Foundation::POINT}};
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let result = (|| {
            let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let walker = automation.ControlViewWalker()?;
            let mut element = automation.ElementFromPoint(POINT { x, y })?;
            for _ in 0..8 {
                if element.CurrentIsPassword()?.as_bool() { return Ok(String::new()); }
                if let Ok(pattern) = element.GetCurrentPattern(UIA_TextPatternId) {
                    if let Ok(text) = pattern.cast::<IUIAutomationTextPattern>() {
                        let ranges = text.GetSelection()?;
                        let mut result = Vec::new();
                        for i in 0..ranges.Length()?.min(32) {
                            let value = ranges.GetElement(i)?.GetText(100000)?.to_string();
                            if !value.is_empty() { result.push(value); }
                        }
                        if !result.is_empty() { return Ok(result.join("\n")); }
                    }
                }
                element = walker.GetParentElement(&element)?;
            }
            Ok(String::new())
        })();
        CoUninitialize();
        result
    }
}

fn open(app: &tauri::AppHandle, mut value: Value) -> Result<Value, String> {
    let mode = value["mode"].as_str().unwrap_or("menu").to_owned();
    if mode == "board" {
        app.emit_to("main","scrub-board-open",value["text"].as_str().unwrap_or("")).map_err(|e|e.to_string())?;
        crate::show(app);
        return Ok(Value::Null);
    }
    if mode == "menu" { crate::text_context::popup(app, value["text"].as_str().unwrap_or("").to_owned())?; return Ok(Value::Null); }
    value["theme"] = json!(crate::native::theme()?);
    let label = match mode.as_str() { "capture" => "text-capture", "toast" => "text-toast", _ => return Err("Unknown text window.".into()) };
    if app.get_webview_window(label).is_some() {
        return Ok(Value::Null);
    }
    let (x,y) = point();
    let main = app.get_webview_window("main").ok_or("Window unavailable")?;
    let monitors = main.available_monitors().map_err(|e|e.to_string())?;
    let monitor = monitors.iter().find(|m| { let p=m.position(); let s=m.size(); x>=p.x && x<p.x+s.width as i32 && y>=p.y && y<p.y+s.height as i32 }).or(monitors.first()).ok_or("Display unavailable")?;
    let scale = monitor.scale_factor();
    let (width,height) = match mode.as_str() { "capture" => (monitor.size().width,monitor.size().height), _ => ((52.*scale) as u32,(52.*scale) as u32) };
    let (width,height) = (width.min(monitor.size().width),height.min(monitor.size().height));
    let p=monitor.position(); let s=monitor.size();
    let (left,top) = if mode == "capture" { (p.x,p.y) } else {
        ((x+18).clamp(p.x,p.x+(s.width-width) as i32),(y+16).clamp(p.y,p.y+(s.height-height) as i32))
    };
    if mode == "capture" { value["capture"] = crate::capture::capture(app,&json!({"x":x,"y":y,"fullResolution":true}))?; }
    let window = WebviewWindowBuilder::new(app,label,WebviewUrl::App("text-tools.html".into()))
        .data_directory(crate::paths::webview()?).title("LocalFlow text tools")
        .visible(false).decorations(false).transparent(true).shadow(false).resizable(false)
        .always_on_top(true).skip_taskbar(true).focused(mode=="capture")
        .initialization_script(format!("window.TEXT_TOOLS={};", value))
        .on_navigation(|url| url.host_str()==Some("tauri.localhost")||url.scheme()=="tauri")
        .build().map_err(|e|e.to_string())?;
    window.set_size(PhysicalSize::new(width,height)).map_err(|e|e.to_string())?;
    window.set_position(PhysicalPosition::new(left,top)).map_err(|e|e.to_string())?;
    if mode=="toast" { window.set_ignore_cursor_events(true).map_err(|e|e.to_string())?; }
    window.show().map_err(|e|e.to_string())?;
    if mode=="capture" { window.set_focus().map_err(|e|e.to_string())?; }
    Ok(Value::Null)
}

pub async fn dispatch(app: &tauri::AppHandle, method: &str, value: Value) -> Result<Value,String> {
    match method {
        "text-tools-selection" => {
            if app.get_webview_window("text-capture").is_some() { return Ok(Value::Null); }
            let x=value["x"].as_i64().ok_or("Missing pointer")? as i32;
            let y=value["y"].as_i64().ok_or("Missing pointer")? as i32;
            let text=tauri::async_runtime::spawn_blocking(move || selection(x,y).unwrap_or_default()).await.map_err(|e|e.to_string())?;
            if !text.trim().is_empty() && text.len()<=400000 { open(app,json!({"mode":"menu","text":text}))?; }
            Ok(Value::Null)
        }
        "text-tools-open" => open(app,value),
        "text-tools-close" => { let label=value.as_str().ok_or("Missing window")?; if !is_window(label) { return Err("Invalid window".into()); } close(app,label); Ok(Value::Null) }
        "text-tools-recognize" => tauri::async_runtime::spawn_blocking(move || crate::screen_text::recognize(&value)).await.map_err(|e|e.to_string())?,
        "text-tools-run" => app.state::<crate::Desktop>().bridge.call(app,"text-tools-run",json!([value])).await,
        "text-tools-copy" => {
            let text=value.as_str().filter(|s|!s.trim().is_empty()&&s.len()<=400000).ok_or("No readable text was returned. Clipboard unchanged.")?;
            app.clipboard().write_text(text).map_err(|e|e.to_string())?;
            close(app,"text-toast");
            open(app,json!({"mode":"toast"}))
        }
        _ => Err("Unknown text operation".into()),
    }
}
