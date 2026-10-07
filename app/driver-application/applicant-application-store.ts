import type { DriverApplicationStepId } from "./DriverApplicationShell"

export type ApplicantSaveState = "idle" | "saving" | "saved" | "error"

export type ApplicantFileSelection = {
  name: string
  type: string
  size: number
}

export type ApplicantIdentityDraft = {
  driverPhoto?: ApplicantFileSelection
  licenceFront?: ApplicantFileSelection
  licenceBack?: ApplicantFileSelection
}

export type ApplicantPriorAddress = {
  id: string
  address: string
  city: string
  jurisdiction: string
  postalCode: string
  country: "" | "Canada" | "United States"
}

export type ApplicantAboutYouDraft = {
  legalFirstName: string
  legalMiddleName: string
  legalLastName: string
  phone: string
  email: string
  dateOfBirth: string
  currentAddress: string
  currentCity: string
  currentJurisdiction: string
  currentPostalCode: string
  currentCountry: "" | "Canada" | "United States"
  otherResidencesLast3Years: "" | "yes" | "no"
  priorAddresses: ApplicantPriorAddress[]
  employmentType: "" | "Employee" | "Sub Contractor" | "Owner Operator"
  ownerOperatorVehicleYear: string
  ownerOperatorVehicleMake: string
  ownerOperatorVehicleModel: string
  citizenshipStatus: "" | "Citizen" | "Permanent Resident" | "Work Permit" | "Other"
  citizenshipOther: string
  workPermitConditions: "" | "yes" | "no" | "not-applicable"
  workPermitConditionDetails: string
  workAuthorized: "" | "yes" | "no"
  ableToTravelUnitedStates: "" | "yes" | "no" | "pending"
  operatingInterestLocal: boolean
  operatingInterestShortHaul: boolean
  operatingInterestCanada: boolean
  operatingInterestUnitedStates: boolean
  highestEducation: "" | "High School" | "Technical Diploma" | "College" | "University" | "Other"
  educationOther: string
  englishProficiency: "" | "Poor" | "Basic" | "Good" | "Fluent"
}

export type ApplicantPreviousLicence = {
  id: string
  nameOnLicence: string
  jurisdiction: string
  licenceNumber: string
  licenceClass: string
  suspendedOrRevoked: "" | "yes" | "no"
}

export type ApplicantLicenceDraft = {
  firstCommercialLicenceDate: string
  licenceNumber: string
  jurisdiction: string
  country: "" | "Canada" | "United States"
  licenceClass: string
  issueDate: string
  expiryDate: string
  endorsements: string
  restrictions: string
  recentlyTransferredOrOtherLicenceLast3Years: "" | "yes" | "no"
  previousLicences: ApplicantPreviousLicence[]
  otherJurisdictionOrName: "" | "yes" | "no"
  otherJurisdictionOrNameDetails: string
  everDeniedSuspendedRevoked: "" | "yes" | "no"
  deniedSuspendedRevokedDetails: string
  safetyAffectingMedicalCondition: "" | "yes" | "no"
  safetyAffectingMedicalConditionDetails: string
  unpardonedCriminalConviction: "" | "yes" | "no"
  unpardonedCriminalConvictionDetails: string
  drugAlcoholPositiveRefusalAlterSubstitute: "" | "yes" | "no"
  drugAlcoholPositiveRefusalDetails: string
  failedRehabilitationOrReturnToDuty: "" | "yes" | "no" | "not-applicable"
  rehabilitationDetails: string
  otherCompanyWhileEmployed: "" | "yes" | "no"
  otherCompanyDetails: string
  willingCanada: boolean
  willingUnitedStates: boolean
}

export type ApplicantSafetyItem = {
  id: string
  date: string
  location: string
  type: string
  outcome: string
  description: string
}

