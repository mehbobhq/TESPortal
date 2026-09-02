import React, { useState } from "react";
import {
  ShieldCheck,
  Stethoscope,
  FileCheck2,
  AlertTriangle,
  Plus,
  Calendar,
  CheckCircle2,
  Clock,
  Archive,
  Search,
  Eye,
} from "lucide-react";
import { DriverMaster, ScreeningRecord, ScreeningCategory } from "../../types";
import { ReadOnlyField } from "../shared/ReadOnlyField";
import { getDeadlineStatus, getDeadlineClasses, getDaysRemaining } from "../../lib/deadline-engine";

export interface DriverScreeningTabProps {
  master: DriverMaster;
  screenings: ScreeningRecord[];
  onAddScreening: (data: Omit<ScreeningRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => void;
  onArchiveScreening: (id: string) => void;
  onOpenEvidence?: (docId: string) => void;
}

const SCREENING_CATEGORIES: ScreeningCategory[] = [
  "Medical Card / DOT Physical",
  "Driver Abstract / MVR Review",
  "FMCSA Clearinghouse Query",
  "Pre-Employment Screening Program (PSP)",
  "Pre-Employment Drug Test",
  "Pre-Employment Alcohol Test",
  "Random Drug / Alcohol Test",
  "Post-Accident Drug / Alcohol Test",
  "Road Test Evaluation",
  "Criminal Background Check",
  "Reasonable Suspicion Test",
  "Return-to-Duty Test",
  "Follow-up Testing",
];

export function DriverScreeningTab({
  master,
  screenings,
  onAddScreening,
  onArchiveScreening,
  onOpenEvidence,
}: DriverScreeningTabProps) {
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [form, setForm] = useState<{
    category: ScreeningCategory;
    recordDate: string;
    expiryDate: string;
    status: ScreeningRecord["status"];
    resultSummary: string;
    providerOrAuthority: string;
    cmeNumber: string;
    examinerName: string;
    notes: string;
  }>({
    category: "Medical Card / DOT Physical",
    recordDate: new Date().toISOString().slice(0, 10),
    expiryDate: "",
    status: "Qualified",
    resultSummary: "",
    providerOrAuthority: "",
    cmeNumber: "",
    examinerName: "",
    notes: "",
  });

  const [formError, setFormError] = useState<string | null>(null);

  const activeScreenings = screenings.filter((s) => !s.isArchived);

  const filteredScreenings = activeScreenings.filter((s) => {
    if (selectedCategoryFilter === "all") return true;
    return s.category === selectedCategoryFilter;
  });

  // Calculate Medical Status
  const activeMedical = activeScreenings.find((s) => s.category === "Medical Card / DOT Physical");
  const medicalDeadlineStatus = activeMedical?.expiryDate ? getDeadlineStatus(activeMedical.expiryDate) : "No Deadline";
  const medicalDeadlineStyle = getDeadlineClasses(medicalDeadlineStatus);

  const handleSaveScreening = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.resultSummary.trim() || !form.providerOrAuthority.trim()) {
      setFormError("Result summary and provider / authority are required.");
      return;
    }

