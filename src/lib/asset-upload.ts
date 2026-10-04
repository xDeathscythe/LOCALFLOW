import { invoke } from '@tauri-apps/api/core';

export async function uploadAssets(files: { name: string; data: Uint8Array }[]) {
  const total = files.reduce((size, file) => size + file.data.byteLength, 0);
  if (!files.length || files.length > 30 || total > 150_000_000 || files.some(file => !file.data.byteLength || file.data.byteLength > 50_000_000)) throw new Error('Choose 1–30 files, at most 50 MB each and 150 MB together.');
  // ponytail: one binary batch; never expand bytes into JSON numbers.
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const file of files) { bytes.set(file.data, offset); offset += file.data.byteLength; }
  return invoke<{name: string; url: string; mime: string; size: number}[]>('upload_note_assets', bytes.buffer, {
    headers: { 'x-asset-files': encodeURIComponent(JSON.stringify(files.map(file => ({name: file.name, size: file.data.byteLength})))) },
  });
}
