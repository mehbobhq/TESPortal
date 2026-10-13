// In-memory EvidenceStoragePort for tests. It enforces the same semantics the real GCS adapter relies on:
// create-only writes, pinned (generation) reads, no delete, and a separate "scanner" that alone writes intake.

import { createHash } from "node:crypto";

type StoredObject = { generation: string; bytes: Buffer };
type Stage = "quarantine" | "intake" | "evidence";

export class FakeEvidenceStorage {
  readonly buckets = { quarantine: "tes-test-quarantine", intake: "tes-test-intake", evidence: "tes-test-evidence" };
  readonly stages: Record<Stage, Map<string, StoredObject[]>> = { quarantine: new Map(), intake: new Map(), evidence: new Map() };
  readonly calls: string[] = [];
  /** Optional hook run immediately before bytes are read from evidence (to prove ordering against the database). */
  beforeEvidenceRead: ((objectName: string) => Promise<void>) | null = null;
  private generationCounter = 1000;

  private nextGeneration(): string {
    this.generationCounter += 1;
    return String(this.generationCounter);
  }

  private live(stage: Stage, name: string): StoredObject | null {
    const versions = this.stages[stage].get(name);
    return versions && versions.length > 0 ? versions[versions.length - 1] : null;
  }

  private write(stage: Stage, name: string, bytes: Buffer): StoredObject {
    const object = { generation: this.nextGeneration(), bytes };
    this.stages[stage].set(name, [...(this.stages[stage].get(name) ?? []), object]);
    return object;
  }

  count(stage: Stage): number {
    return this.stages[stage].size;
  }

  // --- the scanner (a separate component in production; the only writer of intake) -------------------------------

  scannerPromote(quarantineName: string, tamper?: (bytes: Buffer) => Buffer): string {
    const source = this.live("quarantine", quarantineName);
    if (!source) throw new Error(`no quarantine object ${quarantineName}`);
    const intakeName = quarantineName.replace(/^quarantine\//, "intake/");
    this.write("intake", intakeName, tamper ? tamper(source.bytes) : Buffer.from(source.bytes));
    return intakeName;
  }

  /** Simulates storage corruption / tampering of an object already at rest. */
  corrupt(stage: Stage, name: string): void {
    this.write(stage, name, Buffer.from("tampered"));
  }

  seed(stage: Stage, name: string, bytes: Buffer): void {
    this.write(stage, name, bytes);
  }

  names(stage: Stage): string[] {
    return [...this.stages[stage].keys()];
  }

  // --- EvidenceStoragePort -----------------------------------------------------------------------------------------

  bucketNames() {
    return this.buckets;
  }

  async putQuarantine(objectName: string, bytes: Buffer): Promise<{ generation: string | null }> {
    this.calls.push(`putQuarantine:${objectName}`);
    if (this.live("quarantine", objectName)) throw new Error("create-only violation: object exists");
    return { generation: this.write("quarantine", objectName, Buffer.from(bytes)).generation };
  }

  async statIntake(objectName: string) {
    this.calls.push(`statIntake:${objectName}`);
    const object = this.live("intake", objectName);
    return object ? { generation: object.generation, size: object.bytes.byteLength } : null;
  }

  async readIntake(objectName: string, generation: string): Promise<Buffer> {
    this.calls.push(`readIntake:${objectName}`);
    const object = (this.stages.intake.get(objectName) ?? []).find((item) => item.generation === generation);
    if (!object) throw new Error("pinned generation not found");
    return Buffer.from(object.bytes);
  }

  async copyIntakeToEvidence(intakeName: string, intakeGeneration: string, evidenceName: string) {
    this.calls.push(`copyIntakeToEvidence:${evidenceName}`);
    const source = (this.stages.intake.get(intakeName) ?? []).find((item) => item.generation === intakeGeneration);
    if (!source) throw new Error("pinned intake generation not found");
    if (this.live("evidence", evidenceName)) return { created: false, generation: null };
    return { created: true, generation: this.write("evidence", evidenceName, Buffer.from(source.bytes)).generation };
  }

  async statEvidence(objectName: string) {
    this.calls.push(`statEvidence:${objectName}`);
    const object = this.live("evidence", objectName);
    return object ? { generation: object.generation, size: object.bytes.byteLength } : null;
  }

  async readEvidence(objectName: string, generation?: string): Promise<Buffer> {
    this.calls.push(`readEvidence:${objectName}`);
    if (this.beforeEvidenceRead) await this.beforeEvidenceRead(objectName);
    const versions = this.stages.evidence.get(objectName) ?? [];
    const object = generation ? versions.find((item) => item.generation === generation) : versions[versions.length - 1];
    if (!object) throw new Error("evidence object not found");
    return Buffer.from(object.bytes);
  }

  async listObjects(stage: Stage, prefix: string) {
    this.calls.push(`list:${stage}:${prefix}`);
    const objects = [...this.stages[stage].keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => {
        const object = this.live(stage, name) as StoredObject;
        return { name, generation: object.generation, size: object.bytes.byteLength };
      });
    return { objects, nextPageToken: null };
  }
}

export const sha256 = (bytes: Buffer | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A minimal but valid-looking PDF (magic bytes pass); content is unique per call. */
export function samplePdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`);
}
