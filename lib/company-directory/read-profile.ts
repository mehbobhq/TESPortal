import "server-only"

import type { TesSystemCapability } from "@/lib/auth/tes-capabilities"
import { hasAdditionalSystemCapability, withAuthorizedSystem } from "@/lib/auth/tes-system-context"
import { enterSystemCapability } from "@/lib/company-directory/capability-context"
import { PAYMENT_METHOD_DEFINITIONS } from "@/lib/company-profile/definitions"
import { migration0036State, type Migration0036State } from "@/lib/company-changes/schema-state"
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

/** A person holding a customer authority (Service Decision Authority / Contract Signatory); the name only for a caller who may read the people registry. */
export type ProfileAuthorityHolder = { personId: string; name: string | null; since: string }

/**
 * What the Customer relationship says about who may decide and sign, and where the contracts stand. All of it is DERIVED from the
 * contracts domain on every read (never stored on the company) and needs CONTRACT_READ; without it the section says "restricted".
 */
export type ProfileCustomerDetails = {
  authorities:
    | { state: "ok"; serviceDecisionAuthority: ProfileAuthorityHolder | null; contractSignatory: ProfileAuthorityHolder | null; samePerson: boolean | null }
    | { state: "restricted" }
  contracts:
    | { state: "ok"; byStatus: Record<string, number>; signedInForce: boolean; signedReference: string | null }
    | { state: "restricted" }
}

/** What the VIEWER may change (each flag is a capability the server also re-proves when a change is saved); the edit page marks the rest read-only. */
export type ProfileEditAccess = {
  /** Open Company Edit at all (ORGANIZATION_UPDATE): the identity fields, the registered address and region. */
  identity: boolean
  /** Company phone, emails and website (CONTACT_MANAGE). */
  communication: boolean
  /** Cargo and fleet providers (COMPANY_PROFILE_MANAGE). */
  operatingProfile: boolean
  /** The preferred payment method (CUSTOMER_RELATIONSHIP_MANAGE). */
  billing: boolean
  /** The GST/HST account (TAX_REGISTRATION_MANAGE). */
  registrations: boolean
  /** Ending a customer's service (CUSTOMER_RELATIONSHIP_MANAGE). */
  service: boolean
  /** Executing a registered legal-name change (COMPANY_LEGAL_NAME_CHANGE). */
  legalName: boolean
}

export type ProfileAddressHistoryEntry = { role: "REGISTERED" | "MAILING" | "HOME_YARD"; address: string; from: string; to: string | null }
export type ProfilePaymentHistoryEntry = { method: string; from: string; to: string | null }

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
  /** The Primary Contact's name as recorded in Contacts; the Contacts workspace is authoritative for the person. */
  contact: string | null
  /** The canonical person record behind the Primary Contact, for permanent navigation to Contacts; null when none or not permitted. */
  contactPersonId: string | null
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
  /** The GST/HST program account on record (registration program GST_HST); null when none or not permitted. */
  gstHst: string | null
  /** The GST/HST registration id, for editing; null when none. */
  gstHstRegistrationId: string | null
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
  /** What the viewer may edit (see ProfileEditAccess). */
  editAccess: ProfileEditAccess
  /**
   * Company channels that have ever had a (non-voided) value, by form field. A value set on a channel that HAD one is a replacement (it waits for
   * confirmation) even when the channel is empty now; only the very first value of a channel is recorded directly. null when contacts are not permitted.
   */
  channelsEverRecorded: Record<"website" | "phone" | "email" | "billingEmail", boolean> | null
  /** Whether company change tracking (the change ledger, the verified legal-name procedure, confirmed channel replacements) exists on this database. */
  changeTracking: Migration0036State
  /** Customer-only: authorities and contract standing (derived). null for a record that is not a Customer. */
  customerDetails: ProfileCustomerDetails | null
  /** Previous registered / mailing / yard addresses (genuine moves, newest first); null when locations are not permitted. */
  addressHistory: ProfileAddressHistoryEntry[] | null
  /** Previous billing payment-method preferences, newest first; null when the customer section is not permitted or this is not a Customer. */
  paymentMethodHistory: ProfilePaymentHistoryEntry[] | null
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

/** Number kinds whose issuing / base jurisdiction can be recorded as not yet established (migration 0034). */
const JURISDICTION_DEPENDENT = new Set(["MVID", "SAFETY_FITNESS", "IRP", "IFTA"])

