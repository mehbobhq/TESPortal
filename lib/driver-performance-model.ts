/**
 * TES Commercial Driver Performance Intelligence Model
 *
 * GOVERNING PRODUCT LAW:
 * "TES calculates transparent, evidence-backed performance metrics and may identify
 * patterns, comparisons, rankings and correlations. TES does not make employment,
 * disciplinary or operational decisions."
 *
 * The score is:
 * - TRANSPARENT: Calculation rules and exclusions are openly visible
 * - TRACEABLE: Every score links to specific underlying source records
 * - EVIDENCE-BACKED: Based only on confirmed/documented facts, never arbitrary penalties
 * - TIME-BOUNDED: Calculated strictly over explicit rolling periods (30D, 90D, 12M, YTD, ALL)
 * - CONTEXTUAL: Evaluates driver attribution vs vehicle defects vs company determinations
 * - REPRODUCIBLE: Same records + same period + same model version = identical score
 */

import {
  DriverPerformanceEvent,
  TrainingRecord,
  DriverMaster,
  CompanyDriverRelationship,
  DriverPerformanceSnapshot,
  PerformanceCategoryScore,
  PerformanceMetricResult,
  PerformancePatternItem,
  FleetRankingResult,
  FleetRankingEntry,
  OperatingRegion,
} from "../types";

export const DRIVER_PERFORMANCE_MODEL_VERSION = "1.0-draft";
export const DRIVER_PERFORMANCE_MODEL_STATUS = "DRAFT / CONFIGURABLE";

export interface PerformanceModelConfig {
  version: string;
  name: string;
  status: string;
  weights: {
    hos: number;
    roadside: number;
    collision: number;
    training: number;
    compliance: number;
    positive: number;
  };
}

export const DEFAULT_MODEL_CONFIG: PerformanceModelConfig = {
  version: DRIVER_PERFORMANCE_MODEL_VERSION,
  name: "TES Driver Performance Model v1.0-draft",
  status: DRIVER_PERFORMANCE_MODEL_STATUS,
  weights: {
    hos: 0.25,
    roadside: 0.25,
    collision: 0.20,
    training: 0.10,
    compliance: 0.10,
    positive: 0.10,
  },
};

export interface DateWindowBounds {
  start: Date;
  end: Date;
  days: number;
  label: "30D" | "90D" | "12M" | "YTD" | "ALL";
}

export function getDateWindowBounds(
  period: "30D" | "90D" | "12M" | "YTD" | "ALL",
  referenceDate: Date = new Date()
): DateWindowBounds {
  const end = new Date(referenceDate);
  const start = new Date(referenceDate);

  if (period === "30D") {
    start.setDate(end.getDate() - 30);
    return { start, end, days: 30, label: "30D" };
  }
  if (period === "90D") {
    start.setDate(end.getDate() - 90);
    return { start, end, days: 90, label: "90D" };
  }
  if (period === "12M") {
    start.setDate(end.getDate() - 365);
    return { start, end, days: 365, label: "12M" };
  }
  if (period === "YTD") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    return { start, end, days: diffDays, label: "YTD" };
  }
  // ALL
  start.setFullYear(2000, 0, 1);
  return { start, end, days: 3650, label: "ALL" };
}

export function getPriorPeriodBounds(current: DateWindowBounds): DateWindowBounds {
  const priorEnd = new Date(current.start);
  const priorStart = new Date(current.start);
  priorStart.setDate(priorStart.getDate() - current.days);
  return {
    start: priorStart,
    end: priorEnd,
    days: current.days,
    label: current.label,
  };
}

function isDateInBounds(dateStr: string, bounds: DateWindowBounds): boolean {
  if (bounds.label === "ALL") return true;
  const d = new Date(dateStr).getTime();
  if (isNaN(d)) return false;
  return d >= bounds.start.getTime() && d <= bounds.end.getTime();
}

/**
 * Filter events within window
 */
export function filterEventsInWindow(
  events: DriverPerformanceEvent[],
  bounds: DateWindowBounds
): DriverPerformanceEvent[] {
  return events.filter((e) => !e.isArchived && isDateInBounds(e.eventDate, bounds));
}

/**
 * 1. HOS COMPLIANCE CATEGORY SCORING
 * Confirmed violations deduct deterministically.
 * Disputed, Under Review, Potential, and Unable-to-Determine are EXCLUDED from penalty.
 */
