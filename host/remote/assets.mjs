import { open, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assetPaths from '../notes/asset-path.cjs';

export async function readNoteAsset({ directory, notes, noteId, url, offset = 0, etag: expected }) {
  if (!directory || typeof url !== 'string' || url.length > 4096) throw new Error('Invalid asset request.');
  const note = await notes.syncRead(noteId);
  if (!JSON.stringify(note).includes(url)) throw new Error('Asset is not referenced by this note.');
  const root = join(directory, 'notes'), parsed = new URL(url), file = assetPaths.resolveAsset(root, url);
  let locations = {};
  try { locations = JSON.parse(await readFile(join(root, 'imports', 'locations.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const base = await realpath(resolve(locations[parsed.hostname] || join(root, 'imports', parsed.hostname))), resolved = await realpath(file), rel = relative(base, resolved);
  if (!rel || isAbsolute(rel) || rel.split(sep).includes('..')) throw new Error('Asset is outside its imported directory.');
  const info = await stat(resolved), etag = createHash('sha256').update(`${info.size}:${info.mtimeMs}:${info.ino}`).digest('hex');
  if (expected && expected !== etag) throw Object.assign(new Error('Attachment changed. Restart its download.'), { status: 412 });
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= info.size) throw Object.assign(new Error('Invalid attachment offset.'), { status: 416 });
  const handle = await open(resolved, 'r');
  try { const buffer = Buffer.alloc(Math.min(1_048_576, info.size - offset)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); return { name: basename(file), offset, nextOffset: offset + bytesRead, size: info.size, etag, data: buffer.subarray(0, bytesRead).toString('base64') }; }
  finally { await handle.close(); }
}
