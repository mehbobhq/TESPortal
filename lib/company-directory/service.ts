import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { domainContext, enterSystemCapability, runDeferredChecks } from "@/lib/company-directory/capability-context"
import * as corporateOperations from "@/lib/corporate-identity/operations"
import { createCompanyRecord, type CompanyCreationResult } from "@/lib/company-directory/create-company"
import { applyCompanyDetails, factsPresent, hasDetailsToUpdate, planCompanyDetails, writeLedger, type CompanyDetailsUpdate } from "@/lib/company-directory/update-company"
import type { PlannedChange } from "@/lib/company-changes/ledger"
import { readCompanyProfile, type CompanyProfileRecord } from "@/lib/company-directory/read-profile"
import { getOrganization } from "@/lib/corporate-identity/service"
import { CorporateIdentifierCollisionError, CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import { CompanyCreationValidationError } from "@/lib/company-directory/creation-input"
import type { CorporateIdentifierInput } from "@/lib/corporate-identity/identifier-definitions"
import type { OrganizationRecord } from "@/lib/corporate-identity/types"

type CompanyDirectoryRow = {
  id: string
  legal_name: string
  display_name: string | null
  status: "active" | "archived" | "merged"
  country_code: string | null
  region_code: string | null
  primary_classification: string | null
}

type CustomerDirectoryRow = {
  customer_id: string
  organization_id: string
  legal_name: string
  display_name: string | null
  organization_status: "active" | "archived" | "merged"
  country_code: string | null
  region_code: string | null
  open_engagement_id: string | null
}

export type CompanyDirectoryRecord = {
  id: string
  name: string
  kind: string
  region: string
  status: "Active" | "Archived" | "Merged"
  tone: "ok" | "warn" | "danger" | "info" | "neutral"
}

export type CustomerDirectoryRecord = {
  id: string
  organizationId: string
  name: string
  region: string
  status: "Active" | "Inactive" | "Archived" | "Merged"
  tone: "ok" | "warn" | "danger" | "info" | "neutral"
}

export type { CompanyProfileRecord }

export type UpdateCompanyDirectoryInput = {
  companyName?: unknown
  dba?: unknown
  /** How a trade-name change was confirmed: BUSINESS_CONFIRMATION or REGISTRATION_EVIDENCE, with a reference (and optionally the evidence document). */
  dbaBasis?: unknown
  dbaBasisReference?: unknown
  dbaEvidenceDocumentId?: unknown
  incorpNo?: unknown
  businessNo?: unknown
  ein?: unknown
}

export type CompanyEditRecord = {
  id: string
  companyName: string
  dba: string
  incorpNo: string
  businessNo: string
  ein: string
  formationCountry: string | null
  formationRegion: string | null
}

export class CompanyDirectoryValidationError extends Error {}

export type CreateCompanyDirectoryResult = {
  company: CompanyDirectoryRecord
  /** What was actually written to each canonical domain, for the confirmation shown to the user. */
  recorded: CompanyCreationResult["recorded"]
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

const statusLabel = (status: "active" | "archived" | "merged") =>
  status === "active" ? "Active" : status === "archived" ? "Archived" : "Merged"

const statusTone = (status: "active" | "archived" | "merged") =>
  status === "active" ? "ok" : status === "archived" ? "neutral" : "warn"

const region = (country: string | null, regionCode: string | null) =>
  [regionCode, country].filter(Boolean).join(", ") || "Not recorded"

const primaryKind = (classification: string | null, isCustomer: boolean) =>
  isCustomer ? "Customer" : classification ?? "Organization"

function identifierValue(
  identifiers: Array<{ kind: string | null; identifierType: string; namespace: string; value: string; status: string }>,
  candidates: string[],
): string | null {
  const normalized = new Set(candidates.map((candidate) => candidate.toUpperCase()))
  const found = identifiers.find((identifier) => {
    if (identifier.status !== "active") return false
    return (
      (identifier.kind !== null && normalized.has(identifier.kind.toUpperCase())) ||
      normalized.has(identifier.identifierType.toUpperCase()) ||
      normalized.has(identifier.namespace.toUpperCase())
    )
  })
  return found?.value ?? null
}

export async function listCompanyDirectory(): Promise<CompanyDirectoryRecord[]> {
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", async (client) => {
    const result = await client.query<CompanyDirectoryRow>(
      `SELECT o.id,
              o.legal_name,
              o.display_name,
              o.status,
              o.country_code,
              o.region_code,
              pc.classification_code AS primary_classification
         FROM public.organizations o
         LEFT JOIN LATERAL (
           SELECT classification_code
             FROM public.organization_classifications
            WHERE organization_id = o.id
              AND is_primary = true
              AND effective_to IS NULL
            ORDER BY effective_from DESC, id DESC
            LIMIT 1
         ) pc ON true
        ORDER BY lower(coalesce(o.display_name, o.legal_name)), o.id`,
    )

    return result.rows.map((row) => ({
      id: row.id,
      name: row.display_name ?? row.legal_name,
      kind: row.primary_classification ?? "Organization",
      region: region(row.country_code, row.region_code),
      status: statusLabel(row.status),
      tone: statusTone(row.status),
    }))
  })
}

