const assert = require("assert/strict");
const path = require("path");
const { createVoiceOutputManager } = require("../electron/voice-output.cjs");

async function main() {
  const root = path.resolve(__dirname, "..");
  const slowStartup = createVoiceOutputManager(root, { startupTimeoutMs: 1 });
  const slowSpeech = createVoiceOutputManager(root, { speechTimeoutMs: 1 });
  const voice = createVoiceOutputManager(root);
  const idleVoice = createVoiceOutputManager(root, { idleTimeoutMs: 250 });
  try {
    await assert.rejects(slowStartup.speak("piper", "Test", { play: false }), /loading timed out/);
    await assert.rejects(slowSpeech.speak("piper", "This is a local voice output timeout test.", { play: false }), /timed out/);
    const result = await voice.speak("piper", "Local voice output is ready.", { play: false });
    assert(result.success);
    const warm = await voice.speak("piper", "The same model stays ready.", { play: false });
    assert.equal(warm.workerPid, result.workerPid);
    const interrupted = voice.speak("piper", "This sentence is interrupted. ".repeat(30), { play: false });
    await new Promise(resolve => setTimeout(resolve, 40));
    voice.cancel();
    await assert.rejects(interrupted, /cancelled/);
    const recovered = await voice.speak("piper", "Warm recovery.", { play: false });
    assert.equal(recovered.workerPid, result.workerPid, 'barge-in preserves the loaded model');
    const cancelled = voice.speak("piper", "Cancel before synthesis.", { play: false });
    voice.stop();
    await assert.rejects(cancelled, /cancelled|stopped/);
    assert((await voice.speak("piper", "Recovered.", { play: false })).success);
    const beforeIdle = await idleVoice.speak("piper", "Before idle.", { play: false });
    await new Promise(resolve => setTimeout(resolve, 500));
    const afterIdle = await idleVoice.speak("piper", "After idle.", { play: false });
    assert.notEqual(afterIdle.workerPid, beforeIdle.workerPid, 'only an idle TTS model unloads');
    console.log("Real Piper synthesis, timeouts, cancellation, warm worker reuse and idle unload passed (no playback)");
  } finally {
    slowStartup.stop();
    slowSpeech.stop();
    voice.stop();
    idleVoice.stop();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
