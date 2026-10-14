"use client";

import React, { useEffect, useState } from "react";
import { LoadingState } from "@/src/components/shared/StateDisplays";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import { userMessage } from "@/lib/canonical-ui/unavailable";
import { normalizeCRABusinessNumber, validateCRABusinessNumberFormat, validateEINFormat, normalizeEIN } from "@/lib/identifier-normalization";
import type { BusinessAnnualReturnRecord, BusinessShareholderRecord } from "@/src/types/business";

import { ShareholdersSection } from "@/src/components/business/ShareholdersSection";
import { AnnualReturnsSection } from "@/src/components/business/AnnualReturnsSection";
import { BusinessHeader } from "@/src/restored/business/BusinessHeader";
import { IncorporationSection } from "@/src/restored/business/IncorporationSection";
import { CorporateDocumentsSection } from "@/src/restored/business/CorporateDocumentsSection";
import { CraTaxCard } from "@/src/restored/business/CraTaxCard";
import { EinTaxCard } from "@/src/restored/business/EinTaxCard";
import { GstTaxCard } from "@/src/restored/business/GstTaxCard";
import { SalesTaxCard } from "@/src/restored/business/SalesTaxCard";
import { AuditCasesSection } from "@/src/restored/business/AuditCasesSection";
import { BusinessHistory } from "@/src/restored/business/BusinessHistory";
import { BusinessDocumentModals } from "@/src/restored/business/BusinessDocumentModals";
import { unavailable, useCanonicalBusiness, type CanonicalTaxRecord, type ProfileForBusiness } from "@/src/restored/business/adapter";

/**
 * The ORIGINAL Business & Corporate Records interface, restored over the canonical corporate-identity domain. The CRA Business
 * Number and IRS EIN cards read and write organization_identifiers (a real change keeps the earlier number as history; a mistaken
 * number is corrected; "archive" ends a number as history). Everything with no canonical home keeps its control and refuses
 * with a note (see adapter `unavailable`); nothing is kept in the browser and nothing claims to be saved when it was not.
 */
