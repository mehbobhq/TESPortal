/**
 * Alberta National Safety Code (NSC) Full Facility Audit — Phase 2A regime
 * definition, built on the Phase 1 architecture (types/audit-preparedness.ts).
 *
 * SOURCE NOTE (read before editing): no independent Alberta NSC source
 * document (regulation text, official audit manual, or sample audit PDF)
 * exists anywhere in this repository. Every requirement and category below
 * was described directly by the TES operator in the Phase 2 task
 * instructions as reflecting a real, previously-analyzed Alberta NSC Full
 * Facility Audit. That is the source for this file — it is not
 * independently re-verified against a document read in this repository.
 * See the two SourceReference constants below for how this file
 * distinguishes "established methodology" from "example-audit pattern."
 *
 * Every Requirement here traces to an item explicitly enumerated in the
 * Phase 2 task instructions. Nothing was added because it "seemed like it
 * should be there" — see the Phase 2A report for the full traceability
 * list and for gaps deliberately left open.
 */

import type {
  AuditRegime,
  SubjectArea,
  Requirement,
  EvidenceRequirement,
  PopulationRule,
  SourceReference,
} from "../../types/audit-preparedness";

// ---------------------------------------------------------------------------
// SOURCE PROVENANCE — two distinct authority levels, never conflated
// ---------------------------------------------------------------------------

/**
 * For facts presented as CONFIRMED REGULATORY METHODOLOGY (currently: only
 * the Hours of Service / Safety / Vehicle subject-area weighting split).
 */
const ESTABLISHED_METHODOLOGY_SOURCE: SourceReference = {
  description:
    "Alberta NSC Full Facility Audit subject-area weighting (Hours of Service / Safety / Vehicle), asserted by the TES operator as confirmed, established audit methodology rather than an observation from one example audit. No independent source document for this fact is present in this repository as of this implementation — this description is the full extent of its provenance.",
  // OPERATOR_SUPPLIED rather than SOURCE_EXPLICIT: stated directly by the
  // operator in conversation, not drawn from a document this codebase has
  // inspected. Retrofitted for consistency once ProvenanceTag was added in
  // Phase 2B — no change to the description or to this fact's actual
  // authority level.
  provenanceTag: "OPERATOR_SUPPLIED",
};

/**
 * For every specific requirement/audit-question item below. These reflect
 * a requirement CATEGORY the operator says is demonstrated by one real,
 * previously-analyzed Alberta NSC Full Facility Audit — not an
 * independently verified regulatory citation, and not a general rule
 * inferred beyond "this category of question exists in the methodology."
 */
const EXAMPLE_AUDIT_PATTERN_SOURCE: SourceReference = {
  description:
    "Requirement category described directly by the TES operator (Phase 2 task instructions) as demonstrated by one supplied, previously-analyzed Alberta NSC Full Facility Audit. Reflects an audit-question pattern, not an independently verified regulatory citation. No source document is present in this repository as of this implementation.",
  provenanceTag: "OPERATOR_SUPPLIED",
};

// ---------------------------------------------------------------------------
// REGIME
// ---------------------------------------------------------------------------

export const ALBERTA_NSC_REGIME_ID = "ab-nsc-full-facility-audit";

const SUBJECT_AREA_HOS_ID = "ab-nsc-hos";
const SUBJECT_AREA_SAFETY_ID = "ab-nsc-safety";
const SUBJECT_AREA_VEHICLE_ID = "ab-nsc-vehicle";

// ---------------------------------------------------------------------------
// SUBJECT AREAS — established methodology weighting
// ---------------------------------------------------------------------------
// Confirmed source structure (operator-verified against the supplied
// Alberta Full Facility Audit, Phase 2A review correction):
//   Hours of Service (32%) — Hours of Service; Hours of Service - Daily Questions
//   Safety (36%)           — Carrier Safety; Driver File; Safety Program; Financial Responsibility
//   Vehicle (32%)          — Vehicle Maintenance; Vehicle File
// The Carrier Safety / Driver File / Safety Program / Financial
// Responsibility → Safety mapping used below is therefore confirmed source
// structure, not an inference.

