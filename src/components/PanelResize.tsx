import { useLayoutEffect, useRef, useState } from 'react';

export function PanelResize({ label, property, edge, min, max, fraction }: {
  label: string; property: string; edge: 'left' | 'right'; min: number; max: number; fraction: number;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [range, setRange] = useState({ value: min, max });
  const [dragging, setDragging] = useState(false);
  const key = `localflow.layout.${property}`;
  const direction = edge === 'right' ? 1 : -1;
  useLayoutEffect(() => {
    const pane = handle.current!.parentElement!;
    const layout = pane.parentElement!;
    try {
      const saved = Number(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved >= min && saved <= max) layout.style.setProperty(property, `${saved}px`);
    } catch { /* Layout remains usable when storage is unavailable. */ }
    const observer = new ResizeObserver(() => setRange({ value: Math.round(pane.getBoundingClientRect().width), max: Math.max(min, Math.min(max, Math.floor(layout.clientWidth * fraction))) }));
    observer.observe(pane); observer.observe(layout);
    return () => observer.disconnect();
  }, [key, property, min, max, fraction]);
  const resize = (width: number) => {
    const layout = handle.current!.parentElement!.parentElement!;
    layout.style.setProperty(property, `${Math.round(Math.max(min, Math.min(width, max, layout.clientWidth * fraction)))}px`);
  };
  const save = () => {
    try { localStorage.setItem(key, handle.current!.parentElement!.parentElement!.style.getPropertyValue(property).replace('px', '')); } catch { /* Persistence is optional. */ }
  };
  const finish = () => { if (drag.current) { drag.current = null; setDragging(false); save(); } };
  return <div ref={handle} className="panelResize" data-edge={edge} data-dragging={dragging || undefined}
    role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={range.max} aria-valuenow={range.value} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { x: event.clientX, width: event.currentTarget.parentElement!.getBoundingClientRect().width };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={event => { if (drag.current) resize(drag.current.width + (event.clientX - drag.current.x) * direction); }}
    onPointerUp={event => { finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const width = event.currentTarget.parentElement!.getBoundingClientRect().width;
      resize(event.key === 'Home' ? min : event.key === 'End' ? range.max : width + (event.key === 'ArrowRight' ? 1 : -1) * direction * (event.shiftKey ? 40 : 10));
      save();
    }} />;
}
