import React, { useEffect, useRef, useState } from "react";
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
  PerformanceSourceIngestionItem,
} from "@/types/drivers";
import { DriverHeader, DRIVER_TABS } from "./DriverHeader";
import { getQueryParam, pushHistoryQueryParams } from "@/lib/deep-linking";
import { DriverProfileTab } from "./DriverProfileTab";
import { DriverQualificationsTab } from "./DriverQualificationsTab";
import { DriverDocumentsTab } from "./DriverDocumentsTab";
import { DriverScreeningTab } from "./DriverScreeningTab";
import { DriverTrainingTab } from "./DriverTrainingTab";
import { DriverPerformanceTab } from "./DriverPerformanceTab";
import { receivePerformanceSourceForMachineProcessing } from "@/lib/driver-performance-ingestion";
import { loadCompanyDriverStore } from "@/lib/driver-data";
import { SecureDocumentViewer } from "../shared/SecureDocumentViewer";
import { DocumentSourcePicker } from "../shared/DocumentSourcePicker";
import { OCRReview } from "../shared/OCRReview";
import { UnsavedChangesPrompt } from "../shared/UnsavedChangesPrompt";
import type { RoadsideMachineSourceRecord } from "@/lib/roadside-machine-schema";
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
  addManualPerformanceEvent,
  addDriverEvidence,
  updatePerformanceEventWorkflow,
  linkPerformanceEventDetermination,
  archivePerformanceEvent,
  addHOSReview,
  addCompanyAction,
  addCompanyDetermination,
} from "@/lib/driver-data";
import { reevaluatePerformanceRelationshipsAfterSourceMutation } from "@/lib/driver-performance-relationship-resolution";
import { getEvidencePayloads, migrateLegacyDriverEvidencePayloads, putEvidencePayload } from "@/lib/evidence-payload-store";
import { logAuditEvent } from "@/lib/audit-log";

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

  useEffect(() => {
    logAuditEvent({
      e: "TAB_CHANGE",
      co: company.id,
      cn: company.name,
      rt: typeof window !== "undefined" ? window.location.pathname : undefined,
      tab: activeTab,
      sf: ({
        screening: ["MEDICAL_CERT", "DRUG_TEST", "MEDICAL_EXPIRY"],
        qualifications: ["LICENCE_NUMBER", "LICENCE_CLASS"],
        documents: ["DRIVER_APPLICATION", "HIRING_PACKAGE"],
        performance: ["ROADSIDE_FINDINGS", "VIOLATIONS"],
        profile: [],
        training: [],
      } as Record<string, string[]>)[activeTab] ?? [],
    });
  }, [activeTab]);
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
  const [eventEvidenceMode, setEventEvidenceMode] = useState(false);
  const [performanceSourceMode, setPerformanceSourceMode] = useState(false);
  const [pendingPerformanceSources, setPendingPerformanceSources] = useState<PerformanceSourceIngestionItem[]>([]);
  const [evidencePayloads, setEvidencePayloads] = useState<Record<string, { dataUrl: string; mimeType: string }>>({});

  useEffect(() => {
    let cancelled = false;

    const hydrateEvidencePayloads = async () => {
      try {
        await migrateLegacyDriverEvidencePayloads(company.id, evidence);
        const stored = await getEvidencePayloads(evidence.map((item) => item.id));
        if (!cancelled) {
          setEvidencePayloads((current) => {
            const next = { ...current };
            for (const [id, payload] of Object.entries(stored)) {
              next[id] = { dataUrl: payload.dataUrl, mimeType: payload.mimeType };
            }
            return next;
          });
        }
      } catch (error) {
        console.error("Unable to hydrate TES evidence payload storage.", error);
      }
    };

    void hydrateEvidencePayloads();
    return () => { cancelled = true; };
  }, [company.id, evidence]);

  const evidenceWithPayloads = evidence.map((item) => {
    const payload = evidencePayloads[item.id];
    return payload ? { ...item, dataUrl: payload.dataUrl, mimeType: payload.mimeType || item.mimeType } : item;
  });

  useEffect(() => {
    setPendingPerformanceSources(loadCompanyDriverStore(company.id).performanceIngestionItems?.filter((item) => item.driverMasterId === master.id) || []);
  }, [company.id, master.id, events.length, evidence.length]);
  const [eventEvidenceCreatedId, setEventEvidenceCreatedId] = useState<string | null>(null);
  const [machineAcquisitionDraft, setMachineAcquisitionDraft] = useState<RoadsideMachineSourceRecord | null>(null);
  const machineAcquisitionDraftRef = useRef<RoadsideMachineSourceRecord | null>(null);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [openAddEventModalSignal, setOpenAddEventModalSignal] = useState(false);
  const [autoSaveNotification, setAutoSaveNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
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
    const item = evidenceWithPayloads.find((candidate) => candidate.id === evidenceId);
    if (!item) {
      const payload = evidencePayloads[evidenceId];
      if (payload) {
        setDocumentError(null);
        setViewingDoc({
          id: evidenceId,
          companyId: company.id,
          driverMasterId: master.id,
          fileName: "Performance Source Document",
          fileType: payload.mimeType,
          mimeType: payload.mimeType,
          documentType: "Performance Source Document",
          uploadedAt: new Date().toISOString(),
          source: "upload",
          dataUrl: payload.dataUrl,
          isArchived: false,
        });
        return;
      }
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
    const hydrated = evidenceWithPayloads.find((candidate) => candidate.id === item.id) || item;
    if (!hydrated.dataUrl || !hydrated.mimeType) {
      setViewingDoc(null);
      setDocumentError(`Evidence ${item.id} is present, but its document payload is unavailable for viewing.`);
      return;
    }
    setDocumentError(null);
    setViewingDoc(hydrated);
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
      logAuditEvent({
        e: "RECORD_CREATED",
        co: company.id,
        cn: company.name,
        eid: master.id,
        el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
        det: `Created Driver Application (${applicationType}).`,
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
      logAuditEvent({
        e: "RECORD_CREATED",
        co: company.id,
        cn: company.name,
        eid: master.id,
        el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
        det: `Created Hiring Package ${packageVersion.trim()}.`,
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
      logAuditEvent({
        e: "RECORD_CREATED",
        co: company.id,
        cn: company.name,
        eid: master.id,
        el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
        det: `Created Driver tax document (${taxFormType}).`,
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
    logAuditEvent({
      e: "RECORD_UPDATED",
      co: company.id,
      cn: company.name,
      eid: master.id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: "Updated Driver identity profile.",
    });
    setIsEditingProfile(false);
    onRefresh();
  };

  const handleSaveRelationship = (patch: Partial<CompanyDriverRelationship>) => {
    updateCompanyDriverRelationship(company.id, relationship.id, patch);
    logAuditEvent({
      e: "RECORD_UPDATED",
      co: company.id,
      cn: company.name,
      eid: master.id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: "Updated Driver company relationship.",
    });
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
    logAuditEvent({
      e: "RECORD_UPDATED",
      co: company.id,
      cn: company.name,
      eid: master.id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: "Added Driver address record.",
    });
    setIsEditingProfile(false);
    onRefresh();
  };

  // Handlers for Qualifications Tab
  const handleAddLicence = (licenceData: Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo">) => {
    addLicence(company.id, master.id, licenceData);
    logAuditEvent({
      e: "RECORD_CREATED",
      co: company.id,
      cn: company.name,
      eid: master.id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: "Added Driver licence record.",
    });
    onRefresh();
  };

  // Handlers for Screening Tab
  const handleAddScreening = (data: Omit<ScreeningRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    addScreeningRecord(company.id, master.id, data);
    logAuditEvent({
      e: "RECORD_CREATED",
      co: company.id,
      cn: company.name,
      eid: master.id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: "Added Driver screening record.",
    });
    onRefresh();
  };

  const handleArchiveScreening = (id: string) => {
    archiveScreeningRecord(company.id, id);
    logAuditEvent({
      e: "RECORD_ARCHIVED",
      co: company.id,
      cn: company.name,
      eid: id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: "Archived Driver screening record.",
    });
    onRefresh();
  };

  // Handlers for Training Tab
  const handleAddTraining = (data: Omit<TrainingRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    addTrainingRecord(company.id, master.id, data);
    logAuditEvent({
      e: "RECORD_CREATED",
      co: company.id,
      cn: company.name,
      eid: master.id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: "Added Driver training record.",
    });
    onRefresh();
  };

  const handleAddTrainingRequirement = (data: Omit<TrainingRequirement, "requirementId" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    addTrainingRequirement(company.id, master.id, data);
    logAuditEvent({
      e: "RECORD_CREATED",
      co: company.id,
      cn: company.name,
      eid: master.id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: "Added Driver training requirement.",
    });
    onRefresh();
  };

  const handleWaiveTraining = (id: string, reason: string) => {
    waiveTrainingRecord(company.id, id, reason);
    logAuditEvent({
      e: "RECORD_UPDATED",
      co: company.id,
      cn: company.name,
      eid: id,
      el: `${master.identity.legalFirstName} ${master.identity.legalLastName}`.trim(),
      det: `Waived Driver training requirement. Reason: ${reason}`,
    });
    onRefresh();
  };

  // Handlers for Performance Tab
  const handleAddEvent = (data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => {
    const created = addManualPerformanceEvent(company.id, master.id, data);
    reevaluatePerformanceRelationshipsAfterSourceMutation(company.id, "PERFORMANCE", created?.id);
    setEventEvidenceCreatedId(null);
    onRefresh();
  };

  const handleUpdateEventWorkflow = (eventId: string, update: Parameters<typeof updatePerformanceEventWorkflow>[2]) => {
    updatePerformanceEventWorkflow(company.id, eventId, update);
    onRefresh();
  };

  const handleArchiveEvent = (eventId: string) => {
    archivePerformanceEvent(company.id, eventId);
    onRefresh();
  };

  const handleLinkCompanyDetermination = (eventId: string, determinationId: string) => {
    linkPerformanceEventDetermination(company.id, eventId, determinationId);
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
    const created = addCompanyDetermination(company.id, determination);
    onRefresh();
    return created;
  };

  const handleRequestPerformanceSourceUpload = () => {
    setEventEvidenceCreatedId(null);
    machineAcquisitionDraftRef.current = null;
    import("@/lib/roadside-machine-client").then(({ setPendingRoadsideDraft }) => setPendingRoadsideDraft(null));
    setEventEvidenceMode(false);
    setPerformanceSourceMode(true);
    setIsSourcePickerOpen(true);
  };

  const handleRequestEventEvidenceUpload = () => {
    setEventEvidenceCreatedId(null);
    setMachineAcquisitionDraft(null);
    machineAcquisitionDraftRef.current = null;
    import("@/lib/roadside-machine-client").then(({ setPendingRoadsideDraft }) => setPendingRoadsideDraft(null));
    setOcrError(null);
    setEventEvidenceMode(true);
    setPerformanceSourceMode(false);
    setIsSourcePickerOpen(true);
  };

  // OCR Processing
  const handleSelectFile = (file: File) => {
    console.log("[OCR] handleSelectFile called, eventEvidenceMode:", eventEvidenceMode, "performanceSourceMode:", performanceSourceMode);
    if (eventEvidenceMode || performanceSourceMode) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = String(reader.result || "");
          await migrateLegacyDriverEvidencePayloads(company.id, evidenceWithPayloads);

          // Canonical Evidence metadata stays in the Driver store. The large
          // document payload is stored separately in IndexedDB.
          const created = addDriverEvidence(company.id, master.id, {
            fileName: file.name,
            mimeType: file.type,
            dataUrl: "",
            documentType: "Performance Source Document",
          });

          await putEvidencePayload(created.id, dataUrl, file.type || "application/octet-stream");
          setEvidencePayloads((current) => ({
            ...current,
            [created.id]: { dataUrl, mimeType: file.type || "application/octet-stream" },
          }));

          const hydratedCreated = { ...created, dataUrl, mimeType: file.type || created.mimeType };

          if (eventEvidenceMode) {
            setEventEvidenceCreatedId(created.id);
          } else {
            receivePerformanceSourceForMachineProcessing(company.id, master.id, hydratedCreated);
          }

          // Fire Document AI in the background — do not block evidence save
          if (eventEvidenceMode || performanceSourceMode) {
            setIsProcessingOCR(true);
            setOcrError(null);
            console.log("[OCR] Starting Document AI processing for:", file.name, file.type, file.size);
            import("@/lib/roadside-machine-client")
              .then(({ processDocumentWithAI }) => processDocumentWithAI(file))
              .then((aiResult) => {
                const alignedAiResult = { ...aiResult, sourceEvidenceId: created.id };
                console.log("[OCR] Document AI result received:", JSON.stringify(alignedAiResult, null, 2));
                return import("@/lib/roadside-machine-mapper").then(async ({ mapMachineResultToRoadsideSource }) => {
                  const draft = mapMachineResultToRoadsideSource(alignedAiResult);
                  console.log("[OCR] Roadside draft:", JSON.stringify(draft, null, 2));

                  const storeDraft = () => {
                    setMachineAcquisitionDraft(draft);
                    machineAcquisitionDraftRef.current = draft;
                    import("@/lib/roadside-machine-client").then(({ setPendingRoadsideDraft }) => {
                      setPendingRoadsideDraft(draft);
                    });
                  };
                  const cleanup = () => {
                    setEventEvidenceMode(false);
                    setPerformanceSourceMode(false);
                    setIsSourcePickerOpen(false);
                    onRefresh();
                  };

                  console.log("[AUTO-SAVE] Attempting auto-save...");
                  const { autoSaveRoadsideInspection } = await import("@/lib/auto-save-roadside");
                  const saveResult = await autoSaveRoadsideInspection(alignedAiResult);
                  console.log("[AUTO-SAVE] Result:", saveResult.status, saveResult);
                  console.log("[AUTO-SAVE] Result:", JSON.stringify(saveResult, null, 2));

                  if (saveResult.status === "AUTO_SAVED") {
                    console.log("[AUTO-SAVE] SUCCESS - should NOT open modal");
                    // Do NOT open the modal — record is already saved
                    setAutoSaveNotification({
                      type: "success",
                      message: `Roadside Inspection auto-saved — ${saveResult.eventId}`,
                    });
                    setOpenAddEventModalSignal(false);
                    // Still store the draft for reference
                    storeDraft();
                    cleanup();
                    return;
                  }

                  console.log("[AUTO-SAVE] REVIEW REQUIRED - opening modal");
                  // REVIEW_REQUIRED, ENTITY_UNRESOLVED, or ERROR — open modal for human review
                  storeDraft();
                  // Signal the modal to open BEFORE cleanup
                  setOpenAddEventModalSignal(true);
                  setTimeout(() => setOpenAddEventModalSignal(false), 100);
                  // NOW clean up — after signal is sent
                  cleanup();
                });
              })
              .catch((err) => {
                console.error("[Document AI] Processing error:", err);
                console.error("[OCR] FAILED:", err);
                console.error("[OCR] Error message:", err instanceof Error ? err.message : String(err));
                console.error("[OCR] Error stack:", err instanceof Error ? err.stack : "no stack");
                setOcrError(err instanceof Error ? err.message : "OCR processing failed");
                // Cleanup on failure too
                setEventEvidenceMode(false);
                setPerformanceSourceMode(false);
                setIsSourcePickerOpen(false);
                onRefresh();
              })
              .finally(() => setIsProcessingOCR(false));
          }
        } catch (error) {
          setCreationError(error instanceof Error ? error.message : "Unable to store the evidence document.");
        }
      };
      reader.readAsDataURL(file);
      return;
    }
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
    setEventEvidenceMode(false);
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
      {autoSaveNotification && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg flex items-center gap-3 ${
            autoSaveNotification.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {autoSaveNotification.message}
          <button
            type="button"
            onClick={() => setAutoSaveNotification(null)}
            className="text-current opacity-60 hover:opacity-100"
          >
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
            evidence={evidenceWithPayloads}
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
            allDriversCohort={allDriversCohort}
            onAddEvent={handleAddEvent}
            onUpdateEventWorkflow={handleUpdateEventWorkflow}
            onAddHOSReview={handleAddHOSReview}
            onAddCompanyAction={handleAddCompanyAction}
            onAddCompanyDetermination={handleAddCompanyDetermination}
            onLinkCompanyDetermination={handleLinkCompanyDetermination}
            onOpenDocument={handleOpenEvidenceById}
            evidence={evidenceWithPayloads}
            onRequestEvidenceUpload={handleRequestEventEvidenceUpload}
            onRequestPerformanceSourceUpload={handleRequestPerformanceSourceUpload}
            pendingPerformanceSources={pendingPerformanceSources}
            evidenceCreatedId={eventEvidenceCreatedId}
            onArchiveEvent={handleArchiveEvent}
            onClearEvidenceCreatedId={() => { setEventEvidenceCreatedId(null); setMachineAcquisitionDraft(null); setOcrError(null); }}
            machineAcquisitionDraft={machineAcquisitionDraft}
            initialMachineAcquisitionDraft={machineAcquisitionDraftRef.current}
            openAddEventModalSignal={openAddEventModalSignal}
            isProcessingOCR={isProcessingOCR}
            ocrError={ocrError}
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
