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
import * as corporateOperations from "@/lib/corporate-identity/operations"
import * as customerOperations from "@/lib/customer-relationship/operations"
import * as taxOperations from "@/lib/tax-registrations/operations"
import { prepareRegistrationNumber } from "@/lib/tax-registrations/definitions"
import { RegistrationValidationError } from "@/lib/tax-registrations/errors"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import { appendChange, type PlannedChange } from "@/lib/company-changes/ledger"
import { channelOperation, type ChannelKind } from "@/lib/company-changes/definitions"
import { recordChannelChangeRequest } from "@/lib/company-changes/service"
import { migration0036Message, migration0036State } from "@/lib/company-changes/schema-state"
import { CompanyChangeStateError } from "@/lib/company-changes/errors"
import * as locationOperations from "@/lib/organization-locations/operations"

/** Profile facts whose key may be present with an EMPTY value, which means "clear it" (an absent key means "leave it alone"). */
const FACT_KEYS = ["website", "cargoTypes", "eldProvider", "gpsProvider", "fuelProvider", "payMethod"] as const

/** Company-level channels edited here besides the website: each maps to ONE company channel (never a person's). */
const CHANNEL_FIELDS = [
  { key: "phone", kind: "PHONE", usage: "GENERAL" },
  { key: "email", kind: "EMAIL", usage: "GENERAL" },
  { key: "billingEmail", kind: "EMAIL", usage: "ACCOUNTING" },
] as const

/** How a replacement of an established channel was requested (recorded on the request; required only when a replacement actually happens). */
const CHANNEL_META_KEYS = ["channelChangeSource", "channelChangeReference", "channelChangeSender"] as const

const UPDATE_KEYS = new Set<string>([
  "opRegion",
  "addressMode",
  "factMode",
  "gstHst",
  ...FACT_KEYS,
  ...CHANNEL_FIELDS.map((field) => field.key),
  ...CHANNEL_META_KEYS,
  ...(["reg", "mail", "yard"] as const).flatMap((prefix) => (["street", "city", "state", "zip", "country"] as const).map((part) => `${prefix}_${part}`)),
])

const IDENTITY_EDIT_KEYS = new Set(["companyName", "dba", "dbaBasis", "dbaBasisReference", "dbaEvidenceDocumentId", "incorpNo", "businessNo", "ein"])

export type CompanyDetailsUpdate = {
  /** "change": the address really moved (the old one stays as history). "correct": the old one was recorded wrongly. */
  addressMode: "change" | "correct"
  /** The same distinction for website, cargo, fleet providers and billing preference. */
  factMode: "change" | "correct"
  operatingScope: { changed: boolean; value: string | null }
  addresses: Array<{ role: PlannedAddress["role"]; action: "created" | "changed" | "corrected" | "unchanged" }>
  website: "created" | "changed" | "corrected" | "cleared" | "unchanged" | "pending_confirmation" | null
  /** Company phone / account email / billing email. "pending_confirmation": a DIFFERENT value was asked for; the established one stays in use until it is confirmed. */
  channels: Array<{ field: string; kind: ChannelKind; usage: string; action: "created" | "changed" | "cleared" | "unchanged" | "pending_confirmation" }>
  cargo: profileFacts.FactChangeResult | null
  fleetProviders: Array<{ kind: "ELD" | "GPS" | "FUEL"; result: profileFacts.FactChangeResult }>
  billingPreference: profileFacts.FactChangeResult | null
  /** The GST/HST program account (tax registration). "replaced" = the earlier account was archived (history kept) and a new one recorded. */
  gstHst: "created" | "corrected" | "replaced" | "archived" | "unchanged" | null
}

