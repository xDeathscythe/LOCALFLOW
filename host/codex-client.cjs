const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { EventEmitter } = require('node:events');
const { terminateProcess } = require('./child-process.cjs');

// Codex owns the execution loop, realtime endpoint, authentication and delegation.
class CodexClient extends EventEmitter {
  constructor(binary, options = {}) {
    super();
    this.pending = new Map();
    this.sequence = 0;
    this.child = spawn(binary, ['app-server', '--stdio'], {
      cwd: options.cwd, env: options.env || process.env, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('Codex service stopped. Reconnect Niwa.')));
    createInterface({ input: this.child.stdout }).on('line', line => {
      let packet;
      try { packet = JSON.parse(line); } catch { return; }
      if (packet.method) this.emit(packet.id === undefined ? 'notification' : 'request', packet);
      else {
        const pending = this.pending.get(packet.id);
        if (!pending) return;
        this.pending.delete(packet.id); clearTimeout(pending.timer);
        if (packet.error) pending.reject(new Error(packet.error.message)); else pending.resolve(packet.result);
      }
    });
  }
  write(packet) {
    if (!this.child.stdin.writable || this.closed) throw new Error('Codex service is unavailable.');
    this.child.stdin.write(JSON.stringify(packet) + '\n');
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  respond(id, result) { this.write({ id, result }); }
  reject(id, message) { this.write({ id, error: { code: -32603, message } }); }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'localflow_niwa', title: 'LocalFlow Niwa', version: require('../package.json').version }, capabilities: { experimentalApi: true } });
    this.write({ method: 'initialized' });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  close() {
    this.fail(new Error('Niwa disconnected.'));
    terminateProcess(this.child);
    for (const stream of this.child.stdio) stream?.destroy();
  }
}
module.exports = { CodexClient };
