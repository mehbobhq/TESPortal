/**
 * Canonical adapter for the restored Insurance workspace.
 *
 * Hydrates an in-memory model from the canonical API (policies, terms, coverages, broker periods; the company directory; the
 * contacts of each brokerage) and implements every original callback by calling the canonical API. Nothing is written to the
 * browser: after every change the model is re-read from PostgreSQL, so what the page shows is what is stored.
 *
 * Mapping of the original controls (see docs/recovery/matrix/insurance.md):
 *   Save (new)        POST   insurance                          createPolicy (+ first broker period)
 *   Edit              PATCH  insurance/[policyId] action edit   CORRECTION = correctCoverage / correctTerm / correctBroker
 *                                                               ENDORSEMENT = addEndorsement (COVERAGE_CHANGED) / changeBroker
 *   Renew             PATCH  action renew                       renewPolicy (a new TERM of the same policy), or - when the
 *                     POST   with renewsPolicyId                insurer changes - a NEW policy that renews the old one
 *   Archive / Restore PATCH  action archive | restore           archivePolicy (reason kept in the Master Register event) / restorePolicy
 *   Edit Broker       PATCH  action edit { broker }             changeBroker (real change) or correctBroker (mistake)
 * A field with no canonical home is refused with CanonicalOperationUnavailableError, never dropped.
 */

import { useCallback, useEffect, useState } from "react"
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import type { OrganizationInsuranceView } from "@/lib/insurance/types"
import { buildModel, BOND_TYPE_OPTIONS, EMPTY_MODEL, TRANSPORTATION_TYPE_OPTIONS, type BondEntry, type BrokerContactInfo, type DirectoryOrganization, type InsuranceModel, type TransportationRecord, type WorkersRecord } from "./model"

export type OrgKind = "Insurance Company" | "Insurance Broker" | "Workers Insurance" | "Surety Company"

/** The company record types the canonical company creation accepts (there is no separate surety type: it is created as "Other"). */
const COMPANY_TYPE: Record<OrgKind, string> = {
  "Insurance Company": "Insurance Company",
  "Insurance Broker": "Insurance Broker",
  "Workers Insurance": "Workers Insurance",
  "Surety Company": "Other",
}

export type ResolvedOrganization = { id: string; name: string }
/** Resolves a typed organization name to a canonical organization (reuse / fuzzy choice / confirmed creation); null = the operator cancelled. */
export type OrganizationResolver = (name: string, kind: OrgKind) => Promise<ResolvedOrganization | null>

export type BrokerForm = { org: string; agent: string; phone: string; email: string }
export type SaveResult = { saved: boolean; notices: string[] }

const unavailable = (action: string, reason: string) => new CanonicalOperationUnavailableError(action, reason)

// --- transport ----------------------------------------------------------------------------------------------------------

async function call<T>(method: "GET" | "POST" | "PATCH", url: string, body?: unknown, fallback = "The change could not be saved."): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; issues?: Array<{ field: string; message: string }> }) | null
  if (!response.ok) {
    const detail = payload?.issues?.map((issue) => issue.message).join(" ")
    throw new Error(detail || payload?.error || fallback)
  }
  return payload as T
}