export const ALBERTA_NSC_SUBJECT_AREAS: SubjectArea[] = [
  {
    id: SUBJECT_AREA_HOS_ID,
    regimeId: ALBERTA_NSC_REGIME_ID,
    name: "Hours of Service",
    officialWeight: 32,
    weightSource: ESTABLISHED_METHODOLOGY_SOURCE,
    requirementIds: [], // populated below once requirement ids exist
  },
  {
    id: SUBJECT_AREA_SAFETY_ID,
    regimeId: ALBERTA_NSC_REGIME_ID,
    name: "Safety",
    officialWeight: 36,
    weightSource: ESTABLISHED_METHODOLOGY_SOURCE,
    requirementIds: [],
  },
  {
    id: SUBJECT_AREA_VEHICLE_ID,
    regimeId: ALBERTA_NSC_REGIME_ID,
    name: "Vehicle",
    officialWeight: 32,
    weightSource: ESTABLISHED_METHODOLOGY_SOURCE,
    requirementIds: [],
  },
];

// ---------------------------------------------------------------------------
// POPULATION RULES — driver file, vehicle file, and HOS sampling
// ---------------------------------------------------------------------------
// Sample size is left as an open parameter (targetSampleSize left
// undefined) per Phase 2 section 0 — the example audit's Driver Sample
// Size: 2 / Vehicle Sample Size: 4 describe that one carrier's one audit,
// not a general Alberta rule, and must not become a default here.
//
// Only the PRE_AUDIT_ELIGIBLE_POPULATION variant is instantiated below,
// matching TES's current pre-audit-readiness use case. An
// ACTUAL_AUDIT_REQUESTED_SAMPLE sibling record (same shape, mode swapped)
// would be created once real audit dates/sample letters exist — the type
// already supports it (PopulationMode, types/audit-preparedness.ts); no
// instance is fabricated here for a scenario with no current input.

export const ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID = "ab-nsc-driver-file-population";
export const ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID = "ab-nsc-vehicle-file-population";
export const ALBERTA_NSC_HOS_SAMPLE_POPULATION_RULE_ID = "ab-nsc-hos-sample-population";

const DRIVER_FILE_ANCHOR_REQUIREMENT_ID = "ab-nsc-driver-file-application";
const VEHICLE_FILE_ANCHOR_REQUIREMENT_ID = "ab-nsc-vehicle-file-identification";
const HOS_SAMPLE_ANCHOR_REQUIREMENT_ID = "ab-nsc-hos-available-on-duty-hours";

export const ALBERTA_NSC_POPULATION_RULES: PopulationRule[] = [
  {
    id: ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    requirementId: DRIVER_FILE_ANCHOR_REQUIREMENT_ID,
    description:
      "Eligible driver population for Driver File requirements. All Driver File requirements below share this same population/sample rather than being sampled independently per requirement.",
    scopeEntityType: "Driver",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
    // targetSampleSize intentionally left undefined — see file header note.
  },
  {
    id: ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    requirementId: VEHICLE_FILE_ANCHOR_REQUIREMENT_ID,
    description:
      "Eligible vehicle population for Vehicle File / Maintenance requirements. All Vehicle File requirements below share this same population/sample.",
    scopeEntityType: "Vehicle",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
  },
  {
    id: ALBERTA_NSC_HOS_SAMPLE_POPULATION_RULE_ID,
    requirementId: HOS_SAMPLE_ANCHOR_REQUIREMENT_ID,
    description:
      "Sampled duty-status days for applicable drivers during the audit period, for the daily/sample-level Hours of Service requirements.",
    scopeEntityType: "Driver",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
  },
];

// ---------------------------------------------------------------------------
// EVIDENCE REQUIREMENTS
// ---------------------------------------------------------------------------
// evidenceType strings are descriptive category labels, not tied to any
// fixed enum (EvidenceRecord.documentType is a free string — see
// types/evidence.ts). entityScope reflects which domain naturally owns the
// evidence; the requirement's own entityScope may differ (e.g. HOS
// supporting-document verification is a Driver-scoped requirement that can
// draw on Vehicle- or Company-owned evidence — audit relevance does not
// equal ownership).

let evidenceRequirementCounter = 0;
function evidenceReq(
  requirementId: string,
  evidenceType: string,
  entityScope: EvidenceRequirement["entityScope"],
  options?: Partial<Pick<EvidenceRequirement, "necessity" | "conditionalOn" | "alternatives" | "recencyRequirementDays">>
): EvidenceRequirement {
  evidenceRequirementCounter += 1;
  return {
    id: `${requirementId}-ev${evidenceRequirementCounter}`,
    requirementId,
    evidenceType,
    necessity: options?.necessity ?? "required",
    conditionalOn: options?.conditionalOn,
    entityScope,
    alternatives: options?.alternatives,
    recencyRequirementDays: options?.recencyRequirementDays,
  };
}

