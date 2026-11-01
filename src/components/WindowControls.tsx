import { Minus, Square, X } from 'lucide-react';
import { startWindowDrag, windowControl } from '../lib/desktop';
export function WindowControls() {
  return <div className="nativeTitlebar" onPointerDown={startWindowDrag} onDoubleClick={() => void windowControl('maximize')}>
    <div className="nativeWindowButtons"><button aria-label="Minimize window" onClick={() => void windowControl('minimize')}><Minus size={14}/></button><button aria-label="Maximize window" onClick={() => void windowControl('maximize')}><Square size={12}/></button><button aria-label="Hide window" onClick={() => void windowControl('hide')}><X size={15}/></button></div>
  </div>;
}
