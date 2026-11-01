use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

#[derive(Deserialize)]
struct FileInfo {
    name: String,
    size: usize,
}

fn save(root: &Path, files: &[FileInfo], bytes: &[u8]) -> Result<Value, String> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    if files.is_empty()
        || files.len() > 30
        || bytes.len() > 150_000_000
        || files
            .iter()
            .any(|file| file.size == 0 || file.size > 50_000_000)
        || files.iter().map(|file| file.size).sum::<usize>() != bytes.len()
    {
        return Err("Choose 1–30 files, at most 50 MB each and 150 MB together.".into());
    }
    let names: Vec<String> = files
        .iter()
        .map(|file| {
            let base = file.name.rsplit(['/', '\\']).next().unwrap_or("");
            let mut units = 0;
            let mut chars: Vec<char> = base
                .chars()
                .rev()
                .take_while(|c| {
                    units += c.len_utf16();
                    units <= 180
                })
                .collect();
            chars.reverse();
            let name: String = chars
                .into_iter()
                .map(|c| {
                    if c.is_control() || "<>:\"/\\|?*".contains(c) {
                        '_'
                    } else {
                        c
                    }
                })
                .collect();
            if name.trim().is_empty() || name == "." || name == ".." {
                Err("Invalid filename.".to_owned())
            } else {
                Ok(name)
            }
        })
        .collect::<Result<_, _>>()?;
    let mut offset = 0;
    let mut assets = Vec::with_capacity(files.len());
    for (file, name) in files.iter().zip(names) {
        let data = &bytes[offset..offset + file.size];
        offset += file.size;
        let id = format!("{:x}", Sha256::digest(data))[..32].to_owned();
        let directory = root.join(&id);
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join(&name);
        let temporary = directory.join(format!(
            ".upload-{}-{}.tmp",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let result = (|| -> std::io::Result<()> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(data)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temporary, &path)
        })();
        if let Err(error) = result {
            let _ = std::fs::remove_file(&temporary);
            return Err(error.to_string());
        }
        let encoded =
            percent_encoding::utf8_percent_encode(&name, percent_encoding::NON_ALPHANUMERIC);
        assets.push(json!({"name":name,"url":format!("localflow-asset://{id}/{encoded}"),"mime":crate::assets::mime(&path),"size":file.size}));
    }
    Ok(json!(assets))
}

#[tauri::command]
pub async fn upload_note_assets(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Uploads belong to the main window.".into());
    }
    let header = request
        .headers()
        .get("x-asset-files")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= 128_000)
        .ok_or("Missing asset manifest.")?;
    let header = percent_encoding::percent_decode_str(header)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let files: Vec<FileInfo> = serde_json::from_str(&header).map_err(|e| e.to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Send binary files.".into());
    };
    if bytes.len() > 150_000_000 {
        return Err("Files must total at most 150 MB.".into());
    }
    let root = crate::paths::profile()?.join("notes/imports");
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || save(&root, &files, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binary_identity_limits_and_unicode() {
        let root =
            std::env::temp_dir().join(format!("localflow-upload-test-{}", std::process::id()));
        let files = [FileInfo {
            name: "../日本語 العربية.png".into(),
            size: 4,
        }];
        let first = save(&root, &files, &[1, 2, 3, 4]).unwrap();
        assert_eq!(first, save(&root, &files, &[1, 2, 3, 4]).unwrap());
        assert_eq!(first[0]["name"], "日本語 العربية.png");
        assert!(first[0]["url"]
            .as_str()
            .unwrap()
            .starts_with("localflow-asset://9f64a747e1b97f131fabb6b447296c9b/"));
        assert!(save(&root, &files, &[1]).is_err());
        assert!(save(&root, &[], &[]).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
