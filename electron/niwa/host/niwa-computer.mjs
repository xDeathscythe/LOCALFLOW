import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Type } from "typebox";

const execute = promisify(execFile);
export function createNiwaComputer(appRoot, captureScreen) {
  const supported = ["win32", "darwin"].includes(process.platform);
  let granted = false;
  return {
    status: () => ({ platform: process.platform, installed: supported, ready: supported && granted, can_grant: supported, version: "Niwa native", checks: [{ name: "Host authorization", status: granted ? "pass" : "required" }] }),
    grant: () => {
      if (!supported) throw new Error("Native computer control requires a platform adapter for this host.");
      granted = true; return { ok: true };
    },
    tool: () => ({
      name: "computer_use", label: "Computer", capability: "computer", executionMode: "sequential",
      description: "Capture a fresh screen image with action screenshot to inspect the user's game or current view. Optional x/y select a display; optional text is the visual question. Screenshot is read-only and does not require computer-control permission. Inspect accessibility or interact with native controls only with host permission; select targets from observed ids/coordinates.",
      parameters: Type.Object({
        action: Type.Union(["inspect", "screenshot", "click", "type", "key"].map((v) => Type.Literal(v))),
        x: Type.Optional(Type.Integer()), y: Type.Optional(Type.Integer()), text: Type.Optional(Type.String()),
        key: Type.Optional(Type.Union(["enter", "escape", "tab", "backspace", "copy", "paste", "select_all"].map((key) => Type.Literal(key)))),
      }),
      execute: async (_id, params, signal) => {
        if (params.action === 'screenshot' && captureScreen) return captureScreen(params, signal);
        if (!supported || (!granted && params.action !== 'screenshot')) throw new Error("Grant computer control on the host first.");
        if (process.platform === "darwin") {
          if (params.action === "screenshot") {
            const temporary = mkdtempSync(join(tmpdir(), "niwa-screen-"));
            try {
              const image = join(temporary, "screen.png");
              await execute("/usr/sbin/screencapture", ["-x", image], { signal, timeout: 30_000 });
              return { content: [{ type: "image", mimeType: "image/png", data: readFileSync(image).toString("base64") }], details: {} };
            } finally { rmSync(temporary, { recursive: true, force: true }); }
          }
          const script = join(appRoot, "host", "niwa-computer.jxa").replace("app.asar", "app.asar.unpacked");
          const { stdout } = await execute("/usr/bin/osascript", ["-l", "JavaScript", script, JSON.stringify(params)], { signal, timeout: 30_000, maxBuffer: 2_000_000 });
          return { content: [{ type: "text", text: stdout }], details: {} };
        }
        const script = join(appRoot, "host", "niwa-computer.ps1").replace("app.asar", "app.asar.unpacked");
        const { stdout } = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script, "-Payload", Buffer.from(JSON.stringify(params)).toString("base64")], { windowsHide: true, signal, timeout: 30_000, maxBuffer: 20 * 1024 * 1024 });
        let result;
        try { result = JSON.parse(stdout); }
        catch { throw new Error("Native computer adapter returned invalid JSON."); }
        return { content: result.image ? [{ type: "image", mimeType: "image/png", data: result.image }] : [{ type: "text", text: JSON.stringify(result) }], details: {} };
      },
    }),
  };
}
