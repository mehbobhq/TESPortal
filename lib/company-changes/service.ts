import "server-only"

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import type { TesSystemCapability } from "@/lib/auth/tes-capabilities"
import {
  hasAdditionalSystemCapability,
  requireAdditionalSystemCapability,
  withAuthorizedSystem,
  type SystemAuthorizationDecision,
} from "@/lib/auth/tes-system-context"
import { domainContext, enterSystemCapability, runDeferredChecks } from "@/lib/company-directory/capability-context"
import {
  CHANNEL_CONFIRMATION_EVIDENCE_TYPE,
  CHANNEL_REQUEST_SOURCES,
  CONFIRMATION_METHODS,
  LEGAL_NAME_REQUEST_SOURCES,
  LEGAL_NAME_ROLE_TO_COLUMN,
  LEGAL_NAME_ROLE_TO_TYPE,
  OPERATION_LABELS,
  REQUESTER_BASES,
  channelOperation,
  sameChannelValue,
  type Blocker,
  type ChannelChangeKind,
  type ChannelKind,
  type LegalNameEvidenceRole,
  type RequesterBasis,
} from "@/lib/company-changes/definitions"
import { CompanyChangeBlockedStateError, CompanyChangeNotFoundError, CompanyChangeStateError, CompanyChangeValidationError } from "@/lib/company-changes/errors"
import { appendChange, listLedger, type LedgerRow } from "@/lib/company-changes/ledger"
import { migration0036Message, migration0036State } from "@/lib/company-changes/schema-state"
import { prepareChannel } from "@/lib/contacts/definitions"
import * as contactOperations from "@/lib/contacts/operations"
import * as corporateOperations from "@/lib/corporate-identity/operations"
import { listEvidence } from "@/lib/evidence-payload/operations"
import type { EvidenceItemView } from "@/lib/evidence-payload/types"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import { recordEvent } from "@/lib/master-register/record-event"

export * from "@/lib/company-changes/errors"
export { ACTIVITY_GROUPS, OPERATION_LABELS } from "@/lib/company-changes/definitions"

/**
 * Company change accountability service: the registered legal-name gate, sensitive channel confirmation and the Company Activity read.
 *
 *   caller -> this service -> withAuthorizedSystem (authorization + one transaction) -> domain operations -> PostgreSQL + Master Register
 *
 * Every rule here is enforced on the SERVER, on the same transaction as the change; none depends on the UI. A displayed job title never
 * grants anything: authority is a capability, the current Primary Contact designation, or a linked and verified document.
 *
 * Legal-name change (all four needed on the executing actor; the Master Account satisfies every capability):
 *   ORGANIZATION_UPDATE        create / attach / withdraw a request
 *   COMPANY_LEGAL_NAME_CHANGE  EXECUTE it (the Onboarding Team grant; nobody gets it from a title)
 *   EVIDENCE_READ              the linked documents must be read to prove they are verified and stored
 *   PERSON_REGISTRY_READ       the requester's CURRENT standing is read
 * Channel confirmation: CONTACT_MANAGE + PERSON_REGISTRY_READ.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !UUID.test(value.trim())) throw new CompanyChangeValidationError(field, `${field} must be a UUID.`)
  return value.trim().toLowerCase()
}
const optionalUuid = (value: unknown, field: string): string | null => (value === undefined || value === null || value === "" ? null : uuid(value, field))
const text = (value: unknown, field: string, min: number, max: number): string => {
  const out = typeof value === "string" ? value.trim() : ""
  if (out.length < min || out.length > max) throw new CompanyChangeValidationError(field, `${field} must be ${min} to ${max} characters.`)
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(out)) throw new CompanyChangeValidationError(field, `${field} contains control characters.`)
  return out
}
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new CompanyChangeValidationError(field, `${field} must be one of ${allowed.join(", ")}.`)
  return value as T
}

/** Every 0036 workflow needs the whole migration: an absent or partly applied one is refused with an explanation, before anything is read or written. */
async function requireTracking(client: PoolClient, what: string): Promise<void> {
  const state = await migration0036State(client)
  if (state !== "COMPLETE") throw new CompanyChangeStateError(migration0036Message(state, what))
}

/** A mandatory state transition that touched no row (or the wrong number) is a failure: the transaction is aborted instead of reporting success. */
function mustAffectOneRow(rowCount: number | null, what: string): void {
  if (rowCount !== 1) throw new CompanyChangeStateError(`${what}; nothing was saved.`)
}

function eventContext(client: PoolClient, decision: SystemAuthorizationDecision) {
  return { client, actor: { id: decision.actor.id, actorType: decision.actor.actorType }, masterRegister: new PostgresMasterRegisterRepository(client) }
}

async function recordAccountabilityEvent(
  client: PoolClient,
  decision: SystemAuthorizationDecision,
  operation: string,
  organizationId: string,
  resourceType: string,
  resourceId: string,
  evidenceReferences: string[],
  fields: Array<{ field: string; before?: { kind: "LITERAL"; value: string | number | boolean | null }; after?: { kind: "LITERAL"; value: string | number | boolean | null } | { kind: "REFERENCE"; reference: string } }>,
): Promise<string> {
  const event = await recordEvent(new PostgresMasterRegisterRepository(client), {
    eventType: "RECORD_UPDATED",
    actor: { actorType: decision.actor.actorType, actorId: decision.actor.id },
    action: { operation },
    target: { resourceType, resourceId, companyId: organizationId, subjectReferences: [`organization:${organizationId}`] },
    source: { sourceType: "APPLICATION", component: "company-changes", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fields.map((f) => f.field), fieldChanges: fields },
    ...(evidenceReferences.length > 0 ? { evidence: { evidenceReferences } } : {}),
    outcome: { result: "SUCCESS" },
  } as never)
  return (event as { eventId: string }).eventId
}

// --- evidence checks (pure over what listEvidence returns) ---------------------------------------------------------------

/**
 * A document supports a legal-name change only when it is of the right TYPE, has been VERIFIED by a reviewer, and its payload is STORED with
 * its integrity checked: an unreviewed upload, a quarantined or blocked file, or a document of another kind never counts.
 */
export function evidenceBlockers(role: LegalNameEvidenceRole, label: string, documentId: string | null, items: EvidenceItemView[]): Blocker[] {
  if (!documentId) return [{ code: `${role}_MISSING`, message: `${label} is not linked.` }]
  const item = items.find((entry) => entry.documentId === documentId)
  if (!item) return [{ code: `${role}_NOT_FOUND`, message: `${label} could not be found for this company.` }]
  const out: Blocker[] = []
  if (item.documentType !== LEGAL_NAME_ROLE_TO_TYPE[role]) out.push({ code: `${role}_WRONG_TYPE`, message: `${label} must be a ${LEGAL_NAME_ROLE_TO_TYPE[role]} document.` })
  if (item.documentStatus !== "verified") out.push({ code: `${role}_NOT_VERIFIED`, message: `${label} has not been verified by a reviewer.` })
  if (item.payload.state !== "stored" || !item.payload.integrityVerified) out.push({ code: `${role}_NOT_STORED`, message: `${label} is not securely stored with verified integrity.` })
  return out
}

// --- legal-name change ---------------------------------------------------------------------------------------------------

