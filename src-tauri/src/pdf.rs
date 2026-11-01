use serde_json::{json, Value};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(windows)]
pub async fn export(app: &tauri::AppHandle, value: Value) -> Result<Value, String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler,
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};
    let html = value["html"]
        .as_str()
        .filter(|html| html.len() <= 10_000_000)
        .ok_or("Invalid PDF content")?
        .to_owned();
    let path = value["path"].as_str().ok_or("Invalid PDF path")?.to_owned();
    if app.get_webview_window("pdf").is_some() {
        return Err("A PDF export is already running.".into());
    }
    let window = WebviewWindowBuilder::new(
        app,
        "pdf",
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .data_directory(crate::paths::webview()?)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let target = path.clone();
    window
        .with_webview(move |platform| {
            let send = std::sync::Arc::new(std::sync::Mutex::new(Some(send)));
            let perform = || -> windows::core::Result<()> {
                unsafe {
                    let view = platform.controller().CoreWebView2()?;
                    view.Settings()?.SetIsScriptEnabled(false)?;
                    let web = view.clone();
                    let reply = send.clone();
                    let completion =
                        NavigationCompletedEventHandler::create(Box::new(move |_, navigation| {
                            let started = (|| -> windows::core::Result<()> {
                                let success =
                                    navigation.ok_or_else(windows::core::Error::from_thread)?;
                                let mut ok = windows::core::BOOL(0);
                                success.IsSuccess(&mut ok)?;
                                if !ok.as_bool() {
                                    return Err(windows::core::Error::from_thread());
                                }
                                let environment = web
                                    .cast::<ICoreWebView2_2>()?
                                    .Environment()?
                                    .cast::<ICoreWebView2Environment6>()?;
                                let settings = environment.CreatePrintSettings()?;
                                if value["landscape"] == true {
                                    settings
                                        .SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE)?;
                                }
                                settings.SetShouldPrintBackgrounds(true)?;
                                let reply = reply.clone();
                                let callback = PrintToPdfCompletedHandler::create(Box::new(
                                    move |result, ok| {
                                        if let Some(send) = reply.lock().unwrap().take() {
                                            let _ = send.send(
                                                result.map_err(|e| e.to_string()).and_then(|_| {
                                                    if ok {
                                                        Ok(())
                                                    } else {
                                                        Err("PDF export failed.".into())
                                                    }
                                                }),
                                            );
                                        }
                                        Ok(())
                                    },
                                ));
                                web.cast::<ICoreWebView2_7>()?.PrintToPdf(
                                    &HSTRING::from(&target),
                                    &settings,
                                    &callback,
                                )?;
                                Ok(())
                            })();
                            if let Err(error) = started {
                                if let Some(send) = reply.lock().unwrap().take() {
                                    let _ = send.send(Err(error.to_string()));
                                }
                            }
                            Ok(())
                        }));
                    let mut token = 0;
                    view.add_NavigationCompleted(&completion, &mut token)?;
                    view.NavigateToString(&HSTRING::from(html))?;
                    Ok(())
                }
            };
            if let Err(error) = perform() {
                if let Some(send) = send.lock().unwrap().take() {
                    let _ = send.send(Err(error.to_string()));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), receive).await;
    let _ = window.close();
    result
        .map_err(|_| "PDF export timed out")?
        .map_err(|e| e.to_string())??;
    Ok(json!(path))
}
#[cfg(not(windows))]
pub async fn export(_: &tauri::AppHandle, _: Value) -> Result<Value, String> {
    Err("PDF export is not available on this platform.".into())
}
