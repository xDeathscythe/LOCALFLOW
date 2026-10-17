// A real text layer keeps browser selection, bidi, and keyboard copying native.
window.startScreenText = async function ({ root, value, call, close }) {
  root.innerHTML = '<section class="capture" aria-label="Select Copy"><img alt="Captured screen" draggable="false"><div class="textLayer" aria-label="Recognized screen text"></div><div class="aura"></div><div class="captureToolbar"><span class="status" role="status">Reading screen…</span><select aria-label="Text recognition language" hidden></select><button id="copySelection" disabled>Copy</button><button data-close aria-label="Close Select Copy">Esc</button></div></section>';
  const frame = value.capture.content.find(item => item.type === 'image');
  const picture = root.querySelector('img');
  picture.src = `data:${frame.mimeType};base64,${frame.data}`;
  const layer = root.querySelector('.textLayer'), status = root.querySelector('.status');
  const copyButton = root.querySelector('#copySelection'), languages = root.querySelector('select');
  root.querySelector('[data-close]').onclick = close;
  const selectedText = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !layer.contains(selection.anchorNode) || !layer.contains(selection.focusNode)) return '';
    return selection.toString();
  };
  const copy = async () => {
    const text = selectedText();
    if (!text.trim()) return;
    try { await call('text-tools-copy', text); await close(); }
    catch (error) { status.textContent = String(error); }
  };
  copyButton.onpointerdown = e => e.preventDefault();
  copyButton.onclick = copy;
  document.addEventListener('selectionchange', () => { copyButton.disabled = !selectedText().trim(); });
  document.addEventListener('copy', e => { e.preventDefault(); void copy(); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault(); const range = document.createRange(); range.selectNodeContents(layer);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    }
  });
  async function recognize() {
    layer.replaceChildren(); status.textContent = 'Reading screen…'; languages.disabled = true;
    try {
      const result = await call('text-tools-recognize', { image:frame.data, language:languages.value });
      const fragment = document.createDocumentFragment();
      for (const line of result.lines) {
        const row = document.createElement('div'); row.className = 'ocrLine'; row.dir = 'auto';
        let offset = 0;
        for (const word of line.words) {
          // Preserve the recognizer's separators, including scripts without word spaces.
          const index = line.text.indexOf(word.text, offset);
          if (index > offset) row.append(document.createTextNode(line.text.slice(offset,index)));
          const span = document.createElement('span'); span.className = 'ocrWord'; span.dir = 'auto';
          span.textContent = word.text;
          Object.assign(span.style, { left:`${100*word.x/result.width}%`, top:`${100*word.y/result.height}%`, width:`${100*word.width/result.width}%`, height:`${100*word.height/result.height}%`, fontSize:`${100*word.height/result.height}vh` });
          row.append(span); offset = (index < 0 ? offset : index) + word.text.length;
        }
        row.append(document.createTextNode(line.text.slice(offset) + '\n')); fragment.append(row);
      }
      layer.append(fragment);
      // Fit each actual text run to its OCR box without custom drag-selection logic.
      for (const span of layer.querySelectorAll('.ocrWord')) {
        const range = document.createRange(); range.selectNodeContents(span);
        const width = range.getBoundingClientRect().width;
        if (width) { const ratio = span.clientWidth/width; span.style.width = `${span.clientWidth/ratio}px`; span.style.transform = `scaleX(${ratio})`; }
      }
      languages.replaceChildren(...result.languages.map(language => new Option(language.name,language.id)));
      languages.value = result.language; languages.hidden = result.languages.length < 2;
      status.textContent = result.lines.length ? 'Select text · Ctrl+C to copy' : 'No text found on this screen';
    } catch (error) { status.textContent = String(error); }
    finally { languages.disabled = false; }
  }
  languages.onchange = recognize;
  await recognize();
};