const base = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}`

// --- reads --------------------------------------------------------------------------------------------------------------

type ContactsPayload = {
  contacts: Array<{ person: { id: string }; current: { name: { givenName: string | null; familyName: string | null } | null; channels: Array<{ channelType: string; valueDisplay: string }> } }>
}

function contactInfo(payload: ContactsPayload): BrokerContactInfo[] {
  return (payload.contacts ?? []).map((entry) => {
    const name = entry.current.name
    const channels = entry.current.channels ?? []
    return {
      personId: entry.person.id,
      name: [name?.givenName, name?.familyName].filter(Boolean).join(" "),
      phone: channels.find((channel) => channel.channelType === "PHONE")?.valueDisplay,
      email: channels.find((channel) => channel.channelType === "EMAIL")?.valueDisplay,
    }
  })
}

async function readContacts(organizationId: string): Promise<BrokerContactInfo[]> {
  return contactInfo(await call<ContactsPayload>("GET", `${base(organizationId)}/contacts`, undefined, "Unable to load contacts."))
}

export async function readDirectory(): Promise<DirectoryOrganization[]> {
  const payload = await call<{ companies: DirectoryOrganization[] }>("GET", "/api/companies", undefined, "Unable to load the company directory.")
  return payload.companies ?? []
}

export async function loadModel(companyId: string, companyName: string): Promise<{ model: InsuranceModel; directory: DirectoryOrganization[]; directoryError: string | null }> {
  const [view, directoryResult] = await Promise.all([
    call<OrganizationInsuranceView>("GET", `${base(companyId)}/insurance`, undefined, "Unable to load insurance."),
    readDirectory().then(
      (directory) => ({ directory, error: null as string | null }),
      (error: unknown) => ({ directory: [] as DirectoryOrganization[], error: error instanceof Error ? error.message : "Unable to load the company directory." }),
    ),
  ])
  // The contacts of each brokerage that has a named agent on a current broker period.
  const brokerOrganizations = new Set<string>()
  for (const policy of view.policies) {
    const broker = policy.current.broker
    if (broker?.brokerPersonId) brokerOrganizations.add(broker.brokerOrganizationId)
  }
  const contacts: BrokerContactInfo[] = []
  await Promise.all(
    [...brokerOrganizations].map(async (organizationId) => {
      try {
        contacts.push(...(await readContacts(organizationId)))
      } catch {
        // The agent's name / phone / email then show as not available; the brokerage itself still shows.
      }
    }),
  )
  return { model: buildModel(view, directoryResult.directory, contacts, companyName), directory: directoryResult.directory, directoryError: directoryResult.error }
}

export function useCanonicalInsurance(companyId: string, companyName: string) {
  const [model, setModel] = useState<InsuranceModel>(EMPTY_MODEL)
  const [directory, setDirectory] = useState<DirectoryOrganization[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [directoryError, setDirectoryError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const loaded = await loadModel(companyId, companyName)
      setModel(loaded.model)
      setDirectory(loaded.directory)
      setDirectoryError(loaded.directoryError)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load insurance.")
    } finally {
      setLoading(false)
    }
  }, [companyId, companyName])

  useEffect(() => {
    void reload()
  }, [reload])

  return { model, directory, loading, loadError, directoryError, reload }
}

// --- organization + broker-agent resolution (existing approved operations only) ------------------------------------------

const key = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  let previous = Array.from({ length: a.length + 1 }, (_, index) => index)
  for (let j = 1; j <= b.length; j++) {
    const current = [j]
    for (let i = 1; i <= a.length; i++) current[i] = Math.min(previous[i] + 1, current[i - 1] + 1, previous[i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[a.length]
}

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  return (Math.max(a.length, b.length) - levenshtein(a, b)) / Math.max(a.length, b.length)
}

/** CASE A exact (normalized) name: reuse. CASE B similarity >= 0.75: the operator chooses. CASE C none: explicit confirmation. */
export function classifyOrganizationMatch(input: string, candidates: DirectoryOrganization[]): { mode: "EXACT"; match: DirectoryOrganization } | { mode: "FUZZY_CANDIDATES"; candidates: DirectoryOrganization[] } | { mode: "NEW_CONFIRMATION" } {
  const target = key(input)
  const exact = candidates.find((entry) => key(entry.name) === target)
  if (exact) return { mode: "EXACT", match: exact }
  const similar = candidates
    .map((entry) => ({ entry, score: similarity(target, key(entry.name)) }))
    .filter((item) => item.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.entry)
  return similar.length > 0 ? { mode: "FUZZY_CANDIDATES", candidates: similar } : { mode: "NEW_CONFIRMATION" }
}

/**
 * Creates a company record through the existing company creation operation (POST /api/companies: its own validation, capability
 * check and Master Register events). Only the name and the record type are sent; nothing else is invented. If the actor lacks the
 * capability the operation refuses and the message is shown; nothing is created.
 */
export async function createOrganization(name: string, kind: OrgKind): Promise<ResolvedOrganization> {
  const created = await call<{ company: { id: string; name: string } }>("POST", "/api/companies", { companyName: name, companyType: COMPANY_TYPE[kind] }, "The organization could not be created.")
  return { id: created.company.id, name: created.company.name }
}

const digits = (value: string) => value.replace(/\D/g, "")

/**
 * The broker agent is a person at the brokerage (Contacts domain). An existing contact of that brokerage is matched by email, then
 * phone, then name; otherwise the agent is created through the existing createContact operation (which creates the person and
 * its active relationship with the brokerage). A phone / email typed for a matched contact is NOT added to it (Contacts owns that).
 */
export async function resolveBrokerAgent(brokerageId: string, form: Pick<BrokerForm, "agent" | "phone" | "email">, known?: { personId?: string | null; name?: string }): Promise<{ personId: string | null; notices: string[] }> {
  const name = form.agent.trim()
  const phone = form.phone.trim()
  const email = form.email.trim()
  if (!name && !phone && !email) return { personId: null, notices: [] }
  if (!name) throw new Error("A broker agent name is required to record an agent phone or email.")
  if (known?.personId && known.name && key(known.name) === key(name)) return { personId: known.personId, notices: [] }

  const contacts = await readContacts(brokerageId)
  const byEmail = email ? contacts.find((entry) => entry.email && key(entry.email) === key(email)) : undefined
  const byPhone = !byEmail && digits(phone).length >= 7 ? contacts.find((entry) => entry.phone && digits(entry.phone).slice(-10) === digits(phone).slice(-10)) : undefined
  const byName = !byEmail && !byPhone ? contacts.find((entry) => key(entry.name) === key(name)) : undefined
  const matched = byEmail ?? byPhone ?? byName
  if (matched) {
    const notices: string[] = []
    if (email && !(matched.email && key(matched.email) === key(email))) notices.push(`The email you typed was not added to ${matched.name}; manage contact channels under Contacts.`)
    if (phone && !(matched.phone && digits(matched.phone).slice(-10) === digits(phone).slice(-10))) notices.push(`The phone you typed was not added to ${matched.name}; manage contact channels under Contacts.`)
    return { personId: matched.personId, notices }
  }
  const parts = name.split(/\s+/)
  const created = await call<{ contact: { person: { id: string } } }>(
    "POST",
    `${base(brokerageId)}/contacts`,
    {
      action: "createContact",
      name: { givenName: parts[0], ...(parts.length > 1 ? { familyName: parts.slice(1).join(" ") } : {}) },
      channels: [...(email ? [{ type: "EMAIL", value: email }] : []), ...(phone ? [{ type: "PHONE", value: phone }] : [])],
    },
    "The broker agent could not be recorded.",
  )
  return { personId: created.contact.person.id, notices: [] }
}

type BrokerTarget = { organizationId: string; personId: string | null }

async function resolveBrokerTarget(form: BrokerForm, current: { organizationId: string; organizationName: string; contactId?: string; contactName?: string } | undefined, resolve: OrganizationResolver): Promise<{ target: BrokerTarget | null; notices: string[]; cancelled: boolean }> {
  const orgName = form.org.trim()
  if (!orgName) {
    if (current) throw unavailable("Removing the broker of record", "a broker is replaced by another broker, never removed; choose the new brokerage instead.")
    return { target: null, notices: [], cancelled: false }
  }
  let organizationId: string
  if (current && key(current.organizationName) === key(orgName)) {
    organizationId = current.organizationId
  } else {
    const resolved = await resolve(orgName, "Insurance Broker")
    if (!resolved) return { target: null, notices: [], cancelled: true }
    organizationId = resolved.id
  }
  const sameOrg = current?.organizationId === organizationId
  // The agent's details could not be read (blank fields for a recorded agent): keep the recorded agent rather than dropping it.
  if (sameOrg && current?.contactId && !current.contactName && !form.agent.trim() && !form.phone.trim() && !form.email.trim()) {
    return { target: { organizationId, personId: current.contactId }, notices: [], cancelled: false }
  }
  const agent = await resolveBrokerAgent(organizationId, form, sameOrg ? { personId: current?.contactId, name: current?.contactName } : undefined)
  return { target: { organizationId, personId: agent.personId }, notices: agent.notices, cancelled: false }
}

// --- forms ---------------------------------------------------------------------------------------------------------------

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/
function requireAmount(value: string, label: string): string {
  const text = value.trim()
  if (!AMOUNT.test(text) || Number(text) <= 0) throw new Error(`${label} must be an amount greater than zero with at most 2 decimals (for example 2000000 or 2000000.50).`)
  return text
}
const sameAmount = (text: string, existing: number | string | null | undefined) => existing !== null && existing !== undefined && Number(text) === Number(existing)
const sameBroker = (target: BrokerTarget | null, current: { organizationId: string; contactId?: string } | undefined) =>
  target === null ? current === undefined : current !== undefined && current.organizationId === target.organizationId && (current.contactId ?? null) === target.personId

export type EditMode = "CORRECTION" | "ENDORSEMENT"
export type FormMode = "create" | "edit" | "renew"

export type TransportationForm = {
  insuranceType: string
  policyNumber: string
  insurerName: string
  coverageAmount: string
  effectiveDate: string
  expiryDate: string
  broker: BrokerForm
  notes: string
  editMode: EditMode
  endorsementDate: string
}

function renewalCoverages(editing: { coverages: TransportationRecord["coverages"] }, primary: { coverageType: string; limitAmount: string; currency: string; limitBasis: string | null }) {
  // A renewal restates every coverage of the term being renewed; the one the form shows takes the form's values.
  return editing.coverages.map((row, index) =>
    index === 0
      ? { coverageType: primary.coverageType, limitAmount: primary.limitAmount, currency: primary.currency, ...(primary.limitBasis ? { limitBasis: primary.limitBasis } : {}), ...(row.deductibleAmount ? { deductibleAmount: row.deductibleAmount } : {}), ...(row.scheduledVehiclesOnly ? { scheduledVehiclesOnly: true } : {}) }
      : { coverageType: row.coverageType, ...(row.limitAmount ? { limitAmount: row.limitAmount } : {}), ...(row.deductibleAmount ? { deductibleAmount: row.deductibleAmount } : {}), ...(row.currency ? { currency: row.currency } : {}), ...(row.limitBasis ? { limitBasis: row.limitBasis } : {}), ...(row.scheduledVehiclesOnly ? { scheduledVehiclesOnly: true } : {}) },
  )
}

export async function saveTransportation(companyId: string, mode: FormMode, editing: TransportationRecord | null, form: TransportationForm, resolve: OrganizationResolver): Promise<SaveResult> {
  const type = TRANSPORTATION_TYPE_OPTIONS[form.insuranceType]
  if (type === undefined || type === null) {
    throw unavailable(`Coverage type "${form.insuranceType}"`, "it has no canonical coverage type (supported: auto liability, motor truck cargo, general liability, physical damage, umbrella / excess, reefer breakdown).")
  }
  if (form.notes.trim()) throw unavailable("Operational Notes", "free-text policy notes have no canonical home yet; clear the field to save the policy.")
  const limit = requireAmount(form.coverageAmount, "Coverage limit")
  const policies = `${base(companyId)}/insurance`
  const notices: string[] = []

  if (mode === "create") {
    const insurer = await resolve(form.insurerName.trim(), "Insurance Company")
    if (!insurer) return { saved: false, notices }
    const broker = await resolveBrokerTarget(form.broker, undefined, resolve)
    if (broker.cancelled) return { saved: false, notices }
    notices.push(...broker.notices)
    await call("POST", policies, {
      insurerOrganizationId: insurer.id,
      family: "INSURANCE",
      policyNumber: form.policyNumber.trim(),
      termStart: form.effectiveDate,
      termEnd: form.expiryDate,
      coverages: [{ coverageType: type, limitAmount: limit, currency: "CAD" }],
      ...(broker.target ? { broker: { brokerOrganizationId: broker.target.organizationId, brokerPersonId: broker.target.personId } } : {}),
    })
    return { saved: true, notices }
  }

  if (!editing) throw new Error("No policy is selected.")
  const sameInsurer = key(form.insurerName) === key(editing.insurerName)

  if (mode === "renew") {
    const primary = editing.coverages[0]
    const currency = primary?.currency ?? "CAD"
    const broker = await resolveBrokerTarget(form.broker, editing.broker, resolve)
    if (broker.cancelled) return { saved: false, notices }
    notices.push(...broker.notices)
    if (sameInsurer) {
      await call("PATCH", `${policies}/${editing.policyId}`, {
        action: "renew",
        policyNumber: form.policyNumber.trim(),
        termStart: form.effectiveDate,
        termEnd: form.expiryDate,
        coverages: renewalCoverages(editing, { coverageType: type, limitAmount: limit, currency, limitBasis: primary?.limitBasis ?? null }),
      })
      if (broker.target && !sameBroker(broker.target, editing.broker)) {
        try {
          await call("PATCH", `${policies}/${editing.policyId}`, { action: "edit", mode: "ENDORSEMENT", broker: { brokerOrganizationId: broker.target.organizationId, brokerPersonId: broker.target.personId } })
        } catch (error) {
          notices.push(`The renewal was saved, but the broker was not changed: ${error instanceof Error ? error.message : "unknown error"}`)
        }
      }
      return { saved: true, notices }
    }
    // A different insurer is a NEW policy that renews the earlier one (the earlier policy and its history stay as they are).
    const insurer = await resolve(form.insurerName.trim(), "Insurance Company")
    if (!insurer) return { saved: false, notices }
    await call("POST", policies, {
      insurerOrganizationId: insurer.id,
      family: "INSURANCE",
      renewsPolicyId: editing.policyId,
      policyNumber: form.policyNumber.trim(),
      termStart: form.effectiveDate,
      termEnd: form.expiryDate,
      coverages: [{ coverageType: type, limitAmount: limit, currency, ...(primary?.limitBasis ? { limitBasis: primary.limitBasis } : {}) }],
      ...(broker.target ? { broker: { brokerOrganizationId: broker.target.organizationId, brokerPersonId: broker.target.personId } } : {}),
    })
    return { saved: true, notices }
  }

  // edit
  if (!sameInsurer) {
    throw unavailable("Changing the insurer of a recorded policy", "the insurer is part of the policy's identity and has no correction operation; use Renew Policy with the new insurer, or archive this policy and add the right one.")
  }
  const primary = editing.coverages[0]
  if (!primary || !editing.coverageId) throw new Error("This policy has no current coverage to edit.")
  const coverage: Record<string, unknown> = {}
  if (type !== primary.coverageType) coverage.coverageType = type
  if (!sameAmount(limit, primary.limitAmount)) coverage.limitAmount = limit
  const body: Record<string, unknown> = { action: "edit", mode: form.editMode }
  if (Object.keys(coverage).length > 0) {
    body.coverage = coverage
    body.coverageId = editing.coverageId
  }
  if (form.policyNumber.trim() !== editing.policyNumber) body.policyNumber = form.policyNumber.trim()
  if (form.effectiveDate !== editing.effectiveDate) body.termStart = form.effectiveDate
  if (form.expiryDate !== editing.expiryDate) body.termEnd = form.expiryDate
  const broker = await resolveBrokerTarget(form.broker, editing.broker, resolve)
  if (broker.cancelled) return { saved: false, notices }
  notices.push(...broker.notices)
  if (broker.target && !sameBroker(broker.target, editing.broker)) body.broker = { brokerOrganizationId: broker.target.organizationId, brokerPersonId: broker.target.personId }
  if (form.editMode === "ENDORSEMENT") {
    if (!form.endorsementDate) throw new Error("An endorsement needs the date it took effect.")
    body.effectiveOn = form.endorsementDate
  }
  if (Object.keys(body).length === 2) throw new Error("Nothing was changed.")
  await call("PATCH", `${policies}/${editing.policyId}`, body)
  return { saved: true, notices }
}

export type WorkersForm = { jurisdiction: string; providerName: string; accountNumber: string; effectiveDate: string; expiryDate: string; notes: string }

function refuseUnstoredWorkersFields(form: WorkersForm) {
  if (form.jurisdiction.trim()) throw unavailable("Jurisdiction", "the WCB jurisdiction has no canonical home yet; choose 'Not recorded' to save the account.")
  if (form.notes.trim()) throw unavailable("Notes", "free-text notes have no canonical home yet; clear the field to save the account.")
}

export async function saveWorkers(companyId: string, mode: FormMode, editing: WorkersRecord | null, form: WorkersForm, resolve: OrganizationResolver): Promise<SaveResult> {
  refuseUnstoredWorkersFields(form)
  const policies = `${base(companyId)}/insurance`
  if (mode === "create") {
    const provider = await resolve(form.providerName.trim(), "Workers Insurance")
    if (!provider) return { saved: false, notices: [] }
    await call("POST", policies, {
      insurerOrganizationId: provider.id,
      family: "WORKERS_COMPENSATION",
      policyNumber: form.accountNumber.trim(),
      termStart: form.effectiveDate,
      termEnd: form.expiryDate,
      coverages: [{ coverageType: "WORKERS_COMPENSATION" }],
    })
    return { saved: true, notices: [] }
  }
  if (!editing) throw new Error("No account is selected.")
  const sameProvider = key(form.providerName) === key(editing.providerName)
  if (mode === "renew") {
    if (sameProvider) {
      await call("PATCH", `${policies}/${editing.policyId}`, { action: "renew", policyNumber: form.accountNumber.trim(), termStart: form.effectiveDate, termEnd: form.expiryDate, coverages: [{ coverageType: "WORKERS_COMPENSATION" }] })
    } else {
      const provider = await resolve(form.providerName.trim(), "Workers Insurance")
      if (!provider) return { saved: false, notices: [] }
      await call("POST", policies, { insurerOrganizationId: provider.id, family: "WORKERS_COMPENSATION", renewsPolicyId: editing.policyId, policyNumber: form.accountNumber.trim(), termStart: form.effectiveDate, termEnd: form.expiryDate, coverages: [{ coverageType: "WORKERS_COMPENSATION" }] })
    }
    return { saved: true, notices: [] }
  }
  if (!sameProvider) throw unavailable("Changing the provider / board of a recorded account", "the provider is part of the account's identity and has no correction operation; use Renew with the new provider.")
  const body: Record<string, unknown> = { action: "edit", mode: "CORRECTION" }
  if (form.accountNumber.trim() !== editing.accountNumber) body.policyNumber = form.accountNumber.trim()
  if (form.effectiveDate !== editing.effectiveDate) body.termStart = form.effectiveDate
  if (form.expiryDate !== editing.expiryDate) body.termEnd = form.expiryDate
  if (Object.keys(body).length === 2) throw new Error("Nothing was changed.")
  await call("PATCH", `${policies}/${editing.policyId}`, body)
  return { saved: true, notices: [] }
}

export type BondForm = { bondType: string; suretyName: string; bondNumber: string; bondAmount: string; effectiveDate: string; expiryDate: string }

export async function saveBond(companyId: string, mode: FormMode, editing: BondEntry | null, form: BondForm, resolve: OrganizationResolver): Promise<SaveResult> {
  const type = BOND_TYPE_OPTIONS[form.bondType]
  if (!type) throw unavailable(`Bond type "${form.bondType}"`, "it has no canonical bond type.")
  const amount = requireAmount(form.bondAmount, "Bond amount")
  const policies = `${base(companyId)}/insurance`
  const termEnd = form.expiryDate.trim() ? form.expiryDate : null
  if (mode === "create") {
    const surety = await resolve(form.suretyName.trim(), "Surety Company")
    if (!surety) return { saved: false, notices: [] }
    await call("POST", policies, {
      insurerOrganizationId: surety.id,
      family: "BOND",
      policyNumber: form.bondNumber.trim(),
      termStart: form.effectiveDate,
      termEnd,
      coverages: [{ coverageType: type, limitAmount: amount, currency: "USD", limitBasis: "PENAL_SUM" }],
    })
    return { saved: true, notices: [] }
  }
  if (!editing) throw new Error("No bond is selected.")
  const primary = editing.coverages[0]
  const currency = primary?.currency ?? "USD"
  const sameSurety = key(form.suretyName) === key(editing.suretyName)
  if (mode === "renew") {
    const coverages = [{ coverageType: type, limitAmount: amount, currency, limitBasis: "PENAL_SUM" }]
    if (sameSurety) {
      await call("PATCH", `${policies}/${editing.policyId}`, { action: "renew", policyNumber: form.bondNumber.trim(), termStart: form.effectiveDate, termEnd, coverages })
    } else {
      const surety = await resolve(form.suretyName.trim(), "Surety Company")
      if (!surety) return { saved: false, notices: [] }
      await call("POST", policies, { insurerOrganizationId: surety.id, family: "BOND", renewsPolicyId: editing.policyId, policyNumber: form.bondNumber.trim(), termStart: form.effectiveDate, termEnd, coverages })
    }
    return { saved: true, notices: [] }
  }
  if (!sameSurety) throw unavailable("Changing the surety of a recorded bond", "the surety is part of the bond's identity and has no correction operation; use Renew with the new surety.")
  if (!editing.coverageId || !primary) throw new Error("This bond has no current coverage to edit.")
  const body: Record<string, unknown> = { action: "edit", mode: "CORRECTION" }
  const coverage: Record<string, unknown> = {}
  if (type !== primary.coverageType) coverage.coverageType = type
  if (!sameAmount(amount, primary.limitAmount)) coverage.limitAmount = amount
  if (Object.keys(coverage).length > 0) {
    body.coverage = coverage
    body.coverageId = editing.coverageId
  }
  if (form.bondNumber.trim() !== editing.bondNumber) body.policyNumber = form.bondNumber.trim()
  if (form.effectiveDate !== editing.effectiveDate) body.termStart = form.effectiveDate
  if ((termEnd ?? "") !== (editing.expiryDate ?? "")) body.termEnd = termEnd
  if (Object.keys(body).length === 2) throw new Error("Nothing was changed.")
  await call("PATCH", `${policies}/${editing.policyId}`, body)
  return { saved: true, notices: [] }
}

export async function saveBrokerUpdate(companyId: string, record: TransportationRecord, form: BrokerForm, isCorrection: boolean, resolve: OrganizationResolver): Promise<SaveResult> {
  if (!form.org.trim()) throw new Error("Brokerage organization name is required.")
  const broker = await resolveBrokerTarget(form, record.broker, resolve)
  if (broker.cancelled || !broker.target) return { saved: false, notices: broker.notices }
  if (sameBroker(broker.target, record.broker)) throw new Error("That broker is already the broker of record.")
  await call("PATCH", `${base(companyId)}/insurance/${record.policyId}`, {
    action: "edit",
    mode: isCorrection ? "CORRECTION" : "ENDORSEMENT",
    broker: { brokerOrganizationId: broker.target.organizationId, brokerPersonId: broker.target.personId },
  })
  return { saved: true, notices: broker.notices }
}

export async function archiveRecord(companyId: string, policyId: string, reason: string): Promise<void> {
  await call("PATCH", `${base(companyId)}/insurance/${policyId}`, { action: "archive", reason })
}

export async function restoreRecord(companyId: string, policyId: string): Promise<void> {
  await call("PATCH", `${base(companyId)}/insurance/${policyId}`, { action: "restore" })
}
