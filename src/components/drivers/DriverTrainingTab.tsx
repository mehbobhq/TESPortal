import React, { useState } from "react";
import {
  GraduationCap,
  Award,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Calendar,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { DriverMaster, TrainingRecord, TrainingStatus, TrainingType } from "@/types/drivers";
import { getTrainingCourseCatalog } from "@/lib/driver-data";
import { ReadOnlyField } from "../shared/ReadOnlyField";
import { getDeadlineStatus, getDeadlineClasses } from "@/lib/deadline-engine";

export interface DriverTrainingTabProps {
  master: DriverMaster;
  trainings: TrainingRecord[];
  onAddTraining: (training: Omit<TrainingRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => void;
  onWaiveTraining: (id: string, reason: string) => void;
}

export function DriverTrainingTab({
  master,
  trainings,
  onAddTraining,
  onWaiveTraining,
}: DriverTrainingTabProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isWaiveModalOpen, setIsWaiveModalOpen] = useState(false);
  const [selectedWaiveId, setSelectedWaiveId] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [waivedBy, setWaivedBy] = useState("");

  const courseCatalog = getTrainingCourseCatalog().filter((course) => course.state === "ACTIVE");

  const [form, setForm] = useState<{
    courseId: string;
    courseTitle: string;
    courseVersion: string;
    trainingType: TrainingType;
    provider: string;
    status: TrainingStatus;
    assignedDate: string;
    startDate: string;
    completionDate: string;
    expiryDate: string;
    scoreOrResult: string;
    certificateNumber: string;
    notes: string;
  }>({
    courseId: "",
    courseTitle: "",
    courseVersion: "",
    trainingType: "OTHER",
    provider: "",
    status: "Assigned",
    assignedDate: new Date().toISOString().slice(0, 10),
    startDate: "",
    completionDate: "",
    expiryDate: "",
    scoreOrResult: "",
    certificateNumber: "",
    notes: "",
  });

  const [formError, setFormError] = useState<string | null>(null);

  const activeTrainings = trainings.filter((t) => !t.isArchived);

  const handleSelectCourse = (courseId: string) => {
    const course = courseCatalog.find((item) => item.courseId === courseId);
    if (!course) return;
    setForm((prev) => ({
      ...prev,
      courseId: course.courseId,
      courseTitle: course.title,
      courseVersion: course.version,
    }));
  };

  const handleSaveTraining = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.courseId || !form.provider.trim()) {
      setFormError("A canonical course and training provider are required.");
      return;
    }

    onAddTraining({
      courseId: form.courseId,
      courseVersion: form.courseVersion || undefined,
      courseTitle: form.courseTitle,
      trainingType: form.trainingType,
      provider: form.provider.trim(),
      status: form.status,
      assignedDate: form.assignedDate || undefined,
      startDate: form.startDate || undefined,
      completionDate: form.status === "Completed" ? (form.completionDate || undefined) : undefined,
      expiryDate: form.expiryDate || undefined,
      scoreOrResult: form.scoreOrResult.trim() || undefined,
      certificateNumber: form.certificateNumber.trim() || undefined,
      evidenceIds: [],
      notes: form.notes || undefined,
    });

    setIsAddModalOpen(false);
  };

  const handleCommitWaive = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWaiveId || !waiveReason.trim()) return;

    const recordedByNote = waivedBy.trim() ? ` (Authorized by: ${waivedBy.trim()})` : "";
    onWaiveTraining(selectedWaiveId, `${waiveReason.trim()}${recordedByNote}`);
    setIsWaiveModalOpen(false);
    setSelectedWaiveId(null);
    setWaiveReason("");
    setWaivedBy("");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GraduationCap className="size-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Commercial Training & Certification Register</h3>
            <p className="text-xs text-muted-foreground">
              {activeTrainings.length} courses completed & active in training compliance curriculum
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setIsAddModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs self-start sm:self-auto"
        >
          <Plus className="size-3.5" />
          <span>Assign / Log Training</span>
        </button>
      </div>

      {/* Training Table */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/20 px-5 py-3 border-b border-border">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Driver Training & Qualification Ledger
          </h4>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Course / Certification Title</th>
                <th className="px-5 py-3">Training Type</th>
                <th className="px-5 py-3">Provider</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Completed Date</th>
                <th className="px-5 py-3">Expiry Date</th>
                <th className="px-5 py-3">Result / Score</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activeTrainings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-xs text-muted-foreground">
                    No training records on file for this driver.
                  </td>
                </tr>
              ) : (
                activeTrainings.map((item) => {
                  const deadlineStatus = item.expiryDate ? getDeadlineStatus(item.expiryDate) : "No Deadline";
                  const deadlineStyle = getDeadlineClasses(deadlineStatus);

                  return (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3">
                        <span className="font-bold text-foreground block">{item.courseTitle}</span>
                        {item.certificateNumber && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            Cert #: {item.certificateNumber}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{item.trainingType}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.provider}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            item.status === "Completed"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : item.status === "In Progress"
                              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                              : item.status === "Waived"
                              ? "bg-muted text-muted-foreground"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}
                        >
                          {item.status}
                        </span>
                        {item.waiveReason && (
                          <span className="block text-[10px] text-muted-foreground italic mt-0.5">
                            Reason: {item.waiveReason}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-muted-foreground">{item.completionDate || "—"}</td>
                      <td className="px-5 py-3">
                        {item.expiryDate ? (
                          <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold ${deadlineStyle.text}`}>
                            <Calendar className="size-3" />
                            {item.expiryDate}
                          </span>
                        ) : (
                          <span className="text-muted-foreground font-mono text-[11px]">Permanent</span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-bold text-foreground">{item.scoreOrResult || "—"}</td>
                      <td className="px-5 py-3 text-right">
                        {item.status !== "Waived" && item.status !== "Completed" && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedWaiveId(item.id);
                              setWaiveReason("");
                              setWaivedBy("");
                              setIsWaiveModalOpen(true);
                            }}
                            className="text-[11px] font-semibold text-amber-600 hover:underline"
                          >
                            Waive Course
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Training Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Assign or Record Driver Training</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            {/* Canonical Course Picker */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Training Course *
              </label>
              <select
                value={form.courseId}
                onChange={(e) => handleSelectCourse(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-background px-3 font-medium mt-1"
                required
              >
                <option value="" disabled>Select a canonical training course</option>
                {courseCatalog.map((course) => (
                  <option key={course.courseId} value={course.courseId}>
                    {course.title} — {course.courseCode}
                  </option>
                ))}
              </select>
              {form.courseId && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {courseCatalog.find((course) => course.courseId === form.courseId)?.description || "Canonical course selected."}
                </p>
              )}
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveTraining} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">


                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Training Type *
                  </label>
                  <select
                    value={form.trainingType}
                    onChange={(e) => setForm({ ...form, trainingType: e.target.value as TrainingType })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  >
                    <option value="INITIAL">Initial</option>
                    <option value="REFRESHER">Refresher</option>
                    <option value="REGULATORY_MANDATED">Regulatory Mandated</option>
                    <option value="CERTIFICATION">Certification</option>
                    <option value="ORIENTATION">Orientation</option>
                    <option value="SAFETY_SEMINAR">Safety Seminar</option>
                    <option value="COMPANY_POLICY">Company Policy</option>
                    <option value="CORRECTIVE_ACTION_RETRAINING">Corrective Action Retraining</option>
                    <option value="SPECIALIZED_CARGO">Specialized Cargo</option>
                    <option value="WINTER_GRADE_OPERATIONS">Winter Grade Operations</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Training Provider / Delivery Entity *
                  </label>
                  <input
                    type="text"
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                    required
                    placeholder="e.g. Internal Safety Dept or Vendor Name"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Training Status *
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as TrainingStatus })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-bold mt-1"
                  >
                    <option value="Assigned">Assigned / Required</option>
                    <option value="Scheduled">Scheduled</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Completed">Completed / Passed</option>
                    <option value="Exempted">Exempted</option>
                    <option value="Cancelled">Cancelled</option>
                    <option value="Waived">Waived</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Completion Date (if completed)
                  </label>
                  <input
                    type="date"
                    value={form.completionDate}
                    onChange={(e) => setForm({ ...form, completionDate: e.target.value })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Certificate / Card Number
                  </label>
                  <input
                    type="text"
                    value={form.certificateNumber}
                    onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })}
                    placeholder="Optional certificate/ID"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Expiry Date
                  </label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Assessment Result / Score
                  </label>
                  <input
                    type="text"
                    value={form.scoreOrResult}
                    onChange={(e) => setForm({ ...form, scoreOrResult: e.target.value })}
                    placeholder="e.g. Passed, 96%, or Grade"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
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
                  Save Training Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Waive Modal */}
      {isWaiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Waive Training Requirement</h3>
              <button
                type="button"
                onClick={() => setIsWaiveModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            <p className="text-muted-foreground">
              Provide a documented compliance rationale for waiving this course. This rationale is written into the
              auditable ledger.
            </p>

            <form onSubmit={handleCommitWaive} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Authorized Manager / Role *
                </label>
                <input
                  type="text"
                  value={waivedBy}
                  onChange={(e) => setWaivedBy(e.target.value)}
                  required
                  placeholder="e.g. Jane Doe (Safety Manager)"
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Documented Compliance Rationale *
                </label>
                <textarea
                  rows={3}
                  value={waiveReason}
                  onChange={(e) => setWaiveReason(e.target.value)}
                  required
                  placeholder="e.g. Driver presented verified equivalent 3-year certification from previous carrier."
                  className="w-full rounded-xl border border-border bg-background p-2.5 mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsWaiveModalOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 font-semibold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
                >
                  Commit Waiver
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
