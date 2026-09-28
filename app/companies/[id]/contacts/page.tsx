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
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader";
import { ContactStats } from "@/src/components/contacts/ContactStats";
import { ContactDirectory } from "@/src/components/contacts/ContactDirectory";
import { ContactInspector } from "@/src/components/contacts/ContactInspector";
import { ManualContactDialog } from "@/src/components/contacts/ManualContactDialog";
import { ContactDocumentIntake } from "@/src/components/contacts/ContactDocumentIntake";
import { ContactOCRWorkspace } from "@/src/components/contacts/ContactOCRWorkspace";
import { ContactEvidenceViewer } from "@/src/components/contacts/ContactEvidenceViewer";
import type { CompanyRecord, Contact, ContactEvent, Evidence, OCRReviewDraft, Relationship } from "@/src/components/contacts/types";
import {
  ALL_JURISDICTIONS,
  STANDARD_ROLES,
  applyPrimaryRule,
  findDuplicateContact,
  generateContactId,
  generateEventId,
  generateGlobalUserId,
  generateRelationshipId,
  isWithinThreeYears,
  normalizeLoadedContacts,
  OCR_REQUIRED_THRESHOLD,
  simulateOCRExtraction,
} from "@/src/components/contacts/contact-helpers";
import {
  contactsWithoutEmbeddedEvidenceData,
  readContactEvidenceDataUrl,
  readContactEvidenceManifest,
  storeContactEvidenceDataUrl,
  storeContactEvidenceManifest,
} from "@/src/components/contacts/evidence-storage";

// Re-exported for backward compatibility: these types/constants/helpers used
// to be declared in this file. They now live in src/components/contacts/ (see
// imports above) so reusable components do not depend on this route page.
export type { Contact, ContactEvent, Evidence, OCRReviewDraft, Relationship };
export {
  ALL_JURISDICTIONS,
  STANDARD_ROLES,
  applyPrimaryRule,
  findDuplicateContact,
  isWithinThreeYears,
  OCR_REQUIRED_THRESHOLD,
  simulateOCRExtraction,
};

// =========================================================================
// MAIN CONTACTS PAGE COMPONENT
// =========================================================================