    onAddScreening({
      category: form.category,
      recordDate: form.recordDate,
      expiryDate: form.expiryDate || undefined,
      status: form.status,
      resultSummary: form.resultSummary.trim(),
      providerOrAuthority: form.providerOrAuthority.trim(),
      medicalCardDetails:
        form.category === "Medical Card / DOT Physical"
          ? {
              nationalRegistryNumber: form.cmeNumber || undefined,
              examinerName: form.examinerName || undefined,
            }
          : undefined,
      evidenceIds: [],
      notes: form.notes || undefined,
    });

    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* 1. Top Section: Active Medical Card & Physical Summary Banner */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Stethoscope className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Medical Certificate & Physical Fitness Standing</h3>
              <p className="text-xs text-muted-foreground">DOT / FMCSA 49 CFR Part 391 Physical Exam Requirements</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeMedical?.expiryDate && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${medicalDeadlineStyle.badge}`}>
                <span className={`size-1.5 rounded-full ${medicalDeadlineStyle.indicator}`} />
                <span>Medical: {medicalDeadlineStatus}</span>
                <span className="opacity-75">
                  ({getDaysRemaining(activeMedical.expiryDate)} days remaining)
                </span>
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                setForm({
                  category: "Medical Card / DOT Physical",
                  recordDate: new Date().toISOString().slice(0, 10),
                  expiryDate: "",
                  status: "Qualified",
                  resultSummary: "",
                  providerOrAuthority: "",
                  cmeNumber: "",
                  examinerName: "",
                  notes: "",
                });
                setFormError(null);
                setIsAddModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <Plus className="size-3.5" />
              <span>Record Screening / Medical</span>
            </button>
          </div>
        </div>

        {activeMedical ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs pt-1">
            <ReadOnlyField label="Examination Date" value={activeMedical.recordDate} mono />
            <ReadOnlyField label="Expiry Date" value={activeMedical.expiryDate} mono />
            <ReadOnlyField
              label="Certified Medical Examiner"
              value={activeMedical.medicalCardDetails?.examinerName || activeMedical.providerOrAuthority}
              subtext={
                activeMedical.medicalCardDetails?.nationalRegistryNumber
                  ? `National Registry CME #: ${activeMedical.medicalCardDetails.nationalRegistryNumber}`
                  : undefined
              }
            />
            <ReadOnlyField
              label="Result / Standing"
              value={activeMedical.resultSummary}
              badge={<CheckCircle2 className="size-3 text-emerald-600" />}
            />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground p-3 bg-muted/20 rounded-xl">
            No active medical card on file. Record a medical examination above.
          </div>
        )}
      </div>

      {/* 2. Screening Ledger Table */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/20 px-5 py-3.5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Screening, Drug & Background Verification Register
            </h3>
            <span className="rounded-full bg-muted px-2 py-0.2 text-[10px] font-bold text-muted-foreground">
              {activeScreenings.length} Records
            </span>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-1 text-xs font-medium text-foreground focus:outline-hidden"
            >
              <option value="all">All Screening Categories</option>
              {SCREENING_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Exam / Verification Date</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Result Summary</th>
                <th className="px-5 py-3">Authority / Provider</th>
                <th className="px-5 py-3">Expiry Date</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredScreenings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-xs text-muted-foreground">
                    No screening records match the selected category filter.
                  </td>
                </tr>
              ) : (
                filteredScreenings.map((item) => {
                  const deadlineStatus = item.expiryDate ? getDeadlineStatus(item.expiryDate) : "No Deadline";
                  const deadlineStyle = getDeadlineClasses(deadlineStatus);

                  return (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3 font-bold text-foreground">
                        {item.category}
                        <span className="block font-mono text-[10px] text-muted-foreground font-normal">{item.id}</span>
                      </td>
                      <td className="px-5 py-3 font-mono text-muted-foreground">{item.recordDate}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            item.status === "Passed" || item.status === "Qualified"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : item.status === "In Review"
                              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                              : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-foreground font-medium">{item.resultSummary}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.providerOrAuthority}</td>
                      <td className="px-5 py-3">
                        {item.expiryDate ? (
                          <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold ${deadlineStyle.text}`}>
                            <Calendar className="size-3" />
                            {item.expiryDate}
                          </span>
                        ) : (
                          <span className="text-muted-foreground font-mono text-[11px]">N/A (Permanent)</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onArchiveScreening(item.id)}
                          className="text-[11px] font-semibold text-muted-foreground hover:text-destructive transition-colors"
                        >
                          Archive
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Screening Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Record Screening & Medical Verification</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveScreening} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Screening Category *
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as ScreeningCategory })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  >
                    {SCREENING_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Record / Exam Date *
                  </label>
                  <input
                    type="date"
                    value={form.recordDate}
                    onChange={(e) => setForm({ ...form, recordDate: e.target.value })}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Expiry Date (If applicable)
                  </label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Compliance Status *
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-bold mt-1"
                  >
                    <option value="Qualified">Qualified / Certified</option>
                    <option value="Passed">Passed / Negative Result</option>
                    <option value="In Review">In Review / Pending Medical</option>
                    <option value="Failed / Disqualified">Failed / Disqualified</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Examining Provider / Authority *
                  </label>
                  <input
                    type="text"
                    value={form.providerOrAuthority}
                    onChange={(e) => setForm({ ...form, providerOrAuthority: e.target.value })}
                    placeholder="e.g. Dynacare / Dr. Angela Foster, MD"
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                {form.category === "Medical Card / DOT Physical" && (
                  <>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        National Registry CME #
                      </label>
                      <input
                        type="text"
                        value={form.cmeNumber}
                        onChange={(e) => setForm({ ...form, cmeNumber: e.target.value })}
                        placeholder="e.g. 7109284"
                        className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Examiner Name
                      </label>
                      <input
                        type="text"
                        value={form.examinerName}
                        onChange={(e) => setForm({ ...form, examinerName: e.target.value })}
                        placeholder="e.g. Dr. Angela Foster, MD"
                        className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                      />
                    </div>
                  </>
                )}

                <div className="col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Result & Summary Findings *
                  </label>
                  <input
                    type="text"
                    value={form.resultSummary}
                    onChange={(e) => setForm({ ...form, resultSummary: e.target.value })}
                    placeholder="e.g. Clean MVR - 0 Points, 2-Year Medical Cert Issued"
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1 font-semibold"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Notes & Regulatory Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="e.g. Annual clearinghouse pre-employment consent on file."
                    className="w-full rounded-xl border border-border bg-background p-2.5 mt-1"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 font-semibold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
                >
                  Save Screening Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
