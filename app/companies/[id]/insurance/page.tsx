"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Plus,
  FileText,
  UploadCloud,
  CheckCircle2,
  Clock,
  Archive,
  RotateCcw,
  Pencil,
  AlertCircle,
  FileCheck2,
  History,
  X,
  Check,
  ShieldCheck,
  ShieldAlert,
  Search,
  ExternalLink,
  Users,
  Eye,
  Camera,
  RefreshCw,
  Sparkles,
  Layers,
  ChevronRight,
  Filter,
  DollarSign,
  Briefcase,
  Award,
  AlertTriangle,
  Copy,
} from "lucide-react";

// --- Shared Foundation Components ---
import { ReadOnlyField, RegulatoryIdentifierField } from "@/src/components/shared/ReadOnlyField";
import { LoadingState, EmptyState, ErrorAlert } from "@/src/components/shared/StateDisplays";
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker";
import { CameraCapture } from "@/src/components/CameraCapture";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";
import { UnsavedChangesPrompt } from "@/src/components/shared/UnsavedChangesPrompt";

// --- Shared Utilities & Normalization ---
import {
  normalizePhone,
  normalizeEmail,
  normalizeName,
} from "@/src/lib/identifier-normalization";
import {
  getDaysRemaining,
  getDeadlineStatus,
  getDeadlineClasses,
} from "@/src/lib/deadline-engine";
import { recordAuditEvent } from "@/src/lib/audit-logger";
import { JURISDICTIONS } from "@/src/lib/jurisdictions";

// Standard string similarity helper for fuzzy entity candidate discovery
export function levenshteinDistance(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: bn + 1 }, () => new Array(an + 1).fill(0));
  for (let i = 0; i <= an; i++) matrix[0][i] = i;
  for (let j = 0; j <= bn; j++) matrix[j][0] = j;
  for (let j = 1; j <= bn; j++) {
    for (let i = 1; i <= an; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1,
        matrix[j][i - 1] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[bn][an];
}

export function similarityRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return (maxLen - dist) / maxLen;
}

// =========================================================================
// 1. DOMAIN DATA CONTRACTS & INTERFACES (FROZEN)
// =========================================================================

export interface CoverageItem {
  id: string; // "COV-..."
  coverageType: string; // e.g. "Auto Liability CSL", "Motor Truck Cargo", "Reefer Breakdown"
  limitAmount: number;
  deductibleAmount?: number;
  currency: "CAD" | "USD";
  scheduledVehiclesOnly?: boolean;
}

export interface BrokerReference {
  organizationId: string; // Canonical CMP-* identifier for Brokerage Firm
  organizationName: string;
  contactId?: string; // Canonical CNT-* identifier for Individual Broker
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export interface InsuranceEvidence {
  id: string; // "DOC-..."
  fileName: string;
  fileType: string;
  uploadedAt: string;
  source: "Device" | "Camera" | "OCR";
  dataUrl: string;
  extractedData?: any;
}

export interface TransportationInsuranceRecord {
  id: string; // "INS-..."
  insuranceType: string; // e.g. "Auto Liability", "Motor Truck Cargo", "General Liability", "Physical Damage", "Umbrella"
  policyNumber: string;
  insurerId: string; // Canonical CMP-*
  insurerName: string;
  effectiveDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  coverageAmount: number;
  coverageItems?: CoverageItem[];
  broker?: BrokerReference;
  status: "Active" | "Expired" | "Archived";
  evidenceId?: string; // Singular DOC-* pointer
  groupId?: string; // COI-* certificate grouping
  previousRecordId?: string; // Predecessor renewal pointer
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  notes?: string;
}

export interface WorkersInsuranceRecord {
  id: string; // "WCB-..."
  jurisdiction: string; // Province / State code (e.g. "ON", "AB", "BC")
  providerId: string; // Canonical CMP-* (e.g. WSIB, WCB Alberta)
  providerName: string;
  accountNumber: string;
  effectiveDate: string;
  expiryDate: string;
  status: "Active" | "Expired" | "Archived";
  evidenceId?: string;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  notes?: string;
}

export interface BondRecord {
  id: string; // "BND-..."
  bondType: string; // "BMC-84 (Freight Broker)", "Customs / In-Transit Bond", "Performance Bond"
  suretyOrganizationId: string; // Canonical CMP-*
  suretyName: string;
  bondNumber: string;
  principalName: string;
  bondAmount: number | string;
  effectiveDate: string;
  expiryDate?: string;
  source: "Manual" | "OCR";
  status: "Active" | "Expired" | "Archived";
  evidenceId?: string;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  notes?: string;
}

// Persisted Stored Envelope in tes_company_insurance_${companyId}
export interface StoredInsuranceData {
  transportation: TransportationInsuranceRecord[];
  workers: WorkersInsuranceRecord[];
  bonds: BondRecord[];
  evidence: InsuranceEvidence[];
}

export interface CanonicalCompany {
  id: string;
  name: string;
  kind?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface CanonicalContact {
  id: string;
  globalId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role?: string;
  isPrimary?: boolean;
  isArchived?: boolean;
  relationships?: Array<{
    id: string;
    companyId: string;
    companyName?: string;
    role: string;
    status: "active" | "ended";
    startDate: string;
  }>;
  [key: string]: any;
}

// =========================================================================
// 2. ID GENERATOR HELPERS (COMPATIBLE WITH FROZEN PREFIXES)
// =========================================================================

function generateInsuranceId(prefix: "INS" | "WCB" | "BND" | "COI" | "DOC" | "COV"): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().substring(0, 8).toUpperCase()
      : Math.random().toString(36).substring(2, 9).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

function generateCompanyId(): string {
  return `CMP-${Math.floor(10000 + Math.random() * 90000)}`;
}

function generateContactId(): string {
  return `CNT-${Math.floor(10000 + Math.random() * 90000)}`;
}

function generateRelationshipId(): string {
  return `REL-${Math.floor(10000 + Math.random() * 90000)}`;
}

const EMPTY_STORE: StoredInsuranceData = {
  transportation: [],
  workers: [],
  bonds: [],
  evidence: [],
};

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
  const [archiveTarget, setArchiveTarget] = useState<{
    family: "transportation" | "workers" | "bonds";
    recordId: string;
    label: string;
  } | null>(null);
  const [archiveReasonText, setArchiveReasonText] = useState("");

