import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Save, Undo2 } from 'lucide-react';
import type { JSONContent } from '@tiptap/core';
import '../styles/note-pages.css';
import '../styles/note-layout.css';
import '../styles/scrub-board.css';
const NoteEditor = lazy(() => import('./NoteEditor').then(module => ({ default:module.NoteEditor })));
type Draft = { content:string; document?:JSONContent };
export function ScrubBoard({ capture }: { capture:{id:string;text:string}|null }) {
  const [draft,setDraft] = useState<Draft>({content:''});
  const [title,setTitle] = useState('Scrub board');
  const [version,setVersion] = useState(0), [prompt,setPrompt] = useState(''), [status,setStatus] = useState('');
  const [busy,setBusy] = useState(false), [previous,setPrevious] = useState<Draft|null>(null);
  const read = useRef<(() => Draft)|null>(null), handled = useRef<string|null>(null), alive = useRef(true);
  const current = () => read.current?.() || draft;
  const replace = (value:Draft) => { read.current=null;setDraft(value);setVersion(v=>v+1); };
  useEffect(() => { alive.current=true;return () => { alive.current=false;void invoke('host_call',{method:'text-tools-cancel',args:['main']}).catch(()=>{}); }; },[]);
  useEffect(() => {
    if (!capture || handled.current===capture.id) return;
    handled.current=capture.id;
    const value=current();
    // Keep rich blocks when another selection is appended to the same board.
    const extra=capture.text.split('\n').map(text=>({type:'paragraph',content:text?[{type:'text',text}]:[]}));
    replace({content:value.content+(value.content?'\n\n':'')+capture.text,document:value.document?{type:'doc',content:[...(value.document.content||[]),...extra]}:undefined});
  },[capture]);
  const run = async (action:()=>Promise<void>) => { if(busy)return;setBusy(true);setStatus('');try{await action();}catch(error){if(alive.current)setStatus(String(error));}finally{if(alive.current)setBusy(false);} };
  const reshape = () => run(async () => {
    if(!prompt.trim()){setStatus('Describe the change you want.');return;}
    const source=current(); const selection=handled.current;
    setStatus('Reshaping…');
    const text=await invoke<string>('native_call',{method:'text-tools-run',args:[{action:'reshape',text:source.content,prompt}]});
    if(!alive.current)return;
    if(handled.current!==selection)throw Error('Text was added while rewriting. Your draft is unchanged. Try again.');
    if(!text.trim())throw Error('No text was returned. Your draft is unchanged.');
    setPrevious(source);replace({content:text});setStatus('Review the revised text.');
  });
  return <section className="noteWorkspace scrubBoardPage" aria-label="Scrub board">
    <div className="noteDocumentScroll">
      <header className="noteEditorHeader"><div><textarea className="noteTitleInput" rows={1} value={title} aria-label="Note title" onChange={e=>setTitle(e.target.value.replaceAll('\n',' '))}/><span>Temporary page</span></div></header>
      <p className="scrubHint">This page clears when you leave. Save a note to keep it.</p>
      <Suspense fallback={<div className="noteFolderState">Loading editor…</div>}><NoteEditor content={draft.content} document={draft.document} loadVersion={version} editable={!busy} onChange={value=>{read.current=value;}}/></Suspense>
    </div>
    <footer className="scrubFooter">
      <form onSubmit={e=>{e.preventDefault();void reshape();}}><input aria-label="How to reshape this text" placeholder="How would you like to change this text?" value={prompt} disabled={busy} onChange={e=>setPrompt(e.target.value)}/><button disabled={busy||!prompt.trim()} type="submit">Reshape</button></form>
      <div className="scrubFooterActions"><span role="status">{status}</span>{previous&&<button disabled={busy} onClick={()=>{replace(previous);setPrevious(null);setStatus('Original text restored.');}}><Undo2 size={14}/>Undo rewrite</button>}<button disabled={busy} onClick={()=>void run(async()=>{const value=current();if(!value.content.trim())throw Error('Write some text before saving.');await window.localflow.notesCreate({label:title.trim()||'Scrub board note',...value});if(alive.current)setStatus('Saved in Notes.');})}><Save size={14}/>Save note</button></div>
    </footer>
  </section>;
}
