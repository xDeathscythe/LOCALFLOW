const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runTextTool, MODEL } = require('../host/text-tools.cjs');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const directory = mkdtempSync(join(tmpdir(),'localflow-text-'));
let calls, auth = 'chatgpt', outcome = 'completed';
class Client extends EventEmitter {
  constructor() { super(); calls = []; }
  async initialize() {}
  async request(method, args) {
    calls.push({ method,args });
    if (method === 'account/read') return { account:{ type:auth } };
    if (method === 'thread/start') return { thread:{ id:'writing' } };
    if (method === 'turn/start') {
      queueMicrotask(() => {
        this.emit('notification',{method:'item/completed',params:{threadId:'unrelated',item:{id:'foreign',type:'agentMessage',text:'Wrong session'}}});
        this.emit('notification',{method:'turn/completed',params:{threadId:'writing',turn:{status:outcome,items:[{id:'a',type:'agentMessage',text:'日本語 العربية Srpski'}]}}});
      });
      return { turn:{ id:'turn' } };
    }
  }
  close() {}
}
const run = value => runTextTool({ directory,binary:()=>'test' },value,Client);
(async () => {
  assert.equal(await run({action:'grammar',text:'日本語 العربية Srpski'}),'日本語 العربية Srpski');
  const turn=calls.find(c=>c.method==='turn/start').args;
  assert.equal(turn.model,MODEL); assert.equal(turn.effort,'medium'); assert.equal(turn.serviceTier,'fast');
  assert.equal(JSON.parse(turn.input[0].text).sourceText,'日本語 العربية Srpski');
  assert.equal(calls.find(c=>c.method==='thread/start').args.ephemeral,true);
  await assert.rejects(run({action:'grammar',text:''}),/Select/);
  await assert.rejects(run({action:'__proto__',text:'x'}),/Unknown/);
  auth='apiKey'; await assert.rejects(run({action:'grammar',text:'Text'}),/ChatGPT/);
  auth='chatgpt';outcome='failed';await assert.rejects(run({action:'grammar',text:'Text'}),/failed/);
  const controller=new AbortController(); controller.abort();
  await assert.rejects(runTextTool({directory,binary:()=>'test'},{action:'grammar',text:'Text'},Client,controller.signal),/cancelled/);
  console.log('TEXT_TOOLS_OK: multilingual payloads, strict OAuth/model/effort/tier, isolation, invalid input and failed turn.');
})().catch(error=>{console.error(error);process.exitCode=1;});
