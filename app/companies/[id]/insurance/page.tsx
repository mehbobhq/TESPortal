"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  FileText,
  UploadCloud,
  CheckCircle2,
  Clock,
  Archive,
  AlertCircle,
  History,
  X,
  Check,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  Users,
  Camera,
  RefreshCw,
  ChevronRight,
  Filter,
  DollarSign,
  Copy,
} from "lucide-react";

// --- Shared Foundation Components ---
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader";
import { ReadOnlyField, RegulatoryIdentifierField } from "@/src/components/shared/ReadOnlyField";
import { LoadingState, EmptyState, ErrorAlert } from "@/src/components/shared/StateDisplays";
import { UnsavedChangesPrompt } from "@/src/components/shared/UnsavedChangesPrompt";
import { InsuranceSummary } from "@/src/components/insurance/InsuranceSummary";
import { InsuranceNavigation } from "@/src/components/insurance/InsuranceNavigation";
import { TransportationPoliciesSection } from "@/src/components/insurance/TransportationPoliciesSection";
import { WorkersCompSection } from "@/src/components/insurance/WorkersCompSection";
import { SuretyBondsSection } from "@/src/components/insurance/SuretyBondsSection";
import { TransportationPolicyForm } from "@/src/components/insurance/TransportationPolicyForm";
import { WorkersCompForm } from "@/src/components/insurance/WorkersCompForm";
import { SuretyBondForm } from "@/src/components/insurance/SuretyBondForm";
import { BrokerUpdateDialog } from "@/src/components/insurance/BrokerUpdateDialog";
import { InsuranceArchiveDialog, type InsuranceArchiveTarget } from "@/src/components/insurance/InsuranceArchiveDialog";
import { OrganizationResolutionDialog, type InsuranceOrgResolutionPrompt } from "@/src/components/insurance/OrganizationResolutionDialog";
import { InsuranceDocumentIntake } from "@/src/components/insurance/InsuranceDocumentIntake";
import { InsuranceOCRWorkspace } from "@/src/components/insurance/InsuranceOCRWorkspace";
import { InsuranceEvidenceViewer } from "@/src/components/insurance/InsuranceEvidenceViewer";

// --- Shared Utilities & Normalization ---
import {
  normalizePhone,
  normalizeEmail,
  normalizeName,
} from "@/lib/identifier-normalization";
import {
  getDaysRemaining,
  getDeadlineStatus,
  getDeadlineClasses,
} from "@/lib/deadline-engine";
import { getInsuranceSummaryMetrics, filterTransportationRecords, filterWorkersRecords, filterBondRecords } from "@/src/components/insurance/insurance-selectors";
import { recordAuditEvent } from "@/lib/audit-logger";
import { logAuditEvent } from "@/lib/audit-log";

import {
  levenshteinDistance,
  similarityRatio,
  generateInsuranceId,
  generateCompanyId,
  generateContactId,
  generateRelationshipId,
  EMPTY_STORE,
  type CoverageItem,
  type BrokerReference,
  type InsuranceEvidence,
  type TransportationInsuranceRecord,
  type WorkersInsuranceRecord,
  type BondRecord,
  type StoredInsuranceData,
  type CanonicalCompany,
  type CanonicalContact,
  type InsuranceOCRDraft
} from "@/src/components/insurance/insurance-domain";
export { levenshteinDistance, similarityRatio } from "@/src/components/insurance/insurance-domain";
export type { CoverageItem, BrokerReference, InsuranceEvidence, TransportationInsuranceRecord, WorkersInsuranceRecord, BondRecord, StoredInsuranceData, CanonicalCompany, CanonicalContact, InsuranceOCRDraft } from "@/src/components/insurance/insurance-domain";

// =========================================================================
// MAIN INSURANCE COMPONENT
// =========================================================================

