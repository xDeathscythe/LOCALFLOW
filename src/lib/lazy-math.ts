import type { KatexOptions } from 'katex';

const pending = new Set<Promise<void>>(), latest = new WeakMap<HTMLElement, object>();
let renderer: Promise<{render(latex:string,element:HTMLElement,options?:KatexOptions):void}> | undefined;
export async function mathReady() { while (pending.size) await Promise.all([...pending]); }
export default {
  render(latex: string, element: HTMLElement, options?: KatexOptions) {
    const token = {}; latest.set(element, token); element.textContent = latex;
    renderer ||= import('./math-renderer').then(module => module.default);
    const task = renderer.then(katex => {
      if (latest.get(element) === token) katex.render(latex, element, options);
    }).catch(error => { if (latest.get(element) === token) { element.textContent = latex; element.title = String(error); element.setAttribute('role', 'alert'); } });
    pending.add(task); void task.finally(() => pending.delete(task));
  },
};