// ---------------------------------------------------------------------------
// REQUIREMENTS — grouped exactly as enumerated in the Phase 2 instructions
// ---------------------------------------------------------------------------

function requirement(
  id: string,
  subjectAreaId: string,
  name: string,
  description: string,
  populationRuleId?: string,
  // Phase 2D addition, purely additive: existing calls that don't pass this
  // continue to produce byte-identical Requirement objects otherwise.
  capabilityIds?: string[]
): Requirement {
  return {
    id,
    regimeId: ALBERTA_NSC_REGIME_ID,
    subjectAreaId,
    name,
    description,
    populationRuleId,
    evidenceRequirementIds: [], // populated after evidence requirements are built
    // No Alberta automatic-failure/gate rule is established in source
    // material for any requirement below — see report. Conservatively false
    // throughout rather than guessing which items would gate.
    canTriggerGate: false,
    sourceReference: EXAMPLE_AUDIT_PATTERN_SOURCE,
    capabilityIds,
  };
}

// --- CARRIER SAFETY (→ Safety subject area — confirmed source structure, see note above) ---

const carrierSafetyRequirements: Requirement[] = [
  requirement(
    "ab-nsc-carrier-safety-records-ppob",
    SUBJECT_AREA_SAFETY_ID,
    "Carrier records / principal place of business",
    "Carrier maintains required records at its principal place of business."
  ),
  requirement(
    "ab-nsc-carrier-safety-program-location",
    SUBJECT_AREA_SAFETY_ID,
    "Safety Program location",
    "The written Safety Program is located and available as required."
  ),
  requirement(
    "ab-nsc-carrier-safety-designated-officer",
    SUBJECT_AREA_SAFETY_ID,
    "Designated Safety Officer",
    "Carrier has designated a Safety Officer responsible for the Safety Program."
  ),
  requirement(
    "ab-nsc-carrier-safety-fitness-certificate",
    SUBJECT_AREA_SAFETY_ID,
    "Safety Fitness Certificate process",
    "Carrier follows the required Safety Fitness Certificate process."
  ),
  requirement(
    "ab-nsc-carrier-safety-collision-reporting",
    SUBJECT_AREA_SAFETY_ID,
    "Collision reporting",
    "Carrier reports collisions as required.",
    undefined,
    ["ACCIDENT_REVIEW"]
  ),
  requirement(
    "ab-nsc-carrier-safety-driver-licensing",
    SUBJECT_AREA_SAFETY_ID,
    "Driver licensing",
    "Carrier verifies and maintains driver licensing as required."
  ),
  requirement(
    "ab-nsc-carrier-safety-bol-retention",
    SUBJECT_AREA_SAFETY_ID,
    "Bill of Lading retention",
    "Carrier retains Bills of Lading as required."
  ),
];

// --- SAFETY PROGRAM (→ Safety subject area) ---

const safetyProgramRequirements: Requirement[] = [
  requirement(
    "ab-nsc-safety-program-applies-to-staff",
    SUBJECT_AREA_SAFETY_ID,
    "Program applies to appropriate staff",
    "The Safety Program applies to all appropriate staff."
  ),
  requirement(
    "ab-nsc-safety-program-required-topics",
    SUBJECT_AREA_SAFETY_ID,
    "Required safety topics",
    "The Safety Program covers the required safety topics."
  ),
  requirement(
    "ab-nsc-safety-program-documentation-topics",
    SUBJECT_AREA_SAFETY_ID,
    "Documentation/record topics",
    "The Safety Program covers required documentation/record-keeping topics."
  ),
  requirement(
    "ab-nsc-safety-program-driver-conduct",
    SUBJECT_AREA_SAFETY_ID,
    "Driver responsibilities/conduct",
    "The Safety Program defines driver responsibilities and conduct expectations."
  ),
  requirement(
    "ab-nsc-safety-program-safety-equipment",
    SUBJECT_AREA_SAFETY_ID,
    "Safety equipment",
    "The Safety Program addresses required safety equipment."
  ),
  requirement(
    "ab-nsc-safety-program-record-retention",
    SUBJECT_AREA_SAFETY_ID,
    "Driver record retention",
    "The Safety Program establishes driver record retention practices."
  ),
  requirement(
    "ab-nsc-safety-program-driver-qualification",
    SUBJECT_AREA_SAFETY_ID,
    "Driver qualification",
    "The Safety Program establishes driver qualification standards."
  ),
  requirement(
    "ab-nsc-safety-program-unsafe-vehicle-prohibition",
    SUBJECT_AREA_SAFETY_ID,
    "Unsafe vehicle prohibition",
    "The Safety Program prohibits operation of unsafe vehicles."
  ),
  requirement(
    "ab-nsc-safety-program-driver-instruction",
    SUBJECT_AREA_SAFETY_ID,
    "Driver instruction",
    "The Safety Program provides required driver instruction."
  ),
  requirement(
    "ab-nsc-safety-program-substantial-compliance",
    SUBJECT_AREA_SAFETY_ID,
    "Actual/substantial compliance with Safety Program",
    "The carrier demonstrates actual/substantial compliance with its own Safety Program."
  ),
];

