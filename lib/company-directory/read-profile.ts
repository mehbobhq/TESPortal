import "server-only"

import type { TesSystemCapability } from "@/lib/auth/tes-capabilities"
import { hasAdditionalSystemCapability, withAuthorizedSystem } from "@/lib/auth/tes-system-context"
import { enterSystemCapability } from "@/lib/company-directory/capability-context"
import * as profileFacts from "@/lib/company-profile/facts"
import * as profileOperations from "@/lib/company-profile/operations"
import * as contractOperations from "@/lib/contracts/operations"
import * as contactOperations from "@/lib/contacts/operations"
import { CorporateIdentityNotFoundError } from "@/lib/corporate-identity/errors"
import * as corporateOperations from "@/lib/corporate-identity/operations"
import * as customerOperations from "@/lib/customer-relationship/operations"
import * as authorityOperations from "@/lib/operating-authorities/operations"
import * as locationOperations from "@/lib/organization-locations/operations"
import * as taxOperations from "@/lib/tax-registrations/operations"

export type ProfileSectionState = "ok" | "not_permitted"
export type ProfileSection = "identity" | "operatingProfile" | "customer" | "locations" | "contacts" | "authorities" | "registrations" | "contracts"

/**
 * Service Type is CONTRACT-GOVERNED and read-only here: it is the package on a SIGNED contract line, decided by the Customer's
 * Service Decision Authority with evidence. "not_contracted" means no signed contract exists; "restricted" means the caller may not
 * read contracts. It is derived on every read and never stored on the company.
 */
export type ServiceTypeState =
  | { state: "contracted"; packages: string[]; contractReference: string | null }
  | { state: "not_contracted" }
  | { state: "restricted" }

