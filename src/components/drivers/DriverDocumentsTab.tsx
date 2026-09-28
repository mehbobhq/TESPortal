import React, { useEffect, useState } from "react";
import {
  FileText,
  FileCheck2,
  Upload,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  Building2,
  UserCheck,
  Calendar,
  Check,
  X,
  Eye,
  Sparkles,
  RefreshCw,
  SearchCheck,
  Link2,
} from "lucide-react";
import {
  DriverMaster,
  CompanyDriverRelationship,
  DriverApplicationRecord,
  HiringPackageRecord,
  DriverTaxDocRecord,
  DriverEvidenceItem,
  CanonicalCompany,
} from "@/types/drivers";
import { ReadOnlyField } from "../shared/ReadOnlyField";
import {
  updateDriverApplicationDetermination,
  updateHiringPackageItem,
  queueDriverApplicationProcessing,
  addDriverApplicationFinding,
  resolveDriverApplicationFinding,
  createReplacementDriverApplication,
} from "@/lib/driver-data";

export interface DriverDocumentsTabProps {
  master: DriverMaster;
  relationship: CompanyDriverRelationship;
  company: CanonicalCompany;
  applications: DriverApplicationRecord[];
  hiringPackages: HiringPackageRecord[];
  taxDocs: DriverTaxDocRecord[];
  evidence: DriverEvidenceItem[];
  onAddApplication: () => void;
  onAddHiringPackage: () => void;
  onAddTaxDoc: () => void;
  onOpenEvidence: (doc: DriverEvidenceItem) => void;
  onRefresh: () => void;
}

