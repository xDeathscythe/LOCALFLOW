use std::{
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
use tauri::http::{Request, Response};

pub fn mime(file: &Path) -> &'static str {
    match file
        .extension()
        .and_then(|value| value.to_str())
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
        _ => "application/octet-stream",
    }
}

fn file_path(uri: &str) -> Result<PathBuf, String> {
    let url = tauri::Url::parse(uri).map_err(|e| e.to_string())?;
    let path = percent_encoding::percent_decode_str(url.path())
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let (id, relative) = path
        .trim_start_matches('/')
        .split_once('/')
        .ok_or("Invalid asset URL")?;
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
    Ok(file)
}

fn range(value: &str, length: u64) -> Result<(u64, u64), ()> {
    let (start, end) = value
        .strip_prefix("bytes=")
        .and_then(|value| value.split_once('-'))
        .ok_or(())?;
    if length == 0 {
        return Err(());
    }
    if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        return Ok((length.saturating_sub(suffix), length - 1));
    }
    let start = start.parse::<u64>().map_err(|_| ())?;
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(length - 1)
    };
    if start >= length || end < start {
        return Err(());
    }
    Ok((start, end))
}

fn serve(request: &Request<Vec<u8>>, path: &Path) -> Result<Response<Vec<u8>>, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let length = metadata.len();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let etag = format!("\"{length:x}-{modified:x}\"");
    let response = Response::builder()
        .header("Content-Type", mime(path))
        .header("Access-Control-Allow-Origin", "http://tauri.localhost")
        .header(
            "Access-Control-Expose-Headers",
            "ETag, Content-Range, Accept-Ranges",
        )
        .header("Content-Security-Policy", "default-src 'none'")
        .header("X-Content-Type-Options", "nosniff")
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "private, max-age=0, must-revalidate")
        .header("ETag", &etag);
    if request.method() == "OPTIONS" {
        return response
            .status(204)
            .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            .header(
                "Access-Control-Allow-Headers",
                "Range, If-Range, If-None-Match",
            )
            .body(Vec::new())
            .map_err(|e| e.to_string());
    }
    if request.method() != "GET" && request.method() != "HEAD" {
        return response
            .status(405)
            .body(Vec::new())
            .map_err(|e| e.to_string());
    }
    if request
        .headers()
        .get("if-none-match")
        .and_then(|value| value.to_str().ok())
        == Some(etag.as_str())
    {
        return response
            .status(304)
            .body(Vec::new())
            .map_err(|e| e.to_string());
    }
    let requested = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok())
        .filter(|_| {
            request
                .headers()
                .get("if-range")
                .is_none_or(|value| value.to_str().ok() == Some(etag.as_str()))
        });
    let mut response = response;
    let (start, size) = if let Some(value) = requested {
        match range(value, length) {
            Ok((start, end)) => {
                response = response
                    .status(206)
                    .header("Content-Range", format!("bytes {start}-{end}/{length}"));
                (start, end - start + 1)
            }
            Err(()) => {
                return response
                    .status(416)
                    .header("Content-Range", format!("bytes */{length}"))
                    .body(Vec::new())
                    .map_err(|e| e.to_string())
            }
        }
    } else {
        (0, length)
    };
    let mut bytes = Vec::new();
    if request.method() != "HEAD" {
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        file.take(size)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
    }
    response
        .header("Content-Length", size.to_string())
        .body(bytes)
        .map_err(|e| e.to_string())
}

pub fn response(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    file_path(&request.uri().to_string())
        .and_then(|path| serve(&request, &path))
        .unwrap_or_else(|_| Response::builder().status(404).body(Vec::new()).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn byte_ranges_and_cache() {
        assert_eq!(range("bytes=-3", 10), Ok((7, 9)));
        assert_eq!(range("bytes=2-99", 10), Ok((2, 9)));
        assert!(range("bytes=10-", 10).is_err());
        assert!(range("bytes=0-1,3-4", 10).is_err());
        let path =
            std::env::temp_dir().join(format!("localflow-range-test-{}.bin", std::process::id()));
        std::fs::write(&path, b"0123456789").unwrap();
        let request = Request::builder()
            .header("Range", "bytes=2-4")
            .body(Vec::new())
            .unwrap();
        let response = serve(&request, &path).unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), b"234");
        let cached = Request::builder()
            .header("If-None-Match", response.headers()["ETag"].clone())
            .body(Vec::new())
            .unwrap();
        assert_eq!(serve(&cached, &path).unwrap().status(), 304);
        std::fs::remove_file(path).unwrap();
    }
}