function numberWithJurisdiction(kind: string, number: string, region: string | null, showKind: boolean, showRegion = true): string {
  const suffix = region ? ` (${region})` : showRegion && JURISDICTION_DEPENDENT.has(kind) ? " (jurisdiction not set)" : ""
  return `${showKind ? `${KIND_LABEL[kind] ?? kind} ` : ""}${number}${suffix}`
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
    let channelsEverRecorded: CompanyProfileRecord["channelsEverRecorded"] = null
    const contacts = await guarded("contacts", "PERSON_REGISTRY_READ", async () => {
      const view = await contactOperations.readOrganizationContacts(client, id)
      const ever = await client.query<{ channel_type: string; channel_usage: string }>(
        `SELECT DISTINCT channel_type, channel_usage FROM public.organization_channels WHERE organization_id = $1 AND record_status <> 'voided'`,
        [id],
      )
      const has = (type: string, usage: string) => ever.rows.some((row) => row.channel_type === type && row.channel_usage === usage)
      channelsEverRecorded = { website: has("WEBSITE", "GENERAL"), phone: has("PHONE", "GENERAL"), email: has("EMAIL", "GENERAL"), billingEmail: has("EMAIL", "ACCOUNTING") }
      return view
    })
    const authorities = await guarded("authorities", "ORGANIZATION_REGISTRY_READ", () => authorityOperations.readOrganizationAuthorities(client, id))
    const registrations = await guarded("registrations", "TAX_REGISTRATION_READ", () => taxOperations.readOrganizationRegistrations(client, id))

    // Change tracking (migration 0036) may not exist on this database yet: its capability is then unknown, so it is neither asked nor assumed.
    const changeTracking = await migration0036State(client)
    const [canIdentity, canCommunication, canProfile, canBilling, canRegistrations] = await Promise.all(
      (["ORGANIZATION_UPDATE", "CONTACT_MANAGE", "COMPANY_PROFILE_MANAGE", "CUSTOMER_RELATIONSHIP_MANAGE", "TAX_REGISTRATION_MANAGE"] as const).map((capability) =>
        hasAdditionalSystemCapability(client, decision, capability),
      ),
    )
    const canLegalName = changeTracking === "COMPLETE" ? await hasAdditionalSystemCapability(client, decision, "COMPANY_LEGAL_NAME_CHANGE") : false
    const editAccess: ProfileEditAccess = { identity: canIdentity, communication: canCommunication, operatingProfile: canProfile, billing: canBilling, registrations: canRegistrations, service: canBilling, legalName: canLegalName }

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
      return found.length ? found.map((view) => numberWithJurisdiction(program, view.current.version!.numberDisplay, withBase ? view.current.version!.jurisdictionRegion : null, false, withBase)).join(" / ") : null
    }

    // The open engagement when there is one; otherwise the MOST RECENT one (engagements are ordered oldest first). A customer who left
    // and rejoined therefore shows the current engagement's start date, and one who left shows when they left.
    const engagement = customer?.openEngagement ?? customer?.engagements[customer.engagements.length - 1] ?? null

    // Contract-derived, read-only Service Type and customer authorities: only for a Customer, only from SIGNED contracts, only for a caller who may read contracts.
    let serviceType: ServiceTypeState | null = null
    let customerDetails: ProfileCustomerDetails | null = null
    sections.contracts = "ok"
    if (isCustomer && customer?.customer) {
      if (!(await hasAdditionalSystemCapability(client, decision, "CONTRACT_READ"))) {
        sections.contracts = "not_permitted"
        serviceType = { state: "restricted" }
        customerDetails = { authorities: { state: "restricted" }, contracts: { state: "restricted" } }
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
        const nameOf = (personId: string): string | null => {
          const found = contacts?.contacts.find((contact) => contact.person.id === personId)
          return found?.current.name ? [found.current.name.givenName, found.current.name.familyName].filter(Boolean).join(" ") || null : null
        }
        const holder = (assignment: { personId: string; effectiveFrom: string } | null): ProfileAuthorityHolder | null =>
          assignment ? { personId: assignment.personId, name: contacts ? nameOf(assignment.personId) : null, since: assignment.effectiveFrom.slice(0, 10) } : null
        const byStatus: Record<string, number> = {}
        for (const contract of view.contracts) byStatus[contract.contractStatus] = (byStatus[contract.contractStatus] ?? 0) + 1
        customerDetails = {
          authorities: {
            state: "ok",
            serviceDecisionAuthority: holder(view.authorities.serviceDecisionAuthority),
            contractSignatory: holder(view.authorities.contractSignatory),
            samePerson: view.authorities.samePerson,
          },
          contracts: { state: "ok", byStatus, signedInForce: signed.length > 0, signedReference: signed[0]?.contractReference ?? null },
        }
      }
    }

    // Previous addresses: genuine real-world moves only (a version that was wrongly recorded and corrected is not a business fact).
    const oneLine = (a: { addressLine1: string; addressLine2: string | null; unit: string | null; locality: string; region: string; postalCode: string | null; country: string }) =>
      [[a.addressLine1, a.addressLine2, a.unit].filter(Boolean).join(", "), a.locality, a.region, a.postalCode, COUNTRY_NAME[a.country] ?? a.country].filter(Boolean).join(", ")
    const addressHistory: ProfileAddressHistoryEntry[] | null = locations
      ? (locations.history ?? [])
          .filter((entry) => entry.assignment.status === "active")
          .flatMap((entry) =>
            entry.versions
              .filter((version) => version.status === "active" && version.effectiveTo !== null)
              .map((version) => ({ role: entry.assignment.role as ProfileAddressHistoryEntry["role"], address: oneLine(version), from: version.effectiveFrom.slice(0, 10), to: version.effectiveTo ? version.effectiveTo.slice(0, 10) : null })),
          )
          .sort((a, b) => (b.to ?? "").localeCompare(a.to ?? ""))
      : null
    const paymentLabel = (code: string) => PAYMENT_METHOD_DEFINITIONS.find((definition) => definition.code === code)?.displayName ?? code
    const paymentMethodHistory: ProfilePaymentHistoryEntry[] | null = isCustomer && customerBundle?.billing
      ? customerBundle.billing.history
          .filter((row) => row.recordStatus === "active" && row.effectiveTo !== null)
          .map((row) => ({ method: paymentLabel(row.value), from: row.effectiveFrom.slice(0, 10), to: row.effectiveTo ? row.effectiveTo.slice(0, 10) : null }))
          .sort((a, b) => (b.to ?? "").localeCompare(a.to ?? ""))
      : null

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
      contactPersonId: primary?.person.id ?? null,
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
      gstHst: registration("GST_HST"),
      gstHstRegistrationId: (registrations?.registrations ?? []).find((view) => view.registration.archivedAt === null && view.registration.program === "GST_HST" && view.current.version)?.registration.id ?? null,
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
      editAccess,
      channelsEverRecorded,
      changeTracking,
      customerDetails,
      addressHistory,
      paymentMethodHistory,
      sections,
      notRecordedYet: [],
    } as CompanyProfileRecord
  })
}
