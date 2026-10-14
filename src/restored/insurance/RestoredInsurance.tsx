"use client";

import React, { useMemo, useRef, useState } from "react";
import { AlertCircle, Info, Plus, UploadCloud, X } from "lucide-react";

import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import { LoadingState } from "@/src/components/shared/StateDisplays";
import { InsuranceSummary } from "@/src/components/insurance/InsuranceSummary";
import { InsuranceNavigation } from "@/src/components/insurance/InsuranceNavigation";
import { InsuranceArchiveDialog, type InsuranceArchiveTarget } from "@/src/components/insurance/InsuranceArchiveDialog";
import { InsuranceDocumentIntake } from "@/src/components/insurance/InsuranceDocumentIntake";
import { userMessage } from "@/lib/canonical-ui/unavailable";

import { TransportationPoliciesSection } from "./TransportationPoliciesSection";
import { WorkersCompSection } from "./WorkersCompSection";
import { SuretyBondsSection } from "./SuretyBondsSection";
import { TransportationPolicyForm } from "./TransportationPolicyForm";
import { WorkersCompForm } from "./WorkersCompForm";
import { SuretyBondForm } from "./SuretyBondForm";
import { BrokerUpdateDialog } from "./BrokerUpdateDialog";
import { OrganizationResolutionDialog } from "./OrganizationResolutionDialog";
import {
  archiveRecord,
  classifyOrganizationMatch,
  createOrganization,
  restoreRecord,
  saveBond,
  saveBrokerUpdate,
  saveTransportation,
  saveWorkers,
  useCanonicalInsurance,
  type FormMode,
  type OrgKind,
  type OrganizationResolver,
  type ResolvedOrganization,
  type SaveResult,
} from "./adapter";
import type { BondEntry, DirectoryOrganization, TransportationRecord, WorkersRecord } from "./model";
import { filterBondRecords, filterTransportationRecords, filterWorkersRecords, getInsuranceSummaryMetrics } from "./selectors";

type ResolutionPrompt = {
  inputName: string;
  kind: OrgKind;
  mode: "FUZZY_CANDIDATES" | "NEW_CONFIRMATION";
  candidates: DirectoryOrganization[];
  onResolve: (resolved: ResolvedOrganization | null) => void;
};

const field = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

export const INTAKE_UNAVAILABLE =
  "Document / OCR intake is unavailable: legacy OCR is retired (its endpoints answer 503) and a policy has no canonical link to an uploaded document. The file you chose was not read or uploaded, and no policy or evidence was created.";

