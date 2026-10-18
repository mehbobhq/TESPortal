import "server-only"

import type { TesSystemCapability } from "@/lib/auth/tes-capabilities"
import type { PoolClient } from "pg"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { domainContext, enterSystemCapability, runDeferredChecks } from "@/lib/company-directory/capability-context"
import {
  addressBlockPresent,
  CompanyCreationValidationError,
  OPERATING_SCOPE_BY_OP_REGION,
  planAddressBlock,
  type CompanyCreationIssue,
  type PlannedAddress,
} from "@/lib/company-directory/creation-input"
import { CompanyCreationCapabilityError } from "@/lib/company-directory/create-company"
import { parseCargoList } from "@/lib/company-directory/creation-input"
import * as contactOperations from "@/lib/contacts/operations"
import { prepareChannel } from "@/lib/contacts/definitions"
import { prepareProviderName, resolveCargoCategory, resolvePaymentMethod } from "@/lib/company-profile/definitions"
import { CompanyProfileConflictError } from "@/lib/company-profile/errors"
import * as profileFacts from "@/lib/company-profile/facts"
import * as profileOperations from "@/lib/company-profile/operations"
import * as customerOperations from "@/lib/customer-relationship/operations"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as locationOperations from "@/lib/organization-locations/operations"

/** Profile facts whose key may be present with an EMPTY value, which means "clear it" (an absent key means "leave it alone"). */
const FACT_KEYS = ["website", "cargoTypes", "eldProvider", "gpsProvider", "fuelProvider", "payMethod"] as const

const UPDATE_KEYS = new Set([
  "opRegion",
  "addressMode",
  "factMode",
  ...FACT_KEYS,
  ...(["reg", "mail", "yard"] as const).flatMap((prefix) => (["street", "city", "state", "zip", "country"] as const).map((part) => `${prefix}_${part}`)),
])

const IDENTITY_EDIT_KEYS = new Set(["companyName", "dba", "incorpNo", "businessNo", "ein"])

export type CompanyDetailsUpdate = {
  /** "change": the address really moved (the old one stays as history). "correct": the old one was recorded wrongly. */
  addressMode: "change" | "correct"
  /** The same distinction for website, cargo, fleet providers and billing preference. */
  factMode: "change" | "correct"
  operatingScope: { changed: boolean; value: string | null }
  addresses: Array<{ role: PlannedAddress["role"]; action: "created" | "changed" | "corrected" | "unchanged" }>
  website: "created" | "changed" | "corrected" | "cleared" | "unchanged" | null
  cargo: profileFacts.FactChangeResult | null
  fleetProviders: Array<{ kind: "ELD" | "GPS" | "FUEL"; result: profileFacts.FactChangeResult }>
  billingPreference: profileFacts.FactChangeResult | null
}

/** What an edit asks for beyond region and addresses. null = the key was absent (untouched). A clear is explicit. */
export type FactsPlan = {
  mode: "change" | "correct"
  website: { value: string } | { clear: true } | null
  cargo: string[] | null
  providers: Array<{ kind: "ELD" | "GPS" | "FUEL"; name: string | null }>
  payment: { code: string } | { clear: true } | null
}

const prefixes = ["reg", "mail", "yard"] as const

/**
 * Edits the details that live in the Operating Profile and Locations domains, in ONE transaction: operating region, and the
 * registered / mailing / yard addresses (each independently). Only submitted fields are touched; an unchanged value is left
 * alone; nothing is ever silently cleared (an address block is all-or-nothing and cannot be blanked here).
 *
 * Every write is the existing domain operation (own validation, own Master Register event). An address that already exists is
 * revised with changeLocationAddress (real move; history kept) or correctLocationAddress (it was wrong), per `addressMode`.
 */
export type DetailsPlan = { mode: "change" | "correct"; scope: string | null; planned: PlannedAddress[]; facts: FactsPlan }

const present = (value: unknown): boolean => value !== undefined && value !== null

export function factsPresent(facts: FactsPlan): boolean {
  return facts.website !== null || facts.cargo !== null || facts.providers.length > 0 || facts.payment !== null
}

/** Customer-only facts: cargo, fleet providers and billing preference. */
export function customerFactsPresent(facts: FactsPlan): boolean {
  return facts.cargo !== null || facts.providers.length > 0 || facts.payment !== null
}

