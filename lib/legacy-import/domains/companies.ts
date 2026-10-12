import { prepareLegacySourceRecord } from "../source"
import type { LegacyImportStageRecordsInput, PreparedLegacySourceRecord } from "../types"

const COMPANY_SUPPORTED_FIELDS = [
  "id",
  "companyId",
  "name",
  "companyName",
  "legalName",
  "displayName",
  "status",
  "type",
  "companyType",
  "country",
  "countryCode",
  "region",
  "regionCode",
  "province",
  "state",
  "createdAt",
  "updatedAt",
  "_legacyImport",
] as const

const CUSTOMER_TYPES = new Set(["customer", "prospect"])

export type LegacyBrowserCompanyRecord = Record<string, unknown>

export type LegacyCompanyCustomerStageInput = {
  importBatchId: string
  sourceSystem: string
  sourceNamespace: string
  companies: LegacyBrowserCompanyRecord[]
}

export type LegacyCompanyCustomerStagePlan = LegacyImportStageRecordsInput & {
  companyCount: number
  customerCount: number
  skippedCount: number
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function legacyId(record: LegacyBrowserCompanyRecord, index: number): string {
  return cleanString(record.id) ?? cleanString(record.companyId) ?? `browser-company-index-${index}`
}

function companyName(record: LegacyBrowserCompanyRecord): string | undefined {
  return cleanString(record.legalName) ?? cleanString(record.companyName) ?? cleanString(record.name) ?? cleanString(record.displayName)
}

function companyType(record: LegacyBrowserCompanyRecord): string | undefined {
  return cleanString(record.companyType) ?? cleanString(record.type)
}

function isCustomerLike(record: LegacyBrowserCompanyRecord): boolean {
  const type = companyType(record)?.toLowerCase()
  return type ? CUSTOMER_TYPES.has(type) : false
}

function sourceSnapshot(record: LegacyBrowserCompanyRecord): Record<string, unknown> {
  return {
    ...record,
    _legacyImport: {
      canonicalIntent: {
        organization: true,
        customer: isCustomerLike(record),
        legalName: companyName(record) ?? null,
      },
    },
  }
}

export function buildCompanyCustomerStagePlan(input: LegacyCompanyCustomerStageInput): LegacyCompanyCustomerStagePlan {
  const records: PreparedLegacySourceRecord[] = []
  let customerCount = 0
  let skippedCount = 0

  input.companies.forEach((company, index) => {
    const id = legacyId(company, index)
    if (!companyName(company)) {
      skippedCount += 1
      records.push(prepareLegacySourceRecord({
        importBatchId: input.importBatchId,
        sourceSystem: input.sourceSystem,
        sourceNamespace: input.sourceNamespace,
        legacyEntityType: "COMPANY",
        legacyId: id,
        sourceKey: `COMPANY:${id}`,
        sourceSnapshot: sourceSnapshot(company),
        supportedFields: COMPANY_SUPPORTED_FIELDS,
      }))
      return
    }

    const snapshot = sourceSnapshot(company)
    records.push(prepareLegacySourceRecord({
      importBatchId: input.importBatchId,
      sourceSystem: input.sourceSystem,
      sourceNamespace: input.sourceNamespace,
      legacyEntityType: "COMPANY",
      legacyId: id,
      sourceKey: `COMPANY:${id}`,
      sourceSnapshot: snapshot,
      supportedFields: COMPANY_SUPPORTED_FIELDS,
    }))

    if (isCustomerLike(company)) {
      customerCount += 1
      records.push(prepareLegacySourceRecord({
        importBatchId: input.importBatchId,
        sourceSystem: input.sourceSystem,
        sourceNamespace: input.sourceNamespace,
        legacyEntityType: "CUSTOMER",
        legacyId: id,
        sourceKey: `CUSTOMER:${id}`,
        sourceSnapshot: snapshot,
        parentLegacyIds: { company: id },
        supportedFields: COMPANY_SUPPORTED_FIELDS,
      }))
    }
  })

  return {
    importBatchId: input.importBatchId,
    domainCode: "COMPANIES",
    records,
    checkpointPayload: {
      sourceCollection: "tes_companies",
      procedure: "buildCompanyCustomerStagePlan",
      companySourceCount: input.companies.length,
      companyRecordCount: input.companies.length,
      customerRecordCount: customerCount,
      skippedCount,
      commitWritesCanonicalRows: false,
    },
    companyCount: input.companies.length,
    customerCount,
    skippedCount,
  }
}