export function calculateHOSScore(
  events: DriverPerformanceEvent[],
  bounds: DateWindowBounds,
  weight = 0.25
): PerformanceCategoryScore {
  const hosEvents = events.filter((e) => e.eventType === "HOS Violation");

  const confirmed: DriverPerformanceEvent[] = [];
  const excludedWithReasons: { recordId: string; reason: string }[] = [];
  const keyFindings: string[] = [];

  for (const evt of hosEvents) {
    const status = evt.hosDetails?.reviewStatus;
    if (status === "Confirmed") {
      confirmed.push(evt);
    } else if (status === "Disputed") {
      excludedWithReasons.push({
        recordId: evt.id,
        reason: "Disputed HOS condition — excluded from penalty pending carrier review",
      });
    } else if (status === "Potential" || status === "Under Review") {
      excludedWithReasons.push({
        recordId: evt.id,
        reason: `HOS condition in "${status}" state — excluded from penalty until verified`,
      });
    } else if (status === "Unable to Determine") {
      excludedWithReasons.push({
        recordId: evt.id,
        reason: "Unable to Determine — factual evidence insufficient for violation attribution",
      });
    } else if (status === "Not a Violation" || status === "Resolved") {
      excludedWithReasons.push({
        recordId: evt.id,
        reason: `Exonerated/Resolved HOS record (${status}) — no penalty applied`,
      });
    } else {
      // Default / Unspecified review status
      excludedWithReasons.push({
        recordId: evt.id,
        reason: "Unconfirmed HOS status — excluded from penalty",
      });
    }
  }

  // Base score 100, deduct 15 points per confirmed violation
  const penalty = confirmed.length * 15;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  keyFindings.push(`• ${confirmed.length} confirmed HOS violation(s)`);
  if (excludedWithReasons.length > 0) {
    keyFindings.push(`• ${excludedWithReasons.length} unconfirmed/disputed condition(s) excluded from penalty`);
  }
  if (hosEvents.length === 0) {
    keyFindings.push("• 0 HOS violation records in evaluated period");
  }

  const metric: PerformanceMetricResult = {
    metricId: "hos_compliance_rate",
    label: "HOS Duty & Log Compliance",
    periodStart: bounds.start.toISOString().slice(0, 10),
    periodEnd: bounds.end.toISOString().slice(0, 10),
    rawValue: `${confirmed.length} Confirmed`,
    normalizedValue: score,
    includedRecordIds: confirmed.map((c) => c.id),
    excludedRecordIds: excludedWithReasons.map((e) => e.recordId),
    exclusionReasons: excludedWithReasons,
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    summaryText: `${confirmed.length} confirmed violations (${penalty} pt reduction)`,
  };

  return {
    categoryId: "hos",
    label: "HOS Compliance",
    score,
    weight,
    metricResults: [metric],
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    keyFindings,
  };
}

/**
 * 2. ROADSIDE PERFORMANCE CATEGORY SCORING
 * Clean inspections boost/maintain score.
 * Driver violations deduct.
 * Vehicle-only defects are explicitly excluded from Driver penalties.
 */
