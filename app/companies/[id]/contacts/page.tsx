"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  History,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  User,
  UserCheck,
  UserPlus,
  Users,
  X,
  ChevronRight,
  Archive,
  RefreshCw,
  FolderOpen,
} from "lucide-react";

// --- Shared Foundation Components (Phase 1 Approved) ---
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { LoadingState, EmptyState } from "@/src/components/shared/StateDisplays";
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker";
import { CameraCapture } from "@/src/components/CameraCapture";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";

// --- Types & Interfaces ---

export type Evidence = {
  id: string; // "DOC-..."
  type: "Driver Licence" | "Government ID" | "Other";
  fileName: string;
  fileType: string;
  uploadedAt: string;
  documentDate?: string;
  confidence?: number;
  status: "uploaded" | "review_required" | "verified" | "rejected";
  source: "camera" | "device";
  dataUrl?: string;
};

export type Relationship = {
  id: string; // "REL-..."
  companyId: string;
  companyName: string;
  role: string;
  isPrimary?: boolean;
  status: "active" | "ended";
  startDate: string;
  endDate?: string;
  source: "manual" | "document" | "system";
};

export type ContactEvent = {
  id: string; // "EVT-..."
  timestamp: string;
  action:
    | "CREATED"
    | "PRIMARY_CHANGED"
    | "ROLE_UPDATED"
    | "STATUS_CHANGED"
    | "DOCUMENT_ATTACHED"
    | "CONTACT_UPDATED"
    | "RELATIONSHIP_ADDED"
    | "ARCHIVED"
    | "RESTORED";
  summary: string;
  actor: string;
};

export type Contact = {
  id: string; // "CNT-..."
  globalId: string; // "USR-..."
  firstName: string;
  lastName: string;
  dob: string;
  dlNumber: string;
  dlState: string;
  dlExpiry: string;
  dlIssueDate: string;
  dlClass: string;
  dlRestrictions: string;
  email: string;
  phone: string;
  role: string;
  isPrimary: boolean;
  isArchived: boolean;
  notes: string;
  identityStatus: "unverified" | "documented" | "review_required";
  identityConfidence?: number;
  relationships: Relationship[];
  evidence: Evidence[];
  events: ContactEvent[];
  createdAt: string;
  updatedAt: string;
};

export type OCRFieldConfidence = {
  value: string;
  confidence: number;
};

export type OCRReviewDraft = {
  firstName: OCRFieldConfidence;
  lastName: OCRFieldConfidence;
  dob: OCRFieldConfidence;
  dlNumber: OCRFieldConfidence;
  dlState: OCRFieldConfidence;
  dlExpiry: OCRFieldConfidence;
  dlIssueDate: OCRFieldConfidence;
  dlClass: OCRFieldConfidence;
  dlRestrictions: OCRFieldConfidence;
  email: OCRFieldConfidence;
  phone: OCRFieldConfidence;
  role: string;
  isPrimary: boolean;
  evidence: Evidence;
};

