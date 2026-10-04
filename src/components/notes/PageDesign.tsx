import { useState } from 'react';
import { ImagePlus, Smile, X } from 'lucide-react';
import type { PagePresentation } from '../../lib/workspace';

export function PageDesign({ value = {}, change }: { value?: PagePresentation; change: (value: PagePresentation) => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const patch = (next: PagePresentation) => change({ ...value, ...next });
  const pick = async (key: 'cover' | 'icon') => {
    setBusy(true); setError('');
    try {
      const assets = await window.localflow.notesPickAssets();
      if (!assets.length) return;
      const image = assets.find(asset => asset.mime.startsWith('image/'));
      if (!image) throw new Error('Choose an image.');
      patch({ [key]: image.url, ...(key === 'icon' ? { iconText: '' } : { coverPosition: 50 }) });
      if (key === 'cover') setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="notePageDesign">
    <button aria-label="Page design" aria-expanded={open} onClick={() => setOpen(!open)}><ImagePlus size={14}/>Page design</button>
    {open && <div className="notePageDesignPanel" role="group" aria-label="Page design options">
      <div><button disabled={busy} onClick={() => void pick('cover')}><ImagePlus size={14}/>{value.cover ? 'Change cover' : 'Add cover'}</button>{value.cover && <button aria-label="Remove cover" onClick={() => patch({ cover: '' })}><X size={14}/></button>}</div>
      {value.cover && <label>Cover position<input aria-label="Cover position" type="range" min="0" max="100" value={value.coverPosition ?? 50} onChange={event => patch({ coverPosition: Number(event.target.value) })}/></label>}
      <div><button disabled={busy} onClick={() => void pick('icon')}><Smile size={14}/>Upload icon</button><input aria-label="Page icon" placeholder="Emoji" maxLength={32} value={value.iconText || ''} onChange={event => patch({ iconText: event.target.value, icon: '' })}/>{(value.icon || value.iconText) && <button aria-label="Remove icon" onClick={() => patch({ icon: '', iconText: '' })}><X size={14}/></button>}</div>
      {error && <span role="alert">{error}</span>}
    </div>}
  </div>;
}