export function calculateRoadsideScore(
  events: DriverPerformanceEvent[],
  bounds: DateWindowBounds,
  weight = 0.25
): PerformanceCategoryScore {
  const inspectionEvents = events.filter((e) => e.eventType === "Roadside Inspection");

  let cleanCount = 0;
  let driverViolationCount = 0;
  let driverOOSCount = 0;
  let vehicleOnlyCount = 0;

  const includedRecordIds: string[] = [];
  const excludedWithReasons: { recordId: string; reason: string }[] = [];
  const keyFindings: string[] = [];

  for (const evt of inspectionEvents) {
    const insp = evt.inspectionDetails;
    if (!insp) continue;

    includedRecordIds.push(evt.id);

    const isDriverOOS = !!insp.driverOOS;
    const hasDriverViolations = (insp.driverViolationsCount || 0) > 0;
    const hasVehicleViolations = (insp.vehicleViolationsCount || 0) > 0;

    if (isDriverOOS) {
      driverOOSCount++;
    } else if (hasDriverViolations) {
      driverViolationCount++;
    } else if (insp.result === "Passed" && !hasDriverViolations && !hasVehicleViolations) {
      cleanCount++;
    } else if (hasVehicleViolations && !hasDriverViolations) {
      vehicleOnlyCount++;
      excludedWithReasons.push({
        recordId: evt.id,
        reason: "Vehicle-only defect (e.g. equipment/maintenance) — excluded from driver personal performance penalty",
      });
    }
  }

  // Base 100
  // Clean inspections: +0 (maintains 100)
  // Driver Violations: -15 pts each
  // Driver Out of Service: -25 pts each
  // Vehicle-only: 0 pts deducted
  let score = 100;
  if (inspectionEvents.length > 0) {
    const penalty = (driverViolationCount * 15) + (driverOOSCount * 25);
    score = Math.max(0, Math.min(100, 100 - penalty));
  }

  keyFindings.push(`• ${inspectionEvents.length} total roadside inspection(s) recorded`);
  keyFindings.push(`• ${cleanCount} clean inspection(s) without driver violations`);
  if (driverViolationCount > 0) {
    keyFindings.push(`• ${driverViolationCount} inspection(s) with driver violations`);
  }
  if (driverOOSCount > 0) {
    keyFindings.push(`• ${driverOOSCount} Driver Out-of-Service order(s)`);
  }
  if (vehicleOnlyCount > 0) {
    keyFindings.push(`• ${vehicleOnlyCount} inspection(s) with vehicle-only defects (excluded from driver penalty)`);
  }

  const metric: PerformanceMetricResult = {
    metricId: "roadside_inspection_rate",
    label: "Roadside Inspection Record",
    periodStart: bounds.start.toISOString().slice(0, 10),
    periodEnd: bounds.end.toISOString().slice(0, 10),
    rawValue: `${cleanCount} Clean / ${inspectionEvents.length} Total`,
    normalizedValue: score,
    includedRecordIds,
    excludedRecordIds: excludedWithReasons.map((e) => e.recordId),
    exclusionReasons: excludedWithReasons,
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    summaryText: `${cleanCount} clean, ${driverViolationCount} driver violations, ${driverOOSCount} driver OOS`,
  };

  return {
    categoryId: "roadside",
    label: "Roadside Performance",
    score,
    weight,
    metricResults: [metric],
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    keyFindings,
  };
}

/**
 * 3. COLLISION PERFORMANCE CATEGORY SCORING
 * Preventable collisions deduct.
 * Non-Preventable collisions are excluded from penalties.
 * Undetermined collisions are flagged with transparent pending review note.
 */
export function calculateCollisionScore(
  events: DriverPerformanceEvent[],
  bounds: DateWindowBounds,
  weight = 0.20
): PerformanceCategoryScore {
  const collisions = events.filter((e) => e.eventType === "Collision");

  let preventableCount = 0;
  let nonPreventableCount = 0;
  let undeterminedCount = 0;

  const includedRecordIds: string[] = [];
  const excludedWithReasons: { recordId: string; reason: string }[] = [];
  const keyFindings: string[] = [];

  for (const c of collisions) {
    const prev = c.collisionDetails?.preventability;
    if (prev === "Preventable") {
      preventableCount++;
      includedRecordIds.push(c.id);
    } else if (prev === "Non-Preventable") {
      nonPreventableCount++;
      excludedWithReasons.push({
        recordId: c.id,
        reason: "Company-determined Non-Preventable collision — excluded from driver culpability penalty",
      });
    } else {
      undeterminedCount++;
      // Undetermined is held in neutral status pending formal company review
      excludedWithReasons.push({
        recordId: c.id,
        reason: "Undetermined collision — pending formal company preventability determination (excluded from full penalty)",
      });
    }
  }

  // Base 100
  // Preventable collision: -35 pts each
  // Non-preventable: 0 pts deducted
  // Undetermined: -5 pts provisional review buffer
  const penalty = (preventableCount * 35) + (undeterminedCount * 5);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  keyFindings.push(`• ${collisions.length} collision record(s) in period`);
  keyFindings.push(`• ${preventableCount} company-determined preventable`);
  if (nonPreventableCount > 0) {
    keyFindings.push(`• ${nonPreventableCount} company-determined non-preventable (excluded from penalty)`);
  }
  if (undeterminedCount > 0) {
    keyFindings.push(`• ${undeterminedCount} pending company preventability determination`);
  }

  const metric: PerformanceMetricResult = {
    metricId: "collision_rate",
    label: "Collision Record & Preventability",
    periodStart: bounds.start.toISOString().slice(0, 10),
    periodEnd: bounds.end.toISOString().slice(0, 10),
    rawValue: `${preventableCount} Preventable / ${collisions.length} Total`,
    normalizedValue: score,
    includedRecordIds,
    excludedRecordIds: excludedWithReasons.map((e) => e.recordId),
    exclusionReasons: excludedWithReasons,
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    summaryText: `${preventableCount} preventable, ${nonPreventableCount} non-preventable, ${undeterminedCount} undetermined`,
  };

  return {
    categoryId: "collision",
    label: "Collision Performance",
    score,
    weight,
    metricResults: [metric],
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    keyFindings,
  };
}

