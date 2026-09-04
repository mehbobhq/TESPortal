/**
 * TES Canonical Driver & Fleet Compliance Data Contracts
 */

export type DeadlineStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "No Deadline";

export interface DeadlineRules {
  healthyMinDays: number;
  watchMinDays: number;
  urgentMinDays: number;
  criticalMinDays: number;
  criticalMaxDays: number;
}

export type RecordType =
  | "Employee"
  | "Owner-Operator"
  | "Contractor"
  | "Temporary Driver";

export type OperatingRegion = "Canada" | "United States" | "Cross-Border";

export type DriverStatus =
  | "Active"
  | "On Leave"
  | "Suspended"
  | "Inactive"
  | "Terminated";

// Legacy HR roles preserved for backward compatibility hydration only
export type DriverRole =
  | "Driver"
  | "Driver / Trainer"
  | "Trainer"
  | "Safety Manager"
  | "General Manager"
  | "Owner"
  | "Other";

export type EmploymentStatus =
  | "Employed"
  | "Self-Employed"
  | "Contractor"
  | "On Leave"
  | "Inactive"
  | "Terminated";

// --- Historical Temporal Entry ---
export interface EffectiveRecord {
  id: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD or null if currently active
  status: "Current" | "Historical";
  source: string;
  createdAt: string;
}

// --- Licence Details ---
export type LicenceVerificationState =
  | "Unverified"
  | "Document Uploaded"
  | "OCR Extracted"
  | "Barcode Extracted"
  | "Human Reviewed"
  | "Document Verified"
  | "MVR Confirmed"
  | "Authoritative Verified"
  | "Discrepancy Pending";

export interface LicenceRecord extends EffectiveRecord {
  licenceNumber: string; // Normalized for comparison
  licenceNumberNormalized?: string;
  licenceNumberRaw?: string; // Exact documentary value
  jurisdiction: string; // e.g. "ON", "AB", "IL", "TX"
  country: "Canada" | "United States";
  documentType?: string;
  class?: string; // e.g. "Class A / AZ", "Class 1", "CDL-A"
  endorsements?: string[]; // e.g. ["Air Brake (Z)", "Hazmat (H)", "Tanker (N)", "Doubles/Triples (T)", "Other / Unlisted"]
  endorsementNotes?: string;
  restrictions?: string[]; // e.g. ["Corrective Lenses (01)", "Automatic Transmission Only (E)", "Other / Unlisted"]
  restrictionNotes?: string;
  airBrakeQualified?: boolean;
  /** Legacy compatibility alias; canonical boolean is airBrakeQualified. */
  airBrake?: string;
  issueDate?: string;
  expiryDate?: string;
  verificationState?: LicenceVerificationState;
  evidenceIds?: string[];
  sourceEvidenceId?: string;
  sourceValue?: string;
  reviewedValue?: string;
  reviewReason?: string;
  notes?: string;
}

export interface AddressRecord extends EffectiveRecord {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateProvince: string;
  postalZip: string;
  country: "Canada" | "United States";
}

export interface StatusHistory extends EffectiveRecord {
  statusValue: DriverStatus;
  reason?: string;
}

export interface IdentityReference {
  id: string;
  type: "DRIVER_LICENCE" | "PASSPORT" | "FAST_CARD" | "OTHER";
  value: string;
  jurisdiction?: string;
  country?: "Canada" | "United States";
  createdAt: string;
  source: string;
}

export interface JurisdictionReview {
  id: string;
  status: "OPEN" | "RESOLVED";
  reason: string;
  explanation: string;
  expectedResolutionDate?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface IdentitySourceReview {
  id: string;
  domain: "LEGAL_IDENTITY" | "ADDRESS" | "DRIVER_LICENCE";
  suppliedValue: string;
  existingValue: string;
  source: string;
  createdAt: string;
  status: "OPEN" | "RESOLVED";
  resolvedAt?: string;
}

// --- DRIVER MASTER (Global Permanent Human Identity in TES) ---
export interface DriverMaster {
  id: string; // Canonical: DRV-000001
  /** Stable canonical Driver Master identifier. During compatibility migration this equals the legacy `id`. */
  driverMasterId: string;
  createdAt: string;
  updatedAt: string;
  identity: {
    legalFirstName: string;
    legalMiddleName?: string;
    legalLastName: string;
    preferredName?: string;
    dateOfBirth: string; // YYYY-MM-DD
    phone?: string;
    email?: string;
  };
  identityReferences: IdentityReference[];
  licenceHistory: LicenceRecord[];
  addressHistory: AddressRecord[];
  identityResolution: {
    status: "UNREVIEWED" | "CLEAR" | "REVIEW";
    matchedDriverMasterId?: string;
    confidence?: "HIGH" | "MEDIUM" | "LOW";
    notes?: string;
  };
  jurisdictionReviews: JurisdictionReview[];
  identitySourceReviews?: IdentitySourceReview[];
  archive: {
    isArchived: boolean;
    archivedAt?: string;
    archiveReason?: string;
  };
}

// --- COMPANY DRIVER RELATIONSHIP (Company Scoped) ---
export interface CompanyDriverRelationship {
  id: string; // Contextual Record ID, e.g. PW-DRV-000101
  /** Stable company-contextual identifier; legacy records are migrated to the existing relationship `id`. */
  companyDriverRecordId: string; // Canonical alias for relationship ID
  companyId: string;
  driverMasterId: string;
  recordType: RecordType;
  operatingRegion: OperatingRegion;
  driverStatus: DriverStatus;
  startDate: string;
  endDate?: string;
  statusHistory: StatusHistory[];
  createdAt: string;
  updatedAt: string;
  archive: {
    isArchived: boolean;
    archivedAt?: string;
    archiveReason?: string;
  };

  // Deprecated HR fields retained purely for hydration compatibility
  currentRole?: DriverRole;
  employmentStatus?: EmploymentStatus;
  roleHistory?: Array<EffectiveRecord & { role: DriverRole }>;
}

// --- DRIVER APPLICATION (First-Class Compliance Record) ---
export type DriverApplicationStatus =
  | "Draft"
  | "Invitation Ready"
  | "Invited"
  | "Started"
  | "In Progress"
  | "Submitted"
  | "Under Review"
  | "Additional Information Requested"
  | "Approved"
  | "Rejected"
  | "Withdrawn"
  | "Expired"
  | "Invitation Cancelled";

export interface ApplicationClaimedAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateProvince: string;
  postalZip: string;
  country: "Canada" | "United States";
  yearsAtAddress?: number;
}

export interface ApplicationClaimedLicence {
  licenceNumber: string;
  jurisdiction: string;
  country: "Canada" | "United States";
  class: string;
  endorsements?: string[];
  restrictions?: string[];
  issueDate?: string;
  expiryDate?: string;
}

