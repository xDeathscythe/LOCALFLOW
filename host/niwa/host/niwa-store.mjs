import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export function readJsonFile(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}

export function writeJsonFile(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, file);
}

// One host owns this store. Serialize refresh and login so rotated tokens cannot race.
export function credentialStore(file, codec = { encode: (v) => v, decode: (v) => v }) {
  const saved = readJsonFile(file, {});
  const credentials = Object.fromEntries(Object.entries(saved).map(([id, value]) => [id, JSON.parse(codec.decode(value))]));
  let pending = Promise.resolve();
  const serialize = (fn) => {
    const result = pending.then(fn);
    pending = result.catch(() => {});
    return result;
  };
  const persist = () => writeJsonFile(file, Object.fromEntries(Object.entries(credentials).map(([id, value]) => [id, codec.encode(JSON.stringify(value))])));
  return {
    read: async (id) => structuredClone(credentials[id]),
    list: async () => Object.entries(credentials).map(([providerId, value]) => ({ providerId, type: value.type })),
    modify: (id, fn) => serialize(async () => {
      const value = await fn(structuredClone(credentials[id]));
      if (value !== undefined) { credentials[id] = value; persist(); }
      return structuredClone(credentials[id]);
    }),
    delete: (id) => serialize(() => { delete credentials[id]; persist(); }),
  };
}
