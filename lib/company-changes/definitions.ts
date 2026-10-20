/**
 * Company change accountability: controlled vocabularies and pure rules. No I/O, no framework imports (testable under plain Node and
 * importable by the Company Activity UI).
 *
 * What each rule protects:
 *  - LEGAL NAME is the registered identity of the company. It changes only through the legal-name procedure (see service.ts): a
 *    government document + a written request from a customer-authority holder or an evidenced Director + execution by an authorised
 *    TES user. Nothing else may overwrite it.
 *  - COMPANY CHANNELS (website, phone, email) are trusted routes to the company. Replacing an established one with a DIFFERENT value is
 *    recorded as a request and activates only after confirmation through a channel that was already established.
 *  - Everything else (trade name, addresses, region, payment preference, registrations) follows its own field rule and is recorded
 *    automatically in the change ledger with the previous value.
 */

export const LEGAL_NAME_EVIDENCE_TYPES = {
  government: "GOVERNMENT_NAME_DOCUMENT",
  writtenRequest: "COMPANY_WRITTEN_REQUEST",
  director: "DIRECTOR_VERIFICATION_DOCUMENT",
} as const

export type LegalNameEvidenceRole = "GOVERNMENT_DOCUMENT" | "WRITTEN_REQUEST" | "DIRECTOR_VERIFICATION"
export const LEGAL_NAME_ROLE_TO_TYPE: Record<LegalNameEvidenceRole, string> = {
  GOVERNMENT_DOCUMENT: LEGAL_NAME_EVIDENCE_TYPES.government,
  WRITTEN_REQUEST: LEGAL_NAME_EVIDENCE_TYPES.writtenRequest,
  DIRECTOR_VERIFICATION: LEGAL_NAME_EVIDENCE_TYPES.director,
}
export const LEGAL_NAME_ROLE_TO_COLUMN: Record<LegalNameEvidenceRole, "government_evidence_document_id" | "written_request_evidence_document_id" | "director_evidence_document_id"> = {
  GOVERNMENT_DOCUMENT: "government_evidence_document_id",
  WRITTEN_REQUEST: "written_request_evidence_document_id",
  DIRECTOR_VERIFICATION: "director_evidence_document_id",
}

/**
 * Who may ASK for a registered legal-name change. A Primary Contact designation is an operational routing choice and never authorizes it.
 *   CUSTOMER_AUTHORITY  a person who currently holds a recorded customer authority (Service Decision Authority or Contract Signatory),
 *                       established by the contract-authority process with verified notice evidence.
 *   VERIFIED_DIRECTOR   a Director whose authority is evidenced by a linked, verified document (a title alone is never proof).
 */
export const REQUESTER_BASES = ["CUSTOMER_AUTHORITY", "VERIFIED_DIRECTOR"] as const
export type RequesterBasis = (typeof REQUESTER_BASES)[number]
export const LEGAL_NAME_REQUEST_SOURCES = ["EMAIL", "LETTER", "PORTAL", "OTHER"] as const
export const CHANNEL_REQUEST_SOURCES = ["COMPANY_WRITTEN_REQUEST", "COMPANY_VERBAL_CONFIRMED", "PORTAL", "STAFF_ENTRY"] as const
/** The evidence that a sensitive channel change was confirmed (for example the record of a call back to an established number, or the reply from an established address). */
export const CHANNEL_CONFIRMATION_EVIDENCE_TYPE = "CHANNEL_CHANGE_CONFIRMATION"
export const CHANNEL_CHANGE_KINDS = ["REPLACE", "REMOVE"] as const
export type ChannelChangeKind = (typeof CHANNEL_CHANGE_KINDS)[number]
export const CONFIRMATION_METHODS = ["CALL_BACK", "EMAIL_REPLY", "IN_PERSON", "OTHER"] as const
export const DBA_BASES = ["BUSINESS_CONFIRMATION", "REGISTRATION_EVIDENCE"] as const

export type ChannelKind = "WEBSITE" | "PHONE" | "EMAIL"

export const OPERATION_LABELS: Record<string, { label: string; group: "identity" | "communication" | "address" | "contacts" | "business" }> = {
  LEGAL_NAME_CHANGED: { label: "Legal Name Changed", group: "identity" },
  LEGAL_NAME_CHANGE_REQUESTED: { label: "Legal Name Change Requested", group: "identity" },
  DBA_ADDED: { label: "DBA Added", group: "identity" },
  DBA_UPDATED: { label: "DBA Updated", group: "identity" },
  DBA_REMOVED: { label: "DBA Removed", group: "identity" },
  WEBSITE_ADDED: { label: "Website Added", group: "communication" },
  WEBSITE_UPDATED: { label: "Website Updated", group: "communication" },
  WEBSITE_REMOVED: { label: "Website Removed", group: "communication" },
  COMPANY_EMAIL_ADDED: { label: "Company Email Added", group: "communication" },
  COMPANY_EMAIL_CHANGED: { label: "Company Email Changed", group: "communication" },
  COMPANY_EMAIL_REMOVED: { label: "Company Email Removed", group: "communication" },
  COMPANY_PHONE_ADDED: { label: "Company Phone Added", group: "communication" },
  COMPANY_PHONE_CHANGED: { label: "Company Phone Changed", group: "communication" },
  COMPANY_PHONE_REMOVED: { label: "Company Phone Removed", group: "communication" },
  CHANNEL_CHANGE_REQUESTED: { label: "Channel Change Awaiting Confirmation", group: "communication" },
  CHANNEL_CHANGE_REJECTED: { label: "Channel Change Rejected", group: "communication" },
  ADDRESS_UPDATED: { label: "Address Updated", group: "address" },
  OPERATING_REGION_UPDATED: { label: "Operating Region Updated", group: "business" },
  BUSINESS_DETAILS_UPDATED: { label: "Business Details Updated", group: "business" },
  PAYMENT_METHOD_UPDATED: { label: "Payment Method Updated", group: "business" },
  PRIMARY_CONTACT_CHANGED: { label: "Primary Contact Changed", group: "contacts" },
  PRIMARY_CONTACT_DESIGNATED: { label: "Primary Contact Designated", group: "contacts" },
}

export const ACTIVITY_GROUPS = [
  { value: "all", label: "All" },
  { value: "identity", label: "Names" },
  { value: "communication", label: "Phone, email & web" },
  { value: "address", label: "Addresses" },
  { value: "contacts", label: "Contacts" },
  { value: "business", label: "Business details" },
] as const

/** The operation code of a channel change, by kind and what happened. */
export function channelOperation(kind: ChannelKind, action: "added" | "changed" | "removed"): string {
  const base = kind === "WEBSITE" ? "WEBSITE" : kind === "PHONE" ? "COMPANY_PHONE" : "COMPANY_EMAIL"
  const verb = kind === "WEBSITE" ? { added: "ADDED", changed: "UPDATED", removed: "REMOVED" } : { added: "ADDED", changed: "CHANGED", removed: "REMOVED" }
  return `${base}_${verb[action]}`
}

/** Compares a requested channel value with the established one the way the channel is normalised (case-insensitive text, digits for phones). */
export function sameChannelValue(kind: ChannelKind, a: string, b: string): boolean {
  const clean = (value: string) => (kind === "PHONE" ? value.replace(/\D+/g, "") : value.trim().toLowerCase().replace(/\/+$/, ""))
  return clean(a) === clean(b)
}

export type Blocker = { code: string; message: string }
