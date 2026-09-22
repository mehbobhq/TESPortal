/**
 * FMCSA New Entrant Safety Audit — Phase 2B regime definition, built on the
 * Phase 1 architecture (types/audit-preparedness.ts) and following the same
 * structural conventions as lib/audit-regimes/alberta-nsc.ts.
 *
 * SOURCE NOTE (read before editing): the operator supplied an extraction
 * from the FMCSA New Entrant Safety Audit Guidebook / FMCSA Safety Audit
 * Resource Guide directly in the Phase 2B task instructions. This file was
 * never independently opened as a PDF in this repository — the extracted
 * text the operator supplied is the source for everything tagged
 * SOURCE_EXPLICIT below. The guide itself states it is not a replacement
 * for the published FMCSRs/HMRs and that auditors may request additional
 * documents; this file does not treat the eleven categories below as an
 * exhaustive definition of every possible FMCSA audit requirement, and does
 * not derive an official pass/fail methodology from it.
 *
 * PROVENANCE VOCABULARY (see ProvenanceTag in types/audit-preparedness.ts):
 *   SOURCE_EXPLICIT — stated directly in the operator-supplied guide extraction.
 *   TES_MODELED     — this file's own decomposition of a source-explicit
 *                      category, not itself an independently named FMCSA
 *                      requirement heading.
 * (OPERATOR_SUPPLIED, used for Alberta's subject-area weighting, does not
 * apply to anything here: FMCSA has no equivalent operator-asserted
 * methodology fact — only guide-extracted content or TES decomposition.)
 *
 * CLOSED LIST: exactly eleven source-explicit primary categories are
 * represented (see the numbered comments below and the Phase 2B report's
 * cross-check table). Nothing beyond these eleven is tagged SOURCE_EXPLICIT.
 *
 * PHASE 2B.1 HARDENING: the operator supplied a further, more detailed
 * extraction from the same guide, adding specifics (timing/retention
 * figures, financial-responsibility alternatives, vehicle-combination
 * inspection structure, individual drug/alcohol testing contexts,
 * applicability facts) that the original 2B extraction didn't include.
 * Facts new in this pass are marked inline "new in Phase 2B.1" — none
 * replace or contradict a 2B figure; each fact was cross-checked against
 * 2B before being added (see the Phase 2B.1 report's fidelity check).
 */

import type {
  AuditRegime,
  SubjectArea,
  Requirement,
  EvidenceRequirement,
  PopulationRule,
  SourceReference,
  ApplicabilityRule,
  RetentionRequirement,
  RequiredEventDayComparison,
} from "../../types/audit-preparedness";
import { FMCSA_NEW_ENTRANT_REGIME_ID } from "./fmcsa-new-entrant-ids";
import { FMCSA_NE_GATE_RULES } from "./fmcsa-new-entrant-outcome-methodology";
// Phase 3D wiring: the registered TES preparedness+coverage calculation
// method id (lib/audit-preparedness-engine.ts). This import does not
// create a cycle — that file imports only from ./fmcsa-new-entrant-ids,
// never from this file.
import { FMCSA_NEW_ENTRANT_PREPAREDNESS_METHOD_ID } from "../audit-preparedness-engine";

// Re-exported for backward compatibility — this constant used to be defined
// directly in this file; it now lives in ./fmcsa-new-entrant-ids to avoid a
// circular import with ./fmcsa-new-entrant-outcome-methodology (see that
// file's import and lib/audit-regimes/fmcsa-new-entrant-ids.ts).
export { FMCSA_NEW_ENTRANT_REGIME_ID };

// ---------------------------------------------------------------------------
// SOURCE PROVENANCE
// ---------------------------------------------------------------------------

const SOURCE_EXPLICIT: SourceReference = {
  description:
    "FMCSA New Entrant Safety Audit Guidebook / FMCSA Safety Audit Resource Guide. Source material supplied directly by the TES operator in the Phase 2B task instructions as part of TES audit research; this codebase has not independently opened the original guide.",
  provenanceTag: "SOURCE_EXPLICIT",
};

function tesModeled(note: string): SourceReference {
  return {
    description: `TES decomposition of a source-explicit FMCSA New Entrant category. ${note} Not itself an independently named FMCSA primary audit-document heading — see the eleven-category closed list in this file's header.`,
    provenanceTag: "TES_MODELED",
  };
}

// ---------------------------------------------------------------------------
// REGIME
// ---------------------------------------------------------------------------

// Grouping headers are lifted verbatim from the guide extraction's own
// section structure ("DRIVER-RELATED", "VEHICLE-RELATED", "CARRIER /
// PROGRAMMATIC") — source-explicit as groupings. No weighting is given for
// any of them anywhere in the source package, so officialWeight is left
// unset on all three (never an invented even split).
const SUBJECT_AREA_DRIVER_ID = "fmcsa-ne-driver-related";
const SUBJECT_AREA_VEHICLE_ID = "fmcsa-ne-vehicle-related";
const SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID = "fmcsa-ne-carrier-programmatic";

export const FMCSA_NEW_ENTRANT_SUBJECT_AREAS: SubjectArea[] = [
  {
    id: SUBJECT_AREA_DRIVER_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "Driver-Related",
    // officialWeight intentionally absent — no weighting is established in this source package.
    requirementIds: [],
  },
  {
    id: SUBJECT_AREA_VEHICLE_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "Vehicle-Related",
    requirementIds: [],
  },
  {
    id: SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "Carrier / Programmatic",
    requirementIds: [],
  },
];

// ---------------------------------------------------------------------------
// POPULATION RULES
// ---------------------------------------------------------------------------
// The source demonstrates population-driven applicability via the Drivers
// List and Vehicle List (both explicitly described as used to assess
// regulatory applicability), plus an applicable-accident population for the
// Accident Register. No FMCSA sample-selection methodology (a subset drawn
// from these populations) is established anywhere in this source package,
// unlike Alberta's driver/vehicle sampling — so these rules describe the
// full eligible population only; targetSampleSize is left undefined, and no
// ACTUAL_AUDIT_REQUESTED_SAMPLE variant is created since FMCSA's source
// material gives no sampling method to model for one.

export const FMCSA_NE_DRIVER_POPULATION_RULE_ID = "fmcsa-ne-driver-population";
export const FMCSA_NE_VEHICLE_POPULATION_RULE_ID = "fmcsa-ne-vehicle-population";
export const FMCSA_NE_ACCIDENT_POPULATION_RULE_ID = "fmcsa-ne-accident-population";

const DRIVERS_LIST_REQUIREMENT_ID = "fmcsa-ne-drivers-list";
const VEHICLE_LIST_REQUIREMENT_ID = "fmcsa-ne-vehicle-list";
const ACCIDENT_REGISTER_REQUIREMENT_ID = "fmcsa-ne-accident-register";

export const FMCSA_NEW_ENTRANT_POPULATION_RULES: PopulationRule[] = [
  {
    id: FMCSA_NE_DRIVER_POPULATION_RULE_ID,
    requirementId: DRIVERS_LIST_REQUIREMENT_ID,
    description: "Currently employed drivers, per the carrier's Drivers List — used to assess applicability of driver-related regulations.",
    scopeEntityType: "Driver",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
    // targetSampleSize intentionally undefined — no FMCSA sample-selection methodology exists in this source package.
  },
  {
    id: FMCSA_NE_VEHICLE_POPULATION_RULE_ID,
    requirementId: VEHICLE_LIST_REQUIREMENT_ID,
    description: "Eligible CMVs, per the carrier's Vehicle List — used to assess applicability of vehicle-related regulations.",
    scopeEntityType: "Vehicle",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
  },
  {
    id: FMCSA_NE_ACCIDENT_POPULATION_RULE_ID,
    requirementId: ACCIDENT_REGISTER_REQUIREMENT_ID,
    description: "Applicable accident population for the Accident Register — reportable accidents within the regulatory reporting window.",
    scopeEntityType: "Company",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
    // New in Phase 2B.1 — not present in the original 2B extraction, which
    // stated no lookback window. Tagged SOURCE_EXPLICIT based on this
    // hardening pass's explicit statement of a 365-day audit lookback.
    lookbackDays: 365,
  },
];

