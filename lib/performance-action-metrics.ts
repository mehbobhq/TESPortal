import type { CompanyActionRecord, CompanyDetermination } from "../types/drivers.ts";

// Business logic compares CANONICAL stored enums; the label maps below are presentation only.
export const COMPANY_ACTION_TYPE_LABELS: Record<CompanyActionRecord["actionType"], string> = {
  COACHING: "Coaching Session",
  TRAINING_ASSIGNMENT: "Training Assignment",
  VERBAL_WARNING: "Verbal Warning",
  WRITTEN_WARNING: "Written Warning",
  FINAL_WARNING: "Final Warning",
  SUSPENSION: "Suspension",
  POLICY_REVIEW: "Policy Review",
  MONITORING_TELEMATICS: "Monitoring / Telematics Watch",
  DISPATCH_CHANGE: "Dispatch Change",
  EQUIPMENT_INSPECTION_REPAIR: "Equipment Inspection / Repair",
  CORRECTIVE_ACTION_PLAN: "Corrective Action Plan",
  DISCIPLINARY_ACTION: "Disciplinary Action",
  SAFETY_WARNING: "Safety Warning",
  RETRAINING_MANDATE: "Retraining Mandate",
  PERFORMANCE_IMPROVEMENT_PLAN: "Performance Improvement Plan",
  OTHER: "Other",
};

export const COMPANY_DETERMINATION_TYPE_LABELS: Record<NonNullable<CompanyDetermination["determinationType"]>, string> = {
  COLLISION_PREVENTABILITY: "Collision Preventability",
  COMPLAINT_SUBSTANTIATION: "Complaint Substantiation",
  INVESTIGATION_FINDING: "Investigation Finding",
  ROOT_CAUSE_ANALYSIS: "Root Cause Analysis",
  CORRECTIVE_ACTION_OUTCOME: "Corrective Action Outcome",
};

export const COMPANY_DETERMINATION_VALUE_LABELS: Record<NonNullable<CompanyDetermination["determinationValue"]>, string> = {
  PREVENTABLE: "Preventable",
  NON_PREVENTABLE: "Non-Preventable",
  SUBSTANTIATED: "Substantiated",
  NOT_SUBSTANTIATED: "Not Substantiated",
  UNABLE_TO_DETERMINE: "Unable to Determine",
};

const labelOf = (labels: Record<string, string>, value: string | undefined, fallback: string) => (value && Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : value || fallback);
export const companyActionTypeLabel = (value: string | undefined, legacy?: string) => labelOf(COMPANY_ACTION_TYPE_LABELS, value, "") || legacy || "Other";
export const companyDeterminationTypeLabel = (value: string | undefined, legacy?: string) => labelOf(COMPANY_DETERMINATION_TYPE_LABELS, value, "") || legacy || "Determination";
export const companyDeterminationValueLabel = (value: string | undefined, legacy?: string) => labelOf(COMPANY_DETERMINATION_VALUE_LABELS, value, "") || legacy || "Recorded";

type ActionLike = Pick<CompanyActionRecord, "actionType" | "status">;

export const isCoachingAction = (action: Pick<CompanyActionRecord, "actionType">) => action.actionType === "COACHING";

/** A Corrective Action Plan / Performance Improvement Plan that is neither Completed nor Rescinded. */
export const isOpenCorrectivePlan = (action: ActionLike) =>
  (action.actionType === "CORRECTIVE_ACTION_PLAN" || action.actionType === "PERFORMANCE_IMPROVEMENT_PLAN") && action.status !== "Completed" && action.status !== "Rescinded";

/** Extracted unchanged from the Performance tab stats: one determination per related record id (last non-archived wins). */
export function summarizeCollisionDeterminations<E extends { id: string }>(collisions: E[], determinations: Array<Pick<CompanyDetermination, "relatedRecordId" | "determinationValue" | "isArchived">>) {
  const byEvent = new Map(determinations.filter((d) => !d.isArchived).map((d) => [d.relatedRecordId, d]));
  const preventable = collisions.filter((c) => byEvent.get(c.id)?.determinationValue === "PREVENTABLE");
  const nonPreventable = collisions.filter((c) => byEvent.get(c.id)?.determinationValue === "NON_PREVENTABLE");
  const undetermined = collisions.filter((c) => !byEvent.has(c.id) || !["PREVENTABLE", "NON_PREVENTABLE"].includes(String(byEvent.get(c.id)?.determinationValue || "")));
  return { preventable, nonPreventable, undetermined };
}