/** Pure validation of the details part of an edit; throws CompanyCreationValidationError listing every problem. */
export function planCompanyDetails(raw: unknown): DetailsPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CompanyCreationValidationError([{ field: "body", message: "A JSON object is required." }])
  const input = raw as Record<string, unknown>
  const issues: CompanyCreationIssue[] = []
  for (const [key, value] of Object.entries(input)) {
    if (!UPDATE_KEYS.has(key) && !IDENTITY_EDIT_KEYS.has(key) && value !== "" && value != null) issues.push({ field: key, message: "This field cannot be edited here and was not saved." })
  }

  const mode = input.addressMode === undefined || input.addressMode === "" ? "change" : input.addressMode
  if (mode !== "change" && mode !== "correct") issues.push({ field: "addressMode", message: "addressMode must be 'change' or 'correct'." })

  let scope: string | null = null
  if (typeof input.opRegion === "string" && input.opRegion.trim() !== "") {
    scope = (OPERATING_SCOPE_BY_OP_REGION as Record<string, string>)[input.opRegion.trim()] ?? null
    if (!scope) issues.push({ field: "opRegion", message: `Unsupported operating region '${input.opRegion}'.` })
  }

  const planned: PlannedAddress[] = []
  for (const prefix of prefixes) {
    if (!addressBlockPresent(input, prefix)) continue
    const result = planAddressBlock(input, prefix)
    if ("field" in result) issues.push(result)
    else planned.push(result)
  }
  // --- profile facts ---------------------------------------------------------------------------------------------------
  const factMode = input.factMode === undefined || input.factMode === "" ? "change" : input.factMode
  if (factMode !== "change" && factMode !== "correct") issues.push({ field: "factMode", message: "factMode must be 'change' or 'correct'." })
  const facts: FactsPlan = { mode: factMode === "correct" ? "correct" : "change", website: null, cargo: null, providers: [], payment: null }

  if (present(input.website)) {
    if (typeof input.website !== "string") issues.push({ field: "website", message: "The website must be text." })
    else if (input.website.trim() === "") facts.website = { clear: true }
    else {
      try {
        prepareChannel("WEBSITE", input.website, undefined, "website")
        facts.website = { value: input.website.trim() }
      } catch (error) {
        issues.push({ field: "website", message: error instanceof Error ? error.message : "Enter a valid website address." })
      }
    }
  }
  if (present(input.cargoTypes)) {
    const list = parseCargoList(input.cargoTypes)
    if (list === "invalid") issues.push({ field: "cargoTypes", message: "Cargo Information must be a list of cargo categories." })
    else {
      const codes: string[] = []
      for (const entry of list) {
        const category = resolveCargoCategory(entry)
        if (!category) issues.push({ field: "cargoTypes", message: `'${String(entry)}' is not a cargo category.` })
        else if (!codes.includes(category.code)) codes.push(category.code)
      }
      facts.cargo = codes
    }
  }
  for (const [field, kind] of [["eldProvider", "ELD"], ["gpsProvider", "GPS"], ["fuelProvider", "FUEL"]] as const) {
    if (!present(input[field])) continue
    if (typeof input[field] !== "string") issues.push({ field, message: "A provider name must be text." })
    else if ((input[field] as string).trim() === "") facts.providers.push({ kind, name: null })
    else {
      try {
        facts.providers.push({ kind, name: prepareProviderName(input[field], field) })
      } catch (error) {
        issues.push({ field, message: error instanceof Error ? error.message : "The provider name is not accepted." })
      }
    }
  }
  if (present(input.payMethod)) {
    if (typeof input.payMethod !== "string") issues.push({ field: "payMethod", message: "The payment method must be text." })
    else if (input.payMethod.trim() === "") facts.payment = { clear: true }
    else {
      const method = resolvePaymentMethod(input.payMethod)
      if (!method) issues.push({ field: "payMethod", message: `'${input.payMethod.trim()}' is not a billing payment method.` })
      else facts.payment = { code: method.code }
    }
  }

  if (issues.length > 0) throw new CompanyCreationValidationError(issues)
  return { mode: mode as "change" | "correct", scope, planned, facts }
}

