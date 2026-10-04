import { join } from 'node:path';
import { readJsonFile, writeJsonFile } from '../niwa/host/niwa-store.mjs';

export function pageHistory(root) {
  const file = id => {
    if (!/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid note ID.');
    return join(root, `history-${id}.json`);
  };
  const read = id => readJsonFile(file(id), []);
  return {
    read,
    remember(note) {
      const versions = read(note.id);
      if (versions.at(-1)?.revision === note.revision) return;
      const { children, path, ...snapshot } = note;
      if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 8_000_000) return;
      versions.push(snapshot);
      // Bound autosave history on disk; current page and manual exports are separate.
      const sizes = versions.map(value => Buffer.byteLength(JSON.stringify(value), 'utf8') + 1);
      let bytes = sizes.reduce((total, size) => total + size, 1);
      while (versions.length > 20 || (versions.length > 1 && bytes > 8_000_000)) { versions.shift(); bytes -= sizes.shift(); }
      writeJsonFile(file(note.id), versions);
    },
  };
}