  // 7. Organization Resolution Modal (Fuzzy Match & Explicit Case C Confirmation)
  const [orgResolutionPrompt, setOrgResolutionPrompt] = useState<{
    inputName: string;
    kind: "Insurance Company" | "Insurance Broker" | "Workers Insurance" | "Surety Company";
    mode: "FUZZY_CANDIDATES" | "NEW_CONFIRMATION";
    candidates: CanonicalCompany[];
    onResolve: (resolvedOrg: { id: string; name: string } | null) => void;
  } | null>(null);

  // 8. Document Capture & Viewer Modals
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [documentTargetDescription, setDocumentTargetDescription] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewEvidence, setPreviewEvidence] = useState<InsuranceEvidence | null>(null);
  const [pendingEvidenceCallback, setPendingEvidenceCallback] = useState<((evidenceId: string) => void) | null>(null);

  // 9. OCR Simulation & Review Workspace
  const [isOCRReviewOpen, setIsOCRReviewOpen] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrDraft, setOcrDraft] = useState<{
    evidence: InsuranceEvidence;
    insurerName: string;
    policyNumber: string;
    effectiveDate: string;
    expiryDate: string;
    coverageAmount: number;
    brokerOrgName: string;
    brokerAgentName: string;
    brokerPhone: string;
    brokerEmail: string;
    autoLiabilityLimit: number;
    cargoLimit: number;
    generalLiabilityLimit: number;
    physicalDamageLimit: number;
    confidence: number;
  } | null>(null);

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

  const handleOpenSourcePicker = (description: string, onSelectedEvidence: (id: string) => void) => {
    setDocumentTargetDescription(description);
    setPendingEvidenceCallback(() => onSelectedEvidence);
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

  const summaryMetrics = useMemo(() => {
    const allActiveTransportation = store.transportation.filter((t) => t.status !== "Archived");
    const allActiveWorkers = store.workers.filter((w) => w.status !== "Archived");
    const allActiveBonds = store.bonds.filter((b) => b.status !== "Archived");

    let healthyCount = 0;
    let watchCount = 0;
    let urgentCount = 0;
    let criticalCount = 0;
    let expiredCount = 0;
    let totalLiabilityLimit = 0;

    allActiveTransportation.forEach((t) => {
      const st = getDeadlineStatus(t.expiryDate);
      if (st === "Healthy") healthyCount++;
      else if (st === "Watch") watchCount++;
      else if (st === "Urgent") urgentCount++;
      else if (st === "Critical") criticalCount++;
      else if (st === "Expired") expiredCount++;

      if (t.insuranceType.toLowerCase().includes("liability") || t.insuranceType.toLowerCase().includes("auto")) {
        totalLiabilityLimit += t.coverageAmount || 0;
      }
    });

    allActiveWorkers.forEach((w) => {
      const st = getDeadlineStatus(w.expiryDate);
      if (st === "Healthy") healthyCount++;
      else if (st === "Watch") watchCount++;
      else if (st === "Urgent") urgentCount++;
      else if (st === "Critical") criticalCount++;
      else if (st === "Expired") expiredCount++;
    });

    allActiveBonds.forEach((b) => {
      if (b.expiryDate) {
        const st = getDeadlineStatus(b.expiryDate);
        if (st === "Healthy") healthyCount++;
        else if (st === "Watch") watchCount++;
        else if (st === "Urgent") urgentCount++;
        else if (st === "Critical") criticalCount++;
        else if (st === "Expired") expiredCount++;
      }
    });

    return {
      activeTotal: allActiveTransportation.length + allActiveWorkers.length + allActiveBonds.length,
      healthyCount,
      watchCount,
      urgentCount,
      criticalCount,
      expiredCount,
      totalLiabilityLimit,
    };
  }, [store]);

  const filteredTransportation = useMemo(() => {
    return store.transportation.filter((t) => {
      if (!showArchived && t.status === "Archived") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.policyNumber.toLowerCase().includes(q) ||
          t.insurerName.toLowerCase().includes(q) ||
          t.insuranceType.toLowerCase().includes(q) ||
          t.broker?.organizationName?.toLowerCase().includes(q) ||
          t.broker?.contactName?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [store.transportation, showArchived, searchQuery]);

  const filteredWorkers = useMemo(() => {
    return store.workers.filter((w) => {
      if (!showArchived && w.status === "Archived") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          w.accountNumber.toLowerCase().includes(q) ||
          w.providerName.toLowerCase().includes(q) ||
          w.jurisdiction.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [store.workers, showArchived, searchQuery]);

  const filteredBonds = useMemo(() => {
    return store.bonds.filter((b) => {
      if (!showArchived && b.status === "Archived") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          b.bondNumber.toLowerCase().includes(q) ||
          b.suretyName.toLowerCase().includes(q) ||
          b.bondType.toLowerCase().includes(q) ||
          b.principalName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [store.bonds, showArchived, searchQuery]);

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
    <div className="mx-auto max-w-7xl space-y-6 pb-20 font-sans">
      {/* 1. TOP HEADER & BREADCRUMB */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <button
              type="button"
              onClick={() => router.push(`/companies/${companyId}`)}
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="size-3.5" /> Company Profile
            </button>
            <ChevronRight className="size-3 text-muted-foreground/40" />
            <span className="text-foreground">{company?.name || "Company"}</span>
            <ChevronRight className="size-3 text-muted-foreground/40" />
            <span className="text-primary font-bold">Insurance & Risk</span>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Insurance & Risk Management
              </h1>
              <p className="text-xs text-muted-foreground">
                Fleet liability, cargo coverage, Workers Compensation (WCB), and surety bonds.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => handleOpenSourcePicker("Certificate of Insurance", (evidenceId) => {})}
            className="flex items-center gap-2 rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-xs hover:bg-muted transition-colors"
          >
            <UploadCloud className="size-4 text-primary" />
            <span>Upload Document</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDocumentTargetDescription("Live COI Certificate");
              setIsCameraOpen(true);
            }}
            className="flex items-center gap-2 rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-xs hover:bg-muted transition-colors"
          >
            <Camera className="size-4 text-primary" />
            <span>Scan with Camera</span>
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
        </div>
      </div>

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Policies</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">{summaryMetrics.activeTotal}</span>
            <span className="text-[11px] text-muted-foreground font-medium">Monitored</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Healthy (&gt;60d)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {summaryMetrics.healthyCount}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Good Standing</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            Watch (31–60d)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {summaryMetrics.watchCount}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Upcoming</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Urgent (11–30d)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {summaryMetrics.urgentCount}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Action Req.</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-destructive">
            Critical / Expired
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-destructive">
              {summaryMetrics.criticalCount + summaryMetrics.expiredCount}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Breach Risk</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Liability</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-bold tracking-tight text-foreground truncate">
              ${(summaryMetrics.totalLiabilityLimit / 1000000).toFixed(1)}M
            </span>
            <span className="text-[10px] text-muted-foreground uppercase font-bold">CSL</span>
          </div>
        </div>
      </div>

      {/* 3. SECTION TABS & SEARCH / FILTER CONTROLS */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          <button
            type="button"
            onClick={() => setActiveTab("transportation")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              activeTab === "transportation"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <ShieldCheck className="size-3.5" />
            <span>Transportation Policies ({store.transportation.filter((t) => t.status !== "Archived").length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("workers")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              activeTab === "workers"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Briefcase className="size-3.5" />
            <span>Workers Comp / WCB ({store.workers.filter((w) => w.status !== "Archived").length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("bonds")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              activeTab === "bonds"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Award className="size-3.5" />
            <span>Surety Bonds ({store.bonds.filter((b) => b.status !== "Archived").length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              activeTab === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Layers className="size-3.5" />
            <span>All Records</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search policy #, insurer, broker..."
              className="h-8 w-60 rounded-xl border border-border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="size-3.5 rounded border-border text-primary focus:ring-primary"
            />
            <span>Show Historical / Archived</span>
          </label>
        </div>
      </div>

      {/* 4. TAB 1: TRANSPORTATION POLICIES (VIEW = RECORD) */}
      {(activeTab === "transportation" || activeTab === "all") && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Commercial Transportation Policies (Auto, Cargo, CGL, Umbrella)
            </h2>
            <span className="text-xs text-muted-foreground">
              {filteredTransportation.length} {filteredTransportation.length === 1 ? "policy" : "policies"} listed
            </span>
          </div>

          {filteredTransportation.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="size-8 text-muted-foreground/60" />}
              title="No Transportation Policies Found"
              description="Upload a Certificate of Insurance (COI) or manually add an Auto Liability, Cargo, or CGL policy."
              action={{
                label: "Add Transportation Policy",
                onClick: () => {
                  setEditingTransportation(null);
                  setIsRenewalMode(false);
                  setIsTransportationModalOpen(true);
                },
                icon: <Plus className="size-4" />,
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredTransportation.map((pol) => {
                const deadlineStatus = getDeadlineStatus(pol.expiryDate);
                const deadlineStyle = getDeadlineClasses(deadlineStatus);
                const daysRemaining = getDaysRemaining(pol.expiryDate);
                const linkedEvidence = pol.evidenceId ? store.evidence.find((e) => e.id === pol.evidenceId) : null;

                return (
                  <div
                    key={pol.id}
                    className={`rounded-2xl border bg-card p-5 shadow-xs transition-all flex flex-col justify-between ${
                      pol.status === "Archived"
                        ? "border-dashed border-border/80 opacity-75 bg-muted/20"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div>
                      {/* Card Header: Type, Status, Actions */}
                      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-foreground">{pol.insuranceType}</span>
                            {pol.groupId && (
                              <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase">
                                COI Group
                              </span>
                            )}
                            {pol.previousRecordId && (
                              <span className="rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 text-[10px] font-bold">
                                Renewed Lineage
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Policy #: <span className="font-mono font-bold text-foreground">{pol.policyNumber}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {pol.status === "Archived" ? (
                            <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-bold text-muted-foreground">
                              Archived
                            </span>
                          ) : (
                            <span
                              className={`rounded-md px-2.5 py-1 text-[11px] font-bold flex items-center gap-1.5 border ${deadlineStyle.badge}`}
                            >
                              <span className={`size-1.5 rounded-full ${deadlineStyle.indicator}`} />
                              {deadlineStatus}
                              {daysRemaining !== null && (
                                <span className="opacity-75 font-normal">
                                  ({daysRemaining < 0 ? `${Math.abs(daysRemaining)}d ago` : `${daysRemaining}d`})
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Document Presentation Standard: VIEW = RECORD */}
                      <div className="grid grid-cols-2 gap-3 py-3 text-xs">
                        <ReadOnlyField label="Insurer / Underwriter" value={pol.insurerName} />
                        <ReadOnlyField
                          label="Coverage Limit"
                          value={`$${(pol.coverageAmount || 0).toLocaleString()} CAD`}
                          badge={<span className="text-[10px] font-bold text-muted-foreground uppercase">Limit</span>}
                        />
                        <ReadOnlyField
                          label="Effective Date"
                          value={pol.effectiveDate}
                          mono
                        />
                        <ReadOnlyField
                          label="Expiry Date"
                          value={pol.expiryDate}
                          mono
                          badge={
                            pol.status !== "Archived" && daysRemaining !== null && daysRemaining <= 30 ? (
                              <span className="text-[10px] font-bold text-destructive flex items-center gap-0.5">
                                <AlertTriangle className="size-3" /> Expiry Approaching
                              </span>
                            ) : undefined
                          }
                        />
                      </div>

                      {/* Broker Section */}
                      {pol.broker && (
                        <div className="mt-2 rounded-xl bg-muted/40 p-3 border border-border/60 text-xs">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                              <Briefcase className="size-3" /> Brokerage Firm & Agent
                            </span>
                            {pol.status !== "Archived" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setBrokerTargetRecord(pol);
                                  setIsBrokerModalOpen(true);
                                }}
                                className="text-[11px] font-semibold text-primary hover:underline"
                              >
                                Edit Broker
                              </button>
                            )}
                          </div>
                          <div className="font-semibold text-foreground">{pol.broker.organizationName}</div>
                          {pol.broker.contactName && (
                            <div className="text-muted-foreground mt-0.5">
                              Agent: <span className="text-foreground">{pol.broker.contactName}</span>
                              {pol.broker.contactPhone && <span> • {pol.broker.contactPhone}</span>}
                              {pol.broker.contactEmail && <span> • {pol.broker.contactEmail}</span>}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Evidence Attachment Info */}
                      {linkedEvidence && (
                        <div className="mt-2 flex items-center justify-between rounded-xl border border-border/80 bg-card p-2.5 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileCheck2 className="size-4 text-emerald-600 shrink-0" />
                            <span className="font-semibold text-foreground truncate">{linkedEvidence.fileName}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0 uppercase font-bold">
                              ({linkedEvidence.source})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              recordAuditEvent({
                                action: "VIEW_DOCUMENT",
                                entityType: "Evidence",
                                entityId: linkedEvidence.id,
                                companyId,
                                role: "Compliance Administrator",
                                details: `Previewed secure evidence "${linkedEvidence.fileName}" for policy ${pol.policyNumber}.`,
                                actor: "System Administrator",
                              });
                              setPreviewEvidence(linkedEvidence);
                            }}
                            className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline shrink-0"
                          >
                            <Eye className="size-3.5" /> View Evidence
                          </button>
                        </div>
                      )}

                      {/* Archive Metadata if archived */}
                      {pol.status === "Archived" && pol.archiveReason && (
                        <div className="mt-2 text-[11px] text-muted-foreground bg-muted/60 p-2 rounded-lg">
                          <span className="font-bold">Archived:</span> {pol.archiveReason} ({pol.archivedAt?.split("T")[0]})
                        </div>
                      )}
                    </div>

                    {/* Card Actions Footer */}
                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {pol.status !== "Archived" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTransportation(pol);
                                setIsRenewalMode(false);
                                setIsTransportationModalOpen(true);
                              }}
                              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-semibold text-foreground hover:bg-muted transition-colors"
                            >
                              <Pencil className="size-3 text-muted-foreground" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTransportation(pol);
                                setIsRenewalMode(true);
                                setIsTransportationModalOpen(true);
                              }}
                              className="flex items-center gap-1 rounded-lg bg-primary/10 text-primary border border-primary/20 px-2.5 py-1.5 font-bold hover:bg-primary/20 transition-colors"
                            >
                              <RotateCcw className="size-3" /> Renew Policy
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRestoreRecord("transportation", pol.id, pol.policyNumber)}
                            className="flex items-center gap-1 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-1.5 font-bold hover:bg-emerald-500/20 transition-colors"
                          >
                            <RotateCcw className="size-3" /> Restore Policy
                          </button>
                        )}
                      </div>

                      {pol.status !== "Archived" && (
                        <button
                          type="button"
                          onClick={() =>
                            setArchiveTarget({
                              family: "transportation",
                              recordId: pol.id,
                              label: `Policy #${pol.policyNumber} (${pol.insuranceType})`,
                            })
                          }
                          className="text-[11px] font-semibold text-destructive hover:underline"
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 5. TAB 2: WORKERS COMPENSATION (WCB / WSIB) */}
      {(activeTab === "workers" || activeTab === "all") && (
        <div className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Workers Compensation Boards (WCB, WSIB, WorkSafe)
            </h2>
            <button
              type="button"
              onClick={() => {
                setEditingWorkers(null);
                setIsWorkersModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
            >
              <Plus className="size-3.5" /> Add WCB Account
            </button>
          </div>

          {filteredWorkers.length === 0 ? (
            <EmptyState
              icon={<Briefcase className="size-8 text-muted-foreground/60" />}
              title="No Workers Compensation Accounts Found"
              description="Add provincial/state Workers Compensation Board accounts (e.g. Ontario WSIB, WCB Alberta)."
              action={{
                label: "Add WCB Account",
                onClick: () => {
                  setEditingWorkers(null);
                  setIsWorkersModalOpen(true);
                },
                icon: <Plus className="size-4" />,
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {filteredWorkers.map((wcb) => {
                const deadlineStatus = getDeadlineStatus(wcb.expiryDate);
                const deadlineStyle = getDeadlineClasses(deadlineStatus);
                const daysRemaining = getDaysRemaining(wcb.expiryDate);
                const linkedEvidence = wcb.evidenceId ? store.evidence.find((e) => e.id === wcb.evidenceId) : null;

                return (
                  <div
                    key={wcb.id}
                    className={`rounded-2xl border bg-card p-5 shadow-xs transition-all flex flex-col justify-between ${
                      wcb.status === "Archived"
                        ? "border-dashed border-border/80 opacity-75 bg-muted/20"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 border-b border-border pb-2.5">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-bold">
                              {wcb.jurisdiction}
                            </span>
                            <span className="text-sm font-bold text-foreground">{wcb.providerName}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Acct #: <span className="font-mono font-bold text-foreground">{wcb.accountNumber}</span>
                          </div>
                        </div>

                        {wcb.status === "Archived" ? (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                            Archived
                          </span>
                        ) : (
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 border ${deadlineStyle.badge}`}
                          >
                            <span className={`size-1.5 rounded-full ${deadlineStyle.indicator}`} />
                            {deadlineStatus}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 py-3 text-xs">
                        <ReadOnlyField label="Effective" value={wcb.effectiveDate} mono />
                        <ReadOnlyField label="Expiry / Clearance" value={wcb.expiryDate} mono />
                      </div>

                      {linkedEvidence && (
                        <div className="mt-1 flex items-center justify-between rounded-xl border border-border bg-card p-2 text-xs">
                          <span className="truncate text-muted-foreground font-medium">{linkedEvidence.fileName}</span>
                          <button
                            type="button"
                            onClick={() => {
                              recordAuditEvent({
                                action: "VIEW_DOCUMENT",
                                entityType: "Evidence",
                                entityId: linkedEvidence.id,
                                companyId,
                                role: "Compliance Administrator",
                                details: `Previewed WCB clearance document for ${wcb.jurisdiction} account ${wcb.accountNumber}.`,
                                actor: "System Administrator",
                              });
                              setPreviewEvidence(linkedEvidence);
                            }}
                            className="text-primary font-bold hover:underline shrink-0 text-[11px]"
                          >
                            View
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs">
                      {wcb.status !== "Archived" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingWorkers(wcb);
                              setIsWorkersModalOpen(true);
                            }}
                            className="font-semibold text-foreground hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setArchiveTarget({
                                family: "workers",
                                recordId: wcb.id,
                                label: `WCB ${wcb.jurisdiction} Acct #${wcb.accountNumber}`,
                              })
                            }
                            className="text-[11px] font-semibold text-destructive hover:underline"
                          >
                            Archive
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRestoreRecord("workers", wcb.id, wcb.accountNumber)}
                          className="text-emerald-600 font-bold hover:underline"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 6. TAB 3: SURETY BONDS */}
      {(activeTab === "bonds" || activeTab === "all") && (
        <div className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Surety Bonds (BMC-84 Freight Broker, Customs In-Transit, Performance)
            </h2>
            <button
              type="button"
              onClick={() => {
                setEditingBond(null);
                setIsBondModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
            >
              <Plus className="size-3.5" /> Add Surety Bond
            </button>
          </div>

          {filteredBonds.length === 0 ? (
            <EmptyState
              icon={<Award className="size-8 text-muted-foreground/60" />}
              title="No Surety Bonds Found"
              description="Register continuous freight broker bonds (FMCSA BMC-84) or customs carrier bonds."
              action={{
                label: "Add Surety Bond",
                onClick: () => {
                  setEditingBond(null);
                  setIsBondModalOpen(true);
                },
                icon: <Plus className="size-4" />,
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {filteredBonds.map((bond) => {
                const deadlineStatus = bond.expiryDate ? getDeadlineStatus(bond.expiryDate) : "No Deadline";
                const deadlineStyle = getDeadlineClasses(deadlineStatus);
                const linkedEvidence = bond.evidenceId ? store.evidence.find((e) => e.id === bond.evidenceId) : null;

                return (
                  <div
                    key={bond.id}
                    className={`rounded-2xl border bg-card p-5 shadow-xs transition-all flex flex-col justify-between ${
                      bond.status === "Archived"
                        ? "border-dashed border-border/80 opacity-75 bg-muted/20"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 border-b border-border pb-2.5">
                        <div>
                          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase">
                            {bond.bondType}
                          </span>
                          <div className="text-sm font-bold text-foreground mt-1">{bond.suretyName}</div>
                          <div className="text-xs text-muted-foreground">
                            Bond #: <span className="font-mono font-bold text-foreground">{bond.bondNumber}</span>
                          </div>
                        </div>

                        {bond.status === "Archived" ? (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                            Archived
                          </span>
                        ) : (
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 border ${deadlineStyle.badge}`}
                          >
                            <span className={`size-1.5 rounded-full ${deadlineStyle.indicator}`} />
                            {deadlineStatus}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 py-3 text-xs">
                        <ReadOnlyField
                          label="Bond Amount"
                          value={`$${Number(bond.bondAmount).toLocaleString()}`}
                          badge={<span className="text-[10px] font-bold text-muted-foreground">USD</span>}
                        />
                        <ReadOnlyField label="Principal" value={bond.principalName} />
                        <ReadOnlyField label="Effective" value={bond.effectiveDate} mono />
                        <ReadOnlyField label="Expiry" value={bond.expiryDate || "Continuous"} mono />
                      </div>

                      {linkedEvidence && (
                        <div className="mt-1 flex items-center justify-between rounded-xl border border-border bg-card p-2 text-xs">
                          <span className="truncate text-muted-foreground font-medium">{linkedEvidence.fileName}</span>
                          <button
                            type="button"
                            onClick={() => {
                              recordAuditEvent({
                                action: "VIEW_DOCUMENT",
                                entityType: "Evidence",
                                entityId: linkedEvidence.id,
                                companyId,
                                role: "Compliance Administrator",
                                details: `Previewed Surety Bond evidence for bond #${bond.bondNumber}.`,
                                actor: "System Administrator",
                              });
                              setPreviewEvidence(linkedEvidence);
                            }}
                            className="text-primary font-bold hover:underline shrink-0 text-[11px]"
                          >
                            View
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs">
                      {bond.status !== "Archived" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBond(bond);
                              setIsBondModalOpen(true);
                            }}
                            className="font-semibold text-foreground hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setArchiveTarget({
                                family: "bonds",
                                recordId: bond.id,
                                label: `Surety Bond #${bond.bondNumber} (${bond.bondType})`,
                              })
                            }
                            className="text-[11px] font-semibold text-destructive hover:underline"
                          >
                            Archive
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRestoreRecord("bonds", bond.id, bond.bondNumber)}
                          className="text-emerald-600 font-bold hover:underline"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. MODALS & FORMS (CREATE / EDIT = FORM)                                 */}
      {/* ========================================================================= */}

      {/* MODAL 1: TRANSPORTATION POLICY FORM */}
      {isTransportationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  {isRenewalMode
                    ? `Renew Policy: ${editingTransportation?.policyNumber}`
                    : editingTransportation
                    ? "Edit Transportation Policy"
                    : "Add Commercial Transportation Policy"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsTransportationModalOpen(false);
                  setEditingTransportation(null);
                  setIsRenewalMode(false);
                }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTransportation} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Coverage Type *</label>
                  <select
                    name="insuranceType"
                    defaultValue={editingTransportation?.insuranceType || "Auto Liability"}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  >
                    <option value="Auto Liability">Auto Liability (Primary Commercial)</option>
                    <option value="Motor Truck Cargo">Motor Truck Cargo (Broad Form)</option>
                    <option value="General Liability">Commercial General Liability (CGL)</option>
                    <option value="Physical Damage">Physical Damage (Collision/Comp)</option>
                    <option value="Umbrella / Excess">Umbrella / Excess Liability</option>
                    <option value="Trailer Interchange">Trailer Interchange / Non-Owned</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-foreground">Policy Number *</label>
                  <input
                    type="text"
                    name="policyNumber"
                    defaultValue={isRenewalMode ? "" : editingTransportation?.policyNumber || ""}
                    placeholder="e.g. NBC-998201-26"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Insurer / Underwriter *</label>
                  <input
                    type="text"
                    name="insurerName"
                    defaultValue={editingTransportation?.insurerName || ""}
                    placeholder="e.g. Northbridge General Insurance"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                  <span className="text-[10px] text-muted-foreground">Will resolve to canonical Company master.</span>
                </div>

                <div>
                  <label className="font-bold text-foreground">Coverage Limit ($ CAD) *</label>
                  <input
                    type="number"
                    name="coverageAmount"
                    defaultValue={editingTransportation?.coverageAmount || 2000000}
                    step="50000"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Effective Date *</label>
                  <input
                    type="date"
                    name="effectiveDate"
                    defaultValue={isRenewalMode ? editingTransportation?.expiryDate : editingTransportation?.effectiveDate || new Date().toISOString().split("T")[0]}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-foreground">Expiry Date *</label>
                  <input
                    type="date"
                    name="expiryDate"
                    defaultValue={isRenewalMode ? "" : editingTransportation?.expiryDate || ""}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              {/* Broker Section */}
              <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                <div className="font-bold text-foreground text-xs flex items-center gap-1.5">
                  <Briefcase className="size-3.5 text-primary" /> Brokerage Details (Optional)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-muted-foreground">Brokerage Firm</label>
                    <input
                      type="text"
                      name="brokerOrg"
                      defaultValue={editingTransportation?.broker?.organizationName || ""}
                      placeholder="e.g. Hub International Ltd."
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-muted-foreground">Broker Agent Name</label>
                    <input
                      type="text"
                      name="brokerAgent"
                      defaultValue={editingTransportation?.broker?.contactName || ""}
                      placeholder="e.g. Sarah Jenkins"
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-muted-foreground">Agent Phone</label>
                    <input
                      type="text"
                      name="brokerPhone"
                      defaultValue={editingTransportation?.broker?.contactPhone || ""}
                      placeholder="(416) 555-0199"
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-muted-foreground">Agent Email</label>
                    <input
                      type="email"
                      name="brokerEmail"
                      defaultValue={editingTransportation?.broker?.contactEmail || ""}
                      placeholder="agent@broker.com"
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="font-bold text-foreground">Operational Notes</label>
                <textarea
                  name="notes"
                  defaultValue={editingTransportation?.notes || ""}
                  rows={2}
                  placeholder="e.g. Scheduled vehicle endorsement attached. $2,500 deductible on cargo."
                  className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setIsTransportationModalOpen(false);
                    setEditingTransportation(null);
                    setIsRenewalMode(false);
                  }}
                  className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  {isRenewalMode ? "Save Renewal Policy" : editingTransportation ? "Update Policy" : "Save Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: WORKERS COMPENSATION (WCB) FORM */}
      {isWorkersModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Briefcase className="size-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  {editingWorkers ? "Edit WCB Account" : "Add Workers Compensation Account"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsWorkersModalOpen(false);
                  setEditingWorkers(null);
                }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveWorkers} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Jurisdiction *</label>
                  <select
                    name="jurisdiction"
                    defaultValue={editingWorkers?.jurisdiction || "ON"}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  >
                    {JURISDICTIONS.map((j) => (
                      <option key={j.code} value={j.code}>
                        {j.code} — {j.label} ({j.country})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-foreground">Account / Policy # *</label>
                  <input
                    type="text"
                    name="accountNumber"
                    defaultValue={editingWorkers?.accountNumber || ""}
                    placeholder="e.g. 9820194"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-foreground">Provider / Board Name *</label>
                <input
                  type="text"
                  name="providerName"
                  defaultValue={editingWorkers?.providerName || "Workplace Safety and Insurance Board (WSIB)"}
                  placeholder="e.g. WSIB Ontario or WCB Alberta"
                  className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Effective Date *</label>
                  <input
                    type="date"
                    name="effectiveDate"
                    defaultValue={editingWorkers?.effectiveDate || new Date().toISOString().split("T")[0]}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-foreground">Expiry / Clearance Expiry *</label>
                  <input
                    type="date"
                    name="expiryDate"
                    defaultValue={editingWorkers?.expiryDate || ""}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-foreground">Notes</label>
                <textarea
                  name="notes"
                  defaultValue={editingWorkers?.notes || ""}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkersModalOpen(false);
                    setEditingWorkers(null);
                  }}
                  className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  {editingWorkers ? "Update WCB Account" : "Save WCB Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: SURETY BOND FORM */}
      {isBondModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Award className="size-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  {editingBond ? "Edit Surety Bond" : "Add Surety Bond"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsBondModalOpen(false);
                  setEditingBond(null);
                }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBond} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Bond Type *</label>
                  <select
                    name="bondType"
                    defaultValue={editingBond?.bondType || "BMC-84 (Freight Broker)"}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  >
                    <option value="BMC-84 (Freight Broker)">BMC-84 (Freight Broker $75K)</option>
                    <option value="Customs / In-Transit Bond">Customs / In-Transit Carrier Bond</option>
                    <option value="Performance Bond">Performance Bond</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-foreground">Bond Number *</label>
                  <input
                    type="text"
                    name="bondNumber"
                    defaultValue={editingBond?.bondNumber || ""}
                    placeholder="e.g. BND-88301-A"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Surety Organization *</label>
                  <input
                    type="text"
                    name="suretyName"
                    defaultValue={editingBond?.suretyName || ""}
                    placeholder="e.g. Travelers Casualty and Surety Company"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-foreground">Bond Amount ($ USD) *</label>
                  <input
                    type="number"
                    name="bondAmount"
                    defaultValue={editingBond?.bondAmount || 75000}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Effective Date *</label>
                  <input
                    type="date"
                    name="effectiveDate"
                    defaultValue={editingBond?.effectiveDate || new Date().toISOString().split("T")[0]}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-foreground">Expiry Date (Optional / Continuous)</label>
                  <input
                    type="date"
                    name="expiryDate"
                    defaultValue={editingBond?.expiryDate || ""}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setIsBondModalOpen(false);
                    setEditingBond(null);
                  }}
                  className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  {editingBond ? "Update Bond" : "Save Bond"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: BROKER UPDATE MODAL (WITH COI GROUP CASCADE) */}
      {isBrokerModalOpen && brokerTargetRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Briefcase className="size-4 text-primary" /> Update Broker Details
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsBrokerModalOpen(false);
                  setBrokerTargetRecord(null);
                }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBrokerUpdate} className="p-6 space-y-3.5 text-xs">
              <div>
                <label className="font-bold text-foreground">Brokerage Firm Name *</label>
                <input
                  type="text"
                  name="brokerOrg"
                  defaultValue={brokerTargetRecord.broker?.organizationName || ""}
                  placeholder="e.g. Hub International Ltd."
                  className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-foreground">Broker Agent Name</label>
                <input
                  type="text"
                  name="brokerAgent"
                  defaultValue={brokerTargetRecord.broker?.contactName || ""}
                  placeholder="e.g. Sarah Jenkins"
                  className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-foreground">Phone</label>
                  <input
                    type="text"
                    name="brokerPhone"
                    defaultValue={brokerTargetRecord.broker?.contactPhone || ""}
                    placeholder="(416) 555-0199"
                    className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                </div>
                <div>
                  <label className="font-bold text-foreground">Email</label>
                  <input
                    type="email"
                    name="brokerEmail"
                    defaultValue={brokerTargetRecord.broker?.contactEmail || ""}
                    placeholder="agent@hub.com"
                    className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                </div>
              </div>

              {brokerTargetRecord.groupId && (
                <div className="mt-2 rounded-xl bg-primary/10 border border-primary/20 p-3 flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    name="applyToGroup"
                    defaultChecked
                    id="applyToGroupCheckbox"
                    className="size-4 rounded border-border text-primary focus:ring-primary mt-0.5"
                  />
                  <label htmlFor="applyToGroupCheckbox" className="text-xs text-foreground cursor-pointer">
                    <span className="font-bold block">Apply to all policies in this Certificate (COI Group)</span>
                    <span className="text-muted-foreground text-[11px]">
                      Synchronizes this broker to Auto Liability, Cargo, and CGL sharing group {brokerTargetRecord.groupId}.
                    </span>
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setIsBrokerModalOpen(false);
                    setBrokerTargetRecord(null);
                  }}
                  className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  Save Broker
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: ARCHIVE REASON PROMPT */}
      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center gap-3 text-destructive">
              <Archive className="size-6 shrink-0" />
              <div>
                <h3 className="text-base font-bold text-foreground">Archive Insurance Record</h3>
                <p className="text-xs text-muted-foreground">{archiveTarget.label}</p>
              </div>
            </div>

            <p className="text-muted-foreground leading-relaxed">
              Archived records are retained permanently and remain available for authorized historical review.
            </p>

            <div>
              <label className="font-bold text-foreground block mb-1">Reason for Archival *</label>
              <textarea
                value={archiveReasonText}
                onChange={(e) => setArchiveReasonText(e.target.value)}
                placeholder="e.g. Policy superseded by annual renewal, carrier replaced, or vehicle removed."
                rows={3}
                className="w-full rounded-xl border border-border bg-background p-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setArchiveTarget(null);
                  setArchiveReasonText("");
                }}
                className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmArchive}
                className="rounded-xl bg-destructive px-5 py-2 font-bold text-destructive-foreground shadow-sm hover:bg-destructive/90 transition-colors"
              >
                Archive Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: CANONICAL ORGANIZATION RESOLUTION (FUZZY MATCH & EXPLICIT NEW CONFIRMATION) */}
      {orgResolutionPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 text-xs">
            {orgResolutionPrompt.mode === "FUZZY_CANDIDATES" ? (
              <>
                <div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-5 shrink-0" />
                  <h3 className="text-base font-bold text-foreground">Probable Organization Match Found</h3>
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  You entered &ldquo;<span className="font-bold text-foreground">{orgResolutionPrompt.inputName}</span>&rdquo;. Similar
                  canonical organizations already exist in the Company Master registry. Please select whether to reuse an
                  existing entity or register a new distinct organization:
                </p>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {orgResolutionPrompt.candidates.map((cand) => (
                    <div
                      key={cand.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 transition-colors"
                    >
                      <div>
                        <div className="font-bold text-foreground">{cand.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          ID: {cand.id} • Kind: {cand.kind || "Organization"} • Status: {cand.status || "Active"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => orgResolutionPrompt.onResolve({ id: cand.id, name: cand.name })}
                        className="rounded-lg bg-primary px-3 py-1.5 font-bold text-primary-foreground hover:bg-primary/90 text-xs"
                      >
                        Use Existing
                      </button>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-border flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      const created = handleCreateCanonicalCompany(orgResolutionPrompt.inputName, orgResolutionPrompt.kind);
                      orgResolutionPrompt.onResolve(created);
                    }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Create &ldquo;{orgResolutionPrompt.inputName}&rdquo; as New Organization
                  </button>

                  <button
                    type="button"
                    onClick={() => orgResolutionPrompt.onResolve(null)}
                    className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 text-primary">
                  <Building2 className="size-5 shrink-0" />
                  <h3 className="text-base font-bold text-foreground">Confirm New Organization Registration</h3>
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  No existing organization appears to match: &ldquo;<span className="font-bold text-foreground">{orgResolutionPrompt.inputName}</span>&rdquo;.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Create this as a new <span className="font-bold text-foreground">{orgResolutionPrompt.kind}</span> in Company Master?
                </p>

                <div className="pt-3 border-t border-border flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => orgResolutionPrompt.onResolve(null)}
                    className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const created = handleCreateCanonicalCompany(orgResolutionPrompt.inputName, orgResolutionPrompt.kind);
                      orgResolutionPrompt.onResolve(created);
                    }}
                    className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground hover:bg-primary/90 text-xs shadow-xs"
                  >
                    Create New Organization
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODAL 7: SHARED DOCUMENT SOURCE PICKER */}
      <DocumentSourcePicker
        isOpen={isSourcePickerOpen}
        onClose={() => setIsSourcePickerOpen(false)}
        title={`Attach Document: ${documentTargetDescription}`}
        onSelectCamera={() => setIsCameraOpen(true)}
        onSelectFile={(file) => {
          handleStartOCRWorkflow(file);
        }}
      />

      {/* MODAL 8: LIVE CAMERA CAPTURE */}
      {isCameraOpen && (
        <CameraCapture
          onCapture={(file) => {
            setIsCameraOpen(false);
            handleStartOCRWorkflow(file);
          }}
          onClose={() => setIsCameraOpen(false)}
        />
      )}

      {/* MODAL 9: OCR EXTRACTION & SPLIT-SCREEN REVIEW WORKSPACE */}
      {isOCRReviewOpen && ocrDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-5xl h-[85vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-3.5 bg-muted/20">
              <div className="flex items-center gap-2.5">
                <Sparkles className="size-5 text-primary" />
                <div>
                  <h3 className="text-base font-bold text-foreground">Certificate of Insurance (COI) OCR Review</h3>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    <span>Confidence: {(ocrDraft.confidence * 100).toFixed(0)}% (Verified Prototype)</span>
                    <span>•</span>
                    <span>Verify extracted fields before committing to Insurance Register</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOCRReviewOpen(false);
                  setOcrDraft(null);
                }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
              {/* Left Column: Secure Document Viewer */}
              <div className="border-r border-border h-full overflow-hidden bg-muted/10 p-3">
                <SecureDocumentViewer
                  fileName={ocrDraft.evidence.fileName}
                  mimeType={ocrDraft.evidence.fileType}
                  dataUrl={ocrDraft.evidence.dataUrl}
                  documentTitle="Extracted COI Certificate"
                  documentDate={ocrDraft.effectiveDate}
                  ocrConfidence={ocrDraft.confidence}
                  watermarkContext={{
                    viewerName: "Compliance Officer",
                    viewerRole: "Compliance Administrator",
                    companyName: company?.name || "Carrier Master",
                    timestamp: new Date().toISOString(),
                  }}
                />
              </div>

              {/* Right Column: Editable Review Form */}
              <form onSubmit={handleCommitOCR} className="p-6 space-y-4 overflow-y-auto h-full text-xs">
                <div className="rounded-xl bg-primary/10 border border-primary/20 p-3 text-xs text-primary font-medium">
                  Multi-line policy extraction: Committing will automatically create linked records for Auto Liability,
                  Cargo, and CGL sharing a single COI Group.
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-foreground">Insurer Name</label>
                    <input
                      type="text"
                      name="insurerName"
                      defaultValue={ocrDraft.insurerName}
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="font-bold text-foreground">Master Policy Number</label>
                    <input
                      type="text"
                      name="policyNumber"
                      defaultValue={ocrDraft.policyNumber}
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-foreground">Effective Date</label>
                    <input
                      type="date"
                      name="effectiveDate"
                      defaultValue={ocrDraft.effectiveDate}
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="font-bold text-foreground">Expiry Date</label>
                    <input
                      type="date"
                      name="expiryDate"
                      defaultValue={ocrDraft.expiryDate}
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <span className="font-bold text-foreground block">Extracted Coverage Limits ($ CAD)</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-muted-foreground font-semibold">Auto Liability Limit</label>
                      <input
                        type="number"
                        name="autoLiabilityLimit"
                        defaultValue={ocrDraft.autoLiabilityLimit}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground font-semibold">Cargo Limit</label>
                      <input
                        type="number"
                        name="cargoLimit"
                        defaultValue={ocrDraft.cargoLimit}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground font-semibold">Commercial General Liability</label>
                      <input
                        type="number"
                        name="generalLiabilityLimit"
                        defaultValue={ocrDraft.generalLiabilityLimit}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <span className="font-bold text-foreground block">Broker Information</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-muted-foreground font-semibold">Brokerage Firm</label>
                      <input
                        type="text"
                        name="brokerOrgName"
                        defaultValue={ocrDraft.brokerOrgName}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground font-semibold">Broker Agent</label>
                      <input
                        type="text"
                        name="brokerAgentName"
                        defaultValue={ocrDraft.brokerAgentName}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-muted-foreground font-semibold">Phone</label>
                      <input
                        type="text"
                        name="brokerPhone"
                        defaultValue={ocrDraft.brokerPhone}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground font-semibold">Email</label>
                      <input
                        type="email"
                        name="brokerEmail"
                        defaultValue={ocrDraft.brokerEmail}
                        className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsOCRReviewOpen(false);
                      setOcrDraft(null);
                    }}
                    className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Discard
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                  >
                    Commit Verified Certificate
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 10: SECURE DOCUMENT VIEWER MODAL */}
      {previewEvidence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-4xl h-[90vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-3 bg-muted/20">
              <div className="flex items-center gap-2">
                <FileCheck2 className="size-4 text-emerald-600" />
                <span className="text-sm font-bold text-foreground truncate">{previewEvidence.fileName}</span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewEvidence(null)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-3 bg-muted/10">
              <SecureDocumentViewer
                fileName={previewEvidence.fileName}
                mimeType={previewEvidence.fileType}
                dataUrl={previewEvidence.dataUrl}
                documentTitle="Secure Insurance Compliance Evidence"
                documentDate={previewEvidence.uploadedAt}
                watermarkContext={{
                  viewerName: "Compliance Officer",
                  viewerRole: "Compliance Administrator",
                  companyName: company?.name || "Carrier Master",
                  timestamp: new Date().toISOString(),
                }}
                onClose={() => setPreviewEvidence(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
