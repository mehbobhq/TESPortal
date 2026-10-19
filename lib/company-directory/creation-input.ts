/**
 * The contract between the company creation form and the canonical domains.
 *
 * Pure validation, no database and no `server-only`: it turns the submitted JSON into a typed plan, or refuses with explicit
 * per-field issues. Nothing here guesses. A field is either
 *   - SUPPORTED: it has exactly one canonical PostgreSQL owner (see FIELD_OWNERS) and is persisted by createCompanyRecord, or
 *   - UNSUPPORTED: the canonical system has no home for it yet. A non-empty value is REFUSED with an explicit message (never
 *     silently dropped), and an empty value is ignored, or
 *   - unknown: refused.
 *
 * Jurisdiction is never guessed. The creation form does not ask for the issuing province of an MVID / NSC or the base
 * jurisdiction of an IRP / IFTA account. A jurisdiction that is fixed by the kind (RIN and CVOR are Ontario) is derived; a
 * jurisdiction that the caller states through the optional companion inputs (mvidRegion, nscRegion, irpBase, iftaBase) is used;
 * every other case is recorded as EXPLICITLY UNRESOLVED (migration 0034) and is set later by a correction in the
 * registration-management workflow. The place of incorporation and the registered address are deliberately NOT used: neither is
 * necessarily the regulatory base of the company.
 *
 * The Primary Contact is one field. Either an existing person is chosen (contactPersonId, an explicit decision by the user) or a
 * full name is typed (contactPerson); the name is stored exactly as typed in the given-name part and is never split by guesswork
 * (the Contacts workspace remains authoritative and can correct the structure). Names are never matched and merged automatically.
 */
import { prepareChannel } from "@/lib/contacts/definitions"
import { prepareProviderName, resolveCargoCategory, resolvePaymentMethod } from "@/lib/company-profile/definitions"
import { prepareRegistrationNumber } from "@/lib/tax-registrations/definitions"
import type { CorporateIdentifierInput } from "@/lib/corporate-identity/identifier-definitions"
import type { ClassificationInput, CreateOrganizationInput } from "@/lib/corporate-identity/types"
import { resolveCountryForJurisdiction } from "@/lib/jurisdictions"

export type CompanyCreationIssue = { field: string; message: string }

export class CompanyCreationValidationError extends Error {
  readonly issues: CompanyCreationIssue[]
  constructor(issues: CompanyCreationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join(" "))
    this.name = "CompanyCreationValidationError"
    this.issues = issues
  }
}

