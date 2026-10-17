import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NoteNode } from '../../lib/workspace';
import { inject } from './hairline-riffle-utils/core/styles';
import { mount } from './hairline-riffle-utils/figures/riffle';
import './hairline-riffle.css';

type Props = {
  items: NoteNode[];
  label: string;
  disabled?: boolean;
  open: (id: string, newTab?: boolean) => void;
  menu: (id: string, x: number, y: number) => void;
};

function Tray({ items, label, disabled, open, menu }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState(-1);
  const callbacks = useRef({ open, menu });
  useLayoutEffect(() => { callbacks.current = { open, menu }; });
  useLayoutEffect(() => {
    inject(document);
    const figure = mount({ stage: stage.current!, svg: svg.current!, read: { textContent: '' } }, 40, {
      items, selected: setActive,
      open: (id, newTab) => callbacks.current.open(id, newTab),
      menu: (id, x, y) => callbacks.current.menu(id, x, y),
    });
    return figure.destroy;
  }, [items]);
  const item = items[active];
  return <section className="riffleTray" aria-label={label}>
    <div className="riffleCaption" aria-live="polite" aria-atomic="true">
      {item && <span key={item.id} dir="auto">{item.label}</span>}
    </div>
    <div ref={stage} className="riffleStage" data-hairline="riffle" data-active-id={item?.id}
      role="group" tabIndex={disabled || !items.length ? -1 : 0} aria-label={label} aria-disabled={disabled}
      aria-description="Use the arrow keys to choose an item, Enter to open it, or Escape to put it back.">
      <svg ref={svg} viewBox="0 0 400 320" aria-hidden="true" />
    </div>
  </section>;
}

export default function Riffle({ items, ...props }: Props) {
  // The contents key remounts only a changed tray, not on hover or unrelated renders.
  const trays = useMemo(() => Array.from({ length: Math.max(1, Math.ceil(items.length / 8)) }, (_, index) => items.slice(index * 8, index * 8 + 8)), [items]);
  return <div className="riffleGrid">{trays.map((entries, index) =>
    <Tray key={JSON.stringify([index, entries.map(item => [item.id, item.label])])} {...props} items={entries} />)}
  </div>;
}
