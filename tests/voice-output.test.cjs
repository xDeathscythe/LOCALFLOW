const assert = require("assert/strict");
const path = require("path");
const { createVoiceOutputManager } = require("../electron/voice-output.cjs");

async function main() {
  const root = path.resolve(__dirname, "..");
  const slowStartup = createVoiceOutputManager(root, { startupTimeoutMs: 1 });
  const slowSpeech = createVoiceOutputManager(root, { speechTimeoutMs: 1 });
  const voice = createVoiceOutputManager(root);
  try {
    await assert.rejects(slowStartup.speak("piper", "Test", { play: false }), /loading timed out/);
    await assert.rejects(slowSpeech.speak("piper", "This is a local voice output timeout test.", { play: false }), /timed out/);
    const result = await voice.speak("piper", "Local voice output is ready.", { play: false });
    assert(result.success);
    const cancelled = voice.speak("piper", "Cancel before synthesis.", { play: false });
    voice.stop();
    await assert.rejects(cancelled, /cancelled|stopped/);
    assert((await voice.speak("piper", "Recovered.", { play: false })).success);
    console.log("Real Piper synthesis, startup/speech timeout, cancellation and recovery passed (no playback)");
  } finally {
    slowStartup.stop();
    slowSpeech.stop();
    voice.stop();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
