import "server-only"

import { hasAdditionalSystemCapability, withAuthorizedSystem } from "@/lib/auth/tes-system-context"
import { TesAuthorizationDeniedError } from "@/lib/auth/tes-authorization"
import * as corporateOperations from "@/lib/corporate-identity/operations"
import * as customerOperations from "@/lib/customer-relationship/operations"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import {
  addAlias,
  addIdentifier,
  correctIdentifier,
  deactivateAlias,
  getOrganization,
  supersedeIdentifier,
  updateLegalIdentity,
} from "@/lib/corporate-identity/service"
import type { CorporateIdentifierInput } from "@/lib/corporate-identity/identifier-definitions"
import type { ClassificationInput, CreateOrganizationInput, OrganizationRecord } from "@/lib/corporate-identity/types"

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

export type CompanyProfileRecord = {
  id: string
  name: string
  kind: string
  region: string
  status: "Active" | "Archived" | "Merged"
  createdAt: string
  dba: string | null
  contact: string | null
  phone: string | null
  website: string | null
  email: string | null
  billingEmail: string | null
  opRegion: "Canada Only" | "US Only" | "Cross-Border"
  incorpNo: string | null
  businessNo: string | null
  gstHst: string | null
  regCorpState: string | null
  usdot: string | null
  mc: string | null
  nsc: string | null
  mvid: string | null
  scac: string | null
  carrierCode: string | null
}

export type CreateCompanyDirectoryInput = {
  companyName?: unknown
  dba?: unknown
  companyType?: unknown
  opRegion?: unknown
  regCorpState?: unknown
  regCorpCountry?: unknown
  incorpNo?: unknown
  businessNo?: unknown
  ein?: unknown
  startDate?: unknown
  status?: unknown
}

export type UpdateCompanyDirectoryInput = {
  companyName?: unknown
  dba?: unknown
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
}

