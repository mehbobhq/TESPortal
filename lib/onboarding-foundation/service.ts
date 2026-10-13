import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"

type Queryable = Pick<PoolClient, "query">

const MICRO_ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const MICRO_ISO_NULL = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL ELSE ${MICRO_ISO(column)} END`

export type EvidenceRequirementStatus = "missing" | "received" | "verified" | "waived" | "not_applicable"
export type AuthorityType = "SERVICE_DECISION_AUTHORITY" | "CONTRACT_SIGNATORY"
export type ReadinessStatus = "not_ready" | "missing_evidence" | "settings_required" | "ready_for_contract" | "ready_for_service_start"

export type EvidenceDocumentRecord = {
  id: string
  organizationId: string
  documentType: string
  documentTitle: string
  documentStatus: "received" | "classified" | "verified" | "rejected" | "archived"
  sensitivity: "standard" | "sensitive" | "restricted"
  gcsBucket: string
  gcsObjectName: string
  gcsGeneration: string | null
  sha256: string
  mimeType: string
  byteSize: number
  issuedAt: string | null
  effectiveFrom: string | null
  expiresAt: string | null
  sourceChannel: string
  createdAt: string
}

export type EvidenceRequirementRecord = {
  id: string
  organizationId: string
  engagementId: string | null
  scopeId: string | null
  requirementCode: string
  requirementLabel: string
  requiredFor: string
  requiredDocumentType: string
  requirementStatus: EvidenceRequirementStatus
  satisfiedByEvidenceDocumentId: string | null
}

export type CustomerAuthorityAssignmentRecord = {
  id: string
  customerId: string
  organizationId: string
  personId: string
  authorityType: AuthorityType
  assignmentStatus: "active" | "superseded" | "voided"
  effectiveFrom: string
  effectiveTo: string | null
  noticeEvidenceDocumentId: string | null
}

export type CustomerContractRecord = {
  id: string
  customerId: string
  organizationId: string
  engagementId: string
  contractStatus: "draft" | "ready_for_signature" | "signed" | "superseded" | "archived"
  contractReference: string | null
  serviceDecisionAuthorityAssignmentId: string | null
  contractSignatoryAssignmentId: string | null
  lineItems: CustomerContractLineItemRecord[]
}

export type CustomerContractLineItemRecord = {
  id: string
  contractId: string
  scopeId: string
  lineStatus: "draft" | "ready" | "signed" | "removed"
  pricingBasis: "monthly_package" | "one_time_service" | "included_in_package" | "to_be_defined"
  packageCode: string | null
  responsibilityBoundary: "from_effective_responsibility_date_only" | "customer_retains_history" | "tes_assumes_defined_history_with_evidence"
}

export type OnboardingFoundationView = {
  evidenceDocuments: EvidenceDocumentRecord[]
  evidenceRequirements: EvidenceRequirementRecord[]
  customerAuthorityAssignments: CustomerAuthorityAssignmentRecord[]
  contracts: CustomerContractRecord[]
}

type EvidenceDocumentRow = {
  id: string
  organization_id: string
  document_type: string
  document_title: string
  document_status: EvidenceDocumentRecord["documentStatus"]
  sensitivity: EvidenceDocumentRecord["sensitivity"]
  gcs_bucket: string
  gcs_object_name: string
  gcs_generation: string | null
  sha256: string
  mime_type: string
  byte_size: string
  issued_at: string | null
  effective_from: string | null
  expires_at: string | null
  source_channel: string
  created_at: string
}

function toEvidenceDocument(row: EvidenceDocumentRow): EvidenceDocumentRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    documentType: row.document_type,
    documentTitle: row.document_title,
    documentStatus: row.document_status,
    sensitivity: row.sensitivity,
    gcsBucket: row.gcs_bucket,
    gcsObjectName: row.gcs_object_name,
    gcsGeneration: row.gcs_generation,
    sha256: row.sha256,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    issuedAt: row.issued_at,
    effectiveFrom: row.effective_from,
    expiresAt: row.expires_at,
    sourceChannel: row.source_channel,
    createdAt: row.created_at,
  }
}

type EvidenceRequirementRow = {
  id: string
  organization_id: string
  engagement_id: string | null
  scope_id: string | null
  requirement_code: string
  requirement_label: string
  required_for: string
  required_document_type: string
  requirement_status: EvidenceRequirementStatus
  satisfied_by_evidence_document_id: string | null
}

function toEvidenceRequirement(row: EvidenceRequirementRow): EvidenceRequirementRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    engagementId: row.engagement_id,
    scopeId: row.scope_id,
    requirementCode: row.requirement_code,
    requirementLabel: row.requirement_label,
    requiredFor: row.required_for,
    requiredDocumentType: row.required_document_type,
    requirementStatus: row.requirement_status,
    satisfiedByEvidenceDocumentId: row.satisfied_by_evidence_document_id,
  }
}

type AuthorityRow = {
  id: string
  customer_id: string
  organization_id: string
  person_id: string
  authority_type: AuthorityType
  assignment_status: CustomerAuthorityAssignmentRecord["assignmentStatus"]
  effective_from: string
  effective_to: string | null
  notice_evidence_document_id: string | null
}

function toAuthority(row: AuthorityRow): CustomerAuthorityAssignmentRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    organizationId: row.organization_id,
    personId: row.person_id,
    authorityType: row.authority_type,
    assignmentStatus: row.assignment_status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    noticeEvidenceDocumentId: row.notice_evidence_document_id,
  }
}

type ContractRow = {
  id: string
  customer_id: string
  organization_id: string
  engagement_id: string
  contract_status: CustomerContractRecord["contractStatus"]
  contract_reference: string | null
  service_decision_authority_assignment_id: string | null
  contract_signatory_assignment_id: string | null
}

type LineRow = {
  id: string
  contract_id: string
  scope_id: string
  line_status: CustomerContractLineItemRecord["lineStatus"]
  pricing_basis: CustomerContractLineItemRecord["pricingBasis"]
  package_code: string | null
  responsibility_boundary: CustomerContractLineItemRecord["responsibilityBoundary"]
}

function toLine(row: LineRow): CustomerContractLineItemRecord {
  return {
    id: row.id,
    contractId: row.contract_id,
    scopeId: row.scope_id,
    lineStatus: row.line_status,
    pricingBasis: row.pricing_basis,
    packageCode: row.package_code,
    responsibilityBoundary: row.responsibility_boundary,
  }
}

async function readEvidenceFoundation(client: Queryable, organizationId: string): Promise<Pick<OnboardingFoundationView, "evidenceDocuments" | "evidenceRequirements">> {
  const [documents, requirements] = await Promise.all([
    client.query<EvidenceDocumentRow>(
      `SELECT id, organization_id, document_type, document_title, document_status, sensitivity, gcs_bucket, gcs_object_name,
              gcs_generation, sha256, mime_type, byte_size::text AS byte_size, issued_at::text AS issued_at,
              effective_from::text AS effective_from, expires_at::text AS expires_at, source_channel,
              ${MICRO_ISO("created_at")} AS created_at
         FROM public.evidence_documents
        WHERE organization_id = $1
        ORDER BY created_at DESC, id`,
      [organizationId],
    ),
    client.query<EvidenceRequirementRow>(
      `SELECT id, organization_id, engagement_id, scope_id, requirement_code, requirement_label, required_for,
              required_document_type, requirement_status, satisfied_by_evidence_document_id
         FROM public.onboarding_evidence_requirements
        WHERE organization_id = $1
        ORDER BY required_for, requirement_code, id`,
      [organizationId],
    ),
  ])

  return {
    evidenceDocuments: documents.rows.map(toEvidenceDocument),
    evidenceRequirements: requirements.rows.map(toEvidenceRequirement),
  }
}

async function readContractFoundation(client: Queryable, organizationId: string): Promise<Pick<OnboardingFoundationView, "customerAuthorityAssignments" | "contracts">> {
  const [authorities, contracts, lines] = await Promise.all([
    client.query<AuthorityRow>(
      `SELECT id, customer_id, organization_id, person_id, authority_type, assignment_status,
              ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO_NULL("effective_to")} AS effective_to,
              notice_evidence_document_id
         FROM public.customer_authority_assignments
        WHERE organization_id = $1
        ORDER BY authority_type, effective_from DESC, id`,
      [organizationId],
    ),
    client.query<ContractRow>(
      `SELECT id, customer_id, organization_id, engagement_id, contract_status, contract_reference,
              service_decision_authority_assignment_id, contract_signatory_assignment_id
         FROM public.customer_contracts
        WHERE organization_id = $1
        ORDER BY created_at DESC, id`,
      [organizationId],
    ),
    client.query<LineRow>(
      `SELECT l.id, l.contract_id, l.scope_id, l.line_status, l.pricing_basis, l.package_code, l.responsibility_boundary
         FROM public.customer_contract_line_items l
         JOIN public.customer_contracts c ON c.id = l.contract_id
        WHERE c.organization_id = $1
        ORDER BY l.created_at, l.id`,
      [organizationId],
    ),
  ])

  return {
    customerAuthorityAssignments: authorities.rows.map(toAuthority),
    contracts: contracts.rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      organizationId: row.organization_id,
      engagementId: row.engagement_id,
      contractStatus: row.contract_status,
      contractReference: row.contract_reference,
      serviceDecisionAuthorityAssignmentId: row.service_decision_authority_assignment_id,
      contractSignatoryAssignmentId: row.contract_signatory_assignment_id,
      lineItems: lines.rows.filter((line) => line.contract_id === row.id).map(toLine),
    })),
  }
}

export async function getOnboardingFoundation(organizationId: string): Promise<OnboardingFoundationView> {
  const [evidence, contracts] = await Promise.all([
    withAuthorizedSystem("EVIDENCE_READ", (client) => readEvidenceFoundation(client, organizationId)),
    withAuthorizedSystem("CONTRACT_READ", (client) => readContractFoundation(client, organizationId)),
  ])
  return { ...evidence, ...contracts }
}

export async function snapshotReadiness(input: {
  organizationId: string
  engagementId: string | null
  readinessStatus: ReadinessStatus
  completedCount: number
  totalCount: number
  blockers: string[]
}): Promise<void> {
  return withAuthorizedSystem("EVIDENCE_MANAGE", async (client, decision: SystemAuthorizationDecision) => {
    await client.query(
      `INSERT INTO public.onboarding_readiness_snapshots
        (organization_id, engagement_id, readiness_status, completed_count, total_count, blockers, computed_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [input.organizationId, input.engagementId, input.readinessStatus, input.completedCount, input.totalCount, JSON.stringify(input.blockers), decision.actor.id],
    )
  })
}