export function DriverDocumentsTab({
  master,
  relationship,
  company,
  applications,
  hiringPackages,
  taxDocs,
  evidence,
  onAddApplication,
  onAddHiringPackage,
  onAddTaxDoc,
  onOpenEvidence,
  onRefresh,
}: DriverDocumentsTabProps) {
  const [selectedAppId, setSelectedAppId] = useState<string | null>(applications.at(0)?.id || null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(hiringPackages.at(0)?.id || null);
  const [isDeterminationModalOpen, setIsDeterminationModalOpen] = useState(false);
  const [determinationDecision, setDeterminationDecision] = useState<"Approved" | "Rejected" | "Withdrawn">("Approved");
  const [reviewerName, setReviewerName] = useState("");
  const [determinationNotes, setDeterminationNotes] = useState("");
  const [determinationError, setDeterminationError] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [findingType, setFindingType] = useState<"MISMATCH" | "MISSING_INFORMATION" | "UNABLE_TO_VERIFY" | "ADDITIONAL_INFORMATION_REQUIRED">("MISMATCH");
  const [findingSubject, setFindingSubject] = useState<"Identity" | "Licence" | "Employment" | "Collision" | "Citation / Violation" | "Medical" | "Training" | "Operating Scope" | "Authorization" | "Document" | "Other">("Other");
  const [findingLabel, setFindingLabel] = useState("");
  const [applicantStatement, setApplicantStatement] = useState("");
  const [evidenceStatement, setEvidenceStatement] = useState("");
  const [findingNotes, setFindingNotes] = useState("");
  const [isFindingModalOpen, setIsFindingModalOpen] = useState(false);

  // Explicit Signing Modal state for hiring package checklist items
  const [signingItem, setSigningItem] = useState<{ pkgId: string; itemId: string; title: string } | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerError, setSignerError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedAppId && applications.some((application) => application.id === selectedAppId)) return;
    setSelectedAppId(applications.at(0)?.id || null);
  }, [applications, selectedAppId]);

  useEffect(() => {
    if (selectedPackageId && hiringPackages.some((pkg) => pkg.id === selectedPackageId)) return;
    setSelectedPackageId(hiringPackages.at(0)?.id || null);
  }, [hiringPackages, selectedPackageId]);

  const activeApplication = applications.find((application) => application.id === selectedAppId) || null;
  const activePackage = hiringPackages.find((pkg) => pkg.id === selectedPackageId) || null;

  const handleSaveDetermination = (e: React.FormEvent) => {
    e.preventDefault();
    setDeterminationError(null);
    if (!activeApplication) return;

    if (!reviewerName.trim()) {
      setDeterminationError("Reviewer / Authorized Officer name is required.");
      return;
    }

    updateDriverApplicationDetermination(
      company.id,
      activeApplication.id,
      determinationDecision,
      reviewerName.trim(),
      determinationNotes
    );

    setIsDeterminationModalOpen(false);
    onRefresh();
  };

  const handleToggleSignItem = (pkgId: string, itemId: string, itemTitle: string, currentSigned: boolean) => {
    if (currentSigned) {
      // Revoke signature
      updateHiringPackageItem(company.id, pkgId, itemId, false);
      onRefresh();
    } else {
      // Open signing modal to require truthful signer input
      setSigningItem({ pkgId, itemId, title: itemTitle });
      setSignerName("");
      setSignerError(null);
    }
  };

  const handleConfirmSign = (e: React.FormEvent) => {
    e.preventDefault();
    setSignerError(null);
    if (!signingItem) return;

    if (!signerName.trim()) {
      setSignerError("Legal Signer Name is required to execute signature acknowledgement.");
      return;
    }

    updateHiringPackageItem(company.id, signingItem.pkgId, signingItem.itemId, true, signerName.trim());
    setSigningItem(null);
    onRefresh();
  };

  const handleQueueProcessing = () => {
    if (!activeApplication) return;
    setProcessingError(null);
    try {
      queueDriverApplicationProcessing(company.id, activeApplication.id);
      onRefresh();
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : "Unable to queue this application for TES processing.");
    }
  };

  const handleAddFinding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeApplication) return;
    setProcessingError(null);
    if (!findingLabel.trim()) {
      setProcessingError("A factual finding label is required.");
      return;
    }
    try {
      addDriverApplicationFinding(company.id, activeApplication.id, {
        type: findingType,
        status: "Open",
        subject: findingSubject,
        label: findingLabel.trim(),
        applicantStatement: applicantStatement.trim() || undefined,
        evidenceStatement: evidenceStatement.trim() || undefined,
        evidenceIds: [],
        notes: findingNotes.trim() || undefined,
      });
      setFindingLabel("");
      setApplicantStatement("");
      setEvidenceStatement("");
      setFindingNotes("");
      setIsFindingModalOpen(false);
      onRefresh();
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : "Unable to record the reconciliation finding.");
    }
  };

  const handleFindingAction = (findingId: string, status: "Resolved" | "Clarification Requested" | "New Application Required") => {
    if (!activeApplication) return;
    setProcessingError(null);
    try {
      resolveDriverApplicationFinding(company.id, activeApplication.id, findingId, { status });
      onRefresh();
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : "Unable to update the finding.");
    }
  };

  const handleCreateReplacement = () => {
    if (!activeApplication) return;
    setProcessingError(null);
    try {
      const replacement = createReplacementDriverApplication(
        company.id,
        activeApplication.id,
        "A new application is required because submitted information could not be reconciled with supporting records."
      );
      if (replacement?.id) setSelectedAppId(replacement.id);
      onRefresh();
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : "Unable to create a replacement application.");
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Driver Application Lifecycle Section */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/20 px-5 py-3.5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Commercial Driver Application (First-Class Compliance Record)
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {activeApplication && (
              <button
                type="button"
                onClick={() => {
                  setSelectedAppId(activeApplication.id);
                  setDeterminationDecision(activeApplication.companyDetermination === "Rejected" ? "Rejected" : "Approved");
                  setDeterminationNotes(activeApplication.determinationNotes || "");
                  setIsDeterminationModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors shadow-2xs"
              >
                <UserCheck className="size-3.5 text-primary" />
                <span>Record Company Determination</span>
              </button>
            )}

          </div>
        </div>

        {applications.length > 0 && (
          <div className="border-b border-border bg-background/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Application Records</p>
                <p className="text-xs text-muted-foreground">Select a record to review its lifecycle and claimed information.</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{applications.length}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {applications.map((application) => (
                <button
                  key={application.id}
                  type="button"
                  onClick={() => setSelectedAppId(application.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${selectedAppId === application.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"}`}
                >
                  <span className="block text-[10px] font-mono text-muted-foreground">{application.id}</span>
                  <span className="mt-1 block text-xs font-bold text-foreground">{application.applicationType}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">{application.status} · {application.submittedDate || application.createdDate || "Date not recorded"}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeApplication ? (
          <div className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnlyField
                label="Application ID"
                value={activeApplication.id}
                mono
                copyable
              />
              <ReadOnlyField
                label="Lifecycle Status"
                value={activeApplication.status}
                badge={
                  <span
                    className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${
                      activeApplication.status === "Approved"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : activeApplication.status === "Submitted"
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    }`}
                  >
                    {activeApplication.status}
                  </span>
                }
              />
              <ReadOnlyField label="Application Type" value={activeApplication.applicationType} />
              <ReadOnlyField label="Operating Scope" value={activeApplication.operatingRegion} />
              <ReadOnlyField label="Application Context" value={activeApplication.applicationContext || "Legacy / Not Classified"} />
              <ReadOnlyField label="TES Service Start" value={activeApplication.tesServiceStartDateAtCreation || company.startDate || "Not recorded"} mono />
              <ReadOnlyField label="Employment Start" value={activeApplication.employmentStartDateAtCreation || relationship.startDate || "Not recorded"} mono />
              <ReadOnlyField label="Submitted Date" value={activeApplication.submittedDate || "Draft In Progress"} mono />
              <ReadOnlyField
                label="Company Determination"
                value={activeApplication.companyDetermination || "Pending Review"}
                badge={
                  activeApplication.companyDetermination === "Approved" ? (
                    <CheckCircle2 className="size-3 text-emerald-600" />
                  ) : undefined
                }
              />
              <ReadOnlyField label="Reviewed By" value={activeApplication.reviewedBy || "Unreviewed"} />
              <ReadOnlyField label="Review Date" value={activeApplication.determinationDate || "—"} mono />
            </div>

            {/* Application Summary Profile */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                Universal Application Profile Summary
              </span>
              {(() => {
                const hasExperienceVerificationEvidence = Boolean(
                  activeApplication.evidenceIds &&
                  activeApplication.evidenceIds.length > 0 &&
                  evidence.some(
                    (e) =>
                      activeApplication.evidenceIds.includes(e.id) &&
                      (e.documentType?.toLowerCase().includes("verification") ||
                        e.documentType?.toLowerCase().includes("employment") ||
                        e.documentType?.toLowerCase().includes("mvr") ||
                        e.documentType?.toLowerCase().includes("screening") ||
                        e.documentType?.toLowerCase().includes("inquiry"))
                  )
                );

                return (
                  <div className="grid sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground block">
                        {hasExperienceVerificationEvidence ? "Verified Commercial Experience:" : "Declared Commercial Experience:"}
                      </span>
                      <span className="font-bold text-foreground">
                        {activeApplication.experienceYears !== undefined && activeApplication.experienceYears !== null
                          ? `${activeApplication.experienceYears} Years ${hasExperienceVerificationEvidence ? "Verified" : "Declared"}`
                          : "Not recorded"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">3-Year Traffic Convictions:</span>
                      <span className="font-bold text-foreground">
                        {activeApplication.trafficConvictionsLast3Yrs === undefined || activeApplication.trafficConvictionsLast3Yrs === null
                          ? "Not recorded"
                          : activeApplication.trafficConvictionsLast3Yrs === 0
                          ? "0 recorded"
                          : `${activeApplication.trafficConvictionsLast3Yrs} Violation(s)`}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">3-Year Collision Record:</span>
                      <span className="font-bold text-foreground">
                        {activeApplication.accidentsLast3Yrs === undefined || activeApplication.accidentsLast3Yrs === null
                          ? "Not recorded"
                          : activeApplication.accidentsLast3Yrs === 0
                          ? "0 recorded"
                          : `${activeApplication.accidentsLast3Yrs} Incident(s)`}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
{activeApplication.determinationNotes && (
              <div className="text-xs rounded-xl bg-primary/5 border border-primary/15 p-3 text-primary">
                <span className="font-bold">Determination Remarks:</span> {activeApplication.determinationNotes}
              </div>
            )}

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <SearchCheck className="size-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">TES Application Review & Processing</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Applicant claims remain unchanged. TES records evidence comparisons and factual differences separately.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Submitted", "Under Review"].includes(activeApplication.status) && !activeApplication.processing?.queuedAt && (
                    <button type="button" onClick={handleQueueProcessing} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                      <RefreshCw className="size-3.5" /> Start TES Processing
                    </button>
                  )}
                  {["Submitted", "Under Review", "Additional Information Requested"].includes(activeApplication.status) && (
                    <button type="button" onClick={() => setIsFindingModalOpen(true)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90">
                      + Record Finding
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <ReadOnlyField label="Processing Status" value={activeApplication.processing?.status || "Not Started"} />
                <ReadOnlyField label="File Completeness" value={activeApplication.processing?.fileCompleteness || "Not Assessed"} />
                <ReadOnlyField label="Qualification Assessment" value={activeApplication.processing?.qualificationAssessment || "Not Assessed"} />
                <ReadOnlyField label="Findings" value={String(activeApplication.findings?.length || 0)} />
              </div>

              {processingError && (
                <div className="mx-4 mb-4 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive">{processingError}</div>
              )}

              <div className="border-t border-border">
                {(activeApplication.findings?.length || 0) === 0 ? (
                  <div className="p-5 text-center text-xs text-muted-foreground">No reconciliation findings recorded for this application.</div>
                ) : (
                  <div className="divide-y divide-border">
                    {activeApplication.findings!.map((finding) => (
                      <div key={finding.id} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">{finding.type.replaceAll("_", " ")}</span>
                              <span className="text-[10px] font-semibold text-muted-foreground">{finding.subject}</span>
                              <span className="text-[10px] text-muted-foreground">· {finding.status}</span>
                            </div>
                            <p className="mt-1 text-xs font-bold text-foreground">{finding.label}</p>
                          </div>
                          <span className="font-mono text-[9px] text-muted-foreground">{finding.id}</span>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border border-border bg-muted/10 p-3">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Applicant statement</span>
                            <p className="mt-1 text-xs text-foreground">{finding.applicantStatement || "Not recorded"}</p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/10 p-3">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Supporting record / evidence</span>
                            <p className="mt-1 text-xs text-foreground">{finding.evidenceStatement || "Not recorded"}</p>
                          </div>
                        </div>

                        {finding.notes && <p className="mt-2 text-[11px] text-muted-foreground">{finding.notes}</p>}

                        {finding.evidenceIds.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {finding.evidenceIds.map((evidenceId) => {
                              const doc = evidence.find((item) => item.id === evidenceId);
                              return (
                                <button key={evidenceId} type="button" onClick={() => doc && onOpenEvidence(doc)} disabled={!doc} className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline disabled:text-muted-foreground">
                                  <Link2 className="size-3" /> {doc?.fileName || evidenceId}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {finding.status !== "Resolved" && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={() => handleFindingAction(finding.id, "Resolved")} className="rounded-lg border border-border px-2.5 py-1 text-[10px] font-bold hover:bg-muted">Resolve</button>
                            <button type="button" onClick={() => handleFindingAction(finding.id, "Clarification Requested")} className="rounded-lg border border-border px-2.5 py-1 text-[10px] font-bold hover:bg-muted">Request Clarification</button>
                            <button type="button" onClick={() => handleFindingAction(finding.id, "New Application Required")} className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">New Application Required</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {activeApplication.findings?.some((finding) => finding.status === "New Application Required") && activeApplication.status !== "Superseded" && (
                <div className="border-t border-border bg-amber-50/60 p-4">
                  <p className="text-xs font-semibold text-amber-900">A replacement application has been identified as necessary. The submitted application will remain unchanged.</p>
                  <button type="button" onClick={handleCreateReplacement} className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800">
                    Issue New Linked Application
                  </button>
                </div>
              )}

              {(activeApplication.replacesApplicationId || activeApplication.supersededByApplicationId) && (
                <div className="border-t border-border bg-muted/20 p-4 text-[11px] text-muted-foreground">
                  {activeApplication.replacesApplicationId && <div>Replaces application: <span className="font-mono font-semibold text-foreground">{activeApplication.replacesApplicationId}</span></div>}
                  {activeApplication.supersededByApplicationId && <div>Superseded by: <span className="font-mono font-semibold text-foreground">{activeApplication.supersededByApplicationId}</span></div>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No active application on file for this driver.
          </div>
        )}
      </div>

      {/* 2. Hiring Package Container & Checklists */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/20 px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCheck2 className="size-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Hiring & Onboarding Package Container
            </h3>
          </div>

        </div>

        {hiringPackages.length > 0 && (
          <div className="border-b border-border bg-background/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hiring Package Records</p>
                <p className="text-xs text-muted-foreground">Select a package to review version, lifecycle, checklist, and signatures.</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{hiringPackages.length}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {hiringPackages.map((pkg) => (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setSelectedPackageId(pkg.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${selectedPackageId === pkg.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"}`}
                >
                  <span className="block text-[10px] font-mono text-muted-foreground">{pkg.id}</span>
                  <span className="mt-1 block text-xs font-bold text-foreground">Version {pkg.packageVersion}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">{pkg.status} · {pkg.issuedDate || "Date not recorded"}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activePackage ? (
          <div className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnlyField label="Package Record ID" value={activePackage.id} mono copyable />
              <ReadOnlyField
                label="Package Status"
                value={activePackage.status}
                badge={
                  <span
                    className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${
                      activePackage.status === "Completed"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    }`}
                  >
                    {activePackage.status}
                  </span>
                }
              />
              <ReadOnlyField label="Package Version" value={activePackage.packageVersion} />
              <ReadOnlyField label="Issued Date" value={activePackage.issuedDate} mono />
            </div>

            {/* Checklist Items Table */}
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Document / Agreement Title</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Requirement</th>
                    <th className="px-4 py-2.5">Signature Status</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activePackage.items.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-bold text-foreground">{item.title}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{item.category}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-bold text-foreground">
                          {item.required ? "Mandatory" : "Optional"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {item.signed ? (
                          <span className="flex items-center gap-1 font-bold text-emerald-600 text-xs">
                            <CheckCircle2 className="size-3" /> Signed ({item.signedDate})
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 font-medium text-amber-600 text-xs">
                            <Clock className="size-3" /> Pending Signature
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleSignItem(activePackage.id, item.id, item.title, item.signed)}
                          className="text-[11px] font-bold text-primary hover:underline"
                        >
                          {item.signed ? "Revoke Signature" : "Sign Acknowledgement"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No hiring package issued to this driver.
          </div>
        )}
      </div>

      {/* 3. Tax & Government Onboarding Forms */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/20 px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Tax & Withholding Documentation (TD1 / W-4 Forms)
          </h3>
          <button
            type="button"
            onClick={onAddTaxDoc}
            className="text-xs font-bold text-primary hover:underline"
          >
            + Add Tax Form
          </button>
        </div>

        <div className="p-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          {taxDocs.length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
              No tax / onboarding records established for this Driver.
            </div>
          ) : (
            taxDocs.map((doc) => (
              <div key={doc.id} className="rounded-xl border border-border p-3 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{doc.formType}</span>
                <p className="font-bold text-foreground">{doc.status}</p>
                <p className="text-[10px] text-muted-foreground">Tax Year: {doc.taxYear || "Not Established"}</p>
                <p className="text-[10px] text-muted-foreground">Jurisdiction: {doc.jurisdiction || "Not Established"}</p>
                <p className="text-[10px] text-muted-foreground">Effective: {doc.effectiveDate || "Not Established"}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {isFindingModalOpen && activeApplication && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Record Factual Reconciliation Finding</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">Record the difference between the submitted claim and supporting information. Do not infer intent or character.</p>
              </div>
              <button type="button" onClick={() => setIsFindingModalOpen(false)} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">✕</button>
            </div>
            <form onSubmit={handleAddFinding} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Finding Type
                  <select value={findingType} onChange={(e) => setFindingType(e.target.value as typeof findingType)} className="mt-1 h-9 w-full rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground">
                    <option value="MISMATCH">Mismatch</option><option value="MISSING_INFORMATION">Missing Information</option><option value="UNABLE_TO_VERIFY">Unable to Verify</option><option value="ADDITIONAL_INFORMATION_REQUIRED">Additional Information Required</option>
                  </select>
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Subject
                  <select value={findingSubject} onChange={(e) => setFindingSubject(e.target.value as typeof findingSubject)} className="mt-1 h-9 w-full rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground">
                    {["Identity","Licence","Employment","Collision","Citation / Violation","Medical","Training","Operating Scope","Authorization","Document","Other"].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Finding *
                <input value={findingLabel} onChange={(e) => setFindingLabel(e.target.value)} required placeholder="e.g. Licence class differs from submitted application" className="mt-1 h-9 w-full rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Applicant Statement
                  <textarea rows={3} value={applicantStatement} onChange={(e) => setApplicantStatement(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs font-normal normal-case tracking-normal text-foreground" />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Evidence / Supporting Record
                  <textarea rows={3} value={evidenceStatement} onChange={(e) => setEvidenceStatement(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs font-normal normal-case tracking-normal text-foreground" />
                </label>
              </div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Review Notes
                <textarea rows={2} value={findingNotes} onChange={(e) => setFindingNotes(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs font-normal normal-case tracking-normal text-foreground" />
              </label>
              <div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
                TES detects differences in facts; TES does not infer dishonesty, intent, competence, or character from a discrepancy.
              </div>
              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <button type="button" onClick={() => setIsFindingModalOpen(false)} className="rounded-xl border border-border px-4 py-2 font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
                <button type="submit" className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground hover:bg-primary/90">Record Finding</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Determination Modal */}
      {isDeterminationModalOpen && activeApplication && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Record Application Determination</h3>
              <button
                type="button"
                onClick={() => setIsDeterminationModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            <p className="text-muted-foreground">
              Record the company’s hiring decision for Application <strong>{activeApplication.id}</strong>.
            </p>

            {determinationError && (
              <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                {determinationError}
              </div>
            )}

            <form onSubmit={handleSaveDetermination} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Decision Outcome *
                </label>
                <select
                  value={determinationDecision}
                  onChange={(e) => setDeterminationDecision(e.target.value as any)}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 font-bold mt-1"
                >
                  <option value="Approved">Approved for Commercial Driving</option>
                  <option value="Rejected">Rejected / Disqualified</option>
                  <option value="Withdrawn">Application Withdrawn</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Reviewer / Authorized Officer *
                </label>
                <input
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  placeholder="e.g. Authorized Safety Official"
                  required
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Reviewer Notes & Rationale
                </label>
                <textarea
                  rows={3}
                  value={determinationNotes}
                  onChange={(e) => setDeterminationNotes(e.target.value)}
                  placeholder="e.g. MVR clean, confirmed reefer experience, road test passed with zero defects."
                  className="w-full rounded-xl border border-border bg-background p-2.5 mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsDeterminationModalOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 font-semibold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
                >
                  Commit Determination
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Explicit Onboarding Signer Modal */}
      {signingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Sign Document Acknowledgement</h3>
              <button
                type="button"
                onClick={() => setSigningItem(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            <p className="text-muted-foreground">
              Execute formal signature acknowledgement for: <strong className="text-foreground">{signingItem.title}</strong>
            </p>

            {signerError && (
              <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                {signerError}
              </div>
            )}

            <form onSubmit={handleConfirmSign} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Signer Full Legal Name *
                </label>
                <input
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="e.g. Legal Name of Driver or Authorized Signer"
                  required
                  autoFocus
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setSigningItem(null)}
                  className="rounded-xl border border-border px-4 py-2 font-semibold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
                >
                  Sign & Acknowledge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}