export default function RestoredBusiness({ profile }: { profile: ProfileForBusiness }) {
  const api = useCanonicalBusiness(profile.id, profile);
  const company = api.company;

  // Region / jurisdiction logic (as in the original)
  const isCanadaRegistered = company.regCorpCountry === "Canada";
  const isUSRegistered = company.regCorpCountry === "United States";
  const isCrossBorder = company.region === "Cross-Border";
  const needsCanadianTaxes = isCanadaRegistered || isCrossBorder;
  const needsUSTaxes = isUSRegistered || isCrossBorder;

  // View modes
  const [isEditingIncorp, setIsEditingIncorp] = useState(false);
  const [incorpDateDraft, setIncorpDateDraft] = useState("");
  const [incorpError, setIncorpError] = useState<string | null>(null);
  const [showArchivedShareholders, setShowArchivedShareholders] = useState(false);
  const [showArchivedReturns, setShowArchivedReturns] = useState(false);
  const [showArchivedTaxes, setShowArchivedTaxes] = useState(false);

  const [showAddShareholder, setShowAddShareholder] = useState(false);
  const [editingShareholder, setEditingShareholder] = useState<BusinessShareholderRecord | null>(null);
  const [shareholderError, setShareholderError] = useState<string | null>(null);

  const [showAddReturn, setShowAddReturn] = useState(false);
  const [editingReturn, setEditingReturn] = useState<BusinessAnnualReturnRecord | null>(null);
  const [returnsNotice, setReturnsNotice] = useState<string | null>(null);

  const [showAddCra, setShowAddCra] = useState(false);
  const [craError, setCraError] = useState<string | null>(null);
  const [showAddEin, setShowAddEin] = useState(false);
  const [einError, setEinError] = useState<string | null>(null);
  const [showAddGst, setShowAddGst] = useState(false);
  const [gstError, setGstError] = useState<string | null>(null);
  const [showAddSalesTax, setShowAddSalesTax] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});

  // Ephemeral, in-memory document preview (nothing is uploaded or stored).
  const [documentTarget, setDocumentTarget] = useState<string | null>(null);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<{ name: string; url: string; target: string } | null>(null);

  useEffect(() => {
    return () => {
      if (previewDocument?.url) URL.revokeObjectURL(previewDocument.url);
    };
  }, [previewDocument]);

  const handleClosePreview = () => {
    if (previewDocument?.url) URL.revokeObjectURL(previewDocument.url);
    setPreviewDocument(null);
  };
  const handleOpenSourcePicker = (targetLabel: string) => {
    setDocumentTarget(targetLabel);
    setIsSourcePickerOpen(true);
  };
  const handleFileSelected = (file: File) => {
    if (previewDocument?.url) URL.revokeObjectURL(previewDocument.url);
    setPreviewDocument({ name: file.name, url: URL.createObjectURL(file), target: documentTarget || "Corporate Records" });
  };

  // --- Incorporation ---------------------------------------------------------------------------------------------------
  const handleSaveIncorp = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIncorpError(userMessage(unavailable.incorporationDate()));
  };

  // --- Shareholders / annual returns: no canonical home ---------------------------------------------------------------
  const handleSaveShareholder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setShareholderError(userMessage(unavailable.shareholders()));
  };
  const handleArchiveShareholder = () => setShareholderError(userMessage(unavailable.shareholders()));
  const handleSaveReturn = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setReturnsNotice(userMessage(unavailable.annualReturns()));
  };
  const handleArchiveReturn = () => setReturnsNotice(userMessage(unavailable.annualReturns()));

  // --- CRA Business Number ----------------------------------------------------------------------------------------------
  const handleSaveCraRecord = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCraError(null);
    setActionErrors({});
    const data = new FormData(e.currentTarget);
    const normalizedBN = normalizeCRABusinessNumber(String(data.get("accountNo") || "").trim());
    if (!validateCRABusinessNumberFormat(normalizedBN)) {
      setCraError("Invalid CRA Business Number. Must contain exactly 9 numeric digits.");
      return;
    }
    const relation = String(data.get("relation") || "");
    try {
      await api.registerNumber("CRA_BN", normalizedBN, relation === "change" || relation === "correction" ? relation : undefined);
      setShowAddCra(false);
    } catch (error) {
      setCraError(userMessage(error, "The Business Number could not be saved. Nothing was changed."));
    }
  };

  // --- IRS EIN ---------------------------------------------------------------------------------------------------------
  const handleSaveEinRecord = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEinError(null);
    setActionErrors({});
    const data = new FormData(e.currentTarget);
    const raw = String(data.get("accountNo") || "").trim();
    if (!validateEINFormat(raw)) {
      setEinError("Invalid EIN format. Must contain 9 digits (e.g. 12-3456789).");
      return;
    }
    const relation = String(data.get("relation") || "");
    try {
      await api.registerNumber("IRS_EIN", normalizeEIN(raw), relation === "change" || relation === "correction" ? relation : undefined);
      setShowAddEin(false);
    } catch (error) {
      setEinError(userMessage(error, "The EIN could not be saved. Nothing was changed."));
    }
  };

  // --- GST/HST and state sales tax: no canonical registration program ------------------------------------------------
  const handleSaveGstRecord = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setGstError(userMessage(unavailable.gst()));
  };
  const handleSaveSalesTaxRecord = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSalesError(userMessage(unavailable.salesTax()));
  };

  const handleArchiveTaxRecord = async (record: CanonicalTaxRecord, archive: boolean) => {
    setActionErrors({});
    const fail = (message: string) => setActionErrors({ [record.taxType]: message });
    if (!archive) {
      fail(userMessage(unavailable.restoreNumber()));
      return;
    }
    // Protect the active Company Master number from being archived without a replacement (as in the original).
    if (record.taxType === "CRA_BN" && record.isPrimary === true && record.accountNo === company.businessNo) {
      fail("This CRA Business Number is the active Company Master identifier. Register a replacement Business Number before archiving this record.");
      return;
    }
    try {
      await api.retireNumber(record.id);
    } catch (error) {
      fail(userMessage(error, "The number could not be archived. Nothing was changed."));
    }
  };

  if (api.loading) return <LoadingState message="Loading business & corporate records..." />;

  const visible = (records: CanonicalTaxRecord[]) => records.filter((record) => showArchivedTaxes || !record.isArchived);
  const emptyOwnership: BusinessShareholderRecord[] = [];
  const emptyReturns: BusinessAnnualReturnRecord[] = [];

  return (
    <div className="flex flex-col gap-6 pb-12">
      {api.loadError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {api.loadError} The numbers below may be out of date.
        </div>
      )}

      <BusinessHeader company={company} totalActiveOwnership={0} ownershipRecorded={false} />

      <IncorporationSection
        company={company}
        isCanadaRegistered={isCanadaRegistered}
        isEditingIncorp={isEditingIncorp}
        incorpDateDraft={incorpDateDraft}
        setIncorpDateDraft={setIncorpDateDraft}
        setIsEditingIncorp={(value) => {
          setIncorpError(null);
          setIsEditingIncorp(value);
        }}
        handleSaveIncorp={handleSaveIncorp}
        saveError={incorpError}
      />

      <CorporateDocumentsSection companyId={profile.id} />

      <ShareholdersSection
        totalActiveOwnership={0}
        activeShareholders={emptyOwnership}
        visibleShareholders={emptyOwnership}
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
      <CanonicalUnavailable action="Directors and shareholders" reason="no canonical record holds ownership percentages yet, so none are listed and none can be saved." className="-mt-3 px-2" />

      <AnnualReturnsSection
        visibleReturns={emptyReturns}
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
      {returnsNotice && (
        <p role="alert" className="-mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {returnsNotice}
        </p>
      )}
      <CanonicalUnavailable action="Annual returns" reason="no canonical record holds corporate annual returns yet, so none are listed and none can be saved. Attaching evidence only previews the file." className="-mt-3 px-2" />

      <div className="grid lg:grid-cols-2 gap-6">
        <CraTaxCard
          company={company}
          needsCanadianTaxes={needsCanadianTaxes}
          showArchivedTaxes={showArchivedTaxes}
          showAddCra={showAddCra}
          craError={craError}
          taxActionError={actionErrors.CRA_BN ?? null}
          craRecords={visible(api.craRecords)}
          handleSaveCraRecord={handleSaveCraRecord}
          handleArchiveTaxRecord={handleArchiveTaxRecord}
          setShowArchivedTaxes={setShowArchivedTaxes}
          setShowAddCra={setShowAddCra}
          setCraError={setCraError}
        />

        <EinTaxCard
          needsUSTaxes={needsUSTaxes}
          showAddEin={showAddEin}
          einError={einError}
          actionError={actionErrors.IRS_EIN ?? null}
          einRecords={visible(api.einRecords)}
          handleSaveEinRecord={handleSaveEinRecord}
          handleArchiveTaxRecord={handleArchiveTaxRecord}
          setShowAddEin={setShowAddEin}
          setEinError={setEinError}
        />

        <GstTaxCard
          company={company}
          needsCanadianTaxes={needsCanadianTaxes}
          showAddGst={showAddGst}
          gstError={gstError}
          actionError={actionErrors.GST_HST ?? null}
          gstRecords={[]}
          handleSaveGstRecord={handleSaveGstRecord}
          handleArchiveTaxRecord={handleArchiveTaxRecord}
          setShowAddGst={setShowAddGst}
          setGstError={setGstError}
        />

        <SalesTaxCard
          needsUSTaxes={needsUSTaxes}
          showAddSalesTax={showAddSalesTax}
          salesError={salesError}
          actionError={actionErrors.STATE_SALES_TAX ?? null}
          salesTaxRecords={[]}
          handleSaveSalesTaxRecord={handleSaveSalesTaxRecord}
          handleArchiveTaxRecord={handleArchiveTaxRecord}
          setShowAddSalesTax={setShowAddSalesTax}
        />
      </div>
      {(needsCanadianTaxes || needsUSTaxes) && (
        <div className="-mt-3 flex flex-col gap-1 px-2">
          {needsCanadianTaxes && <CanonicalUnavailable action="GST/HST program accounts" reason="tax registration programs have no GST/HST program (a program account is not a Business Number root), so none are listed or saved." />}
          {needsUSTaxes && <CanonicalUnavailable action="State sales-tax registrations" reason="no canonical registration program covers state sales tax, so none are listed or saved." />}
        </div>
      )}

      <AuditCasesSection />

      <BusinessHistory />

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

      <section role="note" className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">Recorded in the TES database</p>
        <p>Legal identity, the incorporation number and jurisdiction, and the CRA Business Number and IRS EIN (with their history) are canonical. The items flagged above have no canonical home yet.</p>
      </section>
    </div>
  );
}
