import type { Cond, EvidenceSpec, FieldDef, ItemField, Option, SectionId, Stage } from "./types"

/**
 * Catalogue v1 fields. Conventions:
 *  - ids are stable (`section.name`); they key answers, uploads, PDF rows and verification links.
 *  - `stage` is the earliest stage the question may be asked. Pre-offer collection is limited to what is lawful and necessary to assess a candidate;
 *    identity-document, immigration, tax-identifier and background items are collected later, and sensitive identifiers only through the vault.
 *  - legalSource keys point into LEGAL_SOURCES (v1-legal.ts). None of them has been verified by counsel (see that file).
 */

const yes = { ref: "", op: "eq" as const, value: "yes" }
export const ans = (id: string, value: unknown): Cond => ({ ref: `ans.${id}`, op: "eq", value })
export const ctx = (key: string, op: "eq" | "neq" | "truthy" | "falsy" | "includes" | "in" | "gte", value?: unknown): Cond => ({ ref: `ctx.${key}`, op, value })
export const YES = (id: string): Cond => ({ ...yes, ref: `ans.${id}` })

const YESNO: Option[] = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]

interface Base {
  id: string
  section: SectionId
  order: number
  label: string
  purpose: FieldDef["purpose"]
  legalSource?: string[]
}

function field(b: Base & Partial<FieldDef> & Pick<FieldDef, "type">): FieldDef {
  return {
    required: true,
    sensitivity: "PERSONAL",
    stage: "PRE_OFFER" as Stage,
    pdf: {},
    ...b,
    legalSource: b.legalSource ?? [],
  }
}