/**
 * 4. TRAINING CURRENCY CATEGORY SCORING
 * Evaluates completion and currency of assigned courses.
 */
export function calculateTrainingScore(
  trainings: TrainingRecord[],
  bounds: DateWindowBounds,
  weight = 0.10
): PerformanceCategoryScore {
  const activeTrainings = trainings.filter((t) => !t.isArchived);

  let currentCount = 0;
  let overdueCount = 0;
  let inProgressCount = 0;
  let exemptedCount = 0;

  const includedRecordIds: string[] = [];
  const excludedWithReasons: { recordId: string; reason: string }[] = [];
  const keyFindings: string[] = [];

  const now = new Date().toISOString().slice(0, 10);

  for (const t of activeTrainings) {
    if (t.status === "Exempted" || t.status === "Cancelled") {
      exemptedCount++;
      excludedWithReasons.push({
        recordId: t.id,
        reason: `Course ${t.status} with documented waiver/rationale`,
      });
      continue;
    }

    includedRecordIds.push(t.id);

    const isExpired = t.expiryDate && t.expiryDate < now;
    if (t.status === "Completed" && !isExpired) {
      currentCount++;
    } else if (isExpired || t.status === "Assigned") {
      overdueCount++;
    } else {
      inProgressCount++;
    }
  }

  const applicableTotal = currentCount + overdueCount + inProgressCount;
  let score = 100;
  if (applicableTotal > 0) {
    score = Math.round((currentCount / applicableTotal) * 100);
  }

  keyFindings.push(`• ${activeTrainings.length} total applicable training requirement(s)`);
  keyFindings.push(`• ${currentCount} current & certified`);
  if (overdueCount > 0) {
    keyFindings.push(`• ${overdueCount} overdue or pending renewal`);
  }
  if (exemptedCount > 0) {
    keyFindings.push(`• ${exemptedCount} exempted with authorized waiver`);
  }

  const metric: PerformanceMetricResult = {
    metricId: "training_currency_rate",
    label: "Required Training Currency",
    periodStart: bounds.start.toISOString().slice(0, 10),
    periodEnd: bounds.end.toISOString().slice(0, 10),
    rawValue: `${currentCount} / ${applicableTotal || 1} Current`,
    normalizedValue: score,
    includedRecordIds,
    excludedRecordIds: excludedWithReasons.map((e) => e.recordId),
    exclusionReasons: excludedWithReasons,
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    summaryText: `${currentCount} of ${applicableTotal} requirements current (${score}%)`,
  };

  return {
    categoryId: "training",
    label: "Training Currency",
    score,
    weight,
    metricResults: [metric],
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    keyFindings,
  };
}

/**
 * 5. COMPLIANCE RECORD CATEGORY SCORING
 * Evaluates traffic citations, disciplinary actions, and regulatory compliance.
 */