export type ApplicantExperienceSafetyDraft = {
  commercialDrivingYears: string
  equipmentExperience: string
  equipmentTypes: string[]
  /** Years of experience for each selected equipment type in `equipmentTypes`, keyed by that type's exact label. */
  equipmentDurations: Record<string, string>
  operatingRegions: string[]
  terrainExperience: string[]
  collisionsLast5Years: "" | "yes" | "no"
  collisions: ApplicantSafetyItem[]
  convictionsLast5Years: "" | "yes" | "no"
  convictions: ApplicantSafetyItem[]
}

export type ApplicantEmploymentItem = {
  id: string
  employerName: string
  position: string
  startDate: string
  endDate: string
  currentlyEmployed: boolean
  commercialDriving: boolean
  dotRegulated: boolean
  reasonForLeaving: string
  employerPhone: string
  employerEmail: string
  employerAddress: string
  contactName: string
  contactPosition: string
  alcoholSubstanceTesting: "" | "yes" | "no" | "unknown"
  historyType: "Employment" | "Unemployed" | "School" | "Other"
  city: string
  stateProvince: string
  country: "" | "Canada" | "United States" | "Other"
}

export type ApplicantEmploymentDraft = {
  history: ApplicantEmploymentItem[]
  historyComplete: boolean
}

export type ApplicantAuthorizationsDraft = {
  informationAccuracy: boolean
  employmentVerification: boolean
  mvrAuthorization: boolean
  backgroundAuthorization: boolean
  electronicRecordsConsent: boolean

  driverCertificationsAccepted: boolean
  previous7DaysOnDutyHours: string
  hosResetCertification: boolean
  hosPrevious14DaysCertification: boolean

  clearinghouseLimitedQueryApplicable: "" | "yes" | "no"
  clearinghouseRegistered: "" | "yes" | "no"
  clearinghouseConsentScope: "" | "single" | "multiple"
  clearinghouseConsentStartDate: string
  clearinghouseConsentEndDate: string
  clearinghouseLimitedQueryConsent: boolean

  pspApplicable: "" | "yes" | "no"
  pspOfficialFormPresented: boolean
  pspDisclosureReviewed: boolean
  pspAuthorization: boolean

  signatureName: string
}

export type ApplicantDocumentDraft = {
  id: string
  category: "Driver Abstract / MVR / CVOR" | "Medical / Health Certificate" | "Training Certificate" | "Work Authorization / Travel" | "Other"
  label: string
  file?: ApplicantFileSelection
}

export type ApplicantDocumentsDraft = {
  documents: ApplicantDocumentDraft[]
  documentsReviewed: boolean
}

export type ApplicantFinalCertificationDraft = {
  reviewedApplication: boolean
  certificationAccepted: boolean
  signatureName: string
}

export type ApplicantApplicationDraft = {
  identity: ApplicantIdentityDraft
  aboutYou: ApplicantAboutYouDraft
  drivingLicence: ApplicantLicenceDraft
  experienceSafety: ApplicantExperienceSafetyDraft
  employment: ApplicantEmploymentDraft
  authorizations: ApplicantAuthorizationsDraft
  documents: ApplicantDocumentsDraft
  finalCertification: ApplicantFinalCertificationDraft
}

export type ApplicantDraftEnvelope = {
  applicationId: string
  currentStep: DriverApplicationStepId
  completedSteps: DriverApplicationStepId[]
  draft: ApplicantApplicationDraft
  lastSavedAt?: string
}

export type ApplicantSubmittedSnapshot = {
  applicationId: string
  submittedAt: string
  receiptId: string
  completedSteps: DriverApplicationStepId[]
  draft: ApplicantApplicationDraft
}

export type ApplicantEvaluationHandoff = {
  applicationId: string
  submittedAt: string
  immutableApplicantSnapshot: true
  evaluationStages: [
    "Application Review",
    "Evidence Reconciliation",
    "Previous Employer Verification",
    "Applicable External Checks",
    "Clarification / Rebuttal",
    "File Completeness",
    "Qualification Assessment",
    "Carrier Determination"
  ]
}

/**
 * Describes the internal TES workflow that begins after applicant submission.
 * This is deliberately separate from the applicant-editable draft/snapshot.
 */
