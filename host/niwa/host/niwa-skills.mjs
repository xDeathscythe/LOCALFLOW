import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, isAbsolute, dirname, resolve } from "node:path";
import { readJsonFile, writeJsonFile } from "./niwa-store.mjs";
import { runShell } from "./niwa-tools.mjs";
import { fetchText } from "./niwa-web.mjs";

export function createNiwaSkills(dataDir, appRoot) {
  const root = join(dataDir, "skills");
  mkdirSync(root, { recursive: true });
  const settingsFile = join(dataDir, "skills.json");
  const disabled = new Set(readJsonFile(settingsFile, []));
  const checked = (file) => {
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error("Skill files must not be symbolic links.");
    return file;
  };
  const pathFor = (name) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name)) throw new Error("Invalid skill identifier.");
    const directory = join(root, name);
    if (existsSync(directory)) {
      const fromRoot = relative(realpathSync(root), realpathSync(directory));
      if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Skill path leaves its library.");
    }
    return checked(join(directory, "SKILL.md"));
  };
  const read = (name) => {
    const file = pathFor(name);
    if (!existsSync(file)) throw new Error("Skill does not exist.");
    const content = readFileSync(file, "utf8");
    return { name, content, enabled: !disabled.has(name), revision: createHash("sha256").update(content).digest("hex") };
  };
  const list = () => readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md"))).map((entry) => {
    const { content, ...skill } = read(entry.name);
    return { ...skill, description: content.split(/\r?\n/).find((line) => line.startsWith("description:"))?.slice(12).trim() || entry.name };
  });
  const save = ({ name, content, revision, source = "Niwa", license = "", evidence = "" }) => {
    if (typeof content !== "string" || !content.trim() || content.length > 100_000) throw new Error("Skill content must contain 1–100000 characters.");
    const file = pathFor(name);
    const current = existsSync(file) ? read(name) : null;
    if (current && revision !== current.revision) throw new Error("Skill changed; read its current revision before improving it.");
    if (current && !evidence.trim()) throw new Error("An improvement requires validation evidence.");
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    if (current) writeFileSync(checked(join(directory, `${current.revision}.md`)), current.content, { mode: 0o600 });
    writeFileSync(file, content, { mode: 0o600 });
    writeJsonFile(checked(join(directory, "provenance.json")), { source, license, evidence, previous: current?.revision, updatedAt: new Date().toISOString() });
    return read(name);
  };
  const bundled = appRoot ? readJsonFile(join(appRoot, "profiles", "niwa", "skills.json"), []) : [];
  for (const skill of bundled) if (!existsSync(pathFor(skill.name))) save(skill);
  const evidenceFile = join(dataDir, "skill-evidence.json");
  const evidenceRecords = readJsonFile(evidenceFile, {});
  const asset = (name, path) => {
    const directory = dirname(pathFor(name));
    const file = resolve(directory, path);
    if (!relative(directory, file) || relative(directory, file).startsWith("..") || isAbsolute(relative(directory, file))) throw new Error("Reference must be inside the skill.");
    let current = dirname(file);
    while (current !== directory) { checked(current); current = dirname(current); }
    return checked(file);
  };
  return { read, list, save,
    reference: (name, path) => { const skill = read(name); if (!skill.enabled) throw new Error("Skill is disabled."); return { name, path, content: readFileSync(asset(name, path), "utf8").slice(0, 100000) }; },
    catalog: () => bundled.map(({ name, content, ...entry }) => ({ name, description: content.split("\n").find((line) => line.startsWith("description:"))?.slice(12).trim(), ...entry })),
    validate: async ({ name, content, command }, session, signal, update) => {
      pathFor(name);
      if (!content?.trim() || !command?.trim()) throw new Error("Proposed skill content and a verification command are required.");
      const result = await runShell(command, session.cwd, signal, update);
      const id = randomUUID();
      evidenceRecords[id] = { id, name, session: session.id, hash: createHash("sha256").update(content).digest("hex"), command, ...result, createdAt: Date.now() };
      writeJsonFile(evidenceFile, evidenceRecords); return evidenceRecords[id];
    },
    validatedSave: (params, session) => {
      const record = evidenceRecords[params.validation_id];
      if (!record || record.name !== params.name || record.session !== session.id || record.hash !== createHash("sha256").update(params.content).digest("hex") || record.exit_code !== 0 || record.interrupted) throw new Error("Run skill_validate successfully for this exact content in this session before saving.");
      return save({ ...params, evidence: JSON.stringify(record) });
    },
    install: async ({ repository, commit, path, name, revision }, signal) => {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(commit) || !path || path.split("/").some((p) => !p || p === "." || p === "..") || !/^[\w./-]+$/.test(path)) throw new Error("Use owner/repository, an immutable 40-character commit and a relative skill directory.");
      pathFor(name);
      const base = `https://raw.githubusercontent.com/${repository}/${commit}/`;
      const license = (await fetchText(`${base}LICENSE`, signal)).text;
      const directories = [path], files = []; let visited = 0, total = 0;
      while (directories.length) {
        if (++visited > 100) throw new Error("Skill directory limit exceeded.");
        const directory = directories.shift();
        const entries = JSON.parse((await fetchText(`https://api.github.com/repos/${repository}/contents/${directory}?ref=${commit}`, signal)).text);
        if (!Array.isArray(entries) || entries.length >= 1000) throw new Error("Skill directory is invalid or too large.");
        for (const file of entries) {
          if (!file.path.startsWith(`${path}/`)) throw new Error("Source path leaves the skill directory.");
          if (file.type === "dir") directories.push(file.path);
          else if (file.type === "file" && !file.submodule_git_url && !file.target) { files.push(file); total += file.size; }
          else throw new Error("Skills cannot include symbolic links or submodules.");
          if (files.length > 100 || total > 1_000_000) throw new Error("Skill bundle exceeds its file or byte limit.");
        }
      }
      const downloaded = [];
      for (const file of files) downloaded.push({ path: file.path.slice(path.length + 1), content: (await fetchText(base + file.path, signal)).bytes });
      const main = downloaded.find((f) => f.path === "SKILL.md");
      if (!main) throw new Error("Source has no SKILL.md.");
      for (const file of downloaded) asset(name, file.path);
      const result = save({ name, content: main.content.toString("utf8"), revision, source: `${repository}@${commit}:${path}`, license, evidence: "Pinned import; disabled pending Niwa compatibility review and validation." });
      disabled.add(name); writeJsonFile(settingsFile, [...disabled]);
      for (const file of downloaded.filter((f) => f !== main)) { const destination = asset(name, file.path); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, file.content, { mode: 0o600 }); }
      writeFileSync(asset(name, "UPSTREAM-LICENSE"), license, { mode: 0o600 });
      return { ...result, enabled: false, files: downloaded.map((f) => ({ path: f.path, sha256: createHash("sha256").update(f.content).digest("hex") })) };
    },
    toggle: (name, enabled) => {
    read(name);
    if (enabled) disabled.delete(name); else disabled.add(name);
    writeJsonFile(settingsFile, [...disabled]);
    return { ok: true, name, enabled };
  } };
}