export function hasDetailsToUpdate(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false
  return Object.entries(raw as Record<string, unknown>).some(([key, value]) => UPDATE_KEYS.has(key) && key !== "addressMode" && typeof value === "string" && value.trim() !== "")
}

export type CompanyDetailsPlan = ReturnType<typeof planCompanyDetails>

export async function updateCompanyDetails(organizationId: string, raw: unknown): Promise<CompanyDetailsUpdate> {
  const plan = planCompanyDetails(raw)
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => applyCompanyDetails(client, decision, organizationId, plan))
}

/**
 * The details writes on a transaction the caller already opened (ORGANIZATION_UPDATE), so a whole edit - identity and details -
 * can commit or roll back as one unit (see editCompany). Every capability is still proven per fact before anything is written.
 */
export async function applyCompanyDetails(client: PoolClient, decision: SystemAuthorizationDecision, organizationId: string, plan: CompanyDetailsPlan): Promise<CompanyDetailsUpdate> {
  const { mode, scope, planned, facts } = plan
  {
    const required = new Set<TesSystemCapability>()
    if (scope) required.add("COMPANY_PROFILE_MANAGE")
    if (planned.some((p) => p.role !== "REGISTERED")) required.add("CUSTOMER_RELATIONSHIP_READ")
    if (facts.website) required.add("CONTACT_MANAGE")
    if (facts.cargo !== null || facts.providers.length > 0) required.add("COMPANY_PROFILE_MANAGE")
    if (facts.payment) required.add("CUSTOMER_RELATIONSHIP_MANAGE")
    if (customerFactsPresent(facts)) required.add("CUSTOMER_RELATIONSHIP_READ")
    const missing: TesSystemCapability[] = []
    for (const capability of required) if (!(await hasAdditionalSystemCapability(client, decision, capability))) missing.push(capability)
    if (missing.length > 0) throw new CompanyCreationCapabilityError(missing)

    const result: CompanyDetailsUpdate = {
      addressMode: mode,
      factMode: facts.mode,
      operatingScope: { changed: false, value: scope },
      addresses: [],
      website: null,
      cargo: null,
      fleetProviders: [],
      billingPreference: null,
    }
    const actor = { id: decision.actor.id, actorType: decision.actor.actorType }

    if (planned.some((p) => p.role !== "REGISTERED") || customerFactsPresent(facts)) {
      await enterSystemCapability(client, "CUSTOMER_RELATIONSHIP_READ")
      const relationship = await customerOperations.readCustomerRelationship(client, organizationId)
      if (!relationship.customer) {
        const issues: CompanyCreationIssue[] = []
        if (planned.some((p) => p.role !== "REGISTERED")) issues.push({ field: "mail_street", message: "Mailing and yard addresses apply to Customer records only." })
        if (facts.cargo !== null) issues.push({ field: "cargoTypes", message: "Cargo Information applies to Customer records only." })
        for (const provider of facts.providers) issues.push({ field: provider.kind === "ELD" ? "eldProvider" : provider.kind === "GPS" ? "gpsProvider" : "fuelProvider", message: "Fleet providers apply to Customer records only." })
        if (facts.payment) issues.push({ field: "payMethod", message: "A billing payment method applies to Customer records only." })
        throw new CompanyCreationValidationError(issues)
      }
    }

    if (scope) {
      await enterSystemCapability(client, "COMPANY_PROFILE_MANAGE")
      try {
        await profileOperations.setOperatingScope({ client, actor, masterRegister: new PostgresMasterRegisterRepository(client) }, { organizationId, operatingScope: scope })
        result.operatingScope.changed = true
      } catch (error) {
        if (!(error instanceof CompanyProfileConflictError)) throw error
      }
      await runDeferredChecks(client)
    }

    // Website: an Organization channel (any company type).
    if (facts.website) {
      await enterSystemCapability(client, "CONTACT_MANAGE")
      const contactContext = domainContext(client, decision, "PERSON_REGISTRY_READ")
      const contacts = await contactOperations.readOrganizationContacts(client, organizationId)
      const current = contacts.currentChannels.find((channel) => channel.channelType === "WEBSITE" && channel.usage === "GENERAL" && channel.recordStatus === "active")
      if ("clear" in facts.website) {
        if (!current) result.website = "unchanged"
        else {
          if (facts.mode === "correct") await contactOperations.voidOrganizationChannel(contactContext, { organizationId, channelId: current.id })
          else await contactOperations.endOrganizationChannel(contactContext, { organizationId, channelId: current.id })
          result.website = "cleared"
        }
      } else if (!current) {
        await contactOperations.addOrganizationChannel(contactContext, { organizationId, channel: { type: "WEBSITE", value: facts.website.value, usage: "GENERAL" } })
        result.website = "created"
      } else {
        const next = prepareChannel("WEBSITE", facts.website.value, undefined, "website")
        if (next.normalized === current.valueNormalized && next.display === current.valueDisplay) result.website = "unchanged"
        else {
          const args = { organizationId, channelId: current.id, value: facts.website.value }
          if (facts.mode === "correct") await contactOperations.correctOrganizationChannel(contactContext, args)
          else await contactOperations.changeOrganizationChannel(contactContext, args)
          result.website = facts.mode === "correct" ? "corrected" : "changed"
        }
      }
      await runDeferredChecks(client)
    }

    // Cargo categories and fleet provider names: the company operating profile.
    if (facts.cargo !== null || facts.providers.length > 0) {
      await enterSystemCapability(client, "COMPANY_PROFILE_MANAGE")
      const factsContext = { client, actor, masterRegister: new PostgresMasterRegisterRepository(client) }
      if (facts.cargo !== null) {
        if (facts.cargo.length === 0) {
          const existing = await profileFacts.readCompanyFacts(client, organizationId)
          if (existing.cargo.length > 0) throw new CompanyCreationValidationError([{ field: "cargoTypes", message: "Cargo Information is required for a Customer; choose at least one category." }])
        }
        result.cargo = await profileFacts.setCargoCategories(factsContext, { organizationId, categories: facts.cargo, mode: facts.mode })
      }
      for (const provider of facts.providers) {
        result.fleetProviders.push({ kind: provider.kind, result: await profileFacts.setFleetProvider(factsContext, { organizationId, kind: provider.kind, providerName: provider.name, mode: facts.mode }) })
      }
      await runDeferredChecks(client)
    }

    // The Customer's billing preference.
    if (facts.payment) {
      await enterSystemCapability(client, "CUSTOMER_RELATIONSHIP_MANAGE")
      result.billingPreference = await profileFacts.setBillingPreference(
        { client, actor, masterRegister: new PostgresMasterRegisterRepository(client) },
        { organizationId, paymentMethod: "clear" in facts.payment ? null : facts.payment.code, mode: facts.mode },
      )
      await runDeferredChecks(client)
    }

    if (planned.length > 0) {
      await enterSystemCapability(client, "ORGANIZATION_UPDATE")
      const ctx = domainContext(client, decision, "ORGANIZATION_REGISTRY_READ")
      const view = await locationOperations.readOrganizationLocations(client, organizationId)
      for (const next of planned) {
        const existing = view.current[next.role]
        if (!existing) {
          await locationOperations.createLocation(ctx, { kind: "PHYSICAL", address: next.address, assignment: { organizationId, role: next.role } })
          result.addresses.push({ role: next.role, action: "created" })
          continue
        }
        const now = existing.address
        const same =
          now !== null &&
          now.country === next.address.country &&
          now.region === next.address.region &&
          now.locality.trim().toLowerCase() === next.address.locality.trim().toLowerCase() &&
          (now.postalCode ?? "").replace(/\s+/g, "").toUpperCase() === (next.address.postalCode ?? "").replace(/\s+/g, "").toUpperCase() &&
          [now.addressLine1, now.addressLine2, now.unit].filter(Boolean).join(", ").trim().toLowerCase() === next.address.addressLine1.trim().toLowerCase()
        if (same) {
          result.addresses.push({ role: next.role, action: "unchanged" })
          continue
        }
        const args = { organizationId, locationId: existing.location.id, address: next.address }
        if (mode === "correct") await locationOperations.correctLocationAddress(ctx, args)
        else await locationOperations.changeLocationAddress(ctx, args)
        result.addresses.push({ role: next.role, action: mode === "correct" ? "corrected" : "changed" })
      }
      await runDeferredChecks(client)
    }
    return result
  }
}
