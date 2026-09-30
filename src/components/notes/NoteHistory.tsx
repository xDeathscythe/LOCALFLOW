import {createPortal} from 'react-dom';
import {useEditorState,type Editor} from '@tiptap/react';
import {Undo2,Redo2} from 'lucide-react';

export function NoteHistory({editor,target}:{editor:Editor;target:HTMLElement}) {
  const history=useEditorState({editor,selector:({editor})=>({undo:editor.can().undo(),redo:editor.can().redo()})});
  return createPortal(<>
    <button aria-label="Undo edit" title="Undo · Ctrl+Z" disabled={!history.undo} onMouseDown={event=>event.preventDefault()} onClick={()=>editor.chain().focus().undo().run()}><Undo2 size={17}/></button>
    <button aria-label="Redo edit" title="Redo · Ctrl+Shift+Z" disabled={!history.redo} onMouseDown={event=>event.preventDefault()} onClick={()=>editor.chain().focus().redo().run()}><Redo2 size={17}/></button>
  </>,target);
}