export async function listCustomerDirectory(): Promise<CustomerDirectoryRecord[]> {
  return withAuthorizedSystem("CUSTOMER_RELATIONSHIP_READ", async (client) => {
    const result = await client.query<CustomerDirectoryRow>(
      `SELECT c.id AS customer_id,
              o.id AS organization_id,
              o.legal_name,
              o.display_name,
              o.status AS organization_status,
              o.country_code,
              o.region_code,
              e.id AS open_engagement_id
         FROM public.customers c
         JOIN public.organizations o ON o.id = c.organization_id
         LEFT JOIN public.customer_engagements e
           ON e.customer_id = c.id
          AND e.ended_at IS NULL
        ORDER BY lower(coalesce(o.display_name, o.legal_name)), c.id`,
    )

    return result.rows.map((row) => {
      const active = row.organization_status === "active" && row.open_engagement_id !== null
      return {
        id: row.customer_id,
        organizationId: row.organization_id,
        name: row.display_name ?? row.legal_name,
        region: region(row.country_code, row.region_code),
        status: active ? "Active" : statusLabel(row.organization_status) === "Active" ? "Inactive" : statusLabel(row.organization_status),
        tone: active ? "ok" : statusTone(row.organization_status),
      }
    })
  })
}

/**
 * Creates a company with every supported field persisted to its canonical domain in one transaction (see
 * create-company.ts and creation-input.ts for the field contract). Unsupported or invalid input is refused with explicit issues.
 */
export async function createCompanyDirectoryRecord(input: unknown): Promise<CreateCompanyDirectoryResult> {
  const result = await createCompanyRecord(input)
  const isCustomer = result.recorded.customer
  return {
    company: {
      id: result.organizationId,
      name: result.displayName,
      kind: isCustomer ? "Customer" : result.primaryClassification ?? "Organization",
      region: region(result.formationCountry, result.formationRegion),
      status: statusLabel(result.status),
      tone: statusTone(result.status),
    },
    recorded: result.recorded,
  }
}

/** The full profile, assembled from the canonical domains (see read-profile.ts). */
export async function getCompanyProfile(organizationId: string): Promise<CompanyProfileRecord | null> {
  return readCompanyProfile(organizationId)
}

/** Light identity summary used where only the name, kind, status and formation region are needed (e.g. onboarding). */
export async function getCompanyIdentitySummary(organizationId: string): Promise<{ id: string; name: string; kind: string; region: string; status: "Active" | "Archived" | "Merged" } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) return null
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", async (client) => {
    const result = await client.query<CompanyDirectoryRow & { is_customer: boolean }>(
      `SELECT o.id,
              o.legal_name,
              o.display_name,
              o.status,
              o.country_code,
              o.region_code,
              EXISTS (SELECT 1 FROM public.customers c WHERE c.organization_id = o.id) AS is_customer,
              pc.classification_code AS primary_classification
         FROM public.organizations o
         LEFT JOIN LATERAL (
           SELECT classification_code
             FROM public.organization_classifications
            WHERE organization_id = o.id
              AND is_primary = true
              AND effective_to IS NULL
            ORDER BY effective_from DESC, id DESC
            LIMIT 1
         ) pc ON true
        WHERE o.id = $1`,
      [organizationId.toLowerCase()],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id,
      name: row.display_name ?? row.legal_name,
      kind: primaryKind(row.primary_classification, row.is_customer),
      region: region(row.country_code, row.region_code),
      status: statusLabel(row.status),
    }
  })
}

function toEditRecord(organization: OrganizationRecord): CompanyEditRecord {
  const active = organization.identifiers.filter((identifier) => identifier.status === "active")
  const valueOf = (kind: string) => active.find((identifier) => identifier.kind === kind)?.value ?? ""
  const trade = organization.aliases.find((alias) => alias.status === "active" && alias.aliasType?.toUpperCase() === "TRADE_NAME")
  return {
    id: organization.id,
    companyName: organization.legalName,
    dba: trade?.alias ?? "",
    incorpNo: valueOf("INCORPORATION"),
    businessNo: valueOf("CRA_BN"),
    ein: valueOf("IRS_EIN"),
    formationCountry: organization.formationCountry,
    formationRegion: organization.formationRegion,
  }
}