// --- FINANCIAL RESPONSIBILITY (→ Safety subject area) ---

const financialResponsibilityRequirements: Requirement[] = [
  requirement(
    "ab-nsc-financial-responsibility-insurance",
    SUBJECT_AREA_SAFETY_ID,
    "Applicable insurance requirements",
    "Carrier meets applicable insurance/financial responsibility requirements.",
    undefined,
    ["FINANCIAL_RESPONSIBILITY"]
  ),
];

// --- DRIVER FILE (→ Safety subject area; sampled via driver-file population rule) ---

const driverFileRequirements: Requirement[] = [
  requirement(
    DRIVER_FILE_ANCHOR_REQUIREMENT_ID,
    SUBJECT_AREA_SAFETY_ID,
    "Application",
    "Driver file contains a completed application.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION"]
  ),
  requirement(
    "ab-nsc-driver-file-employment-history",
    SUBJECT_AREA_SAFETY_ID,
    "Employment history",
    "Driver file contains employment history.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION"]
  ),
  requirement(
    "ab-nsc-driver-file-annual-abstract",
    SUBJECT_AREA_SAFETY_ID,
    "Annual driver abstract",
    "Driver file contains the required annual driver abstract.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION"]
  ),
  requirement(
    "ab-nsc-driver-file-hire-date-abstract",
    SUBJECT_AREA_SAFETY_ID,
    "Hire-date abstract where applicable",
    "Driver file contains a hire-date abstract when applicable. Applicability depends on carrier-specific hiring circumstances and is determined per driver, not assumed.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION"]
  ),
  requirement(
    "ab-nsc-driver-file-convictions-penalties",
    SUBJECT_AREA_SAFETY_ID,
    "Convictions/administrative penalties where applicable",
    "Driver file documents convictions/administrative penalties when applicable. Applicability depends on whether the driver has any such record.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION"]
  ),
  requirement(
    "ab-nsc-driver-file-reportable-collisions",
    SUBJECT_AREA_SAFETY_ID,
    "Reportable collisions where applicable",
    "Driver file documents reportable collisions when applicable. Applicability depends on whether the driver was involved in any reportable collision.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION", "ACCIDENT_REVIEW"]
  ),
  requirement(
    "ab-nsc-driver-file-training-records",
    SUBJECT_AREA_SAFETY_ID,
    "Training records",
    "Driver file contains training records.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION"]
  ),
  requirement(
    "ab-nsc-driver-file-medical-licensing-evidence",
    SUBJECT_AREA_SAFETY_ID,
    "Medical/licensing evidence",
    "Driver file contains medical and licensing evidence.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION"]
  ),
  requirement(
    "ab-nsc-driver-file-conditional-endorsements",
    SUBJECT_AREA_SAFETY_ID,
    "Conditional endorsements/requirements",
    "Driver file documents any conditional endorsements/requirements applicable to the driver.",
    ALBERTA_NSC_DRIVER_FILE_POPULATION_RULE_ID,
    ["DRIVER_QUALIFICATION"]
  ),
];

// --- VEHICLE FILE / MAINTENANCE (→ Vehicle subject area; sampled via vehicle-file population rule) ---

