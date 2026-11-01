use serde_json::{json, Value};
use std::{
    fs::{File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::Instant,
};

// PCM is streamed straight to disk; a crash loses at most the unfinished packet.
pub struct ChunkWriter {
    directory: PathBuf,
    session_id: String,
    source: &'static str,
    rate: u32,
    channels: u16,
    max_frames: u64,
    index: u64,
    current: Option<Chunk>,
}

struct Chunk {
    file: File,
    temporary: PathBuf,
    sidecar: PathBuf,
    start_ms: f64,
    frames: u64,
    synced: Instant,
}

fn header(rate: u32, channels: u16, frames: u64) -> [u8; 44] {
    let bytes = (frames * u64::from(channels) * 2) as u32;
    let mut result = [0u8; 44];
    result[0..4].copy_from_slice(b"RIFF");
    result[4..8].copy_from_slice(&(bytes + 36).to_le_bytes());
    result[8..16].copy_from_slice(b"WAVEfmt ");
    result[16..20].copy_from_slice(&16u32.to_le_bytes());
    result[20..22].copy_from_slice(&1u16.to_le_bytes());
    result[22..24].copy_from_slice(&channels.to_le_bytes());
    result[24..28].copy_from_slice(&rate.to_le_bytes());
    result[28..32].copy_from_slice(&(rate * u32::from(channels) * 2).to_le_bytes());
    result[32..34].copy_from_slice(&(channels * 2).to_le_bytes());
    result[34..36].copy_from_slice(&16u16.to_le_bytes());
    result[36..40].copy_from_slice(b"data");
    result[40..44].copy_from_slice(&bytes.to_le_bytes());
    result
}

impl ChunkWriter {
    pub fn new(
        directory: &Path,
        session_id: &str,
        source: &'static str,
        rate: u32,
        channels: u16,
        seconds: u64,
    ) -> Self {
        Self {
            directory: directory.into(),
            session_id: session_id.into(),
            source,
            rate,
            channels,
            max_frames: u64::from(rate) * seconds,
            index: 0,
            current: None,
        }
    }

    fn begin(&mut self, start_ms: f64) -> Result<(), String> {
        let stem = format!(
            "{}-{:06}-{:012}",
            self.source,
            self.index,
            (start_ms * 1000.0).round() as u64
        );
        let temporary = self.directory.join(format!("{stem}.wav.part"));
        let sidecar = self.directory.join(format!("{stem}.wav.part.json"));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(&header(self.rate, self.channels, 0))
            .map_err(|e| e.to_string())?;
        file.sync_data().map_err(|e| e.to_string())?;
        let mut metadata = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&sidecar)
            .map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut metadata, &json!({"sessionId":self.session_id,"source":self.source,"index":self.index,"startMs":start_ms,"sampleRate":self.rate,"channels":self.channels})).map_err(|e| e.to_string())?;
        metadata.sync_all().map_err(|e| e.to_string())?;
        self.current = Some(Chunk {
            file,
            temporary,
            sidecar,
            start_ms,
            frames: 0,
            synced: Instant::now(),
        });
        Ok(())
    }

    pub fn expected_ms(&self) -> Option<f64> {
        self.current
            .as_ref()
            .map(|chunk| chunk.start_ms + chunk.frames as f64 * 1000.0 / f64::from(self.rate))
    }

    pub fn index(&self) -> u64 {
        self.index
    }
    pub fn set_index(&mut self, index: u64) {
        self.index = index;
    }

    pub fn write(&mut self, mut bytes: &[u8], mut start_ms: f64) -> Result<Vec<Value>, String> {
        let align = usize::from(self.channels) * 2;
        if bytes.len() % align != 0 {
            return Err("Audio packet is not frame aligned.".into());
        }
        let mut completed = Vec::new();
        while !bytes.is_empty() {
            if self.current.is_none() {
                self.begin(start_ms)?;
            }
            let chunk = self.current.as_mut().unwrap();
            let frames = (bytes.len() / align).min((self.max_frames - chunk.frames) as usize);
            let length = frames * align;
            chunk
                .file
                .write_all(&bytes[..length])
                .map_err(|e| format!("Cannot save {} audio: {e}", self.source))?;
            chunk.frames += frames as u64;
            if chunk.synced.elapsed().as_secs() >= 1 {
                chunk
                    .file
                    .seek(SeekFrom::Start(0))
                    .map_err(|e| e.to_string())?;
                chunk
                    .file
                    .write_all(&header(self.rate, self.channels, chunk.frames))
                    .map_err(|e| e.to_string())?;
                chunk
                    .file
                    .seek(SeekFrom::End(0))
                    .map_err(|e| e.to_string())?;
                chunk.file.sync_data().map_err(|e| e.to_string())?;
                chunk.synced = Instant::now();
            }
            bytes = &bytes[length..];
            start_ms += frames as f64 * 1000.0 / f64::from(self.rate);
            if chunk.frames == self.max_frames {
                if let Some(value) = self.finish()? {
                    completed.push(value);
                }
            }
        }
        Ok(completed)
    }

    pub fn finish(&mut self) -> Result<Option<Value>, String> {
        let Some(mut chunk) = self.current.take() else {
            return Ok(None);
        };
        chunk
            .file
            .seek(SeekFrom::Start(0))
            .map_err(|e| e.to_string())?;
        chunk
            .file
            .write_all(&header(self.rate, self.channels, chunk.frames))
            .map_err(|e| e.to_string())?;
        chunk.file.sync_all().map_err(|e| e.to_string())?;
        drop(chunk.file);
        let end_ms = chunk.start_ms + chunk.frames as f64 * 1000.0 / f64::from(self.rate);
        let name = format!(
            "{}-{:06}-{:012}-{:012}.wav",
            self.source,
            self.index,
            (chunk.start_ms * 1000.0).round() as u64,
            (end_ms * 1000.0).round() as u64
        );
        let path = self.directory.join(name);
        if path.exists() {
            return Err("A recorded audio chunk already exists; refusing to overwrite it.".into());
        }
        std::fs::rename(&chunk.temporary, &path).map_err(|e| e.to_string())?;
        let value = json!({"type":"chunk","sessionId":self.session_id,"id":format!("{}-{}",self.source,self.index),
            "source":self.source,"index":self.index,"path":path,"startMs":chunk.start_ms,"endMs":end_ms,
            "sampleRate":self.rate,"channels":self.channels,"frames":chunk.frames});
        let mut manifest = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.directory.join("manifest.jsonl"))
            .map_err(|e| e.to_string())?;
        writeln!(manifest, "{value}").map_err(|e| e.to_string())?;
        manifest.sync_all().map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(chunk.sidecar);
        self.index += 1;
        Ok(Some(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_wav_chunks_preserve_samples_and_clock() {
        let root = std::env::temp_dir().join(format!(
            "localflow-wav-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let mut writer = ChunkWriter::new(&root, "test", "remote", 16000, 1, 1);
        let samples = vec![0x36; 48000];
        let mut chunks = writer.write(&samples, 175.0).unwrap();
        chunks.extend(writer.finish().unwrap());
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0]["startMs"], 175.0);
        assert_eq!(chunks[0]["endMs"], 1175.0);
        assert_eq!(chunks[1]["endMs"], 1675.0);
        let mut recovered = Vec::new();
        for chunk in chunks {
            let content = std::fs::read(chunk["path"].as_str().unwrap()).unwrap();
            assert_eq!(&content[..4], b"RIFF");
            assert_eq!(
                u32::from_le_bytes(content[40..44].try_into().unwrap()) as usize,
                content.len() - 44
            );
            recovered.extend_from_slice(&content[44..]);
        }
        assert_eq!(recovered, samples);
        assert_eq!(
            std::fs::read_to_string(root.join("manifest.jsonl"))
                .unwrap()
                .lines()
                .count(),
            2
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