// ---------------------------------------------------------------------------
// OFFICIAL NEW ENTRANT SAFETY AUDIT SAMPLING RULES (Phase 2E addition)
// ---------------------------------------------------------------------------
// OPERATIONAL SOURCE: FMCSA Safety Audit Manual / New Entrant Safety Audit
// sampling procedure, supplied directly by the TES operator in the Phase 2E
// task instructions. These are NOT universal audit sampling rules — each
// rule below governs only its own named requirement, and none of its
// figures are reused by another rule's code path even where two rules
// happen to share a number (see the Phase 2E report's isolation table).
//
// Each rule attaches a source-backed selection PRIORITY list, never a
// TES-invented one, and instantiates only the PRE_AUDIT_ELIGIBLE_POPULATION
// variant — an ACTUAL_AUDIT_REQUESTED_SAMPLE sibling would be created once
// a real audit's actual auditor-selected sample is known, following the
// same pattern already used elsewhere in this file. TES may identify
// eligible/priority candidates from known carrier data, but this
// architecture must never claim "FMCSA will select this driver" — that
// claim is not encoded anywhere here.

const SAMPLING_SOURCE: SourceReference = {
  description:
    "FMCSA New Entrant Safety Audit sampling methodology (Driver Qualification files, HOS/RODS, Part 382 pre-employment testing, DVIR), supplied directly by the TES operator in the Phase 2E task instructions as an operational (not bare-regulation-text) source. This codebase has not independently retrieved the underlying FMCSA Safety Audit Manual/eFOTM text.",
  citation: "FMCSA Safety Audit Manual / New Entrant Safety Audit sampling procedure",
  provenanceTag: "SOURCE_EXPLICIT",
};

// --- A. PART 391 — DRIVER QUALIFICATION FILES ---
// Own, independently-defined lookback window — NOT shared with rule C's
// window, even though both happen to be 365 days per their own separate
// source statements.
const DQ_POPULATION_LOOKBACK_DAYS = 365;

export const FMCSA_NE_DQ_SAMPLING_RULE_ID = "fmcsa-ne-dq-files-sampling";

// --- B. PART 395 — HOS / RODS ---
// Own, independently-defined review-period description — NOT shared with
// any other rule's period text.
const HOS_RECORD_REVIEW_PERIOD_DESCRIPTION = "1-2 months selected from the previous 6 months";

export const FMCSA_NE_HOS_SAMPLING_RULE_ID = "fmcsa-ne-hos-rods-sampling";

// --- C. PART 382 — PRE-EMPLOYMENT CONTROLLED-SUBSTANCE TESTING ---
// Own, independently-defined hire window — a SEPARATE constant from DQ's
// DQ_POPULATION_LOOKBACK_DAYS above, even though both currently equal 365.
// A future change to one must not silently change the other.
const PART_382_HIRE_WINDOW_DAYS = 365;

export const FMCSA_NE_PART_382_SAMPLING_RULE_ID = "fmcsa-ne-part382-pre-employment-sampling";

// --- D. DVIR / VEHICLE SAMPLING ---
// Own, independently-defined review-period description.
const DVIR_REVIEW_PERIOD_DESCRIPTION = "A 30-day period occurring within the previous three months";

export const FMCSA_NE_DVIR_SAMPLING_RULE_ID = "fmcsa-ne-dvir-sampling";

export const FMCSA_NEW_ENTRANT_SAMPLING_RULES: PopulationRule[] = [
  {
    id: FMCSA_NE_DQ_SAMPLING_RULE_ID,
    requirementId: "fmcsa-ne-drivers-license", // anchor; also shared by MVR and Medical Certificate below
    description:
      "Population: drivers subject to FMCSR in the previous 365 days. Minimum DQ files reviewed depends on population size (see sampleSizeTiers). Selection applies to interstate drivers. The minimum sample may be exceeded where appropriate, but no automatic-expansion rule beyond the stated minimum is encoded here.",
    scopeEntityType: "Driver",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
    lookbackDays: DQ_POPULATION_LOOKBACK_DAYS,
    sampleSizeTiers: [
      { minPopulationSize: 1, maxPopulationSize: 1, requiredEntitySampleSize: 1 },
      { minPopulationSize: 2, maxPopulationSize: 2, requiredEntitySampleSize: 2 },
      { minPopulationSize: 3, requiredEntitySampleSize: 3 },
    ],
    selectionPriority: [
      { rank: 1, description: "Drivers involved in interstate recordable accidents" },
      { rank: 2, description: "Drivers cited with Part 391 violations during roadside inspections" },
      { rank: 3, description: "Recently hired drivers" },
      { rank: 4, description: "Drivers cited for serious traffic/moving violations" },
    ],
    sourceReference: SAMPLING_SOURCE,
  },
  {
    id: FMCSA_NE_HOS_SAMPLING_RULE_ID,
    requirementId: "fmcsa-ne-driver-rod-supporting-docs",
    description:
      "Population: interstate drivers subject to FMCSR/HOS review. Minimum entity AND record sample depends on population size (see sampleSizeTiers — entity and record minimums are paired per tier, never collapsed into one number). Record period: " +
      HOS_RECORD_REVIEW_PERIOD_DESCRIPTION +
      ". Remaining selection beyond the priority list may be random across drivers/months/terminals.",
    scopeEntityType: "Driver",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
    reviewPeriodDescription: HOS_RECORD_REVIEW_PERIOD_DESCRIPTION,
    sampleSizeTiers: [
      { minPopulationSize: 1, maxPopulationSize: 1, requiredEntitySampleSize: 1, requiredRecordSampleSize: 30 },
      { minPopulationSize: 2, maxPopulationSize: 2, requiredEntitySampleSize: 2, requiredRecordSampleSize: 60 },
      { minPopulationSize: 3, requiredEntitySampleSize: 3, requiredRecordSampleSize: 90 },
    ],
    selectionPriority: [
      { rank: 1, description: "Drivers involved in interstate recordable accidents" },
      { rank: 2, description: "Drivers placed OOS for HOS violations" },
      { rank: 3, description: "Drivers with logbook violations" },
      { rank: 4, description: "Drivers with poor driving records identified through CDLIS" },
      { rank: 5, description: "Recently hired drivers" },
      { rank: 6, description: "Drivers with a high likelihood of excessive driving" },
    ],
    sourceReference: SAMPLING_SOURCE,
  },
  {
    id: FMCSA_NE_PART_382_SAMPLING_RULE_ID,
    requirementId: "fmcsa-ne-drug-alcohol-pre-employment-testing",
    description:
      "Population: drivers hired during the previous 365 days who are subject to Part 382. If the carrier has existed less than 365 days, this preserves the source's new-entrant period semantics rather than assuming a full year — that carrier-age determination is not implemented here and must not be assumed. Minimum pre-employment CST results depends on qualifying-hire count (see sampleSizeTiers). If three or fewer qualifying drivers were hired, the source directs review of all applicable pre-employment tests — this rule is scoped only to Part 382 pre-employment testing and must not be generalized to other Part 382 testing categories.",
    scopeEntityType: "Driver",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
    lookbackDays: PART_382_HIRE_WINDOW_DAYS,
    sampleSizeTiers: [
      { minPopulationSize: 1, maxPopulationSize: 1, requiredEntitySampleSize: 1 },
      { minPopulationSize: 2, maxPopulationSize: 2, requiredEntitySampleSize: 2 },
      { minPopulationSize: 3, requiredEntitySampleSize: 3 },
    ],
    selectionPriority: [
      { rank: 1, description: "Drivers involved in applicable accidents" },
      { rank: 2, description: "Drivers cited for driver violations / moving violations" },
    ],
    sourceReference: SAMPLING_SOURCE,
  },
  {
    id: FMCSA_NE_DVIR_SAMPLING_RULE_ID,
    requirementId: "fmcsa-ne-vehicle-inspection",
    description:
      "Vehicle sample with no fixed entity count given in this source package — targetSampleSize/sampleSizeTiers intentionally left undefined rather than inventing one. Review period: " +
      DVIR_REVIEW_PERIOD_DESCRIPTION +
      ". The Safety Audit methodology evaluates the days for which a DVIR was required against the required DVIR records actually prepared/retained — see FMCSA_NE_DVIR_REQUIRED_DAY_COMPARISONS below for that comparison's structure. Do not reduce this to generic document-count sampling.",
    scopeEntityType: "Vehicle",
    mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
    reviewPeriodDescription: DVIR_REVIEW_PERIOD_DESCRIPTION,
    sourceReference: SAMPLING_SOURCE,
  },
];

