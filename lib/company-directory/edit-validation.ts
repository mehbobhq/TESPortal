/**
 * Company Edit: the form's values, its change detection and its pre-flight validation. Pure (no I/O, no framework), so the edit page and the tests
 * share it. It reuses the SAME rule functions the server applies (channel, identifier, registration, provider, address planning), so a value the
 * page accepts is a value the server accepts; the server stays authoritative and re-validates everything.
 *
 * Only fields that CHANGED are validated and sent: an untouched legacy value can never block a save, and an untouched field is never rewritten.
 */
import { prepareChannel } from "@/lib/contacts/definitions"
import { prepareCorporateIdentifier } from "@/lib/corporate-identity/identifier-definitions"
import { prepareProviderName, resolveCargoCategory, resolvePaymentMethod } from "@/lib/company-profile/definitions"
import { prepareRegistrationNumber } from "@/lib/tax-registrations/definitions"
import { addressBlockPresent, OPERATING_SCOPE_BY_OP_REGION, planAddressBlock } from "@/lib/company-directory/creation-input"
import { sameChannelValue } from "@/lib/company-changes/definitions"

export type EditIssue = { field: string; message: string }

export const ADDRESS_PREFIXES = ["reg", "mail", "yard"] as const
export const ADDRESS_PARTS = ["street", "city", "state", "zip", "country"] as const
export type AddressKey = `${(typeof ADDRESS_PREFIXES)[number]}_${(typeof ADDRESS_PARTS)[number]}`

export const CHANNEL_FIELDS = [
  { name: "website", label: "Website", kind: "WEBSITE" },
  { name: "phone", label: "Phone", kind: "PHONE" },
  { name: "email", label: "Account Email", kind: "EMAIL" },
  { name: "billingEmail", label: "Billing Email", kind: "EMAIL" },
] as const
export type ChannelName = (typeof CHANNEL_FIELDS)[number]["name"]

export type EditValues = {
  dba: string
  incorpNo: string
  businessNo: string
  ein: string
  gstHst: string
  opRegion: string
  website: string
  phone: string
  email: string
  billingEmail: string
  eldProvider: string
  gpsProvider: string
  fuelProvider: string
  payMethod: string
  cargoTypes: string[]
} & Record<AddressKey, string>

export const ADDRESS_KEYS: AddressKey[] = ADDRESS_PREFIXES.flatMap((prefix) => ADDRESS_PARTS.map((part) => `${prefix}_${part}` as AddressKey))

const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** The canonical values (as the profile and edit record report them) in the shape of the form. */
export function valuesFromRecords(edit: { dba?: string; incorpNo?: string; businessNo?: string; ein?: string } | null, profile: Record<string, unknown> | null): EditValues {
  const p = profile ?? {}
  const values = {
    dba: text(edit?.dba ?? p.dba),
    incorpNo: text(edit?.incorpNo ?? p.incorpNo),
    businessNo: text(edit?.businessNo ?? p.businessNo),
    ein: text(edit?.ein ?? p.ein),
    gstHst: text(p.gstHst),
    opRegion: text(p.opRegion),
    website: text(p.website),
    phone: text(p.phone),
    email: text(p.email),
    billingEmail: text(p.billingEmail),
    eldProvider: text(p.eldProvider),
    gpsProvider: text(p.gpsProvider),
    fuelProvider: text(p.fuelProvider),
    payMethod: text(p.payMethod),
    cargoTypes: Array.isArray(p.cargoTypes) ? (p.cargoTypes as string[]) : [],
  } as EditValues
  for (const key of ADDRESS_KEYS) (values as Record<string, unknown>)[key] = text(p[key])
  return values
}

const norm = (value: string) => value.trim()
const sameList = (a: string[], b: string[]) => [...a].sort().join("|") === [...b].sort().join("|")
const comparable = (key: AddressKey, value: string) => (key.endsWith("_zip") ? value.replace(/\s+/g, "").toUpperCase() : norm(value).toLowerCase())