/** What an edit asks for beyond region and addresses. null = the key was absent (untouched). A clear is explicit. */
export type FactsPlan = {
  mode: "change" | "correct"
  website: { value: string } | { clear: true } | null
  cargo: string[] | null
  providers: Array<{ kind: "ELD" | "GPS" | "FUEL"; name: string | null }>
  payment: { code: string } | { clear: true } | null
  /** The GST/HST program account: a format-checked number, an explicit clear (the registration record is archived), or untouched. */
  gstHst: { value: string } | { clear: true } | null
  /** Company phone / account email / billing email: a prepared value, an explicit clear (null), or untouched (absent). */
  channels: Array<{ field: string; kind: "PHONE" | "EMAIL"; usage: "GENERAL" | "ACCOUNTING"; value: string | null }>
  /** How a replacement was requested; checked only if a replacement actually happens. */
  channelRequest: { source: string; reference: string; sender: string | null }
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
  return facts.website !== null || facts.cargo !== null || facts.providers.length > 0 || facts.payment !== null || facts.gstHst !== null || facts.channels.length > 0
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
  const facts: FactsPlan = {
    mode: factMode === "correct" ? "correct" : "change",
    website: null, cargo: null, providers: [], payment: null, gstHst: null, channels: [],
    channelRequest: { source: String(input.channelChangeSource ?? "").trim(), reference: String(input.channelChangeReference ?? "").trim(), sender: String(input.channelChangeSender ?? "").trim() || null },
  }
  for (const field of CHANNEL_FIELDS) {
    if (!present(input[field.key])) continue
    const raw = input[field.key]
    if (typeof raw !== "string") issues.push({ field: field.key, message: "This value must be text." })
    else if (raw.trim() === "") facts.channels.push({ field: field.key, kind: field.kind, usage: field.usage, value: null })
    else {
      try {
        prepareChannel(field.kind, raw, undefined, field.key)
        facts.channels.push({ field: field.key, kind: field.kind, usage: field.usage, value: raw.trim() })
      } catch (error) {
        issues.push({ field: field.key, message: error instanceof Error ? error.message : "Enter a valid value." })
      }
    }
  }

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

  if (present(input.gstHst)) {
    if (typeof input.gstHst !== "string") issues.push({ field: "gstHst", message: "The GST/HST account must be text." })
    else if (input.gstHst.trim() === "") facts.gstHst = { clear: true }
    else {
      try {
        prepareRegistrationNumber("GST_HST", input.gstHst, "gstHst")
        facts.gstHst = { value: input.gstHst.trim() }
      } catch (error) {
        issues.push({ field: "gstHst", message: error instanceof RegistrationValidationError ? error.message : "Enter a valid GST/HST account (for example 123456789 RT 0001)." })
      }
    }
  }

  if (issues.length > 0) throw new CompanyCreationValidationError(issues)
  return { mode: mode as "change" | "correct", scope, planned, facts }
}

export function hasDetailsToUpdate(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false
  return Object.entries(raw as Record<string, unknown>).some(
    ([key, value]) => UPDATE_KEYS.has(key) && key !== "addressMode" && !(CHANNEL_META_KEYS as readonly string[]).includes(key) && typeof value === "string" && value.trim() !== "",
  )
}

export type CompanyDetailsPlan = ReturnType<typeof planCompanyDetails>

export async function updateCompanyDetails(organizationId: string, raw: unknown): Promise<CompanyDetailsUpdate> {
  const plan = planCompanyDetails(raw)
  return withAuthorizedSystem("ORGANIZATION_UPDATE", async (client, decision) => {
    const changes: PlannedChange[] = []
    const result = await applyCompanyDetails(client, decision, organizationId, plan, changes)
    await writeLedger(client, decision, organizationId, changes)
    return result
  })
}

