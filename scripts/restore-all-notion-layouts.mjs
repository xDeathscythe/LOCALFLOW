import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { readNotionDirectory, exportedPage } from '../host/notes/notion-import.mjs';

const [notesRoot, ...flags] = process.argv.slice(2);
if (!notesRoot) throw new Error('Expected notes directory and optional --apply.');
const indexFile = join(notesRoot, 'index.json'), originalIndex = readFileSync(indexFile, 'utf8');
const index = JSON.parse(originalIndex), flatten = items => items.flatMap(item => [item, ...flatten(item.children || [])]);
const existing = new Map(flatten(index.items).map(item => [item.id, item]));
const sources = JSON.parse(readFileSync(join(notesRoot, 'imports', 'locations.json'), 'utf8'));
const writes = [], report = { pages: 0, layouts: 0, databaseLinks: 0, editedStructures: [], staleRevisions: [], applied: flags.includes('--apply') };
for (const [sourceId, sourceRoot] of Object.entries(sources)) {
  const imported = flatten(readNotionDirectory(sourceRoot, sourceId).items);
  const databases = new Map(imported.filter(item => item.kind === 'database' && existing.has(item.id)).map(item => [item.id.slice(7), item]));
  for (const source of imported) {
    const page = existing.get(source.id);
    if (page?.kind !== 'note' || !source.presentation) continue;
    const presentation = { ...source.presentation, ...page.presentation };
    if (JSON.stringify(presentation) !== JSON.stringify(page.presentation)) { page.presentation = presentation; report.pages++; }
    const file = join(notesRoot, 'pages', page.id + '.md.json');
    if (!existsSync(file)) continue;
    const original = readFileSync(file, 'utf8'), rich = JSON.parse(original);
    const markdown = readFileSync(join(notesRoot, 'pages', page.id + '.md'), 'utf8');
    if (createHash('sha256').update(markdown).digest('hex') !== rich.hash) { report.staleRevisions.push(page.id); continue; }
    if (rich.html) {
      const { document } = parseHTML(rich.html);
      let linksChanged = false;
      for (const anchor of document.querySelectorAll('.collection-content a[href]')) {
        const href = anchor.getAttribute('href');
        if (!href.startsWith(`localflow-asset://${sourceId}/`)) continue;
        const database = exportedPage(databases, decodeURIComponent(new URL(href).pathname));
        if (database) { anchor.setAttribute('href', `localflow-note://${database.id}`); report.databaseLinks++; linksChanged = true; }
      }
      if (linksChanged) { rich.html = document.toString(); writes.push({ file, original, value: JSON.stringify(rich, null, 2) }); }
      continue;
    }
    if (!rich.document) continue;
    const { document } = parseHTML(source.html || '');
    const groups = [...document.querySelectorAll('[data-type="columns"]')].map(group => [...group.children].filter(column => column.getAttribute('data-type') === 'column').map(column => Number(column.getAttribute('data-column-width'))));
    const columns = [];
    const visit = node => { if (node.type === 'columns') columns.push(node); (node.content || []).forEach(visit); };
    visit(rich.document);
    if (!groups.length) continue;
    if (groups.length !== columns.length || groups.some((widths, i) => widths.length !== columns[i].content.length || widths.some(width => !Number.isFinite(width) || width <= 0 || width > 100))) { report.editedStructures.push(page.id); continue; }
    for (const [i, group] of columns.entries()) for (const [j, column] of group.content.entries()) column.attrs = { ...column.attrs, width: column.attrs?.width ?? groups[i][j] };
    if (JSON.stringify(JSON.parse(original)) !== JSON.stringify(rich)) { writes.push({ file, original, value: JSON.stringify(rich, null, 2) }); report.layouts++; }
  }
}
if (report.applied && (report.pages || writes.length)) {
  // Refuse a stale write if another LocalFlow process saved while planning the repair.
  if (readFileSync(indexFile, 'utf8') !== originalIndex || writes.some(item => readFileSync(item.file, 'utf8') !== item.original)) throw new Error('Notes changed during repair. Close LocalFlow and retry.');
  const backup = join(notesRoot, 'layout-backups', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(backup, { recursive: true }); copyFileSync(indexFile, join(backup, 'index.json'));
  for (const item of writes) { copyFileSync(item.file, join(backup, item.file.split(/[\\/]/).at(-1))); writeFileSync(item.file, item.value); }
  writeFileSync(indexFile, JSON.stringify(index, null, 2)); report.backup = backup;
}
console.log(JSON.stringify({ ...report, markdownUnchanged: true }, null, 2));