export interface ApplicationClaimedEmployment {
  employerName: string;
  position: string;
  startDate: string;
  endDate: string;
  commercialDriving: boolean;
  dotRegulated: boolean;
  reasonForLeaving?: string;
}

export interface ApplicationClaimedCollision {
  date: string;
  location: string;
  fatalities: number;
  injuries: number;
  hazmatSpill: boolean;
  description: string;
}

export interface ApplicationClaimedCitation {
  date: string;
  location: string;
  violationType: string;
  penalty: string;
}

export interface DriverApplicationRecord {
  id: string; // e.g. APP-000102
  companyId: string;
  companyDriverRelationshipId?: string;
  driverMasterId: string;
  applicationType: "Full Driver Employment" | "Owner-Operator Lease" | "Temporary / Seasonal";
  status: DriverApplicationStatus;
  operatingRegion: OperatingRegion;
  createdDate: string;
  startedDate?: string;
  submittedDate?: string;
  reviewedDate?: string;
  reviewedBy?: string;
  companyDetermination?: "Approved" | "Rejected" | "Withdrawn" | "Pending";
  determinationDate?: string;
  determinationNotes?: string;

  // Applicant Claimed Details (Snapshot)
  personalInfoClaimed?: {
    legalFirstName: string;
    legalMiddleName?: string;
    legalLastName: string;
    phone: string;
    email: string;
    dateOfBirth: string;
    workAuthorized: boolean;
  };
  personalInfoSummary?: {
    legalName: string;
    phone: string;
    email: string;
    workAuthorized: boolean;
  };
  claimedAddresses?: ApplicationClaimedAddress[];
  claimedLicences?: ApplicationClaimedLicence[];
  claimedEmploymentHistory?: ApplicationClaimedEmployment[];
  claimedCollisions?: ApplicationClaimedCollision[];
  claimedCitations?: ApplicationClaimedCitation[];
  experienceYears?: number;
  equipmentExperience?: string[];
  trafficConvictionsLast3Yrs?: number;
  accidentsLast3Yrs?: number;
  consents?: {
    mvrConsent: boolean;
    clearinghouseConsent: boolean;
    backgroundCheckConsent: boolean;
    drugAlcoholConsent: boolean;
    signedAt?: string;
    signatureName?: string;
  };
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

// --- HIRING PACKAGE (Container for Onboarding Documents) ---
export type HiringPackageStatus =
  | "Not Issued"
  | "Issued / In Progress"
  | "Pending Company Countersign"
  | "Completed"
  | "Expired"
  | "Waived";

export interface HiringPackageItem {
  id: string;
  title: string;
  category: "Agreement" | "Consent" | "Policy" | "Tax Form" | "Custom";
  required: boolean;
  signed: boolean;
  signedDate?: string;
  signedBy?: string;
  evidenceId?: string;
  notes?: string;
}

export interface HiringPackageRecord {
  id: string; // e.g. HPK-000084
  companyId: string;
  companyDriverRelationshipId?: string;
  driverMasterId: string;
  packageVersion: string;
  issuedDate: string;
  completedDate?: string;
  status: HiringPackageStatus;
  items: HiringPackageItem[];
  evidenceIds: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// --- TAX & GOVERNMENT ONBOARDING (Metadata Only - No sensitive SIN/SSN stored) ---
export interface DriverTaxDocRecord {
  id: string;
  companyId: string;
  driverMasterId: string;
  formType: "TD1 Federal" | "TD1 Provincial" | "W-4 Federal" | "State Withholding" | "W-9 / 1099";
  taxYear: string;
  jurisdiction: string;
  effectiveDate: string;
  status: "Completed" | "Pending" | "Superseded";
  evidenceId?: string;
  notes?: string;
  createdAt: string;
}

// --- SCREENING & MEDICAL (Category-Specific First-Class Records) ---
export type ScreeningCategory =
  | "Employment History"
  | "Driver Abstract / MVR Review"
  | "Collision History"
  | "Previous Employer Verification"
  | "FMCSA Clearinghouse Query"
  | "Annual Clearinghouse Query"
  | "Pre-Employment Screening Program (PSP)"
  | "Annual Roadside Test"
  | "Criminal Background Check"
  | "Credit History"
  | "Education History"
  | "Periodic Review"
  | "Road Test Evaluation"
  | "Medical Card / DOT Physical"
  | "Pre-Employment Drug Test"
  | "Pre-Employment Alcohol Test"
  | "Random Drug / Alcohol Test"
  | "Post-Accident Drug / Alcohol Test"
  | "Reasonable Suspicion Test"
  | "Return-to-Duty Test"
  | "Follow-up Testing";

export interface PreviousEmployerVerificationDetails {
  employerName: string;
  claimedStartDate?: string;
  claimedEndDate?: string;
  claimedPosition?: string;
  commercialDrivingPosition?: boolean;
  dotRegulatedPosition?: boolean;
  verificationRequestedDate?: string;
  verificationReceivedDate?: string;
  verificationMethod?: "Email" | "Fax" | "Phone" | "Third-Party Service";
  verificationOutcome?: "Verified as Claimed" | "Discrepancy Found" | "No Record / Unable to Verify";
  eligibleForRehire?: "Yes" | "No" | "Ineligible" | "Unknown";
  safetyPerformanceHistoryReceived?: boolean;
  reviewerName?: string;
}

export interface ClearinghouseQueryDetails {
  queryPurpose: "Pre-Employment" | "Annual" | "Follow-Up" | "Other";
  submittedDate: string;
  completedDate?: string;
  consentObtained: boolean;
  consentDate?: string;
  queryResult: "Driver Not Prohibited" | "Driver Prohibited" | "Pending Consent" | "Pending Results";
  queryReferenceNumber?: string;
  validUntil?: string;
  reviewedBy?: string;
}

export interface PSPReviewDetails {
  requestDate: string;
  consentObtained: boolean;
  resultReceivedDate?: string;
  reviewDate?: string;
  reviewerName?: string;
  reviewStatus: "Clean Record" | "Violations Noted" | "Under Review";
}

export interface RoadTestEvaluationDetails {
  testDate: string;
  examinerName: string;
  vehicleUnitNumber?: string;
  vehicleType?: string;
  testType: "Pre-Trip & Road Test" | "Manoeuvring & Backing" | "Coupling / Uncoupling" | "Full Evaluation";
  testResult: "Passed" | "Failed" | "Retest Required";
  authorizationRecorded?: boolean;
}

export type MedicalQualificationStatus =
  | "QUALIFIED_2_YEARS"
  | "QUALIFIED_1_YEAR"
  | "QUALIFIED_3_6_MONTHS_TEMPORARY"
  | "DISQUALIFIED"
  | "PENDING_VARIANCE";
export type ScreeningVerificationState = "UNVERIFIED" | "DOCUMENT_VERIFIED" | "NATIONAL_REGISTRY_CONFIRMED";

export interface MedicalPhysicalDetails {
  examinationDate?: string;
  certificateIssueDate?: string;
  expiryDate?: string;
  examinerName?: string;
  nationalRegistryNumber?: string;
  medicalQualificationStatus?: MedicalQualificationStatus;
  legacyMedicalQualificationStatus?: string;
  varianceRestrictions?: string[];
  verificationState?: ScreeningVerificationState;
  legacyVerificationState?: string;
}

export interface DrugAlcoholTestDetails {
  testType: "Pre-Employment" | "Random" | "Post-Accident" | "Reasonable Suspicion" | "Return-to-Duty" | "Follow-Up";
  testCategory: "Drug (5-Panel)" | "Alcohol (Breathalyzer)" | "Combined Drug & Alcohol";
  specimenCollectionDate: string;
  mroVerifiedDate?: string;
  mroName?: string;
  laboratoryName?: string;
  result: "Negative" | "Positive" | "Refusal to Test" | "Cancelled / Invalid" | "Pending Verification";
  linkedCollisionEventId?: string;
}

export interface ScreeningRecord {
  id: string; // e.g. SCR-000109
  companyId: string;
  driverMasterId: string;
  category: ScreeningCategory;
  recordDate: string; // YYYY-MM-DD
  expiryDate?: string; // YYYY-MM-DD
  status: "Passed" | "Qualified" | "In Review" | "Pending Results" | "Failed / Disqualified" | "Incomplete" | "Archived";
  resultSummary: string;
  providerOrAuthority: string;

