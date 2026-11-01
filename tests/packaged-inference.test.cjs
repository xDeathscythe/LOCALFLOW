const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.LOCALFLOW_APP_ROOT=path.resolve(process.argv[2]||'.');process.env.LOCALFLOW_PACKAGED='1';
process.env.LOCALFLOW_USER_DATA=fs.mkdtempSync(path.resolve('runtime/inference-check-'));
const runtime=require('../host/runtime-config.cjs');runtime.ensureRuntimeEnv();
const {createTranscriptionWorker}=require('../host/transcription-worker.cjs');
const events=[],worker=createTranscriptionWorker({python:runtime.resolvePython(),script:path.join(runtime.appRoot(),'backend/worker.py'),cwd:runtime.appRoot(),timeoutMs:60000,notify:value=>{events.push(value);if(value.stage)console.log(value.stage);}});
(async()=>{try{
 const params={path:path.resolve('tests/fixtures/dictation.wav'),options:{cleanupLevel:'none'}};
 const started=performance.now();await worker.send('warmup');const warmMs=performance.now()-started;
 let start=performance.now();const first=await worker.send('transcribe',params);const firstMs=performance.now()-start;assert.match(first.rawText.toLowerCase(),/orange bicycle/);
 const rejected=assert.rejects(worker.send('transcribe',params,'cancelled'),/cancelled/);setTimeout(()=>worker.cancel(),50);await rejected;
 start=performance.now();const next=await worker.send('transcribe',params);const afterCancelMs=performance.now()-start;assert.match(next.rawText.toLowerCase(),/library/);
 assert.equal(events.filter(value=>value.stage==='whisper-ready').length,1,'Cancellation must reuse the loaded inference model');
 console.log('PACKAGED_INFERENCE_CANCEL_REUSE_OK',JSON.stringify({warmMs:+warmMs.toFixed(1),firstMs:+firstMs.toFixed(1),afterCancelMs:+afterCancelMs.toFixed(1),runtime:events.find(value=>value.speechRuntime)?.speechRuntime,text:next.rawText}));
}finally{worker.stop();}})().catch(error=>{console.error(error);process.exitCode=1;});
