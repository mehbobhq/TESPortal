import React, { useState } from "react";
import {
  Clock,
  ShieldCheck,
  AlertTriangle,
  FileCheck2,
  Calendar,
  Layers,
  X,
  User,
  Info,
  CheckCircle2,
} from "lucide-react";
import {
  DriverPerformanceEvent,
  HOSReview,
  HOSViolationDetails,
} from "../../types";
import { HOS_REVIEW_SOURCES, HOS_INITIAL_FINDINGS, HOS_RULE_JURISDICTIONS, HOS_RULE_PROFILES, HOS_CARRIER_RESOLUTIONS, HOS_VIOLATION_TYPES } from "../../lib/driver-taxonomy";

export interface DriverHOSAuditModalProps {
  event: DriverPerformanceEvent;
  isOpen: boolean;
  onClose: () => void;
  onSaveReview: (review: Omit<HOSReview, "id" | "createdAt" | "updatedAt">) => void;
}

export function DriverHOSAuditModal({
  event,
  isOpen,
  onClose,
  onSaveReview,
}: DriverHOSAuditModalProps) {
  const hos = event.hosDetails;

  const [auditorName, setAuditorName] = useState("");
  const [auditorRole, setAuditorRole] = useState("");
  const [sourceOfFinding, setSourceOfFinding] = useState<HOSReview["sourceOfFinding"] | "">(
    hos?.source === "ELD Live Telematics" ? "ELD Telematics Analysis" : hos?.source === "Roadside Inspection" ? "Roadside Inspection Audit" : hos?.source === "Internal Audit" ? "Internal Periodic Audit" : ""
  );
  const [initialReviewFinding, setInitialReviewFinding] = useState<HOSReview["initialReviewFinding"] | "">(
    hos?.reviewStatus === "Confirmed"
      ? "Confirmed Violation"
      : hos?.reviewStatus === "Disputed"
      ? "False Positive"
      : hos?.reviewStatus === "Under Review"
      ? "Potential Violation"
      : ""
  );
  const [ruleJurisdiction, setRuleJurisdiction] = useState(
    hos?.ruleJurisdiction || ""
  );
  const [ruleProfileId, setRuleProfileId] = useState(
    hos?.ruleProfileId || ""
  );
  const [dutyRuleViolated, setDutyRuleViolated] = useState(
    hos?.violationType || ""
  );
  const [minutesExceeded, setMinutesExceeded] = useState(
    hos?.hoursExceeded ? String(Math.round(Number(hos.hoursExceeded) * 60)) : ""
  );
  const [evidenceSummary, setEvidenceSummary] = useState(
    hos?.reviewNotes || ""
  );
  const [carrierResolution, setCarrierResolution] = useState<HOSReview["carrierResolution"] | "">(
    hos?.reviewStatus === "Confirmed" ? "Coaching Assigned" : ""
  );
  const [correctiveActionReferral, setCorrectiveActionReferral] = useState("");
  const [isFinalized, setIsFinalized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!auditorName.trim()) {
      setError("Auditor name is required for compliance audit trails.");
      return;
    }
    if (!auditorRole.trim()) {
      setError("Auditor role is required.");
      return;
    }
    if (!sourceOfFinding) {
      setError("Please select the source of the HOS finding.");
      return;
    }
    if (!initialReviewFinding) {
      setError("Please select the audit determination finding.");
      return;
    }
    if (!carrierResolution) {
      setError("Please select the carrier resolution.");
      return;
    }
    if (!evidenceSummary.trim()) {
      setError("Please document the factual evidence review summary.");
      return;
    }

    const minExceededNum = minutesExceeded ? parseInt(minutesExceeded, 10) : undefined;
    const derivedStatus: HOSReview["reviewStatus"] =
      initialReviewFinding === "Confirmed Violation"
        ? "Confirmed"
        : initialReviewFinding === "False Positive"
        ? "Disputed"
        : "Under Review";

    onSaveReview({
      companyId: event.companyId,
      driverMasterId: event.driverMasterId,
      performanceEventId: event.id,
      violationType: event.hosDetails?.violationType,
      legacyViolationType: event.hosDetails?.legacyViolationType,
      violationMappingState: "CANONICAL",
      logDate: event.hosDetails?.logDate || event.eventDate || new Date().toISOString().slice(0, 10),
      reviewStatus: derivedStatus,
      reviewDate: new Date().toISOString().slice(0, 10),
      auditorName: auditorName.trim(),
      auditorRole: auditorRole.trim(),
      sourceOfFinding: sourceOfFinding as HOSReview["sourceOfFinding"],
      initialReviewFinding: initialReviewFinding as HOSReview["initialReviewFinding"],
      ruleJurisdiction: ruleJurisdiction || undefined,
      ruleProfileId: ruleProfileId || undefined,
      dutyRuleViolated: dutyRuleViolated || undefined,
      minutesExceeded: isNaN(Number(minExceededNum)) ? undefined : minExceededNum,
      evidenceSummary: evidenceSummary.trim(),
      carrierResolution: carrierResolution as HOSReview["carrierResolution"],
      correctiveActionReferral: correctiveActionReferral.trim() || undefined,
      isFinalized,
      finalizedAt: isFinalized ? new Date().toISOString() : undefined,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 text-xs">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border pb-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                <Clock className="size-4" />
              </div>
              <h3 className="text-base font-bold text-foreground">
                Hours of Service (HOS) Compliance Audit Review
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Event Ref: <span className="font-mono font-bold text-primary">{event.id}</span> • Date: {event.eventDate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Informational Guidance */}
        <div className="flex items-start gap-2.5 rounded-xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 p-3 text-xs text-blue-900 dark:text-blue-300">
          <Info className="size-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Audit Standard Law:</span>
            <span>
              Unconfirmed, potential, or disputed HOS findings are excluded from driver performance score deductions until
              formally confirmed by human audit.
            </span>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5">
            {/* Auditor Details */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Auditor Full Name *
              </label>
              <input
                type="text"
                value={auditorName}
                onChange={(e) => setAuditorName(e.target.value)}
                required
                placeholder="e.g. Jane Doe"
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-medium mt-1"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Auditor Compliance Role *
              </label>
              <input
                type="text"
                value={auditorRole}
                onChange={(e) => setAuditorRole(e.target.value)}
                required
                placeholder="e.g. Safety Compliance Officer"
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-medium mt-1"
              />
            </div>

            {/* Source of Finding */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Source of HOS Finding *
              </label>
              <select
                value={sourceOfFinding}
                onChange={(e) => setSourceOfFinding(e.target.value as HOSReview["sourceOfFinding"])}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
              >
                <option value="">-- Select Source --</option>
                {HOS_REVIEW_SOURCES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>

            {/* Initial Review Finding */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Audit Determination Finding *
              </label>
              <select
                value={initialReviewFinding}
                onChange={(e) => setInitialReviewFinding(e.target.value as HOSReview["initialReviewFinding"])}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-bold mt-1"
              >
                <option value="">-- Select Audit Finding --</option>
                {HOS_INITIAL_FINDINGS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>

            {/* Rule Jurisdiction */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Applicable HOS Jurisdiction
              </label>
              <select
                value={ruleJurisdiction}
                onChange={(e) => setRuleJurisdiction(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
              >
                <option value="">-- Select Jurisdiction (Optional) --</option>
                {HOS_RULE_JURISDICTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>

            {/* Rule Profile */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Applicable HOS Rule Profile
              </label>
              <select
                value={ruleProfileId}
                onChange={(e) => setRuleProfileId(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
              >
                <option value="">-- Select Rule Profile (Optional) --</option>
                {HOS_RULE_PROFILES.filter((profile) => !ruleJurisdiction || profile.value.startsWith(ruleJurisdiction + "_") || profile.value === ruleJurisdiction).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Duty Rule */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Duty Rule or Limitation Evaluated
              </label>
              <select
                value={dutyRuleViolated}
                onChange={(e) => setDutyRuleViolated(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
              >
                <option value="">-- Select Condition (Optional) --</option>
                {HOS_VIOLATION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>

            {/* Minutes Exceeded */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Minutes Exceeded (if confirmed)
              </label>
              <input
                type="number"
                value={minutesExceeded}
                onChange={(e) => setMinutesExceeded(e.target.value)}
                placeholder="e.g. 15"
                min={0}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
              />
            </div>

            {/* Carrier Resolution */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Carrier Action / Resolution *
              </label>
              <select
                value={carrierResolution}
                onChange={(e) => setCarrierResolution(e.target.value as HOSReview["carrierResolution"])}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-bold mt-1"
              >
                <option value="">-- Select Carrier Action --</option>
                {HOS_CARRIER_RESOLUTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>

            {/* Factual Evidence Summary */}
            <div className="col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Factual Evidence & Telematics Audit Analysis *
              </label>
              <textarea
                rows={3}
                value={evidenceSummary}
                onChange={(e) => setEvidenceSummary(e.target.value)}
                required
                placeholder="Detail the step-by-step examination of ELD data records, GPS pings, bill of lading times, and driver explanations..."
                className="w-full rounded-xl border border-border bg-background p-2.5 mt-1"
              />
            </div>

            {/* Corrective Action Referral */}
            <div className="col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Follow-up / Corrective Action Plan Referral (Optional)
              </label>
              <input
                type="text"
                value={correctiveActionReferral}
                onChange={(e) => setCorrectiveActionReferral(e.target.value)}
                placeholder="e.g. Assign HOS & ELD Refresher Module (TRN-004)"
                className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
              />
            </div>

            {/* Finalization Toggle */}
            <div className="col-span-2 flex items-center gap-2 pt-2 border-t border-border">
              <input
                type="checkbox"
                id="finalizeAudit"
                checked={isFinalized}
                onChange={(e) => setIsFinalized(e.target.checked)}
                className="size-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="finalizeAudit" className="font-semibold text-foreground cursor-pointer">
                Mark this HOS audit finding as officially Finalized and Closed
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border px-4 py-2 font-semibold text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
            >
              Commit HOS Audit Determination
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}