type LegalRequestRow = {
  id: string
  organization_id: string
  previous_legal_name: string
  requested_legal_name: string
  status: "PENDING" | "APPLIED" | "REJECTED" | "WITHDRAWN"
  requested_by_person_id: string
  requester_relationship_id: string
  requester_basis: RequesterBasis
  requester_authority_assignment_id: string | null
  request_source: string
  request_reference: string
  request_received_at: Date
  government_evidence_document_id: string | null
  written_request_evidence_document_id: string | null
  director_evidence_document_id: string | null
  effective_at: Date | null
  recorded_at: Date
  decided_at: Date | null
  decision_reason: string | null
}

export type LegalNameRequestView = {
  id: string
  status: LegalNameRequestRow["status"]
  previousLegalName: string
  requestedLegalName: string
  requesterBasis: RequesterBasis
  requesterAuthorityAssignmentId: string | null
  requestedByPersonId: string
  requestSource: string
  requestReference: string
  requestReceivedAt: string
  governmentEvidenceDocumentId: string | null
  writtenRequestEvidenceDocumentId: string | null
  directorEvidenceDocumentId: string | null
  recordedAt: string
  decidedAt: string | null
  decisionReason: string | null
  effectiveAt: string | null
}
type LegalNameRequestRow = LegalRequestRow

const toLegalView = (row: LegalRequestRow): LegalNameRequestView => ({
  id: row.id,
  status: row.status,
  previousLegalName: row.previous_legal_name,
  requestedLegalName: row.requested_legal_name,
  requesterBasis: row.requester_basis,
  requesterAuthorityAssignmentId: row.requester_authority_assignment_id,
  requestedByPersonId: row.requested_by_person_id,
  requestSource: row.request_source,
  requestReference: row.request_reference,
  requestReceivedAt: row.request_received_at.toISOString(),
  governmentEvidenceDocumentId: row.government_evidence_document_id,
  writtenRequestEvidenceDocumentId: row.written_request_evidence_document_id,
  directorEvidenceDocumentId: row.director_evidence_document_id,
  recordedAt: row.recorded_at.toISOString(),
  decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
  decisionReason: row.decision_reason,
  effectiveAt: row.effective_at ? row.effective_at.toISOString() : null,
})

const LEGAL_COLUMNS = `id, organization_id, previous_legal_name, requested_legal_name, status, requested_by_person_id, requester_relationship_id, requester_basis, requester_authority_assignment_id, request_source,
  request_reference, request_received_at, government_evidence_document_id, written_request_evidence_document_id, director_evidence_document_id, effective_at, recorded_at, decided_at, decision_reason`

async function loadLegalRequest(client: PoolClient, organizationId: string, requestId: string, forUpdate = false): Promise<LegalRequestRow> {
  const result = await client.query<LegalRequestRow>(`SELECT ${LEGAL_COLUMNS} FROM public.company_legal_name_change_requests WHERE id = $1 AND organization_id = $2 ${forUpdate ? "FOR UPDATE" : ""}`, [requestId, organizationId])
  if (!result.rows[0]) throw new CompanyChangeNotFoundError("Legal-name change request")
  return result.rows[0]
}

/**
 * The ACTIVE customer authority (Service Decision Authority or Contract Signatory) a person holds for this company, from the contract-authority
 * records. Needs CONTRACT_READ in force. null when the person holds none.
 */
async function currentCustomerAuthority(client: PoolClient, organizationId: string, personId: string): Promise<{ id: string; authorityType: string; noticeEvidenceDocumentId: string | null } | null> {
  const result = await client.query<{ id: string; authority_type: string; notice_evidence_document_id: string | null }>(
    `SELECT id, authority_type, notice_evidence_document_id
       FROM public.customer_authority_assignments
      WHERE organization_id = $1 AND person_id = $2 AND assignment_status = 'active' AND effective_to IS NULL
      ORDER BY (authority_type = 'SERVICE_DECISION_AUTHORITY') DESC, effective_from DESC LIMIT 1`,
    [organizationId, personId],
  )
  const row = result.rows[0]
  return row ? { id: row.id, authorityType: row.authority_type, noticeEvidenceDocumentId: row.notice_evidence_document_id } : null
}

/**
 * Which current contacts may ASK for a legal-name change on the strength of a customer authority they hold now (the Service Decision
 * Authority and the Contract Signatory; they may be the same person). Needs CONTRACT_READ; without it `restricted` is reported, never a guess.
 */
export async function legalNameRequesterAuthorities(organizationId: string): Promise<{ restricted: boolean; holders: Array<{ personId: string; authorityTypes: string[] }> }> {
  const org = uuid(organizationId, "organizationId")
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", async (client, decision) => {
    if (!(await hasAdditionalSystemCapability(client, decision, "CONTRACT_READ"))) return { restricted: true, holders: [] }
    await enterSystemCapability(client, "CONTRACT_READ")
    const result = await client.query<{ person_id: string; authority_type: string }>(
      `SELECT person_id, authority_type FROM public.customer_authority_assignments WHERE organization_id = $1 AND assignment_status = 'active' AND effective_to IS NULL ORDER BY authority_type`,
      [org],
    )
    const byPerson = new Map<string, string[]>()
    for (const row of result.rows) byPerson.set(row.person_id, [...(byPerson.get(row.person_id) ?? []), row.authority_type])
    return { restricted: false, holders: [...byPerson].map(([personId, authorityTypes]) => ({ personId, authorityTypes })) }
  })
}

