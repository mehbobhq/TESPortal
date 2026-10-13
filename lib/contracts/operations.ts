/**
 * Contracts operations: validation, business rules and Master Register records on a caller-supplied transaction.
 *
 * Every function runs INSIDE the transaction the authorization wrapper opened (CONTRACT_READ for reads, CONTRACT_MANAGE for
 * writes), and Master Register events are written through a repository bound to the same client, so a failure anywhere -
 * including the Master Register - rolls the whole change back.
 *
 * The database (migration 0031) is the final arbiter:
 *   - at most one active Service Decision Authority and one active Contract Signatory per customer (unique index, 0030)
 *   - an authority change needs a verified written company notice + a Master Register event in the same transaction
 *   - a contract status change needs verified evidence + a Master Register event in the same transaction, and passes the
 *     readiness gates (tes_security.contract_gate_failures) before reaching ready_for_signature or signed
 *   - scope, responsibility and pricing decisions can only be recorded under the contract's active Service Decision Authority
 * This module validates early, explains refusals and records the accountability trail; it cannot weaken those rules.
 *
 * Master Register events reference rows (table:id) and carry only controlled-vocabulary literals. Never free text, never
 * document contents, never fee amounts.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  AUTHORITY_NOTICE_DOCUMENT_TYPE,
  CONTRACT_TRANSITIONS,
  FEE_CURRENCIES,
  GATE_CODES,
  HISTORY_TREATMENTS,
  PRICING_BASES,
  RESPONSIBLE_PARTIES,
  canTransition,
  deriveResponsibilityBoundary,
  isAuthorityType,
  isCalendarDate,
  isCode,
  isContractStatus,
  isOneOf,
  isUuid,
  type AuthorityType,
  type ContractStatus,
  type FeeCurrency,
  type GateCode,
  type HistoryTreatment,
  type PricingBasis,
  type ResponsibleParty,
} from "@/lib/contracts/definitions"
import { ContractConflictError, ContractNotFoundError, ContractStateError, ContractValidationError } from "@/lib/contracts/errors"
import type {
  AuthorityAssignmentView,
  AuthorityChangeEventRecord,
  AuthorityState,
  ContractEvidenceRequirementView,
  ContractLineView,
  ContractReadiness,
  ContractStatusEventRecord,
  ContractView,
  ContractsView,
  EvidenceRuleRecord,
  LinePricingRecord,
  PackageDefinitionRecord,
  ResponsibilityRowRecord,
} from "@/lib/contracts/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  masterRegister: MasterRegisterRepository
}

const MICRO_ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const MICRO_ISO_NULL = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL ELSE ${MICRO_ISO(column)} END`

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName =
  | "RECORD_CREATED"
  | "RECORD_VIEWED"
  | "RECORD_UPDATED"
  | "RECORD_STATUS_CHANGED"
  | "RECORD_LINK_ESTABLISHED"
  | "RECORD_LINK_REMOVED"
  | "EVIDENCE_ASSOCIATED"
  | "APPROVAL_DECISION_RECORDED"
  | "ASSIGNMENT_CREATED"
  | "ASSIGNMENT_REASSIGNED"
  | "ASSIGNMENT_RELEASED"

type Target = { resourceType: string; resourceId: string; organizationId: string; customerId?: string; contractId?: string }

const literal = (value: string | number | boolean | null) => ({ kind: "LITERAL" as const, value })
const reference = (table: string, id: string) => ({ kind: "REFERENCE" as const, reference: `${table}:${id}` })

async function record(
  ctx: OperationContext,
  eventType: EventTypeName,
  operation: string,
  target: Target,
  fieldChanges: FieldChange[],
  evidenceDocumentIds: string[] = [],
): Promise<string> {
  const event = await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      customerId: target.customerId,
      subjectReferences: [`organization:${target.organizationId}`, ...(target.contractId ? [`customer_contract:${target.contractId}`] : [])],
    },
    source: { sourceType: "APPLICATION", component: "contracts", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    ...(evidenceDocumentIds.length > 0 ? { evidence: { evidenceReferences: evidenceDocumentIds.map((id) => `evidence_document:${id}`) } } : {}),
    outcome: { result: "SUCCESS" },
  })
  return event.eventId
}

// ---------------------------------------------------------------------------------------------------------------
// Error mapping: database gate refusals become domain errors; nothing else is swallowed
// ---------------------------------------------------------------------------------------------------------------

type PgError = Error & { code?: string }

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const pg = error as PgError & { constraint?: string }
    const code = pg?.code
    // A declarative CHECK violation names a constraint; keep that database detail out of the message.
    if (code === "23514" && pg.constraint) throw new ContractStateError("The change violates a contract rule.")
    if (code === "23514" || code === "55000") throw new ContractStateError((error as Error).message)
    if (code === "23505") throw new ContractConflictError("A conflicting contract record already exists.")
    if (code === "23503") throw new ContractNotFoundError("A referenced record")
    throw error
  }
}

function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw new ContractValidationError(field, `${field} must be a valid identifier.`)
  return value
}

function optionalUuid(field: string, value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : requireUuid(field, value)
}

// ---------------------------------------------------------------------------------------------------------------
// Row types and mappers
// ---------------------------------------------------------------------------------------------------------------

type ContractRow = {
  id: string
  customer_id: string
  organization_id: string
  engagement_id: string
  contract_status: ContractStatus
  contract_reference: string | null
  service_decision_authority_assignment_id: string | null
  contract_signatory_assignment_id: string | null
}

const CONTRACT_COLUMNS = `id, customer_id, organization_id, engagement_id, contract_status, contract_reference,
  service_decision_authority_assignment_id, contract_signatory_assignment_id`

type AuthorityRow = {
  id: string
  customer_id: string
  organization_id: string
  person_id: string
  authority_type: AuthorityType
  assignment_status: AuthorityAssignmentView["assignmentStatus"]
  effective_from: string
  effective_to: string | null
  replacement_reason: string | null
  notice_evidence_document_id: string | null
}

const AUTHORITY_COLUMNS = `id, customer_id, organization_id, person_id, authority_type, assignment_status,
  ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO_NULL("effective_to")} AS effective_to,
  replacement_reason, notice_evidence_document_id`

const toAuthority = (row: AuthorityRow): AuthorityAssignmentView => ({
  id: row.id,
  customerId: row.customer_id,
  personId: row.person_id,
  authorityType: row.authority_type,
  assignmentStatus: row.assignment_status,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  replacementReason: row.replacement_reason,
  noticeEvidenceDocumentId: row.notice_evidence_document_id,
})

type LineRow = {
  id: string
  contract_id: string
  scope_id: string
  line_status: ContractLineView["lineStatus"]
  responsibility_boundary: ContractLineView["responsibilityBoundary"]
}

type PricingRow = {
  id: string
  line_item_id: string
  pricing_basis: PricingBasis
  package_code: string | null
  fee_minor_units: string | null
  fee_currency: FeeCurrency | null
  fee_period: LinePricingRecord["feePeriod"]
  decided_by_assignment_id: string
  decision_evidence_document_id: string
  master_register_event_id: string
}

const pricingColumns = (a = "") => `${a}id, ${a}line_item_id, ${a}pricing_basis, ${a}package_code, ${a}fee_minor_units::text AS fee_minor_units, ${a}fee_currency, ${a}fee_period,
  ${a}decided_by_assignment_id, ${a}decision_evidence_document_id, ${a}master_register_event_id`
const PRICING_COLUMNS = pricingColumns()

const toPricing = (row: PricingRow): LinePricingRecord => ({
  id: row.id,
  lineItemId: row.line_item_id,
  pricingBasis: row.pricing_basis,
  packageCode: row.package_code,
  feeMinorUnits: row.fee_minor_units === null ? null : Number(row.fee_minor_units),
  feeCurrency: row.fee_currency,
  feePeriod: row.fee_period,
  decidedByAssignmentId: row.decided_by_assignment_id,
  decisionEvidenceDocumentId: row.decision_evidence_document_id,
  masterRegisterEventId: row.master_register_event_id,
})

type MatrixRow = {
  id: string
  line_item_id: string
  responsibility_area: string
  responsible_party: ResponsibleParty
  effective_responsibility_date: string
  history_treatment: HistoryTreatment
  history_assumed_from: string | null
  history_evidence_document_id: string | null
  decided_by_assignment_id: string
  decision_evidence_document_id: string
  master_register_event_id: string
}

const matrixColumns = (a = "") => `${a}id, ${a}line_item_id, ${a}responsibility_area, ${a}responsible_party, ${a}effective_responsibility_date::text AS effective_responsibility_date,
  ${a}history_treatment, ${a}history_assumed_from::text AS history_assumed_from, ${a}history_evidence_document_id,
  ${a}decided_by_assignment_id, ${a}decision_evidence_document_id, ${a}master_register_event_id`
const MATRIX_COLUMNS = matrixColumns()

const toMatrix = (row: MatrixRow): ResponsibilityRowRecord => ({
  id: row.id,
  lineItemId: row.line_item_id,
  responsibilityArea: row.responsibility_area,
  responsibleParty: row.responsible_party,
  effectiveResponsibilityDate: row.effective_responsibility_date,
  historyTreatment: row.history_treatment,
  historyAssumedFrom: row.history_assumed_from,
  historyEvidenceDocumentId: row.history_evidence_document_id,
  decidedByAssignmentId: row.decided_by_assignment_id,
  decisionEvidenceDocumentId: row.decision_evidence_document_id,
  masterRegisterEventId: row.master_register_event_id,
})

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------

function nextStatusFor(status: ContractStatus): ContractStatus | null {
  if (status === "draft") return "ready_for_signature"
  if (status === "ready_for_signature") return "signed"
  return null
}

/** Readiness comes from the database gate function: the same code the status trigger enforces. */
export async function readContractReadiness(client: Pick<PoolClient, "query">, contractId: string, status: ContractStatus): Promise<ContractReadiness> {
  const target = nextStatusFor(status)
  if (!target) return { target: null, failures: [], ready: false }
  const result = await client.query<{ failures: string[] }>(`SELECT tes_security.contract_gate_failures($1, $2) AS failures`, [contractId, target])
  const failures = (result.rows[0]?.failures ?? []).filter((code): code is GateCode => (GATE_CODES as readonly string[]).includes(code))
  return { target, failures, ready: failures.length === 0 }
}