  // Type-specific payloads
  employerVerificationDetails?: PreviousEmployerVerificationDetails;
  clearinghouseDetails?: ClearinghouseQueryDetails;
  pspDetails?: PSPReviewDetails;
  roadTestDetails?: RoadTestEvaluationDetails;
  medicalCardDetails?: MedicalPhysicalDetails;
  drugAlcoholDetails?: DrugAlcoholTestDetails;

  evidenceIds: string[];
  notes?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- TRAINING (Canonical Course / Requirement / Record model) ---
export type TrainingApplicability = "Applicable" | "Not Applicable" | "Pending Determination";

export type TrainingRequirementState =
  | "Required"
  | "Not Required"
  | "Pending Determination";

export type TrainingAssignmentState = "Assigned" | "Not Assigned" | "Not Applicable";
export type TrainingProgressState = "Not Started" | "Scheduled" | "In Progress" | "Completed" | "Cancelled" | "Waived" | "Exempted";
export type TrainingCurrencyState = "Current" | "Expired" | "No Expiry" | "Not Established" | "Not Applicable";
export type TrainingVerificationState = "Unverified" | "Pending" | "Verified" | "Failed" | "Unable to Verify";

/** Derived/display lifecycle retained for compatibility; independent semantic dimensions are authoritative. */
export type TrainingStatus =
  | "Required" | "Assigned" | "Scheduled" | "In Progress" | "Completed" | "Expired"
  | "Waived" | "Exempted" | "Cancelled" | "Not Applicable";

export type CanonicalTrainingType =
  | "INITIAL_ONBOARDING"
  | "ANNUAL_REFRESHER"
  | "POST_INCIDENT_CORRECTIVE"
  | "REGULATORY_MANDATED"
  | "CERTIFICATION"
  | "ORIENTATION"
  | "SAFETY_SEMINAR"
  | "COMPANY_POLICY"
  | "CORRECTIVE_ACTION_RETRAINING"
  | "SPECIALIZED_CARGO"
  | "WINTER_GRADE_OPERATIONS"
  | "INITIAL"
  | "REFRESHER"
  | "EXTERNAL_HISTORICAL"
  | "REMEDIAL"
  | "RETURN_TO_WORK"
  | "REQUALIFICATION"
  | "OTHER";

export type TrainingMappingState = "CANONICAL" | "REVIEW_REQUIRED" | "UNMAPPED";
export type TrainingType = CanonicalTrainingType;

export interface TrainingCourseDefinition {
  courseId: string;
  courseCode: string;
  categoryId: string;
  title: string;
  description?: string;
  jurisdictionApplicability?: string[];
  operatingRegionApplicability?: OperatingRegion[];
  vehicleEquipmentApplicability?: string[];
  cargoApplicability?: string[];
  defaultValidityPeriodMonths?: number;
  regulatorySemantics?: string;
  companyDefined?: boolean;
  version: string;
  state: "ACTIVE" | "HISTORICAL";
}

export interface TrainingRequirement {
  requirementId: string;
  companyId: string;
  driverMasterId: string;
  companyDriverRelationshipId?: string;
  courseId: string;
  applicability: TrainingApplicability;
  requiredState: TrainingRequirementState;
  assignmentState: TrainingAssignmentState;
  progressState?: TrainingProgressState;
  currencyState?: TrainingCurrencyState;
  verificationState?: TrainingVerificationState;
  requirementSource: "Regulatory" | "Company Policy" | "Operating Context" | "Company Defined" | "Other";
  requirementReason?: string;
  /** Legacy alias retained for hydration; assignmentState is canonical. */
  assignedState?: TrainingAssignmentState;
  assignedDate?: string;
  dueDate?: string;
  /** Derived/display state only; never the source of truth for the dimensions above. */
  currentRequirementState?: TrainingRequirementState;
  notApplicableReason?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  operatingContext?: {
    operatingRegion?: OperatingRegion;
    jurisdictions?: string[];
    equipmentTypes?: string[];
    cargoTypes?: string[];
  };
  provenance: ProvenanceMetadata;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingRecord {
  id: string;
  companyId: string;
  driverMasterId: string;
  companyDriverRelationshipId?: string;
  courseId?: string;
  courseVersion?: string;
  courseTitle: string;
  /** Original legacy title is retained when a deterministic canonical mapping was not possible. */
  legacyCourseTitle?: string;
  courseMappingState?: TrainingMappingState;
  trainingType: TrainingType;
  legacyTrainingType?: string;
  trainingTypeMappingState?: TrainingMappingState;
  provider: string;
  assignedDate?: string;
  startDate?: string;
  completionDate?: string;
  expiryDate?: string;
  status: TrainingStatus;
  applicability?: TrainingApplicability;
  requirementState?: TrainingRequirementState;
  assignmentState?: TrainingAssignmentState;
  progressState?: TrainingProgressState;
  currencyState?: TrainingCurrencyState;
  verificationState?: TrainingVerificationState;
  scoreOrResult?: string;
  certificateNumber?: string;
  waiveReason?: string;
  waivedBy?: string;
  waivedDate?: string;
  evidenceIds: string[];
  remedialOrRoutine?: "Remedial" | "Routine" | "Unknown";
  previousTrainingRecordId?: string;
  relatedEventIds?: string[];
  relatedHosRecordIds?: string[];
  relatedCitationIds?: string[];
  relatedCompanyActionIds?: string[];
  provenance?: ProvenanceMetadata;
  notes?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  // Legacy aliases retained for hydration only.
  recordId?: string;
  recordStatus?: "Assigned" | "Scheduled" | "In Progress" | "Completed" | "Cancelled" | "Exempted";
  assessmentResult?: "Passed" | "Failed" | "Incomplete" | "Pending" | "Not Required";
  dueDate?: string;
  issueDate?: string;
  nextDueDate?: string;
  deliveryMethod?: string;
  duration?: string;
}

// --- PERFORMANCE & EVENTS SUBSYSTEM ---
export type EventType =
  | "Collision"
  | "Near Miss"
  | "Roadside Inspection"
  | "Out-of-Service Order"
  | "HOS Violation"
  | "Traffic Citation"
  | "Cargo Damage"
  | "Cargo Theft"
  | "Spill or Release"
  | "Customer Complaint"
  | "Customer Commendation"
  | "Positive Safety Observation"
  | "Coaching Session"
  | "Disciplinary Action"
  | "Corrective Action Plan"
  | "Injury"
  | "Security Incident"
  | "Warning"
  | "Violation"
  | "Citation-linked Event"
  | "Equipment-related Event"
  | "Safety Observation"
  | "Customer Compliment"
  | "Telematics / Camera Observation"
  | "Security Event"
  | "Emergency Event"
  | "Speeding"
  | "Harsh Braking"
  | "Harsh Acceleration"
  | "Harsh Cornering"
  | "Following Distance"
  | "Fatigue Indicator"
  | "Device / Data Integrity"
  | "Trip Completion / Service Performance"
  | "Lane Departure"
  | "Seatbelt"
  | "Distracted Driving"
  | "Idle Time"
  | "Route Deviation"
  | "Backing"
  | "Stop Sign / Red Light"
  | "Railroad Crossing"
  | "Customer-Site Behavior"
  | "PPE / Safety Protocol"
  | "Equipment Failure / Critical Defect";

export type EventSeverity = "Low" | "Moderate" | "High" | "Critical" | "Not Applicable";

export type EventStatus =
  | "Open"
  | "Under Review"
  | "Awaiting Information"
  | "Follow-up Required"
  | "Closed"
  | "Not Applicable";

export interface LinkedRecordRef {
  entityType: "Vehicle" | "Trailer" | "Trip" | "Load" | "Customer" | "Customer Site" | "Citation" | "Inspection" | "Repair" | "Training" | "Screening" | "Document" | "Event" | "HOS" | "Maintenance" | "Company Action" | "Evidence" | "Unlinked Operational Reference";
  id: string;
  label: string;
  secondaryText?: string;
}

export interface EventChronologyItem {
  id: string;
  timestamp: string;
  action: string;
  actor: string | null;
  details: string;
}

export interface InspectionViolationItem {
  id: string;
  violationCode: string;
  regulatorySource: string; // e.g. "FMCSA 393.45", "NSC Standard 11"
  category: "Brakes" | "Tires / Wheels" | "Lighting" | "Hours of Service" | "Driver Qualification" | "Cargo Securement" | "Hazmat" | "Other";
  description: string;
  attribution: "Driver" | "Vehicle" | "Company" | "Other / Unknown";
  outOfService: boolean;
  severityPoints?: number;
  linkedCitationId?: string;
  linkedRepairRecordId?: string;
}

export interface RootCauseFactor {
  primaryFactor: "Driver Action" | "Training / Knowledge Gap" | "Dispatch / Planning" | "Scheduling / Time Pressure" | "Customer / Facility Delay" | "Vehicle / Equipment" | "ELD / Technology" | "Weather" | "Road / Traffic" | "Load / Cargo" | "Company Procedure" | "Communication" | "Third Party" | "Unknown" | "Multiple Factors" | "Other";
  secondaryFactors?: string[];
  explanation?: string;
  determinedBy?: string;
  determinationDate?: string;
}

export type StructuredEventFactValue = string | number | boolean | null;

export interface StructuredEventFact {
  dataPointId: string;
  value: StructuredEventFactValue;
  valueType: "string" | "number" | "boolean" | "date" | "time" | "duration" | "measurement";
  unit?: string;
  normalizedValue?: number;
  normalizedUnit?: string;
  source?: string;
}

export interface OperationalReference {
  referenceType: string;
  referenceValue: string;
  source?: string;
}

export interface PerformanceEventRecord {
  id: string; // e.g. EVT-PW-000419
  companyId: string;
  driverMasterId?: string;
  companyDriverRelationshipId?: string;
  vehicleId?: string;
  trailerId?: string;
  tripId?: string;
  loadId?: string;
  customerId?: string;
  customerSiteId?: string;
  citationIds?: string[];
  inspectionId?: string;
  hosRecordIds?: string[];
  trainingRecordIds?: string[];
  maintenanceRecordIds?: string[];
  companyActionIds?: string[];
  eventType: EventType;
  eventDate: string;
  eventTime?: string;
  reportedDate: string;
  location?: string;
  city?: string;
  stateProvince?: string;
  country?: string;
  severity: EventSeverity;
  status: EventStatus;
  summary: string;
  description: string;

