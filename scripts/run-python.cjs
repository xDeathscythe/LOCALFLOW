const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const bundled = path.join(root, "runtime", "python", "python.exe");
const python = fs.existsSync(bundled) ? bundled : path.join(root, ".venv", "Scripts", "python.exe");
const result = spawnSync(python, process.argv.slice(2), {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: {
    ...process.env,
    PYTHONPATH: [path.join(root, "runtime", "python-packages"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PATH: [path.join(root, "runtime", "cuda", "bin"), process.env.PATH].join(path.delimiter),
    PYTHONIOENCODING: "utf-8",
  },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