export function createApplicantEvaluationHandoff(snapshot: ApplicantSubmittedSnapshot): ApplicantEvaluationHandoff {
  return {
    applicationId: snapshot.applicationId,
    submittedAt: snapshot.submittedAt,
    immutableApplicantSnapshot: true,
    evaluationStages: [
      "Application Review",
      "Evidence Reconciliation",
      "Previous Employer Verification",
      "Applicable External Checks",
      "Clarification / Rebuttal",
      "File Completeness",
      "Qualification Assessment",
      "Carrier Determination",
    ],
  }
}

export interface ApplicantApplicationStore {
  loadDraft(applicationId: string): Promise<ApplicantDraftEnvelope | null>
  saveDraft(record: ApplicantDraftEnvelope): Promise<ApplicantDraftEnvelope>
  clearDraft(applicationId: string): Promise<void>
  loadSubmittedSnapshot(applicationId: string): Promise<ApplicantSubmittedSnapshot | null>
  submitApplication(record: ApplicantDraftEnvelope, invitationToken: string): Promise<ApplicantSubmittedSnapshot>
}

export function createEmptyApplicantDraft(applicationId: string): ApplicantDraftEnvelope {
  return {
    applicationId,
    currentStep: "identity",
    completedSteps: [],
    draft: {
      identity: {},
      aboutYou: {
        legalFirstName: "",
        legalMiddleName: "",
        legalLastName: "",
        phone: "",
        email: "",
        dateOfBirth: "",
        currentAddress: "",
        currentCity: "",
        currentJurisdiction: "",
        currentPostalCode: "",
        currentCountry: "",
        otherResidencesLast3Years: "",
        priorAddresses: [],
        employmentType: "",
        ownerOperatorVehicleYear: "",
        ownerOperatorVehicleMake: "",
        ownerOperatorVehicleModel: "",
        citizenshipStatus: "",
        citizenshipOther: "",
        workPermitConditions: "not-applicable",
        workPermitConditionDetails: "",
        workAuthorized: "",
        ableToTravelUnitedStates: "",
        operatingInterestLocal: false,
        operatingInterestShortHaul: false,
        operatingInterestCanada: false,
        operatingInterestUnitedStates: false,
        highestEducation: "",
        educationOther: "",
        englishProficiency: "",
      },
      drivingLicence: {
        firstCommercialLicenceDate: "",
        licenceNumber: "",
        jurisdiction: "",
        country: "",
        licenceClass: "",
        issueDate: "",
        expiryDate: "",
        endorsements: "",
        restrictions: "",
        recentlyTransferredOrOtherLicenceLast3Years: "",
        previousLicences: [],
        otherJurisdictionOrName: "",
        otherJurisdictionOrNameDetails: "",
        everDeniedSuspendedRevoked: "",
        deniedSuspendedRevokedDetails: "",
        safetyAffectingMedicalCondition: "",
        safetyAffectingMedicalConditionDetails: "",
        unpardonedCriminalConviction: "",
        unpardonedCriminalConvictionDetails: "",
        drugAlcoholPositiveRefusalAlterSubstitute: "",
        drugAlcoholPositiveRefusalDetails: "",
        failedRehabilitationOrReturnToDuty: "not-applicable",
        rehabilitationDetails: "",
        otherCompanyWhileEmployed: "",
        otherCompanyDetails: "",
        willingCanada: false,
        willingUnitedStates: false,
      },
      experienceSafety: {
        commercialDrivingYears: "",
        equipmentExperience: "",
        equipmentTypes: [],
        equipmentDurations: {},
        operatingRegions: [],
        terrainExperience: [],
        collisionsLast5Years: "",
        collisions: [],
        convictionsLast5Years: "",
        convictions: [],
      },
      employment: {
        history: [],
        historyComplete: false,
      },
      authorizations: {
        informationAccuracy: false,
        employmentVerification: false,
        mvrAuthorization: false,
        backgroundAuthorization: false,
        electronicRecordsConsent: false,
        driverCertificationsAccepted: false,
        previous7DaysOnDutyHours: "",
        hosResetCertification: false,
        hosPrevious14DaysCertification: false,
        clearinghouseLimitedQueryApplicable: "",
        clearinghouseRegistered: "",
        clearinghouseConsentScope: "",
        clearinghouseConsentStartDate: "",
        clearinghouseConsentEndDate: "",
        clearinghouseLimitedQueryConsent: false,
        pspApplicable: "",
        pspOfficialFormPresented: false,
        pspDisclosureReviewed: false,
        pspAuthorization: false,
        signatureName: "",
      },
      documents: {
        documents: [
          { id: "driver-abstract", category: "Driver Abstract / MVR / CVOR", label: "Current/original Driver Abstract, MVR or CVOR" },
          { id: "medical", category: "Medical / Health Certificate", label: "Medical / health certificate, where applicable" },
        ],
        documentsReviewed: false,
      },
      finalCertification: {
        reviewedApplication: false,
        certificationAccepted: false,
        signatureName: "",
      },
    },
  }
}

