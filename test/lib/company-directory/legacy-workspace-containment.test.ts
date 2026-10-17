// Static containment: the browser-local (legacy) workspaces are preserved as source but are never rendered, and nothing in
// the gate reads or writes browser storage or the `tes_companies` projection.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");
const companyPages = (dir = path.join(root, "app/companies/[id]")): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? companyPages(full) : e.name === "page.tsx" ? [full] : [];
  });

describe("legacy workspace containment", () => {
  it("the gate never touches browser storage or tes_companies and never renders its children", () => {
    const gate = source("src/components/shared/LegacyWorkspaceGate.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(gate, /localStorage|sessionStorage|indexedDB|tes_companies|document\.cookie/);
    assert.doesNotMatch(gate, /\{children\}|<>\{children\}<\/>|return children/);
  });

  it("the gate reports a refused lookup as 'not permitted', not as a missing company or a temporary failure", () => {
    const gate = source("src/components/shared/LegacyWorkspaceGate.tsx")
    assert.match(gate, /response\.status === 401 \|\| response\.status === 403 \? "denied"/)
    assert.match(gate, /You are not permitted to view this company's records\./)
  })

  it("the legacy implementations are preserved as source", () => {
    for (const f of ["authorities", "business", "credentials", "drivers", "insurance", "tax-filing"]) {
      assert.ok(existsSync(path.join(root, `app/companies/[id]/${f}/legacy-${f}.tsx`)), f);
    }
  });

  it("every page that mounts a legacy-* module does so only as a child of LegacyWorkspaceGate", () => {
    for (const file of companyPages()) {
      const code = readFileSync(file, "utf8");
      if (!/from "\.\/legacy-[a-z-]+"/.test(code)) continue;
      assert.match(code, /<LegacyWorkspaceGate/, file);
    }
  });

  it("no page, outside the gate, writes the tes_companies projection", () => {
    for (const file of companyPages()) {
      assert.doesNotMatch(readFileSync(file, "utf8").replace(/\/\/.*$/gm, ""), /setItem\(\s*["']tes_companies/, file);
    }
  });
});