/** Records a REQUEST. It never changes the legal name: the canonical name stays as it is until the request is executed under the gate. */
export async function requestLegalNameChange(input: Record<string, unknown>): Promise<LegalNameRequestView> {
  const organizationId = uuid(input.organizationId, "organizationId")
  const requestedName = text(input.requestedLegalName, "requestedLegalName", 1, 240)
  const personId = uuid(input.requestedByPersonId, "requestedByPersonId")
  const relationshipId = uuid(input.requesterRelationshipId, "requesterRelationshipId")
  const basis = oneOf(input.requesterBasis, REQUESTER_BASES, "requesterBasis")
  const source = oneOf(input.requestSource, LEGAL_NAME_REQUEST_SOURCES, "requestSource")
  const reference = text(input.requestReference, "requestReference", 3, 500)
  const receivedAt = typeof input.requestReceivedAt === "string" ? new Date(input.requestReceivedAt) : null
  if (!receivedAt || Number.isNaN(receivedAt.getTime()) || receivedAt.getTime() > Date.now() + 60_000) throw new CompanyChangeValidationError("requestReceivedAt", "Say when the written request was received (not in the future).")
  const evidence = {
    government_evidence_document_id: optionalUuid(input.governmentEvidenceDocumentId, "governmentEvidenceDocumentId"),
    written_request_evidence_document_id: optionalUuid(input.writtenRequestEvidenceDocumentId, "writtenRequestEvidenceDocumentId"),
    director_evidence_document_id: optionalUuid(input.directorEvidenceDocumentId, "directorEvidenceDocumentId"),
  }
  return withAuthorizedSystem("ORGANIZATION_UPDATE", async (client, decision) => {
    await requireTracking(client, "Changing the registered legal name")
    // A request is accepted only from an AUTHORIZED representative. A customer authority is looked up in the contract-authority records (never
    // taken from the input, and never inferred from a Primary Contact designation); a Director is proven later by a verified document.
    let authorityAssignmentId: string | null = null
    if (basis === "CUSTOMER_AUTHORITY") {
      await requireAdditionalSystemCapability(client, decision, "CONTRACT_READ")
      await enterSystemCapability(client, "CONTRACT_READ")
      const held = await currentCustomerAuthority(client, organizationId, personId)
      if (!held) {
        throw new CompanyChangeValidationError(
          "requestedByPersonId",
          "This person does not currently hold a Service Decision Authority or Contract Signatory role for this company, so they cannot request a legal-name change. A Primary Contact designation does not give that authority. Use a Director with a verified authority document instead.",
        )
      }
      authorityAssignmentId = held.id
      await enterSystemCapability(client, "ORGANIZATION_UPDATE")
    }
    const organization = await client.query<{ legal_name: string }>(`SELECT legal_name FROM public.organizations WHERE id = $1 FOR UPDATE`, [organizationId])
    if (!organization.rows[0]) throw new CompanyChangeNotFoundError("Company")
    const previous = organization.rows[0].legal_name
    if (requestedName === previous) throw new CompanyChangeValidationError("requestedLegalName", "That is already the registered legal name.")
    const id = randomUUID()
    try {
      await client.query(
        `INSERT INTO public.company_legal_name_change_requests
           (id, organization_id, previous_legal_name, requested_legal_name, requested_by_person_id, requester_relationship_id, requester_basis, request_source, request_reference,
            request_received_at, government_evidence_document_id, written_request_evidence_document_id, director_evidence_document_id, recorded_by_actor_id, requester_authority_assignment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [id, organizationId, previous, requestedName, personId, relationshipId, basis, source, reference, receivedAt.toISOString(), evidence.government_evidence_document_id, evidence.written_request_evidence_document_id, evidence.director_evidence_document_id, decision.actor.id, authorityAssignmentId],
      )
    } catch (error) {
      const constraint = (error as { constraint?: string }).constraint ?? ""
      if (constraint === "legal_name_requests_one_pending_uq") throw new CompanyChangeStateError("A legal-name change request is already pending for this company.")
      if (constraint.startsWith("legal_name_requests_requester_relationship")) throw new CompanyChangeValidationError("requesterRelationshipId", "The requester is not a contact of this company.")
      if (constraint.startsWith("legal_name_requests_authority")) throw new CompanyChangeValidationError("requestedByPersonId", "The requester's authority is not recorded for this company.")
      if (constraint.endsWith("_evidence_fk")) throw new CompanyChangeValidationError("evidence", "A linked document was not found for this company.")
      throw error
    }
    const ids = Object.values(evidence).filter((v): v is string => v !== null)
    const eventId = await recordAccountabilityEvent(client, decision, "requestLegalNameChange", organizationId, "company_legal_name_change_request", id, ids.map((d) => `evidence_documents:${d}`), [{ field: "legalNameChangeRequest", after: { kind: "REFERENCE", reference: `company_legal_name_change_requests:${id}` } }])
    await appendChange(client, {
      organizationId, actorId: decision.actor.id, operation: "LEGAL_NAME_CHANGE_REQUESTED", summary: "Legal name change requested (pending: the registered legal name is unchanged)",
      previous: previous, next: requestedName, source: "COMPANY_WRITTEN_REQUEST", request: { table: "company_legal_name_change_requests", id }, eventId,
    })
    return toLegalView(await loadLegalRequest(client, organizationId, id))
  })
}

/** Links (or replaces, while pending) one piece of evidence on a pending request. The document must belong to this company. */
export async function attachLegalNameEvidence(input: Record<string, unknown>): Promise<LegalNameRequestView> {
  const organizationId = uuid(input.organizationId, "organizationId")
  const requestId = uuid(input.requestId, "requestId")
  const role = oneOf(input.role, ["GOVERNMENT_DOCUMENT", "WRITTEN_REQUEST", "DIRECTOR_VERIFICATION"] as const, "role")
  const documentId = uuid(input.documentId, "documentId")
  return withAuthorizedSystem("ORGANIZATION_UPDATE", async (client, decision) => {
    await requireTracking(client, "Changing the registered legal name")
    const request = await loadLegalRequest(client, organizationId, requestId, true)
    if (request.status !== "PENDING") throw new CompanyChangeStateError("This request has already been decided; start a new request.")
    try {
      const linked = await client.query(`UPDATE public.company_legal_name_change_requests SET ${LEGAL_NAME_ROLE_TO_COLUMN[role]} = $2, updated_at = clock_timestamp() WHERE id = $1 AND status = 'PENDING'`, [requestId, documentId])
      mustAffectOneRow(linked.rowCount, "The evidence could not be linked to the request")
    } catch (error) {
      if (((error as { constraint?: string }).constraint ?? "").endsWith("_evidence_fk")) throw new CompanyChangeValidationError("documentId", "The document was not found for this company.")
      throw error
    }
    await recordAccountabilityEvent(client, decision, "attachLegalNameEvidence", organizationId, "company_legal_name_change_request", requestId, [`evidence_documents:${documentId}`], [{ field: role, after: { kind: "REFERENCE", reference: `evidence_documents:${documentId}` } }])
    return toLegalView(await loadLegalRequest(client, organizationId, requestId))
  })
}

/** Reads the requester's CURRENT standing and reports every blocker for executing the request. Shared by the UI's "ready?" and by apply. */
async function legalNameBlockers(client: PoolClient, decision: SystemAuthorizationDecision, request: LegalRequestRow): Promise<Blocker[]> {
  const blockers: Blocker[] = []
  if (request.status !== "PENDING") return [{ code: "NOT_PENDING", message: "The request has already been decided." }]

  await enterSystemCapability(client, "EVIDENCE_READ")
  const items = await listEvidence(client, request.organization_id)
  blockers.push(...evidenceBlockers("GOVERNMENT_DOCUMENT", "The government-issued document establishing the new legal name", request.government_evidence_document_id, items))
  blockers.push(...evidenceBlockers("WRITTEN_REQUEST", "The company's written request", request.written_request_evidence_document_id, items))
  if (request.requester_basis === "VERIFIED_DIRECTOR") {
    blockers.push(...evidenceBlockers("DIRECTOR_VERIFICATION", "The document evidencing the Director's authority (a title alone is not proof)", request.director_evidence_document_id, items))
  }

  await enterSystemCapability(client, "PERSON_REGISTRY_READ")
  const standing = await client.query(
    `SELECT 1 FROM public.organization_person_relationships r
      WHERE r.id = $1 AND r.organization_id = $2 AND r.person_id = $3 AND r.record_status = 'active' AND r.effective_to IS NULL`,
    [request.requester_relationship_id, request.organization_id, request.requested_by_person_id],
  )
  if (!standing.rows[0]) blockers.push({ code: "REQUESTER_NOT_CURRENT", message: "The requester is no longer a current contact of this company." })

  // The requester's AUTHORITY is re-proven now (it may have ended since the request). A Primary Contact designation never counts.
  if (request.requester_basis === "CUSTOMER_AUTHORITY") {
    if (!(await hasAdditionalSystemCapability(client, decision, "CONTRACT_READ"))) {
      blockers.push({ code: "AUTHORITY_UNVERIFIABLE", message: "The requester's authority cannot be verified without permission to read the contract authority records." })
    } else {
      await enterSystemCapability(client, "CONTRACT_READ")
      const held = await currentCustomerAuthority(client, request.organization_id, request.requested_by_person_id)
      if (!held || held.id !== request.requester_authority_assignment_id) {
        blockers.push({ code: "REQUESTER_AUTHORITY_ENDED", message: "The requester no longer holds the Service Decision Authority or Contract Signatory role they asked under." })
      } else if (!held.noticeEvidenceDocumentId) {
        blockers.push({ code: "AUTHORITY_NOTICE_MISSING", message: "The requester's authority has no notice evidence recorded." })
      } else {
        const notice = items.find((entry) => entry.documentId === held.noticeEvidenceDocumentId)
        if (!notice || notice.documentStatus !== "verified" || notice.payload.state !== "stored" || !notice.payload.integrityVerified) {
          blockers.push({ code: "AUTHORITY_NOTICE_NOT_VERIFIED", message: "The notice that established the requester's authority is not a verified, securely stored document." })
        }
      }
      await enterSystemCapability(client, "PERSON_REGISTRY_READ")
    }
  }
  if (!(await hasAdditionalSystemCapability(client, decision, "COMPANY_LEGAL_NAME_CHANGE"))) blockers.push({ code: "EXECUTOR_NOT_AUTHORIZED", message: "Only an authorized Onboarding Team member or the founder-level account may execute a legal-name change." })
  return blockers
}

async function requireAll(client: PoolClient, decision: SystemAuthorizationDecision, capabilities: TesSystemCapability[]) {
  for (const capability of capabilities) await requireAdditionalSystemCapability(client, decision, capability)
}

export async function legalNameRequestReadiness(organizationId: string, requestId: string): Promise<{ request: LegalNameRequestView; ready: boolean; blockers: Blocker[] }> {
  const org = uuid(organizationId, "organizationId")
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", async (client, decision) => {
    await requireTracking(client, "Changing the registered legal name")
    await requireAll(client, decision, ["EVIDENCE_READ", "PERSON_REGISTRY_READ"])
    await enterSystemCapability(client, "ORGANIZATION_REGISTRY_READ")
    const request = await loadLegalRequest(client, org, uuid(requestId, "requestId"))
    const blockers = await legalNameBlockers(client, decision, request)
    return { request: toLegalView(request), ready: blockers.length === 0, blockers }
  })
}

/**
 * EXECUTES a pending legal-name change. Refused (with the full list of what is missing, and the legal name untouched) unless the government
 * document and the written request are linked and verified, the requester CURRENTLY holds a recorded customer authority (never just a Primary Contact designation) or is a Director backed by a verified
 * document, and the executing actor holds COMPANY_LEGAL_NAME_CHANGE (the founder-level Master Account always does). On success, in ONE
 * transaction: the legal name changes, the previous name is kept as a FORMER_NAME alias and on the request, a change-ledger row links the
 * evidence, and the Master Register records the actor, the request and the evidence references.
 */
export async function applyLegalNameChange(input: Record<string, unknown>): Promise<LegalNameRequestView> {
  try {
    return await applyLegalNameChangeNow(input)
  } catch (error) {
    // Before migration 0036 the COMPANY_LEGAL_NAME_CHANGE capability does not exist at all: say so, instead of an anonymous failure.
    if (error instanceof Error && error.name === "TesUnknownCapabilityError") throw new CompanyChangeStateError(migration0036Message("ABSENT", "Changing the registered legal name"))
    throw error
  }
}

async function applyLegalNameChangeNow(input: Record<string, unknown>): Promise<LegalNameRequestView> {
  const organizationId = uuid(input.organizationId, "organizationId")
  const requestId = uuid(input.requestId, "requestId")
  const effective = typeof input.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate) ? input.effectiveDate : null
  if (!effective || Number.isNaN(new Date(`${effective}T00:00:00Z`).getTime()) || new Date(`${effective}T00:00:00Z`).getTime() > Date.now() + 24 * 3600_000) {
    throw new CompanyChangeValidationError("effectiveDate", "Give the date the new legal name took effect (from the government document; not in the future).")
  }
  return withAuthorizedSystem("COMPANY_LEGAL_NAME_CHANGE", async (client, decision) => {
    await requireTracking(client, "Changing the registered legal name")
    await requireAll(client, decision, ["ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "EVIDENCE_READ", "PERSON_REGISTRY_READ"])
    await enterSystemCapability(client, "ORGANIZATION_UPDATE")
    await client.query(`SELECT id FROM public.organizations WHERE id = $1 FOR UPDATE`, [organizationId])
    const request = await loadLegalRequest(client, organizationId, requestId, true)
    const blockers = await legalNameBlockers(client, decision, request)
    if (blockers.length > 0) throw new CompanyChangeBlockedStateError(blockers)

    await enterSystemCapability(client, "ORGANIZATION_REGISTRY_READ")
    const ctx = domainContext(client, decision, "ORGANIZATION_REGISTRY_READ")
    const organization = await corporateOperations.readOrganization(client, organizationId)
    if (organization.legalName !== request.previous_legal_name) throw new CompanyChangeStateError("The registered legal name changed after this request was recorded; start a new request.")

    await enterSystemCapability(client, "ORGANIZATION_UPDATE")
    const keepDisplay = organization.displayName === organization.legalName
    const updated = await corporateOperations.updateLegalIdentity(ctx, organizationId, keepDisplay ? { legalName: request.requested_legal_name, displayName: request.requested_legal_name } : { legalName: request.requested_legal_name })
    // The previous name MUST be kept as an alias (the historical record of the company's former name). This write is mandatory: it is NOT
    // suppressed, so a failure aborts the whole transaction and the legal name is not changed. (Only when an active alias with exactly that
    // text already preserves the name is nothing added.)
    if (!updated.organization.aliases.some((alias) => alias.status === "active" && alias.alias === request.previous_legal_name)) {
      try {
        await corporateOperations.addAlias(ctx, organizationId, { alias: request.previous_legal_name, aliasType: "FORMER_NAME" })
      } catch (error) {
        throw new CompanyChangeStateError(
          `The previous legal name could not be kept as a former name (${error instanceof Error ? error.message : "unknown error"}), so the legal name was NOT changed. Nothing was saved.`,
        )
      }
    }
    await runDeferredChecks(client)

    const evidence = [
      { documentId: request.government_evidence_document_id as string, role: "GOVERNMENT_DOCUMENT" as const },
      { documentId: request.written_request_evidence_document_id as string, role: "WRITTEN_REQUEST" as const },
      ...(request.director_evidence_document_id ? [{ documentId: request.director_evidence_document_id, role: "DIRECTOR_VERIFICATION" as const }] : []),
    ]
    const eventId = await recordAccountabilityEvent(client, decision, "applyLegalNameChange", organizationId, "company_legal_name_change_request", requestId, evidence.map((e) => `evidence_documents:${e.documentId}`), [
      { field: "legalName", before: { kind: "LITERAL", value: request.previous_legal_name }, after: { kind: "LITERAL", value: request.requested_legal_name } },
      { field: "request", after: { kind: "REFERENCE", reference: `company_legal_name_change_requests:${requestId}` } },
      { field: "requesterBasis", after: { kind: "LITERAL", value: request.requester_basis } },
    ])
    const changeId = await appendChange(client, {
      organizationId, actorId: decision.actor.id, operation: "LEGAL_NAME_CHANGED", summary: `Registered legal name changed (${request.requester_basis === "CUSTOMER_AUTHORITY" ? "requested by a Service Decision Authority / Contract Signatory" : "requested by an evidenced Director"})`,
      previous: request.previous_legal_name, next: request.requested_legal_name, effectiveAt: `${effective}T00:00:00Z`, source: "COMPANY_WRITTEN_REQUEST",
      request: { table: "company_legal_name_change_requests", id: requestId }, eventId, evidence,
    })
    const applied = await client.query(
      `UPDATE public.company_legal_name_change_requests
          SET status = 'APPLIED', decided_by_actor_id = $2, decided_at = clock_timestamp(), effective_at = $3::timestamptz, change_record_id = $4, updated_at = clock_timestamp()
        WHERE id = $1 AND status = 'PENDING'`,
      [requestId, decision.actor.id, `${effective}T00:00:00Z`, changeId],
    )
    // The request must really move to APPLIED together with the name change: anything else aborts the transaction (nothing is half-applied).
    mustAffectOneRow(applied.rowCount, "The legal-name request could not be marked applied")
    return toLegalView(await loadLegalRequest(client, organizationId, requestId))
  })
}

/** Withdraws or rejects a pending request (nothing changes; the request and its reason are kept). */
export async function closeLegalNameRequest(input: Record<string, unknown>): Promise<LegalNameRequestView> {
  const organizationId = uuid(input.organizationId, "organizationId")
  const requestId = uuid(input.requestId, "requestId")
  const status = oneOf(input.outcome, ["REJECTED", "WITHDRAWN"] as const, "outcome")
  const reason = text(input.reason, "reason", 3, 500)
  return withAuthorizedSystem("ORGANIZATION_UPDATE", async (client, decision) => {
    await requireTracking(client, "Changing the registered legal name")
    const request = await loadLegalRequest(client, organizationId, requestId, true)
    if (request.status !== "PENDING") throw new CompanyChangeStateError("This request has already been decided.")
    const changeId = await appendChange(client, {
      organizationId, actorId: decision.actor.id, operation: "LEGAL_NAME_CHANGE_REQUESTED", summary: `Legal name change request ${status.toLowerCase()} (the registered legal name is unchanged)`,
      previous: request.previous_legal_name, next: request.requested_legal_name, request: { table: "company_legal_name_change_requests", id: requestId },
    })
    const closed = await client.query(`UPDATE public.company_legal_name_change_requests SET status = $2, decided_by_actor_id = $3, decided_at = clock_timestamp(), decision_reason = $4, change_record_id = $5, updated_at = clock_timestamp() WHERE id = $1 AND status = 'PENDING'`, [requestId, status, decision.actor.id, reason, changeId])
    mustAffectOneRow(closed.rowCount, "The legal-name request could not be closed")
    await recordAccountabilityEvent(client, decision, "closeLegalNameRequest", organizationId, "company_legal_name_change_request", requestId, [], [{ field: "status", after: { kind: "LITERAL", value: status } }])
    return toLegalView(await loadLegalRequest(client, organizationId, requestId))
  })
}

// --- sensitive channel replacement ---------------------------------------------------------------------------------------

export type ChannelRequestView = {
  id: string
  channelType: ChannelKind
  usage: string
  /** REPLACE: the established value becomes requestedValue. REMOVE: the established value is ended (requestedValue is null). */
  changeKind: ChannelChangeKind
  previousValue: string | null
  requestedValue: string | null
  status: "PENDING_CONFIRMATION" | "APPLIED" | "REJECTED" | "WITHDRAWN"
  requestSource: string
  requestReference: string
  senderAddress: string | null
  recordedAt: string
  confirmedAt: string | null
  appliedAt: string | null
  decisionReason: string | null
  confirmationEvidenceDocumentId: string | null
  /** Set by the activity read only: true when the VIEWER recorded this request (who may therefore not confirm it). */
  recordedByYou?: boolean
}

const CHANNEL_COLUMNS = `id, organization_id, channel_type, usage, change_kind, recorded_by_actor_id, confirmation_evidence_document_id, previous_channel_id, previous_value, requested_value, requested_value_normalized, status, request_source, request_reference, sender_address,
  recorded_at, confirmed_at, applied_at, decision_reason`
type ChannelRow = {
  id: string
  organization_id: string
  channel_type: ChannelKind
  usage: string
  change_kind: ChannelChangeKind
  recorded_by_actor_id: string
  confirmation_evidence_document_id: string | null
  previous_channel_id: string | null
  previous_value: string | null
  requested_value: string | null
  requested_value_normalized: string | null
  status: ChannelRequestView["status"]
  request_source: string
  request_reference: string
  sender_address: string | null
  recorded_at: Date
  confirmed_at: Date | null
  applied_at: Date | null
  decision_reason: string | null
}
const toChannelView = (row: ChannelRow): ChannelRequestView => ({
  id: row.id,
  channelType: row.channel_type,
  usage: row.usage,
  changeKind: row.change_kind,
  previousValue: row.previous_value,
  requestedValue: row.requested_value,
  status: row.status,
  requestSource: row.request_source,
  requestReference: row.request_reference,
  senderAddress: row.sender_address,
  recordedAt: row.recorded_at.toISOString(),
  confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
  appliedAt: row.applied_at ? row.applied_at.toISOString() : null,
  decisionReason: row.decision_reason,
  confirmationEvidenceDocumentId: row.confirmation_evidence_document_id,
})

/**
 * Records a request to REPLACE or REMOVE an ESTABLISHED company channel. Called inside the edit transaction (capability ORGANIZATION_UPDATE
 * already in force). It changes nothing: the established value stays the trusted one until the change is confirmed with verified evidence
 * through an established channel by a different TES user. The sender address, when given, is stored for review and never trusted.
 */
export async function recordChannelChangeRequest(
  client: PoolClient,
  decision: SystemAuthorizationDecision,
  input: {
    organizationId: string
    kind: ChannelKind
    usage: string
    changeKind?: ChannelChangeKind
    previousChannelId: string | null
    previousValue: string | null
    requestedValue: string | null
    source: string
    reference: string
    senderAddress?: string | null
    requestedByPersonId?: string | null
  },
): Promise<ChannelRequestView> {
  const changeKind: ChannelChangeKind = input.changeKind ?? "REPLACE"
  if (changeKind === "REMOVE" && !input.previousChannelId) throw new CompanyChangeValidationError("channel", "Only an established channel can be removed.")
  const prepared = changeKind === "REPLACE" ? prepareChannel(input.kind, input.requestedValue, undefined, "value") : null
  const source = oneOf(input.source, CHANNEL_REQUEST_SOURCES, "channelChangeSource")
  const reference = text(input.reference, "channelChangeReference", 3, 500)
  const id = randomUUID()
  try {
    await client.query(
      `INSERT INTO public.company_channel_change_requests
         (id, organization_id, channel_type, usage, change_kind, previous_channel_id, previous_value, requested_value, requested_value_normalized, request_source, request_reference, requested_by_person_id, sender_address, recorded_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, input.organizationId, input.kind, input.usage, changeKind, input.previousChannelId, input.previousValue, prepared?.display ?? null, prepared?.normalized ?? null, source, reference, input.requestedByPersonId ?? null, input.senderAddress?.trim() || null, decision.actor.id],
    )
  } catch (error) {
    if (((error as { constraint?: string }).constraint ?? "") === "channel_requests_one_pending_uq") throw new CompanyChangeStateError(`A ${input.kind.toLowerCase()} change is already awaiting confirmation for this company.`)
    throw error
  }
  const eventId = await recordAccountabilityEvent(client, decision, "requestChannelChange", input.organizationId, "company_channel_change_request", id, [], [{ field: `${input.kind}:${input.usage}`, after: { kind: "REFERENCE", reference: `company_channel_change_requests:${id}` } }])
  await appendChange(client, {
    organizationId: input.organizationId, actorId: decision.actor.id, operation: "CHANNEL_CHANGE_REQUESTED",
    summary: `${changeKind === "REMOVE" ? "Removal" : "Replacement"} of the company ${input.kind.toLowerCase()} recorded; awaiting confirmation with verified evidence through an established channel (the current value stays in use)`,
    previous: input.previousValue, next: prepared?.display ?? null, source: source === "PORTAL" ? "STAFF_ENTRY" : source, request: { table: "company_channel_change_requests", id }, eventId,
  })
  const row = await client.query<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM public.company_channel_change_requests WHERE id = $1`, [id])
  return toChannelView(row.rows[0])
}

type EstablishedChannel = { kind: "PERSON_CHANNEL" | "COMPANY_CHANNEL"; id: string; personId: string | null; value: string; normalized: string; channelType: string }

/**
 * Proves a confirmation channel is ESTABLISHED: it belongs to this company (or to a CURRENT contact of it), was recorded BEFORE the request, is
 * still current, and is neither the requested value nor the address the request came from.
 */
async function establishedChannel(client: PoolClient, request: ChannelRow, recordedAt: Date, kind: string, channelId: string): Promise<EstablishedChannel> {
  const fail = (message: string): never => {
    throw new CompanyChangeValidationError("confirmationChannelId", message)
  }
  let found: EstablishedChannel | undefined
  if (kind === "COMPANY_CHANNEL") {
    const row = await client.query(
      `SELECT id, value_display, value_normalized, channel_type, created_at FROM public.organization_channels
        WHERE id = $1 AND organization_id = $2 AND record_status = 'active' AND effective_to IS NULL`,
      [channelId, request.organization_id],
    )
    const r = row.rows[0]
    if (!r) return fail("The confirmation channel is not a current channel of this company.")
    if (new Date(r.created_at).getTime() >= recordedAt.getTime()) return fail("The confirmation channel was recorded after the request; it cannot confirm it.")
    found = { kind: "COMPANY_CHANNEL", id: r.id, personId: null, value: r.value_display, normalized: r.value_normalized, channelType: r.channel_type }
  } else if (kind === "PERSON_CHANNEL") {
    const row = await client.query(
      `SELECT c.id, c.person_id, c.value_display, c.value_normalized, c.channel_type, c.created_at
         FROM public.person_channels c
         JOIN public.organization_person_relationships r ON r.person_id = c.person_id AND r.organization_id = $2 AND r.record_status = 'active' AND r.effective_to IS NULL
        WHERE c.id = $1 AND c.record_status = 'active' AND c.effective_to IS NULL`,
      [channelId, request.organization_id],
    )
    const r = row.rows[0]
    if (!r) return fail("The confirmation channel is not a current channel of a current contact of this company.")
    if (new Date(r.created_at).getTime() >= recordedAt.getTime()) return fail("The confirmation channel was recorded after the request; it cannot confirm it.")
    found = { kind: "PERSON_CHANNEL", id: r.id, personId: r.person_id, value: r.value_display, normalized: r.value_normalized, channelType: r.channel_type }
  } else {
    return fail("confirmationChannelKind must be PERSON_CHANNEL or COMPANY_CHANNEL.")
  }
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  if (request.requested_value_normalized !== null && request.requested_value !== null && (same(found.normalized, request.requested_value_normalized) || sameChannelValue(request.channel_type, found.value, request.requested_value))) return fail("The confirmation channel is the requested value itself; it cannot confirm itself.")
  if (request.sender_address && (same(found.value, request.sender_address) || same(found.normalized, request.sender_address))) return fail("The confirmation channel is the sender of the request; an unfamiliar sender cannot confirm its own request.")
  return found
}

/**
 * The blockers to confirming a channel change. A confirmation is trustworthy only with ALL of:
 *   - an evidence document of type CHANNEL_CHANGE_CONFIRMATION that the existing evidence process has VERIFIED, that is securely stored with
 *     verified integrity, belongs to this company, was created AFTER the request was recorded and has confirmed no other request;
 *   - a TES user other than the one who recorded the request (no self-confirmation);
 *   - an ESTABLISHED channel (checked separately, see establishedChannel).
 * A free-text reference or "method" typed by the operator proves nothing and never satisfies any of these.
 */
async function channelConfirmationBlockers(client: PoolClient, decision: SystemAuthorizationDecision, request: ChannelRow, documentId: string): Promise<Blocker[]> {
  const blockers: Blocker[] = []
  if (request.recorded_by_actor_id === decision.actor.id) {
    blockers.push({ code: "SELF_CONFIRMATION", message: "The person who recorded this request cannot confirm it; a different authorized TES user must confirm it." })
  }
  await enterSystemCapability(client, "EVIDENCE_READ")
  const items = await listEvidence(client, request.organization_id)
  const item = items.find((entry) => entry.documentId === documentId)
  if (!item) blockers.push({ code: "CONFIRMATION_EVIDENCE_NOT_FOUND", message: "The confirmation evidence could not be found for this company." })
  else {
    if (item.documentType !== CHANNEL_CONFIRMATION_EVIDENCE_TYPE) blockers.push({ code: "CONFIRMATION_EVIDENCE_WRONG_TYPE", message: `The confirmation evidence must be a ${CHANNEL_CONFIRMATION_EVIDENCE_TYPE} document.` })
    if (item.documentStatus !== "verified") blockers.push({ code: "CONFIRMATION_EVIDENCE_NOT_VERIFIED", message: "The confirmation evidence has not been verified by a reviewer." })
    if (item.payload.state !== "stored" || !item.payload.integrityVerified) blockers.push({ code: "CONFIRMATION_EVIDENCE_NOT_STORED", message: "The confirmation evidence is not securely stored with verified integrity." })
    if (new Date(item.createdAt).getTime() <= request.recorded_at.getTime()) blockers.push({ code: "CONFIRMATION_EVIDENCE_TOO_OLD", message: "The confirmation evidence was created before this request, so it cannot show that this request was confirmed." })
  }
  await enterSystemCapability(client, "ORGANIZATION_REGISTRY_READ")
  const used = await client.query(`SELECT 1 FROM public.company_channel_change_requests WHERE confirmation_evidence_document_id = $1 AND id <> $2`, [documentId, request.id])
  if (used.rows[0]) blockers.push({ code: "CONFIRMATION_EVIDENCE_REUSED", message: "That evidence document has already confirmed another request." })
  return blockers
}

/**
 * CONFIRMS a pending channel change and applies it, in one transaction. Refused (the request stays pending, nothing changes) unless the verified
 * evidence, the different confirming user and the established channel are all in place (see channelConfirmationBlockers). On success: a REPLACE
 * makes the new value current through the existing contacts operation (the previous value is ended, never deleted); a REMOVE ends the value
 * (kept in history). The request records who confirmed, through which established channel and with which evidence, and a ledger row and a
 * Master Register event link the change to that evidence. A website change never touches an email, and a company channel never becomes a person's.
 */
export async function confirmChannelChange(input: Record<string, unknown>): Promise<ChannelRequestView> {
  const organizationId = uuid(input.organizationId, "organizationId")
  const requestId = uuid(input.requestId, "requestId")
  const kind = oneOf(input.confirmationChannelKind, ["PERSON_CHANNEL", "COMPANY_CHANNEL"] as const, "confirmationChannelKind")
  const channelId = uuid(input.confirmationChannelId, "confirmationChannelId")
  const method = oneOf(input.confirmationMethod, CONFIRMATION_METHODS, "confirmationMethod")
  const evidenceId = uuid(input.confirmationEvidenceDocumentId, "confirmationEvidenceDocumentId")
  // A note only (never proof). The older field name is still read as a note.
  const noteSource = input.confirmationNote ?? input.confirmationReference
  const note = typeof noteSource === "string" && noteSource.trim() !== "" ? text(noteSource, "confirmationNote", 3, 500) : null
  return withAuthorizedSystem("CONTACT_MANAGE", async (client, decision) => {
    await requireTracking(client, "Confirming a company channel change")
    await requireAll(client, decision, ["PERSON_REGISTRY_READ", "EVIDENCE_READ"])
    const result = await client.query<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM public.company_channel_change_requests WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [requestId, organizationId])
    const request = result.rows[0]
    if (!request) throw new CompanyChangeNotFoundError("Channel change request")
    if (request.status !== "PENDING_CONFIRMATION") throw new CompanyChangeStateError("This request has already been decided.")

    const blockers = await channelConfirmationBlockers(client, decision, request, evidenceId)
    if (blockers.length > 0) throw new CompanyChangeBlockedStateError(blockers)
    await enterSystemCapability(client, "PERSON_REGISTRY_READ")
    const established = await establishedChannel(client, request, request.recorded_at, kind, channelId)

    await enterSystemCapability(client, "CONTACT_MANAGE")
    const contactContext = domainContext(client, decision, "PERSON_REGISTRY_READ")
    const current = request.previous_channel_id
      ? (await contactOperations.readOrganizationContacts(client, organizationId)).currentChannels.find((channel) => channel.id === request.previous_channel_id)
      : undefined
    if (request.previous_channel_id && !current) throw new CompanyChangeStateError("The channel this request would change is no longer current; start a new request.")
    let appliedId: string | null = null
    if (request.change_kind === "REMOVE") {
      if (!current) throw new CompanyChangeStateError("The channel this request would remove is no longer current; start a new request.")
      await contactOperations.endOrganizationChannel(contactContext, { organizationId, channelId: current.id })
    } else if (current) {
      const view = await contactOperations.changeOrganizationChannel(contactContext, { organizationId, channelId: current.id, value: request.requested_value })
      appliedId = view.currentChannels.find((c) => c.channelType === request.channel_type && c.usage === request.usage)!.id
    } else {
      const view = await contactOperations.addOrganizationChannel(contactContext, { organizationId, channel: { type: request.channel_type, value: request.requested_value, usage: request.usage } })
      appliedId = view.currentChannels.find((c) => c.channelType === request.channel_type && c.usage === request.usage)!.id
    }
    await runDeferredChecks(client)
    const eventId = await recordAccountabilityEvent(client, decision, "confirmChannelChange", organizationId, "company_channel_change_request", requestId, [`evidence_documents:${evidenceId}`], [
      { field: `${request.channel_type}:${request.usage}`, after: { kind: "REFERENCE", reference: `${kind === "PERSON_CHANNEL" ? "person_channels" : "organization_channels"}:${established.id}` } },
      { field: "confirmationMethod", after: { kind: "LITERAL", value: method } },
      { field: "confirmationEvidence", after: { kind: "REFERENCE", reference: `evidence_documents:${evidenceId}` } },
      { field: "changeKind", after: { kind: "LITERAL", value: request.change_kind } },
    ])
    const changeId = await appendChange(client, {
      organizationId, actorId: decision.actor.id,
      operation: channelOperation(request.channel_type, request.change_kind === "REMOVE" ? "removed" : current ? "changed" : "added"),
      summary: `Company ${request.channel_type.toLowerCase()} ${request.change_kind === "REMOVE" ? "removed" : current ? "changed" : "added"} after confirmation with verified evidence through an established channel`,
      previous: request.previous_value, next: request.requested_value, source: "VERIFIED_CHANNEL_CONFIRMATION", request: { table: "company_channel_change_requests", id: requestId }, eventId,
      evidence: [{ documentId: evidenceId, role: "CONFIRMATION" }],
    })
    let applied
    try {
      applied = await client.query(
        `UPDATE public.company_channel_change_requests
            SET status = 'APPLIED', confirmation_channel_kind = $2, confirmation_channel_id = $3, confirmation_contact_person_id = $4, confirmation_method = $5, confirmation_reference = $6,
                confirmation_evidence_document_id = $7, confirmed_by_actor_id = $8, confirmed_at = clock_timestamp(), applied_channel_id = $9, applied_at = clock_timestamp(), change_record_id = $10, updated_at = clock_timestamp()
          WHERE id = $1 AND status = 'PENDING_CONFIRMATION'`,
        [requestId, kind, established.id, established.personId, method, note, evidenceId, decision.actor.id, appliedId, changeId],
      )
    } catch (error) {
      if (((error as { constraint?: string }).constraint ?? "") === "channel_requests_confirmation_evidence_uq") throw new CompanyChangeBlockedStateError([{ code: "CONFIRMATION_EVIDENCE_REUSED", message: "That evidence document has already confirmed another request." }])
      throw error
    }
    mustAffectOneRow(applied.rowCount, "The channel change request could not be marked applied")
    const done = await client.query<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM public.company_channel_change_requests WHERE id = $1`, [requestId])
    return toChannelView(done.rows[0])
  })
}