  /**
   * Schema-driven category facts. Keys are defined by the canonical
   * Driver Performance category registry; values are intentionally limited
   * to serializable semantic primitives rather than `any`.
   */
  /** @deprecated Compatibility projection only. Canonical semantics live in structuredEventFacts. */
  structuredFacts?: Record<string, string | number | boolean | null>;
  structuredEventFacts?: StructuredEventFact[];
  schemaVersion?: string;
  operationalReferences?: OperationalReference[];

  // Follow-up Tracking
  followUpActionRequired?: boolean;
  followUpDueDate?: string;
  followUpActionSummary?: string;

  // Collision details (Structured)
  collisionDetails?: {
    collisionType: "Rear-End" | "Sideswipe" | "Backing" | "Intersection" | "Lane Change" | "Rollover" | "Jackknife" | "Fixed Object" | "Animal" | "Pedestrian" | "Other";
    driverMovement?: string;
    weather: "Clear" | "Rain" | "Snow" | "Fog" | "Ice / Freezing Rain" | "High Wind" | "Other" | "Unknown";
    roadCondition: "Dry" | "Wet" | "Snow Covered" | "Icy" | "Gravel" | "Construction" | "Other" | "Unknown";
    lightCondition: "Daylight" | "Dawn / Dusk" | "Dark — Lighted" | "Dark — Unlighted" | "Unknown";
    towRequired: boolean;
    policeAttended: boolean;
    policeReportNumber?: string; // User-provided only, never fabricated
    injuriesCount: number;
    fatalitiesCount: number;
    /** @deprecated Legacy projection; reportability is canonical in structuredEventFacts. */
    dotReportable?: boolean;
    /** @deprecated Company Determination only; never treat as source-event fact. */
    preventability?: "Undetermined" | "Preventable" | "Non-Preventable";
    preventabilityDeterminedBy?: string;
    preventabilityDeterminationDate?: string;
    preventabilitySource?: string;
    preventabilityNotes?: string;
    estimatedCost?: string;
    driverStatement?: string;
    witnessStatements?: string;
  };

