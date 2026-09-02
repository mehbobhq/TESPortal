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
  licenceNumberRaw?: string; // Exact documentary value
  jurisdiction: string; // e.g. "ON", "AB", "IL", "TX"
  country: "Canada" | "United States";
  class?: string; // e.g. "Class A / AZ", "Class 1", "CDL-A"
  endorsements?: string[]; // e.g. ["Air Brake (Z)", "Hazmat (H)", "Tanker (N)", "Doubles/Triples (T)", "Other / Unlisted"]
  endorsementNotes?: string;
  restrictions?: string[]; // e.g. ["Corrective Lenses (01)", "Automatic Transmission Only (E)", "Other / Unlisted"]
  restrictionNotes?: string;
  airBrakeQualified?: boolean;
  issueDate?: string;
  expiryDate?: string;
  verificationState?: LicenceVerificationState;
  evidenceIds?: string[];
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
  companyDriverRecordId?: string; // Canonical alias for relationship ID
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
  | "Driver Abstract / MVR Review"
  | "Previous Employer Verification"
  | "FMCSA Clearinghouse Query"
  | "Pre-Employment Screening Program (PSP)"
  | "Criminal Background Check"
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

export interface MedicalPhysicalDetails {
  examinationDate?: string;
  certificateIssueDate?: string;
  expiryDate?: string;
  examinerName?: string;
  nationalRegistryNumber?: string;
  medicalQualificationStatus?: "Qualified (2 Years)" | "Qualified (1 Year)" | "Qualified (3-6 Months Temporary)" | "Disqualified" | "Pending Variance" | string;
  varianceRestrictions?: string[];
  verificationState?: "Unverified" | "Document Verified" | "National Registry Confirmed" | string;
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

// --- TRAINING (Structured Historical Ledger) ---
export type TrainingStatus =
  | "Required"
  | "Assigned"
  | "Scheduled"
  | "In Progress"
  | "Completed"
  | "Expired"
  | "Waived"
  | "Exempted"
  | "Cancelled"
  | "Not Applicable";

export type TrainingType =
  | "Initial Onboarding"
  | "Annual Refresher"
  | "Post-Incident Corrective"
  | "Regulatory Mandated"
  | "Regulatory Mandate"
  | "Certification"
  | "Orientation"
  | "Safety Seminar"
  | "Company Policy"
  | "Corrective Action Re-training"
  | "Specialized Cargo"
  | "Winter / Grade Operations"
  | string;

export interface TrainingRecord {
  id: string; // e.g. TRN-000047
  companyId: string;
  driverMasterId: string;
  courseTitle: string;
  trainingType: TrainingType;
  provider: string; // e.g. "Internal Safety Team", "Pro-Tread", "JJ Keller"
  assignedDate?: string;
  startDate?: string;
  completionDate?: string;
  expiryDate?: string;
  status: TrainingStatus;
  scoreOrResult?: string; // e.g. "100%", "Pass"
  certificateNumber?: string; // Optional - source-derived only, NEVER fabricated
  waiveReason?: string;
  waivedBy?: string;
  waivedDate?: string;
  evidenceIds: string[];
  notes?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
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
  | "Security Incident";

export type EventSeverity = "Low" | "Moderate" | "High" | "Critical";

export type EventStatus =
  | "Open"
  | "Under Review"
  | "Awaiting Information"
  | "Follow-up Required"
  | "Closed";

export interface LinkedRecordRef {
  entityType: "Vehicle" | "Trailer" | "Citation" | "Inspection" | "Repair" | "Training" | "Screening" | "Document" | "Event" | "Unlinked Operational Reference";
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

export interface PerformanceEventRecord {
  id: string; // e.g. EVT-PW-000419
  companyId: string;
  driverMasterId: string;
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
    dotReportable: boolean;
    preventability: "Undetermined" | "Preventable" | "Non-Preventable";
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
    ruleJurisdiction: "Canada (Federal 70h/7d)" | "US (FMCSA 70h/8d)" | "Texas Intrastate" | "California Intrastate";
    violationType: "11-Hour Driving Limit" | "14-Hour On-Duty Window" | "10-Hour Off-Duty Break" | "30-Minute Rest Break" | "70-Hour / 8-Day Cycle" | "False Log / Tampering" | "Form & Manner" | "Other";
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

// --- HOS CORE DOMAIN STRUCTURE (Phase 23 & 24) ---
export interface HOSDutyEvent {
  id: string;
  driverMasterId: string;
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
  name: string;
  country: "Canada" | "United States";
  jurisdiction: string;
  cycleRules: string; // e.g. "70h / 7d", "70h / 8d", "60h / 7d"
  drivingLimitHours: number;
  onDutyWindowHours: number;
  offDutyConsecutiveHours: number;
  restBreakRule?: string;
}

export interface HOSPotentialViolation {
  id: string;
  driverMasterId: string;
  violationType: string;
  detectedAt: string;
  logDate: string;
  ruleProfileId: string;
  status: "Potential" | "Under Review" | "Confirmed" | "Not a Violation" | "Unable to Determine" | "Disputed" | "Resolved";
  reviewedBy?: string;
  reviewDate?: string;
  reviewNotes?: string;
}

export interface HOSReview {
  id: string;
  companyId?: string;
  driverMasterId: string;
  violationId?: string;
  violationType?: string;
  performanceEventId?: string;
  logDate: string;
  reviewStatus: "Potential" | "Under Review" | "Confirmed" | "Not a Violation" | "Unable to Determine" | "Disputed" | "Resolved";
  finding?: string;
  initialReviewFinding?: "Potential Violation" | "Confirmed Violation" | "False Positive" | "Exemption Applies" | "Data Diagnostic" | "Other" | string;
  sourceOfFinding?: "ELD Telematics Analysis" | "Roadside Inspection Audit" | "Driver Dispute" | "Internal Periodic Audit" | "Safety Committee";
  ruleJurisdiction?: string;
  dutyRuleViolated?: string;
  minutesExceeded?: number | string;
  evidenceSummary?: string;
  carrierResolution?: "Pending Driver Clarification" | "Under Investigation" | "Violation Confirmed — Coaching Required" | "Violation Confirmed — Formal Action" | "Resolved — Exemption Verified" | "Resolved — Diagnostic Log Adjusted" | "Disputed with Regulatory Body" | string;
  correctiveActionReferral?: string;
  isFinalized?: boolean;
  finalizedAt?: string;
  auditorName?: string;
  auditorRole?: string;
  reviewedBy?: string;
  reviewDate?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

// --- COMPANY DETERMINATION & COMPANY ACTIONS (Phases 19 & 20) ---
export interface CompanyDetermination {
  id: string;
  companyId: string;
  driverMasterId: string;
  companyDriverRecordId?: string;
  relatedRecordType?: "PerformanceEvent" | "Collision" | "Inspection" | "HOSViolation" | "CustomerComplaint" | "Citation" | "Investigation" | string;
  relatedRecordId?: string;
  determinationType?: "Collision Preventability" | "Complaint Substantiation" | "Investigation Finding" | "Root Cause Analysis" | "Corrective Action Outcome" | string;
  determinationValue?: "Preventable" | "Non-Preventable" | "Substantiated" | "Not Substantiated" | "Unable to Determine" | string;
  preventabilityFinding?: "Preventable" | "Non-Preventable" | "Undetermined" | string;
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
  actionType: "Coaching" | "Coaching Session" | "Training Assignment" | "Verbal Warning" | "Written Warning" | "Final Warning" | "Suspension" | "Policy Review" | "Monitoring / Telematics Watch" | "Dispatch Change" | "Equipment Inspection / Repair" | "Corrective Action Plan" | "Disciplinary Action" | "Safety Warning" | "Retraining Mandate" | "Performance Improvement Plan" | "Other" | string;
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
  formalSignOffStatus?: "Draft" | "Pending Driver Signature" | "Signed / Executed" | "Refused to Sign" | "Waived" | string;
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
  id: string; // e.g. DOC-000291
  companyId: string;
  driverMasterId: string;
  fileName: string;
  fileType: string;
  documentType: string; // "Driver Licence", "Medical Certificate", "MVR Abstract", "Police Report", "Inspection Report", "Training Certificate", "Application Document"
  uploadedAt: string;
  documentDate?: string;
  source: "camera" | "upload" | "manual";
  dataUrl?: string;
  verificationState?: "unverified" | "verified" | "pending_review" | "superseded";
  ocrConfidence?: number;
}

// --- STORE ENVELOPE FOR COMPANY-SCOPED DRIVER DATA ---
export interface CompanyDriverStore {
  version: 1;
  companyId: string;
  relationships: CompanyDriverRelationship[];
  applications?: DriverApplicationRecord[];
  hiringPackages?: HiringPackageRecord[];
  taxDocs?: DriverTaxDocRecord[];
  screenings?: ScreeningRecord[];
  trainingRecords?: TrainingRecord[];
  performanceEvents?: PerformanceEventRecord[];
  evidence?: DriverEvidenceItem[];
  hosDutyEvents?: HOSDutyEvent[];
  hosRuleProfiles?: HOSRuleProfile[];
  hosPotentialViolations?: HOSPotentialViolation[];
  hosReviews?: HOSReview[];
  eldEditRequests?: ELDEditRequest[];
  unassignedDriving?: UnassignedDrivingSegment[];
  eldDiagnostics?: ELDDiagnosticRecord[];
  companyDeterminations?: CompanyDetermination[];
  companyActions?: CompanyActionRecord[];
}

export interface DriverMasterStore {
  version: 1;
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
