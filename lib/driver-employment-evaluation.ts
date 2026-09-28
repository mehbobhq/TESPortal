export type EmploymentEvaluationStatus = "Not Started" | "In Progress" | "Awaiting Response" | "Review Required" | "Complete"

export type HiringEvaluationRequirement = {
  id: string
  label: string
  authority: "FMCSA" | "Canadian Jurisdiction / NSC" | "Carrier Policy" | "Other"
  applicability: "Required" | "Not Required" | "Review Applicability"
  status: "Not Started" | "Requested" | "Received" | "Verified" | "Unable to Verify" | "Review Required" | "Not Applicable"
  evidenceIds: string[]
  rationale: string
}

export type EmployerContactAttempt = {
  id: string
  attemptedAt: string
  method: "Email" | "Phone" | "Portal" | "Mail" | "Other"
  outcome: string
}

export type EmploymentEvaluationRecord = {
  id: string
  companyId: string
  applicationId: string
  employerName: string
  employerContact: string
  employmentStartDate: string
  employmentEndDate: string
  regulatedCommercialDriving: "" | "yes" | "no" | "unknown"
  positionTitle: string
  performanceResponse: "" | "Good" | "Average" | "Poor" | "Not Provided"
  performanceDetails: string
  separationResponse: "" | "Dismissed" | "Resigned" | "Laid Off" | "Other" | "Not Provided"
  separationDetails: string
  drugAlcoholTestingRequired: "" | "yes" | "no" | "unknown"
  rehireResponse: "" | "yes" | "no" | "upon-review" | "not-provided"
  rehireDetails: string
  drugAlcoholIssueResponse: "" | "yes" | "no" | "not-applicable" | "not-provided"
  rehabilitationResponse: "" | "yes" | "no" | "not-applicable" | "not-provided"
  postRehabIssueResponse: "" | "yes" | "no" | "not-applicable" | "not-provided"
  operatingRegions: string[]
  equipmentTypes: string[]
  incidentsOrCitations: "" | "yes" | "no" | "not-applicable" | "not-provided"
  incidentDetails: string
  informationProvidedBy: string
  providerPosition: string
  responseDate: string
  attempts: EmployerContactAttempt[]
  noHistoryCertification: boolean
  applicantDisputesInformation: boolean
  applicantStatement: string
  employerRevisionResponse: "" | "Information Accurate" | "Revised" | "No Response"
  employerRevisionNotes: string
  drugAlcoholRecordsRequestNeeded: boolean
  drugAlcoholRecordsStatus: "" | "Requested" | "Provided" | "No Information Available" | "Unable to Release"
  notes: string
  evidenceIds: string[]
  verificationOutcome: "" | "Verified" | "Partially Verified" | "Unable to Verify" | "Discrepancy / Clarification Required"
  qualificationImpact: "" | "No Issue Identified" | "Review Required" | "Requirement Not Met" | "Not Assessed"
  assessmentRationale: string
  status: EmploymentEvaluationStatus
  createdAt: string
  updatedAt: string
}

const key = (companyId: string, applicationId: string) => `tes:employment-evaluations:${companyId}:${applicationId}`

export function loadEmploymentEvaluations(companyId: string, applicationId: string): EmploymentEvaluationRecord[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key(companyId, applicationId)) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function saveEmploymentEvaluations(companyId: string, applicationId: string, records: EmploymentEvaluationRecord[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key(companyId, applicationId), JSON.stringify(records))
}

export function createEmploymentEvaluation(companyId: string, applicationId: string): EmploymentEvaluationRecord {
  const now = new Date().toISOString()
  return {
    id: `EE-${Date.now()}`, companyId, applicationId, employerName: "", employerContact: "",
    employmentStartDate: "", employmentEndDate: "", regulatedCommercialDriving: "", positionTitle: "",
    performanceResponse: "", performanceDetails: "", separationResponse: "", separationDetails: "",
    drugAlcoholTestingRequired: "", rehireResponse: "", rehireDetails: "", drugAlcoholIssueResponse: "",
    rehabilitationResponse: "", postRehabIssueResponse: "", operatingRegions: [], equipmentTypes: [],
    incidentsOrCitations: "", incidentDetails: "", informationProvidedBy: "", providerPosition: "",
    responseDate: "", attempts: [], noHistoryCertification: false, applicantDisputesInformation: false,
    applicantStatement: "", employerRevisionResponse: "", employerRevisionNotes: "",
    drugAlcoholRecordsRequestNeeded: false, drugAlcoholRecordsStatus: "", notes: "", evidenceIds: [], verificationOutcome: "", qualificationImpact: "Not Assessed", assessmentRationale: "",
    status: "Not Started", createdAt: now, updatedAt: now,
  }
}

export function deriveEmploymentEvaluationStatus(record: EmploymentEvaluationRecord): EmploymentEvaluationStatus {
  if (record.applicantDisputesInformation && !record.employerRevisionResponse) return "Review Required"
  if (record.verificationOutcome === "Discrepancy / Clarification Required" || ["Review Required","Requirement Not Met"].includes(record.qualificationImpact)) return "Review Required"
  if (record.drugAlcoholRecordsRequestNeeded && !["Provided","No Information Available","Unable to Release"].includes(record.drugAlcoholRecordsStatus)) return "Review Required"
  if (record.noHistoryCertification) return record.attempts.length ? "Complete" : "Review Required"
  const core = record.employerName && record.informationProvidedBy && record.responseDate &&
    record.employmentStartDate && record.employmentEndDate && record.regulatedCommercialDriving &&
    record.positionTitle && record.performanceResponse && record.separationResponse &&
    record.drugAlcoholTestingRequired && record.rehireResponse
  if (core) return "Complete"
  if (record.attempts.length && !record.informationProvidedBy) return "Awaiting Response"
  if (record.employerName || record.attempts.length) return "In Progress"
  return "Not Started"
}