  // Roadside Inspection details (Structured)
  inspectionDetails?: {
    inspectionLevel: "Level I - Full Inspection" | "Level II - Walk-Around" | "Level III - Driver-Only" | "Level IV - Special" | "Level V - Vehicle-Only" | "Level VI - Radioactive";
    reportNumber?: string; // Optional user-provided report number, NEVER fabricated
    agency: string;
    result: "Passed" | "Violation(s) Found" | "Out of Service";
    driverViolationsCount: number;
    vehicleViolationsCount: number;
    hosViolationsCount: number;
    driverOOS: boolean;
    vehicleOOS: boolean;
    hazmatInspected?: boolean;
    violations?: InspectionViolationItem[];
    linkedCitationId?: string;
    linkedRepairRecordId?: string;
    repairStatus?: "Not Required" | "Repair Pending" | "Completed";
  };

  // HOS details (Structured)
  hosDetails?: {
    ruleJurisdiction: "CA_FEDERAL" | "US_FMCSA" | "US_TEXAS_INTRASTATE" | "US_CALIFORNIA_INTRASTATE" | "Canada (Federal 70h/7d)" | "US (FMCSA 70h/8d)" | "Texas Intrastate" | "California Intrastate";
    ruleProfileId?: string;
    violationType: HOSViolationType;
    semanticConditionClass?: string;
    legacyViolationType?: string;
    logDate: string;
    source: "ELD Live Telematics" | "Roadside Inspection" | "Internal Audit";
    hoursExceeded?: number;
    eldProvider?: string;
    reviewStatus?: "Potential" | "Under Review" | "Confirmed" | "Not a Violation" | "Unable to Determine" | "Disputed" | "Resolved";
    reviewedBy?: string;
    reviewDate?: string;
    reviewNotes?: string;
  };

  // Citation details (Referencing canonical records)
  citationDetails?: {
    citationNumber?: string;
    violationCode?: string;
    fineAmount?: number | string;
    pointsAssessed?: number;
    courtJurisdiction?: string;
    courtDate?: string;
    disposition?: "Pending" | "Paid" | "Contested" | "Dismissed" | "Guilty";
  };

  // Customer Complaint details
  complaintDetails?: {
    customerName: string;
    loadNumber?: string;
    category: "Driving Conduct" | "Communication" | "Delivery Delay" | "Cargo Handling" | "Site / Shipper Conduct" | "Documentation" | "Other";
    substantiationStatus: "Unreviewed" | "Under Review" | "Substantiated" | "Not Substantiated" | "Unable to Determine" | "Closed";
    reviewedBy?: string;
    reviewDate?: string;
    reviewNotes?: string;
  };

  // Commendation details
  commendationDetails?: {
    category: "Customer Commendation" | "Safe Driving Milestone" | "Roadside Clean Inspection" | "Peer Commendation" | "Community Service";
    customerName?: string;
    recognizedBy: string;
    description?: string;
  };

  // Coaching details
  coachingDetails?: {
    topic: string;
    coachName: string;
    discussionSummary: string;
    actionItems: string;
    followUpDate?: string;
    driverAcknowledged: boolean;
    acknowledgementDate?: string;
  };

  // Disciplinary details
  disciplinaryDetails?: {
    actionType: "Verbal Warning" | "Written Warning" | "Final Warning" | "Suspension" | "Safety Retraining Required" | "Other";
    decidedBy: string;
    factualBasis: string;
    effectiveDate: string;
    endDate?: string;
    driverAcknowledged: boolean;
  };

  // Corrective Action Plan (CAP)
  capDetails?: {
    planId: string;
    issueReason: string;
    requiredAction: string;
    responsibleParty: string;
    targetDate: string;
    completionDate?: string;
    capStatus: "Open" | "In Progress" | "Awaiting Verification" | "Completed" | "Closed";
    verificationRequired?: boolean;
    verificationStatus?: "Pending" | "Verified Effective" | "Partially Effective" | "Ineffective";
    closedBy?: string;
    closureDate?: string;
    closureNotes?: string;
  };

  // Root Cause / Contributing Factors
  rootCause?: RootCauseFactor;

