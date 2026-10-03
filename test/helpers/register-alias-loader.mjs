// Side-effect module: installs the alias loader and a minimal in-memory browser-storage shim for the current test process.
import { register } from "node:module";

register(new URL("./alias-loader.mjs", import.meta.url));

if (!globalThis.window) {
  const memory = new Map();
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
    clear: () => memory.clear(),
  };
}
