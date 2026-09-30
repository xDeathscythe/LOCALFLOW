import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function DatabaseMenu({ x, y, close, children, className = 'databaseContextMenu' }: { x: number; y: number; close: () => void; children: ReactNode; className?: string }) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const element=ref.current;if(!element)return;const rect=element.getBoundingClientRect();element.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;element.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;element.querySelector<HTMLButtonElement>('button')?.focus();const outside=(event:PointerEvent)=>{if(!element.contains(event.target as Node))close();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[x,y]);
  return createPortal(<div ref={ref} className={className} role="menu" style={{left:x,top:y}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}}}>{children}</div>,document.body);
}
