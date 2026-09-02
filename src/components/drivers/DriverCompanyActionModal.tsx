import React, { useState } from "react";
import {
  ShieldAlert,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  X,
  FileText,
  User,
  AlertTriangle,
  Layers,
} from "lucide-react";
import {
  CompanyActionRecord,
  DriverPerformanceEvent,
} from "../../types";

export interface DriverCompanyActionModalProps {
  companyId: string;
  driverMasterId: string;
  events: DriverPerformanceEvent[];
  isOpen: boolean;
  onClose: () => void;
  onSaveAction: (action: Omit<CompanyActionRecord, "id" | "createdAt" | "updatedAt" | "isArchived">) => void;
}

export function DriverCompanyActionModal({
  companyId,
  driverMasterId,
  events,
  isOpen,
  onClose,
  onSaveAction,
}: DriverCompanyActionModalProps) {
  const [actionType, setActionType] = useState<CompanyActionRecord["actionType"]>("Coaching Session");
  const [title, setTitle] = useState("");
  const [decidedBy, setDecidedBy] = useState("");
  const [decidedByRole, setDecidedByRole] = useState("");
  const [factualBasis, setFactualBasis] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [status, setStatus] = useState<CompanyActionRecord["status"]>("Active");
  const [driverAcknowledged, setDriverAcknowledged] = useState(false);
  const [actionItemsInput, setActionItemsInput] = useState("");
  const [linkedEventId, setLinkedEventId] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !decidedBy.trim() || !factualBasis.trim()) {
      setError("Please provide a title, authorized decision maker, and factual basis.");
      return;
    }

    const actionItems = actionItemsInput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    onSaveAction({
      companyId,
      driverMasterId,
      actionType,
      title: title.trim(),
      decidedBy: decidedBy.trim(),
      decidedByRole: decidedByRole.trim() || undefined,
      factualBasis: factualBasis.trim(),
      effectiveDate,
      endDate: endDate || undefined,
      followUpDate: followUpDate || undefined,
      status,
      driverAcknowledged,
      acknowledgementDate: driverAcknowledged ? new Date().toISOString().slice(0, 10) : undefined,
      actionItems,
      linkedEventIds: linkedEventId ? [linkedEventId] : undefined,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 text-xs">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border pb-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldAlert className="size-4" />
              </div>
              <h3 className="text-base font-bold text-foreground">Record Company Action / Development</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Document an official carrier coaching session, warning, reprimand, corrective action plan, or recognition.
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

        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5">
            {/* Action Type */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Action Classification *
              </label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as CompanyActionRecord["actionType"])}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
              >
                <option value="Coaching Session">Coaching Session (1-on-1 Counseling)</option>
                <option value="Verbal Warning">Verbal Warning (Documented)</option>
                <option value="Written Reprimand">Written Reprimand</option>
                <option value="Corrective Action Plan">Corrective Action Plan (Multi-Step)</option>
                <option value="Re-training Mandate">Re-training Mandate</option>
                <option value="Suspension">Safety Suspension</option>
                <option value="Performance Probation">Performance Probation</option>
                <option value="Policy Acknowledgment">Policy Acknowledgment</option>
                <option value="Commendation">Commendation / Recognition</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Record Status *
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as CompanyActionRecord["status"])}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-bold mt-1"
              >
                <option value="Active">Active / In Effect</option>
                <option value="Pending Review">Pending Review</option>
                <option value="Completed">Completed / Satisfied</option>
                <option value="Rescinded">Rescinded / Dismissed</option>
                <option value="Superseded">Superseded</option>
              </select>
            </div>

            {/* Title */}
            <div className="col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Action Title / Summary *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Backing & Mirror Reference Coaching Session"
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-medium mt-1"
              />
            </div>

            {/* Decision Maker */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Authorized Official *
              </label>
              <input
                type="text"
                value={decidedBy}
                onChange={(e) => setDecidedBy(e.target.value)}
                required
                placeholder="e.g. Jane Doe"
                className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Official Title / Committee
              </label>
              <input
                type="text"
                value={decidedByRole}
                onChange={(e) => setDecidedByRole(e.target.value)}
                placeholder="e.g. Safety Committee Lead"
                className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
              />
            </div>

            {/* Effective Dates */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Effective Date *
              </label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                required
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Follow-up / Expiry Date (Optional)
              </label>
              <input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
              />
            </div>

            {/* Link to Performance Event */}
            <div className="col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Link to Underlying Performance Event (Optional)
              </label>
              <select
                value={linkedEventId}
                onChange={(e) => setLinkedEventId(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
              >
                <option value="">No linked event (standalone company action)</option>
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {evt.id} — {evt.eventType} ({evt.eventDate}): {evt.summary.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>

            {/* Factual Basis */}
            <div className="col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Factual Basis & Discussion Notes *
              </label>
              <textarea
                rows={3}
                value={factualBasis}
                onChange={(e) => setFactualBasis(e.target.value)}
                required
                placeholder="Document the exact circumstances, policy references, and discussion points..."
                className="w-full rounded-xl border border-border bg-background p-2.5 mt-1"
              />
            </div>

            {/* Action Items */}
            <div className="col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Required Action Items / Milestones (One per line)
              </label>
              <textarea
                rows={2}
                value={actionItemsInput}
                onChange={(e) => setActionItemsInput(e.target.value)}
                placeholder="e.g. Complete online backing simulation by next Friday&#10;Verify mirror adjustments on Unit 101 with yard trainer"
                className="w-full rounded-xl border border-border bg-background p-2.5 mt-1 font-mono text-xs"
              />
            </div>

            {/* Driver Acknowledgment */}
            <div className="col-span-2 flex items-center gap-2 pt-2 border-t border-border">
              <input
                type="checkbox"
                id="driverAck"
                checked={driverAcknowledged}
                onChange={(e) => setDriverAcknowledged(e.target.checked)}
                className="size-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="driverAck" className="font-semibold text-foreground cursor-pointer">
                Driver acknowledged discussion and received copy of documentation
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
              Save Company Action Record
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