/** The fields whose value differs from the canonical baseline. */
export function changedFields(current: EditValues, baseline: EditValues): string[] {
  const changed: string[] = []
  for (const key of ["dba", "incorpNo", "businessNo", "ein", "gstHst", "opRegion", "eldProvider", "gpsProvider", "fuelProvider", "payMethod"] as const) {
    if (norm(current[key]) !== norm(baseline[key])) changed.push(key)
  }
  for (const channel of CHANNEL_FIELDS) {
    const next = norm(current[channel.name])
    const was = norm(baseline[channel.name])
    if (next === was) continue
    // Formatting-only differences of an existing value are not a change; an empty side always is (a phone of "abc" has no digits, so it must not look "the same" as none).
    if (next !== "" && was !== "" && sameChannelValue(channel.kind, next, was)) continue
    changed.push(channel.name)
  }
  if (!sameList(current.cargoTypes, baseline.cargoTypes)) changed.push("cargoTypes")
  for (const key of ADDRESS_KEYS) if (comparable(key, current[key]) !== comparable(key, baseline[key])) changed.push(key)
  return changed
}

export type EverRecorded = Partial<Record<ChannelName, boolean>> | null

/**
 * A channel change that takes effect only after confirmation: REPLACING an established value with a different one, REMOVING it, or giving it a
 * new value after the established one was removed. Only the very first value a channel ever has is recorded directly.
 */
export function channelReplacements(current: EditValues, baseline: EditValues, everRecorded: EverRecorded = null): Array<{ name: ChannelName; label: string; removal: boolean }> {
  return CHANNEL_FIELDS.flatMap((channel): Array<{ name: ChannelName; label: string; removal: boolean }> => {
    const next = norm(current[channel.name])
    const was = norm(baseline[channel.name])
    if (next === "") return was !== "" ? [{ name: channel.name, label: channel.label, removal: true }] : []
    if (was !== "") return sameChannelValue(channel.kind, next, was) ? [] : [{ name: channel.name, label: channel.label, removal: false }]
    return everRecorded?.[channel.name] === true ? [{ name: channel.name, label: channel.label, removal: false }] : []
  })
}

