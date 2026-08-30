"use client";

import React, { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

// --- Shared Foundation Components ---
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { LoadingState, EmptyState } from "@/src/components/shared/StateDisplays";
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker";
import { CameraCapture } from "@/src/components/CameraCapture";
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer";

// --- Shared Utilities & Normalization ---
import {
  normalizeCRABusinessNumber,
  validateCRABusinessNumberFormat,
  parseCRAProgramAccount,
  normalizeEIN,
  validateEINFormat,
  normalizeTaxId,
} from "@/src/lib/identifier-normalization";
import { recordAuditEvent } from "@/lib/audit-logger";

// --- Business Domain Types ---
import {
  CompanyBusinessStore,
  BusinessShareholderRecord,
  BusinessAnnualReturnRecord,
  BusinessTaxAccountRecord,
  BusinessEvent,
  CorporatePersonRole,
} from "@/src/types/business";

// --- Stable ID Generator (Full UUID, Non-Truncated) ---
function generateStableId(prefix: string, companyId: string): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().toUpperCase()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
  return `${prefix}-${companyId}-${uuid}`;
}

export default function BusinessPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  // Strict route identity: ONLY useParams, no window.location or first-company fallback
  const companyId = params?.id ?? "";

  // Master State
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Business Sub-Record Persistent Store (Initialized in memory, lazy-persisted on first mutation)
  const [businessStore, setBusinessStore] = useState<CompanyBusinessStore>({
    version: "1.0",
    companyId: companyId,
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: "System Administrator",
    shareholders: [],
    annualReturns: [],
    taxAccounts: [],
    eventHistory: [],
  });

  // UI / View Modes
  const [isEditingIncorp, setIsEditingIncorp] = useState(false);
  const [incorpDateDraft, setIncorpDateDraft] = useState("");
  const [showArchivedShareholders, setShowArchivedShareholders] = useState(false);
  const [showArchivedReturns, setShowArchivedReturns] = useState(false);
  const [showArchivedTaxes, setShowArchivedTaxes] = useState(false);

  // Drawer / Form States
  const [showAddShareholder, setShowAddShareholder] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<BusinessShareholderRecord | null>(null);
  const [shareholderError, setShareholderError] = useState<string | null>(null);

  const [showAddReturn, setShowAddReturn] = useState(false);
  const [editingReturn, setEditingReturn] = useState<BusinessAnnualReturnRecord | null>(null);

  const [showAddCra, setShowAddCra] = useState(false);
  const [craError, setCraError] = useState<string | null>(null);
  const [taxActionError, setTaxActionError] = useState<string | null>(null);

  const [showAddEin, setShowAddEin] = useState(false);
  const [einError, setEinError] = useState<string | null>(null);

  const [showAddGst, setShowAddGst] = useState(false);
  const [gstError, setGstError] = useState<string | null>(null);

  const [showAddSalesTax, setShowAddSalesTax] = useState(false);

  // Shared Document Ingestion & Preview State
  const [documentTarget, setDocumentTarget] = useState<string | null>(null);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<{
    name: string;
    url: string;
    target: string;
  } | null>(null);

  // Clean up Object URLs to prevent memory leaks during long sessions
  useEffect(() => {
    return () => {
      if (previewDocument?.url) {
        URL.revokeObjectURL(previewDocument.url);
      }
    };
  }, [previewDocument]);

  const handleClosePreview = () => {
    if (previewDocument?.url) {
      URL.revokeObjectURL(previewDocument.url);
    }
    setPreviewDocument(null);
  };

  // --- 1. Load Company Master & Business Store ---
  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    try {
      // 1. Load authoritative Company Master (tes_companies)
      const rawCompanies = localStorage.getItem("tes_companies");
      const companies = rawCompanies ? JSON.parse(rawCompanies) : [];
      const found = companies.find((c: any) => c.id === companyId);
      setCompany(found || null);

      if (found?.incorpDate) {
        setIncorpDateDraft(found.incorpDate);
      }

      // 2. Load Company-Scoped Business Store (tes_business_records_${companyId})
      const storeKey = `tes_business_records_${companyId}`;
      const rawStore = localStorage.getItem(storeKey);
      if (rawStore) {
        const parsed: CompanyBusinessStore = JSON.parse(rawStore);
        if (parsed.companyId === companyId) {
          setBusinessStore(parsed);
        }
      } else {
        // LAZY INITIALIZATION: in-memory state only.
        // DO NOT write localStorage and DO NOT create INITIALIZE event until first real mutation.
        setBusinessStore({
          version: "1.0",
          companyId: companyId,
          lastUpdated: new Date().toISOString(),
          lastUpdatedBy: "System Administrator",
          shareholders: [],
          annualReturns: [],
          taxAccounts: [],
          eventHistory: [],
        });
      }
    } catch (err) {
      console.error("Error loading Business records:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // --- Helper to Persist Business Store (Persists upon mutation) ---
  const persistStore = (updater: (prev: CompanyBusinessStore) => CompanyBusinessStore) => {
    setBusinessStore((prev) => {
      const next = updater(prev);
      next.lastUpdated = new Date().toISOString();
      next.lastUpdatedBy = "System Administrator";
      if (companyId) {
        localStorage.setItem(`tes_business_records_${companyId}`, JSON.stringify(next));
      }
      return next;
    });
  };

  // --- Helper to Append Business Event ---
  const recordBusinessEvent = (action: string, description: string) => {
    const event: BusinessEvent = {
      id: generateStableId("EVT", companyId),
      timestamp: new Date().toISOString(),
      action,
      actor: "System Administrator",
      description,
    };
    persistStore((prev) => ({
      ...prev,
      eventHistory: [event, ...(prev.eventHistory || [])],
    }));
  };

  // --- REGION / JURISDICTION LOGIC ---
  const isCanadaRegistered = company?.regCorpCountry === "Canada";
  const isUSRegistered = company?.regCorpCountry === "United States";
  const isCrossBorder = company?.region === "Cross-Border";

  const needsCanadianTaxes = isCanadaRegistered || isCrossBorder;
  const needsUSTaxes = isUSRegistered || isCrossBorder;

  // --- ACTIVE SHAREHOLDER OWNERSHIP CALCULATION ---
  const activeShareholders = useMemo(() => {
    return (businessStore.shareholders || []).filter((s) => !s.isArchived);
  }, [businessStore.shareholders]);

  const totalActiveOwnership = useMemo(() => {
    return activeShareholders.reduce((sum, s) => sum + (Number(s.shares) || 0), 0);
  }, [activeShareholders]);

  // =========================================================================
  // HANDLERS: INCORPORATION SUMMARY (Master Sync)
  // =========================================================================

  const handleSaveIncorp = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!company) return;

    try {
      // 1. Update company master in tes_companies
      const rawCompanies = localStorage.getItem("tes_companies");
      const companies = rawCompanies ? JSON.parse(rawCompanies) : [];
      const updated = companies.map((c: any) =>
        c.id === company.id ? { ...c, incorpDate: incorpDateDraft } : c
      );
      localStorage.setItem("tes_companies", JSON.stringify(updated));

      // Update local company state
      setCompany({ ...company, incorpDate: incorpDateDraft });

      // 2. Audit and Business Event Logging
      recordBusinessEvent(
        "UPDATE_INCORPORATION",
        `Updated incorporation date to ${incorpDateDraft || "not set"}.`
      );
      recordAuditEvent({
        action: "UPDATE",
        entityType: "Company",
        entityId: company.id,
        companyId: company.id,
        role: "Compliance Administrator",
        details: `Updated incorporation date to ${incorpDateDraft || "not set"}.`,
        actor: "System Administrator",
      });

      setIsEditingIncorp(false);
    } catch (err) {
      console.error("Failed to update incorporation details:", err);
    }
  };

  // =========================================================================
  // HANDLERS: SHAREHOLDERS / DIRECTORS
  // =========================================================================

  const handleSaveShareholder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setShareholderError(null);
    const formData = new FormData(e.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const role = (formData.get("role") as CorporatePersonRole) || "Shareholder";
    const sharesPercent = Number(formData.get("shares")) || 0;
    const address = String(formData.get("address") || "").trim();

    if (!name) {
      setShareholderError("Shareholder / Director name is required.");
      return;
    }

    if (sharesPercent < 0) {
      setShareholderError("Shares percentage cannot be negative.");
      return;
    }

    // RULE: Total ACTIVE recorded ownership must NEVER exceed 100%
    const currentExcludingEditing = activeShareholders
      .filter((s) => s.id !== editingShareholder?.id)
      .reduce((sum, s) => sum + (Number(s.shares) || 0), 0);

    if (currentExcludingEditing + sharesPercent > 100) {
      setShareholderError(
        `Cannot save: Total active recorded ownership would be ${(
          currentExcludingEditing + sharesPercent
        ).toFixed(1)}%, which exceeds the 100.0% statutory maximum.`
      );
      return;
    }

    if (editingShareholder) {
      // Edit existing
      persistStore((prev) => ({
        ...prev,
        shareholders: prev.shareholders.map((s) =>
          s.id === editingShareholder.id
            ? { ...s, name, role, shares: sharesPercent, address }
            : s
        ),
      }));
      recordBusinessEvent(
        "EDIT_SHAREHOLDER",
        `Updated shareholder ${name} (${sharesPercent}% shares).`
      );
      recordAuditEvent({
        action: "UPDATE",
        entityType: "Company",
        entityId: company.id,
        companyId: company.id,
        role: "Compliance Administrator",
        details: `Updated shareholder record ${editingShareholder.id} (${name}, ${sharesPercent}%).`,
        actor: "System Administrator",
      });
      setEditingShareholder(null);
    } else {
      // Create new
      const newRecord: BusinessShareholderRecord = {
        id: generateStableId("SHR", company.id),
        name,
        role,
        shares: sharesPercent,
        address,
        isArchived: false,
      };

      persistStore((prev) => ({
        ...prev,
        shareholders: [newRecord, ...prev.shareholders],
      }));
      recordBusinessEvent(
        "ADD_SHAREHOLDER",
        `Added ${role} ${name} with ${sharesPercent}% ownership.`
      );
      recordAuditEvent({
        action: "CREATE",
        entityType: "Company",
        entityId: company.id,
        companyId: company.id,
        role: "Compliance Administrator",
        details: `Created shareholder record ${newRecord.id} (${name}, ${sharesPercent}%).`,
        actor: "System Administrator",
      });
      setShowAddShareholder(false);
    }
  };

  const handleArchiveShareholder = (record: BusinessShareholderRecord, archive: boolean) => {
    persistStore((prev) => ({
      ...prev,
      shareholders: prev.shareholders.map((s) =>
        s.id === record.id
          ? {
              ...s,
              isArchived: archive,
              archivedAt: archive ? new Date().toISOString() : undefined,
              archivedBy: archive ? "System Administrator" : undefined,
              archiveReason: archive ? "Archived by operator" : undefined,
            }
          : s
      ),
    }));

    recordBusinessEvent(
      archive ? "ARCHIVE_SHAREHOLDER" : "RESTORE_SHAREHOLDER",
      `${archive ? "Archived" : "Restored"} shareholder record ${record.name} (${record.id}).`
    );
    recordAuditEvent({
      action: archive ? "ARCHIVE" : "RESTORE",
      entityType: "Company",
      entityId: company.id,
      companyId: company.id,
      role: "Compliance Administrator",
      details: `${archive ? "Archived" : "Restored"} shareholder record ${record.id} (${record.name}).`,
      actor: "System Administrator",
    });
  };

  // =========================================================================
  // HANDLERS: ANNUAL RETURNS
  // =========================================================================

  const handleSaveReturn = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const dueDate = String(formData.get("dueDate") || "").trim();
    const filedDate = String(formData.get("filedDate") || "").trim();
    const filedBy = String(formData.get("filedBy") || "").trim();
    const confirmationNumber = String(formData.get("confirmationNumber") || "").trim();

    if (!dueDate || !filedBy) return;

    if (editingReturn) {
      persistStore((prev) => ({
        ...prev,
        annualReturns: prev.annualReturns.map((r) =>
          r.id === editingReturn.id
            ? {
                ...r,
                dueDate,
                filedDate: filedDate || undefined,
                filedBy,
                confirmationNumber: confirmationNumber || undefined,
                status: filedDate ? "Filed" : "Pending",
              }
            : r
        ),
      }));
      recordBusinessEvent("EDIT_ANNUAL_RETURN", `Updated annual return due ${dueDate}.`);
      recordAuditEvent({
        action: "UPDATE",
        entityType: "Company",
        entityId: company.id,
        companyId: company.id,
        role: "Compliance Administrator",
        details: `Updated annual return filing ${editingReturn.id} (Due: ${dueDate}, Filed: ${filedDate || "Pending"}).`,
        actor: "System Administrator",
      });
      setEditingReturn(null);
    } else {
      const newRecord: BusinessAnnualReturnRecord = {
        id: generateStableId("RTN", company.id),
        dueDate,
        filedDate: filedDate || undefined,
        filedBy,
        confirmationNumber: confirmationNumber || undefined,
        status: filedDate ? "Filed" : "Pending",
        isArchived: false,
      };

      persistStore((prev) => ({
        ...prev,
        annualReturns: [newRecord, ...prev.annualReturns],
      }));
      recordBusinessEvent("ADD_ANNUAL_RETURN", `Recorded annual return due ${dueDate}.`);
      recordAuditEvent({
        action: "CREATE",
        entityType: "Company",
        entityId: company.id,
        companyId: company.id,
        role: "Compliance Administrator",
        details: `Recorded annual return filing ${newRecord.id} (Due: ${dueDate}, Filed: ${filedDate || "Pending"}).`,
        actor: "System Administrator",
      });
      setShowAddReturn(false);
    }
  };

  const handleArchiveReturn = (record: BusinessAnnualReturnRecord, archive: boolean) => {
    persistStore((prev) => ({
      ...prev,
      annualReturns: prev.annualReturns.map((r) =>
        r.id === record.id
          ? {
              ...r,
              isArchived: archive,
              archivedAt: archive ? new Date().toISOString() : undefined,
              archivedBy: archive ? "System Administrator" : undefined,
            }
          : r
      ),
    }));
    recordBusinessEvent(
      archive ? "ARCHIVE_ANNUAL_RETURN" : "RESTORE_ANNUAL_RETURN",
      `${archive ? "Archived" : "Restored"} annual return ${record.id} (Due: ${record.dueDate}).`
    );
    recordAuditEvent({
      action: archive ? "ARCHIVE" : "RESTORE",
      entityType: "Company",
      entityId: company.id,
      companyId: company.id,
      role: "Compliance Administrator",
      details: `${archive ? "Archived" : "Restored"} annual return filing ${record.id} (Due: ${record.dueDate}).`,
      actor: "System Administrator",
    });
  };

  // =========================================================================
  // HANDLERS: CRA BUSINESS NUMBER (Dual-Write Master Sync, Consistency & Rollback)
  // =========================================================================

  const handleSaveCraRecord = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCraError(null);
    setTaxActionError(null);
    const formData = new FormData(e.currentTarget);
    const rawAccountNo = String(formData.get("accountNo") || "").trim();
    const obtainedDate = String(formData.get("obtainedDate") || "").trim();
    const obtainedBy = String(formData.get("obtainedBy") || "System Administrator").trim();

    const normalizedBN = normalizeCRABusinessNumber(rawAccountNo);

    if (!validateCRABusinessNumberFormat(normalizedBN)) {
      setCraError("Invalid CRA Business Number. Must contain exactly 9 numeric digits.");
      return;
    }

    // Retain original serialized tes_companies and local company state before modifying
    const rawOriginalCompanies = localStorage.getItem("tes_companies");
    const previousCompanyState = company ? { ...company } : null;

    try {
      const companies = rawOriginalCompanies ? JSON.parse(rawOriginalCompanies) : [];
      const companyIndex = companies.findIndex((c: any) => c.id === company.id);

      if (companyIndex === -1) {
        setCraError("Company Master synchronization failed: Company record not found.");
        return;
      }

      // Step A: Master update in tes_companies and local state
      const updatedCompanies = [...companies];
      updatedCompanies[companyIndex] = {
        ...updatedCompanies[companyIndex],
        businessNo: normalizedBN,
      };
      localStorage.setItem("tes_companies", JSON.stringify(updatedCompanies));
      setCompany({ ...company, businessNo: normalizedBN });

      // Step B: Business CRA history update
      const newRecord: BusinessTaxAccountRecord = {
        id: generateStableId("TAX-CRA", company.id),
        taxType: "CRA_BN",
        jurisdiction: "Federal (Canada)",
        accountNo: normalizedBN,
        rootBN: normalizedBN,
        obtainedDate: obtainedDate || new Date().toISOString().split("T")[0],
        obtainedBy,
        isPrimary: true,
        isArchived: false,
      };

      try {
        persistStore((prev) => ({
          ...prev,
          taxAccounts: [
            newRecord,
            ...prev.taxAccounts.map((t) =>
              t.taxType === "CRA_BN" ? { ...t, isPrimary: false } : t
            ),
          ],
        }));

        recordBusinessEvent(
          "REGISTER_CRA_BN",
          `Registered CRA Business Number ${normalizedBN} as primary master identifier.`
        );
        recordAuditEvent({
          action: "UPDATE",
          entityType: "Company",
          entityId: company.id,
          companyId: company.id,
          role: "Compliance Administrator",
          details: `Synchronized primary CRA Business Number to ${normalizedBN}.`,
          actor: "System Administrator",
        });

        setShowAddCra(false);
      } catch (storeErr) {
        // Rollback Step A if Business persistence fails
        if (rawOriginalCompanies !== null) {
          localStorage.setItem("tes_companies", rawOriginalCompanies);
        } else {
          localStorage.removeItem("tes_companies");
        }
        setCompany(previousCompanyState);
        throw storeErr;
      }
    } catch (err) {
      console.error("Failed to commit CRA Business Number master synchronization:", err);
      if (rawOriginalCompanies !== null) {
        localStorage.setItem("tes_companies", rawOriginalCompanies);
      } else {
        localStorage.removeItem("tes_companies");
      }
      setCompany(previousCompanyState);
      setCraError("Failed to persist CRA Business Number. Operation rolled back.");
    }
  };

  // =========================================================================
  // HANDLERS: IRS EIN
  // =========================================================================

  const handleSaveEinRecord = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEinError(null);
    const formData = new FormData(e.currentTarget);
    const rawAccountNo = String(formData.get("accountNo") || "").trim();
    const obtainedDate = String(formData.get("obtainedDate") || "").trim();
    const obtainedBy = String(formData.get("obtainedBy") || "System Administrator").trim();

    if (!validateEINFormat(rawAccountNo)) {
      setEinError("Invalid EIN format. Must contain 9 digits (e.g. 12-3456789).");
      return;
    }

    const normalized = normalizeEIN(rawAccountNo);

    const newRecord: BusinessTaxAccountRecord = {
      id: generateStableId("TAX-EIN", company.id),
      taxType: "IRS_EIN",
      jurisdiction: "Federal (US)",
      accountNo: normalized,
      obtainedDate: obtainedDate || new Date().toISOString().split("T")[0],
      obtainedBy,
      isPrimary: true,
      isArchived: false,
    };

    persistStore((prev) => ({
      ...prev,
      taxAccounts: [
        newRecord,
        ...prev.taxAccounts.map((t) =>
          t.taxType === "IRS_EIN" ? { ...t, isPrimary: false } : t
        ),
      ],
    }));

    recordBusinessEvent("REGISTER_EIN", `Recorded IRS EIN ${normalized}.`);
    recordAuditEvent({
      action: "CREATE",
      entityType: "Company",
      entityId: company.id,
      companyId: company.id,
      role: "Compliance Administrator",
      details: `Recorded IRS EIN registration ${normalized}.`,
      actor: "System Administrator",
    });

    setShowAddEin(false);
  };

  // =========================================================================
  // HANDLERS: GST / HST PROGRAM ACCOUNTS (Strict Validation & Master Matching)
  // =========================================================================

  const handleSaveGstRecord = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setGstError(null);
    const formData = new FormData(e.currentTarget);
    const rawAccountNo = String(formData.get("accountNo") || "").trim();
    const obtainedDate = String(formData.get("obtainedDate") || "").trim();
    const obtainedBy = String(formData.get("obtainedBy") || "System Administrator").trim();

    const parsed = parseCRAProgramAccount(rawAccountNo);

    // Strict validation: Require structurally valid 9-digit BN + RT + 4-digit sequence
    if (
      !parsed.isValid ||
      parsed.programIdentifier !== "RT" ||
      parsed.rootBN.length !== 9 ||
      parsed.programSequence.length !== 4
    ) {
      setGstError(
        "Invalid GST/HST Program Account. Format must be 9-digit BN + RT + 4-digit sequence (e.g. 123456789RT0001)."
      );
      return;
    }

    // If company.businessNo already exists, verify matching root BN
    if (company?.businessNo && parsed.rootBN !== company.businessNo) {
      setGstError(
        `Root Business Number (${parsed.rootBN}) does not match authoritative company master CRA BN (${company.businessNo}).`
      );
      return;
    }

    const newRecord: BusinessTaxAccountRecord = {
      id: generateStableId("TAX-GST", company.id),
      taxType: "GST_HST",
      jurisdiction: "Canada",
      accountNo: parsed.fullAccount,
      rootBN: parsed.rootBN,
      programIdentifier: "RT",
      programSequence: parsed.programSequence,
      obtainedDate: obtainedDate || new Date().toISOString().split("T")[0],
      obtainedBy,
      isPrimary: false,
      isArchived: false,
    };

    persistStore((prev) => ({
      ...prev,
      taxAccounts: [newRecord, ...prev.taxAccounts],
    }));

    recordBusinessEvent("REGISTER_GST", `Recorded GST/HST program account ${parsed.fullAccount}.`);
    recordAuditEvent({
      action: "CREATE",
      entityType: "Company",
      entityId: company.id,
      companyId: company.id,
      role: "Compliance Administrator",
      details: `Recorded GST/HST program account ${parsed.fullAccount}.`,
      actor: "System Administrator",
    });

    setShowAddGst(false);
  };

  // =========================================================================
  // HANDLERS: STATE SALES TAX
  // =========================================================================

  const handleSaveSalesTaxRecord = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const jurisdiction = String(formData.get("jurisdiction") || "US").trim().toUpperCase();
    const rawAccountNo = String(formData.get("accountNo") || "").trim();
    const obtainedDate = String(formData.get("obtainedDate") || "").trim();
    const obtainedBy = String(formData.get("obtainedBy") || "System Administrator").trim();

    if (!rawAccountNo) return;

    const normalized = normalizeTaxId(rawAccountNo);

    const newRecord: BusinessTaxAccountRecord = {
      id: generateStableId("TAX-STX", company.id),
      taxType: "STATE_SALES_TAX",
      jurisdiction,
      accountNo: normalized,
      obtainedDate: obtainedDate || new Date().toISOString().split("T")[0],
      obtainedBy,
      isPrimary: true,
      isArchived: false,
    };

    persistStore((prev) => ({
      ...prev,
      taxAccounts: [newRecord, ...prev.taxAccounts],
    }));

    recordBusinessEvent(
      "REGISTER_SALES_TAX",
      `Recorded ${jurisdiction} Sales Tax registration ${normalized}.`
    );
    recordAuditEvent({
      action: "CREATE",
      entityType: "Company",
      entityId: company.id,
      companyId: company.id,
      role: "Compliance Administrator",
      details: `Recorded ${jurisdiction} Sales Tax registration ${normalized}.`,
      actor: "System Administrator",
    });

    setShowAddSalesTax(false);
  };

  const handleArchiveTaxRecord = (record: BusinessTaxAccountRecord, archive: boolean) => {
    setTaxActionError(null);

    // Protect active Master CRA from archive
    if (
      archive &&
      record.taxType === "CRA_BN" &&
      record.isPrimary === true &&
      record.accountNo === company?.businessNo
    ) {
      setTaxActionError(
        "This CRA Business Number is the active Company Master identifier. Register a replacement Business Number before archiving this record."
      );
      return;
    }

    persistStore((prev) => ({
      ...prev,
      taxAccounts: prev.taxAccounts.map((t) =>
        t.id === record.id
          ? {
              ...t,
              isArchived: archive,
              archivedAt: archive ? new Date().toISOString() : undefined,
              archivedBy: archive ? "System Administrator" : undefined,
            }
          : t
      ),
    }));
    recordBusinessEvent(
      archive ? "ARCHIVE_TAX_ACCOUNT" : "RESTORE_TAX_ACCOUNT",
      `${archive ? "Archived" : "Restored"} tax account ${record.accountNo} (${record.id}).`
    );
    recordAuditEvent({
      action: archive ? "ARCHIVE" : "RESTORE",
      entityType: "Company",
      entityId: company.id,
      companyId: company.id,
      role: "Compliance Administrator",
      details: `${archive ? "Archived" : "Restored"} tax account ${record.id} (${record.accountNo}, ${record.taxType}).`,
      actor: "System Administrator",
    });
  };

  // =========================================================================
  // HANDLERS: DOCUMENT PREVIEW (Non-Persisted Ephemeral Preview)
  // =========================================================================

  const handleOpenSourcePicker = (targetLabel: string) => {
    setDocumentTarget(targetLabel);
    setIsSourcePickerOpen(true);
  };

  const handleFileSelected = (file: File) => {
    // Revoke previous object URL if one exists
    if (previewDocument?.url) {
      URL.revokeObjectURL(previewDocument.url);
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewDocument({
      name: file.name,
      url: objectUrl,
      target: documentTarget || "Corporate Records",
    });
    // Operational honesty: Document is strictly in preview mode.
    // DO NOT record INGEST_DOCUMENT, DO NOT audit ingestion, and DO NOT create evidence keys.
  };

  if (loading) {
    return <LoadingState message="Loading business & corporate records..." />;
  }

  if (!company) {
    return (
      <EmptyState
        title="Company Not Found"
        description="The requested company record does not exist or has been removed from the portal."
        action={{
          label: "Return to Companies",
          onClick: () => router.push("/companies"),
        }}
      />
    );
  }

  // Filtered sub-record views
  const visibleShareholders = (businessStore.shareholders || []).filter(
    (s) => showArchivedShareholders || !s.isArchived
  );
  const visibleReturns = (businessStore.annualReturns || []).filter(
    (r) => showArchivedReturns || !r.isArchived
  );
  const craRecords = (businessStore.taxAccounts || []).filter(
    (t) => t.taxType === "CRA_BN" && (showArchivedTaxes || !t.isArchived)
  );
  const einRecords = (businessStore.taxAccounts || []).filter(
    (t) => t.taxType === "IRS_EIN" && (showArchivedTaxes || !t.isArchived)
  );
  const gstRecords = (businessStore.taxAccounts || []).filter(
    (t) => t.taxType === "GST_HST" && (showArchivedTaxes || !t.isArchived)
  );
  const salesTaxRecords = (businessStore.taxAccounts || []).filter(
    (t) => t.taxType === "STATE_SALES_TAX" && (showArchivedTaxes || !t.isArchived)
  );

  return (
    <div className="flex flex-col gap-6 pb-12 max-w-6xl mx-auto">
      {/* 1. HEADER & COMPLIANCE CONTEXT */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.push(`/companies/${company.id}/profile`)}
            className="flex size-9 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Back to Company Profile"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Business & Corporate Records
            </h1>
            <p className="text-muted-foreground text-xs">
              {company.name} • <span className="font-mono">{company.id}</span>
            </p>
          </div>
        </div>

        {/* Regulatory Origin & Operating Status Bar */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-0.5">
                Registered Origin
              </span>
              <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                <Building2 className="size-3.5 text-primary shrink-0" />
                {company.regCorpState || "Unknown"}, {company.regCorpCountry || "Unknown"}
              </span>
            </div>
            <div className="h-7 w-px bg-border/60" />
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-0.5">
                Operating Region
              </span>
              <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                {company.region || "Unassigned"}
              </span>
            </div>
            <div className="h-7 w-px bg-border/60" />
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-0.5">
                Active Ownership Documented
              </span>
              <span
                className={`font-semibold flex items-center gap-1 text-xs ${
                  totalActiveOwnership > 100
                    ? "text-destructive font-bold"
                    : totalActiveOwnership === 100
                    ? "text-emerald-600 dark:text-emerald-400 font-bold"
                    : "text-foreground"
                }`}
              >
                {totalActiveOwnership.toFixed(1)}% / 100.0%
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Storage: <span className="font-mono text-foreground font-semibold">Layer-1 Synced</span>
            </span>
          </div>
        </div>
      </div>

      {/* 2. INCORPORATION SUMMARY (Master Synchronized) */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Incorporation Information</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isEditingIncorp) {
                setIncorpDateDraft(company.incorpDate || "");
              }
              setIsEditingIncorp(!isEditingIncorp);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
          >
            {isEditingIncorp ? (
              <>
                <X className="size-3.5" /> Cancel
              </>
            ) : (
              <>
                <Pencil className="size-3.5" /> Edit
              </>
            )}
          </button>
        </div>

        <div className="p-6">
          {isEditingIncorp ? (
            <form onSubmit={handleSaveIncorp} className="space-y-6">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Record ID
                  </label>
                  <input
                    value={company.id}
                    disabled
                    className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-xs font-mono font-medium text-muted-foreground cursor-not-allowed"
                  />
                  <p className="text-[10px] text-muted-foreground">Authoritative company identifier (Locked)</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {isCanadaRegistered ? "Corporate Number" : "State File Number"}
                  </label>
                  <input
                    value={company.incorpNo || ""}
                    disabled
                    className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-muted-foreground cursor-not-allowed"
                  />
                  <p className="text-[10px] text-muted-foreground">Managed on Company Profile (Locked)</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Incorporation Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    value={incorpDateDraft}
                    onChange={(e) => setIncorpDateDraft(e.target.value)}
                    required
                    className="w-full h-9 rounded-lg border border-primary/50 bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                  <p className="text-[10px] text-primary">Writes directly to tes_companies</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Jurisdiction
                  </label>
                  <input
                    value={`${company.regCorpState || "Unknown"}, ${company.regCorpCountry || "Unknown"}`}
                    disabled
                    className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-muted-foreground cursor-not-allowed"
                  />
                  <p className="text-[10px] text-muted-foreground">Home jurisdiction (Locked)</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setIncorpDateDraft(company.incorpDate || "");
                    setIsEditingIncorp(false);
                  }}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  <Check className="size-3.5" /> Save Updates
                </button>
              </div>
            </form>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <ReadOnlyField label="Record ID" value={company.id} mono copyable />
              <ReadOnlyField
                label={isCanadaRegistered ? "Corporate Number" : "State File Number"}
                value={company.incorpNo}
                mono
                copyable
                subtext="Managed on Company Profile"
              />
              <ReadOnlyField
                label="Incorporation Date"
                value={company.incorpDate}
                subtext="Statutory legal establishment date"
              />
              <ReadOnlyField
                label="Jurisdiction"
                value={`${company.regCorpState || "Unknown"}, ${company.regCorpCountry || "Unknown"}`}
              />
            </div>
          )}

          {/* Shared Foundation Document Attachment Dropzone */}
          <div className="mt-6 pt-6 border-t border-border/60">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-dashed border-border bg-muted/20 p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                  <FileCheck2 className="size-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground">
                    Corporate Formation Documents & Articles
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    {isCanadaRegistered
                      ? "Articles of Incorporation, Certificate of Status, or Continuance."
                      : "State Charter, Articles of Organization, or Certificate of Good Standing."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleOpenSourcePicker("Incorporation Articles")}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <UploadCloud className="size-3.5 text-primary" /> Select Document
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. DIRECTORS & SHAREHOLDERS (Validated Ownership ≤ 100%) */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">Directors & Shareholders</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {activeShareholders.length} Active
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Corporate equity distribution, statutory directors, and officer registry.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowArchivedShareholders(!showArchivedShareholders)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                showArchivedShareholders
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Toggle historical archived shareholders"
            >
              <Archive className="size-3.5" />
              {showArchivedShareholders ? "Hide Archived" : "Show Archived"}
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingShareholder(null);
                setShareholderError(null);
                setShowAddShareholder(!showAddShareholder);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              {showAddShareholder ? (
                <>
                  <X className="size-3.5" /> Close
                </>
              ) : (
                <>
                  <Plus className="size-3.5" /> Add Record
                </>
              )}
            </button>
          </div>
        </div>

        {/* Add / Edit Form Drawer */}
        {(showAddShareholder || editingShareholder) && (
          <form
            onSubmit={handleSaveShareholder}
            className="p-5 bg-muted/15 border-b border-border space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                {editingShareholder ? "Edit Corporate Person" : "Add Director / Shareholder"}
              </h3>
              <span className="text-[11px] text-muted-foreground">
                Current recorded equity:{" "}
                <span className="font-bold text-foreground">{totalActiveOwnership.toFixed(1)}%</span>
              </span>
            </div>

            {shareholderError && (
              <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{shareholderError}</span>
              </div>
            )}

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Full Legal Name <span className="text-destructive">*</span>
                </label>
                <input
                  name="name"
                  defaultValue={editingShareholder?.name || ""}
                  placeholder="e.g. Eleanor Vance"
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Role / Position</label>
                <select
                  name="role"
                  defaultValue={editingShareholder?.role || "Shareholder"}
                  className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                >
                  <option value="Shareholder">Shareholder (Equity Owner)</option>
                  <option value="Director">Director (Board Member)</option>
                  <option value="Officer">Officer (Executive)</option>
                  <option value="Director & Shareholder">Director & Shareholder</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Percent Equity Ownership (%) <span className="text-destructive">*</span>
                </label>
                <input
                  name="shares"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  defaultValue={editingShareholder?.shares ?? 50}
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Available remaining equity: {(100 - (totalActiveOwnership - (editingShareholder?.shares || 0))).toFixed(1)}%
                </p>
              </div>

              <div className="sm:col-span-3 space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Service / Registered Address <span className="text-destructive">*</span>
                </label>
                <input
                  name="address"
                  defaultValue={editingShareholder?.address || ""}
                  placeholder="e.g. 100 King St W, Suite 4000, Toronto, ON M5X 1A9"
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/60">
              <button
                type="button"
                onClick={() => {
                  setShowAddShareholder(false);
                  setEditingShareholder(null);
                  setShareholderError(null);
                }}
                className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
              >
                <Check className="size-3.5" />
                {editingShareholder ? "Save Changes" : "Save Record"}
              </button>
            </div>
          </form>
        )}

        {/* Table Ledger */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/20 border-b border-border font-bold uppercase tracking-wider text-muted-foreground text-[10px]">
              <tr>
                <th className="px-5 py-3">Record ID</th>
                <th className="px-5 py-3">Name & Role</th>
                <th className="px-5 py-3">Ownership</th>
                <th className="px-5 py-3">Address</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleShareholders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No active shareholder or director records found. Click &quot;Add Record&quot; to establish ownership.
                  </td>
                </tr>
              ) : (
                visibleShareholders.map((shr) => (
                  <tr
                    key={shr.id}
                    className={`hover:bg-muted/10 transition-colors ${
                      shr.isArchived ? "bg-muted/30 opacity-70" : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-mono font-medium text-foreground">
                      {shr.id}
                      {shr.isArchived && (
                        <span className="ml-2 inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-foreground">{shr.name}</div>
                      <div className="text-[10px] text-muted-foreground">{shr.role}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-bold text-foreground">{shr.shares}%</span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground max-w-xs truncate" title={shr.address}>
                      {shr.address}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {!shr.isArchived ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingShareholder(shr);
                                setShowAddShareholder(false);
                              }}
                              className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Edit Record"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleArchiveShareholder(shr, true)}
                              className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                              title="Archive Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleArchiveShareholder(shr, false)}
                            className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                            title="Restore Record"
                          >
                            <RotateCcw className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. ANNUAL RETURNS LEDGER */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">Annual Corporate Returns</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {visibleReturns.length} Records
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Statutory corporate filing history and compliance confirmation archive.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowArchivedReturns(!showArchivedReturns)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                showArchivedReturns
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Archive className="size-3.5" />
              {showArchivedReturns ? "Hide Archived" : "Show Archived"}
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingReturn(null);
                setShowAddReturn(!showAddReturn);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              {showAddReturn ? (
                <>
                  <X className="size-3.5" /> Close
                </>
              ) : (
                <>
                  <Plus className="size-3.5" /> Add Filing
                </>
              )}
            </button>
          </div>
        </div>

        {/* Add / Edit Filing Form */}
        {(showAddReturn || editingReturn) && (
          <form
            onSubmit={handleSaveReturn}
            className="p-5 bg-muted/15 border-b border-border space-y-4"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              {editingReturn ? "Edit Annual Filing" : "Record Annual Return Filing"}
            </h3>

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Statutory Due Date <span className="text-destructive">*</span>
                </label>
                <input
                  name="dueDate"
                  type="date"
                  defaultValue={editingReturn?.dueDate || ""}
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Actual Filed Date</label>
                <input
                  name="filedDate"
                  type="date"
                  defaultValue={editingReturn?.filedDate || ""}
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Filed By / Agent</label>
                <input
                  name="filedBy"
                  defaultValue={editingReturn?.filedBy || ""}
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="sm:col-span-3 space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Jurisdiction Filing Confirmation #
                </label>
                <input
                  name="confirmationNumber"
                  defaultValue={editingReturn?.confirmationNumber || ""}
                  placeholder="e.g. ON-CORP-2025-99812"
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/60">
              <button
                type="button"
                onClick={() => {
                  setShowAddReturn(false);
                  setEditingReturn(null);
                }}
                className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
              >
                <Check className="size-3.5" />
                {editingReturn ? "Save Changes" : "Save Filing"}
              </button>
            </div>
          </form>
        )}

        {/* Ledger Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/20 border-b border-border font-bold uppercase tracking-wider text-muted-foreground text-[10px]">
              <tr>
                <th className="px-5 py-3">Filing ID</th>
                <th className="px-5 py-3">Due Date</th>
                <th className="px-5 py-3">Filed Date</th>
                <th className="px-5 py-3">Submitter</th>
                <th className="px-5 py-3">Confirmation #</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleReturns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No annual corporate return filings recorded yet.
                  </td>
                </tr>
              ) : (
                visibleReturns.map((rtn) => (
                  <tr
                    key={rtn.id}
                    className={`hover:bg-muted/10 transition-colors ${
                      rtn.isArchived ? "bg-muted/30 opacity-70" : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-mono font-medium text-foreground">
                      {rtn.id}
                      {rtn.isArchived && (
                        <span className="ml-2 inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-foreground font-medium">{rtn.dueDate}</td>
                    <td className="px-5 py-3">
                      {rtn.filedDate ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" /> {rtn.filedDate}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                          <Clock className="size-3" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{rtn.filedBy}</td>
                    <td className="px-5 py-3 font-mono text-[11px] text-muted-foreground">
                      {rtn.confirmationNumber || "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenSourcePicker(`Annual Return ${rtn.id}`)}
                          className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Preview filing document"
                        >
                          <UploadCloud className="size-3 inline mr-1" /> Select Document
                        </button>
                        {!rtn.isArchived ? (
                          <button
                            type="button"
                            onClick={() => handleArchiveReturn(rtn, true)}
                            className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                            title="Archive Filing"
                          >
                            <Archive className="size-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleArchiveReturn(rtn, false)}
                            className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                            title="Restore Filing"
                          >
                            <RotateCcw className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. DYNAMIC REGIONAL TAX LEDGERS */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* CRA BUSINESS NUMBER (Canadian / Cross-Border) */}
        {needsCanadianTaxes && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col">
            <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  CRA Business Number (BN9)
                </h3>
                <p className="text-[10px] text-muted-foreground">Federal Canadian tax identity</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowArchivedTaxes(!showArchivedTaxes)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Toggle archived tax accounts"
                >
                  <Archive className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCraError(null);
                    setShowAddCra(!showAddCra);
                  }}
                  className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                >
                  {showAddCra ? <X className="size-3" /> : <Plus className="size-3" />}
                  {showAddCra ? "Cancel" : "Add"}
                </button>
              </div>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {taxActionError && (
                <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg mb-3 flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{taxActionError}</span>
                </div>
              )}
              {showAddCra && (
                <form onSubmit={handleSaveCraRecord} className="p-3.5 bg-muted/15 rounded-xl border border-border mb-4 space-y-3">
                  {craError && (
                    <div className="text-[11px] text-destructive bg-destructive/10 p-2 rounded-lg">
                      {craError}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-foreground">9-Digit Business Number</label>
                    <input
                      name="accountNo"
                      placeholder="e.g. 123456789"
                      required
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground"
                    />
                    <p className="text-[9px] text-muted-foreground">Synchronizes to company.businessNo in tes_companies</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained Date</label>
                      <input
                        name="obtainedDate"
                        type="date"
                        defaultValue={new Date().toISOString().split("T")[0]}
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained By</label>
                      <input
                        name="obtainedBy"
                        defaultValue="System Administrator"
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                  >
                    Save & Synchronize BN
                  </button>
                </form>
              )}

              {craRecords.length === 0 ? (
                <div className="my-auto py-8 text-center text-muted-foreground text-xs">
                  <FileText className="size-8 mx-auto opacity-20 mb-2" />
                  <p>No CRA Business Number registered.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 text-xs">
                  {craRecords.map((rec) => (
                    <div key={rec.id} className={`py-3 flex items-center justify-between ${rec.isArchived ? "opacity-60 bg-muted/20 px-2 rounded" : ""}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground tracking-wider">
                            {rec.accountNo}
                          </span>
                          {rec.isPrimary && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                              Master Active
                            </span>
                          )}
                          {rec.isArchived && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                              Archived
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground">{rec.id}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-[11px] text-muted-foreground">
                          <p>{rec.obtainedDate}</p>
                          <p>{rec.obtainedBy}</p>
                        </div>
                        <div>
                          {!rec.isArchived ? (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, true)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                              title="Archive Tax Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, false)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                              title="Restore Tax Record"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* IRS EIN (US / Cross-Border) */}
        {needsUSTaxes && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col">
            <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  IRS EIN Letters (SS-4 / CP-575)
                </h3>
                <p className="text-[10px] text-muted-foreground">Federal US employer tax identity</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEinError(null);
                  setShowAddEin(!showAddEin);
                }}
                className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                {showAddEin ? <X className="size-3" /> : <Plus className="size-3" />}
                {showAddEin ? "Cancel" : "Add"}
              </button>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {showAddEin && (
                <form onSubmit={handleSaveEinRecord} className="p-3.5 bg-muted/15 rounded-xl border border-border mb-4 space-y-3">
                  {einError && (
                    <div className="text-[11px] text-destructive bg-destructive/10 p-2 rounded-lg">
                      {einError}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-foreground">EIN Number (XX-XXXXXXX)</label>
                    <input
                      name="accountNo"
                      placeholder="e.g. 12-3456789"
                      required
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained Date</label>
                      <input
                        name="obtainedDate"
                        type="date"
                        defaultValue={new Date().toISOString().split("T")[0]}
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained By</label>
                      <input
                        name="obtainedBy"
                        defaultValue="System Administrator"
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                  >
                    Save EIN Record
                  </button>
                </form>
              )}

              {einRecords.length === 0 ? (
                <div className="my-auto py-8 text-center text-muted-foreground text-xs">
                  <FileText className="size-8 mx-auto opacity-20 mb-2" />
                  <p>No IRS EIN records added.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 text-xs">
                  {einRecords.map((rec) => (
                    <div key={rec.id} className={`py-3 flex items-center justify-between ${rec.isArchived ? "opacity-60 bg-muted/20 px-2 rounded" : ""}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground tracking-wider">
                            {rec.accountNo}
                          </span>
                          {rec.isPrimary && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                              Active EIN
                            </span>
                          )}
                          {rec.isArchived && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                              Archived
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground">{rec.id}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-[11px] text-muted-foreground">
                          <p>{rec.obtainedDate}</p>
                          <p>{rec.obtainedBy}</p>
                        </div>
                        <div>
                          {!rec.isArchived ? (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, true)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                              title="Archive EIN Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, false)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                              title="Restore EIN Record"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* GST / HST PROGRAM ACCOUNTS (Canadian / Cross-Border) */}
        {needsCanadianTaxes && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col">
            <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  GST / HST Program Accounts (RT0001)
                </h3>
                <p className="text-[10px] text-muted-foreground">Consumption tax account registration</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGstError(null);
                  setShowAddGst(!showAddGst);
                }}
                className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                {showAddGst ? <X className="size-3" /> : <Plus className="size-3" />}
                {showAddGst ? "Cancel" : "Add"}
              </button>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {showAddGst && (
                <form onSubmit={handleSaveGstRecord} className="p-3.5 bg-muted/15 rounded-xl border border-border mb-4 space-y-3">
                  {gstError && (
                    <div className="text-[11px] text-destructive bg-destructive/10 p-2 rounded-lg">
                      {gstError}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-foreground">Program Account No</label>
                    <input
                      name="accountNo"
                      placeholder={`e.g. ${company?.businessNo || "123456789"}RT0001`}
                      defaultValue={company?.businessNo ? `${company.businessNo}RT0001` : ""}
                      required
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground"
                    />
                    <p className="text-[9px] text-muted-foreground">9-digit root BN + RT + 4-digit sequence</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained Date</label>
                      <input
                        name="obtainedDate"
                        type="date"
                        defaultValue={new Date().toISOString().split("T")[0]}
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained By</label>
                      <input
                        name="obtainedBy"
                        defaultValue="System Administrator"
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                  >
                    Save GST/HST Account
                  </button>
                </form>
              )}

              {gstRecords.length === 0 ? (
                <div className="my-auto py-8 text-center text-muted-foreground text-xs">
                  <FileText className="size-8 mx-auto opacity-20 mb-2" />
                  <p>No GST/HST accounts registered.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 text-xs">
                  {gstRecords.map((rec) => (
                    <div key={rec.id} className={`py-3 flex items-center justify-between ${rec.isArchived ? "opacity-60 bg-muted/20 px-2 rounded" : ""}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground tracking-wider">
                            {rec.accountNo}
                          </span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            RT Program
                          </span>
                          {rec.isArchived && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                              Archived
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground">{rec.id}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-[11px] text-muted-foreground">
                          <p>{rec.obtainedDate}</p>
                          <p>{rec.obtainedBy}</p>
                        </div>
                        <div>
                          {!rec.isArchived ? (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, true)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                              title="Archive GST/HST Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, false)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                              title="Restore GST/HST Record"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* US STATE SALES TAX (US / Cross-Border) */}
        {needsUSTaxes && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col">
            <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  US State Sales Tax IDs
                </h3>
                <p className="text-[10px] text-muted-foreground">Jurisdiction-scoped sales tax permits</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSalesTax(!showAddSalesTax)}
                className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                {showAddSalesTax ? <X className="size-3" /> : <Plus className="size-3" />}
                {showAddSalesTax ? "Cancel" : "Add"}
              </button>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {showAddSalesTax && (
                <form onSubmit={handleSaveSalesTaxRecord} className="p-3.5 bg-muted/15 rounded-xl border border-border mb-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">State Code</label>
                      <input
                        name="jurisdiction"
                        placeholder="e.g. CA"
                        maxLength={2}
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono uppercase text-foreground"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Account / Permit No</label>
                      <input
                        name="accountNo"
                        placeholder="e.g. SR-CA-992182"
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained Date</label>
                      <input
                        name="obtainedDate"
                        type="date"
                        defaultValue={new Date().toISOString().split("T")[0]}
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained By</label>
                      <input
                        name="obtainedBy"
                        defaultValue="System Administrator"
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                  >
                    Save Sales Tax ID
                  </button>
                </form>
              )}

              {salesTaxRecords.length === 0 ? (
                <div className="my-auto py-8 text-center text-muted-foreground text-xs">
                  <FileText className="size-8 mx-auto opacity-20 mb-2" />
                  <p>No State Sales Tax IDs registered.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 text-xs">
                  {salesTaxRecords.map((rec) => (
                    <div key={rec.id} className={`py-3 flex items-center justify-between ${rec.isArchived ? "opacity-60 bg-muted/20 px-2 rounded" : ""}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground tracking-wider">
                            {rec.accountNo}
                          </span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            {rec.jurisdiction || "State"}
                          </span>
                          {rec.isArchived && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                              Archived
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground">{rec.id}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-[11px] text-muted-foreground">
                          <p>{rec.obtainedDate}</p>
                          <p>{rec.obtainedBy}</p>
                        </div>
                        <div>
                          {!rec.isArchived ? (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, true)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                              title="Archive Sales Tax Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, false)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                              title="Restore Sales Tax Record"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 6. BUSINESS MODULE EVENT HISTORY / AUDIT REGISTER */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="size-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Business Audit & Change Ledger</h3>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            {businessStore.eventHistory?.length || 0} events recorded
          </span>
        </div>
        <div className="p-4 max-h-60 overflow-y-auto divide-y divide-border/60 text-xs">
          {(businessStore.eventHistory || []).length === 0 ? (
            <p className="p-4 text-center text-muted-foreground">No events recorded yet.</p>
          ) : (
            businessStore.eventHistory.map((evt) => (
              <div key={evt.id} className="py-2.5 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{evt.action}</span>
                    <span className="text-[10px] text-muted-foreground">• {evt.actor}</span>
                  </div>
                  <p className="text-muted-foreground text-[11px] mt-0.5">{evt.description}</p>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {new Date(evt.timestamp).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 7. SHARED FOUNDATION MODALS */}
      {/* Document Source Picker */}
      <DocumentSourcePicker
        title={`Select Document: ${documentTarget || "Corporate Records"}`}
        isOpen={isSourcePickerOpen}
        onClose={() => setIsSourcePickerOpen(false)}
        onSelectCamera={() => {
          setIsSourcePickerOpen(false);
          setIsCameraOpen(true);
        }}
        onSelectFile={(file) => {
          setIsSourcePickerOpen(false);
          handleFileSelected(file);
        }}
      />

      {/* Live Camera Capture Modal */}
      {isCameraOpen && (
        <CameraCapture
          onCapture={(file) => {
            setIsCameraOpen(false);
            handleFileSelected(file);
          }}
          onClose={() => setIsCameraOpen(false)}
        />
      )}

      {/* Secure Document Viewer Preview Modal (Preview Mode — Not Yet Saved) */}
      {previewDocument && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[80vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col bg-card">
            <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                Document Preview — Not Yet Saved
              </span>
              <span className="text-[11px] text-muted-foreground font-medium">
                Target: {previewDocument.target}
              </span>
            </div>
            <div className="flex-1 relative overflow-hidden">
              <SecureDocumentViewer
                fileName={previewDocument.name}
                mimeType={previewDocument.name.endsWith(".pdf") ? "application/pdf" : "image/jpeg"}
                dataUrl={previewDocument.url}
                documentTitle={`Preview: ${previewDocument.target}`}
                onClose={handleClosePreview}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
