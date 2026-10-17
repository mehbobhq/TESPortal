/**
 * Evidence payload lifecycle definitions: controlled vocabularies and pure rules. No I/O, no framework imports.
 *
 * Lifecycle (migration 0032 enforces the same transitions in the database):
 *
 *   quarantined --(scanner promoted it to intake; hash + size verified)--> cleared
 *   cleared     --(create-only copy into the evidence bucket; hash re-verified)--> stored
 *   stored      --> superseded | archived          (nothing is ever deleted)
 *   quarantined | cleared --> blocked              (terminal safety state; needs a human)
 */

export const LIFECYCLE_STATES = ["quarantined", "cleared", "stored", "blocked", "superseded", "archived"] as const
export type LifecycleState = (typeof LIFECYCLE_STATES)[number]

export const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  quarantined: ["cleared", "blocked", "archived"],
  cleared: ["stored", "blocked", "archived"],
  stored: ["superseded", "archived"],
  blocked: ["archived"],
  superseded: ["archived"],
  archived: [],
}

export function canTransitionPayload(from: LifecycleState, to: LifecycleState): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to)
}

/** States in which the evidence-bucket object exists and may be viewed. */
export const VIEWABLE_STATES: readonly LifecycleState[] = ["stored", "superseded", "archived"]

export const BLOCK_REASONS = ["INTEGRITY_MISMATCH", "EVIDENCE_HASH_MISMATCH", "SCAN_NOT_CLEARED", "OPERATOR_BLOCKED"] as const
export type BlockReason = (typeof BLOCK_REASONS)[number]

/** Same set the document-security-scanner recognizes. */
export const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"] as const
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

/** Named and centralized; the database CHECK (evidence_payloads_size_valid) uses the same ceiling. */
export const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024

export const MAX_FILENAME_LENGTH = 255
export const FILENAME_FALLBACK = "uploaded-document"

export const DOCUMENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,80}$/
export const TITLE_MAX_LENGTH = 240

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === "string" && (LIFECYCLE_STATES as readonly string[]).includes(value)
}

export function isAllowedMimeType(value: unknown): value is AllowedMimeType {
  return typeof value === "string" && (ALLOWED_MIME_TYPES as readonly string[]).includes(value)
}

export function isBlockReason(value: unknown): value is BlockReason {
  return typeof value === "string" && (BLOCK_REASONS as readonly string[]).includes(value)
}

/**
 * Evidence requirements a stored, verified document can satisfy. The requirement code equals the document type (the same
 * convention lib/customer-onboarding uses), so the server derives the requirement from the document - never from client input.
 */
export const REQUIREMENT_CATALOGUE: Readonly<Record<string, { label: string; requiredFor: "organization" | "service_scope" | "responsibility" | "settings" | "authority_roles" | "contract" }>> = {
  CUSTOMER_AUTHORITY_NOTICE: { label: "Written company notice naming Service Decision Authority and Contract Signatory", requiredFor: "authority_roles" },
  CUSTOMER_ONBOARDING_PACKAGE: { label: "Customer onboarding package or engagement instruction", requiredFor: "organization" },
  SERVICE_SCOPE_CONFIRMATION: { label: "Customer confirmation of selected TES service scope", requiredFor: "service_scope" },
  RESPONSIBILITY_START_CONFIRMATION: { label: "Evidence of TES responsibility start boundary", requiredFor: "responsibility" },
  REQUIRED_SETTINGS_CONFIRMATION: { label: "Evidence supporting required onboarding settings", requiredFor: "settings" },
}

/** Document types the upload UI offers: the requirement types plus the contract evidence types (lib/contracts). */
export const KNOWN_DOCUMENT_TYPES: readonly string[] = [
  ...Object.keys(REQUIREMENT_CATALOGUE),
  "PRICING_PACKAGE_CONFIRMATION",
  "SIGNED_CONTRACT_DOCUMENT",
  "CONTRACT_READY_CONFIRMATION",
  "HISTORY_RECORDS",
  "OTHER_EVIDENCE",
]

/**
 * Evidence ASSOCIATION (the existing public.evidence_links table, migration 0030).
 *
 * The associable targets are a deliberate SUBSET of the targets the 0030 CHECK allows. Every one is a record that belongs to exactly
 * one organization (it carries organization_id), so an association can always be proven to be the requesting organization's.
 * Global identities (vehicles, driver profiles / persons) are excluded: a global vehicle or person is shared across organizations,
 * so evidence attaches to the organization's own relationship row instead. Credentials, credential systems, customer engagement and
 * contract targets are excluded on purpose (secret-adjacent, or owned by other lifecycles).
 *
 * `readCapability` is the SYSTEM capability the actor must ALSO hold to associate with that kind of record: row-level security
 * lets only that domain's capability read the target row, and association must never let an actor attach to a record it cannot see.
 */
export const EVIDENCE_LINK_TARGETS = {
  organizations: { label: "Company", readCapability: "ORGANIZATION_REGISTRY_READ" },
  operating_authorities: { label: "Operating authority", readCapability: "ORGANIZATION_REGISTRY_READ" },
  registrations: { label: "Tax registration", readCapability: "TAX_REGISTRATION_READ" },
  insurance_policies: { label: "Insurance policy", readCapability: "INSURANCE_READ" },
  organization_vehicle_relationships: { label: "Company vehicle record", readCapability: "VEHICLE_READ" },
  organization_driver_relationships: { label: "Company driver record", readCapability: "DRIVER_READ" },
} as const
export type EvidenceLinkTargetTable = keyof typeof EVIDENCE_LINK_TARGETS

/**
 * Relationship types this service writes. The database also allows authority_notice, contract_attachment and readiness_requirement;
 * those belong to the onboarding and contract lifecycles and are not written here. An association states that a document is
 * attached to a record. It never states that the document is verified or that the record is compliant.
 */
export const EVIDENCE_LINK_RELATIONSHIPS = ["supports", "source"] as const
export type EvidenceLinkRelationship = (typeof EVIDENCE_LINK_RELATIONSHIPS)[number]

/** Target record statuses that cannot receive new evidence: a value entered in error, or one superseded by a correction. */
export const INELIGIBLE_TARGET_STATUSES: readonly string[] = ["voided", "corrected"]

export function isEvidenceLinkTarget(value: unknown): value is EvidenceLinkTargetTable {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EVIDENCE_LINK_TARGETS, value)
}

export function isEvidenceLinkRelationship(value: unknown): value is EvidenceLinkRelationship {
  return typeof value === "string" && (EVIDENCE_LINK_RELATIONSHIPS as readonly string[]).includes(value)
}
