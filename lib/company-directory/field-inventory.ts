/**
 * The Company Profile field inventory: for EVERY value the profile displays, where it comes from, whether it can be edited here, and what
 * a change requires. Pure data (no I/O, importable by the pages and by tests). A test asserts that every key of CompanyProfileRecord has an
 * entry, so a new profile value cannot appear without a defined source and a defined edit path.
 *
 * Modes:
 *   editable            changed on Company Edit; the server validates it, authorizes it per domain capability and records it in the change ledger.
 *   gated               changed only through a controlled procedure with verification/approval (never through Save Changes).
 *   derived             computed from another authoritative record on every read; never stored or edited on the company.
 *   managed_elsewhere   owned by another workspace with its own rules; shown here read-only, with a link to where it is managed.
 *   readonly            recorded once / lifecycle-controlled; cannot be edited here (reason given).
 */
export type FieldMode = "editable" | "gated" | "derived" | "managed_elsewhere" | "readonly"

export type FieldDefinition = {
  label: string
  mode: FieldMode
  /** The canonical PostgreSQL owner. */
  source: string
  /** Why it is not editable here, or what a change requires. */
  note?: string
  /** For managed_elsewhere / gated: the workspace that changes it (path below /companies/{id}/). */
  workspace?: string
}

export const COMPANY_FIELD_INVENTORY: Readonly<Record<string, FieldDefinition>> = {
  // --- identity
  id: { label: "Company record id", mode: "readonly", source: "organizations.id", note: "System identifier." },
  name: { label: "Company name", mode: "derived", source: "organizations.display_name / legal_name", note: "The trade name when recorded, otherwise the registered legal name." },
  legalName: { label: "Registered legal name", mode: "gated", source: "organizations.legal_name", note: "Changes only through the legal-name procedure: a government document, a written request from a company representative with recorded authority (Service Decision Authority / Contract Signatory, or a Director with a verified document), and an authorized Onboarding Team member or the founder-level account.", workspace: "edit" },
  kind: { label: "Company record type", mode: "derived", source: "organization_classifications / customers", note: "Derived from the primary classification and from whether the company is a Customer." },
  region: { label: "Registered in", mode: "readonly", source: "organizations.country_code / region_code", note: "The jurisdiction of formation is set when the company is registered; changing it is a legal-identity change that is not available here." },
  regCorpState: { label: "Registered province/state", mode: "readonly", source: "organizations.region_code", note: "Part of the jurisdiction of formation (see Registered in)." },
  regCorpCountry: { label: "Registered country", mode: "readonly", source: "organizations.country_code", note: "Part of the jurisdiction of formation (see Registered in)." },
  status: { label: "Record status", mode: "readonly", source: "organizations.status", note: "Archiving or merging a company record is a separate administrative lifecycle action." },
  createdAt: { label: "Record created", mode: "readonly", source: "organizations.created_at", note: "System timestamp." },
  dba: { label: "DBA / trade name", mode: "editable", source: "organization_aliases (TRADE_NAME)", note: "The previous trade name is kept in history; a confirmation basis can be recorded." },
  incorpNo: { label: "Incorporation / charter number", mode: "editable", source: "organization_identifiers (INCORPORATION)", note: "Needs the recorded formation jurisdiction; the previous value is kept in history." },
  businessNo: { label: "CRA Business Number (BN)", mode: "editable", source: "organization_identifiers (CRA_BN)", note: "Nine-digit root; the previous value is kept in history." },
  ein: { label: "IRS Employer ID (EIN)", mode: "editable", source: "organization_identifiers (IRS_EIN)", note: "Nine digits; the previous value is kept in history." },
  opRegion: { label: "Operating region", mode: "editable", source: "company_operating_scope_periods", note: "Recorded as an assertion; it decides which jurisdiction-specific sections apply." },
  // --- communication
  contact: { label: "Primary Contact", mode: "managed_elsewhere", source: "contact_purpose_assignments (PRIMARY)", note: "A person is designated in Contacts, never typed here.", workspace: "contacts" },
  contactPersonId: { label: "Primary Contact person", mode: "managed_elsewhere", source: "people", workspace: "contacts" },
  phone: { label: "Company phone", mode: "editable", source: "organization_channels (PHONE / GENERAL)", note: "A first value is recorded directly; replacing an established value waits for confirmation through an established channel." },
  email: { label: "Account email", mode: "editable", source: "organization_channels (EMAIL / GENERAL)", note: "A first value is recorded directly; replacing an established value waits for confirmation through an established channel." },
  billingEmail: { label: "Billing email", mode: "editable", source: "organization_channels (EMAIL / ACCOUNTING)", note: "A first value is recorded directly; replacing an established value waits for confirmation through an established channel." },
  website: { label: "Website", mode: "editable", source: "organization_channels (WEBSITE)", note: "A first value is recorded directly; replacing an established value waits for confirmation through an established channel." },
  // --- customer
  cargoTypes: { label: "Cargo information", mode: "editable", source: "company_cargo_category_periods", note: "A Customer needs at least one category; earlier categories are kept in history." },
  eldProvider: { label: "ELD / HOS provider", mode: "editable", source: "company_fleet_provider_periods (ELD_HOS)", note: "Earlier providers are kept in history." },
  gpsProvider: { label: "Truck GPS provider", mode: "editable", source: "company_fleet_provider_periods (GPS_TELEMATICS)", note: "Earlier providers are kept in history." },
  fuelProvider: { label: "Fuel provider", mode: "editable", source: "company_fleet_provider_periods (FUEL_SERVICES)", note: "Earlier providers are kept in history." },
  payMethod: { label: "Preferred payment method", mode: "editable", source: "customer_billing_preference_periods", note: "A billing preference only (never contract terms); no payment credentials are stored. The previous preference is kept in history." },
  payMethodCode: { label: "Preferred payment method code", mode: "derived", source: "customer_billing_preference_periods", note: "The catalogue code of the preferred payment method." },
  paymentMethodHistory: { label: "Payment-method history", mode: "derived", source: "customer_billing_preference_periods", note: "Previous preferences with the dates they applied." },
  serviceType: { label: "Contracted service", mode: "derived", source: "contracts (signed) -> contract lines -> package", note: "Comes from the signed contract; a profile edit can never change or override it.", workspace: "onboarding" },
  serviceStage: { label: "Service status", mode: "derived", source: "customer_engagement_stages", note: "The stage of the current engagement.", workspace: "onboarding" },
  startDate: { label: "Service start date", mode: "readonly", source: "customer_engagements.started_at", note: "Fixed once recorded; a verified correction with a reason is a separate authorized workflow." },
  endDate: { label: "Service end date", mode: "derived", source: "customer_engagements.ended_at", note: "Recorded only by ending the service (End Service), with a reason; an ended service is never reopened or deleted." },
  engagements: { label: "Service engagements", mode: "derived", source: "customer_engagements", note: "Every stay, oldest first." },
  assessment: { label: "Documentation assessment", mode: "derived", source: "(none yet)", note: "No assessment engine records one yet, so nothing is displayed for it." },
  customerDetails: { label: "Customer authorities and contracts", mode: "derived", source: "customer_authority_assignments / contracts", note: "Exactly one active Service Decision Authority and one active Contract Signatory (they may be the same person); managed in the contract process, never here.", workspace: "onboarding" },
  // --- registrations
  gstHst: { label: "GST/HST account", mode: "editable", source: "registrations (program GST_HST)", note: "Must begin with the company's Business Number; a different account archives the earlier one." },
  gstHstRegistrationId: { label: "GST/HST registration id", mode: "derived", source: "registrations", note: "The record id behind the GST/HST account." },
  usdot: { label: "US DOT #", mode: "managed_elsewhere", source: "operating_authorities (kind USDOT)", workspace: "authorities" },
  mc: { label: "MC #", mode: "managed_elsewhere", source: "operating_authorities (kind MC)", workspace: "authorities" },
  nsc: { label: "NSC / CVOR #", mode: "managed_elsewhere", source: "operating_authorities (kind SAFETY_FITNESS / CVOR)", workspace: "authorities" },
  mvid: { label: "MVID / RIN #", mode: "managed_elsewhere", source: "operating_authorities (kind MVID / RIN)", workspace: "authorities" },
  accIrp: { label: "IRP account #", mode: "managed_elsewhere", source: "operating_authorities (kind IRP)", workspace: "authorities" },
  scac: { label: "SCAC", mode: "managed_elsewhere", source: "registrations (program SCAC)", workspace: "tax-filing" },
  carrierCode: { label: "Carrier code", mode: "managed_elsewhere", source: "registrations (program CA_CARRIER_CODE)", workspace: "tax-filing" },
  accIfta: { label: "IFTA account #", mode: "managed_elsewhere", source: "registrations (program IFTA)", workspace: "tax-filing" },
  accNyhut: { label: "NY HUT account #", mode: "managed_elsewhere", source: "registrations (program NY_HUT)", workspace: "tax-filing" },
  accNm: { label: "NM WDT account #", mode: "managed_elsewhere", source: "registrations (program NM_WDT)", workspace: "tax-filing" },
  accKyu: { label: "Kentucky KYU #", mode: "managed_elsewhere", source: "registrations (program KYU)", workspace: "tax-filing" },
  accOr: { label: "Oregon account #", mode: "managed_elsewhere", source: "registrations (program OR_WMT)", workspace: "tax-filing" },
  accCt: { label: "CT DRS account #", mode: "managed_elsewhere", source: "registrations (program CT_HUF)", workspace: "tax-filing" },
  // --- addresses
  addressHistory: { label: "Address history", mode: "derived", source: "organization_location_assignments / location_addresses", note: "Previous addresses with the dates they applied." },
  editAccess: { label: "Edit permissions", mode: "derived", source: "capability checks", note: "What the viewer may change; the server re-proves each capability when a change is saved." },
  channelsEverRecorded: { label: "Channels ever recorded", mode: "derived", source: "organization_channels", note: "Decides whether a new phone, email or website is a first value (direct) or a replacement (confirmed)." },
  changeTracking: { label: "Change tracking", mode: "derived", source: "database schema state (migration 0036)", note: "Whether the change ledger, the legal-name procedure and confirmed channel replacements are available on this database." },
  sections: { label: "Section permissions", mode: "derived", source: "capability checks", note: "Which sections the viewer may read." },
  notRecordedYet: { label: "Not recorded yet", mode: "derived", source: "(none)", note: "Fields the canonical system does not record yet; empty." },
}

const ADDRESS_ROLE_LABEL = { reg: "Registered address", mail: "Mailing address", yard: "Yard / home terminal address" } as const
for (const prefix of ["reg", "mail", "yard"] as const) {
  for (const part of ["street", "city", "state", "zip", "country"] as const) {
    ;(COMPANY_FIELD_INVENTORY as Record<string, FieldDefinition>)[`${prefix}_${part}`] = {
      label: `${ADDRESS_ROLE_LABEL[prefix]}: ${part}`,
      mode: "editable",
      source: "organization_location_assignments / location_addresses",
      note: prefix === "reg" ? "A changed address keeps the previous one as history; an address is replaced as a whole and cannot be blanked." : "Customer records only. A changed address keeps the previous one as history; an address is replaced as a whole and cannot be blanked.",
    }
  }
}
