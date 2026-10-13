/**
 * Metadata-to-object consistency classification. Pure: it takes database rows and storage listings and returns findings.
 * Nothing here reads or writes storage; the audit service feeds it. Findings are for an operator - the audit never repairs,
 * moves or deletes anything.
 */

import { parseObjectKey } from "@/lib/evidence-payload/object-keys"
import type { AuditPayloadRow } from "@/lib/evidence-payload/types"

export type ListedObject = { name: string; generation: string; size: number }

export type ConsistencyFindingCode =
  | "MISSING_EVIDENCE_OBJECT"
  | "EVIDENCE_SIZE_MISMATCH"
  | "EVIDENCE_GENERATION_MISMATCH"
  | "MISSING_INTAKE_OBJECT"
  | "SCAN_STALLED"
  | "ORPHAN_QUARANTINE_OBJECT"
  | "ORPHAN_INTAKE_OBJECT"
  | "ORPHAN_EVIDENCE_OBJECT"
  | "UNRECOGNIZED_OBJECT"
  | "CROSS_TENANT_OBJECT"

export type ConsistencyFinding = {
  code: ConsistencyFindingCode
  severity: "critical" | "warning" | "info"
  /** Document / payload ids and the object name (server-side report only - never returned to a browser). */
  documentId: string | null
  objectName: string | null
}

export type ConsistencyInput = {
  rows: AuditPayloadRow[]
  quarantine?: ListedObject[]
  intake?: ListedObject[]
  evidence?: ListedObject[]
  now: Date
  /** A quarantined payload still absent from intake after this long is reported as stalled (scanner outage or unsafe file). */
  scanStallHours?: number
}

const READABLE = new Set(["stored", "superseded", "archived"])

export function classifyPayloadConsistency(input: ConsistencyInput): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = []
  const stallMs = (input.scanStallHours ?? 24) * 3_600_000
  const rowsByEvidence = new Map(input.rows.filter((row) => row.evidenceObjectName).map((row) => [row.evidenceObjectName as string, row]))
  const rowsByIntake = new Map(input.rows.map((row) => [intakeNameOf(row), row]))
  const rowsByQuarantine = new Map(input.rows.map((row) => [row.quarantineObjectName, row]))

  const evidenceListing = input.evidence ? new Map(input.evidence.map((object) => [object.name, object])) : null
  const intakeListing = input.intake ? new Map(input.intake.map((object) => [object.name, object])) : null

  for (const row of input.rows) {
    if (evidenceListing && row.evidenceObjectName && READABLE.has(row.state)) {
      const object = evidenceListing.get(row.evidenceObjectName)
      if (!object) findings.push({ code: "MISSING_EVIDENCE_OBJECT", severity: "critical", documentId: row.documentId, objectName: row.evidenceObjectName })
      else {
        if (object.size !== row.byteSize) findings.push({ code: "EVIDENCE_SIZE_MISMATCH", severity: "critical", documentId: row.documentId, objectName: row.evidenceObjectName })
        if (row.evidenceGeneration && object.generation !== row.evidenceGeneration) {
          findings.push({ code: "EVIDENCE_GENERATION_MISMATCH", severity: "critical", documentId: row.documentId, objectName: row.evidenceObjectName })
        }
      }
    }
    if (intakeListing && row.state === "cleared" && row.intakeObjectName && !intakeListing.has(row.intakeObjectName)) {
      findings.push({ code: "MISSING_INTAKE_OBJECT", severity: "warning", documentId: row.documentId, objectName: row.intakeObjectName })
    }
    if (intakeListing && row.state === "quarantined" && !intakeListing.has(intakeNameOf(row)) && input.now.getTime() - new Date(row.createdAt).getTime() > stallMs) {
      findings.push({ code: "SCAN_STALLED", severity: "warning", documentId: row.documentId, objectName: row.quarantineObjectName })
    }
  }

  const orphans = (listing: ListedObject[] | undefined, stage: "quarantine" | "intake" | "evidence") => {
    for (const object of listing ?? []) {
      const parsed = parseObjectKey(object.name)
      if (!parsed || parsed.stage !== stage) {
        findings.push({ code: "UNRECOGNIZED_OBJECT", severity: "warning", documentId: null, objectName: object.name })
        continue
      }
      const row = stage === "evidence" ? rowsByEvidence.get(object.name) : stage === "intake" ? rowsByIntake.get(object.name) : rowsByQuarantine.get(object.name)
      if (!row) {
        findings.push({
          code: stage === "evidence" ? "ORPHAN_EVIDENCE_OBJECT" : stage === "intake" ? "ORPHAN_INTAKE_OBJECT" : "ORPHAN_QUARANTINE_OBJECT",
          severity: stage === "evidence" ? "critical" : "warning",
          documentId: null,
          objectName: object.name,
        })
      } else if (row.organizationId !== parsed.organizationId) {
        findings.push({ code: "CROSS_TENANT_OBJECT", severity: "critical", documentId: row.documentId, objectName: object.name })
      }
    }
  }
  orphans(input.quarantine, "quarantine")
  orphans(input.intake, "intake")
  orphans(input.evidence, "evidence")
  return findings
}

function intakeNameOf(row: AuditPayloadRow): string {
  return row.intakeObjectName ?? row.quarantineObjectName.replace(/^quarantine\//, "intake/")
}