const vehicleFileRequirements: Requirement[] = [
  requirement(
    VEHICLE_FILE_ANCHOR_REQUIREMENT_ID,
    SUBJECT_AREA_VEHICLE_ID,
    "Vehicle identification information",
    "Vehicle file contains required vehicle identification information.",
    ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    ["VEHICLE_MAINTENANCE"]
  ),
  requirement(
    "ab-nsc-vehicle-file-trip-inspection",
    SUBJECT_AREA_VEHICLE_ID,
    "Trip inspection records",
    "Vehicle file contains trip inspection records.",
    ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    ["VEHICLE_INSPECTION"]
  ),
  requirement(
    "ab-nsc-vehicle-file-repair-records",
    SUBJECT_AREA_VEHICLE_ID,
    "Repair records",
    "Vehicle file contains repair records. Presence of a repair document alone is not automatically equivalent to a satisfied requirement — see this requirement's assessmentMethod note.",
    ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    ["VEHICLE_MAINTENANCE"]
  ),
  requirement(
    "ab-nsc-vehicle-file-lubrication-records",
    SUBJECT_AREA_VEHICLE_ID,
    "Lubrication records",
    "Vehicle file contains lubrication records.",
    ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    ["VEHICLE_MAINTENANCE"]
  ),
  requirement(
    "ab-nsc-vehicle-file-scheduled-maintenance",
    SUBJECT_AREA_VEHICLE_ID,
    "Scheduled maintenance",
    "Vehicle file contains scheduled maintenance records.",
    ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    ["VEHICLE_MAINTENANCE"]
  ),
  requirement(
    "ab-nsc-vehicle-file-manufacturer-recalls",
    SUBJECT_AREA_VEHICLE_ID,
    "Manufacturer recalls where applicable",
    "Vehicle file documents manufacturer recall compliance when applicable. Applicability depends on whether an open recall exists for the vehicle.",
    ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    ["VEHICLE_MAINTENANCE"]
  ),
  requirement(
    "ab-nsc-vehicle-file-cvip-inspection",
    SUBJECT_AREA_VEHICLE_ID,
    "CVIP inspection records",
    "Vehicle file contains Commercial Vehicle Inspection Program (CVIP) inspection records.",
    ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    ["VEHICLE_INSPECTION"]
  ),
  requirement(
    "ab-nsc-vehicle-file-record-accuracy",
    SUBJECT_AREA_VEHICLE_ID,
    "Record accuracy/legibility",
    "Vehicle file records are accurate and legible.",
    ALBERTA_NSC_VEHICLE_FILE_POPULATION_RULE_ID,
    ["VEHICLE_MAINTENANCE"]
  ),
];

// --- HOURS OF SERVICE (→ Hours of Service subject area) ---
// Program-level items are carrier-wide (no population/sample). Daily/
// sample-level items share the HOS sample population rule.

const hoursOfServiceRequirements: Requirement[] = [
  requirement(
    "ab-nsc-hos-internal-monitoring",
    SUBJECT_AREA_HOS_ID,
    "Internal monitoring",
    "Carrier internally monitors Hours of Service compliance.",
    undefined,
    ["HOS_RECORD_REVIEW"]
  ),
  requirement(
    "ab-nsc-hos-remedial-action",
    SUBJECT_AREA_HOS_ID,
    "Remedial action",
    "Carrier takes remedial action in response to identified Hours of Service issues.",
    undefined,
    ["HOS_RECORD_REVIEW"]
  ),
  requirement(
    HOS_SAMPLE_ANCHOR_REQUIREMENT_ID,
    SUBJECT_AREA_HOS_ID,
    "Available on-duty hours",
    "Sampled daily records show available on-duty hours were respected.",
    ALBERTA_NSC_HOS_SAMPLE_POPULATION_RULE_ID,
    ["HOS_RECORD_REVIEW"]
  ),
  requirement(
    "ab-nsc-hos-form-and-manner",
    SUBJECT_AREA_HOS_ID,
    "Form and manner",
    "Sampled daily records meet required form-and-manner standards.",
    ALBERTA_NSC_HOS_SAMPLE_POPULATION_RULE_ID,
    ["HOS_RECORD_REVIEW"]
  ),
  requirement(
    "ab-nsc-hos-rods-truth-accuracy",
    SUBJECT_AREA_HOS_ID,
    "Truth/accuracy of RODS",
    "Sampled Records of Duty Status (RODS) are true and accurate.",
    ALBERTA_NSC_HOS_SAMPLE_POPULATION_RULE_ID,
    ["HOS_RECORD_REVIEW"]
  ),
  requirement(
    "ab-nsc-hos-supporting-document-verification",
    SUBJECT_AREA_HOS_ID,
    "Supporting-document verification",
    "Sampled RODS are verified against supporting evidence (e.g. ELD data, GPS, fuel transactions/receipts, Bill of Lading/trip records). This requirement links to evidence owned by its own natural domain (vehicle, fuel, trip) via EvidenceRelationship — that evidence is never duplicated or reassigned to HOS.",
    ALBERTA_NSC_HOS_SAMPLE_POPULATION_RULE_ID,
    ["HOS_RECORD_REVIEW"]
  ),
];

// ---------------------------------------------------------------------------
// ASSEMBLE: requirements, evidence requirements, wire ids back together
// ---------------------------------------------------------------------------