const doc = (documentClass: string, hint: string, sensitivity: EvidenceSpec["sensitivity"] = "sensitive"): EvidenceSpec => ({ documentClass, sensitivity, accept: ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"], hint })

const item = (i: ItemField): ItemField => i
const DATE_NOT_FUTURE = { notFuture: true }

const US = ctx("involvesUS", "truthy")
const CA = ctx("involvesCA", "truthy")
const DOT = ctx("dotDrugAlcohol", "truthy")
const hr = (id: string): Cond => ctx("hrItems", "includes", id)

export const FIELDS_V1: FieldDef[] = [
  // ---------------------------------------------------------------- identity
  field({ id: "identity.legal_first_name", section: "identity", order: 10, type: "text", label: "Legal first name", purpose: "IDENTITY", validation: { minLength: 1, maxLength: 60 }, legalSource: ["US_391_21"], pdf: { label: "Legal first name" } }),
  field({ id: "identity.legal_middle_name", section: "identity", order: 20, type: "text", label: "Legal middle name(s)", purpose: "IDENTITY", required: false, validation: { maxLength: 60 }, pdf: {} }),
  field({ id: "identity.legal_last_name", section: "identity", order: 30, type: "text", label: "Legal last name", purpose: "IDENTITY", validation: { minLength: 1, maxLength: 60 }, legalSource: ["US_391_21"], pdf: {} }),
  field({ id: "identity.has_previous_names", section: "identity", order: 40, type: "yesno", label: "Have you used any other name in the last 10 years?", purpose: "IDENTITY", help: "For example a maiden name. This is needed to find your records, such as licence and driving history.", pdf: { format: "yesno" } }),
  field({
    id: "identity.previous_names", section: "identity", order: 50, type: "repeatable", label: "Other names used", purpose: "IDENTITY", appliesWhen: YES("identity.has_previous_names"),
    validation: { minItems: 1, maxItems: 8 },
    itemFields: [
      item({ id: "name", type: "text", label: "Full name used", required: true, validation: { maxLength: 120 } }),
      item({ id: "from", type: "date", label: "Used from", required: false, validation: DATE_NOT_FUTURE }),
      item({ id: "to", type: "date", label: "Used until", required: false, validation: DATE_NOT_FUTURE }),
    ],
    pdf: { format: "table" },
  }),
  field({ id: "identity.phone", section: "identity", order: 60, type: "phone", label: "Mobile or main phone", purpose: "IDENTITY", validation: { minLength: 7, maxLength: 30, pattern: "^[0-9+()\\-.\\s]{7,30}$", patternMessage: "Enter a valid phone number." } }),
  field({ id: "identity.email", section: "identity", order: 70, type: "email", label: "Email address", purpose: "IDENTITY", validation: { maxLength: 200, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", patternMessage: "Enter a valid email address." } }),
  field({
    id: "identity.date_of_birth", section: "identity", order: 80, type: "date", label: "Date of birth", purpose: "REGULATORY", sensitivity: "SENSITIVE",
    help: "Used to match your licence and driving record. Asked at this stage only for operations in the United States; for Canadian operations it is requested after a conditional offer.",
    stage: "PRE_OFFER", stageWhenCanada: "CONDITIONAL_OFFER", validation: { notFuture: true, minAgeYears: 18 }, legalSource: ["US_391_21", "CA_HUMAN_RIGHTS_AGE"], pdf: { format: "date" },
  }),

  // ---------------------------------------------------------------- address history
  field({
    id: "address.history", section: "address", order: 10, type: "repeatable", label: "Where you have lived", purpose: "REGULATORY",
    help: "Start with your current address and go back until the last three years are covered.", validation: { minItems: 1, maxItems: 12, coverageYears: 3 },
    itemFields: [
      item({ id: "street", type: "text", label: "Street address", required: true, validation: { maxLength: 160 } }),
      item({ id: "city", type: "text", label: "City", required: true, validation: { maxLength: 80 } }),
      item({ id: "country", type: "select", label: "Country", required: true, options: [{ value: "US", label: "United States" }, { value: "CA", label: "Canada" }, { value: "OTHER", label: "Other" }] }),
      item({ id: "region", type: "select", label: "State / province", required: true, optionsRef: "jurisdictions.all", appliesWhen: { ref: "item.country", op: "in", value: ["US", "CA"] } }),
      item({ id: "postal", type: "text", label: "ZIP / postal code", required: true, validation: { maxLength: 12 } }),
      item({ id: "from", type: "date", label: "Lived here from", required: true, validation: DATE_NOT_FUTURE }),
      item({ id: "to", type: "date", label: "Until (leave empty if this is your current address)", required: false, validation: DATE_NOT_FUTURE }),
    ],
    legalSource: ["US_391_21"], pdf: { format: "table", label: "Residence history" },
  }),

  // ---------------------------------------------------------------- licence and driving record
  field({ id: "licence.has_commercial_licence", section: "licence", order: 10, type: "yesno", label: "Do you hold a current commercial driver's licence?", purpose: "REGULATORY", pdf: { format: "yesno" } }),
  field({ id: "licence.number", section: "licence", order: 20, type: "text", label: "Licence number", purpose: "REGULATORY", sensitivity: "SENSITIVE", appliesWhen: YES("licence.has_commercial_licence"), validation: { minLength: 4, maxLength: 30 }, legalSource: ["US_391_21", "US_383"], pdf: { mask: "LAST4" } }),
  field({ id: "licence.country", section: "licence", order: 30, type: "select", label: "Issuing country", purpose: "REGULATORY", appliesWhen: YES("licence.has_commercial_licence"), options: [{ value: "US", label: "United States" }, { value: "CA", label: "Canada" }] }),
  field({ id: "licence.jurisdiction", section: "licence", order: 40, type: "select", label: "Issuing state / province", purpose: "REGULATORY", appliesWhen: YES("licence.has_commercial_licence"), optionsRef: "jurisdictions.all" }),
  field({ id: "licence.class", section: "licence", order: 50, type: "text", label: "Licence class", purpose: "REGULATORY", appliesWhen: YES("licence.has_commercial_licence"), help: "For example Class A, AZ or DZ.", validation: { minLength: 1, maxLength: 20 } }),
  field({
    id: "licence.endorsements", section: "licence", order: 60, type: "multiselect", label: "Endorsements", purpose: "REGULATORY", required: false, appliesWhen: YES("licence.has_commercial_licence"),
    options: [
      { value: "H", label: "Hazardous materials (H)" }, { value: "N", label: "Tank vehicles (N)" }, { value: "P", label: "Passenger (P)" }, { value: "S", label: "School bus (S)" },
      { value: "T", label: "Double / triple trailers (T)" }, { value: "X", label: "Tank + hazmat (X)" }, { value: "AIR_BRAKES", label: "Air brakes" }, { value: "TDG", label: "TDG certificate (Canada)" },
    ],
    pdf: { format: "list" },
  }),
  field({ id: "licence.restrictions", section: "licence", order: 70, type: "text", label: "Restrictions or conditions on the licence", purpose: "REGULATORY", required: false, appliesWhen: YES("licence.has_commercial_licence"), validation: { maxLength: 200 } }),
  field({ id: "licence.issue_date", section: "licence", order: 80, type: "date", label: "Issue date", purpose: "REGULATORY", required: false, appliesWhen: YES("licence.has_commercial_licence"), validation: DATE_NOT_FUTURE, pdf: { format: "date" } }),
  field({ id: "licence.expiry_date", section: "licence", order: 90, type: "date", label: "Expiry date", purpose: "REGULATORY", appliesWhen: YES("licence.has_commercial_licence"), validation: { notPast: true }, pdf: { format: "date" } }),
  field({ id: "licence.first_commercial_date", section: "licence", order: 100, type: "date", label: "Date you first held a commercial licence", purpose: "REGULATORY", required: false, appliesWhen: YES("licence.has_commercial_licence"), validation: DATE_NOT_FUTURE, pdf: { format: "date" } }),
  field({ id: "licence.other_licences_3y", section: "licence", order: 110, type: "yesno", label: "Have you held a driver's licence from any other state or province in the last 3 years?", purpose: "REGULATORY", legalSource: ["US_391_21"], pdf: { format: "yesno" } }),
  field({
    id: "licence.previous_licences", section: "licence", order: 120, type: "repeatable", label: "Other licences held", purpose: "REGULATORY", appliesWhen: YES("licence.other_licences_3y"), validation: { minItems: 1, maxItems: 6 },
    itemFields: [
      item({ id: "number", type: "text", label: "Licence number", required: true, validation: { maxLength: 30 } }),
      item({ id: "jurisdiction", type: "select", label: "State / province", required: true, optionsRef: "jurisdictions.all" }),
      item({ id: "class", type: "text", label: "Class", required: false, validation: { maxLength: 20 } }),
      item({ id: "suspended_or_revoked", type: "yesno", label: "Was it ever suspended or revoked?", required: true }),
    ],
    pdf: { format: "table" },
  }),
  field({ id: "licence.denied_suspended_revoked", section: "licence", order: 130, type: "yesno", label: "Has any licence or permit of yours ever been denied, suspended, revoked or cancelled?", purpose: "REGULATORY", legalSource: ["US_391_21"], pdf: { format: "yesno" } }),
  field({ id: "licence.denied_suspended_revoked_details", section: "licence", order: 140, type: "textarea", label: "Please explain (when, where, why)", purpose: "REGULATORY", appliesWhen: YES("licence.denied_suspended_revoked"), validation: { minLength: 5, maxLength: 1000 } }),
  field({
    id: "licence.medical_certificate_status", section: "licence", order: 150, type: "select", label: "Medical certification for the vehicles you will operate", purpose: "REGULATORY",
    help: "We ask only whether you hold the medical certification the job requires, not about your health.",
    options: [{ value: "valid", label: "I hold a current, valid certificate" }, { value: "expired", label: "My certificate has expired" }, { value: "pending", label: "I have an examination booked" }, { value: "not_required", label: "None is required for my operation" }],
    legalSource: ["US_391_41", "CA_NSC_MEDICAL"], pdf: {},
  }),
  field({ id: "licence.medical_certificate_expiry", section: "licence", order: 160, type: "date", label: "Medical certificate expiry date", purpose: "REGULATORY", appliesWhen: ans("licence.medical_certificate_status", "valid"), validation: { notPast: true }, pdf: { format: "date" } }),
  field({
    id: "licence.drug_alcohol_history", section: "licence", order: 170, type: "yesno", purpose: "REGULATORY", appliesWhen: DOT,
    label: "In the last two years did you fail or refuse a DOT-required drug or alcohol test, or have any other DOT drug and alcohol rule violation?",
    legalSource: ["US_40_25", "US_382_701"], pdf: { format: "yesno" },
  }),
  field({ id: "licence.drug_alcohol_history_details", section: "licence", order: 180, type: "textarea", label: "Details, and return-to-duty / follow-up status", purpose: "REGULATORY", appliesWhen: { all: [DOT, YES("licence.drug_alcohol_history")] }, validation: { minLength: 5, maxLength: 1000 }, legalSource: ["US_40_25"] }),

  // ---------------------------------------------------------------- experience, accidents, convictions
  field({
    id: "experience.vehicle_categories", section: "experience", order: 10, type: "multiselect", label: "Vehicle types you have operated commercially", purpose: "HR",
    options: [
      { value: "straight_truck", label: "Straight truck" }, { value: "tractor_trailer", label: "Tractor-trailer" }, { value: "doubles_triples", label: "Doubles / triples / B-train" }, { value: "tanker", label: "Tanker" },
      { value: "flatbed", label: "Flatbed / open deck" }, { value: "reefer", label: "Refrigerated" }, { value: "dry_van", label: "Dry van" }, { value: "dump", label: "Dump / aggregate" }, { value: "passenger", label: "Passenger vehicle / bus" },
    ],
    validation: { minItems: 1 }, pdf: { format: "list" },
  }),
  field({ id: "experience.years_commercial", section: "experience", order: 20, type: "number", label: "Years of commercial driving experience", purpose: "HR", validation: { min: 0, max: 60 } }),
  field({
    id: "experience.operating_territories", section: "experience", order: 30, type: "multiselect", label: "Where you have driven commercially", purpose: "HR", required: false,
    options: [{ value: "local", label: "Local" }, { value: "regional", label: "Regional" }, { value: "us_domestic", label: "United States" }, { value: "canada_domestic", label: "Canada" }, { value: "cross_border", label: "Canada–U.S. cross-border" }],
    pdf: { format: "list" },
  }),
  field({ id: "experience.has_accidents_3y", section: "experience", order: 40, type: "yesno", label: "Have you been in any accident while driving a motor vehicle in the last 3 years?", purpose: "REGULATORY", legalSource: ["US_391_21"], pdf: { format: "yesno" } }),
  field({
    id: "experience.accidents", section: "experience", order: 50, type: "repeatable", label: "Accidents (last 3 years)", purpose: "REGULATORY", appliesWhen: YES("experience.has_accidents_3y"), validation: { minItems: 1, maxItems: 10 },
    itemFields: [
      item({ id: "date", type: "date", label: "Date", required: true, validation: DATE_NOT_FUTURE }),
      item({ id: "location", type: "text", label: "City and state / province", required: true, validation: { maxLength: 120 } }),
      item({ id: "fatalities", type: "number", label: "Fatalities", required: true, validation: { min: 0, max: 99 } }),
      item({ id: "injuries", type: "number", label: "Injuries", required: true, validation: { min: 0, max: 999 } }),
      item({ id: "hazmat_spill", type: "yesno", label: "Hazardous-materials spill?", required: true }),
      item({ id: "description", type: "textarea", label: "What happened", required: false, validation: { maxLength: 800 } }),
    ],
    legalSource: ["US_391_21"], pdf: { format: "table" },
  }),
  field({ id: "experience.has_violations_3y", section: "experience", order: 60, type: "yesno", label: "In the last 3 years have you been convicted of, or forfeited bail on, any traffic or motor-vehicle offence (other than parking)?", purpose: "REGULATORY", legalSource: ["US_391_21"], pdf: { format: "yesno" } }),
  field({
    id: "experience.violations", section: "experience", order: 70, type: "repeatable", label: "Traffic and motor-vehicle convictions (last 3 years)", purpose: "REGULATORY", appliesWhen: YES("experience.has_violations_3y"), validation: { minItems: 1, maxItems: 15 },
    itemFields: [
      item({ id: "date", type: "date", label: "Date of conviction", required: true, validation: DATE_NOT_FUTURE }),
      item({ id: "offence", type: "text", label: "Offence", required: true, validation: { maxLength: 160 } }),
      item({ id: "location", type: "text", label: "Place / court", required: true, validation: { maxLength: 120 } }),
      item({ id: "commercial_vehicle", type: "yesno", label: "In a commercial vehicle?", required: true }),
    ],
    legalSource: ["US_391_21"], pdf: { format: "table" },
  }),

  // ---------------------------------------------------------------- employment
  field({
    id: "employment.type", section: "employment", order: 10, type: "select", label: "How will you work with this carrier?", purpose: "HR",
    options: [{ value: "employee", label: "Employee driver" }, { value: "owner_operator", label: "Owner-operator" }, { value: "subcontractor", label: "Subcontractor" }],
  }),
  field({ id: "employment.vehicle_make_model", section: "employment", order: 20, type: "text", label: "Your truck: year, make and model", purpose: "HR", appliesWhen: ans("employment.type", "owner_operator"), validation: { maxLength: 120 } }),
  field({
    id: "employment.history", section: "employment", order: 30, type: "repeatable", label: "Employment history", purpose: "REGULATORY",
    help: "List every employer, most recent first. Include driving and non-driving jobs. The years required depend on your operation.",
    validation: { minItems: 1, maxItems: 20, coverageYears: "ctx.historyYears" },
    itemFields: [
      item({ id: "employer", type: "text", label: "Employer", required: true, validation: { maxLength: 160 } }),
      item({ id: "city", type: "text", label: "City", required: true, validation: { maxLength: 80 } }),
      item({ id: "region", type: "text", label: "State / province", required: true, validation: { maxLength: 40 } }),
      item({ id: "phone", type: "phone", label: "Employer phone", required: true, validation: { maxLength: 30 } }),
      item({ id: "email", type: "email", label: "Employer email", required: false, validation: { maxLength: 200 } }),
      item({ id: "position", type: "text", label: "Position held", required: true, validation: { maxLength: 120 } }),
      item({ id: "from", type: "date", label: "From", required: true, validation: DATE_NOT_FUTURE }),
      item({ id: "to", type: "date", label: "To (leave empty if current)", required: false, validation: DATE_NOT_FUTURE }),
      item({ id: "reason_for_leaving", type: "text", label: "Reason for leaving", required: false, validation: { maxLength: 200 } }),
      item({ id: "commercial_driving", type: "yesno", label: "Did the job involve driving a commercial vehicle?", required: true }),
      item({ id: "subject_to_fmcsr", type: "yesno", label: "Were you subject to the Federal Motor Carrier Safety Regulations in this job?", required: true, appliesWhen: { ref: "item.commercial_driving", op: "eq", value: "yes" } }),
      item({ id: "safety_sensitive_dot", type: "yesno", label: "Was this a safety-sensitive job covered by DOT drug and alcohol testing?", required: true, appliesWhen: { ref: "item.commercial_driving", op: "eq", value: "yes" } }),
      item({ id: "may_contact", type: "yesno", label: "May we contact this employer?", required: true }),
    ],
    legalSource: ["US_391_21", "US_391_23", "CA_PROV_CARRIER_RULES"], pdf: { format: "table", label: "Employment history" },
  }),
  field({ id: "employment.gap_explanation", section: "employment", order: 40, type: "textarea", label: "Please explain any period of more than 30 days when you were not employed", purpose: "REGULATORY", required: false, validation: { maxLength: 1500 } }),
  field({
    id: "employment.training", section: "employment", order: 50, type: "repeatable", label: "Driver training and courses", purpose: "HR", required: false, validation: { maxItems: 12 },
    itemFields: [
      item({ id: "course", type: "text", label: "Course", required: true, validation: { maxLength: 160 } }),
      item({ id: "provider", type: "text", label: "School or provider", required: true, validation: { maxLength: 160 } }),
      item({ id: "completed", type: "date", label: "Completed", required: false, validation: DATE_NOT_FUTURE }),
    ],
    pdf: { format: "table" },
  }),

  // ---------------------------------------------------------------- carrier HR screening (configured per carrier; legal matrix enforced server-side)
  field({ id: "hr.experience_confirmation", section: "hr", order: 10, type: "yesno", label: "Do you meet this carrier's minimum driving-experience requirement?", purpose: "HR", appliesWhen: hr("min_experience"), carrierPolicyRef: "hr:min_experience", pdf: { format: "yesno" } }),
  field({
    id: "hr.certificates", section: "hr", order: 20, type: "repeatable", label: "Certificates relevant to this job", purpose: "HR", required: false, appliesWhen: hr("certificates"), carrierPolicyRef: "hr:certificates", validation: { maxItems: 12 },
    itemFields: [
      item({ id: "name", type: "text", label: "Certificate", required: true, validation: { maxLength: 160 } }),
      item({ id: "number", type: "text", label: "Certificate number", required: false, validation: { maxLength: 60 } }),
      item({ id: "expiry", type: "date", label: "Expiry", required: false }),
    ],
    pdf: { format: "table" },
  }),
  field({
    id: "hr.references", section: "hr", order: 30, type: "repeatable", label: "Professional references", purpose: "HR", appliesWhen: hr("professional_references"), carrierPolicyRef: "hr:professional_references", validation: { minItems: 2, maxItems: 4 },
    itemFields: [
      item({ id: "name", type: "text", label: "Name", required: true, validation: { maxLength: 120 } }),
      item({ id: "relationship", type: "text", label: "How you know them", required: true, validation: { maxLength: 120 } }),
      item({ id: "phone", type: "phone", label: "Phone", required: true, validation: { maxLength: 30 } }),
      item({ id: "email", type: "email", label: "Email", required: false, validation: { maxLength: 200 } }),
      item({ id: "years_known", type: "number", label: "Years known", required: false, validation: { min: 0, max: 80 } }),
    ],
    pdf: { format: "table" },
  }),
  field({
    id: "hr.availability", section: "hr", order: 40, type: "select", label: "Availability", purpose: "HR", appliesWhen: hr("work_availability"), carrierPolicyRef: "hr:work_availability",
    options: [{ value: "immediate", label: "Available immediately" }, { value: "two_weeks", label: "Within two weeks" }, { value: "one_month", label: "Within a month" }, { value: "later", label: "Later" }],
  }),
  field({ id: "hr.available_from", section: "hr", order: 45, type: "date", label: "Earliest start date", purpose: "HR", required: false, appliesWhen: hr("work_availability"), carrierPolicyRef: "hr:work_availability", pdf: { format: "date" } }),
  field({
    id: "hr.equipment", section: "hr", order: 50, type: "multiselect", label: "Equipment you are experienced with", purpose: "HR", required: false, appliesWhen: hr("equipment_experience"), carrierPolicyRef: "hr:equipment_experience",
    options: [{ value: "manual", label: "Manual transmission" }, { value: "automatic", label: "Automatic / AMT" }, { value: "eld", label: "Electronic logging device" }, { value: "reefer_unit", label: "Refrigeration unit" }, { value: "tarping", label: "Tarping / securement" }, { value: "pto", label: "PTO / pump" }],
    pdf: { format: "list" },
  }),
  field({ id: "hr.essential_duties", section: "hr", order: 60, type: "yesno", label: "Are you able to perform the essential duties of this position, with or without reasonable accommodation?", purpose: "HR", appliesWhen: hr("carrier_job_qualifications"), carrierPolicyRef: "hr:carrier_job_qualifications", pdf: { format: "yesno" } }),
  field({ id: "hr.irregular_schedule", section: "hr", order: 70, type: "yesno", label: "Are you willing to work overnight or irregular schedules when the job requires it?", purpose: "HR", appliesWhen: hr("carrier_job_qualifications"), carrierPolicyRef: "hr:carrier_job_qualifications", pdf: { format: "yesno" } }),
  field({ id: "hr.cross_border_willing", section: "hr", order: 80, type: "yesno", label: "Are you willing to cross the Canada–U.S. border when the job requires it?", purpose: "HR", appliesWhen: { all: [hr("carrier_job_qualifications"), US, CA] }, carrierPolicyRef: "hr:carrier_job_qualifications", pdf: { format: "yesno" } }),

  // ---------------------------------------------------------------- eligibility to work and to cross the border (three distinct questions)
  field({
    id: "eligibility.authorized_us", section: "eligibility", order: 10, type: "yesno", label: "Are you legally authorized to work in the United States?", purpose: "ELIGIBILITY", appliesWhen: US,
    help: "We ask only whether you are authorized to work, not your citizenship or origin. Documents are requested later, only after a conditional offer.", legalSource: ["US_8_1324B"], pdf: { format: "yesno" },
  }),
  field({
    id: "eligibility.authorized_ca", section: "eligibility", order: 20, type: "yesno", label: "Are you legally entitled to work in Canada?", purpose: "ELIGIBILITY", appliesWhen: CA,
    help: "We ask only whether you are entitled to work, not your citizenship or origin. Documents are requested later, only after a conditional offer.", legalSource: ["CA_HUMAN_RIGHTS_ORIGIN"], pdf: { format: "yesno" },
  }),
  field({
    id: "eligibility.can_enter_us", section: "eligibility", order: 30, type: "select", label: "Can you enter the United States as the job requires?", purpose: "ELIGIBILITY", appliesWhen: { all: [US, CA] },
    help: "Entering a country, being allowed to work there, and being qualified to drive are three different things. This question is only about entry for work travel.",
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "pending", label: "In progress" }], pdf: {},
  }),
  field({
    id: "eligibility.can_enter_canada", section: "eligibility", order: 40, type: "select", label: "Can you enter Canada as the job requires?", purpose: "ELIGIBILITY", appliesWhen: { all: [US, CA] },
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "pending", label: "In progress" }], pdf: {},
  }),
  field({
    id: "eligibility.border_programs", section: "eligibility", order: 50, type: "multiselect", label: "Border programs you are enrolled in (optional)", purpose: "ELIGIBILITY", required: false, appliesWhen: { all: [US, CA] },
    options: [{ value: "fast", label: "FAST" }, { value: "nexus", label: "NEXUS" }, { value: "other", label: "Other" }], pdf: { format: "list" },
  }),
  field({
    id: "eligibility.documents_basis", section: "eligibility", order: 60, type: "select", label: "Which kind of document will you provide to confirm your authorization to work?", purpose: "ELIGIBILITY",
    help: "Collected only after a conditional offer. TES does not decide eligibility from nationality, passport origin or a tax number.", stage: "CONDITIONAL_OFFER", sensitivity: "SENSITIVE", appliesWhen: { any: [US, CA] },
    options: [{ value: "citizenship_proof", label: "Proof of citizenship" }, { value: "permanent_residence", label: "Permanent-residence document" }, { value: "work_permit", label: "Work permit / employment authorization" }, { value: "visa", label: "Visa" }, { value: "other", label: "Other document" }],
    legalSource: ["US_8_1324A", "CA_IRPA_WORK"], pdf: {},
  }),
  field({
    id: "eligibility.passport_number", section: "eligibility", order: 70, type: "sensitive", label: "Passport number", purpose: "ELIGIBILITY", stage: "CONDITIONAL_OFFER", sensitivity: "RESTRICTED", required: false,
    appliesWhen: { all: [US, CA] }, help: "Needed only to confirm you can travel across the border for work. Stored encrypted; never shown in full.", collectionGates: ["VAULT_KEY", "LEGAL_APPROVAL"], legalSource: ["US_8_1324A"], pdf: { mask: "LAST4" },
  }),
  field({
    id: "eligibility.ssn", section: "eligibility", order: 80, type: "sensitive", label: "Social Security number", purpose: "REGULATORY", stage: "PRE_OFFER", sensitivity: "RESTRICTED", required: true,
    appliesWhen: ctx("collectSsn", "truthy"), help: "Required on a U.S. driver application. Stored encrypted; only the last four digits are ever displayed.", collectionGates: ["VAULT_KEY", "LEGAL_APPROVAL"], legalSource: ["US_391_21"], pdf: { mask: "LAST4" },
  }),
  field({
    id: "eligibility.sin", section: "eligibility", order: 90, type: "sensitive", label: "Social Insurance Number", purpose: "HR", stage: "POST_OFFER", sensitivity: "RESTRICTED", required: false,
    appliesWhen: CA, help: "Requested only after you are hired, for payroll and tax reporting. Stored encrypted; only the last three digits are ever displayed.", collectionGates: ["VAULT_KEY", "LEGAL_APPROVAL"], legalSource: ["CA_SIN_GUIDANCE"], pdf: { mask: "LAST4" },
  }),

  // ---------------------------------------------------------------- documents (uploaded through the evidence pipeline)
  field({ id: "docs.driver_photo", section: "documents", order: 10, type: "upload", label: "Photo of yourself", purpose: "IDENTITY", required: false, evidence: doc("DRIVER_PHOTO", "A clear, recent head-and-shoulders photo.", "sensitive"), pdf: {} }),
  field({ id: "docs.licence_front", section: "documents", order: 20, type: "upload", label: "Driver's licence — front", purpose: "REGULATORY", appliesWhen: YES("licence.has_commercial_licence"), evidence: doc("DRIVER_LICENCE_FRONT", "The whole card, no glare, text readable."), legalSource: ["US_391_21"], pdf: {} }),
  field({ id: "docs.licence_back", section: "documents", order: 30, type: "upload", label: "Driver's licence — back", purpose: "REGULATORY", appliesWhen: YES("licence.has_commercial_licence"), evidence: doc("DRIVER_LICENCE_BACK", "The whole card, no glare, text readable."), pdf: {} }),
  field({ id: "docs.medical_certificate", section: "documents", order: 40, type: "upload", label: "Medical certificate", purpose: "REGULATORY", required: false, appliesWhen: ans("licence.medical_certificate_status", "valid"), evidence: doc("MEDICAL_CERTIFICATE", "The current medical examiner's certificate or provincial medical form.", "sensitive"), legalSource: ["US_391_41"], pdf: {} }),
  field({ id: "docs.training_certificates", section: "documents", order: 50, type: "upload", label: "Training or course certificates", purpose: "HR", required: false, evidence: doc("TRAINING_CERTIFICATE", "Any certificates relevant to the job.", "standard"), pdf: {} }),
  field({ id: "docs.driving_abstract", section: "documents", order: 60, type: "upload", label: "Driver abstract / motor-vehicle record you already hold", purpose: "REGULATORY", required: false, evidence: doc("DRIVING_ABSTRACT", "Optional. TES or the carrier may also request your record directly with your authorization."), pdf: {} }),
  field({ id: "docs.identity_document", section: "documents", order: 70, type: "upload", label: "Government photo identification", purpose: "IDENTITY", required: false, stage: "CONDITIONAL_OFFER", sensitivity: "RESTRICTED", appliesWhen: { any: [US, CA] }, evidence: doc("IDENTITY_DOCUMENT", "Collected only after a conditional offer. Access is restricted.", "restricted"), pdf: {} }),
  field({ id: "docs.passport", section: "documents", order: 80, type: "upload", label: "Passport (photo page)", purpose: "ELIGIBILITY", required: false, stage: "CONDITIONAL_OFFER", sensitivity: "RESTRICTED", appliesWhen: { all: [US, CA] }, evidence: doc("PASSPORT", "Only the photo page. Access is restricted.", "restricted"), legalSource: ["US_8_1324A"], pdf: {} }),
  field({ id: "docs.work_authorization", section: "documents", order: 90, type: "upload", label: "Work permit, visa or other work-authorization document", purpose: "ELIGIBILITY", required: false, stage: "CONDITIONAL_OFFER", sensitivity: "RESTRICTED", appliesWhen: { any: [US, CA] }, evidence: doc("WORK_AUTHORIZATION", "Only if you were asked to provide one. Access is restricted.", "restricted"), legalSource: ["US_8_1324A", "CA_IRPA_WORK"], pdf: {} }),
  field({ id: "docs.other", section: "documents", order: 100, type: "upload", label: "Anything else you would like to include", purpose: "HR", required: false, evidence: doc("OTHER_SUPPORTING", "Optional supporting documents.", "standard"), pdf: {} }),
]

export { YESNO }