/**
 * Architecture only — no instance data, since no real carrier's DVIR
 * days-required/records-present counts exist yet. Demonstrates that the
 * RequiredEventDayComparison shape (types/audit-preparedness.ts) is wired
 * to the DVIR sampling rule above, without fabricating a denominator.
 */
export const FMCSA_NE_DVIR_REQUIRED_DAY_COMPARISONS: RequiredEventDayComparison[] = [];

// ---------------------------------------------------------------------------
// EVIDENCE REQUIREMENTS — helper
// ---------------------------------------------------------------------------

let evidenceRequirementCounter = 0;
function evidenceReq(
  requirementId: string,
  evidenceType: string,
  entityScope: EvidenceRequirement["entityScope"],
  provenance: SourceReference,
  options?: Partial<
    Pick<
      EvidenceRequirement,
      "necessity" | "conditionalOn" | "alternatives" | "recencyRequirementDays" | "requiresPerCombinationUnit"
    >
  >
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
    requiresPerCombinationUnit: options?.requiresPerCombinationUnit,
    sourceReference: provenance,
  };
}

function requirement(
  id: string,
  subjectAreaId: string,
  name: string,
  description: string,
  provenance: SourceReference,
  options?: Partial<Pick<Requirement, "populationRuleId" | "assessmentMethod" | "capabilityIds">>
): Requirement {
  return {
    id,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    subjectAreaId,
    name,
    description,
    populationRuleId: options?.populationRuleId,
    capabilityIds: options?.capabilityIds,
    evidenceRequirementIds: [],
    // No FMCSA automatic-failure/gate rule is encoded for any requirement
    // below. The source package explicitly states it does not establish
    // the complete official New Entrant pass/fail methodology, and warns
    // this guide is not a replacement for the published FMCSRs/HMRs —
    // inventing which requirement would gate is exactly what that warning
    // forbids. Conservatively false throughout; see GateRule note below.
    canTriggerGate: false,
    assessmentMethod: options?.assessmentMethod,
    sourceReference: provenance,
  };
}

// ---------------------------------------------------------------------------
// 1. DRIVERS LIST (SOURCE_EXPLICIT) — Driver-Related
// ---------------------------------------------------------------------------

const driversListRequirement = requirement(
  DRIVERS_LIST_REQUIREMENT_ID,
  SUBJECT_AREA_DRIVER_ID,
  "Drivers List",
  "All carriers must provide a list of currently employed drivers, used to assess applicability of various regulations. Source-described fields: first name, last name, date of birth, date of hire, license number, license State. This is population/applicability data, not merely a document to be marked present — the carrier's eligible driver population should be derivable from structured driver-roster data rather than treated as \"Drivers List PDF exists.\"",
  SOURCE_EXPLICIT,
  { populationRuleId: FMCSA_NE_DRIVER_POPULATION_RULE_ID, assessmentMethod: "Structured roster review (population/applicability data), not document-presence checking alone.", capabilityIds: ["DRIVER_QUALIFICATION"] }
);

// ---------------------------------------------------------------------------
// 2. DRIVER'S LICENSE (SOURCE_EXPLICIT) — Driver-Related
// ---------------------------------------------------------------------------

const driversLicenseRequirement = requirement(
  "fmcsa-ne-drivers-license",
  SUBJECT_AREA_DRIVER_ID,
  "Driver's License",
  "CMV drivers must be appropriately licensed for the specific type of vehicle they operate. Appropriate forms include an Operator's License issued by a State/Jurisdiction, a Commercial Driver's License (CDL), a Canadian License, or a Mexican Licencias Federales de Conductor, with appropriate endorsements where required. Applicability depends on vehicle/operation characteristics: Operator's License applicability includes CMVs with GVWR/GCWR from 10,000 through 26,000 lbs and certain 8-15 passenger for-hire operations; CDL applicability includes GVWR/GCWR of 26,001 lbs or more, 16 or more passengers, or placardable quantities of Hazardous Materials. Exceptions exist for specific agricultural, military, emergency, and other operations. Do not flatten into a universal license requirement — applicability must be derived from carrier/driver/vehicle/operation facts (see APPLICABILITY note below); where TES lacks the structured facts to determine which license class/endorsement applies, the assessment must be UNDETERMINED, not assumed satisfied.",
  SOURCE_EXPLICIT,
  {
    // Phase 2E: DQ file sampling anchor (also shared by MVR and Medical
    // Certificate below) — was previously unset.
    populationRuleId: FMCSA_NE_DQ_SAMPLING_RULE_ID,
    assessmentMethod: "Vehicle + operation facts → applicable license requirement → driver license evidence → license class/endorsement validation → requirement assessment. If TES lacks the vehicle/operation facts to derive which license form applies, this requirement's assessment must be UNDETERMINED.",
    capabilityIds: ["DRIVER_QUALIFICATION"],
  }
);

// ---------------------------------------------------------------------------
// 3. DRIVER'S ROD AND SUPPORTING DOCUMENTATION (SOURCE_EXPLICIT) — Driver-Related
// ---------------------------------------------------------------------------

