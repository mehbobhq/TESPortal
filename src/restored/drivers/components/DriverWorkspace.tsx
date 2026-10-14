import React, { useEffect, useState } from "react";
import {
  DriverMaster,
  CompanyDriverRelationship,
  CanonicalCompany,
  DriverApplicationRecord,
  HiringPackageRecord,
  DriverTaxDocRecord,
  ScreeningRecord,
  TrainingRecord,
  TrainingRequirement,
  DriverPerformanceEvent,
  DriverEvidenceItem,
  LicenceRecord,
  HOSReview,
  CompanyActionRecord,
  CompanyDetermination,
} from "@/types/drivers";
import { DriverHeader, DRIVER_TABS } from "./DriverHeader";
import { getQueryParam, pushHistoryQueryParams } from "@/lib/deep-linking";
import { DriverProfileTab } from "./DriverProfileTab";
import { DriverQualificationsTab } from "./DriverQualificationsTab";
import { DriverDocumentsTab } from "./DriverDocumentsTab";
import { DriverEvaluationTab } from "./DriverEvaluationTab";
import { DriverScreeningTab } from "./DriverScreeningTab";
import { DriverTrainingTab } from "./DriverTrainingTab";
import { DriverPerformanceTab } from "./DriverPerformanceTab";
import { SecureDocumentViewer } from "../shared/SecureDocumentViewer";
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker";
import { OCRReview } from "../shared/OCRReview";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import { isUnavailable, userMessage } from "@/lib/canonical-ui/unavailable";
import {
  addDriverApplication,
  addHiringPackage,
  addDriverTaxDoc,
  addTrainingRecord,
  addTrainingRequirement,
  waiveTrainingRecord,
  addManualPerformanceEvent,
  addDriverEvidence,
  updatePerformanceEventWorkflow,
  linkPerformanceEventDetermination,
  archivePerformanceEvent,
  addHOSReview,
  addCompanyAction,
  resolveNearMissUnsafeConditionForEvent,
  applyPerformanceEngineWrite,
  addCompanyDetermination,
  assessDriverHiringFile,
} from "../driver-data";
import { addLicence, addScreening, archiveScreening, saveProfile, type ProfileEdit } from "../actions";

export interface DriverWorkspaceProps {
  master: DriverMaster;
  relationship: CompanyDriverRelationship;
  company: CanonicalCompany;
  applications: DriverApplicationRecord[];
  hiringPackages: HiringPackageRecord[];
  taxDocs: DriverTaxDocRecord[];
  screenings: ScreeningRecord[];
  trainings: TrainingRecord[];
  trainingRequirements: TrainingRequirement[];
  events: DriverPerformanceEvent[];
  evidence: DriverEvidenceItem[];
  hosReviews?: HOSReview[];
  companyActions?: CompanyActionRecord[];
  companyDeterminations?: CompanyDetermination[];
  performanceInvestigations?: import("@/types/drivers").PerformanceInvestigationRecord[];
  eventRelationships?: import("@/types/drivers").PerformanceEventRelationship[];
  allDriversCohort?: {
    master: DriverMaster;
    relationship: CompanyDriverRelationship;
    events: DriverPerformanceEvent[];
    trainings: TrainingRecord[];
  }[];
  onBack: () => void;
  /** Re-reads the canonical record after a save. */
  onRefresh: () => void | Promise<void>;
}

type Notice = { tone: "success" | "error" | "unavailable"; title: string; message: string };

