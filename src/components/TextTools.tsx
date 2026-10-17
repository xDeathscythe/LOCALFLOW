import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ScanText, PenLine } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export function TextTools({ onBoard }: {onBoard:(text?:string)=>void}) {
  const board=useRef(onBoard);board.current=onBoard;
  const [error, setError] = useState('');
  const open = (mode: string, text = '') => {
    setError('');
    void invoke('native_call', { method:'text-tools-open', args:[{ mode, text }] }).catch(error => setError(String(error)));
  };
  useEffect(() => {
    const listener=listen<string>('scrub-board-open',event=>board.current(event.payload));
    const status=listen<string>('text-tools-status',event=>setError(event.payload));
    return () => {void listener.then(stop=>stop());void status.then(stop=>stop());};
  }, []);
  return <div aria-label="Text tools">
    <button className="navItem" title="Select and copy text from the screen (F2 + F3)" onClick={() => open('capture')}><ScanText size={17}/><span>Select Copy</span></button>
    <button className="navItem" onClick={() => onBoard()}><PenLine size={17}/><span>Scrub board</span></button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
