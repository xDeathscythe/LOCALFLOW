use serde_json::json;
use std::sync::Mutex;
use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem}, Emitter, Manager};
use windows::core::{Interface, HSTRING, PWSTR};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler};

#[derive(Default)]
struct Selection(Mutex<Option<(Menu<tauri::Wry>, String)>>);

pub fn perform(app: &tauri::AppHandle, action: &str, text: String) {
    let app = app.clone(); let action = action.to_owned();
    tauri::async_runtime::spawn(async move {
        let result = async {
            if action == "board" {
                return crate::text_tools::dispatch(&app,"text-tools-open",json!({"mode":"board","text":text})).await;
            }
            let text = if action == "grammar" {
                app.emit_to("main", "text-tools-status", "Checking grammar…").map_err(|e| e.to_string())?;
                app.state::<crate::Desktop>().bridge.call(&app,"text-tools-run",json!([{"action":"grammar","text":text,"owner":"text-context"}])).await?
            } else { json!(text) };
            crate::text_tools::dispatch(&app,"text-tools-copy",text).await
        }.await;
        let error = result.err();
        if error.is_some() { crate::show(&app); }
        let _ = app.emit_to("main","text-tools-status",error.unwrap_or_default());
    });
}

pub fn popup(app: &tauri::AppHandle, text: String) -> Result<(), String> {
    let copy = MenuItem::with_id(app,"text-copy","Copy",true,None::<&str>).map_err(|e|e.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|e|e.to_string())?;
    let grammar = MenuItem::with_id(app,"text-grammar","LocalFlow Grammar check",true,None::<&str>).map_err(|e|e.to_string())?;
    let board = MenuItem::with_id(app,"text-board","Send to LocalFlow Scrub board",true,None::<&str>).map_err(|e|e.to_string())?;
    let menu = Menu::with_items(app,&[&copy,&separator,&grammar,&board]).map_err(|e|e.to_string())?;
    *app.state::<Selection>().0.lock().unwrap() = Some((menu.clone(),text));
    app.get_webview_window("main").ok_or("Window unavailable")?.popup_menu(&menu).map_err(|e|e.to_string())
}

pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    app.manage(Selection::default());
    app.on_menu_event(|app,event| {
        let action = match event.id().as_ref() { "text-copy"=>"copy", "text-grammar"=>"grammar", "text-board"=>"board", _=>return };
        let selected = app.state::<Selection>().0.lock().unwrap().take();
        if let Some((_,text)) = selected { perform(app,action,text); }
    });
    window.with_webview(move |platform| unsafe {
        let setup = || -> windows::core::Result<()> {
            let view = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_11>()?;
            let environment = platform.environment().cast::<ICoreWebView2Environment9>()?;
            let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let target = args.ContextMenuTarget()?;
                let mut selected = windows::core::BOOL(0); target.HasSelection(&mut selected)?;
                if !selected.as_bool() { return Ok(()) }
                let mut raw = PWSTR::null(); target.SelectionText(&mut raw)?;
                let text = raw.to_string().unwrap_or_default();
                windows::Win32::System::Com::CoTaskMemFree(Some(raw.0 as _));
                if text.trim().is_empty() || text.len()>400000 { return Ok(()) }
                let items = args.MenuItems()?; let mut count = 0; items.Count(&mut count)?;
                let separator = environment.CreateContextMenuItem(&HSTRING::new(),None,COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR)?;
                items.InsertValueAtIndex(count,&separator)?; count+=1;
                for (action,label) in [("grammar","LocalFlow Grammar check"),("board","Send to LocalFlow Scrub board")] {
                    let item = environment.CreateContextMenuItem(&HSTRING::from(label),None,COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
                    let app=app.clone(); let text=text.clone();
                    let callback=CustomItemSelectedEventHandler::create(Box::new(move |_,_| {perform(&app,action,text.clone());Ok(())}));
                    let mut token=0; item.add_CustomItemSelected(&callback,&mut token)?;
                    items.InsertValueAtIndex(count,&item)?; count+=1;
                }
                Ok(())
            }));
            let mut token=0; view.add_ContextMenuRequested(&handler,&mut token)?;
            Ok(())
        };
        if let Err(error)=setup() { eprintln!("Text context menu: {error}"); }
    }).map_err(|e|e.to_string())
}
