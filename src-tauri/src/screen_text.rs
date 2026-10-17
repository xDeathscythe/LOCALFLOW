use base64::Engine;
use serde_json::{json, Value};
use windows::{Globalization::Language, Graphics::Imaging::*, Media::Ocr::OcrEngine, Storage::Streams::DataWriter};

// Windows supplies word geometry; selection is ordinary browser text selection.
pub fn recognize(value: &Value) -> Result<Value, String> {
    let data = value["image"].as_str().filter(|s| s.len() <= 32_000_000).ok_or("Invalid screen image")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    let source = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    let result = (|| -> windows::core::Result<Value> {
        let limit = OcrEngine::MaxImageDimension()?;
        let picture = if source.width().max(source.height()) > limit { source.resize(limit, limit, image::imageops::FilterType::Triangle) } else { source };
        let (width, height) = (picture.width(), picture.height());
        let mut pixels = picture.to_rgba8().into_raw();
        for pixel in pixels.chunks_exact_mut(4) { pixel.swap(0, 2); }
        let writer = DataWriter::new()?;
        writer.WriteBytes(&pixels)?;
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(&writer.DetachBuffer()?, BitmapPixelFormat::Bgra8, width as i32, height as i32, BitmapAlphaMode::Ignore)?;
        let engine = if let Some(language) = value["language"].as_str().filter(|s| !s.is_empty()) {
            OcrEngine::TryCreateFromLanguage(&Language::CreateLanguage(&language.into())?)?
        } else { OcrEngine::TryCreateFromUserProfileLanguages()? };
        let recognized = engine.RecognizeAsync(&bitmap)?.join()?;
        let mut lines = Vec::new();
        for line in recognized.Lines()? {
            let mut words = Vec::new();
            for word in line.Words()? {
                let rect = word.BoundingRect()?;
                words.push(json!({"text":word.Text()?.to_string(),"x":rect.X,"y":rect.Y,"width":rect.Width,"height":rect.Height}));
            }
            lines.push(json!({"text":line.Text()?.to_string(),"words":words}));
        }
        let mut languages = Vec::new();
        for language in OcrEngine::AvailableRecognizerLanguages()? {
            languages.push(json!({"id":language.LanguageTag()?.to_string(),"name":language.NativeName()?.to_string()}));
        }
        Ok(json!({"width":width,"height":height,"lines":lines,"language":engine.RecognizerLanguage()?.LanguageTag()?.to_string(),"languages":languages}))
    })();
    result.map_err(|e| format!("Windows text recognition is unavailable. Check the OCR language packs in Windows Settings. {e}"))
}
