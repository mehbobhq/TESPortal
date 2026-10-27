import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

const SCRIPT = "scripts/database/supabase-dev/diagnostics/credential_equivalence.py"
const WF = readFileSync(".github/workflows/supabase-dev-credential-equivalence.yml", "utf8")
const PASSWORD = "Wk9#correct-horse-battery-STAPLE_42"

function fakeGh(failSet = false) {
  const dir = mkdtempSync(join(tmpdir(), "fakegh-"))
  const bin = join(dir, "gh")
  writeFileSync(bin, `#!/usr/bin/env bash
echo "$@" >> "${dir}/argv.log"
if [ "$1 $2" = "secret set" ]; then ${failSet ? "exit 1" : `cat > "${dir}/$3.val"`}; fi
exit 0
`)
  chmodSync(bin, 0o755)
  return { dir, bin }
}
const run = (mode: string, env: Record<string, string>, input?: string) =>
  spawnSync("python3", ["-I", SCRIPT, mode], { env: { PATH: process.env.PATH ?? "", ...env }, input, encoding: "utf8" })
const stored = (dir: string) => ({
  SUPABASE_DEV_CMP_KEY: readFileSync(join(dir, "SUPABASE_DEV_CMP_KEY.val"), "utf8"),
  SUPABASE_DEV_CMP_EXPECTED: readFileSync(join(dir, "SUPABASE_DEV_CMP_EXPECTED.val"), "utf8"),
})
const compare = (env: Record<string, string>) => run("compare", env)

describe("credential-equivalence diagnostic (synthetic; no GitHub, no database)", () => {
  const gh = fakeGh()
  const local = run("local", { PATH: `${gh.dir}:${process.env.PATH}` }, PASSWORD + "\n")
  const s = stored(gh.dir)

  it("local side stores only a 256-bit key and a 64-hex MAC, never the password, and prints neither", () => {
    assert.equal(local.status, 0)
    assert.match(s.SUPABASE_DEV_CMP_KEY, /^[0-9a-f]{64}$/)
    assert.match(s.SUPABASE_DEV_CMP_EXPECTED, /^[0-9a-f]{64}$/)
    for (const v of [PASSWORD, s.SUPABASE_DEV_CMP_KEY, s.SUPABASE_DEV_CMP_EXPECTED]) {
      assert.ok(!local.stdout.includes(v) && !local.stderr.includes(v), "value printed")
      assert.ok(!readFileSync(join(gh.dir, "argv.log"), "utf8").includes(v), "value on a command line")
    }
    assert.deepEqual(readdirSync(gh.dir).sort(), ["SUPABASE_DEV_CMP_EXPECTED.val", "SUPABASE_DEV_CMP_KEY.val", "argv.log", "gh"])
    assert.match(readFileSync(join(gh.dir, "argv.log"), "utf8"), /secret set SUPABASE_DEV_CMP_KEY --env supabase-dev --repo mehbobhq\/TESPortal/)
  })

  it("MATCH only for the identical password; output is exactly one word", () => {
    const r = compare({ ...s, SUPABASE_DEV_BACKEND_PASSWORD: PASSWORD })
    assert.equal(r.stdout, "MATCH\n"); assert.equal(r.stderr, ""); assert.equal(r.status, 0)
  })

  it("MISMATCH for a different password, a trailing newline or space, a case change and a different key", () => {
    for (const pw of ["wrong", PASSWORD + "\n", PASSWORD + " ", PASSWORD.toLowerCase(), " " + PASSWORD]) {
      const r = compare({ ...s, SUPABASE_DEV_BACKEND_PASSWORD: pw })
      assert.equal(r.stdout, "MISMATCH\n"); assert.equal(r.status, 1)
    }
    const other = fakeGh(); run("local", { PATH: `${other.dir}:${process.env.PATH}` }, PASSWORD + "\n")
    assert.notEqual(stored(other.dir).SUPABASE_DEV_CMP_KEY, s.SUPABASE_DEV_CMP_KEY, "the key is fresh for every run")
    assert.notEqual(stored(other.dir).SUPABASE_DEV_CMP_EXPECTED, s.SUPABASE_DEV_CMP_EXPECTED, "so the MAC differs for the same password")
    assert.equal(compare({ ...s, SUPABASE_DEV_CMP_KEY: stored(other.dir).SUPABASE_DEV_CMP_KEY, SUPABASE_DEV_BACKEND_PASSWORD: PASSWORD }).stdout, "MISMATCH\n")
  })

  it("INCONCLUSIVE (never a verdict, never a traceback or value) for missing or malformed inputs", () => {
    const cases: Record<string, string>[] = [
      { ...s },
      { ...s, SUPABASE_DEV_BACKEND_PASSWORD: "" },
      { SUPABASE_DEV_BACKEND_PASSWORD: PASSWORD, SUPABASE_DEV_CMP_EXPECTED: s.SUPABASE_DEV_CMP_EXPECTED },
      { SUPABASE_DEV_BACKEND_PASSWORD: PASSWORD, SUPABASE_DEV_CMP_KEY: s.SUPABASE_DEV_CMP_KEY },
      { ...s, SUPABASE_DEV_BACKEND_PASSWORD: PASSWORD, SUPABASE_DEV_CMP_EXPECTED: "zz" },
      { ...s, SUPABASE_DEV_BACKEND_PASSWORD: PASSWORD, SUPABASE_DEV_CMP_KEY: "not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-" },
      { ...s, SUPABASE_DEV_BACKEND_PASSWORD: PASSWORD, SUPABASE_DEV_CMP_KEY: "ab" },
    ]
    for (const c of cases) {
      const r = compare(c)
      assert.equal(r.stdout, "INCONCLUSIVE\n", JSON.stringify(Object.keys(c)))
      assert.equal(r.stderr, ""); assert.equal(r.status, 1)
    }
  })

  it("if the secrets cannot be stored, nothing is kept, deletion is attempted and nothing sensitive is printed", () => {
    const bad = fakeGh(true)
    const r = run("local", { PATH: `${bad.dir}:${process.env.PATH}` }, PASSWORD + "\n")
    assert.equal(r.status, 1); assert.match(r.stdout, /INCONCLUSIVE/)
    assert.ok(!r.stdout.includes(PASSWORD)); assert.ok(!existsSync(join(bad.dir, "SUPABASE_DEV_CMP_KEY.val")))
    assert.match(readFileSync(join(bad.dir, "argv.log"), "utf8"), /secret delete SUPABASE_DEV_CMP_KEY/)
  })

  it("an empty password is INCONCLUSIVE and stores nothing", () => {
    const g = fakeGh(); const r = run("local", { PATH: `${g.dir}:${process.env.PATH}` }, "\n")
    assert.equal(r.status, 1); assert.ok(!existsSync(join(g.dir, "argv.log")))
  })

  it("cleanup deletes both one-time secrets", () => {
    const g = fakeGh(); const r = run("cleanup", { PATH: `${g.dir}:${process.env.PATH}` })
    assert.equal(r.status, 0)
    const log = readFileSync(join(g.dir, "argv.log"), "utf8")
    assert.match(log, /secret delete SUPABASE_DEV_CMP_KEY/); assert.match(log, /secret delete SUPABASE_DEV_CMP_EXPECTED/)
  })
})