export const ALBERTA_NSC_REQUIREMENTS: Requirement[] = [
  ...carrierSafetyRequirements,
  ...safetyProgramRequirements,
  ...financialResponsibilityRequirements,
  ...driverFileRequirements,
  ...vehicleFileRequirements,
  ...hoursOfServiceRequirements,
];

const evidenceRequirementsByRequirementId: Record<string, EvidenceRequirement[]> = {
  "ab-nsc-carrier-safety-records-ppob": [
    evidenceReq("ab-nsc-carrier-safety-records-ppob", "Carrier Records / Principal Place of Business Documentation", "Company"),
  ],
  "ab-nsc-carrier-safety-program-location": [
    evidenceReq("ab-nsc-carrier-safety-program-location", "Written Safety Program Document", "Company"),
  ],
  "ab-nsc-carrier-safety-designated-officer": [
    evidenceReq("ab-nsc-carrier-safety-designated-officer", "Safety Officer Designation Record", "Company"),
  ],
  "ab-nsc-carrier-safety-fitness-certificate": [
    evidenceReq("ab-nsc-carrier-safety-fitness-certificate", "Safety Fitness Certificate", "Company"),
  ],
  "ab-nsc-carrier-safety-collision-reporting": [
    evidenceReq("ab-nsc-carrier-safety-collision-reporting", "Collision Reporting Record", "Company"),
  ],
  "ab-nsc-carrier-safety-driver-licensing": [
    evidenceReq("ab-nsc-carrier-safety-driver-licensing", "Driver Licensing Verification Record", "Company"),
  ],
  "ab-nsc-carrier-safety-bol-retention": [
    evidenceReq("ab-nsc-carrier-safety-bol-retention", "Bill of Lading", "Company"),
  ],

  "ab-nsc-safety-program-applies-to-staff": [
    evidenceReq("ab-nsc-safety-program-applies-to-staff", "Safety Program — Staff Applicability Section", "Company"),
  ],
  "ab-nsc-safety-program-required-topics": [
    evidenceReq("ab-nsc-safety-program-required-topics", "Safety Program — Required Topics Section", "Company"),
  ],
  "ab-nsc-safety-program-documentation-topics": [
    evidenceReq("ab-nsc-safety-program-documentation-topics", "Safety Program — Documentation/Record Topics Section", "Company"),
  ],
  "ab-nsc-safety-program-driver-conduct": [
    evidenceReq("ab-nsc-safety-program-driver-conduct", "Safety Program — Driver Responsibilities/Conduct Section", "Company"),
  ],
  "ab-nsc-safety-program-safety-equipment": [
    evidenceReq("ab-nsc-safety-program-safety-equipment", "Safety Program — Safety Equipment Section", "Company"),
  ],
  "ab-nsc-safety-program-record-retention": [
    evidenceReq("ab-nsc-safety-program-record-retention", "Safety Program — Record Retention Section", "Company"),
  ],
  "ab-nsc-safety-program-driver-qualification": [
    evidenceReq("ab-nsc-safety-program-driver-qualification", "Safety Program — Driver Qualification Section", "Company"),
  ],
  "ab-nsc-safety-program-unsafe-vehicle-prohibition": [
    evidenceReq("ab-nsc-safety-program-unsafe-vehicle-prohibition", "Safety Program — Unsafe Vehicle Prohibition Section", "Company"),
  ],
  "ab-nsc-safety-program-driver-instruction": [
    evidenceReq("ab-nsc-safety-program-driver-instruction", "Safety Program — Driver Instruction Section", "Company"),
  ],
  "ab-nsc-safety-program-substantial-compliance": [
    evidenceReq(
      "ab-nsc-safety-program-substantial-compliance",
      "Safety Program Compliance Review Record",
      "Company",
      { necessity: "required" }
    ),
  ],

  "ab-nsc-financial-responsibility-insurance": [
    evidenceReq("ab-nsc-financial-responsibility-insurance", "Certificate of Insurance", "Company"),
  ],

  "ab-nsc-driver-file-application": [
    evidenceReq("ab-nsc-driver-file-application", "Driver Application Record", "Driver"),
  ],
  "ab-nsc-driver-file-employment-history": [
    evidenceReq("ab-nsc-driver-file-employment-history", "Employment History Record", "Driver"),
  ],
  "ab-nsc-driver-file-annual-abstract": [
    evidenceReq("ab-nsc-driver-file-annual-abstract", "Annual Driver Abstract", "Driver", { recencyRequirementDays: 365 }),
  ],
  "ab-nsc-driver-file-hire-date-abstract": [
    evidenceReq("ab-nsc-driver-file-hire-date-abstract", "Hire-Date Driver Abstract", "Driver", {
      necessity: "conditional",
      conditionalOn: "Applicable when the driver was hired during the audit-relevant period.",
    }),
  ],
  "ab-nsc-driver-file-convictions-penalties": [
    evidenceReq("ab-nsc-driver-file-convictions-penalties", "Convictions / Administrative Penalty Record", "Driver", {
      necessity: "conditional",
      conditionalOn: "Applicable only if the driver has a conviction or administrative penalty on record.",
    }),
  ],
  "ab-nsc-driver-file-reportable-collisions": [
    evidenceReq("ab-nsc-driver-file-reportable-collisions", "Reportable Collision Record", "Driver", {
      necessity: "conditional",
      conditionalOn: "Applicable only if the driver was involved in a reportable collision.",
    }),
  ],
  "ab-nsc-driver-file-training-records": [
    evidenceReq("ab-nsc-driver-file-training-records", "Training Record", "Driver"),
  ],
  "ab-nsc-driver-file-medical-licensing-evidence": [
    evidenceReq("ab-nsc-driver-file-medical-licensing-evidence", "Medical Certificate", "Driver", {
      alternatives: ["Driver's Licence"],
    }),
  ],
  "ab-nsc-driver-file-conditional-endorsements": [
    evidenceReq("ab-nsc-driver-file-conditional-endorsements", "Conditional Endorsement / Requirement Record", "Driver", {
      necessity: "conditional",
      conditionalOn: "Applicable only if the driver holds a conditional endorsement or is subject to a specific requirement.",
    }),
  ],

  "ab-nsc-vehicle-file-identification": [
    evidenceReq("ab-nsc-vehicle-file-identification", "Vehicle Identification Record", "Vehicle"),
  ],
  "ab-nsc-vehicle-file-trip-inspection": [
    evidenceReq("ab-nsc-vehicle-file-trip-inspection", "Trip Inspection Report", "Vehicle"),
  ],
  "ab-nsc-vehicle-file-repair-records": [
    evidenceReq("ab-nsc-vehicle-file-repair-records", "Repair Record", "Vehicle"),
  ],
  "ab-nsc-vehicle-file-lubrication-records": [
    evidenceReq("ab-nsc-vehicle-file-lubrication-records", "Lubrication Record", "Vehicle"),
  ],
  "ab-nsc-vehicle-file-scheduled-maintenance": [
    evidenceReq("ab-nsc-vehicle-file-scheduled-maintenance", "Scheduled Maintenance Record", "Vehicle"),
  ],
  "ab-nsc-vehicle-file-manufacturer-recalls": [
    evidenceReq("ab-nsc-vehicle-file-manufacturer-recalls", "Manufacturer Recall Compliance Record", "Vehicle", {
      necessity: "conditional",
      conditionalOn: "Applicable only if an open manufacturer recall exists for the vehicle.",
    }),
  ],
  "ab-nsc-vehicle-file-cvip-inspection": [
    evidenceReq("ab-nsc-vehicle-file-cvip-inspection", "Annual CVIP Inspection Certificate", "Vehicle"),
  ],
  "ab-nsc-vehicle-file-record-accuracy": [
    evidenceReq("ab-nsc-vehicle-file-record-accuracy", "Vehicle File Record Set (accuracy/legibility review)", "Vehicle"),
  ],

  "ab-nsc-hos-internal-monitoring": [
    evidenceReq("ab-nsc-hos-internal-monitoring", "Internal HOS Monitoring Record", "Company"),
  ],
  "ab-nsc-hos-remedial-action": [
    evidenceReq("ab-nsc-hos-remedial-action", "HOS Remedial Action Record", "Company", { necessity: "conditional", conditionalOn: "Applicable when a monitored HOS issue required remedial action." }),
  ],
  [HOS_SAMPLE_ANCHOR_REQUIREMENT_ID]: [
    evidenceReq(HOS_SAMPLE_ANCHOR_REQUIREMENT_ID, "Record of Duty Status (RODS) / ELD Log", "Driver"),
  ],
  "ab-nsc-hos-form-and-manner": [
    evidenceReq("ab-nsc-hos-form-and-manner", "Record of Duty Status (RODS) / ELD Log", "Driver"),
  ],
  "ab-nsc-hos-rods-truth-accuracy": [
    evidenceReq("ab-nsc-hos-rods-truth-accuracy", "Record of Duty Status (RODS) / ELD Log", "Driver"),
  ],
  "ab-nsc-hos-supporting-document-verification": [
    evidenceReq(
      "ab-nsc-hos-supporting-document-verification",
      "Record of Duty Status (RODS) / ELD Log",
      "Driver",
      {
        alternatives: [
          "GPS Data",
          "Fuel Transaction Receipt",
          "Bill of Lading / Trip Record",
          "Other Legitimate Supporting Evidence",
        ],
      }
    ),
  ],
};

