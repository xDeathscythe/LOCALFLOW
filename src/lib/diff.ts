export type DiffLine = { text: string; kind: string; old?: number; next?: number };
export function parseDiff(diff: string) {
  // Git protocol parsing is independent of the user's language.
  return diff.split(/(?=^diff --git )/m).filter(patch => patch.trim()).map((patch, index) => {
    const lines = patch.split('\n');
    const header = lines.find(line => line.startsWith('+++ ') && line !== '+++ /dev/null') || lines.find(line => line.startsWith('--- '));
    let old = 0, next = 0, hunk = false;
    const rows: DiffLine[] = [];
    for (const text of lines) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (match) { old = Number(match[1]); next = Number(match[2]); hunk = true; rows.push({ text, kind: '@' }); continue; }
      if (!hunk) continue;
      const kind = text[0];
      if (kind === '+') rows.push({ text: text.slice(1), kind, next: next++ });
      else if (kind === '-') rows.push({ text: text.slice(1), kind, old: old++ });
      else if (kind === ' ') rows.push({ text: text.slice(1), kind, old: old++, next: next++ });
      else if (kind === '\\') rows.push({ text, kind });
    }
    return { path: header ? header.slice(4).replace(/^[ab]\//, '') : `Change ${index + 1}`, patch, rows, added: rows.filter(row => row.kind === '+').length, removed: rows.filter(row => row.kind === '-').length };
  });
}
export function splitRows(rows: DiffLine[]): { left?: DiffLine; right?: DiffLine }[] {
  const result: { left?: DiffLine; right?: DiffLine }[] = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind !== '-' && rows[i].kind !== '+') { result.push({ left: rows[i], right: rows[i] }); i++; continue; }
    const left: DiffLine[] = [], right: DiffLine[] = [];
    while (i < rows.length && ['-', '+'].includes(rows[i].kind)) { (rows[i].kind === '-' ? left : right).push(rows[i]); i++; }
    for (let j = 0; j < Math.max(left.length, right.length); j++) result.push({ left: left[j], right: right[j] });
  }
  return result;
}
