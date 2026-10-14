import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

/**
 * Restored (original) interfaces live under src/restored/<workspace>/** and must never touch browser persistence, directly or through
 * any module they (transitively) import at runtime: no localStorage / sessionStorage / IndexedDB, no `tes_*` storage keys, and none of
 * the legacy browser stores. Type-only imports are erased and therefore allowed. A file that fails here must be copied into
 * src/restored and adapted to the canonical API, not allow-listed.
 */
const ROOT = process.cwd()
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")

const FORBIDDEN_CODE = /localStorage|sessionStorage|indexedDB|document\.cookie|["'`]tes_[a-z_]+/i
const FORBIDDEN_IMPORT = /^@\/(?:lib\/(?:evidence-file-store|evidence-payload-store|vehicle-data|driver-data|activity-log|audit-log|audit-logger|authorities\/model|repair-invoice-data|repair-document-intake|deadline-engine)|src\/types\/legacy)/

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function resolveImport(from: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith("@/")) base = specifier.slice(2)
  else if (specifier.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(path.join(ROOT, candidate)) && statSync(path.join(ROOT, candidate)).isFile()) return candidate
  }
  return null
}

function runtimeImports(text: string): string[] {
  const out: string[] = []
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g
  for (const match of text.matchAll(re)) {
    if (match[2]) continue // `import type` / `export type` is erased
    const specifier = match[4] ?? match[5] ?? match[6]
    if (specifier) out.push(specifier)
  }
  return out
}

function walk(dir: string, found: string[] = []): string[] {
  if (!existsSync(path.join(ROOT, dir))) return found
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const relative = `${dir}/${entry}`
    if (statSync(path.join(ROOT, relative)).isDirectory()) walk(relative, found)
    else if (/\.(ts|tsx)$/.test(entry)) found.push(relative)
  }
  return found
}

describe("restored UI stays off browser persistence", () => {
  it("no file under src/restored, nor any module it imports at runtime, uses browser storage or a legacy store", () => {
    const entries = walk("src/restored")
    const seen = new Set<string>()
    const violations: string[] = []
    const visit = (file: string, via: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const text = strip(read(file))
      if (FORBIDDEN_CODE.test(text)) violations.push(`${file} (reached via ${via}) contains browser-storage code`)
      for (const specifier of runtimeImports(text)) {
        if (FORBIDDEN_IMPORT.test(specifier)) violations.push(`${file} imports ${specifier}`)
        const resolved = resolveImport(file, specifier)
        if (resolved) visit(resolved, file)
      }
    }
    for (const entry of entries) visit(entry, "src/restored")
    assert.deepEqual(violations, [])
  })

  it("the evidence-store importer ratchet is untouched by restored UI", () => {
    for (const file of walk("src/restored")) assert.doesNotMatch(read(file), /lib\/evidence-(payload|file)-store/, file)
  })
})