// Wire evidenceRequirementIds back onto each Requirement, and requirementIds
// back onto each SubjectArea, without mutating the exported arrays' object
// identities in place from outside this module.
for (const req of ALBERTA_NSC_REQUIREMENTS) {
  const evReqs = evidenceRequirementsByRequirementId[req.id] ?? [];
  req.evidenceRequirementIds = evReqs.map((e) => e.id);

  const subjectArea = ALBERTA_NSC_SUBJECT_AREAS.find((sa) => sa.id === req.subjectAreaId);
  subjectArea?.requirementIds.push(req.id);
}

export const ALBERTA_NSC_EVIDENCE_REQUIREMENTS: EvidenceRequirement[] = Object.values(
  evidenceRequirementsByRequirementId
).flat();

// ---------------------------------------------------------------------------
// REGIME DEFINITION
// ---------------------------------------------------------------------------
// methodologyType: "weighted" — only the subject-area weighting is
// established; no gate/automatic-failure condition is encoded for Alberta
// (none was established from source material), so outcomeRuleIds is empty.
//
// applicabilityRuleIds is left empty: Phase 1 never defined a concrete
// "ApplicabilityRule" (definition-time) interface — only
// ApplicabilityDecision (assessment-time). Conditional items above (the
// "where applicable" Driver File / Vehicle File requirements) are
// represented via each EvidenceRequirement's own conditionalOn text
// instead. Flagged in the Phase 2A report as a Phase 1 gap rather than
// papered over with an invented type here.
//
// samplingRuleIds maps to this file's PopulationRule ids — the closest
// real match to a "sampling rule" in the Phase 1 model.
//
// versionLabel is a TES-internal definition-version label (this file's own
// encoding version), not a claim about when Alberta's regulation itself
// last changed — no such date is known, so effectiveFrom/effectiveTo are
// left unset rather than invented.