// --- Strict Contact Normalizers (Preserved for Duplicate Identity Resolution) ---
export function normalizeLicence(value?: string | null): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeEmail(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizePhone(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeName(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// --- ID Generators ---
export function generateContactId(): string {
  return `CNT-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateGlobalUserId(): string {
  return `USR-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateRelationshipId(): string {
  return `REL-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateEvidenceId(): string {
  return `DOC-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateEventId(): string {
  return `EVT-${Math.floor(10000 + Math.random() * 90000)}`;
}

// --- Jurisdiction Constants ---
export const CANADIAN_PROVINCES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"
];
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];
export const ALL_JURISDICTIONS = [...CANADIAN_PROVINCES, ...US_STATES];

export const STANDARD_ROLES = [
  "Primary Contact",
  "Director",
  "Safety Manager",
  "Fleet Manager",
  "Compliance Officer",
  "Dispatcher",
  "Billing / Accounting",
  "Driver",
  "Owner / Operator",
  "General Contact",
];

// --- 3-Year Visibility Cutoff Helper ---
export function isWithinThreeYears(dateString?: string): boolean {
  if (!dateString) return true;
  const docDate = new Date(dateString);
  if (isNaN(docDate.getTime())) return true;
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  return docDate >= threeYearsAgo;
}

// --- Duplicate Resolution Business Rule ---
export function findDuplicateContact(
  draft: {
    firstName?: string;
    lastName?: string;
    dob?: string;
    dlNumber?: string;
    email?: string;
    phone?: string;
  },
  contacts: Contact[],
  excludeId?: string
): { match: Contact | null; reason: string | null } {
  const dl = normalizeLicence(draft.dlNumber);
  const email = normalizeEmail(draft.email);
  const phone = normalizePhone(draft.phone);
  const fullName = normalizeName(`${draft.firstName || ""}${draft.lastName || ""}`);
  const dob = draft.dob?.trim();

  for (const c of contacts) {
    if (excludeId && c.id === excludeId) continue;

    // 1. Exact Driver Licence match (Strongest Identity Signal)
    if (dl && normalizeLicence(c.dlNumber) === dl) {
      return { match: c, reason: `Matching Driver Licence Number (${draft.dlNumber})` };
    }

    // 2. Exact Email match
    if (email && normalizeEmail(c.email) === email) {
      return { match: c, reason: `Matching Email Address (${draft.email})` };
    }

    // 3. Exact Phone match (>= 7 digits)
    if (phone && phone.length >= 7 && normalizePhone(c.phone) === phone) {
      return { match: c, reason: `Matching Phone Number (${draft.phone})` };
    }

    // 4. Exact Full Name + Date of Birth compound match
    if (fullName && dob && c.dob && normalizeName(`${c.firstName}${c.lastName}`) === fullName && c.dob === dob) {
      return { match: c, reason: `Matching Full Name & Date of Birth (${c.firstName} ${c.lastName}, DOB: ${dob})` };
    }
  }

  return { match: null, reason: null };
}

// --- Primary Contact Enforcement Business Rule ---
export function applyPrimaryRule(
  updatedContact: Contact,
  companyId: string,
  allContacts: Contact[],
  companyName: string
): Contact[] {
  const currentRel = updatedContact.relationships.find((r) => r.companyId === companyId);
  const isNowPrimary = !!currentRel?.isPrimary;

  if (!isNowPrimary) {
    return allContacts.map((c) => (c.id === updatedContact.id ? updatedContact : c));
  }

  // If this contact is now primary, demote any other contact for this company
  return allContacts.map((c) => {
    if (c.id === updatedContact.id) {
      return updatedContact;
    }

    const relIndex = c.relationships.findIndex((r) => r.companyId === companyId);
    if (relIndex !== -1 && c.relationships[relIndex].isPrimary) {
      const updatedRelationships = [...c.relationships];
      updatedRelationships[relIndex] = {
        ...updatedRelationships[relIndex],
        isPrimary: false,
      };

      const demotionEvent: ContactEvent = {
        id: generateEventId(),
        timestamp: new Date().toISOString(),
        action: "PRIMARY_CHANGED",
        summary: `Primary contact designation transferred to ${updatedContact.firstName} ${updatedContact.lastName} at ${companyName}.`,
        actor: "System Administrator",
      };

      return {
        ...c,
        isPrimary: false,
        relationships: updatedRelationships,
        events: [demotionEvent, ...(c.events || [])],
        updatedAt: new Date().toISOString(),
      };
    }

    return c;
  });
}

// --- OCR Demo Extraction Simulator (85% Threshold Invariant) ---
export const OCR_REQUIRED_THRESHOLD = 85;

export function simulateOCRExtraction(
  file: File,
  dataUrl: string,
  source: "camera" | "device" = "device"
): OCRReviewDraft {
  const isHighQuality = file.size > 20000;
  return {
    firstName: { value: "Amandeep", confidence: isHighQuality ? 94 : 82 },
    lastName: { value: "Dhillon", confidence: isHighQuality ? 96 : 88 },
    dob: { value: "1988-04-12", confidence: isHighQuality ? 92 : 79 },
    dlNumber: { value: "D4928-19482-94819", confidence: isHighQuality ? 91 : 86 },
    dlState: { value: "ON", confidence: 98 },
    dlExpiry: { value: "2028-04-12", confidence: isHighQuality ? 90 : 81 },
    dlIssueDate: { value: "2023-04-10", confidence: 89 },
    dlClass: { value: "Class A / AZ", confidence: 95 },
    dlRestrictions: { value: "Condition 1 / Corrective Lenses", confidence: 87 },
    email: { value: "", confidence: 100 },
    phone: { value: "", confidence: 100 },
    role: "Safety Manager",
    isPrimary: false,
    evidence: {
      id: generateEvidenceId(),
      type: "Driver Licence",
      fileName: file.name || (source === "camera" ? "camera-id-capture.jpg" : "id-scan.jpg"),
      fileType: file.type || "image/jpeg",
      uploadedAt: new Date().toISOString(),
      documentDate: "2023-04-10",
      confidence: isHighQuality ? 93 : 84,
      status: isHighQuality ? "verified" : "review_required",
      source,
      dataUrl,
    },
  };
}

// =========================================================================
// MAIN CONTACTS PAGE COMPONENT
// =========================================================================

export default function ContactsPage() {
  const params = useParams<{ id: string }>();
  const companyId = params?.id;

  const [company, setCompany] = useState<any>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showOlderEvidence, setShowOlderEvidence] = useState(false);

  // Inspector & Modal State
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<Contact> & { companyRole?: string; isPrimary?: boolean }>({});
  const [editFormErrors, setEditFormErrors] = useState<Record<string, string>>({});
  const [editDuplicateWarning, setEditDuplicateWarning] = useState<string | null>(null);

  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isOCRWorkspaceOpen, setIsOCRWorkspaceOpen] = useState(false);
  const [ocrDraft, setOcrDraft] = useState<OCRReviewDraft | null>(null);
  const [ocrValidationError, setOcrValidationError] = useState<string | null>(null);

  // Document Viewer Modal State
  const [previewEvidence, setPreviewEvidence] = useState<Evidence | null>(null);

  // Manual Form State
  const [manualForm, setManualForm] = useState({
    firstName: "",
    lastName: "",
    dob: "",
    dlNumber: "",
    dlState: "ON",
    dlExpiry: "",
    dlIssueDate: "",
    dlClass: "",
    dlRestrictions: "",
    email: "",
    phone: "",
    role: "Safety Manager",
    isPrimary: false,
    notes: "",
  });
  const [manualFormErrors, setManualFormErrors] = useState<Record<string, string>>({});
  const [manualDuplicateWarning, setManualDuplicateWarning] = useState<string | null>(null);

  // 1. Load Data with V5 -> V4 -> V3 fallback
  useEffect(() => {
    try {
      if (!companyId) {
        setLoading(false);
        return;
      }

      // Load Company
      const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]");
      const foundCompany = savedCompanies.find((c: any) => c.id === companyId);
      setCompany(foundCompany || null);

      // Load Contacts (v5 canonical, fallback to v4 / v3)
      let rawContacts = localStorage.getItem("tes_contacts_v5");
      if (!rawContacts) {
        rawContacts = localStorage.getItem("tes_contacts_v4") || localStorage.getItem("tes_contacts_v3");
      }
      const loaded: Contact[] = rawContacts ? JSON.parse(rawContacts) : [];
      setContacts(loaded);

      // 2. Handle Deep Link (?contact=CNT-XXXX)
      if (typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search);
        const deepContactId = urlParams.get("contact");
        if (deepContactId) {
          const match = loaded.find(
            (c) =>
              c.id === deepContactId &&
              c.relationships?.some((r) => r.companyId === companyId && r.status !== "ended")
          );
          if (match) {
            setSelectedContactId(match.id);
          }
        }
      }
    } catch (e) {
      console.error("Error loading contacts:", e);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Save contacts helper (Writes strictly to tes_contacts_v5)
  const persistContacts = (updated: Contact[]) => {
    setContacts(updated);
    try {
      localStorage.setItem("tes_contacts_v5", JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to persist contacts to tes_contacts_v5", e);
    }
  };

  // Synchronize deep-link search parameter on selection change
  const handleSelectContact = (id: string | null) => {
    setSelectedContactId(id);
    setIsEditing(false);
    setEditFormErrors({});
    setEditDuplicateWarning(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set("contact", id);
      } else {
        url.searchParams.delete("contact");
      }
      window.history.replaceState({}, "", url.toString());
    }
  };

  // Company Contacts Filter
  const companyContacts = useMemo(() => {
    if (!companyId) return [];
    return contacts.filter((c) => {
      const hasRelationship = c.relationships?.some((r) => r.companyId === companyId);
      if (!hasRelationship) return false;
      if (!includeArchived && c.isArchived) return false;

      const rel = c.relationships.find((r) => r.companyId === companyId);
      const activeRole = rel?.role || c.role;

      if (roleFilter !== "all" && activeRole !== roleFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = `${c.firstName} ${c.lastName}`.toLowerCase().includes(q);
        const matchEmail = c.email?.toLowerCase().includes(q);
        const matchPhone = c.phone?.toLowerCase().includes(q);
        const matchDL = c.dlNumber?.toLowerCase().includes(q);
        const matchRole = activeRole.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchPhone && !matchDL && !matchRole) return false;
      }

      return true;
    });
  }, [contacts, companyId, includeArchived, roleFilter, searchQuery]);

  // Sorted: Primary Contacts First
  const sortedCompanyContacts = useMemo(() => {
    return [...companyContacts].sort((a, b) => {
      const aRel = a.relationships.find((r) => r.companyId === companyId);
      const bRel = b.relationships.find((r) => r.companyId === companyId);
      const aPrimary = aRel?.isPrimary ? 1 : 0;
      const bPrimary = bRel?.isPrimary ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });
  }, [companyContacts, companyId]);

  // Selected Contact Entity
  const selectedContact = useMemo(() => {
    return contacts.find((c) => c.id === selectedContactId) || null;
  }, [contacts, selectedContactId]);

  const selectedContactRelationship = useMemo(() => {
    if (!selectedContact || !companyId) return null;
    return selectedContact.relationships?.find((r) => r.companyId === companyId) || null;
  }, [selectedContact, companyId]);

  // Start Editing Handler
  const handleStartEdit = (contact: Contact) => {
    const rel = contact.relationships?.find((r) => r.companyId === companyId);
    setEditFormData({
      firstName: contact.firstName,
      lastName: contact.lastName,
      dob: contact.dob || "",
      dlNumber: contact.dlNumber || "",
      dlState: contact.dlState || "ON",
      dlExpiry: contact.dlExpiry || "",
      dlIssueDate: contact.dlIssueDate || "",
      dlClass: contact.dlClass || "",
      dlRestrictions: contact.dlRestrictions || "",
      email: contact.email || "",
      phone: contact.phone || "",
      notes: contact.notes || "",
      companyRole: rel?.role || contact.role || "General Contact",
      isPrimary: !!rel?.isPrimary,
    });
    setEditFormErrors({});
    setEditDuplicateWarning(null);
    setIsEditing(true);
  };

  // Cancel Editing Handler
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditFormData({});
    setEditFormErrors({});
    setEditDuplicateWarning(null);
  };

  // Save Edited Contact Handler
  const handleSaveEdit = () => {
    if (!selectedContact || !companyId) return;

    const errors: Record<string, string> = {};
    if (!editFormData.firstName?.trim()) errors.firstName = "First name is required";
    if (!editFormData.lastName?.trim()) errors.lastName = "Last name is required";
    if (!editFormData.phone?.trim() && !editFormData.email?.trim()) {
      errors.phone = "Provide either phone or email";
    }

    if (Object.keys(errors).length > 0) {
      setEditFormErrors(errors);
      return;
    }

    // Check duplicate against other contacts (excluding current contact)
    const dupResult = findDuplicateContact(
      {
        firstName: editFormData.firstName,
        lastName: editFormData.lastName,
        dob: editFormData.dob,
        dlNumber: editFormData.dlNumber,
        email: editFormData.email,
        phone: editFormData.phone,
      },
      contacts,
      selectedContact.id
    );

    if (dupResult.match) {
      setEditDuplicateWarning(dupResult.reason);
    }

    const updatedRelationships = selectedContact.relationships.map((r) => {
      if (r.companyId === companyId) {
        return {
          ...r,
          role: editFormData.companyRole || r.role,
          isPrimary: editFormData.isPrimary,
        };
      }
      return r;
    });

    const updateEvent: ContactEvent = {
      id: generateEventId(),
      timestamp: new Date().toISOString(),
      action: "CONTACT_UPDATED",
      summary: `Updated identity details and role (${editFormData.companyRole}) at ${company?.name || "Company"}.`,
      actor: "System Administrator",
    };

    const updatedContact: Contact = {
      ...selectedContact,
      firstName: (editFormData.firstName || "").trim(),
      lastName: (editFormData.lastName || "").trim(),
      dob: (editFormData.dob || "").trim(),
      dlNumber: (editFormData.dlNumber || "").trim(),
      dlState: (editFormData.dlState || "").trim(),
      dlExpiry: (editFormData.dlExpiry || "").trim(),
      dlIssueDate: (editFormData.dlIssueDate || "").trim(),
      dlClass: (editFormData.dlClass || "").trim(),
      dlRestrictions: (editFormData.dlRestrictions || "").trim(),
      email: (editFormData.email || "").trim(),
      phone: (editFormData.phone || "").trim(),
      notes: (editFormData.notes || "").trim(),
      role: editFormData.companyRole || selectedContact.role,
      isPrimary: !!editFormData.isPrimary,
      identityStatus: editFormData.dlNumber ? "documented" : selectedContact.identityStatus,
      relationships: updatedRelationships,
      events: [updateEvent, ...(selectedContact.events || [])],
      updatedAt: new Date().toISOString(),
    };

    const allUpdated = applyPrimaryRule(updatedContact, companyId, contacts, company?.name || "Company");
    persistContacts(allUpdated);
    setIsEditing(false);
  };

  // --- Manual Add Handler ---
  const handleManualSave = () => {
    const errors: Record<string, string> = {};
    if (!manualForm.firstName.trim()) errors.firstName = "First name is required";
    if (!manualForm.lastName.trim()) errors.lastName = "Last name is required";
    if (!manualForm.phone.trim() && !manualForm.email.trim()) {
      errors.phone = "Provide either a phone or email address";
    }

    if (Object.keys(errors).length > 0) {
      setManualFormErrors(errors);
      return;
    }

    // Check duplicate
    const dupResult = findDuplicateContact(manualForm, contacts);
    if (dupResult.match) {
      // Re-use existing canonical person and append company relationship
      const existingPerson = dupResult.match;
      const alreadyHasRelationship = existingPerson.relationships.some((r) => r.companyId === companyId);

      let updatedPerson: Contact;
      if (alreadyHasRelationship) {
        // Update existing relationship for this company
        const updatedRels = existingPerson.relationships.map((r) =>
          r.companyId === companyId
            ? { ...r, role: manualForm.role, isPrimary: manualForm.isPrimary, status: "active" as const }
            : r
        );
        updatedPerson = {
          ...existingPerson,
          role: manualForm.role,
          isPrimary: manualForm.isPrimary,
          relationships: updatedRels,
          updatedAt: new Date().toISOString(),
          events: [
            {
              id: generateEventId(),
              timestamp: new Date().toISOString(),
              action: "ROLE_UPDATED",
              summary: `Updated role to ${manualForm.role} at ${company?.name || "Company"}.`,
              actor: "System Administrator",
            },
            ...(existingPerson.events || []),
          ],
        };
      } else {
        // Add new relationship to existing person
        const newRel: Relationship = {
          id: generateRelationshipId(),
          companyId: companyId!,
          companyName: company?.name || "Company",
          role: manualForm.role,
          isPrimary: manualForm.isPrimary,
          status: "active",
          startDate: new Date().toISOString().split("T")[0],
          source: "manual",
        };
        updatedPerson = {
          ...existingPerson,
          relationships: [...existingPerson.relationships, newRel],
          updatedAt: new Date().toISOString(),
          events: [
            {
              id: generateEventId(),
              timestamp: new Date().toISOString(),
              action: "RELATIONSHIP_ADDED",
              summary: `Associated existing person (${existingPerson.globalId}) with ${company?.name || "Company"} as ${manualForm.role}.`,
              actor: "System Administrator",
            },
            ...(existingPerson.events || []),
          ],
        };
      }

      const allUpdated = applyPrimaryRule(updatedPerson, companyId!, contacts, company?.name || "Company");
      persistContacts(allUpdated);
      handleSelectContact(updatedPerson.id);
      setIsManualModalOpen(false);
      return;
    }

    // Create brand new canonical Person
    const newContactId = generateContactId();
    const newGlobalUserId = generateGlobalUserId();
    const newRelationship: Relationship = {
      id: generateRelationshipId(),
      companyId: companyId!,
      companyName: company?.name || "Company",
      role: manualForm.role,
      isPrimary: manualForm.isPrimary,
      status: "active",
      startDate: new Date().toISOString().split("T")[0],
      source: "manual",
    };

    const newContact: Contact = {
      id: newContactId,
      globalId: newGlobalUserId,
      firstName: manualForm.firstName.trim(),
      lastName: manualForm.lastName.trim(),
      dob: manualForm.dob.trim(),
      dlNumber: manualForm.dlNumber.trim(),
      dlState: manualForm.dlState.trim(),
      dlExpiry: manualForm.dlExpiry.trim(),
      dlIssueDate: manualForm.dlIssueDate.trim(),
      dlClass: manualForm.dlClass.trim(),
      dlRestrictions: manualForm.dlRestrictions.trim(),
      email: manualForm.email.trim(),
      phone: manualForm.phone.trim(),
      role: manualForm.role,
      isPrimary: manualForm.isPrimary,
      isArchived: false,
      notes: manualForm.notes.trim(),
      identityStatus: manualForm.dlNumber ? "documented" : "unverified",
      relationships: [newRelationship],
      evidence: [],
      events: [
        {
          id: generateEventId(),
          timestamp: new Date().toISOString(),
          action: "CREATED",
          summary: `Created canonical person record (${newGlobalUserId}) and associated with ${company?.name || "Company"}.`,
          actor: "System Administrator",
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const allUpdated = applyPrimaryRule(newContact, companyId!, [...contacts, newContact], company?.name || "Company");
    persistContacts(allUpdated);
    handleSelectContact(newContactId);
    setIsManualModalOpen(false);
  };

  // --- OCR Ingestion Callbacks ---
  const handleFileChosen = (file: File, source: "camera" | "device" = "device") => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const draft = simulateOCRExtraction(file, dataUrl, source);
      setOcrDraft(draft);
      setOcrValidationError(null);
      setIsOCRWorkspaceOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleOCRConfirmedSave = () => {
    if (!ocrDraft) return;

    // Hard gate invariant: Exactly six required identity fields must be present and >= 85% confidence
    const requiredFields: { name: string; value: string; conf: number }[] = [
      { name: "First Name", value: ocrDraft.firstName.value, conf: ocrDraft.firstName.confidence },
      { name: "Last Name", value: ocrDraft.lastName.value, conf: ocrDraft.lastName.confidence },
      { name: "Date of Birth", value: ocrDraft.dob.value, conf: ocrDraft.dob.confidence },
      { name: "Driver Licence #", value: ocrDraft.dlNumber.value, conf: ocrDraft.dlNumber.confidence },
      { name: "Jurisdiction", value: ocrDraft.dlState.value, conf: ocrDraft.dlState.confidence },
      { name: "Expiry Date", value: ocrDraft.dlExpiry.value, conf: ocrDraft.dlExpiry.confidence },
    ];

    // 1. Check for empty values in required identity fields
    const emptyFields = requiredFields.filter((f) => !f.value || !f.value.trim());
    if (emptyFields.length > 0) {
      setOcrValidationError(
        `Required Field Missing: Please provide ${emptyFields.map((f) => f.name).join(", ")} before saving.`
      );
      return;
    }

    // 2. Check for confidence below required threshold (85%) in required identity fields
    const lowConfidenceFields = requiredFields.filter((f) => f.conf < OCR_REQUIRED_THRESHOLD);
    if (lowConfidenceFields.length > 0) {
      setOcrValidationError(
        `Review Required: ${lowConfidenceFields.map((f) => `${f.name} (${f.conf}%)`).join(", ")} below the ${OCR_REQUIRED_THRESHOLD}% threshold. Please review and verify before saving.`
      );
      return;
    }

    // Check duplicate
    const candidate = {
      firstName: ocrDraft.firstName.value,
      lastName: ocrDraft.lastName.value,
      dob: ocrDraft.dob.value,
      dlNumber: ocrDraft.dlNumber.value,
      email: ocrDraft.email.value,
      phone: ocrDraft.phone.value,
    };
    const dupResult = findDuplicateContact(candidate, contacts);

    if (dupResult.match) {
      // Reuse canonical person
      const existing = dupResult.match;
      const hasRel = existing.relationships.some((r) => r.companyId === companyId);
      const updatedRels = hasRel
        ? existing.relationships.map((r) =>
            r.companyId === companyId ? { ...r, role: ocrDraft.role, isPrimary: ocrDraft.isPrimary } : r
          )
        : [
            ...existing.relationships,
            {
              id: generateRelationshipId(),
              companyId: companyId!,
              companyName: company?.name || "Company",
              role: ocrDraft.role,
              isPrimary: ocrDraft.isPrimary,
              status: "active" as const,
              startDate: new Date().toISOString().split("T")[0],
              source: "document" as const,
            },
          ];

      const updatedPerson: Contact = {
        ...existing,
        dlNumber: existing.dlNumber || ocrDraft.dlNumber.value,
        dlState: existing.dlState || ocrDraft.dlState.value,
        dlExpiry: existing.dlExpiry || ocrDraft.dlExpiry.value,
        dlIssueDate: existing.dlIssueDate || ocrDraft.dlIssueDate.value,
        dlClass: existing.dlClass || ocrDraft.dlClass.value,
        dlRestrictions: existing.dlRestrictions || ocrDraft.dlRestrictions.value,
        email: existing.email || ocrDraft.email.value,
        phone: existing.phone || ocrDraft.phone.value,
        identityStatus: "documented",
        relationships: updatedRels,
        evidence: [ocrDraft.evidence, ...(existing.evidence || [])],
        events: [
          {
            id: generateEventId(),
            timestamp: new Date().toISOString(),
            action: "DOCUMENT_ATTACHED",
            summary: `Attached verified ${ocrDraft.evidence.type} document to existing person (${existing.globalId}).`,
            actor: "System Administrator",
          },
          ...(existing.events || []),
        ],
        updatedAt: new Date().toISOString(),
      };

      const allUpdated = applyPrimaryRule(updatedPerson, companyId!, contacts, company?.name || "Company");
      persistContacts(allUpdated);
      handleSelectContact(updatedPerson.id);
      setIsOCRWorkspaceOpen(false);
      setOcrDraft(null);
      setOcrValidationError(null);
      return;
    }

    // Brand new Person from OCR
    const newContactId = generateContactId();
    const newGlobalUserId = generateGlobalUserId();
    const newRel: Relationship = {
      id: generateRelationshipId(),
      companyId: companyId!,
      companyName: company?.name || "Company",
      role: ocrDraft.role,
      isPrimary: ocrDraft.isPrimary,
      status: "active",
      startDate: new Date().toISOString().split("T")[0],
      source: "document",
    };

    const newContact: Contact = {
      id: newContactId,
      globalId: newGlobalUserId,
      firstName: ocrDraft.firstName.value.trim(),
      lastName: ocrDraft.lastName.value.trim(),
      dob: ocrDraft.dob.value.trim(),
      dlNumber: ocrDraft.dlNumber.value.trim(),
      dlState: ocrDraft.dlState.value.trim(),
      dlExpiry: ocrDraft.dlExpiry.value.trim(),
      dlIssueDate: ocrDraft.dlIssueDate.value.trim(),
      dlClass: ocrDraft.dlClass.value.trim(),
      dlRestrictions: ocrDraft.dlRestrictions.value.trim(),
      email: ocrDraft.email.value.trim(),
      phone: ocrDraft.phone.value.trim(),
      role: ocrDraft.role,
      isPrimary: ocrDraft.isPrimary,
      isArchived: false,
      notes: "Extracted via OCR Document Review",
      identityStatus: "documented",
      identityConfidence: ocrDraft.evidence.confidence,
      relationships: [newRel],
      evidence: [ocrDraft.evidence],
      events: [
        {
          id: generateEventId(),
          timestamp: new Date().toISOString(),
          action: "CREATED",
          summary: `Created canonical person (${newGlobalUserId}) from OCR ID verification and associated with ${company?.name || "Company"}.`,
          actor: "System Administrator",
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const allUpdated = applyPrimaryRule(newContact, companyId!, [...contacts, newContact], company?.name || "Company");
    persistContacts(allUpdated);
    handleSelectContact(newContactId);
    setIsOCRWorkspaceOpen(false);
    setOcrDraft(null);
    setOcrValidationError(null);
  };

  // --- Toggle Primary Status ---
  const handleSetPrimary = (contact: Contact) => {
    if (!companyId) return;
    const relIndex = contact.relationships.findIndex((r) => r.companyId === companyId);
    if (relIndex === -1) return;

    const currentlyPrimary = !!contact.relationships[relIndex].isPrimary;
    const updatedRels = [...contact.relationships];
    updatedRels[relIndex] = {
      ...updatedRels[relIndex],
      isPrimary: !currentlyPrimary,
    };

    const event: ContactEvent = {
      id: generateEventId(),
      timestamp: new Date().toISOString(),
      action: "PRIMARY_CHANGED",
      summary: !currentlyPrimary
        ? `Designated as Primary Contact for ${company?.name || "Company"}.`
        : `Removed Primary Contact designation for ${company?.name || "Company"}.`,
      actor: "System Administrator",
    };

    const updatedContact: Contact = {
      ...contact,
      isPrimary: !currentlyPrimary,
      relationships: updatedRels,
      events: [event, ...(contact.events || [])],
      updatedAt: new Date().toISOString(),
    };

    const allUpdated = applyPrimaryRule(updatedContact, companyId, contacts, company?.name || "Company");
    persistContacts(allUpdated);
  };

  // --- Archive / Restore Contact ---
  const handleToggleArchive = (contact: Contact) => {
    const isNowArchived = !contact.isArchived;
    const event: ContactEvent = {
      id: generateEventId(),
      timestamp: new Date().toISOString(),
      action: isNowArchived ? "ARCHIVED" : "RESTORED",
      summary: isNowArchived ? "Archived contact record." : "Restored contact record to active register.",
      actor: "System Administrator",
    };

    const updated: Contact = {
      ...contact,
      isArchived: isNowArchived,
      events: [event, ...(contact.events || [])],
      updatedAt: new Date().toISOString(),
    };

    const allUpdated = contacts.map((c) => (c.id === contact.id ? updated : c));
    persistContacts(allUpdated);
  };

  // --- Render Loading / Empty States ---
  if (loading) {
    return (
      <div className="p-10">
        <LoadingState message="Loading company contacts..." />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <EmptyState
          icon={<Building2 className="size-10 text-muted-foreground/60" />}
          title="Company Not Found"
          description="The requested company record could not be found in the directory."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* 1. TOP HEADER & DIRECTORY STATS BAR */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Users className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">Company Contacts</h1>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  {company.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Canonical personnel register, identity credentials, multi-company relationships, and compliance evidence.
              </p>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setManualForm({
                  firstName: "",
                  lastName: "",
                  dob: "",
                  dlNumber: "",
                  dlState: "ON",
                  dlExpiry: "",
                  dlIssueDate: "",
                  dlClass: "",
                  dlRestrictions: "",
                  email: "",
                  phone: "",
                  role: "Safety Manager",
                  isPrimary: false,
                  notes: "",
                });
                setManualFormErrors({});
                setManualDuplicateWarning(null);
                setIsManualModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-semibold hover:bg-muted text-foreground transition-colors shadow-2xs"
            >
              <UserPlus className="size-3.5" />
              Manual Add
            </button>
            <button
              type="button"
              onClick={() => setIsSourcePickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <Sparkles className="size-3.5" />
              Upload ID for OCR
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-border">
          <div className="rounded-lg bg-muted/40 p-3 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Personnel</p>
            <p className="text-lg font-bold text-foreground mt-0.5">
              {contacts.filter((c) => c.relationships?.some((r) => r.companyId === companyId && r.status === "active") && !c.isArchived).length}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Primary Contact</p>
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-1 truncate">
              {contacts.find((c) => c.relationships?.some((r) => r.companyId === companyId && r.isPrimary))?.firstName || "None Assigned"}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Verified Credentials</p>
            <p className="text-lg font-bold text-primary mt-0.5">
              {contacts.filter((c) => c.relationships?.some((r) => r.companyId === companyId) && c.evidence?.length > 0).length}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Store Schema</p>
            <p className="text-xs font-mono font-medium text-muted-foreground mt-1">tes_contacts_v5 (Locked)</p>
          </div>
        </div>
      </div>

      {/* 2. SEARCH, FILTER & DIRECTORY GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT / MAIN TABLE AREA (7 or 8 columns) */}
        <div className={`flex flex-col gap-4 ${selectedContact ? "lg:col-span-7" : "lg:col-span-12"}`}>
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border rounded-xl p-3 shadow-2xs">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name, role, email, phone, licence..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground font-medium focus:border-primary focus:outline-hidden"
              >
                <option value="all">All Roles</option>
                {STANDARD_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none px-2">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-0 size-3.5"
                />
                Archived
              </label>
            </div>
          </div>

          {/* Contact Table / Card Register */}
          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            {sortedCompanyContacts.length === 0 ? (
              <div className="p-8 text-center">
                <EmptyState
                  icon={<Users className="size-8 text-muted-foreground/60" />}
                  title="No Contacts Found"
                  description={
                    searchQuery
                      ? "No personnel records match your search filter."
                      : "No contact records have been associated with this company yet."
                  }
                  action={{
                    label: "Add First Contact",
                    onClick: () => setIsManualModalOpen(true),
                    icon: <Plus className="size-3.5" />,
                  }}
                />
              </div>
            ) : (
              <div className="divide-y divide-border overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider font-semibold border-b border-border">
                    <tr>
                      <th className="px-4 py-3">Personnel / Canonical ID</th>
                      <th className="px-4 py-3">Company Role</th>
                      <th className="px-4 py-3">Communications</th>
                      <th className="px-4 py-3">Driver Licence</th>
                      <th className="px-4 py-3">Evidence</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedCompanyContacts.map((contact) => {
                      const rel = contact.relationships.find((r) => r.companyId === companyId);
                      const isPrimary = !!rel?.isPrimary;
                      const isSelected = contact.id === selectedContactId;

                      return (
                        <tr
                          key={contact.id}
                          onClick={() => handleSelectContact(contact.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-primary/5 border-l-4 border-l-primary"
                              : "hover:bg-muted/30"
                          } ${contact.isArchived ? "opacity-60 bg-muted/20" : ""}`}
                        >
                          {/* Name & Canonical ID */}
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-2.5">
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[11px] mt-0.5">
                                {contact.firstName?.[0]}
                                {contact.lastName?.[0]}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="font-bold text-foreground text-xs truncate">
                                    {contact.firstName} {contact.lastName}
                                  </p>
                                  {isPrimary && (
                                    <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                                      <Star className="size-2.5 fill-current" /> Primary
                                    </span>
                                  )}
                                  {contact.isArchived && (
                                    <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-medium text-muted-foreground">
                                      Archived
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                                  {contact.id} • {contact.globalId}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Role */}
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                              {rel?.role || contact.role || "General Contact"}
                            </span>
                          </td>

                          {/* Communications */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <p className="text-foreground font-medium truncate">{contact.phone || "—"}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{contact.email || "—"}</p>
                            </div>
                          </td>

                          {/* Driver Licence */}
                          <td className="px-4 py-3">
                            {contact.dlNumber ? (
                              <div className="flex flex-col gap-0.5">
                                <p className="font-mono font-semibold text-foreground text-[11px]">
                                  {contact.dlNumber}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {contact.dlState} {contact.dlExpiry ? `• Exp: ${contact.dlExpiry}` : ""}
                                </p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">—</span>
                            )}
                          </td>

                          {/* Evidence Count */}
                          <td className="px-4 py-3">
                            {contact.evidence?.length > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                <ShieldCheck className="size-3.5" />
                                {contact.evidence.length} Doc{contact.evidence.length > 1 ? "s" : ""}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">No Docs</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right">
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handleSetPrimary(contact)}
                                title={isPrimary ? "Remove Primary Status" : "Designate as Primary Contact"}
                                className={`flex size-7 items-center justify-center rounded-lg border transition-colors ${
                                  isPrimary
                                    ? "border-emerald-500/40 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                                    : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                <Star className={`size-3.5 ${isPrimary ? "fill-current" : ""}`} />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSelectContact(contact.id)}
                                title="Inspect Contact"
                                className="flex size-7 items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <ChevronRight className="size-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Contact Inspector / Multi-Company Drawer */}
        {selectedContact && (
          <div className="lg:col-span-5 flex flex-col gap-4 sticky top-6">
            <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-start justify-between p-4 border-b border-border bg-muted/20">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                    {selectedContact.firstName?.[0]}
                    {selectedContact.lastName?.[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-foreground">
                        {selectedContact.firstName} {selectedContact.lastName}
                      </h2>
                      {selectedContactRelationship?.isPrimary && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          Primary
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {selectedContact.id} • {selectedContact.globalId}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => handleStartEdit(selectedContact)}
                      title="Edit Contact"
                      className="flex size-7 items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleToggleArchive(selectedContact)}
                    title={selectedContact.isArchived ? "Restore Contact" : "Archive Contact"}
                    className="flex size-7 items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {selectedContact.isArchived ? (
                      <RefreshCw className="size-3.5" />
                    ) : (
                      <Archive className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectContact(null)}
                    className="flex size-7 items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Inspector Body */}
              <div className="p-4 flex flex-col gap-5 max-h-[calc(100vh-220px)] overflow-y-auto">
                {isEditing ? (
                  /* ========================================================================= */
                  /* EDIT CONTACT FORM VIEW */
                  /* ========================================================================= */
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between pb-2 border-b border-border">
                      <span className="text-xs font-bold text-foreground">Edit Personnel Details</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{selectedContact.id}</span>
                    </div>

                    {editDuplicateWarning && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400">
                        {editDuplicateWarning}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          First Name *
                        </label>
                        <input
                          type="text"
                          value={editFormData.firstName || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, firstName: e.target.value })}
                          className={`w-full rounded-lg border px-3 py-1.5 text-xs mt-1 ${
                            editFormErrors.firstName ? "border-destructive" : "border-border bg-background"
                          }`}
                        />
                        {editFormErrors.firstName && (
                          <p className="text-[10px] text-destructive mt-0.5">{editFormErrors.firstName}</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Last Name *
                        </label>
                        <input
                          type="text"
                          value={editFormData.lastName || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, lastName: e.target.value })}
                          className={`w-full rounded-lg border px-3 py-1.5 text-xs mt-1 ${
                            editFormErrors.lastName ? "border-destructive" : "border-border bg-background"
                          }`}
                        />
                        {editFormErrors.lastName && (
                          <p className="text-[10px] text-destructive mt-0.5">{editFormErrors.lastName}</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Date of Birth
                        </label>
                        <input
                          type="date"
                          value={editFormData.dob || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, dob: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Driver Licence #
                        </label>
                        <input
                          type="text"
                          value={editFormData.dlNumber || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, dlNumber: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Licence Jurisdiction
                        </label>
                        <select
                          value={editFormData.dlState || "ON"}
                          onChange={(e) => setEditFormData({ ...editFormData, dlState: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        >
                          {ALL_JURISDICTIONS.map((j) => (
                            <option key={j} value={j}>
                              {j}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Licence Expiry
                        </label>
                        <input
                          type="date"
                          value={editFormData.dlExpiry || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, dlExpiry: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Licence Class
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Class A / AZ"
                          value={editFormData.dlClass || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, dlClass: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Restrictions
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Corrective Lenses"
                          value={editFormData.dlRestrictions || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, dlRestrictions: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          placeholder="+1 (555) 000-0000"
                          value={editFormData.phone || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                          className={`w-full rounded-lg border px-3 py-1.5 text-xs mt-1 ${
                            editFormErrors.phone ? "border-destructive" : "border-border bg-background"
                          }`}
                        />
                        {editFormErrors.phone && (
                          <p className="text-[10px] text-destructive mt-0.5">{editFormErrors.phone}</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Email Address
                        </label>
                        <input
                          type="email"
                          placeholder="person@company.com"
                          value={editFormData.email || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        />
                      </div>

                      <div className="col-span-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Assigned Role at {company.name}
                        </label>
                        <select
                          value={editFormData.companyRole || "Safety Manager"}
                          onChange={(e) => setEditFormData({ ...editFormData, companyRole: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        >
                          {STANDARD_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-2 flex items-center gap-2 pt-1">
                        <input
                          type="checkbox"
                          id="edit-is-primary"
                          checked={!!editFormData.isPrimary}
                          onChange={(e) => setEditFormData({ ...editFormData, isPrimary: e.target.checked })}
                          className="rounded border-border text-primary focus:ring-0 size-4"
                        />
                        <label htmlFor="edit-is-primary" className="text-xs font-semibold text-foreground cursor-pointer">
                          Designate as Primary Contact for {company.name}
                        </label>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 1. Company Assignment & Role */}
                    <div className="rounded-lg border border-border bg-muted/10 p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Company Assignment
                        </span>
                        <span className="text-xs font-semibold text-primary">{company.name}</span>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-border/60">
                        <span className="text-xs text-muted-foreground">Assigned Role</span>
                        <span className="text-xs font-bold text-foreground">
                          {selectedContactRelationship?.role || selectedContact.role}
                        </span>
                      </div>
                    </div>

                    {/* 2. Identity & Credential ReadOnlyFields */}
                    <div className="grid grid-cols-2 gap-3">
                      <ReadOnlyField label="First Name" value={selectedContact.firstName} />
                      <ReadOnlyField label="Last Name" value={selectedContact.lastName} />
                      <ReadOnlyField label="Date of Birth" value={selectedContact.dob} mono />
                      <ReadOnlyField
                        label="Driver Licence #"
                        value={selectedContact.dlNumber}
                        copyable
                        mono
                      />
                      <ReadOnlyField label="Licence Jurisdiction" value={selectedContact.dlState} />
                      <ReadOnlyField label="Licence Expiry" value={selectedContact.dlExpiry} mono />
                      <ReadOnlyField label="Licence Class" value={selectedContact.dlClass} />
                      <ReadOnlyField label="Restrictions" value={selectedContact.dlRestrictions} />
                      <ReadOnlyField label="Phone Number" value={selectedContact.phone} copyable mono />
                      <ReadOnlyField label="Email Address" value={selectedContact.email} copyable />
                    </div>

                    {/* 3. Multi-Company Relationships Register */}
                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Associated Companies ({selectedContact.relationships?.length || 1})
                      </span>
                      <div className="divide-y divide-border border border-border rounded-lg bg-background overflow-hidden">
                        {selectedContact.relationships?.map((rel) => (
                          <div key={rel.id} className="p-2.5 flex items-center justify-between text-xs">
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">{rel.companyName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                Role: {rel.role} {rel.startDate ? `• Since ${rel.startDate}` : ""}
                              </p>
                            </div>
                            {rel.isPrimary && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                                Primary
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 4. Evidence Attachments & 3-Year Operational Filter */}
                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Attached Evidence ({selectedContact.evidence?.length || 0})
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowOlderEvidence(!showOlderEvidence)}
                          className="text-[10px] text-primary hover:underline font-medium"
                        >
                          {showOlderEvidence ? "Hide Older Docs" : "Show All History"}
                        </button>
                      </div>

                      {selectedContact.evidence?.length === 0 ? (
                        <div className="p-3 text-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                          No identity evidence attached.
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {selectedContact.evidence
                            .filter((ev) => showOlderEvidence || isWithinThreeYears(ev.documentDate || ev.uploadedAt))
                            .map((ev) => (
                              <div
                                key={ev.id}
                                onClick={() => setPreviewEvidence(ev)}
                                className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileCheck2 className="size-4 text-emerald-500 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">{ev.fileName}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {ev.type} • {ev.documentDate || ev.uploadedAt?.split("T")[0]}
                                    </p>
                                  </div>
                                </div>
                                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                                  {ev.confidence ? `${ev.confidence}%` : "Verified"}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* 5. Revision Audit Timeline */}
                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Revision Events ({selectedContact.events?.length || 0})
                      </span>
                      <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto">
                        {selectedContact.events?.map((ev) => (
                          <div key={ev.id} className="text-xs p-2 rounded bg-muted/20 border border-border/50">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="font-bold text-foreground">{ev.action}</span>
                              <span>{ev.timestamp ? new Date(ev.timestamp).toLocaleDateString() : ""}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{ev.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: MANUAL ADD CONTACT */}
      {/* ========================================================================= */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 animate-in fade-in duration-150">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Add Contact Manually</h3>
                <p className="text-xs text-muted-foreground">
                  Enter personnel information to register or associate with {company.name}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {manualDuplicateWarning && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-300">
                <p className="font-bold">Existing Identity Detected:</p>
                <p className="mt-0.5">{manualDuplicateWarning}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  First Name *
                </label>
                <input
                  type="text"
                  value={manualForm.firstName}
                  onChange={(e) => setManualForm({ ...manualForm, firstName: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
                {manualFormErrors.firstName && (
                  <p className="text-[10px] text-destructive mt-0.5">{manualFormErrors.firstName}</p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Last Name *
                </label>
                <input
                  type="text"
                  value={manualForm.lastName}
                  onChange={(e) => setManualForm({ ...manualForm, lastName: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
                {manualFormErrors.lastName && (
                  <p className="text-[10px] text-destructive mt-0.5">{manualFormErrors.lastName}</p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Date of Birth (YYYY-MM-DD)
                </label>
                <input
                  type="date"
                  value={manualForm.dob}
                  onChange={(e) => setManualForm({ ...manualForm, dob: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Company Role *
                </label>
                <select
                  value={manualForm.role}
                  onChange={(e) => setManualForm({ ...manualForm, role: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                >
                  {STANDARD_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Driver Licence Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. D1234-56789-01234"
                  value={manualForm.dlNumber}
                  onChange={(e) => setManualForm({ ...manualForm, dlNumber: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono focus:border-primary focus:outline-hidden mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Licence Jurisdiction
                </label>
                <select
                  value={manualForm.dlState}
                  onChange={(e) => setManualForm({ ...manualForm, dlState: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                >
                  {ALL_JURISDICTIONS.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="(XXX) XXX-XXXX"
                  value={manualForm.phone}
                  onChange={(e) => setManualForm({ ...manualForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
                {manualFormErrors.phone && (
                  <p className="text-[10px] text-destructive mt-0.5">{manualFormErrors.phone}</p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="contact@example.com"
                  value={manualForm.email}
                  onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="manual-primary"
                checked={manualForm.isPrimary}
                onChange={(e) => setManualForm({ ...manualForm, isPrimary: e.target.checked })}
                className="rounded border-border text-primary focus:ring-0 size-4"
              />
              <label htmlFor="manual-primary" className="text-xs font-semibold text-foreground cursor-pointer">
                Designate as Primary Contact for {company.name}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-muted text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleManualSave}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Save Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: DOCUMENT SOURCE PICKER (Shared Foundation) */}
      {/* ========================================================================= */}
      <DocumentSourcePicker
        isOpen={isSourcePickerOpen}
        onClose={() => setIsSourcePickerOpen(false)}
        onSelectCamera={() => setIsCameraOpen(true)}
        onSelectFile={(file) => handleFileChosen(file, "device")}
        title="Ingest Driver Licence / ID Document"
        subtitle="Capture or upload photo ID for automated OCR extraction and evidence creation."
      />

      {/* ========================================================================= */}
      {/* MODAL 3: CAMERA CAPTURE (Shared Foundation) */}
      {/* ========================================================================= */}
      {isCameraOpen && (
        <CameraCapture
          onClose={() => setIsCameraOpen(false)}
          onCapture={(file) => {
            setIsCameraOpen(false);
            handleFileChosen(file, "camera");
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: OCR REVIEW WORKSPACE (Contacts Invariant Split-Screen) */}
      {/* ========================================================================= */}
      {isOCRWorkspaceOpen && ocrDraft && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-5xl h-[85vh] rounded-2xl border border-border bg-card flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  OCR Identity Extraction Review
                </h3>
                <p className="text-xs text-muted-foreground">
                  Verify extracted attributes against the source document. Field confidence below 85% requires review.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOCRWorkspaceOpen(false);
                  setOcrDraft(null);
                }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Split Screen Viewport */}
            <div className="grid grid-cols-1 lg:grid-cols-2 flex-1 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
              {/* Left Side: Secure Document Viewer */}
              <div className="h-full min-h-[300px] p-3 bg-muted/10">
                <SecureDocumentViewer
                  fileName={ocrDraft.evidence.fileName}
                  mimeType={ocrDraft.evidence.fileType}
                  dataUrl={ocrDraft.evidence.dataUrl || ""}
                  documentTitle="Source Driver Licence Asset"
                  ocrConfidence={ocrDraft.evidence.confidence}
                />
              </div>

              {/* Right Side: Extracted Field Review */}
              <div className="p-5 flex flex-col gap-4 overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                      First Name
                      <span
                        className={`text-[9px] font-mono font-bold ${
                          ocrDraft.firstName.confidence >= 85 ? "text-emerald-500" : "text-amber-500"
                        }`}
                      >
                        {ocrDraft.firstName.confidence}%
                      </span>
                    </label>
                    <input
                      type="text"
                      value={ocrDraft.firstName.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          firstName: { ...ocrDraft.firstName, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                      Last Name
                      <span
                        className={`text-[9px] font-mono font-bold ${
                          ocrDraft.lastName.confidence >= 85 ? "text-emerald-500" : "text-amber-500"
                        }`}
                      >
                        {ocrDraft.lastName.confidence}%
                      </span>
                    </label>
                    <input
                      type="text"
                      value={ocrDraft.lastName.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          lastName: { ...ocrDraft.lastName, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                      Date of Birth
                      <span
                        className={`text-[9px] font-mono font-bold ${
                          ocrDraft.dob.confidence >= 85 ? "text-emerald-500" : "text-amber-500"
                        }`}
                      >
                        {ocrDraft.dob.confidence}%
                      </span>
                    </label>
                    <input
                      type="date"
                      value={ocrDraft.dob.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          dob: { ...ocrDraft.dob, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
                      Driver Licence #
                      <span
                        className={`text-[9px] font-mono font-bold ${
                          ocrDraft.dlNumber.confidence >= 85 ? "text-emerald-500" : "text-amber-500"
                        }`}
                      >
                        {ocrDraft.dlNumber.confidence}%
                      </span>
                    </label>
                    <input
                      type="text"
                      value={ocrDraft.dlNumber.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          dlNumber: { ...ocrDraft.dlNumber, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono font-bold mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Jurisdiction
                    </label>
                    <select
                      value={ocrDraft.dlState.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          dlState: { ...ocrDraft.dlState, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    >
                      {ALL_JURISDICTIONS.map((j) => (
                        <option key={j} value={j}>
                          {j}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Expiry Date
                    </label>
                    <input
                      type="date"
                      value={ocrDraft.dlExpiry.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          dlExpiry: { ...ocrDraft.dlExpiry, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Licence Class
                    </label>
                    <input
                      type="text"
                      value={ocrDraft.dlClass.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          dlClass: { ...ocrDraft.dlClass, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Assigned Role
                    </label>
                    <select
                      value={ocrDraft.role}
                      onChange={(e) => setOcrDraft({ ...ocrDraft, role: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    >
                      {STANDARD_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={ocrDraft.phone.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          phone: { ...ocrDraft.phone, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Email Address
                    </label>
                    <input
                      type="email"
                      placeholder="person@company.com"
                      value={ocrDraft.email.value}
                      onChange={(e) =>
                        setOcrDraft({
                          ...ocrDraft,
                          email: { ...ocrDraft.email, value: e.target.value, confidence: 100 },
                        })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                    />
                  </div>
                </div>

                {ocrValidationError && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                    <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                    <span>{ocrValidationError}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="ocr-primary"
                    checked={ocrDraft.isPrimary}
                    onChange={(e) => setOcrDraft({ ...ocrDraft, isPrimary: e.target.checked })}
                    className="rounded border-border text-primary focus:ring-0 size-4"
                  />
                  <label htmlFor="ocr-primary" className="text-xs font-semibold text-foreground cursor-pointer">
                    Designate as Primary Contact for {company.name}
                  </label>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between p-4 border-t border-border bg-muted/20">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-4 text-emerald-500" />
                <span>Audited OCR Extraction • Evidence Attachment DOC-XXXX</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsOCRWorkspaceOpen(false);
                    setOcrDraft(null);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-muted text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleOCRConfirmedSave}
                  className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-xs"
                >
                  Confirm & Save Identity
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: EVIDENCE PREVIEW MODAL (Shared Foundation SecureDocumentViewer) */}
      {/* ========================================================================= */}
      {previewEvidence && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[80vh] rounded-2xl overflow-hidden shadow-2xl">
            <SecureDocumentViewer
              fileName={previewEvidence.fileName}
              mimeType={previewEvidence.fileType}
              dataUrl={previewEvidence.dataUrl || ""}
              documentTitle={previewEvidence.type}
              documentDate={previewEvidence.documentDate || previewEvidence.uploadedAt?.split("T")[0]}
              ocrConfidence={previewEvidence.confidence}
              onClose={() => setPreviewEvidence(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