export function DriverWorkspace({
  master,
  relationship,
  company,
  applications,
  hiringPackages,
  taxDocs,
  screenings,
  trainings,
  trainingRequirements,
  events,
  evidence,
  hosReviews = [],
  companyActions = [],
  companyDeterminations = [],
  performanceInvestigations = [],
  eventRelationships = [],
  allDriversCohort = [],
  onBack,
  onRefresh,
}: DriverWorkspaceProps) {
  type DriverTab = (typeof DRIVER_TABS)[number]["id"];
  const resolveDriverTab = (): DriverTab => {
    if (getQueryParam("performanceView")) return "performance";
    const requested = getQueryParam("driverTab");
    return DRIVER_TABS.some((tab) => tab.id === requested) ? (requested as DriverTab) : "profile";
  };

  const [activeTab, setActiveTab] = useState<DriverTab>(resolveDriverTab);

  useEffect(() => {
    const syncDriverRoute = () => setActiveTab(resolveDriverTab());
    syncDriverRoute();
    window.addEventListener("popstate", syncDriverRoute);
    return () => window.removeEventListener("popstate", syncDriverRoute);
  }, []);

  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // Modals
  const [viewingDoc, setViewingDoc] = useState<DriverEvidenceItem | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isAddApplicationOpen, setIsAddApplicationOpen] = useState(false);
  const [isAddHiringPackageOpen, setIsAddHiringPackageOpen] = useState(false);
  const [isAddTaxDocOpen, setIsAddTaxDocOpen] = useState(false);
  const [applicationType, setApplicationType] = useState<DriverApplicationRecord["applicationType"]>("Full Driver Employment");
  const [applicationRegion, setApplicationRegion] = useState<DriverApplicationRecord["operatingRegion"]>(relationship.operatingRegion);
  const [applicationRecipientEmail, setApplicationRecipientEmail] = useState(master.identity.email || "");
  const [isSendingApplication, setIsSendingApplication] = useState(false);
  const [packageVersion, setPackageVersion] = useState("");
  const [packageNotes, setPackageNotes] = useState("");
  const [taxFormType, setTaxFormType] = useState<DriverTaxDocRecord["formType"]>("TD1 Federal");
  const [taxYear, setTaxYear] = useState("");
  const [taxJurisdiction, setTaxJurisdiction] = useState("");
  const [taxEffectiveDate, setTaxEffectiveDate] = useState("");
  const [taxStatus, setTaxStatus] = useState<DriverTaxDocRecord["status"]>("Pending");
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [eventEvidenceMode, setEventEvidenceMode] = useState(false);
  const [performanceSourceMode, setPerformanceSourceMode] = useState(false);
  const [eventEvidenceCreatedId, setEventEvidenceCreatedId] = useState<string | null>(null);
  const [openAddEventModalSignal] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ocrReviewData, setOcrReviewData] = useState<{
    docName: string;
    mimeType: string;
    dataUrl: string;
  } | null>(null);

  // Quick Action Modals Triggered from Header
  const [triggerAddEvent, setTriggerAddEvent] = useState(false);
  const [triggerAddScreening, setTriggerAddScreening] = useState(false);
  const [triggerAddTraining, setTriggerAddTraining] = useState(false);

  useEffect(() => {
    setApplicationRecipientEmail(master.identity.email || "");
  }, [master.identity.email]);

  const openReviewsCount = master.jurisdictionReviews?.filter((r) => r.status === "OPEN").length || 0;

  const hiringAssessment = assessDriverHiringFile(company.id, master.id, company, relationship, { applications, hiringPackages, screenings });

  /**
   * Runs a canonical (or refusing) action. The error is shown in the notice banner AND re-thrown so a form that called the action
   * stays open instead of closing as if the change had been saved. Success notices carry what was NOT recorded.
   */
  const run = async (title: string, work: () => Promise<string[] | void>): Promise<void> => {
    try {
      const messages = (await work()) || [];
      await onRefresh();
      if (messages.length) setNotice({ tone: "success", title, message: messages.join(" ") });
    } catch (error) {
      setNotice({ tone: isUnavailable(error) ? "unavailable" : "error", title: isUnavailable(error) ? `${title}: not available yet` : `${title}: not saved`, message: userMessage(error) });
      throw error;
    }
  };
  const runQuietly = (title: string, work: () => Promise<string[] | void>): void => {
    run(title, work).catch(() => undefined);
  };
  /** A synchronous refusing action (record families with no canonical home): reports it and re-throws so the form stays open. */
  const refuse = <T,>(title: string, work: () => T): T => {
    try {
      return work();
    } catch (error) {
      setNotice({ tone: isUnavailable(error) ? "unavailable" : "error", title: isUnavailable(error) ? `${title}: not available yet` : `${title}: not saved`, message: userMessage(error) });
      throw error;
    }
  };

  const handleHiringWorkflowAction = () => {
    switch (hiringAssessment.nextAction) {
      case "SEND_APPLICATION":
      case "CONTINUE_APPLICATION":
        setActiveTab("documents");
        pushHistoryQueryParams({ driverTab: "documents", performanceView: null });
        if (hiringAssessment.nextAction === "SEND_APPLICATION") {
          setCreationError(null);
          setIsAddApplicationOpen(true);
        }
        return;
      case "COMPLETE_REFERENCE_CHECKS":
        setActiveTab("screening");
        pushHistoryQueryParams({ driverTab: "screening", performanceView: null });
        setTriggerAddScreening(true);
        return;
      case "COMPLETE_HIRING_PACKAGE":
        setActiveTab("documents");
        pushHistoryQueryParams({ driverTab: "documents", performanceView: null });
        setCreationError(null);
        setIsAddHiringPackageOpen(true);
        return;
      default:
        return;
    }
  };

  const handleOpenEvidenceById = (evidenceId: string) => {
    const item = evidence.find((candidate) => candidate.id === evidenceId);
    if (!item || !item.dataUrl || !item.mimeType) {
      setViewingDoc(null);
      setDocumentError(`Evidence ${evidenceId} is not available: driver evidence has no canonical storage yet, so no document can be shown.`);
      return;
    }
    setDocumentError(null);
    setViewingDoc(item);
  };

  const handleOpenEvidenceItem = (item: DriverEvidenceItem) => handleOpenEvidenceById(item.id);

  const handleCreateApplication = async () => {
    setCreationError(null);
    const recipientEmail = applicationRecipientEmail.trim().toLowerCase();
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      setCreationError("A valid Driver email address is required before TES can send the application.");
      return;
    }
    setIsSendingApplication(true);
    try {
      // The original created an "Invitation Ready" record and emailed through Resend. Driver applications have no canonical domain,
      // so the record cannot be created and NOTHING is sent.
      addDriverApplication(company.id, master.id, { applicationType, operatingRegion: applicationRegion, invitationRecipientEmail: recipientEmail });
    } catch (error) {
      setCreationError(userMessage(error));
    } finally {
      setIsSendingApplication(false);
    }
  };

  const handleCreateHiringPackage = () => {
    setCreationError(null);
    if (!packageVersion.trim()) {
      setCreationError("Package version is required.");
      return;
    }
    try {
      addHiringPackage(company.id, master.id, { packageVersion: packageVersion.trim(), notes: packageNotes.trim() || undefined });
    } catch (error) {
      setCreationError(userMessage(error));
    }
  };

  const handleCreateTaxDoc = () => {
    setCreationError(null);
    if (!taxYear.trim() || !taxJurisdiction.trim() || !taxEffectiveDate) {
      setCreationError("Tax year, jurisdiction, and effective date are required.");
      return;
    }
    try {
      addDriverTaxDoc(company.id, master.id, { formType: taxFormType, taxYear: taxYear.trim(), jurisdiction: taxJurisdiction.trim(), effectiveDate: taxEffectiveDate, status: taxStatus });
    } catch (error) {
      setCreationError(userMessage(error));
    }
  };

  // Handlers for Profile Tab (canonical: name, email, phone, relationship type / status / driver number / end)
  const handleSaveProfile = (edit: ProfileEdit) => run("Driver profile", () => saveProfile(company.id, master, relationship, edit));

  // Handlers for Qualifications Tab (canonical: licences)
  const handleAddLicence = (licenceData: Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo">) => run("Driver licence", () => addLicence(company.id, master, licenceData));

  // Handlers for Screening Tab (canonical: medical qualification periods only)
  const handleAddScreening = (data: Omit<ScreeningRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => run("Screening record", () => addScreening(company.id, master, screenings, data));
  const handleArchiveScreening = (id: string) => runQuietly("Archive screening record", () => archiveScreening(company.id, master, screenings, id));

  // Handlers for Training Tab (no canonical domain: refuse and keep the form open)
  const handleAddTraining = (data: Omit<TrainingRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => refuse("Training record", () => addTrainingRecord(company.id, master.id, data));
  const handleAddTrainingRequirement = (data: Omit<TrainingRequirement, "requirementId" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => refuse("Training requirement", () => addTrainingRequirement(company.id, master.id, data));
  const handleWaiveTraining = (id: string, reason: string) => refuse("Waive training", () => waiveTrainingRecord(company.id, id, reason));

  // Handlers for Performance Tab (no canonical domain)
  const handleAddEvent = (data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    refuse("Performance event", () => addManualPerformanceEvent(company.id, master.id, data));
    setEventEvidenceCreatedId(null);
  };
  const handleUpdateEventWorkflow = (eventId: string, update: Parameters<typeof updatePerformanceEventWorkflow>[2]) => refuse("Performance event update", () => updatePerformanceEventWorkflow(company.id, eventId, update));
  const handleArchiveEvent = (eventId: string) => refuse("Archive performance event", () => archivePerformanceEvent(company.id, eventId));
  const handleLinkCompanyDetermination = (eventId: string, determinationId: string) => refuse("Link company determination", () => linkPerformanceEventDetermination(company.id, eventId, determinationId));
  const handleAddHOSReview = (reviewData: Omit<HOSReview, "id" | "createdAt" | "updatedAt">) => refuse("Hours-of-service review", () => addHOSReview(company.id, reviewData));
  const handleAddCompanyAction = (actionData: Omit<CompanyActionRecord, "id" | "createdAt" | "updatedAt" | "isArchived">) => refuse("Company action", () => addCompanyAction(company.id, actionData));
  const handleAddCompanyDetermination = (determination: Omit<CompanyDetermination, "id" | "createdAt" | "updatedAt" | "isArchived">) => refuse("Company determination", () => addCompanyDetermination(company.id, determination));

  const handleRequestPerformanceSourceUpload = () => {
    setEventEvidenceCreatedId(null);
    setEventEvidenceMode(false);
    setPerformanceSourceMode(true);
    setIsSourcePickerOpen(true);
  };

  const handleRequestEventEvidenceUpload = () => {
    setEventEvidenceCreatedId(null);
    setEventEvidenceMode(true);
    setPerformanceSourceMode(false);
    setIsSourcePickerOpen(true);
  };

  // Document intake. Performance / event evidence cannot be stored (no canonical driver evidence target); a licence document is
  // reviewed on screen and its values keyed into the canonical licence, but the document itself is NOT stored.
  const handleSelectFile = (file: File) => {
    if (eventEvidenceMode || performanceSourceMode) {
      setIsSourcePickerOpen(false);
      setEventEvidenceMode(false);
      setPerformanceSourceMode(false);
      try {
        addDriverEvidence(company.id, master.id, { fileName: file.name, mimeType: file.type, dataUrl: "", documentType: "Performance Source Document" });
      } catch (error) {
        setNotice({ tone: "unavailable", title: "Attach evidence: not available yet", message: `${userMessage(error)} "${file.name}" was not uploaded or processed.` });
      }
      return;
    }
    setIsSourcePickerOpen(false);
    const reader = new FileReader();
    reader.onload = () => {
      setOcrReviewData({ docName: file.name, mimeType: file.type || "application/octet-stream", dataUrl: String(reader.result || "") });
    };
    reader.readAsDataURL(file);
  };

  const handleSelectCamera = () => {
    // Camera capture is intentionally not simulated; no placeholder evidence is created.
    setEventEvidenceMode(false);
    setIsSourcePickerOpen(false);
  };

  const handleConfirmOCR = (extractedValues: any) => {
    // The review values are keyed by a person: nothing is invented. Only the licence fields have a canonical home, and the
    // reviewed document itself is NOT stored (no canonical driver evidence target), which the notice says.
    if (extractedValues.licenceNumber && extractedValues.jurisdiction && extractedValues.country && extractedValues.effectiveFrom) {
      run("Driver licence", async () => {
        const messages = await addLicence(company.id, master, {
          licenceNumber: extractedValues.licenceNumber,
          licenceNumberRaw: extractedValues.licenceNumber,
          jurisdiction: extractedValues.jurisdiction,
          country: extractedValues.country,
          class: extractedValues.class || undefined,
          endorsements: Array.isArray(extractedValues.endorsements) ? extractedValues.endorsements : undefined,
          restrictions: Array.isArray(extractedValues.restrictions) ? extractedValues.restrictions : undefined,
          airBrakeQualified: typeof extractedValues.airBrakeQualified === "boolean" ? extractedValues.airBrakeQualified : undefined,
          expiryDate: extractedValues.expiryDate || undefined,
          effectiveFrom: extractedValues.effectiveFrom,
          source: "Document review",
        } as Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo">);
        return [...messages, "The reviewed document was not stored (driver evidence has no canonical storage yet)."];
      }).catch(() => undefined);
    } else {
      setNotice({ tone: "unavailable", title: "Licence document review", message: "Licence number, jurisdiction, country and effective date are all required to record a licence. Nothing was saved, and the reviewed document was not stored." });
    }
    setOcrReviewData(null);
  };

  return (
    <div className="space-y-6 pb-12">
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`fixed top-4 right-4 z-[200] max-w-md rounded-lg border px-4 py-3 text-sm shadow-lg flex items-start gap-3 ${
            notice.tone === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : notice.tone === "unavailable"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <div className="min-w-0">
            <p className="font-semibold">{notice.title}</p>
            <p className="mt-0.5 text-xs">{notice.message}</p>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="text-current opacity-60 hover:opacity-100" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {/* Driver Workspace Header */}
      <DriverHeader
        master={master}
        relationship={relationship}
        company={company}
        activeTab={activeTab}
        onTabChange={(tab) => {
          const nextTab = DRIVER_TABS.some((item) => item.id === tab) ? (tab as DriverTab) : "profile";
          setIsEditingProfile(false);
          setActiveTab(nextTab);
          pushHistoryQueryParams({
            driverTab: nextTab,
            performanceView: nextTab === "performance" ? getQueryParam("performanceView") : null,
          });
        }}
        onBack={onBack}
        onEditProfile={() => setIsEditingProfile(true)}
        onAddEvent={() => {
          setActiveTab("performance");
          pushHistoryQueryParams({ driverTab: "performance" });
          setTriggerAddEvent(true);
        }}
        onAddScreening={() => {
          setActiveTab("screening");
          pushHistoryQueryParams({ driverTab: "screening", performanceView: null });
          setTriggerAddScreening(true);
        }}
        onAddTraining={() => {
          setActiveTab("training");
          pushHistoryQueryParams({ driverTab: "training", performanceView: null });
          setTriggerAddTraining(true);
        }}
        onAddDocument={() => setIsSourcePickerOpen(true)}
        openReviewsCount={openReviewsCount}
      />

      {activeTab === "profile" && hiringAssessment.nextAction !== "NONE" && (
        <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Driver Hiring Workflow</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{hiringAssessment.nextActionLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hiringAssessment.isInheritedDriver
                  ? `Existing driver file · TES-managed period begins ${hiringAssessment.tesServiceStartDate || "on the recorded service start date"}. Historical source records remain unchanged.`
                  : "Next required hiring workflow action based on the records currently established in TES."}
              </p>
            </div>
            <button
              type="button"
              onClick={handleHiringWorkflowAction}
              disabled={hiringAssessment.nextAction === "CONTINUE_APPLICATION"}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {hiringAssessment.nextActionLabel}
            </button>
          </div>
        </div>
      )}

      {/* Main Tab Content */}
      <div className="min-h-[450px]">
        {activeTab === "profile" && (
          <DriverProfileTab
            master={master}
            relationship={relationship}
            company={company}
            isEditing={isEditingProfile}
            onStartEdit={() => setIsEditingProfile(true)}
            onCancelEdit={() => setIsEditingProfile(false)}
            onSaveProfile={handleSaveProfile}
          />
        )}

        {activeTab === "qualifications" && (
          <DriverQualificationsTab
            master={master}
            onAddLicence={handleAddLicence}
            onStartOCR={() => setIsSourcePickerOpen(true)}
          />
        )}

        {activeTab === "documents" && (
          <DriverDocumentsTab
            master={master}
            relationship={relationship}
            company={company}
            applications={applications}
            hiringPackages={hiringPackages}
            taxDocs={taxDocs}
            evidence={evidence}
            onAddApplication={() => { setCreationError(null); setIsAddApplicationOpen(true); }}
            onAddHiringPackage={() => { setCreationError(null); setIsAddHiringPackageOpen(true); }}
            onAddTaxDoc={() => { setCreationError(null); setIsAddTaxDocOpen(true); }}
            onOpenEvidence={handleOpenEvidenceItem}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === "evaluation" && (
          <DriverEvaluationTab companyId={company.id} applications={applications} />
        )}

        {activeTab === "screening" && (
          <DriverScreeningTab
            master={master}
            screenings={screenings}
            onAddScreening={handleAddScreening}
            onArchiveScreening={handleArchiveScreening}
            onOpenEvidence={handleOpenEvidenceById}
          />
        )}

        {activeTab === "training" && (
          <DriverTrainingTab
            master={master}
            trainings={trainings}
            onAddTraining={handleAddTraining}
            onWaiveTraining={handleWaiveTraining}
          />
        )}

        {activeTab === "performance" && (
          <DriverPerformanceTab
            master={master}
            relationship={relationship}
            companyRegJurisdiction={company.regCorpState || ""}
            events={events}
            trainings={trainings}
            hosReviews={hosReviews}
            companyActions={companyActions}
            companyDeterminations={companyDeterminations}
            performanceInvestigations={performanceInvestigations}
            eventRelationships={eventRelationships}
            onEngineWrite={(eventId, description, writer) => { refuse("Save performance record", () => applyPerformanceEngineWrite(company.id, eventId, description, writer)); }}
            onResolveNearMissUnsafeCondition={(eventId, input) => { refuse("Resolve unsafe condition", () => resolveNearMissUnsafeConditionForEvent(company.id, eventId, input)); }}
            allDriversCohort={allDriversCohort}
            onAddEvent={handleAddEvent}
            onUpdateEventWorkflow={handleUpdateEventWorkflow}
            onRoadsideChange={onRefresh}
            onAddHOSReview={handleAddHOSReview}
            onAddCompanyAction={handleAddCompanyAction}
            onAddCompanyDetermination={handleAddCompanyDetermination}
            onLinkCompanyDetermination={handleLinkCompanyDetermination}
            onOpenDocument={handleOpenEvidenceById}
            evidence={evidence}
            onRequestEvidenceUpload={handleRequestEventEvidenceUpload}
            onRequestPerformanceSourceUpload={handleRequestPerformanceSourceUpload}
            pendingPerformanceSources={[]}
            evidenceCreatedId={eventEvidenceCreatedId}
            onArchiveEvent={handleArchiveEvent}
            onClearEvidenceCreatedId={() => { setEventEvidenceCreatedId(null); }}
            machineAcquisitionDraft={null}
            initialMachineAcquisitionDraft={null}
            openAddEventModalSignal={openAddEventModalSignal}
            isProcessingOCR={false}
            ocrError={null}
          />
        )}
      </div>

      {documentError && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-foreground">Document Unavailable</h3>
            <p className="text-xs text-muted-foreground">{documentError}</p>
            <div className="flex justify-end">
              <button type="button" onClick={() => setDocumentError(null)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}

      {creationError && (isAddApplicationOpen || isAddHiringPackageOpen || isAddTaxDocOpen) && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-destructive/30 bg-card p-5 shadow-2xl space-y-3">
            <h3 className="text-sm font-bold text-foreground">Unable to Create Record</h3>
            <p className="text-xs text-muted-foreground">{creationError}</p>
            <button type="button" onClick={() => setCreationError(null)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold">Close</button>
          </div>
        </div>
      )}

      {isAddApplicationOpen && (
        <div className="fixed inset-0 z-[155] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div><h3 className="text-base font-bold">New Driver Application</h3><p className="text-xs text-muted-foreground">Creates and records a TES application invitation without inventing applicant claims.</p></div>
              <button type="button" onClick={() => setIsAddApplicationOpen(false)} className="text-muted-foreground">✕</button>
            </div>
            <div className="space-y-3 text-xs">
              <label className="block"><span className="font-bold text-muted-foreground">Application Type</span><select value={applicationType} onChange={(e) => setApplicationType(e.target.value as DriverApplicationRecord["applicationType"])} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3">
                <option>Full Driver Employment</option><option>Owner-Operator Lease</option><option>Temporary / Seasonal</option>
              </select></label>
              <label className="block"><span className="font-bold text-muted-foreground">Operating Region</span><select value={applicationRegion} onChange={(e) => setApplicationRegion(e.target.value as DriverApplicationRecord["operatingRegion"])} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3">
                <option>Canada</option><option>United States</option><option>Cross-Border</option>
              </select></label>
              <label className="block"><span className="font-bold text-muted-foreground">Driver Email *</span><input type="email" value={applicationRecipientEmail} onChange={(e) => setApplicationRecipientEmail(e.target.value)} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3" placeholder="driver@example.com" autoComplete="email" /><span className="mt-1 block text-[11px] text-muted-foreground">Confirm this address before sending. It becomes the Driver Master email when the invitation is sent.</span></label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setIsAddApplicationOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Cancel</button><button type="button" disabled={isSendingApplication} onClick={handleCreateApplication} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">{isSendingApplication ? "Sending…" : "Send Application"}</button></div>
          </div>
        </div>
      )}

      {isAddHiringPackageOpen && (
        <div className="fixed inset-0 z-[155] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3"><div><h3 className="text-base font-bold">Issue New Hiring Package</h3><p className="text-xs text-muted-foreground">No checklist items are marked complete unless actually established.</p></div><button type="button" onClick={() => setIsAddHiringPackageOpen(false)} className="text-muted-foreground">✕</button></div>
            <div className="space-y-3 text-xs">
              <label className="block"><span className="font-bold text-muted-foreground">Package Version *</span><input value={packageVersion} onChange={(e) => setPackageVersion(e.target.value)} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3" placeholder="Enter existing package version" /></label>
              <label className="block"><span className="font-bold text-muted-foreground">Notes</span><textarea value={packageNotes} onChange={(e) => setPackageNotes(e.target.value)} className="mt-1 w-full min-h-20 rounded-xl border border-border bg-background px-3 py-2" /></label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setIsAddHiringPackageOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Cancel</button><button type="button" onClick={handleCreateHiringPackage} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">Issue Package</button></div>
          </div>
        </div>
      )}

      {isAddTaxDocOpen && (
        <div className="fixed inset-0 z-[155] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3"><div><h3 className="text-base font-bold">Add Tax / Onboarding Record</h3><p className="text-xs text-muted-foreground">Metadata only; no SIN/SSN or tax values are stored here.</p></div><button type="button" onClick={() => setIsAddTaxDocOpen(false)} className="text-muted-foreground">✕</button></div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="col-span-2 block"><span className="font-bold text-muted-foreground">Form Type</span><select value={taxFormType} onChange={(e) => setTaxFormType(e.target.value as DriverTaxDocRecord["formType"])} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3">
                <option>TD1 Federal</option><option>TD1 Provincial</option><option>W-4 Federal</option><option>State Withholding</option><option>W-9 / 1099</option>
              </select></label>
              <label className="block"><span className="font-bold text-muted-foreground">Tax Year *</span><input value={taxYear} onChange={(e) => setTaxYear(e.target.value)} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3" placeholder="YYYY" /></label>
              <label className="block"><span className="font-bold text-muted-foreground">Jurisdiction *</span><input value={taxJurisdiction} onChange={(e) => setTaxJurisdiction(e.target.value)} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3" placeholder="State / Province / Federal" /></label>
              <label className="block"><span className="font-bold text-muted-foreground">Effective Date *</span><input type="date" value={taxEffectiveDate} onChange={(e) => setTaxEffectiveDate(e.target.value)} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3" /></label>
              <label className="block"><span className="font-bold text-muted-foreground">Status</span><select value={taxStatus} onChange={(e) => setTaxStatus(e.target.value as DriverTaxDocRecord["status"])} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3"><option>Pending</option><option>Completed</option><option>Superseded</option></select></label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setIsAddTaxDocOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Cancel</button><button type="button" onClick={handleCreateTaxDoc} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">Add Tax Record</button></div>
          </div>
        </div>
      )}

      {/* Secure Document Viewer Modal */}
      {viewingDoc && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-[96vw] h-[92vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-muted/20">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Forensic Audited Document Viewer
              </h3>
              <button
                type="button"
                onClick={() => setViewingDoc(null)}
                className="text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                ✕ Close
              </button>
            </div>
            <div className="flex-1 p-3 min-h-0 overflow-hidden">
              <SecureDocumentViewer
                fileName={viewingDoc.fileName}
                mimeType={viewingDoc.mimeType as string}
                dataUrl={viewingDoc.dataUrl as string}
                documentTitle={viewingDoc.documentType}
                ocrConfidence={viewingDoc.ocrConfidence}
              />
            </div>
          </div>
        </div>
      )}

      {/* Document Ingestion Picker */}
      {isSourcePickerOpen && (
        <DocumentSourcePicker
          isOpen={isSourcePickerOpen}
          onClose={() => { setIsSourcePickerOpen(false); setEventEvidenceMode(false); setPerformanceSourceMode(false); }}
          onSelectFile={handleSelectFile}
          onSelectCamera={handleSelectCamera}
          title={eventEvidenceMode ? "Attach Performance Event Evidence" : "Ingest Driver Document or Licence"}
          subtitle={eventEvidenceMode ? "Upload source evidence to the canonical Driver evidence collection; it can then be linked to the performance event." : "Scan or upload a commercial driver licence, medical certificate, or inspection document."}
        />
      )}

      {/* OCR Split-Screen Review Modal */}
      {ocrReviewData && (
        <OCRReview
          documentResult={{
            documentId: "",
            documentType: "Driver Licence",
            fileName: ocrReviewData.docName,
            mimeType: ocrReviewData.mimeType,
            pageCount: 1,
            overallConfidence: 0,
            extractedFields: {},
            processedAt: new Date().toISOString(),
          }}
          documentDataUrl={ocrReviewData.dataUrl}
          initialValues={{} as Record<string, unknown>}
          fieldDefinitions={[
            { key: "licenceNumber", label: "Commercial Licence Number", required: true },
            { key: "country", label: "Issuing Country", type: "select", options: [{ label: "Canada", value: "Canada" }, { label: "United States", value: "United States" }], required: true },
            { key: "jurisdiction", label: "Issuing Jurisdiction", required: true },
            { key: "class", label: "Commercial Class", required: true },
            { key: "effectiveFrom", label: "Effective From", type: "date", required: true },
            { key: "expiryDate", label: "Licence Expiry Date", type: "date", required: true },
          ]}
          onConfirm={handleConfirmOCR}
          onCancel={() => setOcrReviewData(null)}
        />
      )}
    </div>
  );
}