const CLASSIFICATION_BY_COMPANY_TYPE: Record<string, string | null> = {
  Customer: null,
  Prospect: "other",
  "Owner Operator": "owner_operator",
  "Service Provider": "service_provider",
  "Finance/ Leasing Company": "finance_leasing_company",
  "Insurance Broker": "insurance_broker",
  "Insurance Company": "insurance_company",
  "Workers Insurance": "workers_insurance",
  "Employee Reference": "employee_reference",
  "Government Agency": "government_agency",
  "Sub Contractor": "sub_contractor",
  Other: "other",
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function countryCode(value: unknown): "CA" | "US" | null {
  const raw = text(value).toUpperCase()
  if (raw === "CA" || raw === "CANADA") return "CA"
  if (raw === "US" || raw === "USA" || raw === "UNITED STATES") return "US"
  return null
}

function dateToInstant(value: unknown): string {
  const date = text(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00.000Z`
  return new Date().toISOString()
}

function buildCreateOrganizationInput(input: CreateCompanyDirectoryInput): CreateOrganizationInput {
  const legalName = text(input.companyName)
  if (!legalName) throw new Error("Company Name is required.")

  const type = text(input.companyType)
  if (!type) throw new Error("Company Record Type is required.")

  const country = countryCode(input.regCorpCountry)
  const regionCode = text(input.regCorpState)
  const formation = country === null ? null : { country, region: regionCode || null }
  const identifiers: CorporateIdentifierInput[] = []
  const incorporation = text(input.incorpNo)
  const businessNumber = text(input.businessNo)
  const ein = text(input.ein)

  if (incorporation && formation) {
    identifiers.push({ kind: "INCORPORATION", value: incorporation, country: formation.country, region: formation.region })
  }
  if (businessNumber && country !== "US") identifiers.push({ kind: "CRA_BN", value: businessNumber })
  if (ein) identifiers.push({ kind: "IRS_EIN", value: ein })

  const aliases = text(input.dba) ? [{ alias: text(input.dba), aliasType: "TRADE_NAME" as const }] : []
  const classificationCode = CLASSIFICATION_BY_COMPANY_TYPE[type]
  const classifications: ClassificationInput[] = classificationCode ? [{ code: classificationCode, isPrimary: true }] : []

  return {
    legalName,
    displayName: legalName,
    formation,
    identifiers,
    aliases,
    classifications,
  }
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

export async function createCompanyDirectoryRecord(input: CreateCompanyDirectoryInput): Promise<CreateCompanyDirectoryResult> {
  const type = text(input.companyType)
  const isCustomer = type === "Customer"
  const organizationInput = buildCreateOrganizationInput(input)

  // Both mutations and their Master Register events commit or roll back together.
  // Check both capabilities before writing the Organization.
  return withAuthorizedSystem("ORGANIZATION_CREATE", async (client, decision) => {
    if (isCustomer && !(await hasAdditionalSystemCapability(client, decision, "CUSTOMER_ESTABLISH"))) {
      throw new TesAuthorizationDeniedError()
    }

    const masterRegister = new PostgresMasterRegisterRepository(client)
    const actor = { id: decision.actor.id, actorType: decision.actor.actorType }
    const result = await corporateOperations.createOrganization({
      client,
      actor,
      masterRegister,
      canViewRegistry: () => hasAdditionalSystemCapability(client, decision, "ORGANIZATION_REGISTRY_READ"),
    }, organizationInput)
    const organization = result.organization

    if (isCustomer) {
      // Re-prove CUSTOMER_ESTABLISH for RLS on the same transaction.
      await client.query(
        "SELECT set_config('tes.system_capability', $1, true)",
        ["CUSTOMER_ESTABLISH"],
      )
      const rls = await client.query<{ allowed: boolean }>(
        "SELECT tes_security.system_context_authorized(ARRAY[$1]::text[]) AS allowed",
        ["CUSTOMER_ESTABLISH"],
      )
      if (rls.rows[0]?.allowed !== true) throw new TesAuthorizationDeniedError()

      await customerOperations.establishCustomerRelationship({ client, actor, masterRegister }, {
        organizationId: organization.id,
        engagementType: "RECURRING",
        stage: "ONBOARDING",
        // Open-ended stages omit plannedEndAt; null fails instant validation.
        startedAt: dateToInstant(input.startDate),
      })
    }

    return {
      company: {
        id: organization.id,
        name: organization.displayName ?? organization.legalName,
        kind: primaryKind(organization.classifications.find((classification) => classification.isPrimary)?.code ?? null, isCustomer),
        region: region(organization.formationCountry, organization.formationRegion),
        status: statusLabel(organization.status),
        tone: statusTone(organization.status),
      },
    }
  })
}

export async function getCompanyProfile(organizationId: string): Promise<CompanyProfileRecord | null> {
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", async (client) => {
    const result = await client.query<
      CompanyDirectoryRow & {
        created_at: Date
        is_customer: boolean
      }
    >(
      `SELECT o.id,
              o.legal_name,
              o.display_name,
              o.status,
              o.country_code,
              o.region_code,
              o.created_at,
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
      [organizationId],
    )
    const row = result.rows[0]
    if (!row) return null

    const identifiers = await client.query<{
      kind: string | null
      identifier_type: string
      namespace: string
      value: string
      status: string
    }>(
      `SELECT identifier_type AS kind, identifier_type, namespace, value, status
         FROM public.organization_identifiers
        WHERE organization_id = $1
        ORDER BY created_at, id`,
      [organizationId],
    )
    const ids = identifiers.rows.map((identifier) => ({
      kind: identifier.kind,
      identifierType: identifier.identifier_type,
      namespace: identifier.namespace,
      value: identifier.value,
      status: identifier.status,
    }))

    const aliases = await client.query<{ alias: string }>(
      `SELECT alias
         FROM public.organization_aliases
        WHERE organization_id = $1
          AND upper(alias_type) = 'TRADE_NAME'
          AND status = 'active'
        ORDER BY created_at, id
        LIMIT 1`,
      [organizationId],
    )

    return {
      id: row.id,
      name: row.display_name ?? row.legal_name,
      kind: primaryKind(row.primary_classification, row.is_customer),
      region: region(row.country_code, row.region_code),
      status: statusLabel(row.status),
      createdAt: row.created_at.toISOString(),
      dba: aliases.rows[0]?.alias ?? null,
      contact: null,
      phone: null,
      website: null,
      email: null,
      billingEmail: null,
      opRegion: row.country_code === "US" ? "US Only" : "Canada Only",
      incorpNo: identifierValue(ids, ["INCORPORATION", "CORPORATE_REGISTRATION"]),
      businessNo: identifierValue(ids, ["BUSINESS_NUMBER", "EIN", "TAX_ID"]),
      gstHst: identifierValue(ids, ["GST_HST", "SALES_TAX"]),
      regCorpState: row.region_code,
      usdot: identifierValue(ids, ["USDOT"]),
      mc: identifierValue(ids, ["MC"]),
      nsc: identifierValue(ids, ["NSC", "CVOR"]),
      mvid: identifierValue(ids, ["MVID", "RIN"]),
      scac: identifierValue(ids, ["SCAC"]),
      carrierCode: identifierValue(ids, ["CARRIER_CODE"]),
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
 * Edits only the canonical corporate-identity fields: legal name, trade-name alias and the INCORPORATION / CRA_BN / IRS_EIN
 * identifiers. A field that is omitted is left alone; an empty string ends the current value. Every step is an existing
 * corporate-identity operation (its own authorized transaction and Master Register event).
 */
export async function updateCompanyDirectoryRecord(
  organizationId: string,
  input: UpdateCompanyDirectoryInput,
): Promise<CompanyEditRecord> {
  let organization = await getOrganization(organizationId)
  const current = toEditRecord(organization)
  const has = (value: unknown) => typeof value === "string"

  if (has(input.companyName)) {
    const legalName = text(input.companyName)
    if (!legalName) throw new CompanyDirectoryValidationError("Company Name is required.")
    if (legalName !== organization.legalName) {
      const keepDisplay = organization.displayName === organization.legalName
      organization = (await updateLegalIdentity(organizationId, keepDisplay ? { legalName, displayName: legalName } : { legalName })).organization
    }
  }

  if (has(input.dba)) {
    const dba = text(input.dba)
    if (dba !== current.dba) {
      const existing = organization.aliases.find((alias) => alias.status === "active" && alias.aliasType?.toUpperCase() === "TRADE_NAME")
      if (existing) organization = (await deactivateAlias(organizationId, existing.id)).organization
      if (dba) organization = (await addAlias(organizationId, { alias: dba, aliasType: "TRADE_NAME" })).organization
    }
  }

  const applyIdentifier = async (
    kind: "INCORPORATION" | "CRA_BN" | "IRS_EIN",
    raw: unknown,
    previous: string,
  ) => {
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
    if (existing && replacement) organization = (await correctIdentifier(organizationId, existing.id, replacement)).organization
    else if (existing) organization = (await supersedeIdentifier(organizationId, existing.id)).organization
    else if (replacement) organization = (await addIdentifier(organizationId, replacement)).organization
  }

  await applyIdentifier("INCORPORATION", input.incorpNo, current.incorpNo)
  await applyIdentifier("CRA_BN", input.businessNo, current.businessNo)
  await applyIdentifier("IRS_EIN", input.ein, current.ein)

  return toEditRecord(organization)
}
