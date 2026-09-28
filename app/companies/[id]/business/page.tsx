"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LoadingState, EmptyState } from "@/src/components/shared/StateDisplays";

// --- Shared Utilities & Normalization ---
import {
  normalizeCRABusinessNumber,
  validateCRABusinessNumberFormat,
  parseCRAProgramAccount,
  normalizeEIN,
  validateEINFormat,
  normalizeTaxId,
} from "@/lib/identifier-normalization";
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

import { BusinessHeader } from "@/src/components/business/BusinessHeader";
import { IncorporationSection } from "@/src/components/business/IncorporationSection";
import { CorporateDocumentsSection } from "@/src/components/business/CorporateDocumentsSection";
import { ShareholdersSection } from "@/src/components/business/ShareholdersSection";
import { AnnualReturnsSection } from "@/src/components/business/AnnualReturnsSection";
import { CraTaxCard } from "@/src/components/business/CraTaxCard";
import { EinTaxCard } from "@/src/components/business/EinTaxCard";
import { GstTaxCard } from "@/src/components/business/GstTaxCard";
import { SalesTaxCard } from "@/src/components/business/SalesTaxCard";
import { BusinessHistory } from "@/src/components/business/BusinessHistory";
import { AuditCasesSection } from "@/src/components/business/AuditCasesSection";
import { BusinessDocumentModals } from "@/src/components/business/BusinessDocumentModals";

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
    <div className="flex flex-col gap-6 pb-12">
      {/* 1. HEADER & COMPLIANCE CONTEXT */}
      <BusinessHeader
        company={company}
        totalActiveOwnership={totalActiveOwnership}
      />

      {/* 2. INCORPORATION SUMMARY (Master Synchronized) */}
      <IncorporationSection
        company={company}
        isCanadaRegistered={isCanadaRegistered}
        isEditingIncorp={isEditingIncorp}
        incorpDateDraft={incorpDateDraft}
        setIncorpDateDraft={setIncorpDateDraft}
        setIsEditingIncorp={setIsEditingIncorp}
        handleSaveIncorp={handleSaveIncorp}
      />
      <CorporateDocumentsSection
        companyId={companyId}
        companyName={String(company.name || company.legalName || "")}
        corporateNumber={String(company.incorpNo || "")}
        onBusinessEvent={recordBusinessEvent}
      />

      {/* 3. DIRECTORS & SHAREHOLDERS (Validated Ownership ≤ 100%) */}
      <ShareholdersSection
        totalActiveOwnership={totalActiveOwnership}
        activeShareholders={activeShareholders}
        visibleShareholders={visibleShareholders}
        showArchivedShareholders={showArchivedShareholders}
        showAddShareholder={showAddShareholder}
        editingShareholder={editingShareholder}
        shareholderError={shareholderError}
        handleSaveShareholder={handleSaveShareholder}
        handleArchiveShareholder={handleArchiveShareholder}
        setShowArchivedShareholders={setShowArchivedShareholders}
        setShowAddShareholder={setShowAddShareholder}
        setEditingShareholder={setEditingShareholder}
        setShareholderError={setShareholderError}
      />

      {/* 4. ANNUAL RETURNS LEDGER */}
      <AnnualReturnsSection
        visibleReturns={visibleReturns}
        showArchivedReturns={showArchivedReturns}
        showAddReturn={showAddReturn}
        editingReturn={editingReturn}
        handleSaveReturn={handleSaveReturn}
        handleArchiveReturn={handleArchiveReturn}
        handleOpenSourcePicker={handleOpenSourcePicker}
        setShowArchivedReturns={setShowArchivedReturns}
        setShowAddReturn={setShowAddReturn}
        setEditingReturn={setEditingReturn}
      />

      {/* 5. DYNAMIC REGIONAL TAX LEDGERS */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* CRA BUSINESS NUMBER (Canadian / Cross-Border) */}
        <CraTaxCard
          company={company}
          needsCanadianTaxes={needsCanadianTaxes}
          showArchivedTaxes={showArchivedTaxes}
          showAddCra={showAddCra}
          craError={craError}
          taxActionError={taxActionError}
          craRecords={craRecords}
          handleSaveCraRecord={handleSaveCraRecord}
          handleArchiveTaxRecord={handleArchiveTaxRecord}
          setShowArchivedTaxes={setShowArchivedTaxes}
          setShowAddCra={setShowAddCra}
          setCraError={setCraError}
        />

        {/* IRS EIN (US / Cross-Border) */}
        <EinTaxCard
          needsUSTaxes={needsUSTaxes}
          showAddEin={showAddEin}
          einError={einError}
          einRecords={einRecords}
          handleSaveEinRecord={handleSaveEinRecord}
          handleArchiveTaxRecord={handleArchiveTaxRecord}
          setShowAddEin={setShowAddEin}
          setEinError={setEinError}
        />

        {/* GST / HST PROGRAM ACCOUNTS (Canadian / Cross-Border) */}
        <GstTaxCard
          company={company}
          needsCanadianTaxes={needsCanadianTaxes}
          showAddGst={showAddGst}
          gstError={gstError}
          gstRecords={gstRecords}
          handleSaveGstRecord={handleSaveGstRecord}
          handleArchiveTaxRecord={handleArchiveTaxRecord}
          setShowAddGst={setShowAddGst}
          setGstError={setGstError}
        />

        {/* US STATE SALES TAX (US / Cross-Border) */}
        <SalesTaxCard
          needsUSTaxes={needsUSTaxes}
          showAddSalesTax={showAddSalesTax}
          salesTaxRecords={salesTaxRecords}
          handleSaveSalesTaxRecord={handleSaveSalesTaxRecord}
          handleArchiveTaxRecord={handleArchiveTaxRecord}
          setShowAddSalesTax={setShowAddSalesTax}
        />
      </div>

      <AuditCasesSection
        companyId={companyId}
        companyName={String(company.name || company.legalName || "")}
        onBusinessEvent={recordBusinessEvent}
      />

      {/* 6. BUSINESS MODULE CHANGE HISTORY */}
      <BusinessHistory
        businessStore={businessStore}
      />

      {/* 7. SHARED FOUNDATION MODALS */}
      {/* Document Source Picker */}
      <BusinessDocumentModals
        previewDocument={previewDocument}
        documentTarget={documentTarget}
        isSourcePickerOpen={isSourcePickerOpen}
        isCameraOpen={isCameraOpen}
        handleFileSelected={handleFileSelected}
        handleClosePreview={handleClosePreview}
        setIsSourcePickerOpen={setIsSourcePickerOpen}
        setIsCameraOpen={setIsCameraOpen}
      />
    </div>
  );
}
