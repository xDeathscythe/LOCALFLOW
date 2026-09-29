const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || 'release/win-unpacked/resources');
const temp = fs.mkdtempSync(path.resolve('runtime/offline-check-'));
const env = { ...process.env, PYTHONPATH:'', PYTHONHOME:'', PYTHONNOUSERSITE:'1', HF_HUB_OFFLINE:'1', TRANSFORMERS_OFFLINE:'1', HF_HOME:path.join(temp,'empty-cache'), HTTP_PROXY:'http://127.0.0.1:9', HTTPS_PROXY:'http://127.0.0.1:9', LOCALFLOW_VOICE_ROOT:path.join(root,'runtime','tts'), LOCALFLOW_VOICE_OUTPUT_DIR:temp };
function python(exe, code) {
  const result = spawnSync(exe, ['-B','-c',code], { cwd:temp, env, encoding:'utf8', timeout:180000, windowsHide:true });
  assert.equal(result.status,0,result.stderr || result.error?.message);
  return result.stdout;
}
for (const engine of ['piper','xtts','omnivoice']) {
  const exe = path.join(root,'runtime','tts',engine,'.venv','Scripts','python.exe');
  const module = engine === 'xtts' ? 'TTS' : engine;
  const output = python(exe, `import ${module}, sys; from pathlib import Path; assert sys.prefix == sys.base_prefix; assert Path(${module}.__file__).is_relative_to(sys.base_prefix); print(sys.base_prefix)`);
  assert(output.toLowerCase().includes(root.toLowerCase()),'runtime must resolve inside installation');
}
const model = path.join(root,'runtime','tts','piper','voices','en_US-kristin-medium.onnx');
python(path.join(root,'runtime','tts','piper','.venv','Scripts','python.exe'),`from piper import PiperVoice\nimport wave\nvoice=PiperVoice.load(${JSON.stringify(model)})\nwith wave.open(${JSON.stringify(path.join(temp,'offline.wav'))},'wb') as out: voice.synthesize_wav('LocalFlow offline installation test.',out)`);
assert(fs.statSync(path.join(temp,'offline.wav')).size>1000);
for (const name of ['large-v3','large-v3-turbo']) assert(fs.statSync(path.join(root,'models','whisper',name,'model.bin')).size>100000000);
const distribution=JSON.parse(fs.readFileSync(path.join(root,'runtime','distribution.json'),'utf8').replace(/^\uFEFF/,''));
assert.equal(distribution.mcpProtocol,'2026-07-28');
const mcp = python(path.join(root,'runtime','windows-mcp','python.exe'),"import importlib.metadata as m; print(m.version('windows-mcp'))");
assert.equal(mcp.trim(),'0.8.6');
console.log('RELOCATED_PACKAGE_PYTHON_IMPORTS_PIPER_SYNTHESIS_MODELS_OFFLINE_OK');