export async function getCompanyEditRecord(organizationId: string): Promise<CompanyEditRecord> {
  return toEditRecord(await getOrganization(organizationId))
}

/**
 * The identity part of an edit on a transaction the caller opened (ORGANIZATION_UPDATE): legal name, trade-name alias and the
 * INCORPORATION / CRA_BN / IRS_EIN identifiers. A field that is omitted is left alone; an empty string ends the current value.
 * Every step is an existing corporate-identity operation (with its own Master Register event); none commits on its own here.
 */
async function applyIdentityEdit(
  client: PoolClient,
  decision: SystemAuthorizationDecision,
  organizationId: string,
  input: UpdateCompanyDirectoryInput,
  changes: PlannedChange[] = [],
): Promise<OrganizationRecord> {
  const ctx = domainContext(client, decision, "ORGANIZATION_REGISTRY_READ")
  // The same two capabilities the separate operations needed: the registry read to see the record, the update to change it.
  const read = async () => {
    await enterSystemCapability(client, "ORGANIZATION_REGISTRY_READ")
    return corporateOperations.readOrganization(client, organizationId)
  }
  const write = async <T>(work: () => Promise<T>): Promise<T> => {
    await enterSystemCapability(client, "ORGANIZATION_UPDATE")
    const result = await work()
    await runDeferredChecks(client)
    return result
  }
  let organization = await read()
  const current = toEditRecord(organization)
  const has = (value: unknown) => typeof value === "string"

  if (has(input.companyName)) {
    const legalName = text(input.companyName)
    if (!legalName) throw new CompanyDirectoryValidationError("Company Name is required.")
    // THE REGISTERED LEGAL NAME IS NOT EDITABLE HERE. A different name is refused on the server, whatever the caller or UI: it changes only
    // through the legal-name procedure (lib/company-changes): a government document, a written request from a customer-authority holder or an
    // evidenced Director, and an authorized TES user. An unchanged name is accepted as a no-op.
    if (legalName !== organization.legalName) {
      throw new CompanyDirectoryValidationError(
        "The registered legal name can only be changed through the legal-name change procedure: it needs a government-issued document, a written request from a company representative with recorded authority (a Service Decision Authority / Contract Signatory, or a Director with a verified document), and execution by an authorized Onboarding Team member or the founder-level account. Nothing was saved.",
      )
    }
  }

  if (has(input.dba)) {
    const dba = text(input.dba)
    if (dba !== current.dba) {
      const existing = organization.aliases.find((alias) => alias.status === "active" && alias.aliasType?.toUpperCase() === "TRADE_NAME")
      // A trade-name change may carry its business basis: a confirmation reference, or the registration evidence (a document of this company).
      const basisKind = typeof input.dbaBasis === "string" && input.dbaBasis !== "" ? input.dbaBasis : null
      if (basisKind !== null && basisKind !== "BUSINESS_CONFIRMATION" && basisKind !== "REGISTRATION_EVIDENCE") throw new CompanyDirectoryValidationError("The basis of a trade-name change must be BUSINESS_CONFIRMATION or REGISTRATION_EVIDENCE.")
      const basisReference = typeof input.dbaBasisReference === "string" ? input.dbaBasisReference.trim() : ""
      if (basisKind !== null && basisReference.length < 3) throw new CompanyDirectoryValidationError("Say how the trade-name change was confirmed (a reference of at least 3 characters).")
      const evidenceId = typeof input.dbaEvidenceDocumentId === "string" && input.dbaEvidenceDocumentId !== "" ? input.dbaEvidenceDocumentId : null
      if (existing) organization = (await write(() => corporateOperations.deactivateAlias(ctx, organizationId, existing.id))).organization
      if (dba) organization = (await write(() => corporateOperations.addAlias(ctx, organizationId, { alias: dba, aliasType: "TRADE_NAME" }))).organization
      changes.push({
        operation: !dba ? "DBA_REMOVED" : existing ? "DBA_UPDATED" : "DBA_ADDED",
        summary: !dba ? "Trade name (DBA) removed (kept in history)" : existing ? "Trade name (DBA) updated (previous name kept in history)" : "Trade name (DBA) added",
        previous: current.dba || null, next: dba || null,
        ...(basisKind ? { basis: { kind: basisKind as "BUSINESS_CONFIRMATION" | "REGISTRATION_EVIDENCE", reference: basisReference } } : {}),
        ...(evidenceId ? { evidence: [{ documentId: evidenceId, role: "REGISTRATION" as const }] } : {}),
      })
    }
  }

  const applyIdentifier = async (kind: "INCORPORATION" | "CRA_BN" | "IRS_EIN", raw: unknown, previous: string) => {
    if (!has(raw)) return
    const value = text(raw)
    if (value === previous) return
    const existing = organization.identifiers.find((identifier) => identifier.status === "active" && identifier.kind === kind)
    let replacement: CorporateIdentifierInput | null = null
    if (value) {
      if (kind === "INCORPORATION") {
        if (!organization.formationCountry) {
          throw new CompanyDirectoryValidationError("Incorporation number needs a recorded formation jurisdiction.")
        }
        replacement = { kind, value, country: organization.formationCountry, region: organization.formationRegion }
      } else {
        replacement = { kind, value }
      }
    }
    // A rejected identifier is reported against ITS form field (nothing is saved: the whole edit is one transaction), not as an anonymous failure.
    const formField = kind === "INCORPORATION" ? "incorpNo" : kind === "CRA_BN" ? "businessNo" : "ein"
    const label = kind === "INCORPORATION" ? "incorporation number" : kind === "CRA_BN" ? "Business Number" : "EIN"
    try {
      if (existing && replacement) organization = (await write(() => corporateOperations.correctIdentifier(ctx, organizationId, existing.id, replacement))).organization
      else if (existing) organization = (await write(() => corporateOperations.supersedeIdentifier(ctx, organizationId, existing.id))).organization
      else if (replacement) organization = (await write(() => corporateOperations.addIdentifier(ctx, organizationId, replacement))).organization
    } catch (error) {
      if (error instanceof CorporateIdentityValidationError) throw new CompanyCreationValidationError([{ field: formField, message: error.message }])
      if (error instanceof CorporateIdentifierCollisionError) throw new CompanyCreationValidationError([{ field: formField, message: `This ${label} is already registered to another company record, so it was not saved.` }])
      throw error
    }
    changes.push({
      operation: "BUSINESS_DETAILS_UPDATED",
      summary: `${kind === "INCORPORATION" ? "Incorporation number" : kind === "CRA_BN" ? "Business Number" : "EIN"} ${existing && replacement ? "updated (previous value kept in history)" : existing ? "removed (kept in history)" : "recorded"}`,
      previous: previous || null, next: value || null,
    })
  }

  await applyIdentifier("INCORPORATION", input.incorpNo, current.incorpNo)
  await applyIdentifier("CRA_BN", input.businessNo, current.businessNo)
  await applyIdentifier("IRS_EIN", input.ein, current.ein)

  return organization
}

