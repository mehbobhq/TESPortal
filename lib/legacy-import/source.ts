import { createHash } from "node:crypto"
import type { LegacyImportEntityType, PreparedLegacySourceRecord } from "./types"

const SOURCE_SYSTEM_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const CONTROL_CHARS = /[\x01-\x1F\x7F]/

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stable(record[key])]))
  }
  return value
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stable(value))
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function requireClean(value: string, label: string, max: number): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed !== value || trimmed.length > max || CONTROL_CHARS.test(trimmed)) {
    throw new Error(`Invalid ${label}.`)
  }
  return trimmed
}

export function prepareLegacySourceRecord(input: {
  importBatchId: string
  sourceSystem: string
  sourceNamespace: string
  legacyEntityType: LegacyImportEntityType
  legacyId: string
  sourceKey?: string
  sourceSnapshot: Record<string, unknown>
  parentLegacyIds?: Record<string, unknown>
  supportedFields?: readonly string[]
}): PreparedLegacySourceRecord {
  if (!SOURCE_SYSTEM_PATTERN.test(input.sourceSystem)) throw new Error("Invalid source system.")
  const sourceNamespace = requireClean(input.sourceNamespace, "source namespace", 200)
  const legacyId = requireClean(input.legacyId, "legacy id", 200)
  const sourceKey = requireClean(
    input.sourceKey ?? `${input.legacyEntityType}:${legacyId}`,
    "source key",
    500,
  )
  if (!input.sourceSnapshot || Array.isArray(input.sourceSnapshot) || typeof input.sourceSnapshot !== "object") {
    throw new Error("Legacy source snapshot must be an object.")
  }

  const supported = new Set(input.supportedFields ?? [])
  const sourceUnsupportedFields = input.supportedFields
    ? Object.keys(input.sourceSnapshot).filter((key) => !supported.has(key)).sort()
    : []

  return {
    importBatchId: input.importBatchId,
    sourceSystem: input.sourceSystem,
    sourceNamespace,
    legacyEntityType: input.legacyEntityType,
    legacyId,
    sourceKey,
    sourceSha256: sha256(input.sourceSnapshot),
    sourceSnapshot: input.sourceSnapshot,
    parentLegacyIds: input.parentLegacyIds ?? {},
    unsupportedFields: sourceUnsupportedFields,
    sourceUnsupportedFields,
  }
}
