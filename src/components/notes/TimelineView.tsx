import { useMemo, useState } from 'react';
import type { DatabaseRow, Property } from '../../lib/database';
import { displayValue } from '../../../host/notes/database-engine.mjs';
const rowHeight = 40, viewportHeight = 480;
export function TimelineView({ rows, title, dateProperty, open, month: controlledMonth, onMonthChange, earliestDate }: { rows: DatabaseRow[]; title: Property; dateProperty?: Property; open: (id: string) => void; month?: Date; onMonthChange?: (month: Date) => void; earliestDate?: string }) {
  const [localMonth, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const month = controlledMonth || localMonth;
  const [scrollTop, setScrollTop] = useState(0), [undatedLimit, setUndatedLimit] = useState(100);
  const start = month.getTime(), days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(), day = 86400000;
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
  const dated = useMemo(() => rows.map(row => {
    const value = row.values[dateProperty?.id || ''] as { start?: string; end?: string } | string;
    const a = Date.parse(typeof value === 'string' ? value : value?.start || '');
    const b = Date.parse(typeof value === 'object' ? value?.end || value?.start || '' : value || '');
    return { row, a, b };
  }), [rows, dateProperty]);
  const visible = useMemo(() => dated.filter(value => value.a < end && value.b >= start), [dated, start, end]);
  const undated = useMemo(() => dated.filter(value => !Number.isFinite(value.a)), [dated]);
  if (!dateProperty) return <p>Add a date property to use this timeline.</p>;
  const first = Math.max(0, Math.min(visible.length - 1, Math.floor(scrollTop / rowHeight)) - 5);
  const last = Math.min(visible.length, first + Math.ceil(viewportHeight / rowHeight) + 10);
  const columns = `180px repeat(${days}, minmax(30px,1fr))`;
  const changeMonth = (next: Date) => { setScrollTop(0); setMonth(next); onMonthChange?.(next); };
  return <>
    <div className="databaseCalendarToolbar"><button aria-label="Previous timeline month" onClick={() => changeMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><button aria-label="Next timeline month" onClick={() => changeMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button><button onClick={() => {
      const earliest = earliestDate ? new Date(earliestDate + 'T12:00:00').getTime() : dated.reduce((best, value) => Number.isFinite(value.a) ? Math.min(best, value.a) : best, Infinity);
      if (Number.isFinite(earliest)) { const date = new Date(earliest); changeMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }
    }}>First dated item</button></div>
    <div key={month.getTime()} role="region" aria-label="Timeline rows" tabIndex={0} style={{ maxHeight: viewportHeight, overflow: 'auto' }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="databaseTimeline" style={{ gridTemplateColumns: columns, rowGap: 0 }}>
        <strong style={{ position: 'sticky', top: 0, zIndex: 1 }}>Name</strong>{Array.from({ length: days }, (_, i) => <small style={{ position: 'sticky', top: 0, zIndex: 1 }} key={i}>{i + 1}</small>)}
        {first > 0 && <div aria-hidden style={{ gridColumn: '1 / -1', height: first * rowHeight }} />}
        {visible.slice(first, last).map(({ row, a, b }) => <div className="timelineRow" key={row.id} style={{ display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: columns, height: rowHeight }}>
          <button style={{ gridRow: 1, gridColumn: 1 }} onClick={() => row.pageId && open(row.pageId)}>{displayValue(row.values[title.id]) || 'Untitled'}</button>
          <button className="timelineBar" style={{ gridRow: 1, gridColumn: `${Math.max(0, Math.floor((a - start) / day)) + 2} / ${Math.min(days, Math.floor((b - start) / day) + 1) + 2}` }} title={`${displayValue(row.values[title.id])}: ${new Date(a).toLocaleDateString()} – ${new Date(b).toLocaleDateString()}`} onClick={() => row.pageId && open(row.pageId)}>{displayValue(row.values[title.id])}</button>
        </div>)}
        {last < visible.length && <div aria-hidden style={{ gridColumn: '1 / -1', height: (visible.length - last) * rowHeight }} />}
      </div>
    </div>
    <details><summary>No date ({undated.length})</summary>{undated.slice(0, undatedLimit).map(({ row }) => <button key={row.id} onClick={() => row.pageId && open(row.pageId)}>{displayValue(row.values[title.id]) || 'Untitled'}</button>)}{undated.length > undatedLimit && <button onClick={() => setUndatedLimit(limit => limit + 100)}>Show more ({undated.length - undatedLimit})</button>}</details>
  </>;
}