/** Writes the business-operation ledger for what an edit actually changed (one row per change, previous value kept), on the same transaction. */
export async function writeLedger(client: PoolClient, decision: SystemAuthorizationDecision, organizationId: string, changes: PlannedChange[]): Promise<void> {
  if (changes.length === 0) return
  // Migration 0036 not applied yet: the edit still works and every change is still recorded in the Master Register by its own domain; only the
  // business-level ledger is unavailable. A PARTLY applied 0036 fails closed: the whole edit rolls back (nothing is saved unrecorded).
  const tracking = await migration0036State(client)
  if (tracking === "ABSENT") return
  if (tracking === "INCONSISTENT") throw new CompanyChangeStateError(migration0036Message(tracking, "Recording company changes"))
  await enterSystemCapability(client, "ORGANIZATION_UPDATE")
  for (const change of changes) await appendChange(client, { source: "STAFF_ENTRY", ...change, organizationId, actorId: decision.actor.id })
}

/** True when this company has ever had a (non-voided) value for this channel: a later value is then a replacement, not a first value. */
async function hadEstablishedChannel(client: PoolClient, organizationId: string, kind: ChannelKind, usage: string): Promise<boolean> {
  const result = await client.query<{ established: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM public.organization_channels WHERE organization_id = $1 AND channel_type = $2 AND channel_usage = $3 AND record_status <> 'voided') AS established`,
    [organizationId, kind, usage],
  )
  return result.rows[0]?.established === true
}

const oneLine = (a: { addressLine1: string; addressLine2?: string | null; unit?: string | null; locality: string; region: string; postalCode?: string | null; country: string } | null | undefined): string =>
  a ? [[a.addressLine1, a.addressLine2, a.unit].filter(Boolean).join(", "), a.locality, a.region, a.postalCode, a.country].filter(Boolean).join(", ") : ""

/**
 * The details writes on a transaction the caller already opened (ORGANIZATION_UPDATE), so a whole edit - identity and details -
 * can commit or roll back as one unit (see editCompany). Every capability is still proven per fact before anything is written.
 */
export async function applyCompanyDetails(client: PoolClient, decision: SystemAuthorizationDecision, organizationId: string, plan: CompanyDetailsPlan, changes: PlannedChange[] = []): Promise<CompanyDetailsUpdate> {
  const { mode, scope, planned, facts } = plan
  {
    const required = new Set<TesSystemCapability>()
    if (scope) required.add("COMPANY_PROFILE_MANAGE")
    if (planned.some((p) => p.role !== "REGISTERED")) required.add("CUSTOMER_RELATIONSHIP_READ")
    if (facts.website || facts.channels.length > 0) required.add("CONTACT_MANAGE")
    if (facts.cargo !== null || facts.providers.length > 0) required.add("COMPANY_PROFILE_MANAGE")
    if (facts.payment) required.add("CUSTOMER_RELATIONSHIP_MANAGE")
    if (facts.gstHst) {
      required.add("TAX_REGISTRATION_MANAGE")
      required.add("TAX_REGISTRATION_READ")
    }
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
      channels: [],
      cargo: null,
      fleetProviders: [],
      billingPreference: null,
      gstHst: null,
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
        changes.push({ operation: "OPERATING_REGION_UPDATED", summary: "Operating region updated", next: scope })
      } catch (error) {
        // The ONLY tolerated outcome: the company already has exactly this scope (nothing to change, so nothing is recorded). Anything else fails the edit.
        if (!(error instanceof CompanyProfileConflictError) || !/already has that operating scope/i.test(error.message)) throw error
      }
      await runDeferredChecks(client)
    }

    // Website and the other company channels: Organization channels (any company type). Setting a channel that has no established value is
    // recorded directly. REPLACING an established value with a DIFFERENT one never takes effect here: it becomes a request that must be
    // confirmed through an established channel (see lib/company-changes), so an unfamiliar value is never trusted on the strength of the edit
    // alone. Removing an established value is a request too (it ends the value only after the same confirmation). A website change never touches an email, and no company channel is ever a person's.
    if (facts.website || facts.channels.length > 0) {
      await enterSystemCapability(client, "CONTACT_MANAGE")
      const contactContext = domainContext(client, decision, "PERSON_REGISTRY_READ")
      const contacts = await contactOperations.readOrganizationContacts(client, organizationId)
      type Wanted = { field: string; kind: ChannelKind; usage: string; value: string | null }
      const wanted: Wanted[] = [
        ...(facts.website ? [{ field: "website", kind: "WEBSITE" as ChannelKind, usage: "GENERAL", value: "clear" in facts.website ? null : facts.website.value }] : []),
        ...facts.channels,
      ]
      for (const item of wanted) {
        const current = contacts.currentChannels.find((channel) => channel.channelType === item.kind && channel.usage === item.usage && channel.recordStatus === "active")
        const report = (action: CompanyDetailsUpdate["channels"][number]["action"]) => {
          if (item.field === "website") result.website = action
          else result.channels.push({ field: item.field, kind: item.kind, usage: item.usage, action })
        }
        if (item.value === null) {
          if (!current) report("unchanged")
          else {
            // REMOVING an established value is a sensitive change too: it never takes effect here. It becomes a request that is applied only after
            // confirmation with verified evidence through an established channel by a different TES user (lib/company-changes). There is no
            // "correction" shortcut that voids an established channel directly.
            const tracking = await migration0036State(client)
            if (tracking !== "COMPLETE") {
              throw new CompanyCreationValidationError([{ field: item.field, message: `${migration0036Message(tracking, "Removing an established company phone, email or website")} The current value stays in use.` }])
            }
            const meta = facts.channelRequest
            if (!meta.source || !meta.reference) {
              throw new CompanyCreationValidationError([{ field: item.field, message: "Removing an established company phone, email or website needs how the change was requested (source and reference); it then waits for confirmation." }])
            }
            await enterSystemCapability(client, "ORGANIZATION_UPDATE")
            await recordChannelChangeRequest(client, decision, {
              organizationId, kind: item.kind, usage: item.usage, changeKind: "REMOVE", previousChannelId: current.id, previousValue: current.valueDisplay, requestedValue: null,
              source: meta.source, reference: meta.reference, senderAddress: meta.sender,
            })
            await enterSystemCapability(client, "CONTACT_MANAGE")
            report("pending_confirmation")
          }
        } else if (!current && !(await hadEstablishedChannel(client, organizationId, item.kind, item.usage))) {
          // The first value this company has ever had for this channel: recorded directly.
          await contactOperations.addOrganizationChannel(contactContext, { organizationId, channel: { type: item.kind, value: item.value, usage: item.usage } })
          report("created")
          changes.push({ operation: channelOperation(item.kind, "added"), summary: `Company ${item.kind.toLowerCase()} recorded`, next: item.value })
        } else {
          // REPLACING an established value, or setting a new one after the established value was removed (otherwise "remove, then add" would
          // bypass the confirmation): never takes effect here, it becomes a request confirmed through a channel that was already established.
          const next = prepareChannel(item.kind, item.value, undefined, item.field)
          if (current && next.normalized === current.valueNormalized && next.display === current.valueDisplay) report("unchanged")
          else {
            const tracking = await migration0036State(client)
            if (tracking !== "COMPLETE") {
              throw new CompanyCreationValidationError([{ field: item.field, message: `${migration0036Message(tracking, "Replacing an established company phone, email or website")} The current value stays in use.` }])
            }
            const meta = facts.channelRequest
            if (!meta.source || !meta.reference) {
              throw new CompanyCreationValidationError([{ field: item.field, message: "Replacing an established company phone, email or website needs how the change was requested (source and reference); it then waits for confirmation." }])
            }
            await enterSystemCapability(client, "ORGANIZATION_UPDATE")
            await recordChannelChangeRequest(client, decision, {
              organizationId, kind: item.kind, usage: item.usage, previousChannelId: current?.id ?? null, previousValue: current?.valueDisplay ?? null, requestedValue: item.value,
              source: meta.source, reference: meta.reference, senderAddress: meta.sender,
            })
            await enterSystemCapability(client, "CONTACT_MANAGE")
            report("pending_confirmation")
          }
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
        if (result.cargo.changed) changes.push({ operation: "BUSINESS_DETAILS_UPDATED", summary: "Cargo information updated (previous categories kept in history)" })
      }
      for (const provider of facts.providers) {
        const outcome = await profileFacts.setFleetProvider(factsContext, { organizationId, kind: provider.kind, providerName: provider.name, mode: facts.mode })
        result.fleetProviders.push({ kind: provider.kind, result: outcome })
        if (outcome.changed) changes.push({ operation: "BUSINESS_DETAILS_UPDATED", summary: `${provider.kind} provider ${provider.name ? "updated" : "cleared"}`, next: provider.name })
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
      if (result.billingPreference.changed) changes.push({ operation: "PAYMENT_METHOD_UPDATED", summary: "Preferred payment method updated (previous method kept in history)", next: "clear" in facts.payment ? null : facts.payment.code })
      await runDeferredChecks(client)
    }

    // The GST/HST program account: a tax registration (program GST_HST), never a free-text field of the company.
    if (facts.gstHst) {
      await enterSystemCapability(client, "ORGANIZATION_REGISTRY_READ")
      const organization = await corporateOperations.readOrganization(client, organizationId)
      await enterSystemCapability(client, "TAX_REGISTRATION_MANAGE")
      const taxContext = domainContext(client, decision, "TAX_REGISTRATION_READ")
      const view = await taxOperations.readOrganizationRegistrations(client, organizationId)
      const existing = view.registrations.find((entry) => entry.registration.archivedAt === null && entry.registration.program === "GST_HST" && entry.current.version)
      if ("clear" in facts.gstHst) {
        if (!existing) result.gstHst = "unchanged"
        else {
          await taxOperations.archiveRegistration(taxContext, { organizationId, registrationId: existing.registration.id })
          result.gstHst = "archived"
        }
      } else {
        const account = prepareRegistrationNumber("GST_HST", facts.gstHst.value, "gstHst")
        // The first nine digits of the account ARE the Business Number; a different Business Number on the record is a contradiction.
        const bn = (organization.identifiers.find((identifier) => identifier.status === "active" && identifier.kind === "CRA_BN")?.value ?? "").replace(/\D/g, "")
        if (bn.length === 9 && !account.normalized.startsWith(bn)) {
          throw new CompanyCreationValidationError([{ field: "gstHst", message: "The GST/HST account must begin with this company's Business Number." }])
        }
        if (!existing) {
          await taxOperations.createRegistration(taxContext, { organizationId, program: "GST_HST", number: facts.gstHst.value })
          result.gstHst = "created"
        } else if (existing.current.version!.numberNormalized === account.normalized) {
          result.gstHst = "unchanged"
        } else if (facts.mode === "correct") {
          await taxOperations.correctRegistrationVersion(taxContext, { organizationId, registrationId: existing.registration.id, number: facts.gstHst.value })
          result.gstHst = "corrected"
        } else {
          // A different GST/HST account is a different registration (the number identifies it): the earlier one is archived, not rewritten.
          await taxOperations.archiveRegistration(taxContext, { organizationId, registrationId: existing.registration.id })
          await taxOperations.createRegistration(taxContext, { organizationId, program: "GST_HST", number: facts.gstHst.value })
          result.gstHst = "replaced"
        }
      }
      if (result.gstHst && result.gstHst !== "unchanged") changes.push({ operation: "BUSINESS_DETAILS_UPDATED", summary: `GST/HST account ${result.gstHst}`, next: "clear" in facts.gstHst ? null : facts.gstHst.value })
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
          changes.push({ operation: "ADDRESS_UPDATED", summary: `${next.role.toLowerCase()} address recorded`, next: oneLine(next.address) })
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
        changes.push({ operation: "ADDRESS_UPDATED", summary: `${next.role.toLowerCase()} address ${mode === "correct" ? "corrected" : "changed"} (previous address kept in history)`, previous: oneLine(now), next: oneLine(next.address) })
      }
      await runDeferredChecks(client)
    }
    return result
  }
}
