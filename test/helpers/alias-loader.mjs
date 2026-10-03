// Test-only Node module-resolution hook so tests can import lib/driver-data.ts (which uses the "@/" alias and
// extensionless relative imports) under `node --test`. It changes no application behaviour.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// lib/vehicle-data.ts and lib/deadline-engine.ts import "../types" for TYPES ONLY (erased by the Next/TS build). Plain Node does not
// erase non-"type" imports, and that path is a directory with no index, so it is satisfied with an empty stub here.
const TYPE_ONLY_PARENTS = /lib\/(vehicle-data|deadline-engine)\.ts$/;

function tryFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return pathToFileURL(candidate).href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier === "../types" && context.parentURL && TYPE_ONLY_PARENTS.test(context.parentURL)) {
    return { url: new URL("./types-stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const hit = tryFile(path.join(ROOT, specifier.slice(2)));
    if (hit) return { url: hit, shortCircuit: true };
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL && context.parentURL.startsWith("file:") && !context.parentURL.includes("node_modules")) {
    const hit = tryFile(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return { url: hit, shortCircuit: true };
  }
  return next(specifier, context);
}