export function calculateComplianceScore(
  events: DriverPerformanceEvent[],
  bounds: DateWindowBounds,
  weight = 0.10
): PerformanceCategoryScore {
  const citations = events.filter((e) => e.eventType === "Traffic Citation");
  const disciplinary = events.filter((e) => e.eventType === "Disciplinary Action");
  const complaints = events.filter((e) => e.eventType === "Customer Complaint");

  let guiltyCitations = 0;
  let pendingCitations = 0;
  let substantiatedComplaints = 0;

  const includedRecordIds: string[] = [];
  const excludedWithReasons: { recordId: string; reason: string }[] = [];
  const keyFindings: string[] = [];

  for (const cit of citations) {
    const disp = cit.citationDetails?.disposition;
    if (disp === "Guilty" || disp === "Paid") {
      guiltyCitations++;
      includedRecordIds.push(cit.id);
    } else {
      pendingCitations++;
      excludedWithReasons.push({
        recordId: cit.id,
        reason: `Citation with disposition "${disp || 'Pending'}" — excluded from penalty until legally finalized`,
      });
    }
  }

  for (const comp of complaints) {
    const sub = comp.complaintDetails?.substantiationStatus;
    if (sub === "Substantiated") {
      substantiatedComplaints++;
      includedRecordIds.push(comp.id);
    } else {
      excludedWithReasons.push({
        recordId: comp.id,
        reason: `Customer complaint "${sub || 'Unreviewed'}" — excluded from penalty (unsubstantiated)`,
      });
    }
  }

  const penalty = (guiltyCitations * 15) + (disciplinary.length * 15) + (substantiatedComplaints * 10);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  keyFindings.push(`• ${guiltyCitations} confirmed traffic citation(s)`);
  if (pendingCitations > 0) {
    keyFindings.push(`• ${pendingCitations} pending citation(s) excluded from penalty`);
  }
  if (substantiatedComplaints > 0) {
    keyFindings.push(`• ${substantiatedComplaints} substantiated customer complaint(s)`);
  }
  if (disciplinary.length > 0) {
    keyFindings.push(`• ${disciplinary.length} company disciplinary action(s) recorded`);
  }

  const metric: PerformanceMetricResult = {
    metricId: "compliance_record_rate",
    label: "Statutory & Operational Compliance",
    periodStart: bounds.start.toISOString().slice(0, 10),
    periodEnd: bounds.end.toISOString().slice(0, 10),
    rawValue: `${guiltyCitations} Citations / ${disciplinary.length} Disciplinary`,
    normalizedValue: score,
    includedRecordIds,
    excludedRecordIds: excludedWithReasons.map((e) => e.recordId),
    exclusionReasons: excludedWithReasons,
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    summaryText: `${guiltyCitations} citations, ${substantiatedComplaints} substantiated complaints`,
  };

  return {
    categoryId: "compliance",
    label: "Compliance Record",
    score,
    weight,
    metricResults: [metric],
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    keyFindings,
  };
}

/**
 * 6. POSITIVE RECOGNITION CATEGORY SCORING
 * Commendations, clean roadside inspections, and documented safety observations.
 */
export function calculatePositiveScore(
  events: DriverPerformanceEvent[],
  bounds: DateWindowBounds,
  weight = 0.10
): PerformanceCategoryScore {
  const commendations = events.filter((e) => e.eventType === "Customer Commendation");
  const observations = events.filter((e) => e.eventType === "Positive Safety Observation");
  const cleanInspections = events.filter(
    (e) => e.eventType === "Roadside Inspection" && e.inspectionDetails?.result === "Passed" && (e.inspectionDetails?.driverViolationsCount || 0) === 0
  );

  const totalPositive = commendations.length + observations.length + cleanInspections.length;
  const includedRecordIds = [...commendations, ...observations, ...cleanInspections].map((e) => e.id);

  // Baseline standard is 85, boosts up to 100 with documented positive evidence
  const score = Math.min(100, 85 + (commendations.length * 5) + (observations.length * 5) + (cleanInspections.length * 3));

  const keyFindings: string[] = [
    `• ${commendations.length} customer commendation(s)`,
    `• ${observations.length} positive safety observation(s)`,
    `• ${cleanInspections.length} clean roadside inspection(s)`,
  ];

  const metric: PerformanceMetricResult = {
    metricId: "positive_recognition_rate",
    label: "Positive Performance & Commendations",
    periodStart: bounds.start.toISOString().slice(0, 10),
    periodEnd: bounds.end.toISOString().slice(0, 10),
    rawValue: `${totalPositive} Positive Event(s)`,
    normalizedValue: score,
    includedRecordIds,
    excludedRecordIds: [],
    exclusionReasons: [],
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    summaryText: `${commendations.length} commendations, ${cleanInspections.length} clean inspections`,
  };

  return {
    categoryId: "positive",
    label: "Positive Recognition",
    score,
    weight,
    metricResults: [metric],
    calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
    keyFindings,
  };
}