export const ALBERTA_NSC_REGIME: AuditRegime = {
  id: ALBERTA_NSC_REGIME_ID,
  name: "Alberta NSC Full Facility Audit",
  jurisdiction: "Alberta, Canada",
  authority: "Government of Alberta (National Safety Code)",
  versionLabel: "tes-phase2a-v1",
  methodologyType: "weighted",
  subjectAreaIds: ALBERTA_NSC_SUBJECT_AREAS.map((sa) => sa.id),
  applicabilityRuleIds: [],
  samplingRuleIds: ALBERTA_NSC_POPULATION_RULES.map((pr) => pr.id),
  // No RegimeCalculationMethod is registered for this regime (see
  // lib/audit-preparedness-engine.ts) — Phase 1's existing fallback already
  // returns percentage: null with an unavailableReason, which is correct
  // here since no defensible requirement-to-score mapping exists beyond
  // the subject-area weights themselves.
  calculationMethodId: undefined,
  outcomeRuleIds: [],
  sourceReferences: [
    ESTABLISHED_METHODOLOGY_SOURCE,
    {
      description:
        "Alberta NSC Full Facility Audit regime overall, and its requirement categories, as described directly by the TES operator (Phase 2 task instructions) reflecting a previously-analyzed real audit example. The regime's own official audit-scoring output (\"Audit Score\") is a distinct, violation-oriented regulatory result that TES does not compute or replicate — see AuditPreparedness in types/audit-preparedness.ts for TES's separate, forward-looking metric.",
    },
  ],
  // Phase 2D addition: union of every capability tagged onto this regime's
  // own Requirements above (see lib/audit-capabilities.ts for traceability).
  capabilityIds: [
    "ACCIDENT_REVIEW",
    "FINANCIAL_RESPONSIBILITY",
    "DRIVER_QUALIFICATION",
    "VEHICLE_MAINTENANCE",
    "VEHICLE_INSPECTION",
    "HOS_RECORD_REVIEW",
  ],
  // PARTIALLY_CONFIGURED, not CONFIGURED: subject-area weighting and
  // requirements are encoded, but no calculationMethodId is registered
  // (percentage stays null) and no GateRule exists for this regime.
  methodologyConfigurationStatus: "PARTIALLY_CONFIGURED",
};