export default function InsurancePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const companyId = params?.id ?? "";

  // 1. Core State
  const [company, setCompany] = useState<CanonicalCompany | null>(null);
  const [store, setStore] = useState<StoredInsuranceData>(EMPTY_STORE);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // 2. Tab Navigation
  const [activeTab, setActiveTab] = useState<"transportation" | "workers" | "bonds" | "all">("transportation");
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 3. Selection & View Inspector
  const [selectedTransportationId, setSelectedTransportationId] = useState<string | null>(null);
  const [selectedWorkersId, setSelectedWorkersId] = useState<string | null>(null);
  const [selectedBondId, setSelectedBondId] = useState<string | null>(null);

  // 4. Form Modals (Create / Edit / Renewal)
  const [isTransportationModalOpen, setIsTransportationModalOpen] = useState(false);
  const [editingTransportation, setEditingTransportation] = useState<TransportationInsuranceRecord | null>(null);
  const [isRenewalMode, setIsRenewalMode] = useState(false);

  const [isWorkersModalOpen, setIsWorkersModalOpen] = useState(false);
  const [editingWorkers, setEditingWorkers] = useState<WorkersInsuranceRecord | null>(null);

  const [isBondModalOpen, setIsBondModalOpen] = useState(false);
  const [editingBond, setEditingBond] = useState<BondRecord | null>(null);

  // 5. Broker Contact Edit Modal
  const [isBrokerModalOpen, setIsBrokerModalOpen] = useState(false);
  const [brokerTargetRecord, setBrokerTargetRecord] = useState<TransportationInsuranceRecord | null>(null);

  // 6. Archive Reason Dialog
  const [archiveTarget, setArchiveTarget] = useState<InsuranceArchiveTarget | null>(null);
  const [archiveReasonText, setArchiveReasonText] = useState("");

  // 7. Organization Resolution Modal (Fuzzy Match & Explicit Case C Confirmation)
  const [orgResolutionPrompt, setOrgResolutionPrompt] = useState<InsuranceOrgResolutionPrompt | null>(null);

  // 8. Document Capture & Viewer Modals
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [documentTargetDescription, setDocumentTargetDescription] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewEvidence, setPreviewEvidence] = useState<InsuranceEvidence | null>(null);
  const [documentIntakeMode, setDocumentIntakeMode] = useState<"UPLOAD" | "OCR">("UPLOAD");

  // 9. OCR Simulation & Review Workspace
  const [isOCRReviewOpen, setIsOCRReviewOpen] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrDraft, setOcrDraft] = useState<InsuranceOCRDraft | null>(null);

  // =========================================================================
  // 3. PERSISTENCE & LOAD DISCIPLINE (NO AUTOSAVE ON PAGE LOAD)
  // =========================================================================

  const storageKey = `tes_company_insurance_${companyId}`;

  // Helper to read latest authoritative store from localStorage
  const getAuthoritativeInsuranceStore = useCallback((): StoredInsuranceData => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return EMPTY_STORE;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return {
          transportation: parsed,
          workers: [],
          bonds: [],
          evidence: [],
        };
      }
      if (parsed && typeof parsed === "object") {
        return {
          transportation: Array.isArray(parsed.transportation) ? parsed.transportation : [],
          workers: Array.isArray(parsed.workers) ? parsed.workers : [],
          bonds: Array.isArray(parsed.bonds) ? parsed.bonds : [],
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
        };
      }
      return EMPTY_STORE;
    } catch {
      return EMPTY_STORE;
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      if (!companyId) {
        setLoading(false);
        return;
      }

      // Load Master Company
      const rawCompanies = localStorage.getItem("tes_companies");
      const companies: CanonicalCompany[] = rawCompanies ? JSON.parse(rawCompanies) : [];
      const foundCompany = companies.find((c) => c.id === companyId) || null;
      setCompany(foundCompany);

      // Load Scoped Insurance Store without triggering any write
      const initialStore = getAuthoritativeInsuranceStore();
      setStore(initialStore);
    } catch (err) {
      console.error("Failed to load insurance store:", err);
      setErrorBanner("Failed to load insurance records. Data might be corrupted.");
    } finally {
      setLoading(false);
    }
  }, [companyId, storageKey, getAuthoritativeInsuranceStore]);

  // Cross-Store Best-Effort Rollback Helper
  interface CrossStoreSnapshot {
    insurance: string | null;
    companies: string | null;
    contacts: string | null;
  }

  const captureCrossStoreSnapshot = (): CrossStoreSnapshot => {
    return {
      insurance: localStorage.getItem(storageKey),
      companies: localStorage.getItem("tes_companies"),
      contacts: localStorage.getItem("tes_contacts_v5"),
    };
  };

  const rollbackCrossStoreSnapshot = (snapshot: CrossStoreSnapshot) => {
    if (snapshot.insurance !== null) {
      localStorage.setItem(storageKey, snapshot.insurance);
    } else {
      localStorage.removeItem(storageKey);
    }

    if (snapshot.companies !== null) {
      localStorage.setItem("tes_companies", snapshot.companies);
    } else {
      localStorage.removeItem("tes_companies");
    }

    if (snapshot.contacts !== null) {
      localStorage.setItem("tes_contacts_v5", snapshot.contacts);
    } else {
      localStorage.removeItem("tes_contacts_v5");
    }

    const restoredStore = getAuthoritativeInsuranceStore();
    setStore(restoredStore);
  };

  // Authoritative Store Mutation Persist Helper (Derives mutations from latest localStorage)
  const persistInsuranceStore = (
    updater: (prev: StoredInsuranceData) => StoredInsuranceData,
    successAuditAction?: () => void
  ): boolean => {
    const rawSnapshot = localStorage.getItem(storageKey);
    const prevStoreState = { ...store };

    try {
      // Invariant: parse the latest valid localStorage store immediately before every mutation
      const latestAuthoritativeStore = getAuthoritativeInsuranceStore();
      const nextStore = updater(latestAuthoritativeStore);
      localStorage.setItem(storageKey, JSON.stringify(nextStore));
      setStore(nextStore);

      if (successAuditAction) {
        successAuditAction();
      }
      return true;
    } catch (err) {
      console.error("Storage persistence error, rolling back:", err);
      if (rawSnapshot !== null) {
        localStorage.setItem(storageKey, rawSnapshot);
      } else {
        localStorage.removeItem(storageKey);
      }
      setStore(prevStoreState);
      setErrorBanner("Failed to persist insurance changes to local storage. Action rolled back.");
      return false;
    }
  };

  // =========================================================================
  // 4. CANONICAL ORGANIZATION IDENTITY RESOLUTION ENGINE
  // =========================================================================

  type CanonicalOrgKind = "Insurance Company" | "Insurance Broker" | "Workers Insurance" | "Surety Company";

  const handleCreateCanonicalCompany = (
    inputName: string,
    kind: CanonicalOrgKind
  ): { id: string; name: string } => {
    const newOrgId = generateCompanyId();
    const rawCompanies = localStorage.getItem("tes_companies");
    const companies: CanonicalCompany[] = rawCompanies ? JSON.parse(rawCompanies) : [];
    const newOrg: CanonicalCompany = {
      id: newOrgId,
      name: inputName,
      kind,
      status: "Active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedCompanies = [...companies, newOrg];
    localStorage.setItem("tes_companies", JSON.stringify(updatedCompanies));

    recordAuditEvent({
      action: "CREATE",
      entityType: "Company",
      entityId: newOrgId,
      companyId: newOrgId,
      role: "Compliance Administrator",
      details: `Created canonical ${kind} organization "${inputName}" (${newOrgId}) via Insurance workflow.`,
      actor: "System Administrator",
    });

    return { id: newOrgId, name: inputName };
  };

  const resolveCanonicalOrganization = async (
    inputName: string,
    kind: CanonicalOrgKind = "Insurance Company"
  ): Promise<{ id: string; name: string } | null> => {
    const cleanInput = inputName.trim();
    if (!cleanInput) {
      return { id: "", name: "" };
    }

    const rawCompanies = localStorage.getItem("tes_companies");
    const companies: CanonicalCompany[] = rawCompanies ? JSON.parse(rawCompanies) : [];
    const normalizedTarget = normalizeName(cleanInput);

    // CASE A: Exact Normalized Match -> Automatic Canonical Reuse
    const exactMatch = companies.find((c) => normalizeName(c.name) === normalizedTarget);
    if (exactMatch) {
      return { id: exactMatch.id, name: exactMatch.name };
    }

    // CASE B: Probable / Fuzzy Match -> MUST NOT Auto-Reuse! Surface Operator Selection
    const candidateMatches = companies
      .map((c) => ({
        company: c,
        similarity: similarityRatio(normalizedTarget, normalizeName(c.name)),
      }))
      .filter((item) => item.similarity >= 0.75)
      .sort((a, b) => b.similarity - a.similarity)
      .map((item) => item.company);

    if (candidateMatches.length > 0) {
      return new Promise<{ id: string; name: string } | null>((resolve) => {
        setOrgResolutionPrompt({
          inputName: cleanInput,
          kind,
          mode: "FUZZY_CANDIDATES",
          candidates: candidateMatches,
          onResolve: (resolved) => {
            setOrgResolutionPrompt(null);
            resolve(resolved);
          },
        });
      });
    }

    // CASE C: No Credible Match -> MUST REQUIRE EXPLICIT CONFIRMATION (No silent creation)
    return new Promise<{ id: string; name: string } | null>((resolve) => {
      setOrgResolutionPrompt({
        inputName: cleanInput,
        kind,
        mode: "NEW_CONFIRMATION",
        candidates: [],
        onResolve: (resolved) => {
          setOrgResolutionPrompt(null);
          resolve(resolved);
        },
      });
    });
  };

  // =========================================================================
  // 5. CANONICAL BROKER CONTACT RESOLUTION (tes_contacts_v5 with fallbacks)
  // =========================================================================

  interface BrokerContactResolutionResult {
    success: boolean;
    contact?: {
      contactId?: string;
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
    };
    error?: string;
  }

  const resolveBrokerContact = (
    brokerOrgId: string,
    brokerOrgName: string,
    agentName?: string,
    agentPhone?: string,
    agentEmail?: string
  ): BrokerContactResolutionResult => {
    if (!agentName && !agentPhone && !agentEmail) {
      return { success: true, contact: undefined };
    }

    try {
      // Prioritize authoritative tes_contacts_v5; if none exists, check fallback only for matching, do NOT promote legacy wholesale
      const rawV5 = localStorage.getItem("tes_contacts_v5");
      let contacts: CanonicalContact[] = [];
      let isUsingLegacyFallback = false;

      if (rawV5) {
        contacts = JSON.parse(rawV5);
      } else {
        const rawLegacy = localStorage.getItem("tes_contacts_v4") || localStorage.getItem("tes_contacts_v3");
        if (rawLegacy) {
          contacts = JSON.parse(rawLegacy);
          isUsingLegacyFallback = true;
        }
      }

      const cleanPhone = normalizePhone(agentPhone);
      const cleanEmail = normalizeEmail(agentEmail);
      const cleanName = normalizeName(agentName);

      // Identity Rules: Strong match on phone or email, or compound name + organization link
      let matchedContact: CanonicalContact | undefined;

      if (cleanEmail) {
        matchedContact = contacts.find((c) => normalizeEmail(c.email) === cleanEmail);
      }
      if (!matchedContact && cleanPhone && cleanPhone.length >= 7) {
        matchedContact = contacts.find((c) => normalizePhone(c.phone) === cleanPhone);
      }
      if (!matchedContact && cleanName && brokerOrgId) {
        matchedContact = contacts.find(
          (c) =>
            normalizeName(`${c.firstName} ${c.lastName}`) === cleanName &&
            c.relationships?.some((r) => r.companyId === brokerOrgId)
        );
      }

      if (matchedContact) {
        // Ensure relationship to the BROKER ORGANIZATION exists
        const hasRel = matchedContact.relationships?.some((r) => r.companyId === brokerOrgId);
        if (!hasRel && brokerOrgId) {
          const newRelId = generateRelationshipId();
          const newRel = {
            id: newRelId,
            companyId: brokerOrgId,
            companyName: brokerOrgName,
            role: "Broker Agent",
            status: "active" as const,
            startDate: new Date().toISOString().split("T")[0],
          };

          // If updating an existing contact from v5, update tes_contacts_v5
          // If the match was from legacy fallback, promote only this specific contact into v5 or update authoritative v5
          const currentV5List: CanonicalContact[] = rawV5 ? JSON.parse(rawV5) : [];
          const contactWithNewRel = {
            ...matchedContact,
            relationships: [...(matchedContact.relationships || []), newRel],
            updatedAt: new Date().toISOString(),
          };

          const updatedV5 = currentV5List.some((c) => c.id === matchedContact!.id)
            ? currentV5List.map((c) => (c.id === matchedContact!.id ? contactWithNewRel : c))
            : [contactWithNewRel, ...currentV5List];

          localStorage.setItem("tes_contacts_v5", JSON.stringify(updatedV5));

          // DEFECT 7 FIX: Audit new broker relationship for existing contact
          recordAuditEvent({
            action: "CREATE",
            entityType: "Contact",
            entityId: matchedContact.id,
            companyId: brokerOrgId,
            role: "Compliance Administrator",
            details: `Associated existing contact ${matchedContact.firstName} ${matchedContact.lastName} (${matchedContact.id}) with Broker Organization "${brokerOrgName}" (${brokerOrgId}) under Relationship ${newRelId} with role "Broker Agent".`,
            actor: "System Administrator",
          });
        }

        return {
          success: true,
          contact: {
            contactId: matchedContact.id,
            contactName: `${matchedContact.firstName} ${matchedContact.lastName}`.trim(),
            contactPhone: matchedContact.phone || agentPhone,
            contactEmail: matchedContact.email || agentEmail,
          },
        };
      }

      // Create a new canonical Contact Person linked to the Broker Firm
      const nameParts = (agentName || "Broker Agent").trim().split(" ");
      const firstName = nameParts[0] || "Broker";
      const lastName = nameParts.slice(1).join(" ") || "Agent";
      const newContactId = generateContactId();
      const newRelId = generateRelationshipId();

      const newContact: CanonicalContact = {
        id: newContactId,
        firstName,
        lastName,
        email: agentEmail || "",
        phone: agentPhone || "",
        role: "Broker Agent",
        isPrimary: false,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        relationships: [
          {
            id: newRelId,
            companyId: brokerOrgId,
            companyName: brokerOrgName,
            role: "Broker Agent",
            status: "active",
            startDate: new Date().toISOString().split("T")[0],
          },
        ],
      };

      // Only append new contact into tes_contacts_v5, NEVER promoting entire legacy v4/v3 store
      const currentV5List: CanonicalContact[] = rawV5 ? JSON.parse(rawV5) : [];
      const updatedList = [newContact, ...currentV5List];
      localStorage.setItem("tes_contacts_v5", JSON.stringify(updatedList));

      recordAuditEvent({
        action: "CREATE",
        entityType: "Contact",
        entityId: newContactId,
        companyId: brokerOrgId,
        role: "Compliance Administrator",
        details: `Registered canonical Broker Agent "${firstName} ${lastName}" (${newContactId}) for brokerage ${brokerOrgName} under Relationship ${newRelId}.`,
        actor: "System Administrator",
      });

      return {
        success: true,
        contact: {
          contactId: newContactId,
          contactName: `${firstName} ${lastName}`.trim(),
          contactPhone: agentPhone,
          contactEmail: agentEmail,
        },
      };
    } catch (err: any) {
      console.error("Failed to resolve canonical broker contact:", err);
      // DEFECT 6 FIX: Explicit failure - do NOT silently fallback to free text
      return {
        success: false,
        error: err?.message || "Failed to persist canonical broker contact.",
      };
    }
  };

  // =========================================================================
  // 6. EVIDENCE HANDLING (STORED INSIDE STORE.EVIDENCE)
  // =========================================================================

  const handleCreateEvidenceFromFile = async (
    file: File,
    source: "Device" | "Camera" | "OCR"
  ): Promise<InsuranceEvidence> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const evidenceId = generateInsuranceId("DOC");
        const newEvidence: InsuranceEvidence = {
          id: evidenceId,
          fileName: file.name || `Insurance_Document_${Date.now()}`,
          fileType: file.type || "application/pdf",
          uploadedAt: new Date().toISOString(),
          source,
          dataUrl,
        };

        const success = persistInsuranceStore(
          (prev) => ({
            ...prev,
            evidence: [newEvidence, ...prev.evidence],
          }),
          () => {
            recordAuditEvent({
              action: "CREATE",
              entityType: "Evidence",
              entityId: evidenceId,
              companyId,
              role: "Compliance Administrator",
              details: `Uploaded insurance compliance evidence "${newEvidence.fileName}" (${evidenceId}) from source ${source}.`,
              actor: "System Administrator",
            });
            logAuditEvent({
              e: "DOCUMENT_UPLOADED",
              co: companyId,
              cn: company?.name,
              eid: evidenceId,
              el: newEvidence.fileName,
              det: `Uploaded insurance compliance evidence "${newEvidence.fileName}" from source ${source}.`,
            });
          }
        );

        if (success) {
          resolve(newEvidence);
        } else {
          reject(new Error("Failed to persist insurance evidence document."));
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  const handleOpenSourcePicker = (description: string, mode: "UPLOAD" | "OCR") => {
    setDocumentTargetDescription(description);
    setDocumentIntakeMode(mode);
    setIsSourcePickerOpen(true);
  };

  // =========================================================================
  // 7. TRANSPORTATION POLICIES HANDLERS
  // =========================================================================

  const handleSaveTransportation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const insuranceType = String(formData.get("insuranceType") || "Auto Liability").trim();
    const policyNumber = String(formData.get("policyNumber") || "").trim();
    const rawInsurer = String(formData.get("insurerName") || "").trim();
    const effectiveDate = String(formData.get("effectiveDate") || "").trim();
    const expiryDate = String(formData.get("expiryDate") || "").trim();
    const coverageAmount = Number(formData.get("coverageAmount")) || 1000000;
    const rawBrokerOrg = String(formData.get("brokerOrg") || "").trim();
    const rawBrokerAgent = String(formData.get("brokerAgent") || "").trim();
    const rawBrokerPhone = String(formData.get("brokerPhone") || "").trim();
    const rawBrokerEmail = String(formData.get("brokerEmail") || "").trim();
    const notes = String(formData.get("notes") || "").trim();
    const evidenceId = String(formData.get("evidenceId") || "").trim() || undefined;

    if (!policyNumber || !rawInsurer || !effectiveDate || !expiryDate) {
      setErrorBanner("Please populate all required insurance policy fields.");
      return;
    }

    // Capture cross-store snapshot before multi-store operations
    const snapshot = captureCrossStoreSnapshot();

    try {
      // Resolve Insurer Canonical Organization ("Insurance Company")
      const resolvedInsurer = await resolveCanonicalOrganization(rawInsurer, "Insurance Company");
      if (!resolvedInsurer) {
        // User cancelled org resolution - abort save safely and rollback snapshot in case of prior mutations
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      // Resolve Broker Canonical Organization ("Insurance Broker") and Agent Contact
      let brokerRef: BrokerReference | undefined = undefined;
      if (rawBrokerOrg) {
        const resolvedBrokerOrg = await resolveCanonicalOrganization(rawBrokerOrg, "Insurance Broker");
        if (!resolvedBrokerOrg) {
          // User cancelled org resolution after insurer was resolved - rollback snapshot
          rollbackCrossStoreSnapshot(snapshot);
          return;
        }

        const resolvedAgent = resolveBrokerContact(
          resolvedBrokerOrg.id,
          resolvedBrokerOrg.name,
          rawBrokerAgent,
          rawBrokerPhone,
          rawBrokerEmail
        );

        if (!resolvedAgent.success) {
          setErrorBanner(resolvedAgent.error || "Failed to persist canonical broker contact.");
          rollbackCrossStoreSnapshot(snapshot);
          return;
        }

        if (resolvedAgent.contact) {
          brokerRef = {
            organizationId: resolvedBrokerOrg.id,
            organizationName: resolvedBrokerOrg.name,
            contactId: resolvedAgent.contact.contactId,
            contactName: resolvedAgent.contact.contactName,
            contactPhone: resolvedAgent.contact.contactPhone,
            contactEmail: resolvedAgent.contact.contactEmail,
          };
        }
      }

      const calculatedStatus = getDeadlineStatus(expiryDate) === "Expired" ? "Expired" : "Active";

      let saveSucceeded = false;

      if (isRenewalMode && editingTransportation) {
        // RENEWAL WORKFLOW: Creates a new policy with previousRecordId pointing to predecessor
        const newPolicyId = generateInsuranceId("INS");
        const renewalRecord: TransportationInsuranceRecord = {
          id: newPolicyId,
          insuranceType,
          policyNumber,
          insurerId: resolvedInsurer.id,
          insurerName: resolvedInsurer.name,
          effectiveDate,
          expiryDate,
          coverageAmount,
          coverageItems: editingTransportation.coverageItems,
          broker: brokerRef,
          status: calculatedStatus,
          evidenceId,
          previousRecordId: editingTransportation.id,
          notes,
        };

        saveSucceeded = persistInsuranceStore(
          (prev) => ({
            ...prev,
            transportation: [renewalRecord, ...prev.transportation],
          }),
          () => {
            recordAuditEvent({
              action: "CREATE",
              entityType: "Insurance",
              entityId: newPolicyId,
              companyId,
              role: "Compliance Administrator",
              details: `Created policy renewal ${policyNumber} (${newPolicyId}) renewing predecessor ${editingTransportation.policyNumber} (${editingTransportation.id}).`,
              actor: "System Administrator",
            });
            logAuditEvent({
              e: "RECORD_CREATED",
              co: companyId,
              cn: company?.name,
              eid: newPolicyId,
              el: policyNumber,
              det: `Created policy renewal ${policyNumber} renewing predecessor ${editingTransportation.policyNumber}.`,
            });
          }
        );
      } else if (editingTransportation) {
        // UPDATE EXISTING WORKFLOW
        const updatedRecord: TransportationInsuranceRecord = {
          ...editingTransportation,
          insuranceType,
          policyNumber,
          insurerId: resolvedInsurer.id,
          insurerName: resolvedInsurer.name,
          effectiveDate,
          expiryDate,
          coverageAmount,
          broker: brokerRef,
          status: editingTransportation.status === "Archived" ? "Archived" : calculatedStatus,
          evidenceId,
          notes,
        };

        saveSucceeded = persistInsuranceStore(
          (prev) => ({
            ...prev,
            transportation: prev.transportation.map((t) => (t.id === updatedRecord.id ? updatedRecord : t)),
          }),
          () => {
            recordAuditEvent({
              action: "UPDATE",
              entityType: "Insurance",
              entityId: updatedRecord.id,
              companyId,
              role: "Compliance Administrator",
              details: `Updated transportation insurance policy ${policyNumber} (${updatedRecord.id}).`,
              actor: "System Administrator",
            });
            logAuditEvent({
              e: "RECORD_UPDATED",
              co: companyId,
              cn: company?.name,
              eid: updatedRecord.id,
              el: policyNumber,
              det: `Updated transportation insurance policy ${policyNumber}.`,
            });
          }
        );
      } else {
        // CREATE NEW POLICY
        const newPolicyId = generateInsuranceId("INS");
        const newRecord: TransportationInsuranceRecord = {
          id: newPolicyId,
          insuranceType,
          policyNumber,
          insurerId: resolvedInsurer.id,
          insurerName: resolvedInsurer.name,
          effectiveDate,
          expiryDate,
          coverageAmount,
          broker: brokerRef,
          status: calculatedStatus,
          evidenceId,
          notes,
        };

        saveSucceeded = persistInsuranceStore(
          (prev) => ({
            ...prev,
            transportation: [newRecord, ...prev.transportation],
          }),
          () => {
            recordAuditEvent({
              action: "CREATE",
              entityType: "Insurance",
              entityId: newPolicyId,
              companyId,
              role: "Compliance Administrator",
              details: `Created transportation insurance policy ${policyNumber} (${newPolicyId}) with insurer ${resolvedInsurer.name}.`,
              actor: "System Administrator",
            });
            logAuditEvent({
              e: "RECORD_CREATED",
              co: companyId,
              cn: company?.name,
              eid: newPolicyId,
              el: policyNumber,
              det: `Created transportation insurance policy ${policyNumber} with insurer ${resolvedInsurer.name}.`,
            });
          }
        );
      }

      if (!saveSucceeded) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      setIsTransportationModalOpen(false);
      setEditingTransportation(null);
      setIsRenewalMode(false);
    } catch (err: any) {
      console.error("Transportation save failed:", err);
      rollbackCrossStoreSnapshot(snapshot);
      setErrorBanner("Failed to save transportation policy. Operations rolled back.");
    }
  };

  // Broker Update Modal (with COI Group cascade option)
  const handleSaveBrokerUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!brokerTargetRecord) return;

    const formData = new FormData(e.currentTarget);
    const rawBrokerOrg = String(formData.get("brokerOrg") || "").trim();
    const rawBrokerAgent = String(formData.get("brokerAgent") || "").trim();
    const rawBrokerPhone = String(formData.get("brokerPhone") || "").trim();
    const rawBrokerEmail = String(formData.get("brokerEmail") || "").trim();
    const applyToGroup = formData.get("applyToGroup") === "on";

    if (!rawBrokerOrg) {
      setErrorBanner("Brokerage organization name is required.");
      return;
    }

    const snapshot = captureCrossStoreSnapshot();

    try {
      const resolvedBrokerOrg = await resolveCanonicalOrganization(rawBrokerOrg, "Insurance Broker");
      if (!resolvedBrokerOrg) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      const resolvedAgent = resolveBrokerContact(
        resolvedBrokerOrg.id,
        resolvedBrokerOrg.name,
        rawBrokerAgent,
        rawBrokerPhone,
        rawBrokerEmail
      );

      if (!resolvedAgent.success) {
        setErrorBanner(resolvedAgent.error || "Failed to persist canonical broker contact.");
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      const updatedBroker: BrokerReference = {
        organizationId: resolvedBrokerOrg.id,
        organizationName: resolvedBrokerOrg.name,
        contactId: resolvedAgent.contact?.contactId,
        contactName: resolvedAgent.contact?.contactName,
        contactPhone: resolvedAgent.contact?.contactPhone,
        contactEmail: resolvedAgent.contact?.contactEmail,
      };

      const saveSucceeded = persistInsuranceStore(
        (prev) => {
          const targetGroupId = brokerTargetRecord.groupId;
          return {
            ...prev,
            transportation: prev.transportation.map((pol) => {
              if (applyToGroup && targetGroupId && pol.groupId === targetGroupId) {
                return { ...pol, broker: updatedBroker };
              }
              if (pol.id === brokerTargetRecord.id) {
                return { ...pol, broker: updatedBroker };
              }
              return pol;
            }),
          };
        },
        () => {
          recordAuditEvent({
            action: "UPDATE",
            entityType: "Insurance",
            entityId: brokerTargetRecord.id,
            companyId,
            role: "Compliance Administrator",
            details: `Updated broker reference to ${resolvedBrokerOrg.name} for policy ${brokerTargetRecord.policyNumber}${
              applyToGroup && brokerTargetRecord.groupId ? ` (cascaded to COI group ${brokerTargetRecord.groupId})` : ""
            }.`,
            actor: "System Administrator",
          });
          logAuditEvent({
            e: "RECORD_UPDATED",
            co: companyId,
            cn: company?.name,
            eid: brokerTargetRecord.id,
            el: brokerTargetRecord.policyNumber,
            det: `Updated broker reference to ${resolvedBrokerOrg.name} for policy ${brokerTargetRecord.policyNumber}.`,
          });
        }
      );

      if (!saveSucceeded) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      setIsBrokerModalOpen(false);
      setBrokerTargetRecord(null);
    } catch (err: any) {
      console.error("Broker update failed:", err);
      rollbackCrossStoreSnapshot(snapshot);
      setErrorBanner("Failed to update broker details. Operations rolled back.");
    }
  };

  // =========================================================================
  // 8. WORKERS INSURANCE / WCB HANDLERS
  // =========================================================================

  const handleSaveWorkers = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const jurisdiction = String(formData.get("jurisdiction") || "ON").trim();
    const rawProvider = String(formData.get("providerName") || "").trim();
    const accountNumber = String(formData.get("accountNumber") || "").trim();
    const effectiveDate = String(formData.get("effectiveDate") || "").trim();
    const expiryDate = String(formData.get("expiryDate") || "").trim();
    const notes = String(formData.get("notes") || "").trim();
    const evidenceId = String(formData.get("evidenceId") || "").trim() || undefined;

    if (!accountNumber || !rawProvider || !effectiveDate || !expiryDate) {
      setErrorBanner("Please populate all required Workers Compensation fields.");
      return;
    }

    const snapshot = captureCrossStoreSnapshot();

    try {
      const resolvedProvider = await resolveCanonicalOrganization(rawProvider, "Workers Insurance");
      if (!resolvedProvider) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      const calculatedStatus = getDeadlineStatus(expiryDate) === "Expired" ? "Expired" : "Active";

      let saveSucceeded = false;

      if (editingWorkers) {
        const updated: WorkersInsuranceRecord = {
          ...editingWorkers,
          jurisdiction,
          providerId: resolvedProvider.id,
          providerName: resolvedProvider.name,
          accountNumber,
          effectiveDate,
          expiryDate,
          status: editingWorkers.status === "Archived" ? "Archived" : calculatedStatus,
          evidenceId,
          notes,
        };

        saveSucceeded = persistInsuranceStore(
          (prev) => ({
            ...prev,
            workers: prev.workers.map((w) => (w.id === updated.id ? updated : w)),
          }),
          () => {
            recordAuditEvent({
              action: "UPDATE",
              entityType: "Insurance",
              entityId: updated.id,
              companyId,
              role: "Compliance Administrator",
              details: `Updated Workers Compensation account ${accountNumber} in ${jurisdiction} (${updated.id}).`,
              actor: "System Administrator",
            });
            logAuditEvent({
              e: "RECORD_UPDATED",
              co: companyId,
              cn: company?.name,
              eid: updated.id,
              el: accountNumber,
              det: `Updated Workers Compensation account ${accountNumber} in ${jurisdiction}.`,
            });
          }
        );
      } else {
        const newId = generateInsuranceId("WCB");
        const newRecord: WorkersInsuranceRecord = {
          id: newId,
          jurisdiction,
          providerId: resolvedProvider.id,
          providerName: resolvedProvider.name,
          accountNumber,
          effectiveDate,
          expiryDate,
          status: calculatedStatus,
          evidenceId,
          notes,
        };

        saveSucceeded = persistInsuranceStore(
          (prev) => ({
            ...prev,
            workers: [newRecord, ...prev.workers],
          }),
          () => {
            recordAuditEvent({
              action: "CREATE",
              entityType: "Insurance",
              entityId: newId,
              companyId,
              role: "Compliance Administrator",
              details: `Created Workers Compensation account ${accountNumber} (${jurisdiction}) with provider ${resolvedProvider.name}.`,
              actor: "System Administrator",
            });
            logAuditEvent({
              e: "RECORD_CREATED",
              co: companyId,
              cn: company?.name,
              eid: newId,
              el: accountNumber,
              det: `Created Workers Compensation account ${accountNumber} (${jurisdiction}) with provider ${resolvedProvider.name}.`,
            });
          }
        );
      }

      if (!saveSucceeded) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      setIsWorkersModalOpen(false);
      setEditingWorkers(null);
    } catch (err: any) {
      console.error("Workers insurance save failed:", err);
      rollbackCrossStoreSnapshot(snapshot);
      setErrorBanner("Failed to save workers insurance record. Operations rolled back.");
    }
  };

  // =========================================================================
  // 9. SURETY BONDS HANDLERS
  // =========================================================================

  const handleSaveBond = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const bondType = String(formData.get("bondType") || "BMC-84 (Freight Broker)").trim();
    const rawSurety = String(formData.get("suretyName") || "").trim();
    const bondNumber = String(formData.get("bondNumber") || "").trim();
    const principalName = String(formData.get("principalName") || company?.name || "").trim();
    const bondAmount = Number(formData.get("bondAmount")) || 75000;
    const effectiveDate = String(formData.get("effectiveDate") || "").trim();
    const expiryDate = String(formData.get("expiryDate") || "").trim() || undefined;
    const notes = String(formData.get("notes") || "").trim();
    const evidenceId = String(formData.get("evidenceId") || "").trim() || undefined;

    if (!bondNumber || !rawSurety || !effectiveDate) {
      setErrorBanner("Please populate all required Surety Bond fields.");
      return;
    }

    const snapshot = captureCrossStoreSnapshot();

    try {
      const resolvedSurety = await resolveCanonicalOrganization(rawSurety, "Surety Company");
      if (!resolvedSurety) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      const calculatedStatus = expiryDate && getDeadlineStatus(expiryDate) === "Expired" ? "Expired" : "Active";

      let saveSucceeded = false;

      if (editingBond) {
        const updated: BondRecord = {
          ...editingBond,
          bondType,
          suretyOrganizationId: resolvedSurety.id,
          suretyName: resolvedSurety.name,
          bondNumber,
          principalName,
          bondAmount,
          effectiveDate,
          expiryDate,
          status: editingBond.status === "Archived" ? "Archived" : calculatedStatus,
          evidenceId,
          notes,
        };

        saveSucceeded = persistInsuranceStore(
          (prev) => ({
            ...prev,
            bonds: prev.bonds.map((b) => (b.id === updated.id ? updated : b)),
          }),
          () => {
            recordAuditEvent({
              action: "UPDATE",
              entityType: "Insurance",
              entityId: updated.id,
              companyId,
              role: "Compliance Administrator",
              details: `Updated surety bond ${bondNumber} (${bondType}) with surety ${resolvedSurety.name}.`,
              actor: "System Administrator",
            });
            logAuditEvent({
              e: "RECORD_UPDATED",
              co: companyId,
              cn: company?.name,
              eid: updated.id,
              el: bondNumber,
              det: `Updated surety bond ${bondNumber} (${bondType}) with surety ${resolvedSurety.name}.`,
            });
          }
        );
      } else {
        const newId = generateInsuranceId("BND");
        const newRecord: BondRecord = {
          id: newId,
          bondType,
          suretyOrganizationId: resolvedSurety.id,
          suretyName: resolvedSurety.name,
          bondNumber,
          principalName,
          bondAmount,
          effectiveDate,
          expiryDate,
          source: "Manual",
          status: calculatedStatus,
          evidenceId,
          notes,
        };

        saveSucceeded = persistInsuranceStore(
          (prev) => ({
            ...prev,
            bonds: [newRecord, ...prev.bonds],
          }),
          () => {
            recordAuditEvent({
              action: "CREATE",
              entityType: "Insurance",
              entityId: newId,
              companyId,
              role: "Compliance Administrator",
              details: `Created surety bond ${bondNumber} (${bondType}) for amount $${bondAmount.toLocaleString()}.`,
              actor: "System Administrator",
            });
            logAuditEvent({
              e: "RECORD_CREATED",
              co: companyId,
              cn: company?.name,
              eid: newId,
              el: bondNumber,
              det: `Created surety bond ${bondNumber} (${bondType}) for amount $${bondAmount.toLocaleString()}.`,
            });
          }
        );
      }

      if (!saveSucceeded) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      setIsBondModalOpen(false);
      setEditingBond(null);
    } catch (err: any) {
      console.error("Bond save failed:", err);
      rollbackCrossStoreSnapshot(snapshot);
      setErrorBanner("Failed to save surety bond record. Operations rolled back.");
    }
  };

  // =========================================================================
  // 10. ARCHIVE & RESTORE HANDLERS (NO HARD DELETE)
  // =========================================================================

  const handleConfirmArchive = () => {
    if (!archiveTarget || !archiveReasonText.trim()) {
      setErrorBanner("An archive reason is required.");
      return;
    }

    const { family, recordId, label } = archiveTarget;
    const now = new Date().toISOString();
    const actor = "System Administrator";

    persistInsuranceStore(
      (prev) => {
        if (family === "transportation") {
          return {
            ...prev,
            transportation: prev.transportation.map((t) =>
              t.id === recordId
                ? { ...t, status: "Archived", archivedAt: now, archivedBy: actor, archiveReason: archiveReasonText }
                : t
            ),
          };
        } else if (family === "workers") {
          return {
            ...prev,
            workers: prev.workers.map((w) =>
              w.id === recordId
                ? { ...w, status: "Archived", archivedAt: now, archivedBy: actor, archiveReason: archiveReasonText }
                : w
            ),
          };
        } else {
          return {
            ...prev,
            bonds: prev.bonds.map((b) =>
              b.id === recordId
                ? { ...b, status: "Archived", archivedAt: now, archivedBy: actor, archiveReason: archiveReasonText }
                : b
            ),
          };
        }
      },
      () => {
        recordAuditEvent({
          action: "ARCHIVE",
          entityType: "Insurance",
          entityId: recordId,
          companyId,
          role: "Compliance Administrator",
          details: `Archived ${family} record ${label} (${recordId}). Reason: ${archiveReasonText}`,
          actor: "System Administrator",
        });
        logAuditEvent({
          e: "RECORD_ARCHIVED",
          co: companyId,
          cn: company?.name,
          eid: recordId,
          el: label,
          det: `Archived ${family} record ${label}. Reason: ${archiveReasonText}`,
        });
      }
    );

    setArchiveTarget(null);
    setArchiveReasonText("");
  };

  const handleRestoreRecord = (family: "transportation" | "workers" | "bonds", recordId: string, label: string) => {
    persistInsuranceStore(
      (prev) => {
        if (family === "transportation") {
          return {
            ...prev,
            transportation: prev.transportation.map((t) => {
              if (t.id === recordId) {
                const restStatus = getDeadlineStatus(t.expiryDate) === "Expired" ? "Expired" : "Active";
                return {
                  ...t,
                  status: restStatus,
                  archivedAt: undefined,
                  archivedBy: undefined,
                  archiveReason: undefined,
                };
              }
              return t;
            }),
          };
        } else if (family === "workers") {
          return {
            ...prev,
            workers: prev.workers.map((w) => {
              if (w.id === recordId) {
                const restStatus = getDeadlineStatus(w.expiryDate) === "Expired" ? "Expired" : "Active";
                return {
                  ...w,
                  status: restStatus,
                  archivedAt: undefined,
                  archivedBy: undefined,
                  archiveReason: undefined,
                };
              }
              return w;
            }),
          };
        } else {
          return {
            ...prev,
            bonds: prev.bonds.map((b) => {
              if (b.id === recordId) {
                const restStatus =
                  b.expiryDate && getDeadlineStatus(b.expiryDate) === "Expired" ? "Expired" : "Active";
                return {
                  ...b,
                  status: restStatus,
                  archivedAt: undefined,
                  archivedBy: undefined,
                  archiveReason: undefined,
                };
              }
              return b;
            }),
          };
        }
      },
      () => {
        recordAuditEvent({
          action: "RESTORE",
          entityType: "Insurance",
          entityId: recordId,
          companyId,
          role: "Compliance Administrator",
          details: `Restored ${family} record ${label} (${recordId}) to active compliance monitoring.`,
          actor: "System Administrator",
        });
        logAuditEvent({
          e: "RECORD_UPDATED",
          co: companyId,
          cn: company?.name,
          eid: recordId,
          el: label,
          det: `Restored ${family} record ${label} to active compliance monitoring.`,
        });
      }
    );
  };

  // =========================================================================
  // 11. OCR EXTRACTION SIMULATION & INGESTION WORKFLOW
  // =========================================================================

  const handleStartOCRWorkflow = async (file: File) => {
    setOcrProcessing(true);
    try {
      // DEFECT 9 FIX: Return exact InsuranceEvidence object directly
      const createdEvidence = await handleCreateEvidenceFromFile(file, "OCR");

      // Simulated extraction delay using the returned newly-created evidence
      setTimeout(() => {
        setOcrDraft({
          evidence: createdEvidence,
          insurerName: "Northbridge General Insurance Corporation",
          policyNumber: `NBC-${Math.floor(100000 + Math.random() * 900000)}`,
          effectiveDate: new Date().toISOString().split("T")[0],
          expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          coverageAmount: 2000000,
          brokerOrgName: "Hub International Ontario Ltd.",
          brokerAgentName: "Sarah Jenkins",
          brokerPhone: "(416) 555-0199",
          brokerEmail: "sarah.jenkins@hubinternational.com",
          autoLiabilityLimit: 2000000,
          cargoLimit: 250000,
          generalLiabilityLimit: 2000000,
          physicalDamageLimit: 500000,
          confidence: 0.92,
        });
        setOcrProcessing(false);
        setIsOCRReviewOpen(true);
      }, 900);
    } catch (err) {
      console.error("OCR ingestion failed:", err);
      setOcrProcessing(false);
      setErrorBanner("Failed to ingest document for OCR.");
    }
  };

  const handleCommitOCR = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ocrDraft) return;

    const formData = new FormData(e.currentTarget);
    const insurerName = String(formData.get("insurerName") || ocrDraft.insurerName).trim();
    const policyNumber = String(formData.get("policyNumber") || ocrDraft.policyNumber).trim();
    const effectiveDate = String(formData.get("effectiveDate") || ocrDraft.effectiveDate).trim();
    const expiryDate = String(formData.get("expiryDate") || ocrDraft.expiryDate).trim();
    const brokerOrgName = String(formData.get("brokerOrgName") || ocrDraft.brokerOrgName).trim();
    const brokerAgentName = String(formData.get("brokerAgentName") || ocrDraft.brokerAgentName).trim();
    const brokerPhone = String(formData.get("brokerPhone") || ocrDraft.brokerPhone).trim();
    const brokerEmail = String(formData.get("brokerEmail") || ocrDraft.brokerEmail).trim();

    const autoLimit = Number(formData.get("autoLiabilityLimit")) || ocrDraft.autoLiabilityLimit;
    const cargoLimit = Number(formData.get("cargoLimit")) || ocrDraft.cargoLimit;
    const cglLimit = Number(formData.get("generalLiabilityLimit")) || ocrDraft.generalLiabilityLimit;

    const snapshot = captureCrossStoreSnapshot();

    try {
      // Resolve Canonical Insurer ("Insurance Company") & Broker ("Insurance Broker")
      const resolvedInsurer = await resolveCanonicalOrganization(insurerName, "Insurance Company");
      if (!resolvedInsurer) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      let brokerRef: BrokerReference | undefined = undefined;

      if (brokerOrgName) {
        const resolvedBrokerOrg = await resolveCanonicalOrganization(brokerOrgName, "Insurance Broker");
        if (!resolvedBrokerOrg) {
          rollbackCrossStoreSnapshot(snapshot);
          return;
        }

        const resolvedAgent = resolveBrokerContact(
          resolvedBrokerOrg.id,
          resolvedBrokerOrg.name,
          brokerAgentName,
          brokerPhone,
          brokerEmail
        );

        if (!resolvedAgent.success) {
          setErrorBanner(resolvedAgent.error || "Failed to persist canonical broker contact.");
          rollbackCrossStoreSnapshot(snapshot);
          return;
        }

        if (resolvedAgent.contact) {
          brokerRef = {
            organizationId: resolvedBrokerOrg.id,
            organizationName: resolvedBrokerOrg.name,
            contactId: resolvedAgent.contact.contactId,
            contactName: resolvedAgent.contact.contactName,
            contactPhone: resolvedAgent.contact.contactPhone,
            contactEmail: resolvedAgent.contact.contactEmail,
          };
        }
      }

      // Shared Group ID for all lines on this Certificate of Insurance
      const coiGroupId = generateInsuranceId("COI");
      const evidenceId = ocrDraft.evidence.id;

      // Create Sibling Policies extracted from the single COI
      const policiesToCreate: TransportationInsuranceRecord[] = [
        {
          id: generateInsuranceId("INS"),
          insuranceType: "Auto Liability",
          policyNumber,
          insurerId: resolvedInsurer.id,
          insurerName: resolvedInsurer.name,
          effectiveDate,
          expiryDate,
          coverageAmount: autoLimit,
          broker: brokerRef,
          status: "Active",
          evidenceId,
          groupId: coiGroupId,
        },
        {
          id: generateInsuranceId("INS"),
          insuranceType: "Motor Truck Cargo",
          policyNumber: `${policyNumber}-CRG`,
          insurerId: resolvedInsurer.id,
          insurerName: resolvedInsurer.name,
          effectiveDate,
          expiryDate,
          coverageAmount: cargoLimit,
          broker: brokerRef,
          status: "Active",
          evidenceId,
          groupId: coiGroupId,
        },
        {
          id: generateInsuranceId("INS"),
          insuranceType: "General Liability",
          policyNumber: `${policyNumber}-CGL`,
          insurerId: resolvedInsurer.id,
          insurerName: resolvedInsurer.name,
          effectiveDate,
          expiryDate,
          coverageAmount: cglLimit,
          broker: brokerRef,
          status: "Active",
          evidenceId,
          groupId: coiGroupId,
        },
      ];

      const saveSucceeded = persistInsuranceStore(
        (prev) => ({
          ...prev,
          transportation: [...policiesToCreate, ...prev.transportation],
        }),
        () => {
          recordAuditEvent({
            action: "OCR_INGEST",
            entityType: "Insurance",
            entityId: coiGroupId,
            companyId,
            role: "Compliance Administrator",
            details: `Ingested Certificate of Insurance COI group ${coiGroupId} extracting ${policiesToCreate.length} coverage lines with insurer ${resolvedInsurer.name}.`,
            actor: "System Administrator",
          });
          logAuditEvent({
            e: "RECORD_CREATED",
            co: companyId,
            cn: company?.name,
            eid: coiGroupId,
            el: `COI ${coiGroupId}`,
            det: `Ingested Certificate of Insurance COI group ${coiGroupId} extracting ${policiesToCreate.length} coverage lines with insurer ${resolvedInsurer.name}.`,
          });
        }
      );

      if (!saveSucceeded) {
        rollbackCrossStoreSnapshot(snapshot);
        return;
      }

      setIsOCRReviewOpen(false);
      setOcrDraft(null);
    } catch (err: any) {
      console.error("OCR commit failed:", err);
      rollbackCrossStoreSnapshot(snapshot);
      setErrorBanner("Failed to commit OCR policies. Operations rolled back.");
    }
  };

  // =========================================================================
  // 12. SUMMARY METRICS & FILTERED DATA
  // =========================================================================

  const summaryMetrics = useMemo(() => getInsuranceSummaryMetrics(store), [store]);

  const filteredTransportation = useMemo(() => filterTransportationRecords(store.transportation, showArchived, searchQuery), [store.transportation, showArchived, searchQuery]);

  const filteredWorkers = useMemo(() => filterWorkersRecords(store.workers, showArchived, searchQuery), [store.workers, showArchived, searchQuery]);

  const filteredBonds = useMemo(() => filterBondRecords(store.bonds, showArchived, searchQuery), [store.bonds, showArchived, searchQuery]);

  // =========================================================================
  // RENDER
  // =========================================================================

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <LoadingState message="Loading Insurance & Risk Management Master Register..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 font-sans">
      {/* 1. TOP HEADER */}
      {company && (
        <CompanyWorkspaceHeader
          company={{ id: company.id, name: company.name, kind: company.kind || "", status: company.status || "" }}
          section="Insurance"
          description="Fleet liability, cargo coverage, Workers Compensation (WCB), and surety bonds."
          actions={
            <>
              <button
                type="button"
                onClick={() => handleOpenSourcePicker("Certificate of Insurance", "OCR")}
                className="flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
              >
                <UploadCloud className="size-4" />
                <span>Document / OCR</span>
              </button>


              {/* New Policy Dropdown / Buttons */}
              <div className="flex items-center gap-1 bg-primary text-primary-foreground rounded-xl p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => {
                    setEditingTransportation(null);
                    setIsRenewalMode(false);
                    setIsTransportationModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold hover:bg-primary-foreground/10 rounded-lg transition-colors"
                >
                  <Plus className="size-3.5" />
                  <span>Add Transportation Policy</span>
                </button>
                <span className="opacity-30">|</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingWorkers(null);
                    setIsWorkersModalOpen(true);
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold hover:bg-primary-foreground/10 rounded-lg transition-colors"
                  title="Add WCB / Workers Account"
                >
                  WCB
                </button>
                <span className="opacity-30">|</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingBond(null);
                    setIsBondModalOpen(true);
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold hover:bg-primary-foreground/10 rounded-lg transition-colors"
                  title="Add Surety Bond"
                >
                  Bond
                </button>
              </div>
            </>
          }
        />
      )}

      {/* ERROR BANNER */}
      {errorBanner && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-medium text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="hover:opacity-80 p-1"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* 2. COMPLIANCE SUMMARY METRIC CARDS */}
      <InsuranceSummary summaryMetrics={summaryMetrics} />

      {/* 3. SECTION TABS & SEARCH / FILTER CONTROLS */}
      <InsuranceNavigation
        activeTab={activeTab}
        transportationCount={store.transportation.filter((t) => t.status !== "Archived").length}
        workersCount={store.workers.filter((w) => w.status !== "Archived").length}
        bondCount={store.bonds.filter((b) => b.status !== "Archived").length}
        searchQuery={searchQuery}
        showArchived={showArchived}
        onTabChange={setActiveTab}
        onSearchChange={setSearchQuery}
        onShowArchivedChange={setShowArchived}
      />

      {/* 4. TAB 1: TRANSPORTATION POLICIES (VIEW = RECORD) */}
      {(activeTab === "transportation" || activeTab === "all") && (
        <TransportationPoliciesSection
          records={filteredTransportation}
          evidence={store.evidence}
          onAdd={() => {
            setEditingTransportation(null);
            setIsRenewalMode(false);
            setIsTransportationModalOpen(true);
          }}
          onEdit={(record) => {
            setEditingTransportation(record);
            setIsRenewalMode(false);
            setIsTransportationModalOpen(true);
          }}
          onRenew={(record) => {
            setEditingTransportation(record);
            setIsRenewalMode(true);
            setIsTransportationModalOpen(true);
          }}
          onEditBroker={(record) => {
            setBrokerTargetRecord(record);
            setIsBrokerModalOpen(true);
          }}
          onArchive={(record) =>
            setArchiveTarget({
              family: "transportation",
              recordId: record.id,
              label: `Policy #${record.policyNumber} (${record.insuranceType})`,
            })
          }
          onRestore={(record) => handleRestoreRecord("transportation", record.id, record.policyNumber)}
          onViewEvidence={(evidenceRecord, record) => {
            recordAuditEvent({
              action: "VIEW_DOCUMENT",
              entityType: "Evidence",
              entityId: evidenceRecord.id,
              companyId,
              role: "Compliance Administrator",
              details: `Previewed secure evidence "${evidenceRecord.fileName}" for policy ${record.policyNumber}.`,
              actor: "System Administrator",
            });
            setPreviewEvidence(evidenceRecord);
          }}
        />
      )}

      {/* 5. TAB 2: WORKERS COMPENSATION (WCB / WSIB) */}
      {(activeTab === "workers" || activeTab === "all") && (
        <WorkersCompSection
          records={filteredWorkers}
          evidence={store.evidence}
          onAdd={() => {
            setEditingWorkers(null);
            setIsWorkersModalOpen(true);
          }}
          onEdit={(record) => {
            setEditingWorkers(record);
            setIsWorkersModalOpen(true);
          }}
          onArchive={(record) =>
            setArchiveTarget({
              family: "workers",
              recordId: record.id,
              label: `WCB ${record.jurisdiction} Acct #${record.accountNumber}`,
            })
          }
          onRestore={(record) => handleRestoreRecord("workers", record.id, record.accountNumber)}
          onViewEvidence={(evidenceRecord, record) => {
            recordAuditEvent({
              action: "VIEW_DOCUMENT",
              entityType: "Evidence",
              entityId: evidenceRecord.id,
              companyId,
              role: "Compliance Administrator",
              details: `Previewed WCB clearance document for ${record.jurisdiction} account ${record.accountNumber}.`,
              actor: "System Administrator",
            });
            setPreviewEvidence(evidenceRecord);
          }}
        />
      )}

      {/* 6. TAB 3: SURETY BONDS */}
      {(activeTab === "bonds" || activeTab === "all") && (
        <SuretyBondsSection
          records={filteredBonds}
          evidence={store.evidence}
          onAdd={() => {
            setEditingBond(null);
            setIsBondModalOpen(true);
          }}
          onEdit={(record) => {
            setEditingBond(record);
            setIsBondModalOpen(true);
          }}
          onArchive={(record) =>
            setArchiveTarget({
              family: "bonds",
              recordId: record.id,
              label: `Surety Bond #${record.bondNumber} (${record.bondType})`,
            })
          }
          onRestore={(record) => handleRestoreRecord("bonds", record.id, record.bondNumber)}
          onViewEvidence={(evidenceRecord, record) => {
            recordAuditEvent({
              action: "VIEW_DOCUMENT",
              entityType: "Evidence",
              entityId: evidenceRecord.id,
              companyId,
              role: "Compliance Administrator",
              details: `Previewed Surety Bond evidence for bond #${record.bondNumber}.`,
              actor: "System Administrator",
            });
            setPreviewEvidence(evidenceRecord);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* 7. MODALS & FORMS (CREATE / EDIT = FORM)                                 */}
      {/* ========================================================================= */}

      {/* MODAL 1: TRANSPORTATION POLICY FORM */}
      <TransportationPolicyForm
        open={isTransportationModalOpen}
        editingRecord={editingTransportation}
        isRenewalMode={isRenewalMode}
        onSubmit={handleSaveTransportation}
        onClose={() => {
          setIsTransportationModalOpen(false);
          setEditingTransportation(null);
          setIsRenewalMode(false);
        }}
      />

      {/* MODAL 2: WORKERS COMPENSATION (WCB) FORM */}
      <WorkersCompForm
        open={isWorkersModalOpen}
        editingRecord={editingWorkers}
        onSubmit={handleSaveWorkers}
        onClose={() => {
          setIsWorkersModalOpen(false);
          setEditingWorkers(null);
        }}
      />

      {/* MODAL 3: SURETY BOND FORM */}
      <SuretyBondForm
        open={isBondModalOpen}
        editingRecord={editingBond}
        onSubmit={handleSaveBond}
        onClose={() => {
          setIsBondModalOpen(false);
          setEditingBond(null);
        }}
      />

      {/* MODAL 4: BROKER UPDATE MODAL (WITH COI GROUP CASCADE) */}
      <BrokerUpdateDialog
        open={isBrokerModalOpen}
        record={brokerTargetRecord}
        onSubmit={handleSaveBrokerUpdate}
        onClose={() => {
          setIsBrokerModalOpen(false);
          setBrokerTargetRecord(null);
        }}
      />

      {/* MODAL 5: ARCHIVE REASON PROMPT */}
      <InsuranceArchiveDialog
        target={archiveTarget}
        reason={archiveReasonText}
        onReasonChange={setArchiveReasonText}
        onCancel={() => {
          setArchiveTarget(null);
          setArchiveReasonText("");
        }}
        onConfirm={handleConfirmArchive}
      />

      {/* MODAL 6: CANONICAL ORGANIZATION RESOLUTION */}
      <OrganizationResolutionDialog
        prompt={orgResolutionPrompt}
        onUseExisting={(candidate) =>
          orgResolutionPrompt?.onResolve({ id: candidate.id, name: candidate.name })
        }
        onCreateNew={() => {
          if (!orgResolutionPrompt) return;
          const created = handleCreateCanonicalCompany(
            orgResolutionPrompt.inputName,
            orgResolutionPrompt.kind
          );
          orgResolutionPrompt.onResolve(created);
        }}
        onCancel={() => orgResolutionPrompt?.onResolve(null)}
      />

      {/* MODALS 7-8: DOCUMENT SOURCE + CAMERA INTAKE */}
      <InsuranceDocumentIntake
        sourcePickerOpen={isSourcePickerOpen}
        cameraOpen={isCameraOpen}
        targetDescription={documentTargetDescription}
        onCloseSourcePicker={() => setIsSourcePickerOpen(false)}
        onOpenCamera={() => setIsCameraOpen(true)}
        onSelectFile={async (file) => {
          setIsSourcePickerOpen(false);
          if (documentIntakeMode === "OCR") {
            await handleStartOCRWorkflow(file);
            return;
          }
          try {
            await handleCreateEvidenceFromFile(file, "Device");
          } catch (err) {
            console.error("Insurance document upload failed:", err);
            setErrorBanner("Failed to upload insurance document.");
          }
        }}
        onCapture={async (file) => {
          setIsCameraOpen(false);
          if (documentIntakeMode === "OCR") {
            await handleStartOCRWorkflow(file);
            return;
          }
          try {
            await handleCreateEvidenceFromFile(file, "Camera");
          } catch (err) {
            console.error("Camera document capture failed:", err);
            setErrorBanner("Failed to save camera-captured insurance document.");
          }
        }}
        onCloseCamera={() => setIsCameraOpen(false)}
      />

      {/* MODAL 9: OCR EXTRACTION & SPLIT-SCREEN REVIEW WORKSPACE */}
      <InsuranceOCRWorkspace
        open={isOCRReviewOpen}
        draft={ocrDraft}
        companyName={company?.name}
        onSubmit={handleCommitOCR}
        onClose={() => {
          setIsOCRReviewOpen(false);
          setOcrDraft(null);
        }}
      />

      {/* MODAL 10: SECURE DOCUMENT VIEWER MODAL */}
      <InsuranceEvidenceViewer
        evidence={previewEvidence}
        companyName={company?.name}
        onClose={() => setPreviewEvidence(null)}
      />

    </div>
  );
}
