export type Company = {
  id: string
  name: string
  regCorpState?: string
  regCorpCountry?: string
  region?: string
  accIfta?: string
  accCt?: string
  accNyhut?: string
  accKyu?: string
  accNm?: string
  accOr?: string
  [key: string]: any
}

export type RuleValue = "applies" | "does-not-apply" | "not-configured"

export type TaxCode =
  | "ifta"
  | "ct_huf"
  | "ny_hut"
  | "kyu"
  | "nm_wdt"
  | "or_wmt"
  | "form_2290"
  | "fuel_charge_registration"
  | "texas_excise_tax"
  | "arkansas_motor_fuel_tax"
  | "ontario_tobacco_tax"

export type FilingFrequency =
  | "monthly"
  | "quarterly"
  | "annual"
  | "event-based"
  | "historical-only"
  | "not-set"

export type TaxProfileStatus = "Active" | "Pending" | "Suspended" | "Inactive" | "Closed"

export type FilingStatus =
  | "Not Started"
  | "Awaiting Data"
  | "Ready to File"
  | "Filed"
  | "Payment Pending"
  | "Completed"
  | "Overdue"
  | "No Return Required"

export type ReturnType =
  | "Activity Return"
  | "Zero Return"
  | "Final Return"
  | "Amended / Corrective Return"
  | "No Return Required"
  | "Not Determined"

export type FilingMethod = "Online" | "Paper" | "Amended / Corrective Filing"

export type PaymentStatus =
  | "Not Applicable"
  | "Unpaid"
  | "Partially Paid"
  | "Paid"
  | "Refund"
  | "Pending"

export type VerificationSource =
  | "Government Portal"
  | "Official Notice"
  | "Permit / Registration"
  | "Filed Return"
  | "Client Instruction"
  | "Other"
  | ""

export type AssignmentType =
  | "Regulatory Default"
  | "Authority Assigned"
  | "Company Elected"
  | "Manual Override"

export type FrequencyAssignment = {
  id: string
  frequency: FilingFrequency
  effectiveFrom: string
  effectiveTo?: string
  assignmentType: AssignmentType
  source: VerificationSource
  sourceReference?: string
  verifiedDate?: string
  verifiedBy?: string
  notes?: string
  createdAt: string
}

export type TaxProfile = {
  id: string
  taxCode: TaxCode
  accountNumber?: string
  accountStatus: TaxProfileStatus
  filingFrequency: FilingFrequency
  frequencyHistory: FrequencyAssignment[]
  effectiveDate?: string
  closureDate?: string
  verificationSource: VerificationSource
  verificationReference?: string
  lastVerifiedDate?: string
  lastVerifiedBy?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export type FilingObligation = {
  id: string
  taxProfileId: string
  taxCode: TaxCode
  frequencySnapshot: FilingFrequency
  reportingPeriodLabel: string
  reportingPeriodStart: string
  reportingPeriodEnd: string
  nominalDueDate: string
  dueDate: string
  status: FilingStatus
  profileUpdatedAtSnapshot: string
  frequencyAssignmentId?: string
  createdAt: string
  updatedAt: string
}

export type FilingSubmission = {
  id: string
  obligationId: string
  returnType: ReturnType
  filingMethod: FilingMethod
  filingDate?: string
  amountDue?: string
  amountPaid?: string
  paymentStatus: PaymentStatus
  confirmationNumber?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export type TaxDocument = {
  id: string
  fileName: string
  mimeType: string
  dataUrl: string
  documentType:
    | "Registration"
    | "Tax Return"
    | "Filing Receipt"
    | "Payment Receipt"
    | "Official Notice"
    | "Supporting Document"
  taxCode?: TaxCode
  profileId?: string
  obligationId?: string
  submissionId?: string
  documentDate?: string
  uploadedAt: string
  ocrConfidence?: number
}

export type TaxData = {
  version: number
  profiles: TaxProfile[]
  obligations: FilingObligation[]
  submissions: FilingSubmission[]
  documents: TaxDocument[]
}

export type TaxDefinition = {
  code: TaxCode
  name: string
  shortName: string
  jurisdiction: string
  description: string
  frequencyOptions: FilingFrequency[]
  defaultFrequency: FilingFrequency
  accountLabel: string
  accountRequired: boolean
  companyField?: "accIfta" | "accCt" | "accNyhut" | "accKyu" | "accNm" | "accOr"
  historicalOnly?: boolean
}

export type CompanySettings = {
  rules?: Record<string, RuleValue>
}
