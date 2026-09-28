import { ALBERTA_NSC_REGIME, ALBERTA_NSC_REQUIREMENTS, ALBERTA_NSC_EVIDENCE_REQUIREMENTS } from "@/lib/audit-regimes/alberta-nsc";
import { FMCSA_NEW_ENTRANT_REGIME, FMCSA_NEW_ENTRANT_REQUIREMENTS, FMCSA_NEW_ENTRANT_EVIDENCE_REQUIREMENTS } from "@/lib/audit-regimes/fmcsa-new-entrant";

export type AuditCaseSource = "Letter" | "Email" | "Internal message" | "Historical report";
export type AuditCaseState = "Notice received" | "Preparing" | "Submitted" | "Report received" | "Closed";
export type AuditTaskState = "NOT_ASSESSED" | "APPLICABILITY_REVIEW" | "REQUESTED" | "RECEIVED" | "VERIFIED" | "NOT_APPLICABLE";
export type AuditDocumentPurpose = "Notice" | "Submission proof" | "Audit report" | "Other";
export type AuditDocument = { id: string; purpose: AuditDocumentPurpose; evidenceId: string; name: string; mimeType: string; addedAt: string; note: string };
export type AuditCaseEvent = { id: string; at: string; action: string; description: string; evidenceId?: string };
export type AuditTask = {
  id: string; requirementId: string; evidenceRequirementId: string; requirement: string;
  evidenceType: string; section: string; necessity: "required" | "conditional";
  condition?: string; state: AuditTaskState; evidenceIds: string[]; note: string;
};
export type AuditRequest = {
  id: string; taskId: string; channel: "Portal" | "Email"; status: "Draft" | "Sent";
  subject: string; message: string; createdAt: string; sentAt?: string; dispatchProof?: string;
};
export type CarrierAuditCase = {
  id: string; companyId: string; title: string; regimeId: string; regimeName: string;
  authority: string; source: AuditCaseSource; status: AuditCaseState;
  noticeDate: string; deadline: string; periodStart: string; periodEnd: string; reference: string;
  receivedAt: string; submittedAt?: string; reportDate?: string; outcome?: string;
  historical: boolean; notes: string; tasks: AuditTask[]; documents: AuditDocument[];
  requests: AuditRequest[]; events: AuditCaseEvent[];
};

export const AUDIT_REGIMES = [
  { id: ALBERTA_NSC_REGIME.id, name: ALBERTA_NSC_REGIME.name, authority: ALBERTA_NSC_REGIME.authority,
    requirements: ALBERTA_NSC_REQUIREMENTS, evidence: ALBERTA_NSC_EVIDENCE_REQUIREMENTS },
  { id: FMCSA_NEW_ENTRANT_REGIME.id, name: FMCSA_NEW_ENTRANT_REGIME.name, authority: FMCSA_NEW_ENTRANT_REGIME.authority,
    requirements: FMCSA_NEW_ENTRANT_REQUIREMENTS, evidence: FMCSA_NEW_ENTRANT_EVIDENCE_REQUIREMENTS },
];

export const newAuditId = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;
export const auditCaseKey = (companyId: string) => `tes_company_audit_cases_${companyId}`;
export function loadAuditCases(companyId: string): CarrierAuditCase[] {
  if (!companyId || typeof localStorage === "undefined") return [];
  try {
    const data = JSON.parse(localStorage.getItem(auditCaseKey(companyId)) || "[]");
    return Array.isArray(data) ? data.filter((item): item is CarrierAuditCase => item && item.companyId === companyId && Array.isArray(item.events)) : [];
  } catch { return []; }
}
export function saveAuditCases(companyId: string, cases: CarrierAuditCase[]) {
  if (!companyId || cases.some((item) => item.companyId !== companyId)) throw new Error("Audit company identity mismatch.");
  localStorage.setItem(auditCaseKey(companyId), JSON.stringify(cases));
}
export function auditCaseEvent(action: string, description: string, evidenceId?: string): AuditCaseEvent {
  return { id: newAuditId("AEVT"), at: new Date().toISOString(), action, description, evidenceId };
}
export function auditTaskSection(entityScope: string, evidenceType: string): string {
  if (entityScope !== "Company") return entityScope;
  if (/insurance|financial responsibility|policy|certificate of insurance/i.test(evidenceType)) return "Insurance";
  return "Company";
}
export function createAuditTasks(regimeId: string): AuditTask[] {
  const regime = AUDIT_REGIMES.find((item) => item.id === regimeId);
  if (!regime) return [];
  const requirements = new Map(regime.requirements.map((item) => [item.id, item]));
  return regime.evidence.map((evidence) => {
    const requirement = requirements.get(evidence.requirementId);
    return {
      id: newAuditId("ATASK"), requirementId: evidence.requirementId, evidenceRequirementId: evidence.id,
      requirement: requirement?.name || evidence.requirementId,
      evidenceType: evidence.evidenceType, section: auditTaskSection(String(evidence.entityScope), evidence.evidenceType),
      necessity: evidence.necessity, condition: evidence.conditionalOn,
      state: evidence.necessity === "conditional" ? "APPLICABILITY_REVIEW" : "NOT_ASSESSED",
      evidenceIds: [], note: "",
    };
  });
}
export function daysToAuditDeadline(deadline: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const target = Date.parse(`${deadline}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;
  const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - utcToday) / 86400000);
}
export function summarizeAuditTasks(tasks: AuditTask[]) {
  return {
    total: tasks.length,
    verified: tasks.filter((task) => task.state === "VERIFIED").length,
    unresolved: tasks.filter((task) => !["VERIFIED", "NOT_APPLICABLE"].includes(task.state)).length,
    applicabilityReview: tasks.filter((task) => task.state === "APPLICABILITY_REVIEW").length,
  };
}

/** Section-facing work queue. Each domain can read its audit obligations without copying evidence. */
export function loadAuditWorkQueue(companyId: string, section: string) {
  return loadAuditCases(companyId)
    .filter((audit) => !audit.historical && !["Closed", "Report received"].includes(audit.status))
    .flatMap((audit) => audit.tasks
      .filter((task) => task.section.toLowerCase() === section.toLowerCase() && !["VERIFIED", "NOT_APPLICABLE"].includes(task.state))
      .map((task) => ({ auditCaseId: audit.id, auditTitle: audit.title, deadline: audit.deadline, task })));
}