const rodRequirement = requirement(
  "fmcsa-ne-driver-rod-supporting-docs",
  SUBJECT_AREA_DRIVER_ID,
  "Driver's Records of Duty (ROD) and Supporting Documentation",
  "Drivers subject to applicable ROD requirements record duty status for each 24-hour period and maintain the record as duty status changes; the source also discusses ELD records where applicable. Source-explicit supporting-document examples used to verify a driver's ROD include toll receipts/toll records, fuel receipts/fuel records, Bills of Lading, trip reports, and other verification documents — these retain their natural TES ownership (fuel remains fuel/transaction evidence, BOL remains shipment evidence, trip reports remain trip evidence, toll records remain toll/trip evidence) and are linked to this requirement via EvidenceRelationship, never re-owned by Driver. The source also describes an exception: alternative time records/timecards may be used instead of standard ROD requirements for qualifying short-haul operations (criteria include a 150-air-mile radius, return to normal work reporting location, duty-period limitations, and accurate carrier-maintained time records), with specific retention requirements for the applicable time records. ROD/ELD must NOT be modeled as universally required for every driver — this requirement supports one-of: ROD/ELD, OR a qualifying time record, depending on the applicable exception. The presence of a timecard does not itself prove the driver qualifies for the exception; that exception's own conditions require separate validation, which this file does not implement (see report gap).",
  SOURCE_EXPLICIT,
  {
    // Phase 2E: replaced the generic driver population with the precise
    // Part 395/HOS entity+record sampling rule now that it exists.
    populationRuleId: FMCSA_NE_HOS_SAMPLING_RULE_ID,
    assessmentMethod: "Applicability first determines whether standard RODS/ELD or the qualifying short-haul time-record exception applies; a timecard's mere presence does not establish the exception's own conditions were met.",
    capabilityIds: ["HOS_RECORD_REVIEW"],
  }
);

// ---------------------------------------------------------------------------
// 4. DRIVER'S MVR (SOURCE_EXPLICIT) — Driver-Related
// ---------------------------------------------------------------------------

const mvrRequirement = requirement(
  "fmcsa-ne-driver-mvr",
  SUBJECT_AREA_DRIVER_ID,
  "Driver's Motor Vehicle Record (MVR)",
  "Carriers must maintain an MVR for each applicable driver in the Driver Qualification file: request each driver's MVR every 12 months, retain the record for 3 years, and carrier review of the MVR to determine whether the driver meets minimum requirements or is disqualified. Exceptions include certain farm vehicle drivers and private motor carriers of passengers (not compensated). This is not reducible to \"MVR PDF exists\" — presence, the 12-month recency/current-cycle requirement, the carrier's own review determination, applicability, and 3-year retention are each necessary and are not implied by each other.",
  SOURCE_EXPLICIT,
  {
    populationRuleId: FMCSA_NE_DQ_SAMPLING_RULE_ID,
    assessmentMethod: "Evidence presence and 12-month recency are necessary but not sufficient; the carrier's own documented review determining the driver meets minimum requirements (or is disqualified) must also be evidenced. 3-year retention is represented via a RetentionRequirement (see FMCSA_NEW_ENTRANT_RETENTION_REQUIREMENTS below), distinct from the 12-month recency check.",
    capabilityIds: ["DRIVER_QUALIFICATION"],
  }
);

// ---------------------------------------------------------------------------
// 5. MEDICAL CERTIFICATE (SOURCE_EXPLICIT) — Driver-Related
// ---------------------------------------------------------------------------

const medicalCertificateRequirement = requirement(
  "fmcsa-ne-medical-certificate",
  SUBJECT_AREA_DRIVER_ID,
  "Medical Certificate",
  "Applicable drivers are generally examined by a medical examiner at least every two years, though medical certification may be issued for a shorter period; another examination may be required after a qualifying illness/injury that could interfere with driving ability. Exceptions and special cases include certain qualifying farm operations and seasonal beekeeper operations. Cross-border rule: holders of qualifying Canadian or Mexican commercial motor vehicle licenses may have medical certification incorporated into their licensing system, but holders of Canadian Class 5 or Ontario Class G may require additional evidence — a Canadian medical confirmation letter issued by Province/Territory, a U.S. medical examiner certificate from a National Registry medical examiner, or an applicable license endorsement/code indicating periodic medical examination. Medical applicability is jurisdiction/license-aware: a U.S. Medical Certificate must not be required for every Canadian driver by default.",
  SOURCE_EXPLICIT,
  {
    populationRuleId: FMCSA_NE_DQ_SAMPLING_RULE_ID,
    assessmentMethod: "Applicability and the acceptable evidence form both depend on the driver's licensing jurisdiction/class; a single fixed evidence type must not be assumed.",
    capabilityIds: ["DRIVER_QUALIFICATION"],
  }
);

// ---------------------------------------------------------------------------
// 6. VEHICLE LIST (SOURCE_EXPLICIT) — Vehicle-Related
// ---------------------------------------------------------------------------

const vehicleListRequirement = requirement(
  VEHICLE_LIST_REQUIREMENT_ID,
  SUBJECT_AREA_VEHICLE_ID,
  "Vehicle List",
  "All carriers must provide a vehicle list, explicitly used to assess applicability of various regulations. Source-described fields: unit number, VIN, plate number, plate State. Like the Drivers List, this is population/applicability data — the carrier's eligible vehicle population should be derivable from structured TES vehicle records, not modeled merely as \"Vehicle List document uploaded.\"",
  SOURCE_EXPLICIT,
  { populationRuleId: FMCSA_NE_VEHICLE_POPULATION_RULE_ID, assessmentMethod: "Structured vehicle-roster review (population/applicability data), not document-presence checking alone.", capabilityIds: ["VEHICLE_INSPECTION"] }
);

// ---------------------------------------------------------------------------
// 7. VEHICLE INSPECTION (SOURCE_EXPLICIT) — Vehicle-Related
// ---------------------------------------------------------------------------

const vehicleInspectionRequirement = requirement(
  "fmcsa-ne-vehicle-inspection",
  SUBJECT_AREA_VEHICLE_ID,
  "Vehicle Inspection",
  "Applicable vehicle inspection documentation is required, linked to TES's existing Vehicle/Inspection evidence rather than duplicated into the audit domain. Phase 2B.1 hardening (new in this pass — the original 2B extraction stated no interval was established): the source explicitly establishes inspection every 12 months, and that each vehicle in a combination must be independently inspected — tractor, semitrailer, full trailer, and converter dolly, where applicable, are each independently relevant; applicable inspection components must have passed inspection during the preceding 12 months. This is a structural rule about which physical units require their own evidence, not a components/systems checklist — no inspection criteria beyond the 12-month interval and the named combination-unit types are asserted here.",
  SOURCE_EXPLICIT,
  {
    populationRuleId: FMCSA_NE_DVIR_SAMPLING_RULE_ID,
    assessmentMethod: "Document review linked to existing TES Vehicle Inspection records. One tractor's inspection record does not automatically satisfy the full combination — each applicable combination unit (see requiresPerCombinationUnit on this requirement's EvidenceRequirement) needs its own current inspection evidence.",
    capabilityIds: ["VEHICLE_INSPECTION"],
  }
);

// ---------------------------------------------------------------------------
// 8. HAZARDOUS MATERIALS SHIPPING PAPERS (SOURCE_EXPLICIT) — Vehicle-Related
// ---------------------------------------------------------------------------
// Grouped under Vehicle-Related per the source's own three-group structure
// (this category appears under the guide's vehicle-related heading), while
// its evidence ownership is Shipment, not Vehicle — audit relevance does
// not equal ownership, per the source's own explicit rule.

const hmShippingPapersRequirement = requirement(
  "fmcsa-ne-hm-shipping-papers",
  SUBJECT_AREA_VEHICLE_ID,
  "Hazardous Materials (HM) Shipping Papers",
  "HM Shipping Papers are a conditional audit document category — not required for carriers that do not conduct applicable Hazardous Materials operations. TES ownership remains with the Shipment/Load/HM record; this requirement links to that evidence via EvidenceRelationship rather than moving ownership to Driver or Vehicle merely because those entities participate in the shipment. It is grouped under Vehicle-Related per the source's own document grouping, which is separate from and does not change its Shipment evidence ownership. Phase 2B.1 hardening (new in this pass, not present in the original 2B extraction): standard HM shipping papers must be retained 1 year after acceptance; hazardous waste shipping papers must be retained 3 years — see FMCSA_NEW_ENTRANT_RETENTION_REQUIREMENTS below.",
  SOURCE_EXPLICIT,
  { assessmentMethod: "Applicability (does this carrier conduct HM operations at all) must be determined before requiring any evidence.", capabilityIds: ["HAZMAT_DOCUMENTATION"] }
);

