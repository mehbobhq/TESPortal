import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

const read = (p: string) => readFileSync(p, "utf8");
const RECORD_DIR = "app/companies/[id]/record-of-events";
const WIZARD = "src/components/drivers/DriverPerformanceEventWorkflow.tsx";

describe("New-event workflow: no acquisition-method selection", () => {
  it("neither card exists anywhere in the new-event workflow or the detailed wizard", () => {
    const sources = [...readdirSync(RECORD_DIR).map((f) => `${RECORD_DIR}/${f}`), WIZARD, "lib/driver-events/workflows.ts"].map(read).join("\n");
    assert.doesNotMatch(sources, /Source Evidence \/ Manual Fallback/);
    assert.doesNotMatch(sources, /Enter Manually/);
    assert.doesNotMatch(sources, /Choose Use Evidence \+ Manual Fallback/);
  });

  it("the wizard opens on the chosen category's first real step (no category step, no selection state)", () => {
    const w = read(WIZARD);
    assert.match(w, /initialCategory \? all\.filter\(\(item\) => item\.key !== "CATEGORY"\) : all/);
    assert.match(w, /useState<EntryMode>\(initialEntryMode \|\| "MANUAL"\)/);
    assert.doesNotMatch(w, /useState<EntryMode \| null>/);
    assert.match(w, /useState<DriverPerformanceEvent\["eventType"\] \| null>\(initialCategory \?\? null\)/);
  });

  it("the Record of Events chooser goes straight to the category's form: no intermediate screen, no confirmation step", () => {
    const ws = read(`${RECORD_DIR}/events-workspace.tsx`);
    assert.match(ws, /setView\(detailed \? \{ kind: "wizard", category: d\.value \} : \{ kind: "form", code: d\.code \}\)/);
    const host = read(`${RECORD_DIR}/wizard-host.tsx`);
    assert.doesNotMatch(host, /wizard-start|setStarted|Start<\/Button>/);
    assert.match(host, /headerSlot=/);
  });

  it("evidence and machine-ingestion capabilities are preserved", () => {
    const w = read(WIZARD);
    for (const needle of ["machineAcquisitionDraft", "evidenceCreatedId", "onRequestEvidenceUpload", "Upload / Add Document", "evidenceOnSavedEvent"]) assert.ok(w.includes(needle), `${needle} is still supported`);
    for (const f of ["lib/driver-performance-ingestion.ts", "lib/roadside-machine-schema.ts", "lib/roadside-machine-client.ts", "lib/machine-acquisition.ts"]) assert.ok(existsSync(f), `${f} is kept`);
    assert.match(read(`${RECORD_DIR}/event-detail.tsx`), /Check scan result and link/);
  });
});
