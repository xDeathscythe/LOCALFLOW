const { spawn } = require("child_process");

function terminateProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  // Windows Python launchers can own another Python process and a Codex child.
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true, stdio: "ignore",
    });
    killer.on("error", () => child.kill());
  } else {
    child.kill();
  }
}

module.exports = { terminateProcess };
