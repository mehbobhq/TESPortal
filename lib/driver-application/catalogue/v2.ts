import type { Catalogue, FieldDef, LegalSource, RequirementDef } from "./types"
import { CATALOGUE_V1 } from "./v1"
import { ctx, YES } from "./v1-fields"

/**
 * Catalogue v2 = v1 + the content that depends on what the COMPANY does (hazardous materials, passenger carrying). The company's recorded
 * operations decide which of these questions and evidence requests exist; they never state anything about an individual driver. Each driver
 * answers for themselves, and staff verify. v1 stays registered so plans frozen on it keep their meaning.
 */

const HAZ = ctx("hazmat", "truthy")
const PAX = ctx("passengerCarrying", "truthy")
const ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"]

const base = { purpose: "REGULATORY", sensitivity: "PERSONAL", stage: "PRE_OFFER", pdf: {}, legalSource: [] as string[] } as const

const FIELDS_V2_ADDED: FieldDef[] = [
  {
    ...base, id: "hazmat.qualification", section: "licence", order: 200, type: "select", required: true, appliesWhen: HAZ,
    label: "Hazardous-materials qualification you currently hold",
    help: "This company transports hazardous materials. Answer for yourself; it is verified before any decision.",
    options: [
      { value: "us_endorsement", label: "U.S. hazardous-materials endorsement (H or X)" },
      { value: "tdg", label: "Canadian TDG training certificate" },
      { value: "both", label: "Both" },
      { value: "none", label: "Neither at this time" },
    ],
    legalSource: ["US_HAZMAT_383", "CA_TDG_TRAINING"],
  },
  {
    ...base, id: "hazmat.credential_expiry", section: "licence", order: 210, type: "date", required: true,
    appliesWhen: { all: [HAZ, { not: { ref: "ans.hazmat.qualification", op: "eq", value: "none" } }] },
    label: "Expiry date of that hazardous-materials credential", validation: { notPast: true }, legalSource: ["US_HAZMAT_383", "CA_TDG_TRAINING"], pdf: { format: "date" },
  },
  {
    ...base, id: "hazmat.prior_incident", section: "licence", order: 220, type: "yesno", required: true, appliesWhen: HAZ,
    label: "Have you ever been involved in a hazardous-materials release or spill while driving?", legalSource: ["US_HAZMAT_383"], pdf: { format: "yesno" },
  },
  {
    ...base, id: "hazmat.prior_incident_details", section: "licence", order: 230, type: "textarea", required: true,
    appliesWhen: { all: [HAZ, YES("hazmat.prior_incident")] }, label: "Please explain (when, where, what happened)", validation: { minLength: 5, maxLength: 1000 },
  },
  {
    ...base, id: "docs.hazmat_qualification", section: "documents", order: 200, type: "upload", required: false, appliesWhen: { all: [HAZ, { not: { ref: "ans.hazmat.qualification", op: "eq", value: "none" } }] },
    label: "Hazardous-materials endorsement or TDG certificate", sensitivity: "SENSITIVE", legalSource: ["US_HAZMAT_383", "CA_TDG_TRAINING"],
    evidence: { documentClass: "HAZMAT_QUALIFICATION", sensitivity: "sensitive", accept: ACCEPT, hint: "The endorsement on the licence or the training certificate, all text readable." },
  },
  {
    ...base, id: "passenger.qualification", section: "licence", order: 240, type: "select", required: true, appliesWhen: PAX,
    label: "Passenger-carrying qualification you currently hold",
    help: "This company carries passengers. Answer for yourself; it is verified before any decision.",
    options: [
      { value: "p_endorsement", label: "Passenger (P) endorsement" },
      { value: "s_endorsement", label: "School bus (S) endorsement" },
      { value: "both", label: "Both" },
      { value: "none", label: "Neither at this time" },
    ],
    legalSource: ["US_PASSENGER_383"],
  },
  {
    ...base, id: "docs.passenger_qualification", section: "documents", order: 210, type: "upload", required: false,
    appliesWhen: { all: [PAX, { not: { ref: "ans.passenger.qualification", op: "eq", value: "none" } }] },
    label: "Passenger or school-bus endorsement evidence", sensitivity: "SENSITIVE", legalSource: ["US_PASSENGER_383"],
    evidence: { documentClass: "PASSENGER_QUALIFICATION", sensitivity: "sensitive", accept: ACCEPT, hint: "The endorsement on the licence or the certificate, all text readable." },
  },
]

const REQUIREMENTS_V2_ADDED: RequirementDef[] = [
  { key: "hazmat_qualification", type: "CARRIER_SPECIFIC", title: "Hazardous-materials qualification (endorsement / TDG training) verified for this driver", appliesWhen: HAZ, stage: "PRE_OFFER", requiredForQualification: false, evidenceClasses: ["HAZMAT_QUALIFICATION"], legalSource: ["US_HAZMAT_383", "CA_TDG_TRAINING"] },
  { key: "passenger_qualification", type: "CARRIER_SPECIFIC", title: "Passenger-carrying qualification verified for this driver", appliesWhen: PAX, stage: "PRE_OFFER", requiredForQualification: false, evidenceClasses: ["PASSENGER_QUALIFICATION"], legalSource: ["US_PASSENGER_383"] },
]

const LEGAL_SOURCES_V2_ADDED: Record<string, LegalSource> = {
  US_HAZMAT_383: { citation: "49 CFR 383.93 / 383.121 (hazardous-materials endorsement)", jurisdiction: "US", note: "Endorsement and knowledge-test requirements for drivers of vehicles transporting hazardous materials requiring placards.", verification: "UNVERIFIED_BY_COUNSEL" },
  CA_TDG_TRAINING: { citation: "Transportation of Dangerous Goods Regulations, Part 6 (training)", jurisdiction: "CA", note: "Training certificate required to handle, offer for transport or transport dangerous goods.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_PASSENGER_383: { citation: "49 CFR 383.93 (passenger and school-bus endorsements)", jurisdiction: "US", note: "Endorsements for drivers of vehicles carrying passengers.", verification: "UNVERIFIED_BY_COUNSEL" },
}

export const CATALOGUE_V2: Catalogue = {
  ...CATALOGUE_V1,
  version: "driver-application/2",
  rulesVersion: "2026-10-r2",
  fields: [...CATALOGUE_V1.fields, ...FIELDS_V2_ADDED],
  requirements: [...CATALOGUE_V1.requirements, ...REQUIREMENTS_V2_ADDED],
  legalSources: { ...CATALOGUE_V1.legalSources, ...LEGAL_SOURCES_V2_ADDED },
}