/** Rejects or withdraws a pending channel change; the established value stays in use. */
export async function closeChannelChange(input: Record<string, unknown>): Promise<ChannelRequestView> {
  const organizationId = uuid(input.organizationId, "organizationId")
  const requestId = uuid(input.requestId, "requestId")
  const status = oneOf(input.outcome, ["REJECTED", "WITHDRAWN"] as const, "outcome")
  const reason = text(input.reason, "reason", 3, 500)
  return withAuthorizedSystem("CONTACT_MANAGE", async (client, decision) => {
    await requireTracking(client, "Closing a company channel change")
    const result = await client.query<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM public.company_channel_change_requests WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [requestId, organizationId])
    const request = result.rows[0]
    if (!request) throw new CompanyChangeNotFoundError("Channel change request")
    if (request.status !== "PENDING_CONFIRMATION") throw new CompanyChangeStateError("This request has already been decided.")
    const changeId = await appendChange(client, {
      organizationId, actorId: decision.actor.id, operation: "CHANNEL_CHANGE_REJECTED", summary: `${request.change_kind === "REMOVE" ? "Removal" : "Replacement"} of the company ${request.channel_type.toLowerCase()} ${status.toLowerCase()} (the established value stays in use)`,
      previous: request.previous_value, next: request.requested_value, request: { table: "company_channel_change_requests", id: requestId },
    })
    const closed = await client.query(`UPDATE public.company_channel_change_requests SET status = $2, decision_reason = $3, change_record_id = $4, updated_at = clock_timestamp() WHERE id = $1 AND status = 'PENDING_CONFIRMATION'`, [requestId, status, reason, changeId])
    mustAffectOneRow(closed.rowCount, "The channel change request could not be closed")
    await recordAccountabilityEvent(client, decision, "closeChannelChange", organizationId, "company_channel_change_request", requestId, [], [{ field: "status", after: { kind: "LITERAL", value: status } }])
    const done = await client.query<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM public.company_channel_change_requests WHERE id = $1`, [requestId])
    return toChannelView(done.rows[0])
  })
}

// --- reads ---------------------------------------------------------------------------------------------------------------

export type ActivityEntry = {
  id: string
  operation: string
  label: string
  group: string
  summary: string
  previousValue: string | null
  newValue: string | null
  effectiveAt: string
  recordedAt: string
  requestSource: string | null
  basis: string | null
  basisReference: string | null
  evidence: Array<{ documentId: string; role: string; title: string | null }>
  requestId: string | null
  /**
   * Who recorded the change. Actors carry no personal name in the canonical model, so this is the stable short reference of the actor plus its
   * type; `you` is true when the viewer made the change. null for entries derived from other canonical history (for example Primary Contact).
   */
  actor: { ref: string; type: string | null; you: boolean } | null
  /** The Master Register event of the operation (a stable reference; the register itself keeps the technical detail). */
  registerEventId: string | null
}

export type PendingChanges = { legalName: LegalNameRequestView[]; channels: ChannelRequestView[] }

/**
 * The Company Activity: one entry per BUSINESS operation (the Master Register keeps every technical event and is linked from each entry by
 * its event id). Evidence titles are shown only to an actor who may read evidence; without it the entry still says evidence is linked.
 * Primary Contact changes are derived from the canonical designation history (names only for an actor who may read the people registry).
 */
export type CompanyActivity = {
  /** COMPLETE when change tracking (migration 0036) is fully available; otherwise nothing is listed and `message` says why. */
  tracking: "ABSENT" | "COMPLETE" | "INCONSISTENT"
  message: string | null
  entries: ActivityEntry[]
  pending: PendingChanges
  access: { evidence: boolean; execute: boolean }
}

export async function getCompanyActivity(organizationId: string): Promise<CompanyActivity> {
  const org = uuid(organizationId, "organizationId")
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", async (client, decision) => {
    const tracking = await migration0036State(client)
    if (tracking !== "COMPLETE") {
      return { tracking, message: migration0036Message(tracking, "The company change history").replace(" Nothing was changed.", ""), entries: [], pending: { legalName: [], channels: [] }, access: { evidence: false, execute: false } }
    }
    const [evidenceAccess, peopleAccess, execute] = await Promise.all([
      hasAdditionalSystemCapability(client, decision, "EVIDENCE_READ"),
      hasAdditionalSystemCapability(client, decision, "PERSON_REGISTRY_READ"),
      hasAdditionalSystemCapability(client, decision, "COMPANY_LEGAL_NAME_CHANGE"),
    ])
    const ledger: LedgerRow[] = await listLedger(client, org)
    const legal = await client.query<LegalRequestRow>(`SELECT ${LEGAL_COLUMNS} FROM public.company_legal_name_change_requests WHERE organization_id = $1 ORDER BY recorded_at DESC`, [org])
    const channels = await client.query<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM public.company_channel_change_requests WHERE organization_id = $1 ORDER BY recorded_at DESC`, [org])

    const titles = new Map<string, string>()
    if (evidenceAccess) {
      await enterSystemCapability(client, "EVIDENCE_READ")
      for (const item of await listEvidence(client, org)) titles.set(item.documentId, item.documentTitle)
      await enterSystemCapability(client, "ORGANIZATION_REGISTRY_READ")
    }
    const actorTypes = new Map<string, string>()
    const actorIds = [...new Set(ledger.map((row) => row.actorId))]
    if (actorIds.length > 0) {
      const found = await client.query<{ id: string; actor_type: string }>(`SELECT id, actor_type FROM public.actors WHERE id = ANY($1::uuid[])`, [actorIds])
      for (const row of found.rows) actorTypes.set(row.id, row.actor_type)
    }
    const entries: ActivityEntry[] = ledger.map((row) => {
      const meta = OPERATION_LABELS[row.operation] ?? { label: row.operation, group: "business" }
      return {
        actor: { ref: row.actorId.slice(0, 8), type: actorTypes.get(row.actorId) ?? null, you: row.actorId === decision.actor.id },
        registerEventId: row.masterRegisterEventId,
        id: row.id, operation: row.operation, label: meta.label, group: meta.group, summary: row.summary, previousValue: row.previousValue, newValue: row.newValue,
        effectiveAt: row.effectiveAt, recordedAt: row.recordedAt, requestSource: row.requestSource, basis: row.basis, basisReference: row.basisReference,
        evidence: row.evidence.map((e) => ({ documentId: e.documentId, role: e.role, title: titles.get(e.documentId) ?? null })), requestId: row.requestId,
      }
    })

    if (peopleAccess) {
      await enterSystemCapability(client, "PERSON_REGISTRY_READ")
      const history = await client.query(
        `SELECT a.id, a.effective_from, a.effective_to, a.created_at, (SELECT string_agg(n.given_name || COALESCE(' ' || n.family_name, ''), '') FROM public.person_name_versions n WHERE n.person_id = a.person_id AND n.record_status = 'active' AND n.effective_to IS NULL) AS person_name
           FROM public.contact_purpose_assignments a
          WHERE a.organization_id = $1 AND a.purpose_code = 'PRIMARY' AND a.is_primary AND a.record_status = 'active' ORDER BY a.effective_from, a.created_at`,
        [org],
      )
      history.rows.forEach((row, index) => {
        const label = OPERATION_LABELS[index === 0 ? "PRIMARY_CONTACT_DESIGNATED" : "PRIMARY_CONTACT_CHANGED"]
        const at = new Date(row.effective_from).toISOString()
        entries.push({
          id: `primary-${row.id}`, operation: index === 0 ? "PRIMARY_CONTACT_DESIGNATED" : "PRIMARY_CONTACT_CHANGED", label: label.label, group: label.group,
          summary: `${row.person_name ?? "A contact"} ${index === 0 ? "designated" : "became"} the Primary Contact`, previousValue: null, newValue: null,
          effectiveAt: at, recordedAt: new Date(row.created_at).toISOString(), requestSource: null, basis: null, basisReference: null, evidence: [], requestId: null, actor: null, registerEventId: null,
        })
        if (row.effective_to && !history.rows[index + 1]) {
          entries.push({
            id: `primary-end-${row.id}`, operation: "PRIMARY_CONTACT_CHANGED", label: label.group === "contacts" ? "Primary Contact Changed" : label.label, group: "contacts",
            summary: "The Primary Contact designation ended", previousValue: null, newValue: null, effectiveAt: new Date(row.effective_to).toISOString(), recordedAt: new Date(row.effective_to).toISOString(),
            requestSource: null, basis: null, basisReference: null, evidence: [], requestId: null, actor: null, registerEventId: null,
          })
        }
      })
    }
    entries.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    return {
      tracking,
      message: null,
      entries,
      pending: { legalName: legal.rows.filter((r) => r.status === "PENDING").map(toLegalView), channels: channels.rows.filter((r) => r.status === "PENDING_CONFIRMATION").map((r) => ({ ...toChannelView(r), recordedByYou: r.recorded_by_actor_id === decision.actor.id })) },
      access: { evidence: evidenceAccess, execute },
    }
  })
}