export async function upsertEvidenceRequirement(input: {
  organizationId: string
  engagementId?: string | null
  scopeId?: string | null
  requirementCode: string
  requirementLabel: string
  requiredFor: "organization" | "service_scope" | "responsibility" | "settings" | "authority_roles" | "contract"
  requiredDocumentType: string
  requirementStatus?: EvidenceRequirementStatus
  satisfiedByEvidenceDocumentId?: string | null
}): Promise<EvidenceRequirementRecord> {
  return withAuthorizedSystem("EVIDENCE_MANAGE", async (client) => {
    const result = await client.query<EvidenceRequirementRow>(
      `INSERT INTO public.onboarding_evidence_requirements
        (organization_id, engagement_id, scope_id, requirement_code, requirement_label, required_for, required_document_type, requirement_status, satisfied_by_evidence_document_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, COALESCE(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), requirement_code)
       DO UPDATE SET
         requirement_label = EXCLUDED.requirement_label,
         required_for = EXCLUDED.required_for,
         required_document_type = EXCLUDED.required_document_type,
         requirement_status = EXCLUDED.requirement_status,
         satisfied_by_evidence_document_id = EXCLUDED.satisfied_by_evidence_document_id,
         updated_at = clock_timestamp()
       RETURNING id, organization_id, engagement_id, scope_id, requirement_code, requirement_label, required_for,
                 required_document_type, requirement_status, satisfied_by_evidence_document_id`,
      [
        input.organizationId,
        input.engagementId ?? null,
        input.scopeId ?? null,
        input.requirementCode,
        input.requirementLabel,
        input.requiredFor,
        input.requiredDocumentType,
        input.requirementStatus ?? "missing",
        input.satisfiedByEvidenceDocumentId ?? null,
      ],
    )
    return toEvidenceRequirement(result.rows[0])
  })
}
