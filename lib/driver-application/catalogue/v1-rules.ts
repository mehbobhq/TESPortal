import type { ConsentDef, HrItemDef, LegalSource, RequirementDef, SectionDef, Stage } from "./types"
import { ctx } from "./v1-fields"

/**
 * Legal sources the catalogue refers to. They identify WHERE a requirement comes from so counsel can verify each one. None of them has been verified:
 * TES makes no compliance claim from this table, and every rule that cites a source stays subject to jurisdiction-specific legal review.
 */
export const LEGAL_SOURCES_V1: Record<string, LegalSource> = {
  US_391_21: { citation: "49 CFR 391.21 (application for employment)", jurisdiction: "US", note: "Content of the driver application for drivers subject to the FMCSRs, including identity, residence, licence, accident and violation history, employment history.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_391_23: { citation: "49 CFR 391.23 (investigation and inquiries)", jurisdiction: "US", note: "Previous-employer safety performance history and driving record inquiries.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_391_41: { citation: "49 CFR 391.41 / 391.43 (physical qualifications; medical certificate)", jurisdiction: "US", note: "Medical examiner's certificate for drivers of certain commercial motor vehicles.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_383: { citation: "49 CFR Part 383 (commercial driver's licence standards)", jurisdiction: "US", note: "CDL classes, endorsements and restrictions.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_40_25: { citation: "49 CFR 40.25 (previous-employer drug and alcohol testing information)", jurisdiction: "US", note: "Written consent and inquiry for previous-employer testing information.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_382_701: { citation: "49 CFR 382.701 (FMCSA Drug & Alcohol Clearinghouse queries)", jurisdiction: "US", note: "Limited and full queries; the full query consent is given inside the Clearinghouse itself.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_8_1324A: { citation: "8 U.S.C. 1324a; 8 CFR 274a (employment eligibility verification)", jurisdiction: "US", note: "Form I-9 verification occurs after hire; documents may not be demanded pre-offer.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_8_1324B: { citation: "8 U.S.C. 1324b (unfair immigration-related employment practices)", jurisdiction: "US", note: "Limits on citizenship and national-origin inquiries.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_FCRA_1681B: { citation: "15 U.S.C. 1681b(b) (Fair Credit Reporting Act: standalone disclosure, authorization, adverse action)", jurisdiction: "US", note: "Applies when a consumer report is obtained for employment purposes.", verification: "UNVERIFIED_BY_COUNSEL" },
  US_PSP_31150: { citation: "49 U.S.C. 31150 (FMCSA Pre-Employment Screening Program)", jurisdiction: "US", note: "PSP records require the driver's authorization and the FMCSA-prescribed disclosure process.", verification: "UNVERIFIED_BY_COUNSEL" },
  CA_HUMAN_RIGHTS_AGE: { citation: "Canadian federal and provincial human-rights legislation (age and other protected grounds in hiring)", jurisdiction: "CA", note: "Limits pre-offer questions that reveal protected grounds, such as date of birth; varies by province.", verification: "UNVERIFIED_BY_COUNSEL" },
  CA_HUMAN_RIGHTS_ORIGIN: { citation: "Canadian federal and provincial human-rights legislation (citizenship, place of origin)", jurisdiction: "CA", note: "Restricts citizenship and origin questions before an offer; entitlement-to-work questions are treated differently.", verification: "UNVERIFIED_BY_COUNSEL" },
  CA_NSC_MEDICAL: { citation: "National Safety Code standards and provincial medical requirements for commercial drivers", jurisdiction: "CA_PROVINCE", note: "Medical fitness requirements vary by province and vehicle class.", verification: "UNVERIFIED_BY_COUNSEL" },
  CA_PROV_CARRIER_RULES: { citation: "Provincial carrier and driver-file rules (for example Alberta's employment-history rule)", jurisdiction: "CA_PROVINCE", note: "Employment-history length and driver-file content differ by province.", verification: "UNVERIFIED_BY_COUNSEL" },
  CA_IRPA_WORK: { citation: "Immigration and Refugee Protection Act and regulations (authorization to work)", jurisdiction: "CA", note: "Work permits and conditions; entitlement to work is distinct from entry and from driving qualification.", verification: "UNVERIFIED_BY_COUNSEL" },
  CA_SIN_GUIDANCE: { citation: "Government of Canada guidance on collection of the Social Insurance Number", jurisdiction: "CA", note: "Collect only when required by law, generally after hire for payroll and tax reporting.", verification: "UNVERIFIED_BY_COUNSEL" },
  CA_PRIVACY: { citation: "PIPEDA and provincial private-sector privacy legislation (purpose, consent, safeguards)", jurisdiction: "CA", note: "Purpose limitation, consent and safeguards for personal information.", verification: "UNVERIFIED_BY_COUNSEL" },
}

export const SECTIONS_V1: SectionDef[] = [
  { id: "identity", title: "About you", intro: "Your legal name and how to reach you.", order: 10 },
  { id: "address", title: "Where you have lived", intro: "Your residence history, current address first.", order: 20 },
  { id: "licence", title: "Licence and driving record", intro: "Your licence, medical certification and driving record.", order: 30 },
  { id: "experience", title: "Driving experience and safety history", intro: "What you have driven, and any accidents or convictions.", order: 40 },
  { id: "employment", title: "Employment history", intro: "Your employers, so they can be contacted with your authorization.", order: 50 },
  { id: "hr", title: "This carrier's requirements", intro: "Questions this carrier uses to assess fit for the job.", order: 60 },
  { id: "eligibility", title: "Work and travel eligibility", intro: "Being allowed to work, being allowed to enter a country, and being qualified to drive are separate questions.", order: 70 },
  { id: "documents", title: "Documents", intro: "Upload clear copies. Files are scanned and stored securely.", order: 80 },
  { id: "authorizations", title: "Authorizations and certification", intro: "Each authorization is separate, has a stated purpose, and can be read in full before you sign.", order: 90 },
]

const C = (s: string) => ctx(s, "truthy")

const DRAFT = "Draft wording — pending legal review. This text has not been approved by counsel and cannot yet be relied on for any check. "

export const CONSENTS_V1: ConsentDef[] = [
  {
    key: "electronic_records", version: "1", title: "Electronic records and signature", purpose: "Receive, review and sign this application and related records electronically.",
    text: DRAFT + "I agree to complete, review and sign this application and related records electronically, and that my typed name below is my signature. I may ask for a paper copy.",
    legalStatus: "PENDING_LEGAL_REVIEW", scope: { records: "this application" }, authorizedParties: ["Hiring carrier", "TES (on the carrier's behalf)"], stage: "PRE_OFFER", legalSource: [], supports: [],
  },
  {
    key: "employer_investigation", version: "1", title: "Previous-employer investigation", purpose: "Contact the previous employers listed in this application to verify employment dates, position and safety performance history.",
    text: DRAFT + "I authorize the hiring carrier, and TES acting on its behalf, to contact the previous employers I have listed to verify my employment dates, position, reason for leaving and, where applicable, my safety performance history, and I authorize those employers to release that information.",
    legalStatus: "PENDING_LEGAL_REVIEW", scope: { source: "employment.history", items: "dates, position, reason for leaving, safety performance history" }, authorizedParties: ["Hiring carrier", "TES (on the carrier's behalf)", "Previous employers listed"], stage: "PRE_OFFER",
    legalSource: ["US_391_23", "CA_PROV_CARRIER_RULES", "CA_PRIVACY"], supports: ["previous_employer"],
  },
  {
    key: "driving_record", version: "1", title: "Driving record (abstract / MVR)", purpose: "Request my driving record from the licensing authority of each jurisdiction where I have held a licence.",
    text: DRAFT + "I authorize the hiring carrier, and TES acting on its behalf, to obtain my driving record (driver abstract or motor-vehicle record) from the licensing authority of each state or province listed in this application, for the purpose of assessing my qualification to drive for this carrier.",
    legalStatus: "PENDING_LEGAL_REVIEW", scope: { source: "licence.*", items: "driving record from licensing authorities" }, authorizedParties: ["Hiring carrier", "TES (on the carrier's behalf)", "Licensing authorities"], stage: "PRE_OFFER",
    legalSource: ["US_391_23", "CA_PROV_CARRIER_RULES", "CA_PRIVACY"], supports: ["driving_record", "licence_validity"],
  },
  {
    key: "drug_alcohol_history_release", version: "1", title: "Previous-employer DOT drug and alcohol testing information", purpose: "Release of DOT drug and alcohol testing information held by my previous DOT-regulated employers.",
    text: DRAFT + "I authorize my previous DOT-regulated employers listed in this application to release to the hiring carrier, and TES acting on its behalf, information about any DOT drug or alcohol test result, refusal or other violation during the last two years, as the DOT rules permit.",
    legalStatus: "PENDING_LEGAL_REVIEW", scope: { source: "employment.history", items: "DOT drug and alcohol testing information, last two years" }, authorizedParties: ["Hiring carrier", "TES (on the carrier's behalf)", "Previous DOT-regulated employers listed"],
    appliesWhen: C("dotDrugAlcohol"), stage: "PRE_OFFER", legalSource: ["US_40_25"], supports: ["previous_employer"],
  },
  {
    key: "clearinghouse_limited_query", version: "1", title: "FMCSA Drug & Alcohol Clearinghouse — limited query consent", purpose: "Allow the carrier to run a limited query of the FMCSA Clearinghouse.",
    text: DRAFT + "I give the hiring carrier permission to conduct a limited query of the FMCSA Drug & Alcohol Clearinghouse to learn whether information about me exists there. This is separate from, and does not replace, the consent I must give inside the Clearinghouse itself if a full query is needed.",
    legalStatus: "PENDING_LEGAL_REVIEW", scope: { source: "FMCSA Clearinghouse", items: "limited query only" }, authorizedParties: ["Hiring carrier"], appliesWhen: C("dotDrugAlcohol"), stage: "PRE_OFFER", legalSource: ["US_382_701"], supports: ["clearinghouse"],
  },
  {
    key: "psp", version: "1", title: "FMCSA Pre-Employment Screening Program (PSP)", purpose: "PSP authorization is captured through the FMCSA-prescribed standalone disclosure, outside this application.",
    text: "The carrier intends to request a PSP report. FMCSA prescribes a standalone disclosure and authorization for this. TES does not capture that authorization on this page and a checkbox here is not a substitute: the carrier or its PSP provider will present the official disclosure to you separately.",
    legalStatus: "EXTERNAL_PROCESS_REQUIRED", scope: { source: "FMCSA PSP" }, authorizedParties: ["Hiring carrier", "PSP provider"], appliesWhen: C("psp"), stage: "PRE_OFFER", external: true, standalone: true, legalSource: ["US_PSP_31150"], supports: ["psp"],
  },
  {
    key: "criminal_background", version: "1", title: "Criminal background screening", purpose: "A job-related criminal background check, requested only after a conditional offer.",
    text: DRAFT + "After a conditional offer, I authorize the hiring carrier, and its screening provider acting on its behalf, to obtain a criminal background check about me limited to what is lawful and relevant to the position.",
    legalStatus: "PENDING_LEGAL_REVIEW", scope: { source: "criminal background screening", timing: "after conditional offer" }, authorizedParties: ["Hiring carrier", "Screening provider"], appliesWhen: C("hrBackgroundScreening"), stage: "CONDITIONAL_OFFER",
    legalSource: ["US_FCRA_1681B", "CA_HUMAN_RIGHTS_AGE", "CA_PRIVACY"], supports: ["criminal_background"],
  },
  {
    key: "consumer_report_disclosure", version: "1", title: "Consumer report disclosure and authorization (U.S.)", purpose: "Disclosure that a consumer report may be obtained for employment purposes, and my authorization.",
    text: DRAFT + "This is a standalone disclosure. A consumer report may be obtained about me for employment purposes. I authorize the hiring carrier and its consumer reporting agency to obtain it.",
    legalStatus: "PENDING_LEGAL_REVIEW", scope: { source: "consumer report", purpose: "employment" }, authorizedParties: ["Hiring carrier", "Consumer reporting agency"], appliesWhen: { all: [C("hrBackgroundScreening"), C("involvesUS")] }, stage: "CONDITIONAL_OFFER", standalone: true,
    legalSource: ["US_FCRA_1681B"], supports: ["criminal_background"],
  },
  {
    key: "applicant_certification", version: "1", title: "Applicant certification", purpose: "Certify that the information in this application is true and complete.",
    text: DRAFT + "I certify that the information in this application is true and complete to the best of my knowledge. I understand that a false statement or omission may be grounds for refusing or ending employment, and that the carrier may verify what I have provided.",
    legalStatus: "PENDING_LEGAL_REVIEW", scope: { source: "this application" }, authorizedParties: ["Hiring carrier"], stage: "PRE_OFFER", legalSource: [], supports: [],
  },
]

export const REQUIREMENTS_V1: RequirementDef[] = [
  { key: "identity", type: "IDENTITY", title: "Identity confirmed against the licence and identification", stage: "PRE_OFFER", requiredForQualification: true, evidenceClasses: ["DRIVER_LICENCE_FRONT", "DRIVER_LICENCE_BACK", "IDENTITY_DOCUMENT"], legalSource: ["US_391_21"] },
  { key: "licence_validity", type: "LICENCE", title: "Licence class, endorsements and validity verified", stage: "PRE_OFFER", requiredForQualification: true, consentKey: "driving_record", evidenceClasses: ["DRIVER_LICENCE_FRONT", "DRIVING_ABSTRACT"], legalSource: ["US_383", "CA_PROV_CARRIER_RULES"] },
  { key: "medical_certificate", type: "MEDICAL", title: "Required medical certification verified", stage: "PRE_OFFER", requiredForQualification: true, evidenceClasses: ["MEDICAL_CERTIFICATE"], legalSource: ["US_391_41", "CA_NSC_MEDICAL"] },
  { key: "previous_employer", type: "PREVIOUS_EMPLOYER", title: "Previous-employer investigation completed", stage: "PRE_OFFER", requiredForQualification: true, consentKey: "employer_investigation", legalSource: ["US_391_23", "CA_PROV_CARRIER_RULES"] },
  { key: "driving_record", type: "DRIVING_RECORD", title: "Driving record obtained and reviewed", stage: "PRE_OFFER", requiredForQualification: true, consentKey: "driving_record", evidenceClasses: ["DRIVING_ABSTRACT"], legalSource: ["US_391_23", "CA_PROV_CARRIER_RULES"] },
  { key: "clearinghouse", type: "CLEARINGHOUSE", title: "FMCSA Clearinghouse query completed (limited query; full query is a separate Clearinghouse process)", appliesWhen: C("dotDrugAlcohol"), stage: "PRE_OFFER", requiredForQualification: true, consentKey: "clearinghouse_limited_query", external: true, legalSource: ["US_382_701"] },
  { key: "psp", type: "PSP", title: "PSP report obtained (only where authorized through the standalone FMCSA process)", appliesWhen: C("psp"), stage: "PRE_OFFER", requiredForQualification: false, consentKey: "psp", external: true, legalSource: ["US_PSP_31150"] },
  { key: "work_eligibility", type: "WORK_ELIGIBILITY", title: "Authorization to work verified after the conditional offer (distinct from entry and driving qualification)", stage: "CONDITIONAL_OFFER", requiredForQualification: true, evidenceClasses: ["WORK_AUTHORIZATION", "PASSPORT", "IDENTITY_DOCUMENT"], legalSource: ["US_8_1324A", "CA_IRPA_WORK"] },
  { key: "criminal_background", type: "CRIMINAL_BACKGROUND", title: "Job-related criminal background screening completed", appliesWhen: C("hrBackgroundScreening"), stage: "CONDITIONAL_OFFER", requiredForQualification: true, consentKey: "criminal_background", legalSource: ["US_FCRA_1681B", "CA_PRIVACY"] },
  { key: "references", type: "REFERENCES", title: "Professional references contacted", appliesWhen: { ref: "ctx.hrItems", op: "includes", value: "professional_references" }, stage: "PRE_OFFER", requiredForQualification: false, legalSource: [] },
]

const allow = (pre: "ALLOWED" | "RESTRICTED" | "PROHIBITED", cond: "ALLOWED" | "RESTRICTED" | "PROHIBITED", post: "ALLOWED" | "RESTRICTED" | "PROHIBITED") => ({ PRE_OFFER: pre, CONDITIONAL_OFFER: cond, POST_OFFER: post }) as Record<Stage, "ALLOWED" | "RESTRICTED" | "PROHIBITED">

export const HR_ITEMS_V1: HrItemDef[] = [
  { id: "min_experience", title: "Minimum driving-experience confirmation", description: "Confirms the applicant meets the carrier's minimum experience.", matrix: { US: allow("ALLOWED", "ALLOWED", "ALLOWED"), CA: allow("ALLOWED", "ALLOWED", "ALLOWED") }, legalSource: [], fields: ["hr.experience_confirmation"] },
  { id: "certificates", title: "Relevant certificates", description: "Job-related certificates (for example hazmat or TDG training).", matrix: { US: allow("ALLOWED", "ALLOWED", "ALLOWED"), CA: allow("ALLOWED", "ALLOWED", "ALLOWED") }, legalSource: [], fields: ["hr.certificates"] },
  { id: "professional_references", title: "Professional references", description: "Two to four professional references.", matrix: { US: allow("ALLOWED", "ALLOWED", "ALLOWED"), CA: allow("ALLOWED", "ALLOWED", "ALLOWED") }, legalSource: ["CA_PRIVACY"], fields: ["hr.references"], requirementKeys: ["references"] },
  { id: "work_availability", title: "Work availability", description: "Start date and availability.", matrix: { US: allow("ALLOWED", "ALLOWED", "ALLOWED"), CA: allow("ALLOWED", "ALLOWED", "ALLOWED") }, legalSource: [], fields: ["hr.availability", "hr.available_from"] },
  { id: "equipment_experience", title: "Equipment experience", description: "Job-related equipment the applicant has used.", matrix: { US: allow("ALLOWED", "ALLOWED", "ALLOWED"), CA: allow("ALLOWED", "ALLOWED", "ALLOWED") }, legalSource: [], fields: ["hr.equipment"] },
  { id: "carrier_job_qualifications", title: "Essential job duties and schedule", description: "Confirmation of essential duties (with or without accommodation), irregular schedules and, where relevant, border travel.", matrix: { US: allow("ALLOWED", "ALLOWED", "ALLOWED"), CA: allow("RESTRICTED", "ALLOWED", "ALLOWED") }, legalSource: ["CA_HUMAN_RIGHTS_AGE"], fields: ["hr.essential_duties", "hr.irregular_schedule", "hr.cross_border_willing"] },
  { id: "background_screening", title: "Criminal background screening (after a conditional offer)", description: "A job-related criminal background check with its own authorization.", matrix: { US: allow("RESTRICTED", "ALLOWED", "ALLOWED"), CA: allow("PROHIBITED", "RESTRICTED", "RESTRICTED") }, legalSource: ["US_FCRA_1681B", "CA_HUMAN_RIGHTS_AGE", "CA_PRIVACY"], fields: [], requirementKeys: ["criminal_background"] },
  { id: "credit_check", title: "Credit check", description: "Not available in this version.", matrix: { US: allow("PROHIBITED", "PROHIBITED", "PROHIBITED"), CA: allow("PROHIBITED", "PROHIBITED", "PROHIBITED") }, legalSource: ["US_FCRA_1681B"], fields: [] },
  { id: "social_media_review", title: "Social-media review", description: "Not available in this version.", matrix: { US: allow("PROHIBITED", "PROHIBITED", "PROHIBITED"), CA: allow("PROHIBITED", "PROHIBITED", "PROHIBITED") }, legalSource: ["CA_PRIVACY"], fields: [] },
  { id: "citizenship_inquiry", title: "Citizenship or national-origin questions", description: "Never available: eligibility is asked only as authorization to work.", matrix: { US: allow("PROHIBITED", "PROHIBITED", "PROHIBITED"), CA: allow("PROHIBITED", "PROHIBITED", "PROHIBITED") }, legalSource: ["US_8_1324B", "CA_HUMAN_RIGHTS_ORIGIN"], fields: [] },
]