describe("credential-equivalence workflow", () => {
  const code = WF.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")
  it("is manual, main-only, confirmed, read-only, and has no Supabase connection or Google credentials", () => {
    assert.match(code, /on:\s*\n\s*workflow_dispatch:/); assert.doesNotMatch(code, /\n\s*(push|pull_request|schedule):/)
    assert.match(code, /if: github\.ref == 'refs\/heads\/main' && inputs\.confirm == 'credential-equivalence'/)
    assert.match(code, /environment: supabase-dev/); assert.match(code, /permissions:\s*\n\s*contents: read\s*\n/)
    assert.doesNotMatch(code, /psql|PGHOST|PGUSER|PGPASSWORD|id-token|google-github-actions|migrate|upload-artifact|GITHUB_OUTPUT|GITHUB_ENV|GITHUB_STEP_SUMMARY|set -x|echo|printenv/)
  })
  it("reads exactly the backend password and the two one-time secrets, only at step level, and only prints the verdict", () => {
    assert.deepEqual([...new Set([...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort(), ["SUPABASE_DEV_BACKEND_PASSWORD", "SUPABASE_DEV_CMP_EXPECTED", "SUPABASE_DEV_CMP_KEY"])
    assert.match(code, /steps:[\s\S]*- name: Compare[\s\S]*env:[\s\S]*SUPABASE_DEV_BACKEND_PASSWORD/)
    assert.match(code, /run: python3 -I scripts\/database\/supabase-dev\/diagnostics\/credential_equivalence\.py compare\s*$/m)
    const py = readFileSync(SCRIPT, "utf8")
    assert.equal([...py.matchAll(/\bprint\(/g)].length, 6) // verdict, 3 local messages, cleanup message, usage
  })
})
