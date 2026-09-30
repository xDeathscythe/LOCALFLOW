import {useEffect,useRef,useState} from 'react';
import {Node,mergeAttributes} from '@tiptap/core';
import {NodeViewWrapper,ReactNodeViewRenderer,type NodeViewProps} from '@tiptap/react';
import {DatabasePage} from './DatabasePage';
function Preview({node,extension}:NodeViewProps){
  const container=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
  // Mount only nearby databases; long imported dashboards can contain dozens.
  useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(container.current)observer.observe(container.current);const print=()=>setVisible(true);window.addEventListener('localflow-notes-print',print);return()=>{observer.disconnect();window.removeEventListener('localflow-notes-print',print);};},[]);
  return <NodeViewWrapper ref={container} className="noteDatabaseEmbed" contentEditable={false} onContextMenu={(event:React.MouseEvent)=>event.stopPropagation()}>
    {visible?<DatabasePage id={node.attrs.id} label={node.attrs.label||'Database'} embedded open={id=>extension.options.openNote?.(id)}/>:<div className="databaseEmbedPlaceholder">{node.attrs.label||'Database'}</div>}
  </NodeViewWrapper>;
}
export const DatabaseEmbed=Node.create({name:'databaseEmbed',group:'block',atom:true,
  addOptions:()=>({openNote:undefined as undefined|((id:string)=>void)}),
  addAttributes:()=>({id:{default:'',parseHTML:element=>element.getAttribute('data-id')||element.querySelector('a[href^="localflow-note://"]')?.getAttribute('href')?.slice('localflow-note://'.length)},label:{default:'Database',parseHTML:element=>element.getAttribute('data-label')||element.querySelector('.collection-title')?.textContent||'Database'}}),
  parseHTML:()=>[{tag:'div[data-type="database-embed"]',getAttrs:element=>({id:element.getAttribute('data-id'),label:element.getAttribute('data-label')})},{tag:'div.collection-content',getAttrs:element=>{const href=element.querySelector('a[href^="localflow-note://"]')?.getAttribute('href');return href?{id:href.slice('localflow-note://'.length),label:element.querySelector('.collection-title')?.textContent||'Database'}:false;}}],
  renderHTML:({node,HTMLAttributes})=>['div',mergeAttributes(HTMLAttributes,{'data-type':'database-embed','data-id':node.attrs.id,'data-label':node.attrs.label}),['a',{href:`localflow-note://${node.attrs.id}`},node.attrs.label]],
  renderMarkdown:node=>`[${node.attrs?.label||'Database'}](localflow-note://${node.attrs?.id})`,
  addNodeView:()=>ReactNodeViewRenderer(Preview),
});