/**
 * DATA COVERAGE / CONFIDENCE ENGINE
 */
export function calculateDataCoverage(
  events: DriverPerformanceEvent[],
  trainings: TrainingRecord[],
  bounds: DateWindowBounds
) {
  const totalEvents = events.length;
  const totalTrainings = trainings.length;
  const inspections = events.filter((e) => e.eventType === "Roadside Inspection");
  const hosRecords = events.filter((e) => e.eventType === "HOS Violation");
  const determinations = events.filter(
    (e) => e.collisionDetails?.preventability && e.collisionDetails.preventability !== "Undetermined"
  );

  let coveragePoints = 0;

  // 1. Time period represented (up to 30)
  if (totalEvents > 0 || totalTrainings > 0) coveragePoints += 30;

  // 2. Roadside history presence (up to 20)
  if (inspections.length > 0) coveragePoints += 20;

  // 3. Training applicability (up to 20)
  if (totalTrainings >= 3) coveragePoints += 20;
  else if (totalTrainings > 0) coveragePoints += 10;

  // 4. HOS data / events presence (up to 15)
  if (hosRecords.length > 0) coveragePoints += 15;

  // 5. Documented company determinations (up to 15)
  if (determinations.length > 0) coveragePoints += 15;

  // If no data exists at all
  if (totalEvents === 0 && totalTrainings === 0) {
    return {
      coveragePercentage: 0,
      confidenceTier: "Not yet calculated" as const,
      periodRepresentedDays: bounds.days,
      hosDataAvailable: false,
      roadsideHistoryCount: 0,
      trainingApplicabilityCount: 0,
      eventCount: 0,
      documentedDeterminationsCount: 0,
      sourceConnectivity: "Disconnected" as const,
    };
  }

  const coveragePercentage = Math.min(100, coveragePoints);
  let confidenceTier: "High" | "Moderate" | "Limited Data" = "Limited Data";
  if (coveragePercentage >= 75) {
    confidenceTier = "High";
  } else if (coveragePercentage >= 45) {
    confidenceTier = "Moderate";
  }

  return {
    coveragePercentage,
    confidenceTier,
    periodRepresentedDays: bounds.days,
    hosDataAvailable: hosRecords.length > 0,
    roadsideHistoryCount: inspections.length,
    trainingApplicabilityCount: totalTrainings,
    eventCount: totalEvents,
    documentedDeterminationsCount: determinations.length,
    sourceConnectivity: "Partial Manual" as const,
  };
}

/**
 * PATTERN & CORRELATION DETECTOR
 * Surfaces purely factual patterns without assigning blame.
 */
export function detectPerformancePatterns(
  events: DriverPerformanceEvent[],
  bounds: DateWindowBounds
): PerformancePatternItem[] {
  const patterns: PerformancePatternItem[] = [];
  const inWindow = filterEventsInWindow(events, bounds);

  // 1. Location / Facility patterns
  const locationCounts: Record<string, { count: number; ids: string[] }> = {};
  for (const e of inWindow) {
    const loc = e.city || e.location;
    if (loc && loc.trim()) {
      const key = loc.trim();
      if (!locationCounts[key]) locationCounts[key] = { count: 0, ids: [] };
      locationCounts[key].count++;
      locationCounts[key].ids.push(e.id);
    }
  }

  for (const [loc, data] of Object.entries(locationCounts)) {
    if (data.count >= 2 && inWindow.length >= 2) {
      patterns.push({
        id: `PAT-LOC-${loc.replace(/\s+/g, "_")}`,
        category: "Operational",
        title: `Event Concentration: ${loc}`,
        factualObservation: `${data.count} of ${inWindow.length} recorded events occurred at or near ${loc}.`,
        supportingRecordCount: data.count,
        totalRelevantRecordCount: inWindow.length,
        recordIds: data.ids,
      });
    }
  }

  // 2. Weather conditions correlation
  const adverseWeatherEvents = inWindow.filter(
    (e) => e.collisionDetails?.weather && ["Snow", "Ice / Freezing Rain", "Rain", "Fog"].includes(e.collisionDetails.weather)
  );
  if (adverseWeatherEvents.length >= 2) {
    patterns.push({
      id: "PAT-WEATHER-ADVERSE",
      category: "Collision",
      title: "Adverse Weather Condition Correlation",
      factualObservation: `${adverseWeatherEvents.length} collision/incident records occurred during adverse environmental weather (snow/rain/ice).`,
      supportingRecordCount: adverseWeatherEvents.length,
      totalRelevantRecordCount: inWindow.length,
      recordIds: adverseWeatherEvents.map((e) => e.id),
    });
  }

  // 3. Clean inspection streak
  const cleanInspections = inWindow.filter(
    (e) => e.eventType === "Roadside Inspection" && e.inspectionDetails?.result === "Passed" && (e.inspectionDetails?.driverViolationsCount || 0) === 0
  );
  if (cleanInspections.length >= 2) {
    patterns.push({
      id: "PAT-CLEAN-INSPECTIONS",
      category: "Positive",
      title: "Consistent Roadside Compliance",
      factualObservation: `${cleanInspections.length} commercial roadside inspections passed with zero driver violations.`,
      supportingRecordCount: cleanInspections.length,
      totalRelevantRecordCount: inWindow.filter((e) => e.eventType === "Roadside Inspection").length,
      recordIds: cleanInspections.map((e) => e.id),
    });
  }

  return patterns;
}

