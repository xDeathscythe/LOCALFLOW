const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const resources = path.resolve(process.argv[2]);
const prerequisites = path.join(resources, 'runtime/prerequisites');
const manifest = JSON.parse(fs.readFileSync(path.join(prerequisites, 'vc-runtime.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(createHash('sha256').update(fs.readFileSync(path.join(prerequisites, 'vc_redist.x64.exe'))).digest('hex'), manifest.sha256);
const temp = fs.mkdtempSync(path.resolve('runtime/payload-check-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(LOCALFLOW_|PYTHON|HF_|HUGGINGFACE_|TRANSFORMERS_)/i.test(key)));
Object.assign(env, { PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, TEMP: temp, TMP: temp,
  HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' });
const wav = path.resolve(process.argv[5] || 'tests/fixtures/dictation.wav');
assert.deepEqual(fs.readdirSync(path.join(resources, 'models/whisper')), ['large-v3']);
assert(!fs.existsSync(path.join(resources, 'runtime/tts')));
const code = `
import os, sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path[:0] = [str(root/'runtime/python-packages'), str(root/'backend')]
os.environ['PATH'] = str(root/'runtime/cuda/bin') + os.pathsep + os.environ['PATH']
os.environ.update(LOCALFLOW_WHISPER_DEVICE=sys.argv[3], LOCALFLOW_WHISPER_COMPUTE_TYPE='auto', LOCALFLOW_WHISPER_DOWNLOAD_ROOT=str(root/'models/whisper'))
import worker, hotkey_watcher, paste_input
events = []
original_emit = worker.emit
worker.emit = lambda event: (events.append(event), original_emit(event))
assert Path(hotkey_watcher.__file__).is_relative_to(root)
assert Path(paste_input.__file__).is_relative_to(root)
for name in ('large-v3',):
    assert (root/'models/whisper'/name/'model.bin').stat().st_size > 100_000_000
    os.environ['LOCALFLOW_WHISPER_MODEL'] = name
    worker.warmup_model('payload-check')
    model = worker.load_whisper_model('payload-check')
    assert model.model.device == sys.argv[4], (model.model.device, sys.argv[4])
    if model.model.device == 'cuda':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
        kernel.GetModuleHandleW.restype = wintypes.HMODULE
        kernel.GetModuleFileNameW.argtypes = [wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
        for dll in ('cublas64_12.dll', 'cublasLt64_12.dll', 'cudnn64_9.dll'):
            handle = kernel.GetModuleHandleW(dll)
            assert handle, dll
            filename = ctypes.create_unicode_buffer(32768)
            assert kernel.GetModuleFileNameW(handle, filename, len(filename)), dll
            assert Path(filename.value).is_relative_to(root), filename.value
            print('BUNDLED_GPU_DLL_OK', filename.value, flush=True)
    segments, _ = model.transcribe(sys.argv[2], beam_size=1, vad_filter=True)
    text = ' '.join(segment.text for segment in segments).lower()
    assert 'orange bicycle' in text and 'library' in text, (name, text)
    worker.reset_whisper_model()
    print('PACKAGED_OFFLINE_MODEL_OK', name, text, flush=True)
`;
const result = spawnSync(path.join(resources, 'runtime/python/python.exe'), ['-I', '-B', '-c', code, resources, wav, process.argv[3] || 'cpu', process.argv[4] || 'cpu'],
  { cwd: temp, env, encoding: 'utf8', stdio: ['ignore', 'inherit', 'pipe'], windowsHide: true, timeout: 600000 });
assert.equal(result.status, 0, result.stderr || result.error?.message);
console.log('PACKAGED_LARGE_ONLY_KEYBOARD_AND_SIGNED_RUNTIME_HASH_OK');
