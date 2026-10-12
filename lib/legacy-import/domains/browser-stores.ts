import { prepareLegacySourceRecord } from "../source"
import type { LegacyImportDomainCode, LegacyImportEntityType, LegacyImportStageRecordsInput, PreparedLegacySourceRecord } from "../types"

type BrowserStoreDomain =
  | "LOCATIONS"
  | "CONTACTS"
  | "VEHICLES"
  | "DRIVERS"
  | "AUTHORITIES"
  | "TAX_REGISTRATIONS"
  | "COMPANY_PROFILE"
  | "INSURANCE"
  | "CREDENTIAL_METADATA"

type BrowserStoreConfig = {
  domainCode: BrowserStoreDomain
  entityType: LegacyImportEntityType
  sourceCollection: string
  parentCompanyId?: string
  supportedFields: readonly string[]
}

export type LegacyBrowserStoreStageInput = {
  importBatchId: string
  sourceSystem: string
  sourceNamespace: string
  records: Record<string, unknown>[]
}

export type LegacyBrowserStoreStagePlan = LegacyImportStageRecordsInput & {
  sourceCollection: string
  recordCount: number
}

const COMMON_FIELDS = [
  "id",
  "recordId",
  "companyId",
  "organizationId",
  "status",
  "createdAt",
  "updatedAt",
  "_legacyImport",
] as const

const DOMAIN_CONFIGS = {
  locations(parentCompanyId: string): BrowserStoreConfig {
    return {
      domainCode: "LOCATIONS",
      entityType: "LOCATION",
      sourceCollection: `tes_company_locations_${parentCompanyId}`,
      parentCompanyId,
      supportedFields: [...COMMON_FIELDS, "name", "address", "city", "region", "province", "state", "postalCode", "country"],
    }
  },
  contacts(): BrowserStoreConfig {
    return {
      domainCode: "CONTACTS",
      entityType: "PERSON",
      sourceCollection: "tes_contacts_v5",
      supportedFields: [...COMMON_FIELDS, "firstName", "lastName", "name", "email", "phone", "title", "companyId", "purpose"],
    }
  },
  vehicles(parentCompanyId: string): BrowserStoreConfig {
    return {
      domainCode: "VEHICLES",
      entityType: "VEHICLE",
      sourceCollection: `tes_company_vehicles_${parentCompanyId}`,
      parentCompanyId,
      supportedFields: [...COMMON_FIELDS, "vin", "unitNumber", "plate", "jurisdiction", "make", "model", "year", "vehicleType"],
    }
  },
  drivers(parentCompanyId: string): BrowserStoreConfig {
    return {
      domainCode: "DRIVERS",
      entityType: "DRIVER_PROFILE",
      sourceCollection: `tes_company_drivers_${parentCompanyId}`,
      parentCompanyId,
      supportedFields: [...COMMON_FIELDS, "driverMasterId", "firstName", "lastName", "email", "phone", "licenceNumber", "licenceJurisdiction", "dateOfBirth"],
    }
  },
  authorities(parentCompanyId: string): BrowserStoreConfig {
    return {
      domainCode: "AUTHORITIES",
      entityType: "AUTHORITY",
      sourceCollection: `tes_company_authorities_${parentCompanyId}`,
      parentCompanyId,
      supportedFields: [...COMMON_FIELDS, "authorityType", "authorityNumber", "jurisdiction", "effectiveDate", "expiryDate"],
    }
  },
  taxRegistrations(parentCompanyId: string): BrowserStoreConfig {
    return {
      domainCode: "TAX_REGISTRATIONS",
      entityType: "TAX_REGISTRATION",
      sourceCollection: `tes_company_tax_filing_${parentCompanyId}`,
      parentCompanyId,
      supportedFields: [...COMMON_FIELDS, "programCode", "accountNumber", "jurisdiction", "effectiveDate", "expiryDate"],
    }
  },
  companyProfile(parentCompanyId: string): BrowserStoreConfig {
    return {
      domainCode: "COMPANY_PROFILE",
      entityType: "COMPANY",
      sourceCollection: `tes_company_compliance_settings_${parentCompanyId}`,
      parentCompanyId,
      supportedFields: [...COMMON_FIELDS, "jurisdiction", "operatingScope", "rules", "minimumDriverAge", "minimumDriverExperience"],
    }
  },
  insurance(parentCompanyId: string): BrowserStoreConfig {
    return {
      domainCode: "INSURANCE",
      entityType: "INSURANCE_POLICY",
      sourceCollection: `tes_company_insurance_${parentCompanyId}`,
      parentCompanyId,
      supportedFields: [...COMMON_FIELDS, "policyNumber", "insurerName", "brokerName", "effectiveDate", "expiryDate", "coverages"],
    }
  },
  credentialMetadata(parentCompanyId: string): BrowserStoreConfig {
    return {
      domainCode: "CREDENTIAL_METADATA",
      entityType: "COMPANY_CREDENTIAL",
      sourceCollection: `tes_company_credentials_${parentCompanyId}`,
      parentCompanyId,
      supportedFields: [...COMMON_FIELDS, "systemName", "url", "username", "category", "mfaStatus", "secretSlotId"],
    }
  },
} satisfies Record<string, (...args: never[]) => BrowserStoreConfig>

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function recordId(record: Record<string, unknown>, index: number): string {
  return cleanString(record.id) ?? cleanString(record.recordId) ?? `browser-record-index-${index}`
}

function snapshot(record: Record<string, unknown>, config: BrowserStoreConfig): Record<string, unknown> {
  return {
    ...record,
    _legacyImport: {
      canonicalIntent: {
        domainCode: config.domainCode,
        entityType: config.entityType,
        parentCompanyId: config.parentCompanyId ?? null,
      },
    },
  }
}

export function buildBrowserStoreStagePlan(
  config: BrowserStoreConfig,
  input: LegacyBrowserStoreStageInput,
): LegacyBrowserStoreStagePlan {
  const records: PreparedLegacySourceRecord[] = input.records.map((record, index) => {
    const id = recordId(record, index)
    return prepareLegacySourceRecord({
      importBatchId: input.importBatchId,
      sourceSystem: input.sourceSystem,
      sourceNamespace: input.sourceNamespace,
      legacyEntityType: config.entityType,
      legacyId: id,
      sourceKey: `${config.entityType}:${config.sourceCollection}:${id}`,
      sourceSnapshot: snapshot(record, config),
      parentLegacyIds: config.parentCompanyId ? { company: config.parentCompanyId } : {},
      supportedFields: config.supportedFields,
    })
  })

  return {
    importBatchId: input.importBatchId,
    domainCode: config.domainCode as LegacyImportDomainCode,
    records,
    checkpointPayload: {
      sourceCollection: config.sourceCollection,
      procedure: "buildBrowserStoreStagePlan",
      sourceRecordCount: input.records.length,
      stagedRecordCount: records.length,
      commitWritesCanonicalRows: false,
    },
    sourceCollection: config.sourceCollection,
    recordCount: records.length,
  }
}

export const legacyBrowserStoreDomains = DOMAIN_CONFIGS