// ---------------------------------------------------------------------------
// 9. PROOF OF INSURANCE (SOURCE_EXPLICIT) — Carrier / Programmatic
// ---------------------------------------------------------------------------

const proofOfInsuranceRequirement = requirement(
  "fmcsa-ne-proof-of-insurance",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Proof of Insurance",
  "Proof of Insurance is a required Carrier/Programmatic audit category. TES relates existing Insurance evidence to this requirement rather than creating a duplicate audit-owned insurance document. Phase 2B.1 hardening (new in this pass): the source establishes alternative financial-responsibility mechanisms — one of insurance, a surety bond, or FMCSA self-insurance authorization. Applicability and which alternative applies may depend on operation type; no coverage threshold is established by this source package, so none is encoded here — coverage adequacy remains a separate validation/applicability question until an authoritative coverage rule is supplied.",
  SOURCE_EXPLICIT,
  { assessmentMethod: "Relates to existing Insurance evidence; does not duplicate it. Required financial-assurance form is operation-type-dependent.", capabilityIds: ["FINANCIAL_RESPONSIBILITY"] }
);

// ---------------------------------------------------------------------------
// 10. DRUG & ALCOHOL PROGRAM (SOURCE_EXPLICIT primary; TES_MODELED decomposition) — Carrier / Programmatic
// ---------------------------------------------------------------------------

