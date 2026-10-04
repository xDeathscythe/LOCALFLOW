import { execFile, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Type } from "typebox";

export const toolResult = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], details: {} });
export const defineTool = (name, description, properties, capability, execute) => ({
  name, label: name, description, parameters: Type.Object(properties), capability,
  executionMode: capability === "read" ? "parallel" : "sequential",
  execute: async (_id, params, signal, onUpdate) => { signal?.throwIfAborted(); return toolResult(await execute(params, signal, onUpdate)); },
});

export function workspacePath(cwd, value, write = false, external = false) {
  const target = resolve(cwd, value);
  let existing = target;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const fromRoot = relative(realpathSync(cwd), realpathSync(existing));
  if (!external && (fromRoot.startsWith("..") || isAbsolute(fromRoot))) throw new Error("Path is outside this task's workspace.");
  if (!write && !existsSync(target)) throw new Error("File does not exist.");
  return target;
}

export function runShell(command, cwd, signal, onUpdate, timeoutMs = 120_000) {
  return process.platform === "win32"
    ? runProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n${command}`], cwd, signal, onUpdate, timeoutMs)
    : runProcess("/bin/sh", ["-c", command], cwd, signal, onUpdate, timeoutMs);
}

export function runProcess(executable, args, cwd, signal, onUpdate, timeoutMs = 120_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    let output = "";
    let stopped = false;
    const kill = () => {
      stopped = true;
      if (!child.pid) return;
      if (process.platform === "win32") execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
      else { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    };
    const timer = setTimeout(kill, Math.min(600_000, Math.max(100, timeoutMs)));
    const collect = (chunk) => { output = (output + chunk).slice(-64_000); onUpdate?.(toolResult(output)); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", kill); };
    child.on("error", (error) => { cleanup(); reject(error); });
    child.on("close", (code) => { cleanup(); resolveRun({ exit_code: code, output, interrupted: stopped }); });
  });
}
