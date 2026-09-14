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
import { DriverMaster, ScreeningRecord, ScreeningCategory } from "@/types/drivers";
import { ReadOnlyField } from "../shared/ReadOnlyField";
import { getDeadlineStatus, getDeadlineClasses, getDaysRemaining } from "@/lib/deadline-engine";

export interface DriverScreeningTabProps {
  master: DriverMaster;
  screenings: ScreeningRecord[];
  onAddScreening: (data: Omit<ScreeningRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => void;
  onArchiveScreening: (id: string) => void;
  onOpenEvidence?: (docId: string) => void;
}

const SCREENING_CATEGORIES: ScreeningCategory[] = [
  "Employment History",
  "Driver Abstract / MVR Review",
  "Collision History",
  "Previous Employer Verification",
  "FMCSA Clearinghouse Query",
  "Annual Clearinghouse Query",
  "Pre-Employment Screening Program (PSP)",
  "Annual Roadside Test",
  "Criminal Background Check",
  "Credit History",
  "Education History",
  "Periodic Review",
  "Road Test Evaluation",
  "Medical Card / DOT Physical",
  "Pre-Employment Drug Test",
  "Pre-Employment Alcohol Test",
  "Random Drug / Alcohol Test",
  "Post-Accident Drug / Alcohol Test",
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
    medicalQualificationStatus: NonNullable<NonNullable<ScreeningRecord["medicalCardDetails"]>["medicalQualificationStatus"]> | "";
    medicalVerificationState: NonNullable<NonNullable<ScreeningRecord["medicalCardDetails"]>["verificationState"]> | "";
    testType: NonNullable<NonNullable<ScreeningRecord["drugAlcoholDetails"]>["testType"]> | "";
    testCategory: NonNullable<NonNullable<ScreeningRecord["drugAlcoholDetails"]>["testCategory"]> | "";
    specimenCollectionDate: string;
    mroVerifiedDate: string;
    mroName: string;
    laboratoryName: string;
    drugAlcoholResult: NonNullable<NonNullable<ScreeningRecord["drugAlcoholDetails"]>["result"]> | "";
    employerName: string;
    verificationRequestedDate: string;
    verificationReceivedDate: string;
    verificationMethod: NonNullable<NonNullable<ScreeningRecord["employerVerificationDetails"]>["verificationMethod"]> | "";
    verificationOutcome: NonNullable<NonNullable<ScreeningRecord["employerVerificationDetails"]>["verificationOutcome"]> | "";
    eligibleForRehire: NonNullable<NonNullable<ScreeningRecord["employerVerificationDetails"]>["eligibleForRehire"]> | "";
    clearinghousePurpose: NonNullable<NonNullable<ScreeningRecord["clearinghouseDetails"]>["queryPurpose"]> | "";
    clearinghouseSubmittedDate: string;
    clearinghouseCompletedDate: string;
    clearinghouseConsentObtained: boolean;
    clearinghouseConsentDate: string;
    clearinghouseResult: NonNullable<NonNullable<ScreeningRecord["clearinghouseDetails"]>["queryResult"]> | "";
    clearinghouseReference: string;
    pspRequestDate: string;
    pspConsentObtained: boolean;
    pspResultReceivedDate: string;
    pspReviewDate: string;
    pspReviewStatus: NonNullable<NonNullable<ScreeningRecord["pspDetails"]>["reviewStatus"]> | "";
    roadTestDate: string;
    roadTestExaminer: string;
    roadTestVehicleUnit: string;
    roadTestVehicleType: string;
    roadTestType: NonNullable<NonNullable<ScreeningRecord["roadTestDetails"]>["testType"]> | "";
    roadTestResult: NonNullable<NonNullable<ScreeningRecord["roadTestDetails"]>["testResult"]> | "";
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
    medicalQualificationStatus: "",
    medicalVerificationState: "",
    testType: "",
    testCategory: "",
    specimenCollectionDate: "",
    mroVerifiedDate: "",
    mroName: "",
    laboratoryName: "",
    drugAlcoholResult: "",
    employerName: "",
    verificationRequestedDate: "",
    verificationReceivedDate: "",
    verificationMethod: "",
    verificationOutcome: "",
    eligibleForRehire: "",
    clearinghousePurpose: "",
    clearinghouseSubmittedDate: "",
    clearinghouseCompletedDate: "",
    clearinghouseConsentObtained: false,
    clearinghouseConsentDate: "",
    clearinghouseResult: "",
    clearinghouseReference: "",
    pspRequestDate: "",
    pspConsentObtained: false,
    pspResultReceivedDate: "",
    pspReviewDate: "",
    pspReviewStatus: "",
    roadTestDate: "",
    roadTestExaminer: "",
    roadTestVehicleUnit: "",
    roadTestVehicleType: "",
    roadTestType: "",
    roadTestResult: "",
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
              examinationDate: form.recordDate,
              certificateIssueDate: form.recordDate,
              expiryDate: form.expiryDate || undefined,
              nationalRegistryNumber: form.cmeNumber || undefined,
              examinerName: form.examinerName || undefined,
              medicalQualificationStatus: form.medicalQualificationStatus || undefined,
              verificationState: form.medicalVerificationState || undefined,
            }
          : undefined,
      drugAlcoholDetails:
        form.category.includes("Drug Test") || form.category.includes("Alcohol Test") || form.category === "Reasonable Suspicion Test" || form.category === "Return-to-Duty Test" || form.category === "Follow-up Testing"
          ? {
              testType: form.testType || "Pre-Employment",
              testCategory: form.testCategory || "Combined Drug & Alcohol",
              specimenCollectionDate: form.specimenCollectionDate || form.recordDate,
              mroVerifiedDate: form.mroVerifiedDate || undefined,
              mroName: form.mroName || undefined,
              laboratoryName: form.laboratoryName || undefined,
              result: form.drugAlcoholResult || "Pending Verification",
            }
          : undefined,
      employerVerificationDetails:
        form.category === "Previous Employer Verification"
          ? {
              employerName: form.employerName.trim(),
              verificationRequestedDate: form.verificationRequestedDate || undefined,
              verificationReceivedDate: form.verificationReceivedDate || undefined,
              verificationMethod: form.verificationMethod || undefined,
              verificationOutcome: form.verificationOutcome || undefined,
              eligibleForRehire: form.eligibleForRehire || undefined,
            }
          : undefined,
      clearinghouseDetails:
        form.category === "FMCSA Clearinghouse Query" || form.category === "Annual Clearinghouse Query"
          ? {
              queryPurpose: form.clearinghousePurpose || (form.category === "Annual Clearinghouse Query" ? "Annual" : "Pre-Employment"),
              submittedDate: form.clearinghouseSubmittedDate || form.recordDate,
              completedDate: form.clearinghouseCompletedDate || undefined,
              consentObtained: form.clearinghouseConsentObtained,
              consentDate: form.clearinghouseConsentDate || undefined,
              queryResult: form.clearinghouseResult || "Pending Results",
              queryReferenceNumber: form.clearinghouseReference || undefined,
            }
          : undefined,
      pspDetails:
        form.category === "Pre-Employment Screening Program (PSP)"
          ? {
              requestDate: form.pspRequestDate || form.recordDate,
              consentObtained: form.pspConsentObtained,
              resultReceivedDate: form.pspResultReceivedDate || undefined,
              reviewDate: form.pspReviewDate || undefined,
              reviewStatus: form.pspReviewStatus || "Under Review",
            }
          : undefined,
      roadTestDetails:
        form.category === "Road Test Evaluation"
          ? {
              testDate: form.roadTestDate || form.recordDate,
              examinerName: form.roadTestExaminer.trim(),
              vehicleUnitNumber: form.roadTestVehicleUnit || undefined,
              vehicleType: form.roadTestVehicleType || undefined,
              testType: form.roadTestType || "Full Evaluation",
              testResult: form.roadTestResult || "Retest Required",
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
                  medicalQualificationStatus: "",
                  medicalVerificationState: "",
                  testType: "",
                  testCategory: "",
                  specimenCollectionDate: "",
                  mroVerifiedDate: "",
                  mroName: "",
                  laboratoryName: "",
                  drugAlcoholResult: "",
                  employerName: "",
                  verificationRequestedDate: "",
                  verificationReceivedDate: "",
                  verificationMethod: "",
                  verificationOutcome: "",
                  eligibleForRehire: "",
                  clearinghousePurpose: "",
                  clearinghouseSubmittedDate: "",
                  clearinghouseCompletedDate: "",
                  clearinghouseConsentObtained: false,
                  clearinghouseConsentDate: "",
                  clearinghouseResult: "",
                  clearinghouseReference: "",
                  pspRequestDate: "",
                  pspConsentObtained: false,
                  pspResultReceivedDate: "",
                  pspReviewDate: "",
                  pspReviewStatus: "",
                  roadTestDate: "",
                  roadTestExaminer: "",
                  roadTestVehicleUnit: "",
                  roadTestVehicleType: "",
                  roadTestType: "",
                  roadTestResult: "",
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
                <th className="px-5 py-3">Evidence</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredScreenings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-xs text-muted-foreground">
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
                      <td className="px-5 py-3 text-foreground font-medium">
                        {item.resultSummary}
                        {item.category === "Medical Card / DOT Physical" && item.medicalCardDetails?.medicalQualificationStatus && (
                          <span className="block text-[10px] text-muted-foreground mt-0.5">Qualification: {item.medicalCardDetails.medicalQualificationStatus.replaceAll("_", " ")}</span>
                        )}
                        {item.category === "Medical Card / DOT Physical" && item.medicalCardDetails?.verificationState && (
                          <span className="block text-[10px] text-muted-foreground">Verification: {item.medicalCardDetails.verificationState.replaceAll("_", " ")}</span>
                        )}
                        {item.drugAlcoholDetails && (
                          <span className="block text-[10px] text-muted-foreground mt-0.5">{item.drugAlcoholDetails.testCategory} · {item.drugAlcoholDetails.result}</span>
                        )}
                        {item.clearinghouseDetails && (
                          <span className="block text-[10px] text-muted-foreground mt-0.5">{item.clearinghouseDetails.queryPurpose} · {item.clearinghouseDetails.queryResult}</span>
                        )}
                      </td>
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
                      <td className="px-5 py-3">
                        {item.evidenceIds.length > 0 && onOpenEvidence ? (
                          <div className="flex flex-wrap gap-1">
                            {item.evidenceIds.map((evidenceId) => (
                              <button
                                key={evidenceId}
                                type="button"
                                onClick={() => onOpenEvidence(evidenceId)}
                                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-semibold text-primary hover:bg-muted"
                              >
                                <Eye className="size-3" />
                                View
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Not linked</span>
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
                    onChange={(e) => setForm({ ...form, status: e.target.value as ScreeningRecord["status"] })}
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
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">National Registry CME #</label>
                      <input value={form.cmeNumber} onChange={(e) => setForm({ ...form, cmeNumber: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Examiner Name</label>
                      <input value={form.examinerName} onChange={(e) => setForm({ ...form, examinerName: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Medical Qualification</label>
                      <select value={form.medicalQualificationStatus} onChange={(e) => setForm({ ...form, medicalQualificationStatus: e.target.value as typeof form.medicalQualificationStatus })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1">
                        <option value="">Not recorded</option><option value="QUALIFIED_2_YEARS">Qualified — 2 Years</option><option value="QUALIFIED_1_YEAR">Qualified — 1 Year</option><option value="QUALIFIED_3_6_MONTHS_TEMPORARY">Qualified — Temporary 3–6 Months</option><option value="DISQUALIFIED">Disqualified</option><option value="PENDING_VARIANCE">Pending Variance</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Verification State</label>
                      <select value={form.medicalVerificationState} onChange={(e) => setForm({ ...form, medicalVerificationState: e.target.value as typeof form.medicalVerificationState })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1">
                        <option value="">Not recorded</option><option value="UNVERIFIED">Unverified</option><option value="DOCUMENT_VERIFIED">Document Verified</option><option value="NATIONAL_REGISTRY_CONFIRMED">National Registry Confirmed</option>
                      </select>
                    </div>
                  </>
                )}

                {(form.category.includes("Drug Test") || form.category.includes("Alcohol Test") || form.category === "Reasonable Suspicion Test" || form.category === "Return-to-Duty Test" || form.category === "Follow-up Testing") && (
                  <>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Test Type</label><select value={form.testType} onChange={(e) => setForm({ ...form, testType: e.target.value as typeof form.testType })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Select</option><option>Pre-Employment</option><option>Random</option><option>Post-Accident</option><option>Reasonable Suspicion</option><option>Return-to-Duty</option><option>Follow-Up</option></select></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Test Category</label><select value={form.testCategory} onChange={(e) => setForm({ ...form, testCategory: e.target.value as typeof form.testCategory })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Select</option><option>Drug (5-Panel)</option><option>Alcohol (Breathalyzer)</option><option>Combined Drug &amp; Alcohol</option></select></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Specimen Collection Date</label><input type="date" value={form.specimenCollectionDate} onChange={(e) => setForm({ ...form, specimenCollectionDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Drug / Alcohol Result</label><select value={form.drugAlcoholResult} onChange={(e) => setForm({ ...form, drugAlcoholResult: e.target.value as typeof form.drugAlcoholResult })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Select</option><option>Negative</option><option>Positive</option><option>Refusal to Test</option><option>Cancelled / Invalid</option><option>Pending Verification</option></select></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">MRO Verified Date</label><input type="date" value={form.mroVerifiedDate} onChange={(e) => setForm({ ...form, mroVerifiedDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">MRO Name</label><input value={form.mroName} onChange={(e) => setForm({ ...form, mroName: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1" /></div>
                    <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Laboratory Name</label><input value={form.laboratoryName} onChange={(e) => setForm({ ...form, laboratoryName: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1" /></div>
                  </>
                )}

                {form.category === "Previous Employer Verification" && (
                  <>
                    <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Previous Employer *</label><input value={form.employerName} onChange={(e) => setForm({ ...form, employerName: e.target.value })} required className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Verification Requested</label><input type="date" value={form.verificationRequestedDate} onChange={(e) => setForm({ ...form, verificationRequestedDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Verification Received</label><input type="date" value={form.verificationReceivedDate} onChange={(e) => setForm({ ...form, verificationReceivedDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Verification Method</label><select value={form.verificationMethod} onChange={(e) => setForm({ ...form, verificationMethod: e.target.value as typeof form.verificationMethod })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Not recorded</option><option>Email</option><option>Fax</option><option>Phone</option><option>Third-Party Service</option></select></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Verification Outcome</label><select value={form.verificationOutcome} onChange={(e) => setForm({ ...form, verificationOutcome: e.target.value as typeof form.verificationOutcome })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Not recorded</option><option>Verified as Claimed</option><option>Discrepancy Found</option><option>No Record / Unable to Verify</option></select></div>
                    <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Eligible for Rehire</label><select value={form.eligibleForRehire} onChange={(e) => setForm({ ...form, eligibleForRehire: e.target.value as typeof form.eligibleForRehire })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Not recorded</option><option>Yes</option><option>No</option><option>Ineligible</option><option>Unknown</option></select></div>
                  </>
                )}

                {(form.category === "FMCSA Clearinghouse Query" || form.category === "Annual Clearinghouse Query") && (
                  <>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Query Purpose</label><select value={form.clearinghousePurpose} onChange={(e) => setForm({ ...form, clearinghousePurpose: e.target.value as typeof form.clearinghousePurpose })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Select</option><option>Pre-Employment</option><option>Annual</option><option>Follow-Up</option><option>Other</option></select></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Submitted Date</label><input type="date" value={form.clearinghouseSubmittedDate} onChange={(e) => setForm({ ...form, clearinghouseSubmittedDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Completed Date</label><input type="date" value={form.clearinghouseCompletedDate} onChange={(e) => setForm({ ...form, clearinghouseCompletedDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Query Result</label><select value={form.clearinghouseResult} onChange={(e) => setForm({ ...form, clearinghouseResult: e.target.value as typeof form.clearinghouseResult })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Select</option><option>Driver Not Prohibited</option><option>Driver Prohibited</option><option>Pending Consent</option><option>Pending Results</option></select></div>
                    <div className="col-span-2"><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Query Reference Number</label><input value={form.clearinghouseReference} onChange={(e) => setForm({ ...form, clearinghouseReference: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <label className="col-span-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.clearinghouseConsentObtained} onChange={(e) => setForm({ ...form, clearinghouseConsentObtained: e.target.checked })} /> Consent obtained</label>
                  </>
                )}

                {form.category === "Pre-Employment Screening Program (PSP)" && (
                  <>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Request Date</label><input type="date" value={form.pspRequestDate} onChange={(e) => setForm({ ...form, pspRequestDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Result Received</label><input type="date" value={form.pspResultReceivedDate} onChange={(e) => setForm({ ...form, pspResultReceivedDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Review Date</label><input type="date" value={form.pspReviewDate} onChange={(e) => setForm({ ...form, pspReviewDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Review Status</label><select value={form.pspReviewStatus} onChange={(e) => setForm({ ...form, pspReviewStatus: e.target.value as typeof form.pspReviewStatus })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Select</option><option>Clean Record</option><option>Violations Noted</option><option>Under Review</option></select></div>
                    <label className="col-span-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.pspConsentObtained} onChange={(e) => setForm({ ...form, pspConsentObtained: e.target.checked })} /> Consent obtained</label>
                  </>
                )}

                {form.category === "Road Test Evaluation" && (
                  <>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Test Date</label><input type="date" value={form.roadTestDate} onChange={(e) => setForm({ ...form, roadTestDate: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Examiner Name *</label><input value={form.roadTestExaminer} onChange={(e) => setForm({ ...form, roadTestExaminer: e.target.value })} required className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vehicle Unit</label><input value={form.roadTestVehicleUnit} onChange={(e) => setForm({ ...form, roadTestVehicleUnit: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vehicle Type</label><input value={form.roadTestVehicleType} onChange={(e) => setForm({ ...form, roadTestVehicleType: e.target.value })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1" /></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Test Type</label><select value={form.roadTestType} onChange={(e) => setForm({ ...form, roadTestType: e.target.value as typeof form.roadTestType })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Select</option><option>Pre-Trip &amp; Road Test</option><option>Manoeuvring &amp; Backing</option><option>Coupling / Uncoupling</option><option>Full Evaluation</option></select></div>
                    <div><label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Test Result</label><select value={form.roadTestResult} onChange={(e) => setForm({ ...form, roadTestResult: e.target.value as typeof form.roadTestResult })} className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"><option value="">Select</option><option>Passed</option><option>Failed</option><option>Retest Required</option></select></div>
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