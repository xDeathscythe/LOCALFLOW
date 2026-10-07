use serde_json::Value;

pub fn apply(window: &tauri::WebviewWindow, value: &Value) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::{Foundation::POINT, Graphics::Gdi::*};
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let coordinate = |value: &Value| -> Result<i32, String> {
            let number = value.as_f64().ok_or("Invalid edge geometry")?;
            if !number.is_finite() || !(-400.0..=1200.0).contains(&number) {
                return Err("Invalid edge geometry".into());
            }
            Ok((number * scale).round() as i32)
        };
        let polygon = value["polygon"].as_array().ok_or("Missing edge geometry")?;
        if !(3..=128).contains(&polygon.len()) { return Err("Invalid edge geometry".into()); }
        let points = polygon.iter().map(|point| Ok(POINT { x:coordinate(&point[0])?, y:coordinate(&point[1])? }))
            .collect::<Result<Vec<_>, String>>()?;
        let sheet = &value["sheet"];
        let bounds = if sheet.is_object() {
            Some((coordinate(&sheet["left"])?, coordinate(&sheet["top"])?, coordinate(&sheet["right"])?, coordinate(&sheet["bottom"])?, coordinate(&sheet["radiusX"])?, coordinate(&sheet["radiusY"])?))
        } else { None };
        let region = CreatePolygonRgn(&points, WINDING);
        if region.is_invalid() { return Err("Could not shape the notch".into()); }
        if let Some((left, top, right, bottom, radius_x, radius_y)) = bounds {
            let card = CreateRoundRectRgn(left, top, right + 1, bottom + 1, radius_x, radius_y);
            if card.is_invalid() { let _ = DeleteObject(region.into()); return Err("Could not shape the meeting panel".into()); }
            CombineRgn(Some(region), Some(region), Some(card), RGN_OR);
            let _ = DeleteObject(card.into());
        }
        // Windows owns the successful region. Geometry changes, never HWND bounds per frame.
        if SetWindowRgn(hwnd, Some(region), false) == 0 {
            let _ = DeleteObject(region.into());
            return Err("Could not update the notch hit area".into());
        }
    }
    Ok(())
}