/**
 * MASTER SNAPSHOT CALCULATION
 * Produces deterministic, explainable DriverPerformanceSnapshot.
 */
export function calculateDriverPerformanceSnapshot(
  driverMasterId: string,
  companyDriverRecordId: string,
  events: DriverPerformanceEvent[],
  trainings: TrainingRecord[],
  period: "30D" | "90D" | "12M" | "YTD" | "ALL" = "12M",
  referenceDate: Date = new Date(),
  config: PerformanceModelConfig = DEFAULT_MODEL_CONFIG
): DriverPerformanceSnapshot {
  const bounds = getDateWindowBounds(period, referenceDate);
  const eventsInWindow = filterEventsInWindow(events, bounds);

  // Calculate 6 standard categories
  const hos = calculateHOSScore(eventsInWindow, bounds, config.weights.hos);
  const roadside = calculateRoadsideScore(eventsInWindow, bounds, config.weights.roadside);
  const collision = calculateCollisionScore(eventsInWindow, bounds, config.weights.collision);
  const training = calculateTrainingScore(trainings, bounds, config.weights.training);
  const compliance = calculateComplianceScore(eventsInWindow, bounds, config.weights.compliance);
  const positive = calculatePositiveScore(eventsInWindow, bounds, config.weights.positive);

  const categoryScores = [hos, roadside, collision, training, compliance, positive];

  // Weighted overall calculation
  let weightedSum = 0;
  let totalWeight = 0;
  for (const cat of categoryScores) {
    weightedSum += cat.score * cat.weight;
    totalWeight += cat.weight;
  }
  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 100;

  // Data Coverage calculation
  const dataCoverage = calculateDataCoverage(eventsInWindow, trainings, bounds);

  // Trend calculation: compare with equivalent prior period
  const priorBounds = getPriorPeriodBounds(bounds);
  const priorEvents = filterEventsInWindow(events, priorBounds);
  const priorHos = calculateHOSScore(priorEvents, priorBounds, config.weights.hos);
  const priorRoadside = calculateRoadsideScore(priorEvents, priorBounds, config.weights.roadside);
  const priorCollision = calculateCollisionScore(priorEvents, priorBounds, config.weights.collision);
  const priorTraining = calculateTrainingScore(trainings, priorBounds, config.weights.training);
  const priorCompliance = calculateComplianceScore(priorEvents, priorBounds, config.weights.compliance);
  const priorPositive = calculatePositiveScore(priorEvents, priorBounds, config.weights.positive);

  let priorWeightedSum = 0;
  for (const cat of [priorHos, priorRoadside, priorCollision, priorTraining, priorCompliance, priorPositive]) {
    priorWeightedSum += cat.score * cat.weight;
  }
  const priorOverallScore = Math.round(priorWeightedSum / totalWeight);
  const pointDelta = overallScore - priorOverallScore;

  let trendDirection: "Improving" | "Stable" | "Declining" | "Insufficient Data" = "Stable";
  let explanation = `0 pt change compared with previous equivalent period (${priorBounds.start.toISOString().slice(0, 10)} to ${priorBounds.end.toISOString().slice(0, 10)})`;

  if (priorEvents.length === 0 && eventsInWindow.length === 0) {
    trendDirection = "Stable";
    explanation = "No historical variance in evaluated window";
  } else if (pointDelta >= 3) {
    trendDirection = "Improving";
    explanation = `+${pointDelta} points compared with previous equivalent period`;
  } else if (pointDelta <= -3) {
    trendDirection = "Declining";
    explanation = `${pointDelta} points compared with previous equivalent period`;
  }

  // Detect patterns
  const patterns = detectPerformancePatterns(events, bounds);

  return {
    driverMasterId,
    companyDriverRecordId,
    periodLabel: period,
    periodStart: bounds.start.toISOString().slice(0, 10),
    periodEnd: bounds.end.toISOString().slice(0, 10),
    overallScore,
    categoryScores,
    dataCoverage,
    trend: {
      direction: trendDirection,
      pointDelta,
      comparisonPeriodLabel: `Previous ${bounds.days} Days`,
      explanation,
    },
    patterns,
    calculationVersion: config.version,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * FLEET RANKING ENGINE
 * Calculates ranks among comparable drivers within the same company and operating region.
 */
export function calculateFleetRankings(
  drivers: Array<{
    master: DriverMaster;
    relationship: CompanyDriverRelationship;
    events: DriverPerformanceEvent[];
    trainings: TrainingRecord[];
  }>,
  targetDriverMasterId: string,
  period: "30D" | "90D" | "12M" | "YTD" | "ALL" = "12M"
): {
  rankResult: FleetRankingResult;
  currentDriverRank?: { rank: number; total: number; cohortDescription: string };
} {
  const bounds = getDateWindowBounds(period);
  const targetDriver = drivers.find((d) => d.master.id === targetDriverMasterId);
  const targetRegion: OperatingRegion = targetDriver?.relationship.operatingRegion || "Cross-Border";

  // Filter comparable cohort: active drivers in same region or company
  const cohort = drivers.filter(
    (d) => d.relationship.driverStatus === "Active" && (!targetRegion || d.relationship.operatingRegion === targetRegion)
  );

  const entries: FleetRankingEntry[] = cohort.map((d) => {
    const relationshipId = d.relationship.companyDriverRecordId || d.relationship.id || d.master.id;
    const snapshot = calculateDriverPerformanceSnapshot(
      d.master.id,
      relationshipId,
      d.events,
      d.trainings,
      period
    );
    const inWindowEvents = filterEventsInWindow(d.events, bounds);
    const cleanInspections = inWindowEvents.filter(
      (e) => e.eventType === "Roadside Inspection" && e.inspectionDetails?.result === "Passed" && (e.inspectionDetails?.driverViolationsCount || 0) === 0
    ).length;

    const name = [d.master.identity.legalFirstName, d.master.identity.legalLastName].filter(Boolean).join(" ") || d.master.id;

    return {
      driverMasterId: d.master.id,
      companyDriverRecordId: relationshipId,
      driverName: name,
      operatingRegion: d.relationship.operatingRegion,
      recordType: d.relationship.recordType,
      overallScore: snapshot.overallScore,
      coveragePercentage: snapshot.dataCoverage.coveragePercentage,
      confidenceTier: snapshot.dataCoverage.confidenceTier,
      trendDirection: snapshot.trend?.direction || "Stable",
      totalEventsInWindow: inWindowEvents.length,
      cleanInspectionsInWindow: cleanInspections,
    };
  });

  // Sort descending by overallScore, then coverage
  entries.sort((a, b) => {
    if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
    return b.coveragePercentage - a.coveragePercentage;
  });

  const cohortDescription = `Active ${targetRegion} Drivers (${entries.length} Drivers, ${period} Window)`;
  const rankIndex = entries.findIndex((e) => e.driverMasterId === targetDriverMasterId);

  return {
    rankResult: {
      cohortDescription,
      periodLabel: period,
      comparisonWindow: `${bounds.start.toISOString().slice(0, 10)} to ${bounds.end.toISOString().slice(0, 10)}`,
      calculationVersion: DRIVER_PERFORMANCE_MODEL_VERSION,
      entries,
    },
    currentDriverRank:
      rankIndex >= 0
        ? {
            rank: rankIndex + 1,
            total: entries.length,
            cohortDescription,
          }
        : undefined,
  };
}