/** Which canonical domain persists each supported field. Used by the verification matrix and tests. */
export const FIELD_OWNERS = {
  companyName: "organizations.legal_name / display_name (corporate identity)",
  dba: "organization_aliases, alias_type TRADE_NAME (corporate identity)",
  companyType: "organization_classifications (corporate identity); 'Customer' also creates customers + customer_engagements",
  regCorpState: "organizations.region_code (corporate identity formation)",
  regCorpCountry: "organizations.country_code (corporate identity formation)",
  incorpNo: "organization_identifiers INCORPORATION (corporate identity)",
  businessNo: "organization_identifiers CRA_BN (corporate identity)",
  ein: "organization_identifiers IRS_EIN (corporate identity)",
  startDate: "customer_engagements.started_at (customer relationship); Customer only",
  opRegion: "company_operating_scope_periods (company operating profile)",
  contactPerson: "persons + person_name_versions + organization_person_relationships, purpose PRIMARY (contacts); the full name as typed, structure unconfirmed",
  contactPersonId: "organization_person_relationships, purpose PRIMARY (contacts); an EXISTING person chosen by the user, never matched by name",
  contactGivenName: "persons + person_name_versions + organization_person_relationships, purpose PRIMARY (contacts)",
  contactFamilyName: "persons + person_name_versions + organization_person_relationships, purpose PRIMARY (contacts)",
  phone: "organization_channels PHONE / GENERAL (contacts)",
  email: "organization_channels EMAIL / GENERAL (contacts)",
  billingEmail: "organization_channels EMAIL / ACCOUNTING (contacts)",
  website: "organization_channels WEBSITE / GENERAL (contacts); http(s) address, normalized",
  cargoTypes: "company_cargo_category_periods + cargo_categories catalogue (company operating profile); Customer only; descriptive, not a compliance claim",
  eldProvider: "company_fleet_providers + company_fleet_provider_periods, category ELD_HOS (company operating profile); a NAME, no Organization is created; Customer only",
  gpsProvider: "company_fleet_providers + company_fleet_provider_periods, category GPS_TELEMATICS (company operating profile); a NAME, no Organization is created; Customer only",
  fuelProvider: "company_fleet_providers + company_fleet_provider_periods, category FUEL_SERVICES (company operating profile); a NAME, no Organization is created; Customer only",
  payMethod: "customer_billing_preference_periods + billing_payment_methods catalogue (customer relationship); a preference, not contract terms; Customer only",
  reg_: "locations + organization_location_assignments, role REGISTERED (organization locations)",
  mail_: "locations + organization_location_assignments, role MAILING (organization locations); Customer only",
  yard_: "locations + organization_location_assignments, role HOME_YARD (organization locations); Customer only",
  usdot: "operating_authorities USDOT (operating authorities)",
  mc: "operating_authorities MC (operating authorities)",
  mvid: "operating_authorities MVID or RIN, per mvidKind (operating authorities); issuing province unresolved until established",
  nsc: "operating_authorities SAFETY_FITNESS (NSC) or CVOR, per nscKind (operating authorities); issuing province unresolved until established",
  accIrp: "operating_authorities IRP (operating authorities); base jurisdiction unresolved until established",
  accIfta: "registrations, program IFTA (tax registrations); base jurisdiction unresolved until established",
  gstHst: "registrations, program GST_HST (tax registrations); a format-checked CRA program account, no filing or tax-collection claim",
  accNyhut: "registrations, program NY_HUT (tax registrations)",
  accNm: "registrations, program NM_WDT (tax registrations)",
  accKyu: "registrations, program KYU (tax registrations)",
  accOr: "registrations, program OR_WMT (tax registrations)",
  accCt: "registrations, program CT_HUF (tax registrations)",
  scac: "registrations, program SCAC (tax registrations)",
  carrierCode: "registrations, program CA_CARRIER_CODE (tax registrations)",
} as const

/** Optional companion inputs that state a jurisdiction the caller really knows (API use); the creation form does not ask for them. */
const COMPANIONS = ["mvidKind", "mvidRegion", "nscKind", "nscRegion", "irpBase", "iftaBase"] as const

/** Present on the old form, but with no canonical owner today. Refused (when non-empty) rather than dropped. */
export const UNSUPPORTED_FIELDS: Readonly<Record<string, string>> = {
  status: "Service status is the Customer's engagement stage. A new Customer always starts in ONBOARDING; later stages are recorded through the engagement lifecycle, never chosen at creation.",
  endDate: "A Customer engagement is ended through its lifecycle (Edit, with a reason), not at creation.",
  svcType: "Service type is contract-governed: it is the package on a signed contract line, decided by the Customer's Service Decision Authority with evidence. It is shown on the profile, derived from the contract, and cannot be set here.",
  assessmentDate: "The assessment date is recorded by a company documentation assessment, which cannot be typed in. No assessment engine exists yet, so every record is shown as not yet assessed.",
  cargoInfo: "Send cargoTypes (a list of cargo categories).",
}

const ADDRESS_PREFIXES = ["reg", "mail", "yard"] as const
const ADDRESS_PARTS = ["street", "city", "state", "zip", "country"] as const