const drugAlcoholProgramRequirement = requirement(
  "fmcsa-ne-drug-alcohol-program",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Drug & Alcohol Program",
  "Drug & Alcohol Program documentation is a required Carrier/Programmatic audit category, evidenced through testing/program records.",
  SOURCE_EXPLICIT,
  { assessmentMethod: "Program-level document review; applicability of specific testing obligations must be evaluated before requiring evidence for the sub-records below.", capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);

// TES-modeled decomposition — explicitly NOT independently named by FMCSA as one of the eleven primary headings.
const randomTestingProcedureRequirement = requirement(
  "fmcsa-ne-drug-alcohol-random-testing-procedure",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Random Testing Procedure",
  "TES decomposition of the Drug & Alcohol Program category: the carrier's documented random-testing procedure.",
  tesModeled("Decomposes the Drug & Alcohol Program primary category into its random-testing-procedure component."),
  { capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);
const testingPoolRequirement = requirement(
  "fmcsa-ne-drug-alcohol-testing-pool",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Applicable Testing Pool / List",
  "TES decomposition of the Drug & Alcohol Program category: the carrier's applicable testing pool/list.",
  tesModeled("Decomposes the Drug & Alcohol Program primary category into its testing-pool component."),
  { capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);
const consortiumDocumentationRequirement = requirement(
  "fmcsa-ne-drug-alcohol-consortium-documentation",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Consortium Documentation",
  "TES decomposition of the Drug & Alcohol Program category: consortium documentation, where applicable. Owner-operators in particular may satisfy program obligations through consortium participation.",
  tesModeled("Decomposes the Drug & Alcohol Program primary category into its consortium-documentation component. Conditional — applicability depends on whether the carrier participates in a consortium."),
  { capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);
const drugAlcoholTestingRecordsRequirement = requirement(
  "fmcsa-ne-drug-alcohol-testing-records",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Testing Records",
  "TES decomposition of the Drug & Alcohol Program category: individual testing records, where applicable.",
  tesModeled("Decomposes the Drug & Alcohol Program primary category into its testing-records component. Conditional — applicability depends on whether testing has occurred within the applicable period."),
  { capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);

// Phase 2B.1 hardening — new in this pass, not present in the original 2B
// extraction, which only generically referenced "testing/program evidence."
// Preserves the source-described testing contexts individually rather than
// collapsing them into one generic "Testing Records" bucket. Each
// requirement here is TES_MODELED (a decomposition), per the source
// distinguishing categories from specific named evidence obligations.
const preEmploymentTestingRequirement = requirement(
  "fmcsa-ne-drug-alcohol-pre-employment-testing",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Pre-Employment Testing",
  "TES decomposition of the Drug & Alcohol Program category: pre-employment drug/alcohol testing. The source explicitly identifies evidence of pre-employment testing as Safety Audit evidence — see this requirement's EvidenceRequirement provenance.",
  tesModeled("Decomposes the Drug & Alcohol Program primary category into its pre-employment-testing component."),
  { populationRuleId: FMCSA_NE_PART_382_SAMPLING_RULE_ID, capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);
const postAccidentTestingRequirement = requirement(
  "fmcsa-ne-drug-alcohol-post-accident-testing",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Post-Accident Testing",
  "TES decomposition of the Drug & Alcohol Program category: post-accident drug/alcohol testing, where applicable.",
  tesModeled("Decomposes the Drug & Alcohol Program primary category into its post-accident-testing component. The source names this testing context but does not itself state a specific evidence-item name beyond the category label — the evidence below is therefore TES_MODELED, not SOURCE_EXPLICIT."),
  { capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);
const reasonableSuspicionTestingRequirement = requirement(
  "fmcsa-ne-drug-alcohol-reasonable-suspicion-testing",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Reasonable Suspicion Testing",
  "TES decomposition of the Drug & Alcohol Program category: reasonable-suspicion drug/alcohol testing, where applicable.",
  tesModeled("Decomposes the Drug & Alcohol Program primary category into its reasonable-suspicion-testing component. The source names this testing context but does not itself state a specific evidence-item name beyond the category label — the evidence below is therefore TES_MODELED, not SOURCE_EXPLICIT."),
  { capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);
const returnToDutyTestingRequirement = requirement(
  "fmcsa-ne-drug-alcohol-return-to-duty-testing",
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Return-to-Duty Testing",
  "TES decomposition of the Drug & Alcohol Program category: return-to-duty drug/alcohol testing, where applicable.",
  tesModeled("Decomposes the Drug & Alcohol Program primary category into its return-to-duty-testing component. The source names this testing context but does not itself state a specific evidence-item name beyond the category label — the evidence below is therefore TES_MODELED, not SOURCE_EXPLICIT."),
  { capabilityIds: ["DRUG_ALCOHOL_PROGRAM"] }
);

// ---------------------------------------------------------------------------
// 11. ACCIDENT REGISTER (SOURCE_EXPLICIT) — Carrier / Programmatic
// ---------------------------------------------------------------------------

const accidentRegisterRequirement = requirement(
  ACCIDENT_REGISTER_REQUIREMENT_ID,
  SUBJECT_AREA_CARRIER_PROGRAMMATIC_ID,
  "Accident Register",
  "The carrier must maintain an Accident Register. Source-described information includes accident date, location, State, driver, number of injuries, number of fatalities, and applicable Hazardous Materials release information. TES ownership remains Incident/Accident, with relationships to Driver, Vehicle, Company, Shipment/HM where relevant, and Insurance/corrective evidence where relevant — the register is not Driver-owned merely because a driver was involved. In this repository, individual collision/accident occurrences already have a canonical home as Driver Performance \"Collision\" event records (PerformanceEventRecord, types/drivers.ts); this requirement's register-level evidence is scoped at the Company level, cross-referencing those existing records rather than duplicating them or introducing a new incident-owning entity type.",
  SOURCE_EXPLICIT,
  {
    populationRuleId: FMCSA_NE_ACCIDENT_POPULATION_RULE_ID,
    assessmentMethod: "Register-level document review at Company scope, cross-referenced against existing Driver Performance Collision event records rather than independently re-entered.",
    capabilityIds: ["ACCIDENT_REVIEW"],
  }
);

// ---------------------------------------------------------------------------
// ASSEMBLE
// ---------------------------------------------------------------------------

export const FMCSA_NEW_ENTRANT_REQUIREMENTS: Requirement[] = [
  driversListRequirement,
  driversLicenseRequirement,
  rodRequirement,
  mvrRequirement,
  medicalCertificateRequirement,
  vehicleListRequirement,
  vehicleInspectionRequirement,
  hmShippingPapersRequirement,
  proofOfInsuranceRequirement,
  drugAlcoholProgramRequirement,
  randomTestingProcedureRequirement,
  testingPoolRequirement,
  consortiumDocumentationRequirement,
  drugAlcoholTestingRecordsRequirement,
  preEmploymentTestingRequirement,
  postAccidentTestingRequirement,
  reasonableSuspicionTestingRequirement,
  returnToDutyTestingRequirement,
  accidentRegisterRequirement,
];

const evidenceRequirementsByRequirementId: Record<string, EvidenceRequirement[]> = {
  [DRIVERS_LIST_REQUIREMENT_ID]: [
    evidenceReq(DRIVERS_LIST_REQUIREMENT_ID, "Drivers List (structured roster: name, DOB, date of hire, license number, license State)", "Company", SOURCE_EXPLICIT),
  ],
  "fmcsa-ne-drivers-license": [
    evidenceReq("fmcsa-ne-drivers-license", "Operator's License / Commercial Driver's License (CDL) as applicable", "Driver", SOURCE_EXPLICIT, {
      alternatives: ["Canadian License", "Mexican Licencias Federales de Conductor"],
    }),
  ],
  "fmcsa-ne-driver-rod-supporting-docs": [
    evidenceReq("fmcsa-ne-driver-rod-supporting-docs", "Record of Duty Status (ROD) / ELD Record", "Driver", SOURCE_EXPLICIT, {
      alternatives: ["Qualifying Time Record (short-haul / 150-air-mile exception, subject to applicable criteria)"],
    }),
    evidenceReq("fmcsa-ne-driver-rod-supporting-docs", "Toll Receipt / Toll Record", "Vehicle", SOURCE_EXPLICIT, { necessity: "conditional", conditionalOn: "Used as supporting verification of the driver's ROD when available; ownership remains toll/trip evidence." }),
    evidenceReq("fmcsa-ne-driver-rod-supporting-docs", "Fuel Receipt / Fuel Record", "Vehicle", SOURCE_EXPLICIT, { necessity: "conditional", conditionalOn: "Used as supporting verification of the driver's ROD when available; ownership remains fuel/transaction evidence." }),
    evidenceReq("fmcsa-ne-driver-rod-supporting-docs", "Bill of Lading", "Shipment", SOURCE_EXPLICIT, { necessity: "conditional", conditionalOn: "Used as supporting verification of the driver's ROD when available; ownership remains shipment evidence." }),
    evidenceReq("fmcsa-ne-driver-rod-supporting-docs", "Trip Report", "Vehicle", SOURCE_EXPLICIT, { necessity: "conditional", conditionalOn: "Used as supporting verification of the driver's ROD when available; ownership remains trip evidence." }),
  ],
  "fmcsa-ne-driver-mvr": [
    evidenceReq("fmcsa-ne-driver-mvr", "Motor Vehicle Record (MVR)", "Driver", SOURCE_EXPLICIT, { recencyRequirementDays: 365 }),
  ],
  "fmcsa-ne-medical-certificate": [
    evidenceReq("fmcsa-ne-medical-certificate", "Medical Examiner's Certificate", "Driver", SOURCE_EXPLICIT, {
      alternatives: [
        "Canadian Medical Confirmation Letter (Province/Territory)",
        "U.S. Medical Examiner Certificate — National Registry",
        "License Endorsement/Code Indicating Periodic Medical Examination",
      ],
    }),
  ],
  [VEHICLE_LIST_REQUIREMENT_ID]: [
    evidenceReq(VEHICLE_LIST_REQUIREMENT_ID, "Vehicle List (structured roster: unit number, VIN, plate number, plate State)", "Company", SOURCE_EXPLICIT),
  ],
  "fmcsa-ne-vehicle-inspection": [
    evidenceReq("fmcsa-ne-vehicle-inspection", "Vehicle Inspection Record", "Vehicle", SOURCE_EXPLICIT, {
      // 12-month interval: new in Phase 2B.1, not present in the original 2B extraction.
      recencyRequirementDays: 365,
      // Structural "which units" rule, verbatim from source terminology — not an invented components checklist.
      requiresPerCombinationUnit: ["Tractor", "Semitrailer", "Full Trailer", "Converter Dolly"],
    }),
  ],
  "fmcsa-ne-hm-shipping-papers": [
    evidenceReq("fmcsa-ne-hm-shipping-papers", "Hazardous Materials Shipping Paper", "Shipment", SOURCE_EXPLICIT, {
      necessity: "conditional",
      conditionalOn: "Applicable only if the carrier conducts Hazardous Materials operations.",
    }),
  ],
  "fmcsa-ne-proof-of-insurance": [
    evidenceReq("fmcsa-ne-proof-of-insurance", "Certificate of Insurance", "Insurer", SOURCE_EXPLICIT, {
      // Alternatives new in Phase 2B.1 — not present in the original 2B extraction.
      alternatives: ["Surety Bond", "FMCSA Self-Insurance Authorization"],
    }),
  ],
  "fmcsa-ne-drug-alcohol-program": [
    evidenceReq("fmcsa-ne-drug-alcohol-program", "Written Drug & Alcohol Program Document", "Company", SOURCE_EXPLICIT),
  ],
  "fmcsa-ne-drug-alcohol-random-testing-procedure": [
    // Upgraded to SOURCE_EXPLICIT in Phase 2B.1: the source now explicitly
    // identifies "compliant random-testing procedure" as Safety Audit
    // evidence (not present in the original 2B extraction, where only the
    // parent Drug & Alcohol Program category was source-explicit and this
    // decomposition's evidence was TES_MODELED). The requirement itself
    // remains a TES decomposition (tesModeled above); only this specific
    // evidence item's provenance is upgraded.
    evidenceReq("fmcsa-ne-drug-alcohol-random-testing-procedure", "Compliant Random-Testing Procedure", "Company", SOURCE_EXPLICIT),
  ],
  "fmcsa-ne-drug-alcohol-testing-pool": [
    // Upgraded to SOURCE_EXPLICIT in Phase 2B.1: the source now explicitly
    // identifies "list of drivers entered in random testing program" as
    // Safety Audit evidence. Same upgrade rationale as above.
    evidenceReq("fmcsa-ne-drug-alcohol-testing-pool", "List of Drivers Entered in Random Testing Program", "Company", SOURCE_EXPLICIT),
  ],
  "fmcsa-ne-drug-alcohol-consortium-documentation": [
    evidenceReq("fmcsa-ne-drug-alcohol-consortium-documentation", "Consortium Documentation", "Company", tesModeled("Evidence for the consortium-documentation decomposition."), {
      necessity: "conditional",
      conditionalOn: "Applicable only if the carrier participates in a consortium.",
    }),
  ],
  "fmcsa-ne-drug-alcohol-testing-records": [
    evidenceReq("fmcsa-ne-drug-alcohol-testing-records", "Individual Testing Record", "Driver", tesModeled("Evidence for the testing-records decomposition."), {
      necessity: "conditional",
      conditionalOn: "Applicable only where testing has occurred within the applicable period.",
    }),
  ],
  "fmcsa-ne-drug-alcohol-pre-employment-testing": [
    // Evidence item itself is SOURCE_EXPLICIT: the source names "evidence of
    // pre-employment testing" directly, even though the requirement-level
    // decomposition is TES_MODELED.
    evidenceReq("fmcsa-ne-drug-alcohol-pre-employment-testing", "Evidence of Pre-Employment Testing", "Driver", SOURCE_EXPLICIT),
  ],
  "fmcsa-ne-drug-alcohol-post-accident-testing": [
    evidenceReq("fmcsa-ne-drug-alcohol-post-accident-testing", "Post-Accident Testing Record", "Driver", tesModeled("Evidence for the post-accident-testing decomposition."), {
      necessity: "conditional",
      conditionalOn: "Applicable only following a qualifying accident.",
    }),
  ],
  "fmcsa-ne-drug-alcohol-reasonable-suspicion-testing": [
    evidenceReq("fmcsa-ne-drug-alcohol-reasonable-suspicion-testing", "Reasonable Suspicion Testing Record", "Driver", tesModeled("Evidence for the reasonable-suspicion-testing decomposition."), {
      necessity: "conditional",
      conditionalOn: "Applicable only where reasonable suspicion triggered testing.",
    }),
  ],
  "fmcsa-ne-drug-alcohol-return-to-duty-testing": [
    evidenceReq("fmcsa-ne-drug-alcohol-return-to-duty-testing", "Return-to-Duty Testing Record", "Driver", tesModeled("Evidence for the return-to-duty-testing decomposition."), {
      necessity: "conditional",
      conditionalOn: "Applicable only where a return-to-duty test was required.",
    }),
  ],
  [ACCIDENT_REGISTER_REQUIREMENT_ID]: [
    evidenceReq(ACCIDENT_REGISTER_REQUIREMENT_ID, "Accident Register", "Company", SOURCE_EXPLICIT),
  ],
};

for (const req of FMCSA_NEW_ENTRANT_REQUIREMENTS) {
  const evReqs = evidenceRequirementsByRequirementId[req.id] ?? [];
  req.evidenceRequirementIds = evReqs.map((e) => e.id);

  const subjectArea = FMCSA_NEW_ENTRANT_SUBJECT_AREAS.find((sa) => sa.id === req.subjectAreaId);
  subjectArea?.requirementIds.push(req.id);
}

export const FMCSA_NEW_ENTRANT_EVIDENCE_REQUIREMENTS: EvidenceRequirement[] = Object.values(
  evidenceRequirementsByRequirementId
).flat();

// ---------------------------------------------------------------------------
// APPLICABILITY RULES (Phase 2B.1 hardening)
// ---------------------------------------------------------------------------
// Additive: each rule attaches to an existing Requirement above via
// requirementId, without changing that Requirement's own shape. Created
// only where the source provides a clear applicability distinction — not
// exhaustively for every requirement. factsRequired lists what a future
// evaluator would need; no conditional (threshold-comparison) logic is
// implemented yet — see evaluateApplicabilityFactsAvailable in
// lib/audit-preparedness-engine.ts, which only detects missing facts
// (→ UNDETERMINED) and does not itself decide APPLICABLE vs NOT_APPLICABLE.

let applicabilityRuleCounter = 0;
function applicabilityRule(
  requirementId: string,
  description: string,
  factsRequired: ApplicabilityRule["factsRequired"],
  provenance: SourceReference
): ApplicabilityRule {
  applicabilityRuleCounter += 1;
  return {
    id: `${requirementId}-appl${applicabilityRuleCounter}`,
    requirementId,
    description,
    factsRequired,
    sourceReference: provenance,
  };
}

export const FMCSA_NEW_ENTRANT_APPLICABILITY_RULES: ApplicabilityRule[] = [
  applicabilityRule(
    "fmcsa-ne-drivers-license",
    "Operator's License applies to CMVs with GVWR/GCWR from 10,000 through 26,000 lbs, or certain 8-15 passenger for-hire operations.",
    [
      { factKey: "vehicleGvwrGcwrLbs", description: "Vehicle's GVWR/GCWR in pounds." },
      { factKey: "passengerCapacity", description: "Vehicle's rated passenger capacity." },
      { factKey: "operationType", description: "For-hire vs. private operation." },
    ],
    SOURCE_EXPLICIT
  ),
  applicabilityRule(
    "fmcsa-ne-drivers-license",
    "CDL applies to CMVs with GVWR/GCWR of 26,001 lbs or more, 16 or more passengers, or placardable quantities of Hazardous Materials. Exceptions exist for specific agricultural, military, emergency, and other operations.",
    [
      { factKey: "vehicleGvwrGcwrLbs", description: "Vehicle's GVWR/GCWR in pounds." },
      { factKey: "passengerCapacity", description: "Vehicle's rated passenger capacity." },
      { factKey: "hmPlacardableQuantity", description: "Whether the vehicle carries a placardable quantity of Hazardous Materials." },
    ],
    SOURCE_EXPLICIT
  ),
  applicabilityRule(
    "fmcsa-ne-driver-rod-supporting-docs",
    "A qualifying short-haul time-record exception may substitute for standard RODS/ELD: operation within a 150-air-mile radius, return to the normal work reporting location, duty-period limitations, and accurate carrier-maintained time records.",
    [
      { factKey: "operationRadiusAirMiles", description: "Driver's operating radius in air miles." },
      { factKey: "returnsToNormalWorkReportingLocation", description: "Whether the driver returns to the normal work reporting location each duty period." },
      { factKey: "dutyPeriodWithinLimitation", description: "Whether the driver's duty period stays within the applicable limitation." },
    ],
    SOURCE_EXPLICIT
  ),
  applicabilityRule(
    "fmcsa-ne-driver-mvr",
    "MVR requirement exceptions include certain farm vehicle drivers and private motor carriers of passengers (not compensated).",
    [{ factKey: "driverExceptionCategory", description: "Whether the driver qualifies as an exempt farm vehicle driver or uncompensated private-passenger-carrier driver." }],
    SOURCE_EXPLICIT
  ),
  applicabilityRule(
    "fmcsa-ne-medical-certificate",
    "Medical Certificate exceptions include certain qualifying farm operations and seasonal beekeeper operations.",
    [{ factKey: "driverExceptionCategory", description: "Whether the driver qualifies under a farm or seasonal beekeeper operation exception." }],
    SOURCE_EXPLICIT
  ),
  applicabilityRule(
    "fmcsa-ne-medical-certificate",
    "Holders of Canadian Class 5 or Ontario Class G licenses may require additional medical-certification evidence beyond what their licensing system incorporates.",
    [{ factKey: "driverLicenseJurisdictionClass", description: "Driver's licensing jurisdiction and class (e.g. Canadian Class 5, Ontario Class G)." }],
    SOURCE_EXPLICIT
  ),
  applicabilityRule(
    "fmcsa-ne-hm-shipping-papers",
    "HM Shipping Papers are required only for carriers that conduct applicable Hazardous Materials operations.",
    [{ factKey: "hmOperation", description: "Whether the carrier conducts Hazardous Materials operations." }],
    SOURCE_EXPLICIT
  ),
  applicabilityRule(
    "fmcsa-ne-drug-alcohol-consortium-documentation",
    "Consortium documentation applies where the carrier (particularly an owner-operator) participates in a consortium to satisfy Drug & Alcohol Program obligations.",
    [{ factKey: "consortiumParticipation", description: "Whether the carrier participates in a drug/alcohol testing consortium." }],
    SOURCE_EXPLICIT
  ),
  applicabilityRule(
    ACCIDENT_REGISTER_REQUIREMENT_ID,
    "An accident is included in the Accident Register only if it meets the applicable reportability threshold. This source package does not state that threshold's specific criteria (e.g. injury/fatality/tow-away conditions) — represented as a required fact pending that criteria being supplied, not assumed.",
    [{ factKey: "accidentMeetsReportabilityThreshold", description: "Whether the accident meets the regulatory reportability threshold for the Accident Register — specific criteria not established in this source package." }],
    SOURCE_EXPLICIT
  ),
];

// ---------------------------------------------------------------------------
// RETENTION REQUIREMENTS (Phase 2B.1 hardening)
// ---------------------------------------------------------------------------
// Distinct from EvidenceRequirement.recencyRequirementDays. All values here
// are new in Phase 2B.1 — none were present in the original 2B extraction.

let retentionRequirementCounter = 0;
function retentionRequirement(
  requirementId: string,
  retentionPeriodDays: number,
  retentionAnchor: string,
  provenance: SourceReference,
  options?: { evidenceRequirementId?: string; appliesWhen?: string }
): RetentionRequirement {
  retentionRequirementCounter += 1;
  return {
    id: `${requirementId}-retention${retentionRequirementCounter}`,
    requirementId,
    evidenceRequirementId: options?.evidenceRequirementId,
    retentionPeriodDays,
    retentionAnchor,
    appliesWhen: options?.appliesWhen,
    sourceReference: provenance,
  };
}

export const FMCSA_NEW_ENTRANT_RETENTION_REQUIREMENTS: RetentionRequirement[] = [
  retentionRequirement("fmcsa-ne-driver-mvr", 3 * 365, "MVR request/review date", SOURCE_EXPLICIT),
  retentionRequirement("fmcsa-ne-hm-shipping-papers", 365, "Shipment acceptance", SOURCE_EXPLICIT, {
    appliesWhen: "Standard HM shipment",
  }),
  retentionRequirement("fmcsa-ne-hm-shipping-papers", 3 * 365, "Shipment acceptance", SOURCE_EXPLICIT, {
    appliesWhen: "Hazardous waste shipment",
  }),
  retentionRequirement(ACCIDENT_REGISTER_REQUIREMENT_ID, 3 * 365, "Accident record creation", SOURCE_EXPLICIT),
];

// ---------------------------------------------------------------------------
// REGIME DEFINITION
// ---------------------------------------------------------------------------
// methodologyType: "hybrid" — provisional/agnostic. This source package
// does not establish FMCSA New Entrant's complete official pass/fail
// methodology (it explicitly disclaims being a substitute for the FMCSRs/
// HMRs), so this file does not assert the regime is purely "weighted" or
// purely "gate"-based; "hybrid" is the least-committal accurate label given
// that ambiguity, not a confirmed methodology characterization.
//
// outcomeRuleIds (Phase 2E): wired to the 16 already-verified §385.321
// GateRules in fmcsa-new-entrant-outcome-methodology.ts. This only fixes
// the pre-existing integration gap (the regime object never referenced
// those 16 rules by id) — it does not create, alter, or reorder any gate.
// The 16 GateRule definitions themselves remain untouched; see that file's
// own header for the source-precedence rule governing their content.
//
// applicabilityRuleIds is now populated (Phase 2B.1) from
// FMCSA_NEW_ENTRANT_APPLICABILITY_RULES above — created only where the
// source gives a clear applicability distinction, not exhaustively.
// Applicability nuance not yet structured this way still lives in the
// relevant Requirement's description/assessmentMethod text.
//
// calculationMethodId is left unset: no RegimeCalculationMethod is
// registered, so Phase 1's existing fallback in getAuditPreparedness
// already returns percentage: null with an unavailableReason.

export const FMCSA_NEW_ENTRANT_REGIME: AuditRegime = {
  id: FMCSA_NEW_ENTRANT_REGIME_ID,
  name: "FMCSA New Entrant Safety Audit",
  jurisdiction: "United States (Federal)",
  authority: "Federal Motor Carrier Safety Administration (FMCSA)",
  versionLabel: "tes-phase2b-v1",
  methodologyType: "hybrid",
  subjectAreaIds: FMCSA_NEW_ENTRANT_SUBJECT_AREAS.map((sa) => sa.id),
  applicabilityRuleIds: FMCSA_NEW_ENTRANT_APPLICABILITY_RULES.map((ar) => ar.id),
  samplingRuleIds: [
    ...FMCSA_NEW_ENTRANT_POPULATION_RULES.map((pr) => pr.id),
    ...FMCSA_NEW_ENTRANT_SAMPLING_RULES.map((pr) => pr.id),
  ],
  // Phase 3D wiring: registered only after the production assessment
  // pipeline (lib/audit-regimes/fmcsa-new-entrant-production-mapping.ts)
  // was validated end-to-end against real canonical Vehicle/Driver data —
  // see the Phase 3D report. This computes TES Preparedness+Coverage
  // (getPreparednessAndCoverage), never the FMCSA official outcome, which
  // remains outcomeRuleIds/evaluateFmcsaNewEntrant below, untouched.
  calculationMethodId: FMCSA_NEW_ENTRANT_PREPAREDNESS_METHOD_ID,
  outcomeRuleIds: FMCSA_NE_GATE_RULES.map((g) => g.id),
  sourceReferences: [
    SOURCE_EXPLICIT,
    {
      description:
        "FMCSA New Entrant Safety Audit regime overall, per the guide's stated purpose: helping carriers prepare by identifying documents auditors may request to verify compliance with the FMCSRs and HMRs. The guide explicitly states it is not a replacement for the published FMCSRs/HMRs, and that auditors may request additional documents beyond the eleven categories represented here. FMCSA's own official pass/fail determination is a distinct regulatory outcome that TES does not compute or replicate — see AuditPreparedness in types/audit-preparedness.ts for TES's separate, forward-looking metric.",
      provenanceTag: "SOURCE_EXPLICIT",
    },
  ],
  // Phase 2D addition: union of every capability tagged onto this regime's
  // own Requirements above (see lib/audit-capabilities.ts for traceability).
  capabilityIds: [
    "DRIVER_QUALIFICATION",
    "HOS_RECORD_REVIEW",
    "VEHICLE_INSPECTION",
    "HAZMAT_DOCUMENTATION",
    "FINANCIAL_RESPONSIBILITY",
    "DRUG_ALCOHOL_PROGRAM",
    "ACCIDENT_REVIEW",
  ],
  // PARTIALLY_CONFIGURED, not CONFIGURED: requirements/evidence/
  // applicability/gates are encoded (see
  // fmcsa-new-entrant-outcome-methodology.ts for the 16 §385.321 gates),
  // but the factor-methodology question-to-Factor/Acute-Critical dataset
  // remains unavailable (Phase 2C item 13) and no preparedness
  // calculationMethodId is registered.
  methodologyConfigurationStatus: "PARTIALLY_CONFIGURED",
};
