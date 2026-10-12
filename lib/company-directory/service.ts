import "server-only"

import { withAuthorizedSystem } from "@/lib/auth/tes-system-context"

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

    return {
      id: row.id,
      name: row.display_name ?? row.legal_name,
      kind: primaryKind(row.primary_classification, row.is_customer),
      region: region(row.country_code, row.region_code),
      status: statusLabel(row.status),
      createdAt: row.created_at.toISOString(),
      dba: null,
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