export async function readAuthorityState(client: Pick<PoolClient, "query">, customerId: string | null, organizationId: string): Promise<AuthorityState> {
  const [assignments, changes] = await Promise.all([
    client.query<AuthorityRow>(
      `SELECT ${AUTHORITY_COLUMNS}
         FROM public.customer_authority_assignments
        WHERE organization_id = $1
        ORDER BY authority_type, effective_from DESC, id`,
      [organizationId],
    ),
    client.query<{
      id: string
      authority_type: AuthorityType
      change_type: AuthorityChangeEventRecord["changeType"]
      new_assignment_id: string | null
      prior_assignment_id: string | null
      notice_evidence_document_id: string
      master_register_event_id: string
      created_at: string
    }>(
      `SELECT id, authority_type, change_type, new_assignment_id, prior_assignment_id, notice_evidence_document_id,
              master_register_event_id, ${MICRO_ISO("created_at")} AS created_at
         FROM public.customer_authority_change_events
        WHERE organization_id = $1
        ORDER BY created_at DESC, id`,
      [organizationId],
    ),
  ])
  const all = assignments.rows.map(toAuthority)
  const active = (type: AuthorityType) =>
    all.find((item) => item.authorityType === type && item.assignmentStatus === "active" && item.effectiveTo === null && (!customerId || item.customerId === customerId)) ?? null
  const serviceDecisionAuthority = active("SERVICE_DECISION_AUTHORITY")
  const contractSignatory = active("CONTRACT_SIGNATORY")
  return {
    serviceDecisionAuthority,
    contractSignatory,
    samePerson: serviceDecisionAuthority && contractSignatory ? serviceDecisionAuthority.personId === contractSignatory.personId : null,
    assignments: all,
    changes: changes.rows.map((row) => ({
      id: row.id,
      authorityType: row.authority_type,
      changeType: row.change_type,
      newAssignmentId: row.new_assignment_id,
      priorAssignmentId: row.prior_assignment_id,
      noticeEvidenceDocumentId: row.notice_evidence_document_id,
      masterRegisterEventId: row.master_register_event_id,
      createdAt: row.created_at,
    })),
  }
}

