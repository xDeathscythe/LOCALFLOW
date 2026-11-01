use std::path::{Path, PathBuf};
use tauri::Manager;
pub fn webview() -> Result<PathBuf, String> {
    Ok(profile()?.join("webview"))
}
pub fn profile() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("LOCALFLOW_USER_DATA") {
        return Ok(path.into());
    }
    std::env::var_os("APPDATA")
        .map(|path| PathBuf::from(path).join("localflow"))
        .ok_or("Windows profile directory is unavailable.".into())
}
pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = std::env::var_os("LOCALFLOW_APP_ROOT") {
        let root = PathBuf::from(root);
        if root.join("desktop/service.cjs").is_file() {
            return Ok(dunce::simplified(&root).to_owned());
        }
        return Err("Invalid LocalFlow runtime directory.".into());
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_owned());
    }
    let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
    if resource.join("desktop/service.cjs").is_file() {
        // Node cannot resolve verbatim Windows paths returned by the native shell.
        return Ok(dunce::simplified(&resource).to_owned());
    }
    Err("LocalFlow runtime payload is missing. Repair the installation.".into())
}
pub fn node(root: &Path) -> Result<PathBuf, String> {
    let bundled = root.join("runtime/node/node.exe");
    if bundled.is_file() {
        return Ok(bundled);
    }
    if cfg!(debug_assertions) {
        return Ok("node.exe".into());
    }
    Err("LocalFlow Node runtime is missing. Run npm run runtime:native before packaging.".into())
}