/** Edits only the canonical corporate-identity fields, as one transaction (see applyIdentityEdit). */
export async function updateCompanyDirectoryRecord(
  organizationId: string,
  input: UpdateCompanyDirectoryInput,
): Promise<CompanyEditRecord> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", async (client, decision) => {
    const changes: PlannedChange[] = []
    const record = toEditRecord(await applyIdentityEdit(client, decision, organizationId, input, changes))
    await writeLedger(client, decision, organizationId, changes)
    return record
  })
}

const IDENTITY_KEYS = ["companyName", "dba", "dbaBasis", "dbaBasisReference", "dbaEvidenceDocumentId", "incorpNo", "businessNo", "ein"] as const

export type CompanyEditResult = { company: CompanyEditRecord; details: CompanyDetailsUpdate | null }

/**
 * The whole edit: identity (corporate-identity operations) and details (operating region, addresses, website, cargo, fleet
 * providers and billing preference) in ONE transaction. Both parts are validated BEFORE anything is written, and every write
 * commits or rolls back together with its Master Register events, so a failure in any part - a refused capability, an identifier
 * collision, a concurrent change - leaves the record exactly as it was. `details` says what the details part saved.
 */
export async function editCompany(organizationId: string, raw: unknown): Promise<CompanyEditResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CompanyDirectoryValidationError("A JSON object is required.")
  const body = raw as Record<string, unknown>
  const detailsPlan = planCompanyDetails(body) // always: also refuses any field that cannot be edited, so nothing is silently discarded
  const wantsDetails = hasDetailsToUpdate(body) || factsPresent(detailsPlan.facts)
  const identity: UpdateCompanyDirectoryInput = {}
  for (const key of IDENTITY_KEYS) if (key in body) identity[key] = body[key]
  return withAuthorizedSystem("ORGANIZATION_UPDATE", async (client, decision) => {
    const changes: PlannedChange[] = []
    const company = toEditRecord(await applyIdentityEdit(client, decision, organizationId, identity, changes))
    const details = wantsDetails ? await applyCompanyDetails(client, decision, organizationId, detailsPlan, changes) : null
    // Every actual change is recorded automatically (actor, time, previous and new value) on the same transaction; nobody chooses whether to keep history.
    await writeLedger(client, decision, organizationId, changes)
    return { company, details }
  })
}
