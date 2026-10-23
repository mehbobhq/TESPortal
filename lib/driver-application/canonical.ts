import { createHash } from "node:crypto"

/** Deterministic JSON: object keys sorted, no whitespace, undefined dropped. The same value always yields the same bytes (and the same hash). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Cannot canonicalize a non-finite number.")
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

export const sha256Text = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
export const sha256Canonical = (value: unknown) => sha256Text(canonicalJson(value))