export async function readContractsView(client: Pick<PoolClient, "query">, organizationId: string, customerId: string | null): Promise<ContractsView> {
  const [packages, rules, contracts, lines, pricing, matrix, requirements, statusEvents, authorities] = await Promise.all([
    client.query<{ id: string; package_code: string; package_name: string; pricing_basis: PricingBasis; package_status: "active" | "retired" }>(
      `SELECT id, package_code, package_name, pricing_basis, package_status FROM public.contract_package_definitions ORDER BY package_code`,
    ),
    client.query<{ rule_code: string; rule_label: string; required_document_type: string; required_before_status: EvidenceRuleRecord["requiredBeforeStatus"]; rule_status: "active" | "retired" }>(
      `SELECT rule_code, rule_label, required_document_type, required_before_status, rule_status FROM public.contract_evidence_rules ORDER BY required_before_status DESC, rule_code`,
    ),
    client.query<ContractRow>(`SELECT ${CONTRACT_COLUMNS} FROM public.customer_contracts WHERE organization_id = $1 ORDER BY created_at DESC, id`, [organizationId]),
    client.query<LineRow>(
      `SELECT l.id, l.contract_id, l.scope_id, l.line_status, l.responsibility_boundary
         FROM public.customer_contract_line_items l
         JOIN public.customer_contracts c ON c.id = l.contract_id
        WHERE c.organization_id = $1
        ORDER BY l.created_at, l.id`,
      [organizationId],
    ),
    client.query<PricingRow>(
      `SELECT ${pricingColumns("p.")}
         FROM public.customer_contract_line_pricing p
         JOIN public.customer_contract_line_items l ON l.id = p.line_item_id
         JOIN public.customer_contracts c ON c.id = l.contract_id
        WHERE c.organization_id = $1`,
      [organizationId],
    ),
    client.query<MatrixRow>(
      `SELECT ${matrixColumns("m.")}
         FROM public.customer_contract_responsibility_matrix m
         JOIN public.customer_contract_line_items l ON l.id = m.line_item_id
         JOIN public.customer_contracts c ON c.id = l.contract_id
        WHERE c.organization_id = $1
        ORDER BY m.responsibility_area, m.id`,
      [organizationId],
    ),
    client.query<{
      contract_id: string
      rule_code: string
      requirement_status: "missing" | "verified"
      evidence_document_id: string | null
      master_register_event_id: string | null
    }>(
      `SELECT q.contract_id, q.rule_code, q.requirement_status, q.evidence_document_id, q.master_register_event_id
         FROM public.customer_contract_evidence_requirements q
         JOIN public.customer_contracts c ON c.id = q.contract_id
        WHERE c.organization_id = $1`,
      [organizationId],
    ),
    client.query<{
      id: string
      contract_id: string
      from_status: ContractStatus | null
      to_status: ContractStatus
      evidence_document_id: string | null
      master_register_event_id: string
      created_at: string
    }>(
      `SELECT e.id, e.contract_id, e.from_status, e.to_status, e.evidence_document_id, e.master_register_event_id, ${MICRO_ISO("e.created_at")} AS created_at
         FROM public.customer_contract_status_events e
         JOIN public.customer_contracts c ON c.id = e.contract_id
        WHERE c.organization_id = $1
        ORDER BY e.seq`,
      [organizationId],
    ),
    readAuthorityState(client, customerId, organizationId),
  ])

  const ruleRecords: EvidenceRuleRecord[] = rules.rows.map((row) => ({
    ruleCode: row.rule_code,
    ruleLabel: row.rule_label,
    requiredDocumentType: row.required_document_type,
    requiredBeforeStatus: row.required_before_status,
    ruleStatus: row.rule_status,
  }))

  const contractViews: ContractView[] = []
  for (const row of contracts.rows) {
    const contractLines: ContractLineView[] = lines.rows
      .filter((line) => line.contract_id === row.id)
      .map((line) => ({
        id: line.id,
        contractId: line.contract_id,
        scopeId: line.scope_id,
        lineStatus: line.line_status,
        responsibilityBoundary: line.responsibility_boundary,
        pricing: pricing.rows.filter((p) => p.line_item_id === line.id).map(toPricing)[0] ?? null,
        responsibilities: matrix.rows.filter((m) => m.line_item_id === line.id).map(toMatrix),
      }))
    const evidenceRequirements: ContractEvidenceRequirementView[] = ruleRecords
      .filter((rule) => rule.ruleStatus === "active")
      .map((rule) => {
        const found = requirements.rows.find((q) => q.contract_id === row.id && q.rule_code === rule.ruleCode)
        return {
          ruleCode: rule.ruleCode,
          ruleLabel: rule.ruleLabel,
          requiredDocumentType: rule.requiredDocumentType,
          requiredBeforeStatus: rule.requiredBeforeStatus,
          requirementStatus: found?.requirement_status ?? "missing",
          evidenceDocumentId: found?.evidence_document_id ?? null,
          masterRegisterEventId: found?.master_register_event_id ?? null,
        }
      })
    const statusHistory: ContractStatusEventRecord[] = statusEvents.rows
      .filter((event) => event.contract_id === row.id)
      .map((event) => ({
        id: event.id,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        evidenceDocumentId: event.evidence_document_id,
        masterRegisterEventId: event.master_register_event_id,
        createdAt: event.created_at,
      }))
    contractViews.push({
      id: row.id,
      customerId: row.customer_id,
      organizationId: row.organization_id,
      engagementId: row.engagement_id,
      contractStatus: row.contract_status,
      contractReference: row.contract_reference,
      serviceDecisionAuthorityAssignmentId: row.service_decision_authority_assignment_id,
      contractSignatoryAssignmentId: row.contract_signatory_assignment_id,
      lines: contractLines,
      evidenceRequirements,
      statusHistory,
      readiness: await readContractReadiness(client, row.id, row.contract_status),
    })
  }

  return {
    organizationId,
    customerId,
    packages: packages.rows.map((row) => ({
      id: row.id,
      packageCode: row.package_code,
      packageName: row.package_name,
      pricingBasis: row.pricing_basis,
      packageStatus: row.package_status,
    })),
    evidenceRules: ruleRecords,
    authorities,
    contracts: contractViews,
  }
}

/** Contract-significant VIEW accountability: one Master Register event per read of the contracts workspace. */
export async function recordContractsViewed(ctx: OperationContext, organizationId: string, contractIds: string[]): Promise<void> {
  await record(
    ctx,
    "RECORD_VIEWED",
    "view_contracts_workspace",
    { resourceType: "organization_contracts", resourceId: organizationId, organizationId },
    [{ field: "contracts", after: literal(contractIds.length) }, ...contractIds.map((id) => ({ field: "contract", after: reference("customer_contract", id) }))],
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------------------------

async function lockContract(client: PoolClient, contractId: string): Promise<ContractRow> {
  const result = await client.query<ContractRow>(`SELECT ${CONTRACT_COLUMNS} FROM public.customer_contracts WHERE id = $1 FOR UPDATE`, [contractId])
  if (result.rows.length === 0) throw new ContractNotFoundError("Contract")
  return result.rows[0]
}

function requireDraft(contract: ContractRow): void {
  if (contract.contract_status !== "draft") throw new ContractStateError("Contract design can only change while the contract is a draft.")
}

async function requireActiveDecisionAuthority(client: PoolClient, contract: ContractRow): Promise<string> {
  const id = contract.service_decision_authority_assignment_id
  if (!id) throw new ContractStateError("The contract has no Service Decision Authority; only that authority can decide contracted service scope.", ["SERVICE_DECISION_AUTHORITY"])
  const result = await client.query<{ ok: boolean }>(
    `SELECT (authority_type = 'SERVICE_DECISION_AUTHORITY' AND assignment_status = 'active' AND effective_to IS NULL AND customer_id = $2) AS ok
       FROM public.customer_authority_assignments WHERE id = $1`,
    [id, contract.customer_id],
  )
  if (result.rows[0]?.ok !== true) throw new ContractStateError("The contract's Service Decision Authority is no longer active.", ["SERVICE_DECISION_AUTHORITY"])
  return id
}

async function loadLine(client: PoolClient, lineItemId: string): Promise<{ line: LineRow; contract: ContractRow }> {
  const lineResult = await client.query<LineRow>(
    `SELECT id, contract_id, scope_id, line_status, responsibility_boundary FROM public.customer_contract_line_items WHERE id = $1`,
    [lineItemId],
  )
  if (lineResult.rows.length === 0) throw new ContractNotFoundError("Contract line")
  const contract = await lockContract(client, lineResult.rows[0].contract_id)
  const refreshed = await client.query<LineRow>(
    `SELECT id, contract_id, scope_id, line_status, responsibility_boundary FROM public.customer_contract_line_items WHERE id = $1 FOR UPDATE`,
    [lineItemId],
  )
  if (refreshed.rows[0].line_status === "removed") throw new ContractStateError("The contract line was removed.")
  return { line: refreshed.rows[0], contract }
}

function contractTarget(contract: ContractRow, resourceType: string, resourceId: string): Target {
  return { resourceType, resourceId, organizationId: contract.organization_id, customerId: contract.customer_id, contractId: contract.id }
}

async function advisoryLock(client: PoolClient, key: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key])
}

