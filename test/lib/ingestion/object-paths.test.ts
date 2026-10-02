import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
import { asBatchId, asSourceFileId } from "../../../lib/ingestion/ids.ts";
import {
  InvalidObjectIdentityError,
  intakeObjectName,
  quarantineObjectName,
  // @ts-expect-error TS5097: same as above.
} from "../../../lib/ingestion/object-paths.ts";
// Cross-boundary COMPATIBILITY test only: the scanner is a separate deployable
// and application code never imports it. This test imports the scanner's pure
// path validator to prove the two sides agree, instead of sharing code.
import {
  deriveIntakeObjectName,
  parseQuarantineObjectName,
  // @ts-expect-error TS5097: same as above.
} from "../../../services/document-security-scanner/src/pathValidation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const read = (relative: string) => readFileSync(join(repoRoot, relative), "utf8");
/** Strips block and line comments so assertions inspect executable code, not explanatory prose. */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function canonicalIdentity(companyId = "acme-co_123") {
  return { companyId, batchId: asBatchId(randomUUID()), sourceFileId: asSourceFileId(randomUUID()) };
}

test("canonical application-generated batchId and sourceFileId pass the scanner's path validation", () => {
  for (let i = 0; i < 50; i += 1) {
    const identity = canonicalIdentity();
    const parsed = parseQuarantineObjectName(quarantineObjectName(identity));
    assert.deepEqual(parsed, identity);
  }
});

test("the canonical quarantine path has exactly the shape the scanner requires", () => {
  const identity = canonicalIdentity("company-1");
  assert.equal(
    quarantineObjectName(identity),
    `quarantine/company-1/${identity.batchId}/${identity.sourceFileId}/source`,
  );
});

test("the portal's intake path convention matches what the scanner promotes to", () => {
  const identity = canonicalIdentity();
  const parsed = parseQuarantineObjectName(quarantineObjectName(identity));
  assert.ok(parsed);
  assert.equal(deriveIntakeObjectName(parsed!), intakeObjectName(identity));
});

test("non-UUID batch/source ids cannot produce a quarantine path at all (the portal fails closed before the scanner would)", () => {
  const good = canonicalIdentity();
  assert.throws(() => quarantineObjectName({ ...good, batchId: asBatchId("batch-phaseb-clean-001") }), InvalidObjectIdentityError);
  assert.throws(() => quarantineObjectName({ ...good, sourceFileId: asSourceFileId("source-phaseb-clean-001") }), InvalidObjectIdentityError);
});

test("an unsafe companyId cannot produce a path (traversal, separators, empty, oversized)", () => {
  for (const companyId of ["../etc", "a/b", "", " ", "a".repeat(129), "co\nmpany"]) {
    assert.throws(() => quarantineObjectName(canonicalIdentity(companyId)), InvalidObjectIdentityError, JSON.stringify(companyId));
  }
});

test("every path the portal can produce is accepted by the scanner, and none is ever a path the scanner would treat as intake", () => {
  const identity = canonicalIdentity();
  const name = quarantineObjectName(identity);
  assert.ok(name.startsWith("quarantine/"));
  assert.equal(parseQuarantineObjectName(name.replace(/^quarantine\//, "intake/")), null);
});

test("the raw upload helper targets the QUARANTINE bucket and no raw-upload-to-Intake helper exists", () => {
  const storage = read("lib/google/storage.ts");
  assert.match(storage, /export async function uploadQuarantineObject\(/);
  assert.doesNotMatch(storage, /export async function uploadIntakeObject\b/);
  assert.doesNotMatch(storage, /uploadIntakeObject/);

  // The upload function body must resolve its bucket via quarantineBucket() and write create-only.
  const body = storage.slice(storage.indexOf("export async function uploadQuarantineObject("));
  const uploadFn = body.slice(0, body.indexOf("\n}\n") + 3);
  assert.match(uploadFn, /quarantineBucket\(\)\.file\(objectName\)/);
  assert.match(uploadFn, /saveCreateOnly\(/);
  assert.doesNotMatch(uploadFn, /intakeBucket\(\)/);
  assert.doesNotMatch(uploadFn, /evidenceBucket\(\)/);
});

test("no function in the portal's storage module writes raw bytes into the intake bucket", () => {
  const storage = read("lib/google/storage.ts");
  // Every write-capable call (save/copy) must be tied to quarantine (save) or evidence (promotion copy) - never an intake destination.
  assert.doesNotMatch(storage, /intakeBucket\(\)\.file\([^)]*\)\.save\(/);
  assert.doesNotMatch(storage, /saveCreateOnly\(intakeBucket\(\)/);
  const intakeCopyDestinations = storage.match(/intakeBucket\(\)\.file\([^)]*\);\s*\n\s*const destinationFile/g);
  assert.equal(intakeCopyDestinations, null, "intake must never be the destination of a copy in the portal");
});

test("document-intake cannot directly write raw bytes to Intake: it uses only the quarantine helper and the canonical quarantine path", () => {
  const route = code("app/api/document-intake/route.ts");
  assert.match(route, /import \{ uploadQuarantineObject \} from "@\/lib\/google\/storage"/);
  assert.match(route, /quarantineObjectName\(\{ companyId, batchId, sourceFileId \}\)/);
  assert.doesNotMatch(route, /uploadIntakeObject/);
  assert.doesNotMatch(route, /intakeBucketName/);
  assert.doesNotMatch(route, /`intake\//);
  assert.doesNotMatch(route, /"intake\//);
});

test("the upload response truthfully reports 'accepted into quarantine, unscanned' - never STORED/cleared", () => {
  const route = read("app/api/document-intake/route.ts");
  assert.match(route, /storageLocation: "QUARANTINE"/);
  assert.match(route, /securityState: "UNSCANNED"/);
  assert.match(route, /processingStatus: "RECEIVED"/);
  assert.match(route, /status: "RECEIVED"/);
  assert.doesNotMatch(route, /status: "STORED"/);
  assert.doesNotMatch(route, /processingStatus: "STORED"/);
  // A failed upload reports that nothing was stored.
  assert.match(route, /storageLocation: null/);
});

test("the route does not await, poll, or fabricate a scanner result", () => {
  const route = code("app/api/document-intake/route.ts");
  assert.doesNotMatch(route, /CLEARED|CLEAN\b|securityDecision/);
  assert.doesNotMatch(route, /document-security-scanner/);
});

test("the portal config exposes a quarantine bucket getter reading its own dedicated variable", () => {
  const config = read("lib/google/config.ts");
  assert.match(config, /export function quarantineBucketName\(\): string \{\s*return requireEnv\("GOOGLE_GCS_QUARANTINE_BUCKET"\)/);
});