export function RestoredInsurance({ companyId, company }: { companyId: string; company: { id: string; name: string; kind: string; status: string } }) {
  const { model, directory, loading, loadError, directoryError, reload } = useCanonicalInsurance(companyId, company.name);

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [activeTab, setActiveTab] = useState<"transportation" | "workers" | "bonds" | "all">("transportation");
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [isTransportationModalOpen, setIsTransportationModalOpen] = useState(false);
  const [editingTransportation, setEditingTransportation] = useState<TransportationRecord | null>(null);
  const [isRenewalMode, setIsRenewalMode] = useState(false);
  const [isWorkersModalOpen, setIsWorkersModalOpen] = useState(false);
  const [editingWorkers, setEditingWorkers] = useState<WorkersRecord | null>(null);
  const [isWorkersRenewal, setIsWorkersRenewal] = useState(false);
  const [isBondModalOpen, setIsBondModalOpen] = useState(false);
  const [editingBond, setEditingBond] = useState<BondEntry | null>(null);
  const [isBondRenewal, setIsBondRenewal] = useState(false);
  const [isBrokerModalOpen, setIsBrokerModalOpen] = useState(false);
  const [brokerTargetRecord, setBrokerTargetRecord] = useState<TransportationRecord | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<InsuranceArchiveTarget | null>(null);
  const [archiveReasonText, setArchiveReasonText] = useState("");

  const [orgResolutionPrompt, setOrgResolutionPrompt] = useState<ResolutionPrompt | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);

  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [intakeNote, setIntakeNote] = useState(false);

  const today = model.asOfDate || new Date().toISOString().slice(0, 10);
  const directoryRef = useRef<DirectoryOrganization[]>([]);
  directoryRef.current = directory;

  const summaryMetrics = useMemo(() => getInsuranceSummaryMetrics(model), [model]);
  const filteredTransportation = useMemo(() => filterTransportationRecords(model.transportation, showArchived, searchQuery), [model.transportation, showArchived, searchQuery]);
  const filteredWorkers = useMemo(() => filterWorkersRecords(model.workers, showArchived, searchQuery), [model.workers, showArchived, searchQuery]);
  const filteredBonds = useMemo(() => filterBondRecords(model.bonds, showArchived, searchQuery), [model.bonds, showArchived, searchQuery]);
  const otherLiabilityCurrencies = Object.entries(model.liabilityByCurrency).filter(([currency]) => currency !== "CAD");

  // --- organization resolution: exact match reuses, similar names ask, no match needs explicit confirmation ---------------------
  const resolveOrganization: OrganizationResolver = (inputName, kind) => {
    const cleanInput = inputName.trim();
    if (!cleanInput) return Promise.resolve(null);
    const candidates = directoryRef.current.filter((entry) => entry.id !== companyId && (entry.status ?? "Active") === "Active");
    const match = classifyOrganizationMatch(cleanInput, candidates);
    if (match.mode === "EXACT") return Promise.resolve({ id: match.match.id, name: match.match.name });
    return new Promise((resolve) => {
      setOrgResolutionPrompt({
        inputName: cleanInput,
        kind,
        mode: match.mode,
        candidates: match.mode === "FUZZY_CANDIDATES" ? match.candidates : [],
        onResolve: (resolved) => {
          setOrgResolutionPrompt(null);
          resolve(resolved);
        },
      });
    });
  };

  async function handleCreateOrganization() {
    if (!orgResolutionPrompt) return;
    const prompt = orgResolutionPrompt;
    setOrgBusy(true);
    try {
      const created = await createOrganization(prompt.inputName, prompt.kind);
      prompt.onResolve(created);
    } catch (error) {
      setErrorBanner(userMessage(error, "The organization could not be created. Nothing was saved."));
      prompt.onResolve(null);
    } finally {
      setOrgBusy(false);
    }
  }

  async function run(work: () => Promise<SaveResult | void>, onSaved?: () => void) {
    setBusy(true);
    setErrorBanner(null);
    setNotices([]);
    try {
      const result = await work();
      if (result && !result.saved) return;
      if (result?.notices.length) setNotices(result.notices);
      onSaved?.();
    } catch (error) {
      setErrorBanner(userMessage(error));
    } finally {
      try {
        await reload();
      } finally {
        setBusy(false);
      }
    }
  }

  function brokerFields(data: FormData) {
    return { org: field(data, "brokerOrg"), agent: field(data, "brokerAgent"), phone: field(data, "brokerPhone"), email: field(data, "brokerEmail") };
  }

  const closeTransportation = () => {
    setIsTransportationModalOpen(false);
    setEditingTransportation(null);
    setIsRenewalMode(false);
  };

  const handleSaveTransportation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const mode: FormMode = isRenewalMode ? "renew" : editingTransportation ? "edit" : "create";
    await run(
      () =>
        saveTransportation(
          companyId,
          mode,
          editingTransportation,
          {
            insuranceType: field(data, "insuranceType") || "Auto Liability",
            policyNumber: field(data, "policyNumber"),
            insurerName: field(data, "insurerName"),
            coverageAmount: field(data, "coverageAmount"),
            effectiveDate: field(data, "effectiveDate"),
            expiryDate: field(data, "expiryDate"),
            broker: brokerFields(data),
            notes: field(data, "notes"),
            editMode: field(data, "editMode") === "ENDORSEMENT" ? "ENDORSEMENT" : "CORRECTION",
            endorsementDate: field(data, "endorsementDate"),
          },
          resolveOrganization,
        ),
      closeTransportation,
    );
  };

  const handleSaveBrokerUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!brokerTargetRecord) return;
    const data = new FormData(e.currentTarget);
    await run(
      () => saveBrokerUpdate(companyId, brokerTargetRecord, brokerFields(data), data.get("isCorrection") === "on", resolveOrganization),
      () => {
        setIsBrokerModalOpen(false);
        setBrokerTargetRecord(null);
      },
    );
  };

  const closeWorkers = () => {
    setIsWorkersModalOpen(false);
    setEditingWorkers(null);
    setIsWorkersRenewal(false);
  };

  const handleSaveWorkers = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const mode: FormMode = isWorkersRenewal ? "renew" : editingWorkers ? "edit" : "create";
    await run(
      () =>
        saveWorkers(
          companyId,
          mode,
          editingWorkers,
          {
            jurisdiction: field(data, "jurisdiction"),
            providerName: field(data, "providerName"),
            accountNumber: field(data, "accountNumber"),
            effectiveDate: field(data, "effectiveDate"),
            expiryDate: field(data, "expiryDate"),
            notes: field(data, "notes"),
          },
          resolveOrganization,
        ),
      closeWorkers,
    );
  };

  const closeBond = () => {
    setIsBondModalOpen(false);
    setEditingBond(null);
    setIsBondRenewal(false);
  };

  const handleSaveBond = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const mode: FormMode = isBondRenewal ? "renew" : editingBond ? "edit" : "create";
    await run(
      () =>
        saveBond(
          companyId,
          mode,
          editingBond,
          {
            bondType: field(data, "bondType") || "BMC-84 (Freight Broker)",
            suretyName: field(data, "suretyName"),
            bondNumber: field(data, "bondNumber"),
            bondAmount: field(data, "bondAmount"),
            effectiveDate: field(data, "effectiveDate"),
            expiryDate: field(data, "expiryDate"),
          },
          resolveOrganization,
        ),
      closeBond,
    );
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget || !archiveReasonText.trim()) {
      setErrorBanner("An archive reason is required.");
      return;
    }
    const target = archiveTarget;
    const reason = archiveReasonText.trim();
    await run(
      async () => {
        await archiveRecord(companyId, target.recordId, reason);
      },
      () => {
        setArchiveTarget(null);
        setArchiveReasonText("");
        setNotices([`Archived ${target.label}. The reason was recorded in the audit trail (Master Register); it is not shown on the record.`]);
      },
    );
  };

  const handleRestoreRecord = (recordId: string) =>
    run(async () => {
      await restoreRecord(companyId, recordId);
    });

  const noteIntake = () => {
    setIsSourcePickerOpen(false);
    setIsCameraOpen(false);
    setIntakeNote(true);
  };

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
      <CompanyWorkspaceHeader
        company={company}
        section="Insurance"
        description="Fleet liability, cargo coverage, Workers Compensation (WCB), and surety bonds."
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setIntakeNote(false);
                setIsSourcePickerOpen(true);
              }}
              className="flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <UploadCloud className="size-4" />
              <span>Document / OCR</span>
            </button>

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
                  setIsWorkersRenewal(false);
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
                  setIsBondRenewal(false);
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

      {/* ERROR / NOTICE BANNERS */}
      {loadError ? (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-medium text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{loadError} The records below may be out of date.</span>
        </div>
      ) : null}
      {directoryError ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-medium text-amber-800 dark:text-amber-300">
          <Info className="size-4 shrink-0" />
          <span>{directoryError} Insurer and broker names may show as ids and organization matching is unavailable.</span>
        </div>
      ) : null}
      {errorBanner && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-medium text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button type="button" onClick={() => setErrorBanner(null)} className="hover:opacity-80 p-1">
            <X className="size-4" />
          </button>
        </div>
      )}
      {notices.length > 0 && (
        <div className="flex items-start justify-between rounded-xl border border-primary/20 bg-primary/10 p-3 text-xs font-medium text-foreground">
          <ul className="space-y-1">
            {notices.map((notice) => (
              <li key={notice} className="flex items-start gap-2">
                <Info className="size-4 shrink-0 text-primary" />
                <span>{notice}</span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setNotices([])} className="hover:opacity-80 p-1">
            <X className="size-4" />
          </button>
        </div>
      )}
      {intakeNote && <CanonicalUnavailable action="Document / OCR intake" reason={INTAKE_UNAVAILABLE.replace(/^Document \/ OCR intake is unavailable: /, "")} />}

      {/* 2. COMPLIANCE SUMMARY METRIC CARDS (computed from the canonical records and dates) */}
      <div className="space-y-1">
        <InsuranceSummary summaryMetrics={summaryMetrics} />
        {otherLiabilityCurrencies.length > 0 ? (
          <p className="text-[10px] text-muted-foreground">
            Total Liability counts Canadian-dollar limits in force today. Also in force: {otherLiabilityCurrencies.map(([currency, total]) => `${currency} ${total.toLocaleString()}`).join(", ")}.
          </p>
        ) : null}
      </div>

      {/* 3. SECTION TABS & SEARCH / FILTER CONTROLS */}
      <InsuranceNavigation
        activeTab={activeTab}
        transportationCount={model.transportation.filter((t) => t.status !== "Archived").length}
        workersCount={model.workers.filter((w) => w.status !== "Archived").length}
        bondCount={model.bonds.filter((b) => b.status !== "Archived").length}
        searchQuery={searchQuery}
        showArchived={showArchived}
        onTabChange={setActiveTab}
        onSearchChange={setSearchQuery}
        onShowArchivedChange={setShowArchived}
      />

      {(activeTab === "transportation" || activeTab === "all") && (
        <TransportationPoliciesSection
          records={filteredTransportation}
          today={today}
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
          onArchive={(record) => setArchiveTarget({ family: "transportation", recordId: record.policyId, label: `Policy #${record.policyNumber} (${record.insuranceType})` })}
          onRestore={(record) => void handleRestoreRecord(record.policyId)}
        />
      )}

      {(activeTab === "workers" || activeTab === "all") && (
        <WorkersCompSection
          records={filteredWorkers}
          today={today}
          onAdd={() => {
            setEditingWorkers(null);
            setIsWorkersRenewal(false);
            setIsWorkersModalOpen(true);
          }}
          onEdit={(record) => {
            setEditingWorkers(record);
            setIsWorkersRenewal(false);
            setIsWorkersModalOpen(true);
          }}
          onRenew={(record) => {
            setEditingWorkers(record);
            setIsWorkersRenewal(true);
            setIsWorkersModalOpen(true);
          }}
          onArchive={(record) => setArchiveTarget({ family: "workers", recordId: record.policyId, label: `WCB Acct #${record.accountNumber}` })}
          onRestore={(record) => void handleRestoreRecord(record.policyId)}
        />
      )}

      {(activeTab === "bonds" || activeTab === "all") && (
        <SuretyBondsSection
          records={filteredBonds}
          today={today}
          onAdd={() => {
            setEditingBond(null);
            setIsBondRenewal(false);
            setIsBondModalOpen(true);
          }}
          onEdit={(record) => {
            setEditingBond(record);
            setIsBondRenewal(false);
            setIsBondModalOpen(true);
          }}
          onRenew={(record) => {
            setEditingBond(record);
            setIsBondRenewal(true);
            setIsBondModalOpen(true);
          }}
          onArchive={(record) => setArchiveTarget({ family: "bonds", recordId: record.policyId, label: `Surety Bond #${record.bondNumber} (${record.bondType})` })}
          onRestore={(record) => void handleRestoreRecord(record.policyId)}
        />
      )}

      {/* MODALS & FORMS */}
      <TransportationPolicyForm
        key={`${editingTransportation?.policyId ?? "new"}-${isRenewalMode ? "renew" : "edit"}-${isTransportationModalOpen}`}
        open={isTransportationModalOpen}
        editingRecord={editingTransportation}
        isRenewalMode={isRenewalMode}
        busy={busy}
        today={today}
        onSubmit={handleSaveTransportation}
        onClose={closeTransportation}
      />

      <WorkersCompForm
        key={`${editingWorkers?.policyId ?? "new"}-${isWorkersModalOpen}`}
        open={isWorkersModalOpen}
        editingRecord={editingWorkers}
        isRenewalMode={isWorkersRenewal}
        busy={busy}
        today={today}
        onSubmit={handleSaveWorkers}
        onClose={closeWorkers}
      />

      <SuretyBondForm
        key={`${editingBond?.policyId ?? "new"}-${isBondModalOpen}`}
        open={isBondModalOpen}
        editingRecord={editingBond}
        isRenewalMode={isBondRenewal}
        busy={busy}
        today={today}
        onSubmit={handleSaveBond}
        onClose={closeBond}
      />

      <BrokerUpdateDialog
        open={isBrokerModalOpen}
        record={brokerTargetRecord}
        busy={busy}
        onSubmit={handleSaveBrokerUpdate}
        onClose={() => {
          setIsBrokerModalOpen(false);
          setBrokerTargetRecord(null);
        }}
      />

      <InsuranceArchiveDialog
        target={archiveTarget}
        reason={archiveReasonText}
        onReasonChange={setArchiveReasonText}
        onCancel={() => {
          setArchiveTarget(null);
          setArchiveReasonText("");
        }}
        onConfirm={() => void handleConfirmArchive()}
      />

      <OrganizationResolutionDialog
        prompt={orgResolutionPrompt}
        busy={orgBusy}
        onUseExisting={(candidate) => orgResolutionPrompt?.onResolve({ id: candidate.id, name: candidate.name })}
        onCreateNew={() => void handleCreateOrganization()}
        onCancel={() => orgResolutionPrompt?.onResolve(null)}
      />

      {/* Document source + camera intake: the picker stays; nothing chosen here is read or uploaded (legacy OCR is retired). */}
      <InsuranceDocumentIntake
        sourcePickerOpen={isSourcePickerOpen}
        cameraOpen={isCameraOpen}
        targetDescription="Certificate of Insurance"
        onCloseSourcePicker={() => setIsSourcePickerOpen(false)}
        onOpenCamera={() => setIsCameraOpen(true)}
        onSelectFile={() => noteIntake()}
        onCapture={() => noteIntake()}
        onCloseCamera={() => setIsCameraOpen(false)}
      />
    </div>
  );
}