// ---------------------------------------------------------------------------------------------------------------
// Package definitions
// ---------------------------------------------------------------------------------------------------------------

export async function definePackage(
  ctx: OperationContext,
  input: { organizationId: string; packageCode: unknown; packageName: unknown; pricingBasis: unknown },
): Promise<PackageDefinitionRecord> {
  if (!isCode(input.packageCode)) throw new ContractValidationError("packageCode", "Package code must be UPPER_SNAKE_CASE.")
  if (typeof input.packageName !== "string" || input.packageName.trim().length === 0 || input.packageName.trim().length > 160) {
    throw new ContractValidationError("packageName", "Package name is required (up to 160 characters).")
  }
  if (!isOneOf(PRICING_BASES, input.pricingBasis)) throw new ContractValidationError("pricingBasis", "Unsupported pricing basis.")
  const id = randomUUID()
  await record(
    ctx,
    "RECORD_CREATED",
    "define_package",
    { resourceType: "contract_package_definition", resourceId: id, organizationId: input.organizationId },
    [
      { field: "packageCode", after: literal(input.packageCode) },
      { field: "pricingBasis", after: literal(input.pricingBasis) },
    ],
  )
  return guarded(async () => {
    const result = await ctx.client.query<{ id: string; package_code: string; package_name: string; pricing_basis: PricingBasis; package_status: "active" | "retired" }>(
      `INSERT INTO public.contract_package_definitions (id, package_code, package_name, pricing_basis)
       VALUES ($1, $2, $3, $4)
       RETURNING id, package_code, package_name, pricing_basis, package_status`,
      [id, input.packageCode, (input.packageName as string).trim(), input.pricingBasis],
    )
    const row = result.rows[0]
    return { id: row.id, packageCode: row.package_code, packageName: row.package_name, pricingBasis: row.pricing_basis, packageStatus: row.package_status }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Authorities
// ---------------------------------------------------------------------------------------------------------------

async function nowInstant(client: PoolClient): Promise<string> {
  const result = await client.query<{ now: string }>(`SELECT ${MICRO_ISO("clock_timestamp()")} AS now`)
  return result.rows[0].now
}

/**
 * Assigns the single active Service Decision Authority or Contract Signatory of a customer. When one already exists it is
 * REPLACED: the old assignment is ended (superseded, never deleted, evidence preserved), and the verified written company
 * notice behind the change is recorded in the authority change ledger with a Master Register event.
 *
 * Contracts that depended on the replaced assignment are made consistent in the same transaction: a draft follows the new
 * holder; a contract that was ready_for_signature returns to draft (the notice is the evidence); a signed contract is history
 * and is never touched.
 */
export async function assignCustomerAuthority(
  ctx: OperationContext,
  input: {
    customerId: unknown
    organizationId: unknown
    personId: unknown
    authorityType: unknown
    noticeEvidenceDocumentId: unknown
    effectiveFrom?: unknown
  },
): Promise<AuthorityAssignmentView> {
  const customerId = requireUuid("customerId", input.customerId)
  const organizationId = requireUuid("organizationId", input.organizationId)
  const personId = requireUuid("personId", input.personId)
  const noticeId = requireUuid("noticeEvidenceDocumentId", input.noticeEvidenceDocumentId)
  if (!isAuthorityType(input.authorityType)) throw new ContractValidationError("authorityType", "Unsupported authority type.")
  const authorityType = input.authorityType
  const client = ctx.client

  const now = await nowInstant(client)
  let effectiveFrom = now
  if (input.effectiveFrom !== undefined && input.effectiveFrom !== null && input.effectiveFrom !== "") {
    const parsed = typeof input.effectiveFrom === "string" ? new Date(input.effectiveFrom) : null
    if (!parsed || Number.isNaN(parsed.getTime())) throw new ContractValidationError("effectiveFrom", "Effective date must be a valid instant.")
    if (parsed.getTime() > Date.now() + 1000) throw new ContractValidationError("effectiveFrom", "An authority cannot take effect in the future; record the notice when it takes effect.")
    effectiveFrom = parsed.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z")
  }

  await advisoryLock(client, `authority:${customerId}:${authorityType}`)

  return guarded(async () => {
    const existing = await client.query<AuthorityRow>(
      `SELECT ${AUTHORITY_COLUMNS} FROM public.customer_authority_assignments
        WHERE customer_id = $1 AND authority_type = $2 AND assignment_status = 'active' AND effective_to IS NULL FOR UPDATE`,
      [customerId, authorityType],
    )
    const prior = existing.rows[0] ?? null
    if (prior && prior.person_id === personId) throw new ContractConflictError("This person already holds the authority; a replacement needs a different holder.")
    if (prior && new Date(effectiveFrom).getTime() <= new Date(prior.effective_from).getTime()) {
      throw new ContractValidationError("effectiveFrom", "The replacement must take effect after the current assignment began.")
    }

    const newId = randomUUID()
    const eventId = await record(
      ctx,
      prior ? "ASSIGNMENT_REASSIGNED" : "ASSIGNMENT_CREATED",
      prior ? "replace_customer_authority" : "assign_customer_authority",
      { resourceType: "customer_authority_assignment", resourceId: newId, organizationId, customerId },
      [
        { field: "authorityType", after: literal(authorityType) },
        { field: "person", after: reference("person", personId) },
        ...(prior ? [{ field: "replaces", before: reference("customer_authority_assignment", prior.id), after: reference("customer_authority_assignment", newId) }] : []),
      ],
      [noticeId],
    )

    if (prior) {
      await client.query(
        `UPDATE public.customer_authority_assignments
            SET assignment_status = 'superseded', effective_to = $2::timestamptz,
                replacement_reason = 'Replaced by verified written company notice', updated_at = clock_timestamp()
          WHERE id = $1`,
        [prior.id, effectiveFrom],
      )
    }
    const inserted = await client.query<AuthorityRow>(
      `INSERT INTO public.customer_authority_assignments (id, customer_id, organization_id, person_id, authority_type, effective_from, notice_evidence_document_id)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7)
       RETURNING ${AUTHORITY_COLUMNS}`,
      [newId, customerId, organizationId, personId, authorityType, effectiveFrom, noticeId],
    )
    await client.query(
      `INSERT INTO public.customer_authority_change_events
        (customer_id, organization_id, authority_type, change_type, new_assignment_id, prior_assignment_id, notice_evidence_document_id, master_register_event_id, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [customerId, organizationId, authorityType, prior ? "replaced" : "assigned", newId, prior?.id ?? null, noticeId, eventId, ctx.actor.id],
    )
    await realignDependentContracts(ctx, { customerId, organizationId, authorityType, priorId: prior?.id ?? null, newId, noticeId })
    return toAuthority(inserted.rows[0])
  })
}

/** Revokes an active authority without a replacement (the role is then vacant and blocks contract readiness). */
export async function revokeCustomerAuthority(
  ctx: OperationContext,
  input: { assignmentId: unknown; noticeEvidenceDocumentId: unknown },
): Promise<AuthorityAssignmentView> {
  const assignmentId = requireUuid("assignmentId", input.assignmentId)
  const noticeId = requireUuid("noticeEvidenceDocumentId", input.noticeEvidenceDocumentId)
  const client = ctx.client
  return guarded(async () => {
    const found = await client.query<AuthorityRow>(`SELECT ${AUTHORITY_COLUMNS} FROM public.customer_authority_assignments WHERE id = $1`, [assignmentId])
    if (found.rows.length === 0) throw new ContractNotFoundError("Authority assignment")
    const row = found.rows[0]
    await advisoryLock(client, `authority:${row.customer_id}:${row.authority_type}`)
    const locked = await client.query<AuthorityRow>(`SELECT ${AUTHORITY_COLUMNS} FROM public.customer_authority_assignments WHERE id = $1 FOR UPDATE`, [assignmentId])
    const current = locked.rows[0]
    if (current.assignment_status !== "active") throw new ContractStateError("Only an active authority can be revoked.")

    const now = await nowInstant(client)
    if (new Date(now).getTime() <= new Date(current.effective_from).getTime()) throw new ContractStateError("The authority cannot be revoked before it began.")
    const eventId = await record(
      ctx,
      "ASSIGNMENT_RELEASED",
      "revoke_customer_authority",
      { resourceType: "customer_authority_assignment", resourceId: current.id, organizationId: current.organization_id, customerId: current.customer_id },
      [
        { field: "authorityType", after: literal(current.authority_type) },
        { field: "assignmentStatus", before: literal("active"), after: literal("voided") },
      ],
      [noticeId],
    )
    const updated = await client.query<AuthorityRow>(
      `UPDATE public.customer_authority_assignments
          SET assignment_status = 'voided', effective_to = $2::timestamptz,
              replacement_reason = 'Revoked by verified written company notice', updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING ${AUTHORITY_COLUMNS}`,
      [current.id, now],
    )
    await client.query(
      `INSERT INTO public.customer_authority_change_events
        (customer_id, organization_id, authority_type, change_type, new_assignment_id, prior_assignment_id, notice_evidence_document_id, master_register_event_id, actor_id)
       VALUES ($1, $2, $3, 'revoked', NULL, $4, $5, $6, $7)`,
      [current.customer_id, current.organization_id, current.authority_type, current.id, noticeId, eventId, ctx.actor.id],
    )
    await realignDependentContracts(ctx, {
      customerId: current.customer_id,
      organizationId: current.organization_id,
      authorityType: current.authority_type,
      priorId: current.id,
      newId: null,
      noticeId,
    })
    return toAuthority(updated.rows[0])
  })
}

async function realignDependentContracts(
  ctx: OperationContext,
  input: { customerId: string; organizationId: string; authorityType: AuthorityType; priorId: string | null; newId: string | null; noticeId: string },
): Promise<void> {
  if (!input.priorId) return
  const column = input.authorityType === "SERVICE_DECISION_AUTHORITY" ? "service_decision_authority_assignment_id" : "contract_signatory_assignment_id"
  const dependents = await ctx.client.query<ContractRow>(
    `SELECT ${CONTRACT_COLUMNS} FROM public.customer_contracts
      WHERE customer_id = $1 AND ${column} = $2 AND contract_status IN ('draft', 'ready_for_signature') FOR UPDATE`,
    [input.customerId, input.priorId],
  )
  for (const contract of dependents.rows) {
    if (contract.contract_status === "ready_for_signature") {
      const eventId = await record(
        ctx,
        "RECORD_STATUS_CHANGED",
        "return_contract_to_draft_after_authority_change",
        contractTarget(contract, "customer_contract", contract.id),
        [{ field: "contractStatus", before: literal("ready_for_signature"), after: literal("draft") }],
        [input.noticeId],
      )
      await ctx.client.query(
        `INSERT INTO public.customer_contract_status_events (contract_id, from_status, to_status, evidence_document_id, master_register_event_id, actor_id)
         VALUES ($1, 'ready_for_signature', 'draft', $2, $3, $4)`,
        [contract.id, input.noticeId, eventId, ctx.actor.id],
      )
      await ctx.client.query(`UPDATE public.customer_contracts SET contract_status = 'draft', ${column} = $2 WHERE id = $1`, [contract.id, input.newId])
      await ctx.client.query(`UPDATE public.customer_contract_line_items SET line_status = 'draft', updated_at = clock_timestamp() WHERE contract_id = $1 AND line_status = 'ready'`, [contract.id])
    } else {
      await ctx.client.query(`UPDATE public.customer_contracts SET ${column} = $2 WHERE id = $1`, [contract.id, input.newId])
    }
  }
}

export type AuthorityValidation = {
  serviceDecisionAuthority: AuthorityAssignmentView | null
  contractSignatory: AuthorityAssignmentView | null
  samePerson: boolean | null
  issues: Array<"SERVICE_DECISION_AUTHORITY" | "CONTRACT_SIGNATORY">
}

/** Read-only: does the customer currently have exactly one valid holder of each authority? */
export async function validateAuthorities(client: Pick<PoolClient, "query">, customerId: string, organizationId: string): Promise<AuthorityValidation> {
  const state = await readAuthorityState(client, customerId, organizationId)
  const issues: AuthorityValidation["issues"] = []
  if (!state.serviceDecisionAuthority) issues.push("SERVICE_DECISION_AUTHORITY")
  if (!state.contractSignatory) issues.push("CONTRACT_SIGNATORY")
  return { serviceDecisionAuthority: state.serviceDecisionAuthority, contractSignatory: state.contractSignatory, samePerson: state.samePerson, issues }
}

// ---------------------------------------------------------------------------------------------------------------
// Contract draft
// ---------------------------------------------------------------------------------------------------------------

async function ensureEvidenceRequirementRows(client: PoolClient, contractId: string): Promise<void> {
  await client.query(
    `INSERT INTO public.customer_contract_evidence_requirements (contract_id, rule_code)
     SELECT $1, r.rule_code FROM public.contract_evidence_rules r WHERE r.rule_status = 'active'
     ON CONFLICT (contract_id, rule_code) DO NOTHING`,
    [contractId],
  )
}

/**
 * Creates a draft contract for an open engagement of a customer, pointing at the customer's current Service Decision
 * Authority and Contract Signatory (when they exist), and writes the Master Register accountability baseline.
 */
export async function createContractDraft(
  ctx: OperationContext,
  input: { organizationId: unknown; customerId: unknown; engagementId: unknown; contractReference?: unknown },
): Promise<string> {
  const organizationId = requireUuid("organizationId", input.organizationId)
  const customerId = requireUuid("customerId", input.customerId)
  const engagementId = requireUuid("engagementId", input.engagementId)
  const reference_ = normalizeReference(input.contractReference)
  const client = ctx.client

  await advisoryLock(client, `contract-engagement:${engagementId}`)
  return guarded(async () => {
    const relationship = await client.query<{ matches: boolean; open: boolean }>(
      `SELECT tes_security.contract_customer_matches_organization($1, $2) AS matches,
              tes_security.contract_engagement_is_open_for_customer($3, $1) AS open`,
      [customerId, organizationId, engagementId],
    )
    if (!relationship.rows[0]?.matches) throw new ContractValidationError("customerId", "The customer does not belong to this organization.")
    if (!relationship.rows[0]?.open) throw new ContractStateError("A contract needs an open engagement of this customer.", ["CUSTOMER_RELATIONSHIP"])

    const working = await client.query(
      `SELECT 1 FROM public.customer_contracts WHERE engagement_id = $1 AND contract_status IN ('draft', 'ready_for_signature', 'signed') LIMIT 1`,
      [engagementId],
    )
    if (working.rows.length > 0) throw new ContractConflictError("This engagement already has a working or signed contract; supersede or archive it first.")

    const authorities = await client.query<{ id: string; authority_type: AuthorityType }>(
      `SELECT id, authority_type FROM public.customer_authority_assignments
        WHERE customer_id = $1 AND assignment_status = 'active' AND effective_to IS NULL`,
      [customerId],
    )
    const sda = authorities.rows.find((row) => row.authority_type === "SERVICE_DECISION_AUTHORITY")?.id ?? null
    const signatory = authorities.rows.find((row) => row.authority_type === "CONTRACT_SIGNATORY")?.id ?? null

    const contractId = randomUUID()
    const eventId = await record(
      ctx,
      "RECORD_CREATED",
      "create_contract_draft",
      { resourceType: "customer_contract", resourceId: contractId, organizationId, customerId, contractId },
      [
        { field: "contractStatus", after: literal("draft") },
        { field: "engagement", after: reference("customer_engagement", engagementId) },
      ],
    )
    await client.query(
      `INSERT INTO public.customer_contracts
        (id, customer_id, organization_id, engagement_id, contract_reference, service_decision_authority_assignment_id, contract_signatory_assignment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [contractId, customerId, organizationId, engagementId, reference_, sda, signatory],
    )
    await client.query(
      `INSERT INTO public.customer_contract_status_events (contract_id, from_status, to_status, master_register_event_id, actor_id)
       VALUES ($1, NULL, 'draft', $2, $3)`,
      [contractId, eventId, ctx.actor.id],
    )
    await ensureEvidenceRequirementRows(client, contractId)
    return contractId
  })
}

function normalizeReference(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new ContractValidationError("contractReference", "Contract reference must be text.")
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 120 || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) {
    throw new ContractValidationError("contractReference", "Contract reference must be 1-120 printable characters.")
  }
  return trimmed
}

/** Updates a draft: its reference, and re-points it at the customer's current authorities (validating each). */
export async function updateContractDraft(
  ctx: OperationContext,
  input: { contractId: unknown; contractReference?: unknown; syncAuthorities?: unknown },
): Promise<void> {
  const contractId = requireUuid("contractId", input.contractId)
  const client = ctx.client
  const contract = await lockContract(client, contractId)
  requireDraft(contract)
  const changes: FieldChange[] = []
  let reference_ = contract.contract_reference
  if (input.contractReference !== undefined) {
    reference_ = normalizeReference(input.contractReference)
    changes.push({ field: "contractReference", before: literal(contract.contract_reference === null ? null : "SET"), after: literal(reference_ === null ? null : "SET") })
  }
  let sda = contract.service_decision_authority_assignment_id
  let signatory = contract.contract_signatory_assignment_id
  if (input.syncAuthorities === true) {
    const state = await readAuthorityState(client, contract.customer_id, contract.organization_id)
    sda = state.serviceDecisionAuthority?.id ?? null
    signatory = state.contractSignatory?.id ?? null
    changes.push(
      { field: "serviceDecisionAuthority", after: sda ? reference("customer_authority_assignment", sda) : literal(null) },
      { field: "contractSignatory", after: signatory ? reference("customer_authority_assignment", signatory) : literal(null) },
    )
  }
  if (changes.length === 0) throw new ContractValidationError("contractId", "Nothing to update.")
  await record(ctx, "RECORD_UPDATED", "update_contract_draft", contractTarget(contract, "customer_contract", contract.id), changes)
  await guarded(() =>
    client.query(
      `UPDATE public.customer_contracts SET contract_reference = $2, service_decision_authority_assignment_id = $3, contract_signatory_assignment_id = $4 WHERE id = $1`,
      [contractId, reference_, sda, signatory],
    ),
  )
}

/** A contract created before migration 0031 has no accountability baseline; this records one (draft contracts only). */
export async function establishAccountabilityBaseline(ctx: OperationContext, input: { contractId: unknown }): Promise<void> {
  const contractId = requireUuid("contractId", input.contractId)
  const contract = await lockContract(ctx.client, contractId)
  requireDraft(contract)
  const eventId = await record(ctx, "RECORD_CREATED", "establish_contract_accountability_baseline", contractTarget(contract, "customer_contract", contract.id), [
    { field: "contractStatus", after: literal("draft") },
  ])
  await guarded(async () => {
    await ctx.client.query(
      `INSERT INTO public.customer_contract_status_events (contract_id, from_status, to_status, master_register_event_id, actor_id) VALUES ($1, NULL, 'draft', $2, $3)`,
      [contractId, eventId, ctx.actor.id],
    )
    await ensureEvidenceRequirementRows(ctx.client, contractId)
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Service scopes, responsibility boundary, pricing
// ---------------------------------------------------------------------------------------------------------------

export async function attachServiceScopes(ctx: OperationContext, input: { contractId: unknown; scopeIds: unknown }): Promise<string[]> {
  const contractId = requireUuid("contractId", input.contractId)
  if (!Array.isArray(input.scopeIds) || input.scopeIds.length === 0) throw new ContractValidationError("scopeIds", "Choose at least one service scope.")
  const scopeIds = [...new Set(input.scopeIds.map((id, index) => requireUuid(`scopeIds[${index}]`, id)))]
  const contract = await lockContract(ctx.client, contractId)
  requireDraft(contract)
  await requireActiveDecisionAuthority(ctx.client, contract)

  return guarded(async () => {
    const created: string[] = []
    for (const scopeId of scopeIds) {
      const existing = await ctx.client.query(`SELECT 1 FROM public.customer_contract_line_items WHERE contract_id = $1 AND scope_id = $2 AND line_status <> 'removed'`, [contractId, scopeId])
      if (existing.rows.length > 0) continue
      const lineId = randomUUID()
      await record(ctx, "RECORD_LINK_ESTABLISHED", "attach_service_scope", contractTarget(contract, "customer_contract_line_item", lineId), [
        { field: "scope", after: reference("engagement_service_scope", scopeId) },
      ])
      await ctx.client.query(`INSERT INTO public.customer_contract_line_items (id, contract_id, scope_id) VALUES ($1, $2, $3)`, [lineId, contractId, scopeId])
      created.push(lineId)
    }
    return created
  })
}

export async function detachServiceScope(ctx: OperationContext, input: { lineItemId: unknown }): Promise<void> {
  const lineItemId = requireUuid("lineItemId", input.lineItemId)
  const { line, contract } = await loadLine(ctx.client, lineItemId)
  requireDraft(contract)
  await record(ctx, "RECORD_LINK_REMOVED", "detach_service_scope", contractTarget(contract, "customer_contract_line_item", line.id), [
    { field: "scope", before: reference("engagement_service_scope", line.scope_id) },
  ])
  await guarded(() => ctx.client.query(`UPDATE public.customer_contract_line_items SET line_status = 'removed', updated_at = clock_timestamp() WHERE id = $1`, [line.id]))
}

export type ResponsibilityInput = {
  responsibilityArea: unknown
  responsibleParty: unknown
  effectiveResponsibilityDate: unknown
  historyTreatment?: unknown
  historyAssumedFrom?: unknown
  historyEvidenceDocumentId?: unknown
}

/**
 * Defines the responsibility boundary of one contract line. TES responsibility begins only on the explicit effective
 * responsibility date (and never before TES assumed responsibility for the scope - the database refuses that). Pre-engagement
 * history is excluded unless the contract explicitly says TES assumes it AND verified evidence supports it.
 */
export async function defineResponsibilityBoundary(
  ctx: OperationContext,
  input: { lineItemId: unknown; decisionEvidenceDocumentId: unknown; rows: unknown },
): Promise<ResponsibilityRowRecord[]> {
  const lineItemId = requireUuid("lineItemId", input.lineItemId)
  const decisionEvidence = requireUuid("decisionEvidenceDocumentId", input.decisionEvidenceDocumentId)
  if (!Array.isArray(input.rows) || input.rows.length === 0) throw new ContractValidationError("rows", "Define at least one responsibility row.")
  const rows = (input.rows as ResponsibilityInput[]).map((raw, index) => {
    const field = (name: string) => `rows[${index}].${name}`
    if (!isCode(raw.responsibilityArea)) throw new ContractValidationError(field("responsibilityArea"), "Responsibility area must be UPPER_SNAKE_CASE.")
    if (!isOneOf(RESPONSIBLE_PARTIES, raw.responsibleParty)) throw new ContractValidationError(field("responsibleParty"), "Responsible party must be TES, CUSTOMER or SHARED.")
    if (!isCalendarDate(raw.effectiveResponsibilityDate)) throw new ContractValidationError(field("effectiveResponsibilityDate"), "An explicit effective responsibility date (YYYY-MM-DD) is required.")
    const treatment = raw.historyTreatment ?? "excluded"
    if (!isOneOf(HISTORY_TREATMENTS, treatment)) throw new ContractValidationError(field("historyTreatment"), "Unsupported history treatment.")
    let assumedFrom: string | null = null
    let historyEvidence: string | null = null
    if (treatment === "tes_assumes_with_evidence") {
      if (!isCalendarDate(raw.historyAssumedFrom)) throw new ContractValidationError(field("historyAssumedFrom"), "Assumed history needs the date it starts from.")
      if (raw.historyAssumedFrom >= raw.effectiveResponsibilityDate) throw new ContractValidationError(field("historyAssumedFrom"), "Assumed history must start before the effective responsibility date.")
      assumedFrom = raw.historyAssumedFrom
      historyEvidence = requireUuid(field("historyEvidenceDocumentId"), raw.historyEvidenceDocumentId)
    } else if ((raw.historyAssumedFrom ?? null) !== null || (raw.historyEvidenceDocumentId ?? null) !== null) {
      throw new ContractValidationError(field("historyTreatment"), "History dates and evidence only apply when TES assumes history with evidence.")
    }
    return {
      area: raw.responsibilityArea,
      party: raw.responsibleParty as ResponsibleParty,
      effectiveDate: raw.effectiveResponsibilityDate,
      treatment: treatment as HistoryTreatment,
      assumedFrom,
      historyEvidence,
    }
  })
  if (new Set(rows.map((row) => row.area)).size !== rows.length) throw new ContractValidationError("rows", "Each responsibility area can appear once.")

  const { line, contract } = await loadLine(ctx.client, lineItemId)
  requireDraft(contract)
  const decidedBy = await requireActiveDecisionAuthority(ctx.client, contract)

  return guarded(async () => {
    for (const row of rows) {
      const eventId = await record(
        ctx,
        "APPROVAL_DECISION_RECORDED",
        "define_responsibility_boundary",
        contractTarget(contract, "customer_contract_line_item", line.id),
        [
          { field: "responsibilityArea", after: literal(row.area) },
          { field: "responsibleParty", after: literal(row.party) },
          { field: "effectiveResponsibilityDate", after: literal(row.effectiveDate) },
          { field: "historyTreatment", after: literal(row.treatment) },
        ],
        [decisionEvidence, ...(row.historyEvidence ? [row.historyEvidence] : [])],
      )
      await ctx.client.query(
        `INSERT INTO public.customer_contract_responsibility_matrix
          (line_item_id, responsibility_area, responsible_party, effective_responsibility_date, history_treatment, history_assumed_from,
           history_evidence_document_id, decided_by_assignment_id, decision_evidence_document_id, master_register_event_id)
         VALUES ($1, $2, $3, $4::date, $5, $6::date, $7, $8, $9, $10)
         ON CONFLICT (line_item_id, responsibility_area) DO UPDATE SET
           responsible_party = EXCLUDED.responsible_party,
           effective_responsibility_date = EXCLUDED.effective_responsibility_date,
           history_treatment = EXCLUDED.history_treatment,
           history_assumed_from = EXCLUDED.history_assumed_from,
           history_evidence_document_id = EXCLUDED.history_evidence_document_id,
           decided_by_assignment_id = EXCLUDED.decided_by_assignment_id,
           decision_evidence_document_id = EXCLUDED.decision_evidence_document_id,
           master_register_event_id = EXCLUDED.master_register_event_id`,
        [line.id, row.area, row.party, row.effectiveDate, row.treatment, row.assumedFrom, row.historyEvidence, decidedBy, decisionEvidence, eventId],
      )
    }
    const all = await ctx.client.query<MatrixRow>(`SELECT ${MATRIX_COLUMNS} FROM public.customer_contract_responsibility_matrix WHERE line_item_id = $1 ORDER BY responsibility_area`, [line.id])
    const boundary = deriveResponsibilityBoundary(all.rows.map((row) => row.history_treatment))
    await ctx.client.query(`UPDATE public.customer_contract_line_items SET responsibility_boundary = $2, updated_at = clock_timestamp() WHERE id = $1`, [line.id, boundary])
    return all.rows.map(toMatrix)
  })
}

export async function assignPricingPackage(
  ctx: OperationContext,
  input: {
    lineItemId: unknown
    decisionEvidenceDocumentId: unknown
    pricingBasis: unknown
    packageCode?: unknown
    feeMinorUnits?: unknown
    feeCurrency?: unknown
  },
): Promise<LinePricingRecord> {
  const lineItemId = requireUuid("lineItemId", input.lineItemId)
  const decisionEvidence = requireUuid("decisionEvidenceDocumentId", input.decisionEvidenceDocumentId)
  if (!isOneOf(PRICING_BASES, input.pricingBasis)) throw new ContractValidationError("pricingBasis", "Unsupported pricing basis.")
  const basis = input.pricingBasis as PricingBasis
  const packageCode = input.packageCode === undefined || input.packageCode === null || input.packageCode === "" ? null : input.packageCode
  if (packageCode !== null && !isCode(packageCode)) throw new ContractValidationError("packageCode", "Package code must be UPPER_SNAKE_CASE.")
  let fee: number | null = null
  let currency: FeeCurrency | null = null
  if (input.feeMinorUnits !== undefined && input.feeMinorUnits !== null && input.feeMinorUnits !== "") {
    fee = Number(input.feeMinorUnits)
    if (!Number.isSafeInteger(fee) || fee < 0) throw new ContractValidationError("feeMinorUnits", "The fee must be a non-negative whole number of minor units.")
    if (!isOneOf(FEE_CURRENCIES, input.feeCurrency)) throw new ContractValidationError("feeCurrency", "A fee needs a currency (CAD or USD).")
    currency = input.feeCurrency as FeeCurrency
  }
  if (basis === "monthly_package" && (packageCode === null || fee === null)) throw new ContractValidationError("pricingBasis", "A monthly package needs a package and a fee.")
  if (basis === "one_time_service" && fee === null) throw new ContractValidationError("pricingBasis", "A one-time service needs a fee.")
  if (basis === "included_in_package" && (packageCode === null || fee !== null)) throw new ContractValidationError("pricingBasis", "A service included in a package needs a package and no separate fee.")
  const period = basis === "monthly_package" ? "monthly" : basis === "one_time_service" ? "one_time" : "none"

  const { line, contract } = await loadLine(ctx.client, lineItemId)
  requireDraft(contract)
  const decidedBy = await requireActiveDecisionAuthority(ctx.client, contract)

  return guarded(async () => {
    // Fee amounts are never copied into the Master Register; the event records the basis, package and that a fee was set.
    const eventId = await record(
      ctx,
      "APPROVAL_DECISION_RECORDED",
      "assign_pricing_package",
      contractTarget(contract, "customer_contract_line_item", line.id),
      [
        { field: "pricingBasis", after: literal(basis) },
        { field: "packageCode", after: literal(packageCode) },
        { field: "feeSet", after: literal(fee !== null) },
      ],
      [decisionEvidence],
    )
    const result = await ctx.client.query<PricingRow>(
      `INSERT INTO public.customer_contract_line_pricing
        (line_item_id, pricing_basis, package_code, fee_minor_units, fee_currency, fee_period, decided_by_assignment_id, decision_evidence_document_id, master_register_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (line_item_id) DO UPDATE SET
         pricing_basis = EXCLUDED.pricing_basis, package_code = EXCLUDED.package_code, fee_minor_units = EXCLUDED.fee_minor_units,
         fee_currency = EXCLUDED.fee_currency, fee_period = EXCLUDED.fee_period, decided_by_assignment_id = EXCLUDED.decided_by_assignment_id,
         decision_evidence_document_id = EXCLUDED.decision_evidence_document_id, master_register_event_id = EXCLUDED.master_register_event_id
       RETURNING ${PRICING_COLUMNS}`,
      [line.id, basis, packageCode, fee, currency, period, decidedBy, decisionEvidence, eventId],
    )
    await ctx.client.query(`UPDATE public.customer_contract_line_items SET pricing_basis = $2, package_code = $3, updated_at = clock_timestamp() WHERE id = $1`, [line.id, basis, packageCode])
    return toPricing(result.rows[0])
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------------------------

/** Links a verified evidence document to a contract evidence rule. The database checks type, organization and verification. */
export async function linkContractEvidence(ctx: OperationContext, input: { contractId: unknown; ruleCode: unknown; evidenceDocumentId: unknown }): Promise<void> {
  const contractId = requireUuid("contractId", input.contractId)
  const evidenceDocumentId = requireUuid("evidenceDocumentId", input.evidenceDocumentId)
  if (!isCode(input.ruleCode)) throw new ContractValidationError("ruleCode", "Evidence rule code must be UPPER_SNAKE_CASE.")
  const ruleCode = input.ruleCode
  const contract = await lockContract(ctx.client, contractId)
  if (!["draft", "ready_for_signature"].includes(contract.contract_status)) throw new ContractStateError("Evidence can only be linked while the contract is a draft or ready for signature.")
  const rule = await ctx.client.query(`SELECT 1 FROM public.contract_evidence_rules WHERE rule_code = $1 AND rule_status = 'active'`, [ruleCode])
  if (rule.rows.length === 0) throw new ContractNotFoundError("Evidence rule")

  await guarded(async () => {
    const eventId = await record(
      ctx,
      "EVIDENCE_ASSOCIATED",
      "link_contract_evidence",
      contractTarget(contract, "customer_contract", contract.id),
      [{ field: "evidenceRule", after: literal(ruleCode) }],
      [evidenceDocumentId],
    )
    await ctx.client.query(
      `INSERT INTO public.customer_contract_evidence_requirements (contract_id, rule_code, requirement_status, evidence_document_id, master_register_event_id)
       VALUES ($1, $2, 'verified', $3, $4)
       ON CONFLICT (contract_id, rule_code) DO UPDATE SET
         requirement_status = 'verified', evidence_document_id = EXCLUDED.evidence_document_id, master_register_event_id = EXCLUDED.master_register_event_id`,
      [contractId, ruleCode, evidenceDocumentId, eventId],
    )
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------------------------

/**
 * Advances (or returns to draft / archives) a contract. Refused unless: the transition is allowed, every readiness gate for
 * the target passes, verified evidence backs the change, and the Master Register records it - the database re-checks all of
 * it in the status trigger, so no caller can skip a step by writing around this function.
 */
export async function advanceContractStatus(
  ctx: OperationContext,
  input: { contractId: unknown; toStatus: unknown; evidenceDocumentId: unknown },
): Promise<void> {
  const contractId = requireUuid("contractId", input.contractId)
  const evidenceDocumentId = requireUuid("evidenceDocumentId", input.evidenceDocumentId)
  if (!isContractStatus(input.toStatus)) throw new ContractValidationError("toStatus", "Unsupported contract status.")
  const toStatus = input.toStatus
  const contract = await lockContract(ctx.client, contractId)
  const from = contract.contract_status
  if (!canTransition(from, toStatus)) {
    throw new ContractStateError(`A ${from.replaceAll("_", " ")} contract cannot move to ${toStatus.replaceAll("_", " ")} (allowed: ${CONTRACT_TRANSITIONS[from].join(", ") || "none"}).`)
  }

  if (toStatus === "ready_for_signature" || toStatus === "signed") {
    const readiness = await readContractReadiness(ctx.client, contractId, from)
    if (!readiness.ready) throw new ContractStateError(`The contract is not ready: ${readiness.failures.join(", ")}.`, readiness.failures)
  }

  await guarded(async () => {
    const eventId = await record(
      ctx,
      "RECORD_STATUS_CHANGED",
      `advance_contract_${toStatus}`,
      contractTarget(contract, "customer_contract", contract.id),
      [{ field: "contractStatus", before: literal(from), after: literal(toStatus) }],
      [evidenceDocumentId],
    )
    await ctx.client.query(
      `INSERT INTO public.customer_contract_status_events (contract_id, from_status, to_status, evidence_document_id, master_register_event_id, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [contractId, from, toStatus, evidenceDocumentId, eventId, ctx.actor.id],
    )
    await ctx.client.query(`UPDATE public.customer_contracts SET contract_status = $2 WHERE id = $1`, [contractId, toStatus])
    const lineStatus = toStatus === "ready_for_signature" ? "ready" : toStatus === "signed" ? "signed" : toStatus === "draft" ? "draft" : null
    if (lineStatus) {
      await ctx.client.query(`UPDATE public.customer_contract_line_items SET line_status = $2, updated_at = clock_timestamp() WHERE contract_id = $1 AND line_status <> 'removed'`, [contractId, lineStatus])
    }
  })
}