const storageKey = (applicationId: string) => `tes_applicant_application_draft_${applicationId}`

async function persistSubmittedSnapshotToServer(snapshot: ApplicantSubmittedSnapshot, invitationToken: string) {
  const response = await fetch("/api/driver-applications/submissions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${invitationToken}`,
    },
    body: JSON.stringify(snapshot),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || "TES could not save the submitted application.")
  }
}

const submittedStorageKey = (applicationId: string) => `tes_applicant_application_submitted_${applicationId}`

function cloneDraft(draft: ApplicantApplicationDraft): ApplicantApplicationDraft {
  return JSON.parse(JSON.stringify(draft)) as ApplicantApplicationDraft
}

function makeReceiptId(applicationId: string) {
  const suffix = `${Date.now()}`.slice(-8)
  const applicationSuffix = applicationId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()
  return `TES-APP-${applicationSuffix || "RECEIPT"}-${suffix}`
}

/**
 * DEVELOPMENT-ONLY persistence adapter.
 *
 * This keeps applicant UI code behind one persistence boundary while TES is still
 * using browser storage. Replace this adapter with the server/API implementation
 * before real applicant testing.
 *
 * IMPORTANT:
 * - File bytes are NOT persisted here.
 * - OTP/session authentication must NEVER use this adapter.
 * - Production evidence must use private server-controlled object storage.
 * - Draft autosave remains browser-backed during development.
 * - Final submission crosses a shared server boundary so applicant and TES workspaces
 *   no longer depend on sharing browser localStorage.
 * - Production must replace the development repository behind that route with the
 *   authenticated database/object-storage implementation.
 */