export const SUPPORTED_FIELD_KEYS: ReadonlySet<string> = new Set([
  "companyName", "dba", "companyType", "regCorpState", "regCorpCountry", "incorpNo", "businessNo", "ein", "startDate", "opRegion",
  "contactPerson", "contactPersonId", "contactGivenName", "contactFamilyName", "phone", "email", "billingEmail", "website", "gstHst",
  "cargoTypes", "eldProvider", "gpsProvider", "fuelProvider", "payMethod",
  "usdot", "mc", "mvid", "nsc", "accIrp", "accIfta", "accNyhut", "accNm", "accKyu", "accOr", "accCt", "scac", "carrierCode",
  ...COMPANIONS,
  ...ADDRESS_PREFIXES.flatMap((prefix) => ADDRESS_PARTS.map((part) => `${prefix}_${part}`)),
])

const CLASSIFICATION_BY_COMPANY_TYPE: Readonly<Record<string, string | null>> = {
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

export const OPERATING_SCOPE_BY_OP_REGION = {
  "Canada Only": "CANADA",
  "US Only": "UNITED_STATES",
  "Cross-Border": "CANADA_AND_UNITED_STATES",
} as const
export type OperatingScopeValue = (typeof OPERATING_SCOPE_BY_OP_REGION)[keyof typeof OPERATING_SCOPE_BY_OP_REGION]

export type PlannedAddress = {
  role: "REGISTERED" | "MAILING" | "HOME_YARD"
  address: { country: string; region: string; locality: string; postalCode: string | null; addressLine1: string }
}
export type PlannedChannel = { type: "PHONE" | "EMAIL" | "WEBSITE"; usage: "GENERAL" | "ACCOUNTING"; value: string }
/** A jurisdiction that is known, or one explicitly recorded as not yet established (never a guess). */
export type PlannedJurisdiction = { country: string; region: string } | { unresolved: true }
export type PlannedAuthority = {
  field: string
  kind: "USDOT" | "MC" | "MVID" | "RIN" | "CVOR" | "SAFETY_FITNESS" | "IRP"
  number: string
  jurisdiction?: PlannedJurisdiction
}
export type PlannedRegistration = {
  field: string
  program: "IFTA" | "NY_HUT" | "NM_WDT" | "KYU" | "OR_WMT" | "CT_HUF" | "SCAC" | "CA_CARRIER_CODE" | "GST_HST"
  number: string
  jurisdiction?: PlannedJurisdiction
}

/** The Primary Contact: a person typed as a full name (structure unconfirmed), a person the user chose, or the legacy given/family pair. */
export type PlannedContact =
  | {
      kind: "new"
      givenName: string | null
      familyName: string | null
      /**
       * The company's Account Email as the NEW person's own designated email (their person channel, editable if it later proves to be a
       * shared or departmental mailbox). The company's phone and billing email are never assigned to the person.
       */
      accountEmail: string | null
    }
  | { kind: "existing"; personId: string }

export type CompanyCreationPlan = {
  organization: CreateOrganizationInput
  isCustomer: boolean
  /** ISO instant (UTC midnight of the submitted date); Customer only. */
  customerStartedAt: string | null
  operatingScope: OperatingScopeValue
  contact: PlannedContact | null
  channels: PlannedChannel[]
  addresses: PlannedAddress[]
  authorities: PlannedAuthority[]
  registrations: PlannedRegistration[]
  /** Cargo category CODES (Customer only). */
  cargoCategories: string[]
  /** Fleet provider NAMES by kind (Customer only). */
  fleetProviders: Array<{ kind: "ELD" | "GPS" | "FUEL"; name: string }>
  /** Billing payment method CODE (Customer only), or null when none was chosen. */
  paymentMethod: string | null
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

function countryOf(value: unknown): "CA" | "US" | null {
  const raw = text(value).toUpperCase()
  if (raw === "CA" || raw === "CANADA") return "CA"
  if (raw === "US" || raw === "USA" || raw === "UNITED STATES") return "US"
  return null
}

function regionCountry(code: string): "CA" | "US" | null {
  const name = resolveCountryForJurisdiction(code)
  return name === "Canada" ? "CA" : name === "United States" ? "US" : null
}

const NSC_KINDS = ["NSC", "CVOR"] as const
const MVID_KINDS = ["MVID", "RIN"] as const

const ADDRESS_ROLES = { reg: "REGISTERED", mail: "MAILING", yard: "HOME_YARD" } as const

/**
 * Validates ONE address block (`reg_`, `mail_` or `yard_` fields) that has at least one value: street, city and a recognised
 * province/state are required, and the country (when given) must agree with the province/state. Shared by creation and editing.
 */
export function planAddressBlock(input: Record<string, unknown>, prefix: (typeof ADDRESS_PREFIXES)[number]): PlannedAddress | CompanyCreationIssue {
  const part = (name: (typeof ADDRESS_PARTS)[number]) => text(input[`${prefix}_${name}`])
  const label = prefix === "reg" ? "registered" : prefix === "mail" ? "mailing" : "yard"
  const missing = (["street", "city", "state"] as const).filter((name) => part(name) === "")
  if (missing.length > 0) return { field: `${prefix}_${missing[0]}`, message: `The ${label} address is incomplete: street, city and province/state are required (missing ${missing.join(", ")}).` }
  const region = part("state").toUpperCase()
  const country = regionCountry(region)
  if (!country) return { field: `${prefix}_state`, message: `'${part("state")}' is not a recognised province or state.` }
  const declared = part("country") ? countryOf(part("country")) : null
  if (part("country") && declared !== country) return { field: `${prefix}_country`, message: "The address country does not match its province/state." }
  return { role: ADDRESS_ROLES[prefix], address: { country, region, locality: part("city"), postalCode: part("zip") || null, addressLine1: part("street") } }
}

/** True when any field of the address block carries a value. */
export function addressBlockPresent(input: Record<string, unknown>, prefix: (typeof ADDRESS_PREFIXES)[number]): boolean {
  return ADDRESS_PARTS.some((name) => text(input[`${prefix}_${name}`]) !== "")
}

/** Parses and validates a creation payload. Throws CompanyCreationValidationError listing every problem found. */
export function parseCreateCompanyInput(raw: unknown): CompanyCreationPlan {
  const issues: CompanyCreationIssue[] = []
  const issue = (field: string, message: string) => issues.push({ field, message })

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CompanyCreationValidationError([{ field: "body", message: "A JSON object is required." }])
  const input = raw as Record<string, unknown>

  for (const [key, value] of Object.entries(input)) {
    if (SUPPORTED_FIELD_KEYS.has(key)) continue
    const present = typeof value === "string" ? value.trim() !== "" : Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== ""
    if (key in UNSUPPORTED_FIELDS) {
      if (present) issue(key, UNSUPPORTED_FIELDS[key])
    } else if (present) {
      issue(key, "This field is not recognised and was not saved.")
    }
  }

  // --- identity -------------------------------------------------------------------------------------------------------
  const legalName = text(input.companyName)
  if (!legalName) issue("companyName", "Company Name is required.")
  const type = text(input.companyType)
  if (!type) issue("companyType", "Company Record Type is required.")
  else if (!(type in CLASSIFICATION_BY_COMPANY_TYPE)) issue("companyType", `Unsupported Company Record Type '${type}'.`)
  const isCustomer = type === "Customer"

  const regionRaw = text(input.regCorpState)
  const countryRaw = text(input.regCorpCountry)
  let formation: { country: "CA" | "US"; region: string | null } | null = null
  if (countryRaw || regionRaw) {
    const byCountry = countryRaw ? countryOf(countryRaw) : null
    const byRegion = regionRaw ? regionCountry(regionRaw) : null
    if (countryRaw && !byCountry) issue("regCorpCountry", "Registered country must be Canada or United States.")
    else if (regionRaw && !byRegion) issue("regCorpState", `'${regionRaw}' is not a recognised province or state.`)
    else if (byCountry && byRegion && byCountry !== byRegion) issue("regCorpState", "The registered province/state does not belong to the registered country.")
    else {
      const country = byCountry ?? byRegion
      if (country) formation = { country, region: regionRaw ? regionRaw.toUpperCase() : null }
    }
  }

  const identifiers: CorporateIdentifierInput[] = []
  const incorporation = text(input.incorpNo)
  if (incorporation) {
    if (!formation) issue("incorpNo", "An incorporation number needs the registered province/state (and country) it was issued in.")
    else identifiers.push({ kind: "INCORPORATION", value: incorporation, country: formation.country, region: formation.region })
  }
  if (text(input.businessNo)) identifiers.push({ kind: "CRA_BN", value: text(input.businessNo) })
  if (text(input.ein)) identifiers.push({ kind: "IRS_EIN", value: text(input.ein) })

  const classificationCode = type in CLASSIFICATION_BY_COMPANY_TYPE ? CLASSIFICATION_BY_COMPANY_TYPE[type] : null
  const classifications: ClassificationInput[] = classificationCode ? [{ code: classificationCode, isPrimary: true }] : []
  const dba = text(input.dba)

  let customerStartedAt: string | null = null
  if (isCustomer) {
    const start = text(input.startDate)
    if (!start) issue("startDate", "TES Service Start Date is required for a Customer record.")
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || new Date(`${start}T00:00:00Z`).toISOString().slice(0, 10) !== start) {
      issue("startDate", "TES Service Start Date must be a valid date (YYYY-MM-DD).")
    } else {
      customerStartedAt = `${start}T00:00:00.000Z`
    }
  } else if (text(input.startDate)) {
    issue("startDate", "A service start date applies to Customer records only.")
  }

  // --- operating scope ------------------------------------------------------------------------------------------------
  const opRegion = text(input.opRegion) || "Canada Only"
  const operatingScope = (OPERATING_SCOPE_BY_OP_REGION as Record<string, OperatingScopeValue | undefined>)[opRegion]
  if (!operatingScope) issue("opRegion", "Operating Region must be Canada Only, US Only or Cross-Border.")

  // --- contacts -------------------------------------------------------------------------------------------------------
  const givenName = text(input.contactGivenName)
  const familyName = text(input.contactFamilyName)
  const fullName = text(input.contactPerson)
  const personId = text(input.contactPersonId)
  let contact: PlannedContact | null = null
  if (personId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(personId)) issue("contactPersonId", "The selected person is not a valid record.")
    else if (givenName || familyName) issue("contactGivenName", "Choose an existing person or give a name, not both.")
    else contact = { kind: "existing", personId: personId.toLowerCase() }
  } else if (fullName) {
    if (givenName || familyName) issue("contactPerson", "Give the Primary Contact once: either as a full name or as given and family names.")
    else if (fullName.length > 200) issue("contactPerson", "The Primary Contact name must not exceed 200 characters.")
    // Stored exactly as typed; the name's structure is not guessed (Contacts can correct it).
    else contact = { kind: "new", givenName: fullName, familyName: null, accountEmail: text(input.email) || null }
  } else if (givenName || familyName) {
    contact = { kind: "new", givenName: givenName || null, familyName: familyName || null, accountEmail: text(input.email) || null }
  }
  const channels: PlannedChannel[] = []
  if (text(input.phone)) channels.push({ type: "PHONE", usage: "GENERAL", value: text(input.phone) })
  if (text(input.email)) channels.push({ type: "EMAIL", usage: "GENERAL", value: text(input.email) })
  if (text(input.billingEmail)) channels.push({ type: "EMAIL", usage: "ACCOUNTING", value: text(input.billingEmail) })
  if (text(input.website)) {
    try {
      prepareChannel("WEBSITE", text(input.website), undefined, "website")
      channels.push({ type: "WEBSITE", usage: "GENERAL", value: text(input.website) })
    } catch (error) {
      issue("website", error instanceof Error ? error.message : "Enter a valid website address.")
    }
  }

  // --- customer profile facts (Customer records only) ---------------------------------------------------------------------
  const cargoCategories: string[] = []
  const rawCargo = parseCargoList(input.cargoTypes)
  if (rawCargo === "invalid") issue("cargoTypes", "Cargo Information must be a list of cargo categories.")
  else if (rawCargo.length === 0 && isCustomer) issue("cargoTypes", "Cargo Information is mandatory for a Customer record; choose at least one category.")
  else if (rawCargo.length > 0) {
    if (!isCustomer) issue("cargoTypes", "Cargo Information applies to Customer records only.")
    else
      for (const entry of rawCargo) {
        const category = resolveCargoCategory(entry)
        if (!category) issue("cargoTypes", `'${String(entry)}' is not a cargo category.`)
        else if (!cargoCategories.includes(category.code)) cargoCategories.push(category.code)
      }
  }
  const fleetProviders: Array<{ kind: "ELD" | "GPS" | "FUEL"; name: string }> = []
  for (const [field, kind] of [["eldProvider", "ELD"], ["gpsProvider", "GPS"], ["fuelProvider", "FUEL"]] as const) {
    if (!text(input[field])) continue
    if (!isCustomer) {
      issue(field, "Fleet providers apply to Customer records only.")
      continue
    }
    try {
      fleetProviders.push({ kind, name: prepareProviderName(input[field], field) })
    } catch (error) {
      issue(field, error instanceof Error ? error.message : "The provider name is not accepted.")
    }
  }
  let paymentMethod: string | null = null
  if (text(input.payMethod)) {
    if (!isCustomer) issue("payMethod", "A billing payment method applies to Customer records only.")
    else {
      const method = resolvePaymentMethod(input.payMethod)
      if (!method) issue("payMethod", `'${text(input.payMethod)}' is not a billing payment method.`)
      else paymentMethod = method.code
    }
  }

  // --- addresses (three independent roles; a block is all-or-nothing) ---------------------------------------------------------
  const addresses: PlannedAddress[] = []
  const roles = { reg: "REGISTERED", mail: "MAILING", yard: "HOME_YARD" } as const
  for (const prefix of ADDRESS_PREFIXES) {
    const part = (name: (typeof ADDRESS_PARTS)[number]) => text(input[`${prefix}_${name}`])
    const any = ADDRESS_PARTS.some((name) => part(name) !== "")
    if (!any) continue
    if (prefix !== "reg" && !isCustomer) {
      issue(`${prefix}_street`, `${prefix === "mail" ? "A mailing" : "A yard"} address applies to Customer records only.`)
      continue
    }
    const planned = planAddressBlock(input, prefix)
    if ("field" in planned) {
      issue(planned.field, planned.message)
      continue
    }
    addresses.push(planned)
  }

  // --- authorities ------------------------------------------------------------------------------------------------------
  const authorities: PlannedAuthority[] = []
  if (text(input.usdot)) authorities.push({ field: "usdot", kind: "USDOT", number: text(input.usdot) })
  if (text(input.mc)) authorities.push({ field: "mc", kind: "MC", number: text(input.mc) })

  const mvid = text(input.mvid)
  const mvidKind = text(input.mvidKind) || "MVID"
  if (mvid) {
    if (!(MVID_KINDS as readonly string[]).includes(mvidKind)) issue("mvidKind", "Choose MVID or RIN.")
    else if (mvidKind === "RIN") authorities.push({ field: "mvid", kind: "RIN", number: mvid, jurisdiction: { country: "CA", region: "ON" } })
    else {
      const region = text(input.mvidRegion).toUpperCase()
      if (region && regionCountry(region) !== "CA") issue("mvidRegion", "The MVID issuing province must be a Canadian province or territory.")
      else authorities.push({ field: "mvid", kind: "MVID", number: mvid, jurisdiction: region ? { country: "CA", region } : { unresolved: true } })
    }
  } else if (text(input.mvidRegion)) issue("mvidRegion", "An issuing province was given without an MVID / RIN number.")

  const nsc = text(input.nsc)
  const nscKind = text(input.nscKind) || "NSC"
  if (nsc) {
    if (!(NSC_KINDS as readonly string[]).includes(nscKind)) issue("nscKind", "Choose NSC or CVOR.")
    else if (nscKind === "CVOR") authorities.push({ field: "nsc", kind: "CVOR", number: nsc, jurisdiction: { country: "CA", region: "ON" } })
    else {
      const region = text(input.nscRegion).toUpperCase()
      if (region && regionCountry(region) !== "CA") issue("nscRegion", "The NSC issuing province must be a Canadian province or territory.")
      else authorities.push({ field: "nsc", kind: "SAFETY_FITNESS", number: nsc, jurisdiction: region ? { country: "CA", region } : { unresolved: true } })
    }
  } else if (text(input.nscRegion)) issue("nscRegion", "An issuing province was given without an NSC / CVOR number.")

  const base = (field: "irpBase" | "iftaBase") => {
    const region = text(input[field]).toUpperCase()
    const country = region ? regionCountry(region) : null
    return region && country ? { country, region } : null
  }
  if (text(input.accIrp)) {
    const jurisdiction = base("irpBase")
    if (text(input.irpBase) && !jurisdiction) issue("irpBase", "The IRP base must be a recognised province or state.")
    else authorities.push({ field: "accIrp", kind: "IRP", number: text(input.accIrp), jurisdiction: jurisdiction ?? { unresolved: true } })
  } else if (text(input.irpBase)) issue("irpBase", "A base jurisdiction was given without an IRP account number.")

  // --- tax registrations ------------------------------------------------------------------------------------------------
  const registrations: PlannedRegistration[] = []
  if (text(input.accIfta)) {
    const jurisdiction = base("iftaBase")
    if (text(input.iftaBase) && !jurisdiction) issue("iftaBase", "The IFTA base must be a recognised province or state.")
    else registrations.push({ field: "accIfta", program: "IFTA", number: text(input.accIfta), jurisdiction: jurisdiction ?? { unresolved: true } })
  } else if (text(input.iftaBase)) issue("iftaBase", "A base jurisdiction was given without an IFTA account number.")
  if (text(input.gstHst)) {
    try {
      const account = prepareRegistrationNumber("GST_HST", text(input.gstHst), "gstHst")
      // The account's first nine digits ARE the Business Number; a different Business Number on the same record is a contradiction.
      const bn = text(input.businessNo).replace(/\D/g, "")
      if (bn.length === 9 && !account.normalized.startsWith(bn)) issue("gstHst", "The GST/HST account must begin with this company's Business Number.")
      else registrations.push({ field: "gstHst", program: "GST_HST", number: text(input.gstHst) })
    } catch (error) {
      issue("gstHst", error instanceof Error ? error.message : "Enter a valid GST/HST account (for example 123456789 RT 0001).")
    }
  }
  const fixed: Array<[string, PlannedRegistration["program"]]> = [
    ["accNyhut", "NY_HUT"], ["accNm", "NM_WDT"], ["accKyu", "KYU"], ["accOr", "OR_WMT"], ["accCt", "CT_HUF"], ["scac", "SCAC"], ["carrierCode", "CA_CARRIER_CODE"],
  ]
  for (const [field, program] of fixed) if (text(input[field])) registrations.push({ field, program, number: text(input[field]) })

  if (issues.length > 0) throw new CompanyCreationValidationError(issues)

  return {
    organization: {
      legalName,
      displayName: legalName,
      formation,
      identifiers,
      aliases: dba ? [{ alias: dba, aliasType: "TRADE_NAME" as const }] : [],
      classifications,
    },
    isCustomer,
    customerStartedAt,
    operatingScope: operatingScope as OperatingScopeValue,
    contact,
    channels,
    addresses,
    authorities,
    registrations,
    cargoCategories,
    fleetProviders,
    paymentMethod,
  }
}

/** Cargo categories arrive as a list or as the form's JSON-encoded list; anything else is refused, never guessed. */
export function parseCargoList(value: unknown): unknown[] | "invalid" {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return "invalid"
  const raw = value.trim()
  if (raw === "") return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : "invalid"
  } catch {
    return "invalid"
  }
}
