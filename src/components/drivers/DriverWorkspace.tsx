import React, { useState } from "react";
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
import { DriverHeader } from "./DriverHeader";
import { DriverProfileTab } from "./DriverProfileTab";
import { DriverQualificationsTab } from "./DriverQualificationsTab";
import { DriverDocumentsTab } from "./DriverDocumentsTab";
import { DriverScreeningTab } from "./DriverScreeningTab";
import { DriverTrainingTab } from "./DriverTrainingTab";
import { DriverPerformanceTab } from "./DriverPerformanceTab";
import { SecureDocumentViewer } from "../shared/SecureDocumentViewer";
import { DocumentSourcePicker } from "../shared/DocumentSourcePicker";
import { OCRReview } from "../shared/OCRReview";
import { UnsavedChangesPrompt } from "../shared/UnsavedChangesPrompt";
import {
  updateDriverMasterIdentity,
  updateCompanyDriverRelationship,
  addDriverAddress,
  addLicence,
  addDriverApplication,
  addHiringPackage,
  addDriverTaxDoc,
  addScreeningRecord,
  archiveScreeningRecord,
  addTrainingRecord,
  addTrainingRequirement,
  waiveTrainingRecord,
  addPerformanceEvent,
  updatePerformanceEvent,
  addHOSReview,
  addCompanyAction,
  addCompanyDetermination,
} from "@/lib/driver-data";

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
  allDriversCohort?: {
    master: DriverMaster;
    relationship: CompanyDriverRelationship;
    events: DriverPerformanceEvent[];
    trainings: TrainingRecord[];
  }[];
  onBack: () => void;
  onRefresh: () => void;
}

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
  allDriversCohort = [],
  onBack,
  onRefresh,
}: DriverWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<string>("profile");
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // Modals
  const [viewingDoc, setViewingDoc] = useState<DriverEvidenceItem | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isAddApplicationOpen, setIsAddApplicationOpen] = useState(false);
  const [isAddHiringPackageOpen, setIsAddHiringPackageOpen] = useState(false);
  const [isAddTaxDocOpen, setIsAddTaxDocOpen] = useState(false);
  const [applicationType, setApplicationType] = useState<DriverApplicationRecord["applicationType"]>("Full Driver Employment");
  const [applicationRegion, setApplicationRegion] = useState<DriverApplicationRecord["operatingRegion"]>(relationship.operatingRegion);
  const [packageVersion, setPackageVersion] = useState("");
  const [packageNotes, setPackageNotes] = useState("");
  const [taxFormType, setTaxFormType] = useState<DriverTaxDocRecord["formType"]>("TD1 Federal");
  const [taxYear, setTaxYear] = useState("");
  const [taxJurisdiction, setTaxJurisdiction] = useState("");
  const [taxEffectiveDate, setTaxEffectiveDate] = useState("");
  const [taxStatus, setTaxStatus] = useState<DriverTaxDocRecord["status"]>("Pending");
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [ocrReviewData, setOcrReviewData] = useState<{
    docName: string;
    dataUrl: string;
  } | null>(null);

  // Quick Action Modals Triggered from Header
  const [triggerAddEvent, setTriggerAddEvent] = useState(false);
  const [triggerAddScreening, setTriggerAddScreening] = useState(false);
  const [triggerAddTraining, setTriggerAddTraining] = useState(false);

  const openReviewsCount = master.jurisdictionReviews?.filter((r) => r.status === "OPEN").length || 0;

  const handleOpenEvidenceById = (evidenceId: string) => {
    const item = evidence.find((candidate) => candidate.id === evidenceId);
    if (!item) {
      setViewingDoc(null);
      setDocumentError(`Evidence ${evidenceId} could not be resolved from the canonical Driver evidence collection.`);
      return;
    }
    if (!item.dataUrl || !item.mimeType) {
      setViewingDoc(null);
      setDocumentError(`Evidence ${evidenceId} is present, but its document payload is unavailable for viewing.`);
      return;
    }
    setDocumentError(null);
    setViewingDoc(item);
  };

  const handleOpenEvidenceItem = (item: DriverEvidenceItem) => {
    if (!item.dataUrl || !item.mimeType) {
      setViewingDoc(null);
      setDocumentError(`Evidence ${item.id} is present, but its document payload is unavailable for viewing.`);
      return;
    }
    setDocumentError(null);
    setViewingDoc(item);
  };

  const handleCreateApplication = () => {
    setCreationError(null);
    try {
      addDriverApplication(company.id, master.id, {
        companyDriverRelationshipId: relationship.id,
        applicationType,
        status: "Draft",
        operatingRegion: applicationRegion,
        createdDate: new Date().toISOString().slice(0, 10),
        evidenceIds: [],
      });
      setIsAddApplicationOpen(false);
      onRefresh();
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : "Unable to create the Driver Application record.");
    }
  };

  const handleCreateHiringPackage = () => {
    setCreationError(null);
    if (!packageVersion.trim()) {
      setCreationError("Package version is required.");
      return;
    }
    try {
      addHiringPackage(company.id, master.id, {
        companyDriverRelationshipId: relationship.id,
        packageVersion: packageVersion.trim(),
        issuedDate: new Date().toISOString().slice(0, 10),
        status: "Issued / In Progress",
        items: [],
        evidenceIds: [],
        notes: packageNotes.trim() || undefined,
      });
      setPackageVersion("");
      setPackageNotes("");
      setIsAddHiringPackageOpen(false);
      onRefresh();
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : "Unable to create the Hiring Package record.");
    }
  };

  const handleCreateTaxDoc = () => {
    setCreationError(null);
    if (!taxYear.trim() || !taxJurisdiction.trim() || !taxEffectiveDate) {
      setCreationError("Tax year, jurisdiction, and effective date are required.");
      return;
    }
    try {
      addDriverTaxDoc(company.id, master.id, {
        formType: taxFormType,
        taxYear: taxYear.trim(),
        jurisdiction: taxJurisdiction.trim(),
        effectiveDate: taxEffectiveDate,
        status: taxStatus,
      });
      setTaxYear("");
      setTaxJurisdiction("");
      setTaxEffectiveDate("");
      setTaxStatus("Pending");
      setIsAddTaxDocOpen(false);
      onRefresh();
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : "Unable to create the Driver tax document record.");
    }
  };

  // Handlers for Profile Tab
  const handleSaveMasterIdentity = (patch: Partial<DriverMaster["identity"]>) => {
    updateDriverMasterIdentity(master.id, patch);
    setIsEditingProfile(false);
    onRefresh();
  };

  const handleSaveRelationship = (patch: Partial<CompanyDriverRelationship>) => {
    updateCompanyDriverRelationship(company.id, relationship.id, patch);
    setIsEditingProfile(false);
    onRefresh();
  };

  const handleSaveAddress = (addr: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    stateProvince: string;
    postalZip: string;
    country: "Canada" | "United States";
    effectiveFrom: string;
  }) => {
    addDriverAddress(master.id, addr);
    setIsEditingProfile(false);
    onRefresh();
  };

  // Handlers for Qualifications Tab
  const handleAddLicence = (licenceData: Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo">) => {
    addLicence(company.id, master.id, licenceData);
    onRefresh();
  };

  // Handlers for Screening Tab
  const handleAddScreening = (data: Omit<ScreeningRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    addScreeningRecord(company.id, master.id, data);
    onRefresh();
  };

  const handleArchiveScreening = (id: string) => {
    archiveScreeningRecord(company.id, id);
    onRefresh();
  };

  // Handlers for Training Tab
  const handleAddTraining = (data: Omit<TrainingRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    addTrainingRecord(company.id, master.id, data);
    onRefresh();
  };

  const handleAddTrainingRequirement = (data: Omit<TrainingRequirement, "requirementId" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    addTrainingRequirement(company.id, master.id, data);
    onRefresh();
  };

  const handleWaiveTraining = (id: string, reason: string) => {
    waiveTrainingRecord(company.id, id, reason);
    onRefresh();
  };

  // Handlers for Performance Tab
  const handleAddEvent = (data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    addPerformanceEvent(company.id, master.id, data);
    onRefresh();
  };

  const handleUpdateEvent = (eventId: string, patch: Partial<DriverPerformanceEvent>) => {
    updatePerformanceEvent(company.id, eventId, patch);
    onRefresh();
  };

  const handleAddHOSReview = (reviewData: Omit<HOSReview, "id" | "createdAt" | "updatedAt">) => {
    addHOSReview(company.id, reviewData);
    onRefresh();
  };

  const handleAddCompanyAction = (actionData: Omit<CompanyActionRecord, "id" | "createdAt" | "updatedAt" | "isArchived">) => {
    addCompanyAction(company.id, actionData);
    onRefresh();
  };

  const handleAddCompanyDetermination = (determination: Omit<CompanyDetermination, "id" | "createdAt" | "updatedAt" | "isArchived">) => {
    addCompanyDetermination(company.id, determination);
    onRefresh();
  };

  // OCR Processing
  const handleSelectFile = (file: File) => {
    setIsSourcePickerOpen(false);
    const reader = new FileReader();
    reader.onload = () => {
      setOcrReviewData({
        docName: file.name,
        dataUrl: String(reader.result || ""),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSelectCamera = () => {
    // Camera capture is intentionally not simulated in Phase 1. The shared picker can be
    // wired to a real capture source in the UI phase; no placeholder evidence is created.
    setIsSourcePickerOpen(false);
  };

  const handleConfirmOCR = (extractedValues: any) => {
    // OCR extraction is a source fact only. Do not invent jurisdiction, country,
    // qualification, verification, or effective dates when the document did not supply them.
    if (extractedValues.licenceNumber && extractedValues.jurisdiction && extractedValues.country && extractedValues.effectiveFrom) {
      handleAddLicence({
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
        verificationState: "OCR Extracted",
        source: "OCR Document Extraction",
      });
    }
    setOcrReviewData(null);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Driver Workspace Header */}
      <DriverHeader
        master={master}
        relationship={relationship}
        company={company}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setIsEditingProfile(false);
          setActiveTab(tab);
        }}
        onBack={onBack}
        onEditProfile={() => setIsEditingProfile(true)}
        onAddEvent={() => {
          setActiveTab("performance");
          setTriggerAddEvent(true);
        }}
        onAddScreening={() => {
          setActiveTab("screening");
          setTriggerAddScreening(true);
        }}
        onAddTraining={() => {
          setActiveTab("training");
          setTriggerAddTraining(true);
        }}
        onAddDocument={() => setIsSourcePickerOpen(true)}
        openReviewsCount={openReviewsCount}
      />

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
            onSaveMaster={handleSaveMasterIdentity}
            onSaveRelationship={handleSaveRelationship}
            onSaveAddress={handleSaveAddress}
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
            requirements={trainingRequirements}
            onAddTraining={handleAddTraining}
            onAddRequirement={handleAddTrainingRequirement}
            onWaiveTraining={handleWaiveTraining}
          />
        )}

        {activeTab === "performance" && (
          <DriverPerformanceTab
            master={master}
            relationship={relationship}
            events={events}
            trainings={trainings}
            hosReviews={hosReviews}
            companyActions={companyActions}
            companyDeterminations={companyDeterminations}
            allDriversCohort={allDriversCohort}
            onAddEvent={handleAddEvent}
            onUpdateEvent={handleUpdateEvent}
            onAddHOSReview={handleAddHOSReview}
            onAddCompanyAction={handleAddCompanyAction}
            onAddCompanyDetermination={handleAddCompanyDetermination}
            onOpenDocument={handleOpenEvidenceById}
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
              <div><h3 className="text-base font-bold">New Driver Application</h3><p className="text-xs text-muted-foreground">Creates a Draft application without applicant claims.</p></div>
              <button type="button" onClick={() => setIsAddApplicationOpen(false)} className="text-muted-foreground">✕</button>
            </div>
            <div className="space-y-3 text-xs">
              <label className="block"><span className="font-bold text-muted-foreground">Application Type</span><select value={applicationType} onChange={(e) => setApplicationType(e.target.value as DriverApplicationRecord["applicationType"])} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3">
                <option>Full Driver Employment</option><option>Owner-Operator Lease</option><option>Temporary / Seasonal</option>
              </select></label>
              <label className="block"><span className="font-bold text-muted-foreground">Operating Region</span><select value={applicationRegion} onChange={(e) => setApplicationRegion(e.target.value as DriverApplicationRecord["operatingRegion"])} className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3">
                <option>Canada</option><option>United States</option><option>Cross-Border</option>
              </select></label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setIsAddApplicationOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Cancel</button><button type="button" onClick={handleCreateApplication} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">Create Draft Application</button></div>
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
          <div className="w-full max-w-4xl h-[85vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
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
            <div className="flex-1 p-3 min-h-0">
              <SecureDocumentViewer
                fileName={viewingDoc.fileName}
                mimeType={viewingDoc.mimeType}
                dataUrl={viewingDoc.dataUrl}
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
          onClose={() => setIsSourcePickerOpen(false)}
          onSelectFile={handleSelectFile}
          onSelectCamera={handleSelectCamera}
          title="Ingest Driver Document or Licence"
          subtitle="Scan or upload a commercial driver licence, medical certificate, or inspection document."
        />
      )}

      {/* OCR Split-Screen Review Modal */}
      {ocrReviewData && (
        <OCRReview
          documentName={ocrReviewData.docName}
          documentDataUrl={ocrReviewData.dataUrl}
          overallConfidence={0}
          initialValues={{}}
          fieldConfidence={{}}
          fieldDefinitions={[
            { key: "licenceNumber", label: "Commercial Licence Number", required: true },
            { key: "jurisdiction", label: "Issuing Jurisdiction", required: true },
            { key: "class", label: "Commercial Class", required: true },
            { key: "expiryDate", label: "Licence Expiry Date", type: "date", required: true },
          ]}
          onConfirm={handleConfirmOCR}
          onCancel={() => setOcrReviewData(null)}
        />
      )}
    </div>
  );
}
