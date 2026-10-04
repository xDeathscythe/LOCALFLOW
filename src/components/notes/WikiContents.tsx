import { useEffect, useState } from 'react';
import type { NoteNode } from '../../lib/workspace';

export function WikiContents({noteId,children,select}:{noteId:string;children:NoteNode[];select:(id:string)=>void}) {
  const [headings,setHeadings]=useState<{text:string;level:number}[]>([]);
  useEffect(()=>{
    const workspace=document.querySelector('.noteDocumentScroll'); if(!workspace)return;
    let timer:ReturnType<typeof setTimeout>;
    const read=()=>{const next=[...workspace.querySelectorAll<HTMLElement>('.noteProse :is(h1,h2,h3,h4,h5,h6)')].map(element=>({text:element.textContent||'',level:Number(element.tagName[1])}));setHeadings(current=>JSON.stringify(current)===JSON.stringify(next)?current:next);};
    const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(read,150);});
    observer.observe(workspace,{subtree:true,childList:true,characterData:true}); read();
    return()=>{observer.disconnect();clearTimeout(timer);};
  },[noteId]);
  return <nav className="noteWiki" aria-label="Wiki contents"><strong>Contents</strong>{!headings.length&&!children.length&&<span>Add headings or child pages to build this wiki index.</span>}{headings.map((heading,index)=><button key={index} style={{paddingLeft:(heading.level-1)*12}} onClick={()=>document.querySelectorAll<HTMLElement>('.noteProse :is(h1,h2,h3,h4,h5,h6)')[index]?.scrollIntoView({behavior:'smooth',block:'start'})}>{heading.text}</button>)}{children.map(child=><button key={child.id} onClick={()=>select(child.id)}>{child.label}</button>)}</nav>;
}
