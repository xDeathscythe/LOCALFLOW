import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./niwa-store.mjs";

const documents = {
  identity_name: "identity", identity_persona: "identity", user_name: "user", user_preference: "user",
  founder_address: "relationship", communication_preference: "relationship", relationship_tone: "relationship",
  inside_joke: "relationship", shared_context: "relationship", other: "relationship",
};
const singular = new Set(["identity_name", "user_name", "founder_address"]);
export function createNiwaMemory(dataDir) {
  const file = join(dataDir, "companion.json");
  let facts = readJsonFile(file, []);
  const recall = (scope) => facts.filter((fact) => !scope || fact.scope === scope);
  return {
    recall,
    review: () => ({ active_facts: facts.length, documents: Object.fromEntries(["identity", "user", "relationship"].map((scope) => [scope, recall(scope)])) }),
    capture: ({ category, fact, source }) => {
      if (!Object.hasOwn(documents, category) || typeof fact !== "string" || !fact.trim() || fact.length > 200) throw new Error("A valid category and fact of 1–200 characters are required.");
      if (facts.some((value) => value.category === category && value.fact === fact)) return { saved: false, duplicate: true };
      if (singular.has(category)) facts = facts.filter((value) => value.category !== category);
      const value = { id: randomUUID(), category, scope: documents[category], fact, source, createdAt: new Date().toISOString() };
      facts.push(value);
      writeJsonFile(file, facts);
      return { saved: true, ...value };
    },
    forget: (id) => { facts = facts.filter((fact) => fact.id !== id); writeJsonFile(file, facts); return { ok: true }; },
    context: () => JSON.stringify(Object.fromEntries(["identity", "user", "relationship"].map((scope) => {
      const values = recall(scope);
      return [scope, [...values.filter((v) => singular.has(v.category)), ...values.filter((v) => !singular.has(v.category)).slice(-4)]];
    }))),
  };
}