export const browserApplicantApplicationStore: ApplicantApplicationStore = {
  async loadDraft(applicationId) {
    if (typeof window === "undefined") return null
    const raw = window.localStorage.getItem(storageKey(applicationId))
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as ApplicantDraftEnvelope
      return {
        ...createEmptyApplicantDraft(applicationId),
        ...parsed,
        applicationId,
        completedSteps: Array.isArray(parsed.completedSteps) ? parsed.completedSteps : [],
        draft: {
          ...createEmptyApplicantDraft(applicationId).draft,
          ...parsed.draft,
          identity: parsed.draft?.identity ?? {},
          aboutYou: {
            ...createEmptyApplicantDraft(applicationId).draft.aboutYou,
            ...(parsed.draft?.aboutYou ?? {}),
            priorAddresses: Array.isArray(parsed.draft?.aboutYou?.priorAddresses)
              ? parsed.draft.aboutYou.priorAddresses
              : [],
          },
          drivingLicence: {
            ...createEmptyApplicantDraft(applicationId).draft.drivingLicence,
            ...(parsed.draft?.drivingLicence ?? {}),
            previousLicences: Array.isArray(parsed.draft?.drivingLicence?.previousLicences)
              ? parsed.draft.drivingLicence.previousLicences
              : [],
          },
          experienceSafety: {
            ...createEmptyApplicantDraft(applicationId).draft.experienceSafety,
            ...(parsed.draft?.experienceSafety ?? {}),
            collisions: Array.isArray(parsed.draft?.experienceSafety?.collisions) ? parsed.draft.experienceSafety.collisions : [],
            convictions: Array.isArray(parsed.draft?.experienceSafety?.convictions) ? parsed.draft.experienceSafety.convictions : [],
            equipmentTypes: Array.isArray(parsed.draft?.experienceSafety?.equipmentTypes) ? parsed.draft.experienceSafety.equipmentTypes : [],
            equipmentDurations: (parsed.draft?.experienceSafety?.equipmentDurations && typeof parsed.draft.experienceSafety.equipmentDurations === "object")
              ? parsed.draft.experienceSafety.equipmentDurations
              : {},
            operatingRegions: Array.isArray(parsed.draft?.experienceSafety?.operatingRegions) ? parsed.draft.experienceSafety.operatingRegions : [],
            terrainExperience: Array.isArray(parsed.draft?.experienceSafety?.terrainExperience) ? parsed.draft.experienceSafety.terrainExperience : [],
          },
          employment: {
            ...createEmptyApplicantDraft(applicationId).draft.employment,
            ...(parsed.draft?.employment ?? {}),
            history: Array.isArray(parsed.draft?.employment?.history) ? parsed.draft.employment.history : [],
          },
          authorizations: {
            ...createEmptyApplicantDraft(applicationId).draft.authorizations,
            ...(parsed.draft?.authorizations ?? {}),
          },
          documents: {
            ...createEmptyApplicantDraft(applicationId).draft.documents,
            ...(parsed.draft?.documents ?? {}),
            documents: Array.isArray(parsed.draft?.documents?.documents)
              ? parsed.draft.documents.documents
              : createEmptyApplicantDraft(applicationId).draft.documents.documents,
          },
          finalCertification: {
            ...createEmptyApplicantDraft(applicationId).draft.finalCertification,
            ...(parsed.draft?.finalCertification ?? {}),
          },
        },
      }
    } catch {
      return null
    }
  },

  async saveDraft(record) {
    if (typeof window === "undefined") {
      throw new Error("Applicant draft storage is only available in the browser during development.")
    }

    if (window.localStorage.getItem(submittedStorageKey(record.applicationId))) {
      throw new Error("This application has already been submitted and is immutable.")
    }

    const saved: ApplicantDraftEnvelope = {
      ...record,
      lastSavedAt: new Date().toISOString(),
    }

    window.localStorage.setItem(storageKey(record.applicationId), JSON.stringify(saved))
    return saved
  },

  async clearDraft(applicationId) {
    if (typeof window === "undefined") return
    window.localStorage.removeItem(storageKey(applicationId))
  },

  async loadSubmittedSnapshot(applicationId) {
    if (typeof window === "undefined") return null
    const raw = window.localStorage.getItem(submittedStorageKey(applicationId))
    if (!raw) return null
    try {
      return JSON.parse(raw) as ApplicantSubmittedSnapshot
    } catch {
      return null
    }
  },

  async submitApplication(record, invitationToken) {
    if (typeof window === "undefined") {
      throw new Error("Applicant submission is only available in the browser during development.")
    }

    const existing = window.localStorage.getItem(submittedStorageKey(record.applicationId))
    if (existing) {
      const snapshot = JSON.parse(existing) as ApplicantSubmittedSnapshot
      await persistSubmittedSnapshotToServer(snapshot, invitationToken)
      return snapshot
    }

    const submittedAt = new Date().toISOString()
    const snapshot: ApplicantSubmittedSnapshot = {
      applicationId: record.applicationId,
      submittedAt,
      receiptId: makeReceiptId(record.applicationId),
      completedSteps: [...record.completedSteps],
      draft: cloneDraft(record.draft),
    }

    // Shared submission boundary: the server accepts the immutable snapshot first.
    // The browser copy is retained only for the applicant receipt/resume experience.
    await persistSubmittedSnapshotToServer(snapshot, invitationToken)
    window.localStorage.setItem(submittedStorageKey(record.applicationId), JSON.stringify(snapshot))
    window.localStorage.removeItem(storageKey(record.applicationId))
    return snapshot
  },
}