export default function ContactsPage() {
  const params = useParams<{ id: string }>();
  const companyId = params?.id;

  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const [previewEvidenceLoading, setPreviewEvidenceLoading] = useState(false);

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
      const savedCompanies: CompanyRecord[] = JSON.parse(localStorage.getItem("tes_companies") || "[]");
      const foundCompany = savedCompanies.find((c) => c.id === companyId);
      setCompany(foundCompany || null);

      // Load Contacts (v5 canonical, fallback to v4 / v3)
      let rawContacts = localStorage.getItem("tes_contacts_v5");
      if (!rawContacts) {
        rawContacts = localStorage.getItem("tes_contacts_v4") || localStorage.getItem("tes_contacts_v3");
      }
      // A canonical Contact can be created/updated by another TES module (e.g.
      // Insurance's Broker Agent resolution) that does not populate every
      // field this page unconditionally reads. Normalize missing arrays to []
      // before anything else touches this data - see contact-helpers.ts.
      const loaded: Contact[] = normalizeLoadedContacts(rawContacts ? JSON.parse(rawContacts) : []);

      // Evidence payloads live outside localStorage. Recover metadata from the
      // per-contact IndexedDB manifest when a canonical contact has no embedded
      // evidence metadata (including records created during earlier migrations).
      void Promise.all(
        loaded.map(async (contact) => {
          if ((contact.evidence || []).length > 0) return contact;
          try {
            const manifest = await readContactEvidenceManifest(contact.id);
            return manifest.length > 0 ? { ...contact, evidence: manifest } : contact;
          } catch (error) {
            console.error(`Failed to recover evidence manifest for ${contact.id}`, error);
            return contact;
          }
        })
      ).then((hydrated) => {
        setContacts(hydrated);
      });

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

  // Save canonical contact metadata strictly to tes_contacts_v5.
  // Evidence payload bytes are stored separately in IndexedDB.
  const persistContacts = (updated: Contact[]): boolean => {
    try {
      const metadataOnly = contactsWithoutEmbeddedEvidenceData(updated);
      localStorage.setItem("tes_contacts_v5", JSON.stringify(metadataOnly));
      setContacts(metadataOnly);
      return true;
    } catch (e) {
      console.error("Failed to persist contacts to tes_contacts_v5", e);
      return false;
    }
  };

  const handlePreviewEvidence = async (evidence: Evidence) => {
    if (evidence.dataUrl) {
      setPreviewEvidence(evidence);
      setPreviewEvidenceLoading(false);
      return;
    }

    // Open the viewer immediately in a loading state rather than waiting
    // silently for IndexedDB - see SecureDocumentViewer's `loading` prop.
    setPreviewEvidence(evidence);
    setPreviewEvidenceLoading(true);
    try {
      const dataUrl = await readContactEvidenceDataUrl(evidence.id);
      setPreviewEvidence(dataUrl ? { ...evidence, dataUrl } : evidence);
    } catch (e) {
      console.error(`Failed to load contact evidence ${evidence.id}`, e);
      setPreviewEvidence(evidence);
    } finally {
      setPreviewEvidenceLoading(false);
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
    if (!persistContacts(allUpdated)) {
      setActionError("Contact changes could not be saved. Please retry.");
      return;
    }
    setActionError(null);
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

      if (!persistContacts(allUpdated)) {
        setManualDuplicateWarning("Contact could not be saved. Please retry.");
        return;
      }

      setActionError(null);
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

    if (!persistContacts(allUpdated)) {
      setManualDuplicateWarning("Contact could not be saved. Please retry.");
      return;
    }

    setActionError(null);
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

  const handleOCRConfirmedSave = async () => {
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

      try {
        await storeContactEvidenceDataUrl(
          ocrDraft.evidence.id,
          ocrDraft.evidence.dataUrl
        );
        await storeContactEvidenceManifest(updatedPerson.id, updatedPerson.evidence);
      } catch (e) {
        console.error("Failed to store OCR evidence payload", e);
        setOcrValidationError("Evidence could not be stored. The contact record was not saved.");
        return;
      }

      if (!persistContacts(allUpdated)) {
        setOcrValidationError("Contact record could not be saved. Please retry.");
        return;
      }

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

    try {
      await storeContactEvidenceDataUrl(
        ocrDraft.evidence.id,
        ocrDraft.evidence.dataUrl
      );
      await storeContactEvidenceManifest(newContact.id, newContact.evidence);
    } catch (e) {
      console.error("Failed to store OCR evidence payload", e);
      setOcrValidationError("Evidence could not be stored. The contact record was not saved.");
      return;
    }

    if (!persistContacts(allUpdated)) {
      setOcrValidationError("Contact record could not be saved. Please retry.");
      return;
    }

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
    if (!persistContacts(allUpdated)) {
      setActionError("Primary contact change could not be saved. Please retry.");
      return;
    }
    setActionError(null);
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
    if (!persistContacts(allUpdated)) {
      setActionError(`Contact could not be ${isNowArchived ? "archived" : "restored"}. Please retry.`);
      return;
    }
    setActionError(null);
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

  const contactsActions = (
    <>
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
        <Upload className="size-3.5" />
        Document / OCR
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-6 pb-12">
      <CompanyWorkspaceHeader
        company={{ id: company.id, name: company.name, kind: String(company.kind || ""), status: String(company.status || "") }}
        section="Contacts"
        description="Canonical personnel register, identity credentials, multi-company relationships, and compliance evidence."
        actions={contactsActions}
      />

      {actionError && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-medium text-destructive">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="hover:opacity-80 p-1">
            <X className="size-4" />
          </button>
        </div>
      )}

      <ContactStats contacts={contacts} companyId={companyId} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <ContactDirectory {...{sortedCompanyContacts,selectedContact,selectedContactId,companyId,searchQuery,setSearchQuery,roleFilter,setRoleFilter,includeArchived,setIncludeArchived,STANDARD_ROLES,handleSelectContact,handleSetPrimary,setIsManualModalOpen}} />
        <ContactInspector {...{selectedContact,selectedContactRelationship,companyId,isEditing,editFormData,setEditFormData,editFormErrors,editDuplicateWarning,showOlderEvidence,setShowOlderEvidence,STANDARD_ROLES,ALL_JURISDICTIONS,isWithinThreeYears,handleStartEdit,handleToggleArchive,handleSelectContact,handleCancelEdit,handleSaveEdit}} setPreviewEvidence={handlePreviewEvidence} companyName={company.name} />
      </div>
      <ManualContactDialog {...{isManualModalOpen,manualForm,setManualForm,manualFormErrors,manualDuplicateWarning,STANDARD_ROLES,ALL_JURISDICTIONS,setIsManualModalOpen,handleManualSave}} companyName={company.name} />
      <ContactDocumentIntake {...{isSourcePickerOpen,setIsSourcePickerOpen,isCameraOpen,setIsCameraOpen,handleFileChosen}} />
      <ContactOCRWorkspace {...{isOCRWorkspaceOpen,ocrDraft,setOcrDraft,ocrValidationError,company,STANDARD_ROLES,ALL_JURISDICTIONS,setIsOCRWorkspaceOpen,handleOCRConfirmedSave}} />
      <ContactEvidenceViewer {...{previewEvidence,setPreviewEvidence,previewEvidenceLoading}} />
    </div>
  );
}