export type ValidationContext = {
  isCustomer: boolean
  /** The recorded formation country (an incorporation number needs it). */
  formationCountry: string | null
  contactsWithheld: boolean
  registrationsWithheld: boolean
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

/** Validates only what changed. Returns one issue per problem, keyed by the form field the page marks. */
export function validateEdit(current: EditValues, baseline: EditValues, context: ValidationContext): EditIssue[] {
  const issues: EditIssue[] = []
  const changed = new Set(changedFields(current, baseline))

  if (changed.has("dba") && norm(current.dba).length > 200) issues.push({ field: "dba", message: "A trade name is limited to 200 characters." })

  for (const [field, kind, label] of [["businessNo", "CRA_BN", "Business Number"], ["ein", "IRS_EIN", "EIN"], ["incorpNo", "INCORPORATION", "Incorporation number"]] as const) {
    if (!changed.has(field) || norm(current[field]) === "") continue
    try {
      if (kind === "INCORPORATION") {
        if (!context.formationCountry) {
          issues.push({ field, message: "An incorporation number needs a recorded formation jurisdiction." })
          continue
        }
        prepareCorporateIdentifier({ kind, value: norm(current[field]), country: context.formationCountry }, field)
      } else {
        prepareCorporateIdentifier({ kind, value: norm(current[field]) }, field)
      }
    } catch (error) {
      issues.push({ field, message: messageOf(error, `Enter a valid ${label}.`) })
    }
  }

  if (!context.registrationsWithheld && changed.has("gstHst") && norm(current.gstHst) !== "") {
    try {
      prepareRegistrationNumber("GST_HST", current.gstHst, "gstHst")
    } catch (error) {
      issues.push({ field: "gstHst", message: messageOf(error, "Enter a valid GST/HST account (for example 123456789 RT 0001).") })
    }
    const bn = norm(current.businessNo).replace(/\D/g, "")
    const account = norm(current.gstHst).replace(/\D/g, "")
    if (bn.length === 9 && account.length >= 9 && !account.startsWith(bn) && !issues.some((issue) => issue.field === "gstHst")) {
      issues.push({ field: "gstHst", message: "The GST/HST account must begin with this company's Business Number." })
    }
  }

  for (const channel of CHANNEL_FIELDS) {
    if (!changed.has(channel.name) || norm(current[channel.name]) === "") continue
    if (channel.name !== "website" && context.contactsWithheld) continue
    try {
      prepareChannel(channel.kind, current[channel.name], undefined, channel.name)
    } catch (error) {
      issues.push({ field: channel.name, message: messageOf(error, `Enter a valid ${channel.label.toLowerCase()}.`) })
    }
  }

  if (context.isCustomer) {
    for (const field of ["eldProvider", "gpsProvider", "fuelProvider"] as const) {
      if (!changed.has(field) || norm(current[field]) === "") continue
      try {
        prepareProviderName(current[field], field)
      } catch (error) {
        issues.push({ field, message: messageOf(error, "The provider name is not accepted.") })
      }
    }
    if (changed.has("payMethod") && norm(current.payMethod) !== "" && !resolvePaymentMethod(current.payMethod)) {
      issues.push({ field: "payMethod", message: `'${norm(current.payMethod)}' is not a billing payment method.` })
    }
    if (changed.has("cargoTypes")) {
      if (current.cargoTypes.length === 0) issues.push({ field: "cargoTypes", message: "Cargo Information is required for a Customer; choose at least one category." })
      for (const entry of current.cargoTypes) if (!resolveCargoCategory(entry)) issues.push({ field: "cargoTypes", message: `'${entry}' is not a cargo category.` })
    }
  }

  if (changed.has("opRegion") && norm(current.opRegion) !== "" && !(OPERATING_SCOPE_BY_OP_REGION as Record<string, string>)[norm(current.opRegion)]) {
    issues.push({ field: "opRegion", message: `Unsupported operating region '${current.opRegion}'.` })
  }

  for (const prefix of ADDRESS_PREFIXES) {
    const keys = ADDRESS_PARTS.map((part) => `${prefix}_${part}` as AddressKey)
    if (!keys.some((key) => changed.has(key))) continue
    const block = Object.fromEntries(keys.map((key) => [key, current[key]]))
    if (!addressBlockPresent(block, prefix)) {
      // The server never blanks an address silently: refusing here keeps a "Saved" message from hiding a discarded edit.
      issues.push({ field: `${prefix}_street`, message: "An address cannot be removed here. Enter the correct address, or leave it as it was." })
      continue
    }
    const planned = planAddressBlock(block, prefix)
    if ("field" in planned) issues.push(planned)
  }
  return issues
}

/** The PATCH body for what changed (never the registered legal name). A cleared field is an explicit, intentional clear. */
export function buildPatch(
  current: EditValues,
  baseline: EditValues,
  options: { includeContacts: boolean; includeRegistrations: boolean; isCustomer: boolean; replacement: { source: string; reference: string; sender: string }; dbaBasis: { kind: string; reference: string }; everRecorded?: EverRecorded },
): Record<string, unknown> {
  const changed = new Set(changedFields(current, baseline))
  const body: Record<string, unknown> = {}
  for (const key of ["dba", "incorpNo", "businessNo", "ein"] as const) if (changed.has(key)) body[key] = norm(current[key])
  if (changed.has("opRegion") && norm(current.opRegion) !== "") body.opRegion = norm(current.opRegion)
  if (changed.has("dba") && options.dbaBasis.kind) {
    body.dbaBasis = options.dbaBasis.kind
    body.dbaBasisReference = options.dbaBasis.reference.trim()
  }
  for (const channel of CHANNEL_FIELDS) {
    if (!changed.has(channel.name)) continue
    if (channel.name !== "website" && !options.includeContacts) continue
    body[channel.name] = norm(current[channel.name])
  }
  if (channelReplacements(current, baseline, options.everRecorded).length > 0) {
    body.channelChangeSource = options.replacement.source
    body.channelChangeReference = options.replacement.reference.trim()
    if (options.replacement.sender.trim()) body.channelChangeSender = options.replacement.sender.trim()
  }
  if (options.includeRegistrations && changed.has("gstHst")) body.gstHst = norm(current.gstHst)
  if (options.isCustomer) {
    if (changed.has("cargoTypes")) body.cargoTypes = JSON.stringify(current.cargoTypes)
    for (const key of ["eldProvider", "gpsProvider", "fuelProvider", "payMethod"] as const) if (changed.has(key)) body[key] = norm(current[key])
    for (const prefix of ADDRESS_PREFIXES) {
      if (prefix !== "reg" && !options.isCustomer) continue
      if (ADDRESS_PARTS.some((part) => changed.has(`${prefix}_${part}`))) for (const part of ADDRESS_PARTS) body[`${prefix}_${part}`] = norm(current[`${prefix}_${part}` as AddressKey])
    }
  } else if (ADDRESS_PARTS.some((part) => changed.has(`reg_${part}`))) {
    for (const part of ADDRESS_PARTS) body[`reg_${part}`] = norm(current[`reg_${part}` as AddressKey])
  }
  return body
}