export type CompanyProfileRecord = {
  id: string
  name: string
  legalName: string
  kind: string
  /** Formation jurisdiction, e.g. "ON, CA"; "Not recorded" when none was recorded. */
  region: string
  status: "Active" | "Archived" | "Merged"
  createdAt: string
  dba: string | null
  contact: string | null
  phone: string | null
  email: string | null
  billingEmail: string | null
  website: string | null
  /** Cargo category display labels in catalogue order; empty when none are recorded. */
  cargoTypes: string[]
  eldProvider: string | null
  gpsProvider: string | null
  fuelProvider: string | null
  /** The Customer's preferred billing payment method (a preference, not contract terms); null when none is recorded. */
  payMethod: string | null
  payMethodCode: string | null
  /** Derived from the signed contract; see ServiceTypeState. null for a record that is not a Customer. */
  serviceType: ServiceTypeState | null
  /**
   * The company documentation assessment. No engine records one yet (the Documentation Status Engine is a future dependency), and the
   * existing onboarding readiness snapshots measure only onboarding-evidence readiness for an engagement, which is a different
   * scope, so they are deliberately NOT presented as an assessment. Until an engine exists the truthful state is "not yet assessed".
   */
  assessment: { state: "not_yet_assessed" }
  /** Every engagement this Customer has had, oldest first (join, leave, rejoin). Empty for a record that is not a Customer. */
  engagements: Array<{ id: string; startedAt: string; endedAt: string | null; current: boolean }>
  /** The recorded operating scope, or null when none has been recorded. Never defaulted. */
  opRegion: "Canada Only" | "US Only" | "Cross-Border" | null
  incorpNo: string | null
  businessNo: string | null
  ein: string | null
  regCorpState: string | null
  regCorpCountry: string | null
  usdot: string | null
  mc: string | null
  nsc: string | null
  mvid: string | null
  scac: string | null
  carrierCode: string | null
  accIrp: string | null
  accIfta: string | null
  accNyhut: string | null
  accNm: string | null
  accKyu: string | null
  accOr: string | null
  accCt: string | null
  startDate: string | null
  /** The date the open or latest Engagement ended (YYYY-MM-DD), or null while it is open. */
  endDate: string | null
  serviceStage: string | null
  reg_street: string | null
  reg_city: string | null
  reg_state: string | null
  reg_zip: string | null
  reg_country: string | null
  mail_street: string | null
  mail_city: string | null
  mail_state: string | null
  mail_zip: string | null
  mail_country: string | null
  yard_street: string | null
  yard_city: string | null
  yard_state: string | null
  yard_zip: string | null
  yard_country: string | null
  /** Per section: "ok" (read, possibly empty) or "not_permitted" (the caller lacks the capability, so nothing is shown). */
  sections: Record<ProfileSection, ProfileSectionState>
  /** Fields the old creation form collected that the canonical system does not record yet; the page labels them explicitly. */
  notRecordedYet: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const COUNTRY_NAME: Record<string, string> = { CA: "Canada", US: "United States" }
const SCOPE_LABEL = { CANADA: "Canada Only", UNITED_STATES: "US Only", CANADA_AND_UNITED_STATES: "Cross-Border" } as const

const statusLabel = (status: "active" | "archived" | "merged") => (status === "active" ? "Active" : status === "archived" ? "Archived" : "Merged")
const formationLabel = (country: string | null, region: string | null) => [region, country].filter(Boolean).join(", ") || "Not recorded"

type AddressFlat = Pick<CompanyProfileRecord, "reg_street" | "reg_city" | "reg_state" | "reg_zip" | "reg_country">

const KIND_LABEL: Record<string, string> = { SAFETY_FITNESS: "NSC" }

function numberWithJurisdiction(kind: string, number: string, region: string | null, showKind: boolean): string {
  return `${showKind ? `${KIND_LABEL[kind] ?? kind} ` : ""}${number}${region ? ` (${region})` : ""}`
}

/**
 * Reads the whole company profile from the canonical domains in ONE transaction. Each section is read through its own
 * domain's read operation and only when the caller holds that domain's read capability; a section the caller may not read is
 * reported as "not_permitted" (never as empty). Returns null only when the Organization does not exist (or the id is not a UUID).
 */
export async function readCompanyProfile(organizationId: string): Promise<CompanyProfileRecord | null> {
  if (!UUID.test(organizationId)) return null

  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", async (client, decision) => {
    let organization
    try {
      organization = await corporateOperations.readOrganization(client, organizationId.toLowerCase())
    } catch (error) {
      if (error instanceof CorporateIdentityNotFoundError) return null
      throw error
    }
    const id = organization.id
    const sections = {} as Record<ProfileSection, ProfileSectionState>
    sections.identity = "ok"

    const guarded = async <T>(section: ProfileSection, capability: TesSystemCapability, read: () => Promise<T>): Promise<T | null> => {
      if (capability !== "ORGANIZATION_REGISTRY_READ" && !(await hasAdditionalSystemCapability(client, decision, capability))) {
        sections[section] = "not_permitted"
        return null
      }
      await enterSystemCapability(client, capability)
      sections[section] = "ok"
      return read()
    }

    const customerBundle = await guarded("customer", "CUSTOMER_RELATIONSHIP_READ", async () => {
      const relationship = await customerOperations.readCustomerRelationship(client, id)
      const billing = relationship.customer ? await profileFacts.readBillingPreference(client, id) : null
      return { relationship, billing }
    })
    const customer = customerBundle?.relationship ?? null
    const profileBundle = await guarded("operatingProfile", "COMPANY_PROFILE_READ", async () => ({
      profile: await profileOperations.readCompanyProfile(client, id),
      facts: await profileFacts.readCompanyFacts(client, id),
    }))
    const profile = profileBundle?.profile ?? null
    const operatingFacts = profileBundle?.facts ?? null
    const locations = await guarded("locations", "ORGANIZATION_REGISTRY_READ", () => locationOperations.readOrganizationLocations(client, id))
    const contacts = await guarded("contacts", "PERSON_REGISTRY_READ", () => contactOperations.readOrganizationContacts(client, id))
    const authorities = await guarded("authorities", "ORGANIZATION_REGISTRY_READ", () => authorityOperations.readOrganizationAuthorities(client, id))
    const registrations = await guarded("registrations", "TAX_REGISTRATION_READ", () => taxOperations.readOrganizationRegistrations(client, id))

    const activeIdentifier = (kind: string) => organization.identifiers.find((identifier) => identifier.status === "active" && identifier.kind === kind)?.value ?? null
    const trade = organization.aliases.find((alias) => alias.status === "active" && alias.aliasType?.toUpperCase() === "TRADE_NAME")
    const primaryClassification = organization.classifications.find((classification) => classification.isPrimary && !classification.effectiveTo)?.code ?? null
    const isCustomer = customer?.customer != null

    const address = (role: "REGISTERED" | "MAILING" | "HOME_YARD") => locations?.current[role]?.address ?? null
    const flat = <P extends "reg" | "mail" | "yard">(prefix: P, role: "REGISTERED" | "MAILING" | "HOME_YARD") => {
      const a = address(role)
      return {
        [`${prefix}_street`]: a ? [a.addressLine1, a.addressLine2, a.unit].filter(Boolean).join(", ") : null,
        [`${prefix}_city`]: a?.locality ?? null,
        [`${prefix}_state`]: a?.region ?? null,
        [`${prefix}_zip`]: a?.postalCode ?? null,
        [`${prefix}_country`]: a ? (COUNTRY_NAME[a.country] ?? a.country) : null,
      } as Record<string, string | null>
    }

    const channel = (type: "PHONE" | "EMAIL" | "WEBSITE", usage: string) => contacts?.currentChannels.find((c) => c.channelType === type && c.usage === usage && c.recordStatus === "active")?.valueDisplay ?? null
    const primary = contacts?.contacts.find((c) => c.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary))
    const primaryName = primary?.current.name ? [primary.current.name.givenName, primary.current.name.familyName].filter(Boolean).join(" ") : null

    const authority = (kinds: string[], showKind: boolean) => {
      const found = (authorities?.authorities ?? []).filter((view) => view.authority.archivedAt === null && kinds.includes(view.authority.kind) && view.current.version)
      return found.length ? found.map((view) => numberWithJurisdiction(view.authority.kind, view.current.version!.numberDisplay, view.current.version!.jurisdictionRegion, showKind)).join(" / ") : null
    }
    const registration = (program: string, withBase = false) => {
      const found = (registrations?.registrations ?? []).filter((view) => view.registration.archivedAt === null && view.registration.program === program && view.current.version)
      return found.length ? found.map((view) => numberWithJurisdiction(program, view.current.version!.numberDisplay, withBase ? view.current.version!.jurisdictionRegion : null, false)).join(" / ") : null
    }

    // The open engagement when there is one; otherwise the MOST RECENT one (engagements are ordered oldest first). A customer who left
    // and rejoined therefore shows the current engagement's start date, and one who left shows when they left.
    const engagement = customer?.openEngagement ?? customer?.engagements[customer.engagements.length - 1] ?? null

    // Contract-derived, read-only Service Type: only for a Customer, only from a SIGNED contract, only for a caller who may read contracts.
    let serviceType: ServiceTypeState | null = null
    sections.contracts = "ok"
    if (isCustomer && customer?.customer) {
      if (!(await hasAdditionalSystemCapability(client, decision, "CONTRACT_READ"))) {
        sections.contracts = "not_permitted"
        serviceType = { state: "restricted" }
      } else {
        await enterSystemCapability(client, "CONTRACT_READ")
        const view = await contractOperations.readContractsView(client, id, customer.customer.id)
        // Only the CURRENT stay's signed contracts define the current service. A contract belongs to one engagement; one from an ended
        // stay stays in the contracts workspace as history and is never shown as current (no open engagement -> nothing is current).
        const currentEngagementId = customer.openEngagement?.engagement.id ?? null
        const signed = view.contracts.filter((contract) => contract.contractStatus === "signed" && currentEngagementId !== null && contract.engagementId === currentEngagementId)
        if (signed.length === 0) serviceType = { state: "not_contracted" }
        else {
          const names = new Map(view.packages.map((definition) => [definition.packageCode, definition.packageName]))
          const packages = [
            ...new Set(
              signed.flatMap((contract) =>
                contract.lines.filter((line) => line.lineStatus !== "removed").flatMap((line) => (line.pricing?.packageCode ? [names.get(line.pricing.packageCode) ?? line.pricing.packageCode] : [])),
              ),
            ),
          ]
          serviceType = { state: "contracted", packages, contractReference: signed[0].contractReference }
        }
      }
    }

    const scope = profile?.operatingScope.assertion?.operatingScope ?? null

    return {
      id,
      name: organization.displayName ?? organization.legalName,
      legalName: organization.legalName,
      kind: isCustomer ? "Customer" : primaryClassification ?? "Organization",
      region: formationLabel(organization.formationCountry, organization.formationRegion),
      status: statusLabel(organization.status),
      createdAt: organization.createdAt,
      dba: trade?.alias ?? null,
      contact: primaryName,
      phone: channel("PHONE", "GENERAL"),
      email: channel("EMAIL", "GENERAL"),
      billingEmail: channel("EMAIL", "ACCOUNTING"),
      website: channel("WEBSITE", "GENERAL"),
      cargoTypes: (operatingFacts?.cargo ?? []).map((category) => category.displayName),
      eldProvider: operatingFacts?.fleetProviders.ELD?.name ?? null,
      gpsProvider: operatingFacts?.fleetProviders.GPS?.name ?? null,
      fuelProvider: operatingFacts?.fleetProviders.FUEL?.name ?? null,
      payMethod: customerBundle?.billing?.current?.displayName ?? null,
      payMethodCode: customerBundle?.billing?.current?.code ?? null,
      serviceType,
      assessment: { state: "not_yet_assessed" },
      engagements: (customer?.engagements ?? []).map((view) => ({ id: view.engagement.id, startedAt: view.engagement.startedAt.slice(0, 10), endedAt: view.engagement.endedAt ? view.engagement.endedAt.slice(0, 10) : null, current: view.engagement.id === engagement?.engagement.id })),
      opRegion: scope ? SCOPE_LABEL[scope] : null,
      incorpNo: activeIdentifier("INCORPORATION"),
      businessNo: activeIdentifier("CRA_BN") ?? null,
      ein: activeIdentifier("IRS_EIN"),
      regCorpState: organization.formationRegion,
      regCorpCountry: organization.formationCountry ? (COUNTRY_NAME[organization.formationCountry] ?? organization.formationCountry) : null,
      usdot: authority(["USDOT"], false),
      mc: authority(["MC"], false),
      nsc: authority(["SAFETY_FITNESS", "CVOR"], true),
      mvid: authority(["MVID", "RIN"], true),
      scac: registration("SCAC"),
      carrierCode: registration("CA_CARRIER_CODE"),
      accIrp: authority(["IRP"], false),
      accIfta: registration("IFTA", true),
      accNyhut: registration("NY_HUT"),
      accNm: registration("NM_WDT"),
      accKyu: registration("KYU"),
      accOr: registration("OR_WMT"),
      accCt: registration("CT_HUF"),
      startDate: engagement ? engagement.engagement.startedAt.slice(0, 10) : null,
      endDate: engagement?.engagement.endedAt ? engagement.engagement.endedAt.slice(0, 10) : null,
      serviceStage: engagement?.current.stage?.stage ?? null,
      ...(flat("reg", "REGISTERED") as Pick<CompanyProfileRecord, keyof AddressFlat>),
      ...(flat("mail", "MAILING") as Pick<CompanyProfileRecord, "mail_street" | "mail_city" | "mail_state" | "mail_zip" | "mail_country">),
      ...(flat("yard", "HOME_YARD") as Pick<CompanyProfileRecord, "yard_street" | "yard_city" | "yard_state" | "yard_zip" | "yard_country">),
      sections,
      notRecordedYet: ["gstHst"],
    } as CompanyProfileRecord
  })
}
