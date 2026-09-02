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
  DriverPerformanceEvent,
  DriverEvidenceItem,
  LicenceRecord,
  HOSReview,
  CompanyActionRecord,
  CompanyDetermination,
} from "../../types";
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
  addDriverLicence,
  addScreeningRecord,
  archiveScreeningRecord,
  addTrainingRecord,
  waiveTrainingRecord,
  addPerformanceEvent,
  updatePerformanceEvent,
  addHOSReview,
  addCompanyAction,
  addCompanyDetermination,
} from "../../lib/driver-data";

export interface DriverWorkspaceProps {
  master: DriverMaster;
  relationship: CompanyDriverRelationship;
  company: CanonicalCompany;
  applications: DriverApplicationRecord[];
  hiringPackages: HiringPackageRecord[];
  taxDocs: DriverTaxDocRecord[];
  screenings: ScreeningRecord[];
  trainings: TrainingRecord[];
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
    addDriverLicence(master.id, licenceData);
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
    setIsSourcePickerOpen(false);
    // Demonstration camera scan capture
    setOcrReviewData({
      docName: "Driver_Licence_Camera_Capture.png",
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    });
  };

  const handleConfirmOCR = (extractedValues: any) => {
    if (extractedValues.licenceNumber) {
      handleAddLicence({
        licenceNumber: extractedValues.licenceNumber,
        licenceNumberRaw: extractedValues.licenceNumber,
        jurisdiction: extractedValues.jurisdiction || "ON",
        country: "Canada",
        class: extractedValues.class || "",
        endorsements: ["Air Brake (Z)"],
        restrictions: [],
        airBrakeQualified: true,
        expiryDate: extractedValues.expiryDate,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        verificationState: "Document Verified",
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
            onAddApplication={() => {}}
            onAddHiringPackage={() => {}}
            onAddTaxDoc={() => {}}
            onOpenEvidence={(item) => setViewingDoc(item)}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === "screening" && (
          <DriverScreeningTab
            master={master}
            screenings={screenings}
            onAddScreening={handleAddScreening}
            onArchiveScreening={handleArchiveScreening}
            onOpenEvidence={(id) => {}}
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
            onOpenDocument={(id) => {}}
          />
        )}
      </div>

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
          overallConfidence={94}
          initialValues={{
            licenceNumber: "K1029-48201-92810",
            jurisdiction: "ON",
            class: "Class A / AZ",
            expiryDate: "2027-04-12",
          }}
          fieldConfidence={{
            licenceNumber: 98,
            jurisdiction: 95,
            class: 92,
            expiryDate: 88,
          }}
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
