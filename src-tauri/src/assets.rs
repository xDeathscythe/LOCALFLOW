use std::path::PathBuf;
use tauri::http::{Request, Response};
pub fn response(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let load = || -> Result<(Vec<u8>, &'static str), String> {
        let url = tauri::Url::parse(&request.uri().to_string()).map_err(|e| e.to_string())?;
        let path = percent_encoding::percent_decode_str(url.path())
            .decode_utf8()
            .map_err(|e| e.to_string())?;
        let path = path.trim_start_matches('/');
        let (id, relative) = path.split_once('/').ok_or("Invalid asset URL")?;
        if id.len() != 32
            || !id
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Err("Invalid asset ID".into());
        }
        let notes = crate::paths::profile()?.join("notes/imports");
        let locations: serde_json::Value = std::fs::read(notes.join("locations.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let base = locations[id]
            .as_str()
            .map(PathBuf::from)
            .unwrap_or(notes.join(id))
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let file = base
            .join(relative)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !file.starts_with(&base) || !file.is_file() {
            return Err("Asset not found".into());
        }
        let mime = match file
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "avif" => "image/avif",
            "svg" => "image/svg+xml",
            "mp4" => "video/mp4",
            "mov" => "video/quicktime",
            "webm" => "video/webm",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" => "audio/ogg",
            "pdf" => "application/pdf",
            "csv" => "text/csv",
            "txt" => "text/plain",
            _ => return Err("Unsupported asset type".into()),
        };
        Ok((std::fs::read(file).map_err(|e| e.to_string())?, mime))
    };
    match load() {
        Ok((bytes, mime)) => Response::builder()
            .header("Content-Type", mime)
            .header("Access-Control-Allow-Origin", "http://tauri.localhost")
            .header("Content-Security-Policy", "default-src 'none'")
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes)
            .unwrap(),
        Err(_) => Response::builder().status(404).body(Vec::new()).unwrap(),
    }
}