  // Cross-module Links
  linkedRecords: LinkedRecordRef[];
  evidenceIds: string[];
  chronology: EventChronologyItem[];
  provenance?: ProvenanceMetadata;
  /** Verification is distinct from dispute and from company determination. */
  verificationState?: "Unverified" | "Partially Verified" | "Verified" | "Unable to Verify";
  companyDeterminationId?: string;
  companyActionId?: string;
  outcome?: {
    state: "Open" | "Resolved" | "Closed" | "Unknown";
    description?: string;
    recordedAt?: string;
    recordedBy?: string;
  };
  dispute?: {
    state: "None" | "Open" | "Resolved";
    reason?: string;
    raisedAt?: string;
    resolvedAt?: string;
    resolvedBy?: string;
  };
  closure?: {
    closedAt?: string;
    closedBy?: string;
    reason?: string;
  };
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

// Subsystem Type Aliases for Ergonomics & Backward Compatibility
export type DriverPerformanceEvent = PerformanceEventRecord;
export type PerformanceEventType = EventType;
export type PerformanceSeverity = EventSeverity;
export type PreventabilityAssessment = "Undetermined" | "Preventable" | "Non-Preventable";
export type CollisionDetails = NonNullable<PerformanceEventRecord["collisionDetails"]>;
export type RoadsideInspectionDetails = NonNullable<PerformanceEventRecord["inspectionDetails"]>;
export type CitationDetails = NonNullable<PerformanceEventRecord["citationDetails"]>;
export type HOSViolationDetails = NonNullable<PerformanceEventRecord["hosDetails"]>;
export type CustomerComplaintDetails = NonNullable<PerformanceEventRecord["complaintDetails"]>;
export type CoachingDetails = NonNullable<PerformanceEventRecord["coachingDetails"]>;
export type DisciplinaryActionDetails = NonNullable<PerformanceEventRecord["disciplinaryDetails"]>;
export type CorrectiveActionPlanDetails = NonNullable<PerformanceEventRecord["capDetails"]>;
export type CommendationDetails = NonNullable<PerformanceEventRecord["commendationDetails"]>;

// --- CANONICAL SEMANTIC STATE / PROVENANCE ---
export type SemanticState =
  | "Known"
  | "Unknown"
  | "Not Provided"
  | "Not Reviewed"
  | "Unable to Determine"
  | "Not Applicable"
  | "Pending Verification"
  | "Disputed";

export type VerificationState = "Unverified" | "Pending" | "Verified" | "Failed" | "Unable to Verify";

export interface ProvenanceMetadata {
  sourceType: "SOURCE_FACT" | "COMPANY_DETERMINATION" | "SYSTEM_DERIVED" | "TES_DERIVED_METRIC" | "LEGACY_MIGRATION";
  source?: string;
  sourceRecordId?: string;
  capturedAt?: string;
  capturedBy?: string;
  sourceTimestamp?: string;
  ingestionTimestamp?: string;
  sourceConfidence?: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  dataQuality?: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  rawPayloadReference?: string;
  migratedFrom?: string;
}

export type DriverEvidenceLinkedRecordType =
  | "Driver Application"
  | "Hiring Package"
  | "Tax Document"
  | "Policy Acknowledgement"
  | "Licence"
  | "Qualification"
  | "Screening"
  | "Medical"
  | "Drug Alcohol Record"
  | "Training"
  | "HOS"
  | "Event"
  | "Citation"
  | "Company Action";

// --- HOS CORE DOMAIN STRUCTURE (Phase 23 & 24) ---
export interface HOSDutyEvent {
  id: string;
  companyId?: string;
  driverMasterId: string;
  sourceRecordId?: string;
  vehicleId?: string;
  dutyStatus: "Off-Duty" | "Sleeper Berth" | "Driving" | "On-Duty (Not Driving)";
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  locationStart?: string;
  locationEnd?: string;
  origin: "Automatic" | "Driver Entered" | "Carrier Edit" | "Other Source";
  edited: boolean;
  certified: boolean;
}

export interface HOSRuleProfile {
  id: string;
  version?: string;
  name: string;
  source?: string;
  country: "Canada" | "United States";
  jurisdiction: string;
  cycleRules: string; // e.g. "70h / 7d", "70h / 8d", "60h / 7d"
  drivingLimitHours: number;
  onDutyWindowHours: number;
  offDutyConsecutiveHours: number;
  restBreakRule?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export type HOSViolationType =
  | "11_HOUR_DRIVING_LIMIT"
  | "14_HOUR_ON_DUTY_WINDOW"
  | "10_HOUR_OFF_DUTY_BREAK"
  | "30_MINUTE_REST_BREAK"
  | "70_HOUR_8_DAY_CYCLE"
  | "FALSE_LOG_TAMPERING"
  | "FORM_AND_MANNER"
  | "MISSING_LOG"
  | "UNCERTIFIED_LOG"
  | "SLEEPER_BERTH_SPLIT_REST"
  | "PERSONAL_CONVEYANCE"
  | "YARD_MOVE"
  | "UNASSIGNED_DRIVING"
  | "ELD_DIAGNOSTIC"
  | "ELD_MALFUNCTION"
  | "ELD_DATA_SYNC_ISSUE"
  | "OTHER"
  | "UNABLE_TO_CLASSIFY_REVIEW_REQUIRED";

export interface HOSPotentialViolation {
  id: string;
  companyId?: string;
  driverMasterId: string;
  sourceRecordId?: string;
  dutyEventIds?: string[];
  calculationVersion?: string;
  calculatedAt?: string;
  violationType: HOSViolationType;
  legacyViolationType?: string;
  violationMappingState?: TrainingMappingState;
  detectedAt: string;
  logDate: string;
  ruleProfileId: string;
  status: "Potential" | "Under Review" | "Confirmed" | "Not a Violation" | "Unable to Determine" | "Disputed" | "Resolved";
  reviewedBy?: string;
  reviewDate?: string;
  reviewNotes?: string;
  sourceType?: "SOURCE_FACT" | "SYSTEM_DERIVED";
}

export interface HOSReview {
  id: string;
  sourceRecordId?: string;
  companyDriverRelationshipId?: string;
  companyId?: string;
  driverMasterId: string;
  violationId?: string;
  violationType?: HOSViolationType;
  legacyViolationType?: string;
  violationMappingState?: TrainingMappingState;
  performanceEventId?: string;
  logDate: string;
  reviewStatus: "Potential" | "Under Review" | "Confirmed" | "Not a Violation" | "Unable to Determine" | "Disputed" | "Resolved";
  finding?: string;
  initialReviewFinding?: "Potential Violation" | "Confirmed Violation" | "False Positive" | "Exemption Applies" | "Data Diagnostic" | "Other";
  legacyInitialReviewFinding?: string;
  sourceOfFinding?: "ELD Telematics Analysis" | "Roadside Inspection Audit" | "Driver Dispute" | "Internal Periodic Audit" | "Safety Committee";
  ruleJurisdiction?: string;
  ruleProfileId?: string;
  dutyRuleViolated?: string;
  minutesExceeded?: number | string;
  evidenceSummary?: string;
  carrierResolution?: "Pending Driver Clarification" | "Under Investigation" | "Violation Confirmed — Coaching Required" | "Violation Confirmed — Formal Action" | "Resolved — Exemption Verified" | "Resolved — Diagnostic Log Adjusted" | "Disputed with Regulatory Body";
  legacyCarrierResolution?: string;
  correctiveActionReferral?: string;
  isFinalized?: boolean;
  finalizedAt?: string;
  auditorName?: string;
  auditorRole?: string;
  reviewedBy?: string;
  reviewDate?: string;
  notes?: string;
  companyDeterminationId?: string;
  companyActionId?: string;
  createdAt?: string;
  updatedAt?: string;
}

// --- COMPANY DETERMINATION & COMPANY ACTIONS (Phases 19 & 20) ---
export interface CompanyDetermination {
  id: string;
  companyId: string;
  driverMasterId: string;
  companyDriverRecordId?: string;
  relatedRecordType?: "PerformanceEvent" | "Collision" | "Inspection" | "HOSViolation" | "CustomerComplaint" | "Citation" | "Investigation";
  legacyRelatedRecordType?: string;
  relatedRecordId?: string;
  determinationType?: "COLLISION_PREVENTABILITY" | "COMPLAINT_SUBSTANTIATION" | "INVESTIGATION_FINDING" | "ROOT_CAUSE_ANALYSIS" | "CORRECTIVE_ACTION_OUTCOME";
  legacyDeterminationType?: string;
  determinationValue?: "PREVENTABLE" | "NON_PREVENTABLE" | "SUBSTANTIATED" | "NOT_SUBSTANTIATED" | "UNABLE_TO_DETERMINE";
  legacyDeterminationValue?: string;
  preventabilityFinding?: "Preventable" | "Non-Preventable" | "Undetermined";
  legacyPreventabilityFinding?: string;
  rationale?: string;
  safetyCommitteeReview?: boolean;
  determinedBy: string;
  determinationDate: string;
  source?: string;
  notes?: string;
  evidenceIds?: string[];
  isArchived?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CompanyActionRecord {
  id: string;
  companyId: string;
  driverMasterId: string;
  companyDriverRecordId?: string;
  actionType: "COACHING" | "TRAINING_ASSIGNMENT" | "VERBAL_WARNING" | "WRITTEN_WARNING" | "FINAL_WARNING" | "SUSPENSION" | "POLICY_REVIEW" | "MONITORING_TELEMATICS" | "DISPATCH_CHANGE" | "EQUIPMENT_INSPECTION_REPAIR" | "CORRECTIVE_ACTION_PLAN" | "DISCIPLINARY_ACTION" | "SAFETY_WARNING" | "RETRAINING_MANDATE" | "PERFORMANCE_IMPROVEMENT_PLAN" | "OTHER";
  legacyActionType?: string;
  title?: string;
  issueDate?: string;
  decidedBy: string;
  decidedByRole?: string;
  decisionDate?: string;
  effectiveDate: string;
  endDate?: string;
  followUpDate?: string;
  factualBasis: string;
  reason?: string;
  description?: string;
  requiredRemediation?: string;
  facilitatorName?: string;
  facilitatorRole?: string;
  targetCompletionDate?: string;
  actualCompletionDate?: string;
  formalSignOffStatus?: "Draft" | "Pending Driver Signature" | "Signed / Executed" | "Refused to Sign" | "Waived";
  legacyFormalSignOffStatus?: string;
  actionItems?: string[];
  linkedEventIds?: string[];
  linkedRecordId?: string;
  evidenceIds?: string[];
  driverAcknowledged?: boolean;
  acknowledgementDate?: string;
  status: "Draft" | "Active" | "Completed" | "Rescinded" | "In Progress";
  closureNotes?: string;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- PERFORMANCE INTELLIGENCE DATA CONTRACTS (Phases 2, 3, 5, 6, 8, 9) ---
export interface PerformanceMetricResult {
  metricId: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  rawValue: number | string;
  normalizedValue: number; // 0 - 100
  includedRecordIds: string[];
  excludedRecordIds: string[];
  exclusionReasons: { recordId: string; reason: string }[];
  calculationVersion: string;
  calculatedAt: string;
  summaryText: string;
}

export interface PerformanceCategoryScore {
  categoryId: "hos" | "roadside" | "collision" | "training" | "compliance" | "positive";
  label: string;
  score: number; // 0 - 100
  weight: number; // e.g. 0.25 (25%)
  metricResults: PerformanceMetricResult[];
  calculationVersion: string;
  calculatedAt: string;
  keyFindings: string[];
}

export interface PerformancePatternItem {
  id: string;
  category: "HOS" | "Inspection" | "Collision" | "Telematics" | "Positive" | "Operational";
  title: string;
  factualObservation: string;
  supportingRecordCount: number;
  totalRelevantRecordCount: number;
  recordIds: string[];
  contributingConditions?: string[];
}

export interface DriverPerformanceSnapshot {
  driverMasterId: string;
  companyDriverRecordId: string;
  periodLabel: "30D" | "90D" | "12M" | "YTD" | "ALL";
  periodStart: string;
  periodEnd: string;
  overallScore: number; // 0 - 100
  categoryScores: PerformanceCategoryScore[];
  dataCoverage: {
    coveragePercentage: number; // 0 - 100
    confidenceTier: "High" | "Moderate" | "Limited Data" | "Not yet calculated";
    periodRepresentedDays: number;
    hosDataAvailable: boolean;
    roadsideHistoryCount: number;
    trainingApplicabilityCount: number;
    eventCount: number;
    documentedDeterminationsCount: number;
    sourceConnectivity: "Disconnected" | "Partial Manual" | "Integrated";
  };
  fleetRank?: {
    rank: number;
    comparisonCohortSize: number;
    cohortDescription: string;
  };
  trend?: {
    direction: "Improving" | "Stable" | "Declining" | "Insufficient Data";
    pointDelta: number;
    comparisonPeriodLabel: string;
    explanation: string;
  };
  patterns: PerformancePatternItem[];
  calculationVersion: string;
  calculatedAt: string;
}

export interface FleetRankingEntry {
  driverMasterId: string;
  companyDriverRecordId: string;
  driverName: string;
  operatingRegion: OperatingRegion;
  recordType: RecordType;
  overallScore: number;
  coveragePercentage: number;
  confidenceTier: string;
  trendDirection: "Improving" | "Stable" | "Declining" | "Insufficient Data";
  totalEventsInWindow: number;
  cleanInspectionsInWindow: number;
}

export interface FleetRankingResult {
  cohortDescription: string;
  periodLabel: string;
  comparisonWindow: string;
  calculationVersion: string;
  entries: FleetRankingEntry[];
}

export interface ELDEditRequest {
  id: string;
  dutyEventId: string;
  originalStatus: string;
  proposedStatus: string;
  requestedBy: string;
  reason: string;
  requestedAt: string;
  driverApprovalStatus: "Pending" | "Approved" | "Rejected";
  driverResponseDate?: string;
  previousEditId?: string;
  editSequence?: number;
  source?: "ELD" | "Carrier" | "Driver" | "Other";
}

export interface UnassignedDrivingSegment {
  id: string;
  vehicleId: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  distanceKm?: number;
  locationStart?: string;
  locationEnd?: string;
  suggestedDriverId?: string;
  assignmentStatus: "Unassigned" | "Assigned" | "Ignored - Yard Move";
  assignedDriverId?: string;
  assignedBy?: string;
  assignedDate?: string;
}

export interface ELDDiagnosticRecord {
  id: string;
  diagnosticType: "Data Diagnostic" | "Malfunction";
  code: string;
  description: string;
  startTime: string;
  resolvedTime?: string;
  vehicleId?: string;
  driverMasterId?: string;
  status: "Active" | "Acknowledged" | "Resolved";
  paperLogsUsed?: boolean;
}

// --- DRIVER EVIDENCE / ATTACHMENTS ---
export interface DriverEvidenceItem {
  id: string;
  companyId: string;
  driverMasterId: string;
  linkedRecordType?: DriverEvidenceLinkedRecordType;
  linkedRecordId?: string;
  recordId?: string;
  category?: string;
  mimeType?: string;
  fileName: string;
  fileType: string;
  documentType: string;
  uploadedAt: string;
  documentDate?: string;
  source: "camera" | "upload" | "manual" | "Upload" | "Camera" | "Generated" | "External";
  dataUrl?: string;
  verificationState?: "unverified" | "verified" | "pending_review" | "superseded" | "Not Reviewed" | "Under Review" | "Source Matched" | "Difference Present" | "Externally Verified";
  ocrConfidence?: number;
  verifiedBy?: string;
  verifiedAt?: string;
  ocrProvider?: string;
  evidenceVersion?: number;
  supersedesEvidenceId?: string;
  isArchived?: boolean;
}

// --- CANONICAL HOS CONTRACTS ---
export interface HOSRawRecord {
  id: string;
  companyId: string;
  driverMasterId: string;
  source: "ELD" | "Roadside Inspection" | "Driver Submission" | "Internal Audit" | "Other";
  sourceRecordId?: string;
  capturedAt: string;
  payloadReference?: string;
  notes?: string;
}

export interface TelematicsObservation {
  id: string;
  companyId: string;
  driverMasterId?: string;
  vehicleId?: string;
  observedAt: string;
  observationType: string;
  source: string;
  sourceRecordId?: string;
  payloadSummary?: string;
  authoritativeLegalHOS: false;
}

// --- CANONICAL EVENT / CITATION RELATIONSHIPS ---
export type CanonicalEventCategory =
  | "Collision / Incident"
  | "Roadside Inspection"
  | "Violation"
  | "Warning"
  | "Citation-linked Event"
  | "HOS-related Event"
  | "Equipment-related Event"
  | "Safety Observation"
  | "Customer Complaint"
  | "Customer Compliment"
  | "Commendation"
  | "Telematics / Camera Observation"
  | "Security Event"
  | "Emergency Event"
  | "Speeding"
  | "Harsh Braking"
  | "Harsh Acceleration"
  | "Harsh Cornering"
  | "Following Distance"
  | "Fatigue Indicator"
  | "Device / Data Integrity"
  | "Trip Completion / Service Performance"
  | "Lane Departure"
  | "Seatbelt"
  | "Distracted Driving"
  | "Idle Time"
  | "Route Deviation"
  | "Backing"
  | "Stop Sign / Red Light"
  | "Railroad Crossing"
  | "Customer-Site Behavior"
  | "PPE / Safety Protocol"
  | "Equipment Failure / Critical Defect";

export interface CitationRecord {
  id: string;
  companyId: string;
  citationType: string;
  reportNumber: string;
  issuingAgency: string;
  jurisdictionCode: string;
  jurisdictionLabel: string;
  country: string;
  eventDate: string;
  courtDueDate?: string;
  resolvedDate?: string;
  inspectionLevel: string;
  officerName?: string;
  officerBadge?: string;
  location?: string;
  driverName?: string;
  driverDl?: string;
  driverMasterId?: string;
  companyDriverRelationshipId?: string;
  driverLinkReviewState?: "NOT_REVIEWED" | "LINKED" | "REVIEW_REQUIRED";
  driverLinkReviewReason?: string;
  vehicleId?: string;
  tripId?: string;
  inspectionId?: string;
  eventId?: string;
  unitNumber?: string;
  vin?: string;
  plate?: string;
  outOfService: boolean;
  violations: Array<{ id: string; code: string; description: string; outOfService: boolean; basicCategory: string; points?: number; }>;
  fineAmount?: string;
  paidAmount?: string;
  adjudicationStatus: string;
  notes?: string;
  evidenceIds: string[];
  source: "OCR" | "Manual" | "Imported";
  sourceRecord?: string;
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
}

export interface CitationStore {
  version: 2;
  companyId: string;
  citations: CitationRecord[];
  evidence: Array<{ id: string; recordId?: string; fileName: string; mimeType: string; dataUrl: string; documentDate: string; uploadedAt: string; source: "camera" | "device" | "upload" | "manual"; ocrConfidence?: number; }>;
}

export interface CompanyEventLink {
  id: string;
  companyId: string;
  eventId: string;
  driverMasterId?: string;
  companyDriverRelationshipId?: string;
  source: "CANONICAL_EVENT" | "LEGACY_DRIVER_EVENT_LINK";
  legacyRecordId?: string;
}

// --- STORE ENVELOPE FOR COMPANY-SCOPED DRIVER DATA ---
export interface CompanyDriverStore {
  version: 2;
  companyId: string;
  relationships: CompanyDriverRelationship[];
  applications: DriverApplicationRecord[];
  hiringPackages: HiringPackageRecord[];
  taxDocs: DriverTaxDocRecord[];
  screenings: ScreeningRecord[];
  trainingRecords: TrainingRecord[];
  trainingRequirements: TrainingRequirement[];
  events: PerformanceEventRecord[];
  evidence: DriverEvidenceItem[];
  hosRawRecords: HOSRawRecord[];
  telematicsObservations?: TelematicsObservation[];
  hosDutyEvents: HOSDutyEvent[];
  hosRuleProfiles: HOSRuleProfile[];
  hosPotentialViolations: HOSPotentialViolation[];
  hosReviews: HOSReview[];
  eldEditRequests: ELDEditRequest[];
  unassignedDriving: UnassignedDrivingSegment[];
  eldDiagnostics: ELDDiagnosticRecord[];
  companyDeterminations: CompanyDetermination[];
  companyActions: CompanyActionRecord[];
  // Legacy collections retained read-only for compatibility until their consumers migrate.
  taxForms?: unknown[];
  customPolicies?: unknown[];
  qualifications?: unknown[];
  experience?: unknown[];
  medicalRecords?: unknown[];
  drugAlcoholRecords?: unknown[];
  hosSummaries?: unknown[];
  hosViolations?: unknown[];
  eventLinks?: unknown[];
  performanceEvents?: PerformanceEventRecord[];
}

export interface DriverMasterStore {
  version: 2;
  drivers: DriverMaster[];
}

// --- FORM INPUTS ---
export interface DriverInput {
  legalFirstName: string;
  legalMiddleName: string;
  legalLastName: string;
  preferredName: string;
  dateOfBirth: string;
  phone?: string;
  email?: string;
  recordType: RecordType;
  operatingRegion: OperatingRegion;
  driverStatus: DriverStatus;
  // Legacy fields made optional for backward compatibility
  currentRole?: DriverRole;
  employmentStatus?: EmploymentStatus;
  relationshipStartDate: string;
  relationshipEndDate: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateProvince: string;
  postalZip: string;
  country: "Canada" | "United States";
  addressEffectiveFrom: string;
  licenceNumber: string;
  licenceJurisdiction: string;
  licenceCountry: "Canada" | "United States";
  licenceClass: string;
  licenceEffectiveFrom: string;
  airBrakeQualified?: boolean;
  endorsements?: string[];
  verificationState?: LicenceVerificationState;
  jurisdictionReview?: {
    reason: string;
    explanation: string;
    expectedResolutionDate: string;
  };
}

export interface CanonicalCompany {
  id: string;
  name: string;
  kind?: string;
  status?: string;
  region?: string;
  regCorpState?: string;
  regCorpCountry?: string;
  [key: string]: any;
}