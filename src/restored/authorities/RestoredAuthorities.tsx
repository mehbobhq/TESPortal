"use client"

/**
 * The original Authorities workspace (grouped authority cards, safety and audit sections, 3-year retention toggle, record
 * inspector, create/edit modals, archive dialog, scan / camera / OCR review) restored over the canonical PostgreSQL
 * operating-authorities domain. Adapted from the pre-cutover page; every browser-storage, audit-logger and cross-store
 * statement was replaced by the canonical adapter, and every control without a canonical operation stays visible and refuses
 * honestly (see adapter.ts).
 */

import React, { useMemo, useState } from "react"
import { Archive, FileCheck2, History, Plus, RefreshCcw } from "lucide-react"

import { CompanyMissing } from "@/components/company-missing"
import { CanonicalOperationUnavailableError, userMessage } from "@/lib/canonical-ui/unavailable"
import { CameraCapture } from "@/src/components/CameraCapture"
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker"
import { LoadingState } from "@/src/components/shared/StateDisplays"

import { useCanonicalAuthorities, type EditMode } from "./adapter"
import { ManualModal } from "./forms"
import type { ManualState } from "./forms"
import {
  DEFAULT_DEADLINE_RULES,
  EMPTY_DATA,
  auditReferenceDate,
  authorityOptions,
  authorityReferenceDate,
  deriveAuthorityProfile,
  emptyAuditDraft,
  emptyAuthorityDraft,
  emptySafetyDraft,
  getDeadlineStatus,
  isDateInsideThreeYears,
  safetyReferenceDate,
  todayISO,
} from "./model"
import { OCRWorkspace } from "./ocr-workspace"
import { RecordInspector } from "./record-inspector"
import { AuditRow, AuthoritySection, SafetySection } from "./sections"
import { ScanDocumentIcon } from "./shared-fields"
import type { AuthorityCategory, AuthorityRecord, AuthorityType, DeadlineStatus, DocumentSource, OCRSession, SafetySystem, SelectedRecord } from "./types"

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

const SAFETY_UNAVAILABLE = new CanonicalOperationUnavailableError(
  "Saving a safety snapshot",
  "safety profile snapshots have no canonical PostgreSQL storage yet, so nothing was saved (and nothing is kept in this browser).",
)
const AUDIT_UNAVAILABLE = new CanonicalOperationUnavailableError(
  "Saving an audit or intervention record",
  "regulatory audit and intervention records have no canonical PostgreSQL storage yet, so nothing was saved (and nothing is kept in this browser).",
)

export default function RestoredAuthorities({ companyId }: { companyId: string }) {
  const canonical = useCanonicalAuthorities(companyId)
  const { company, records, state } = canonical

  // Safety snapshots, audit records and evidence documents have no canonical store: these lists are honestly empty.
  const data = EMPTY_DATA
  const rules = DEFAULT_DEADLINE_RULES

  const [showOlderHistory, setShowOlderHistory] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [manualState, setManualState] = useState<ManualState | null>(null)
  const [editingState, setEditingState] = useState<ManualState | null>(null)
  const [editMode, setEditMode] = useState<EditMode>("change")
  const [archiveConfirm, setArchiveConfirm] = useState<AuthorityRecord | null>(null)
  const [archiveReasonInput, setArchiveReasonInput] = useState("")
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [sourceContext, setSourceContext] = useState<{
    mode: "authority" | "safety" | "audit"
    category?: AuthorityCategory
    authorityType?: AuthorityType
    safetySystem?: SafetySystem
  } | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [ocrSession, setOcrSession] = useState<OCRSession | null>(null)

  const profile = useMemo(() => {
    if (!company) return null
    const derived = deriveAuthorityProfile(company)
    // Existing canonical records are never hidden by the applicability heuristic.
    return {
      ...derived,
      showCanadian: derived.showCanadian || records.some((record) => record.category === "canadian"),
      showUS: derived.showUS || records.some((record) => record.category === "us_federal"),
    }
  }, [company, records])

  const selected: SelectedRecord | null = useMemo(() => {
    const record = selectedId ? records.find((item) => item.id === selectedId) : undefined
    return record ? { kind: "authority", record } : null
  }, [records, selectedId])

  /* 3-year record filtering */
  const filteredAuthorities = records.filter((record) => showOlderHistory || isDateInsideThreeYears(authorityReferenceDate(record)))
  const filteredSafety = data.safety.filter((record) => showOlderHistory || isDateInsideThreeYears(safetyReferenceDate(record)))
  const filteredAudits = data.audits.filter((record) => showOlderHistory || isDateInsideThreeYears(auditReferenceDate(record)))
  const olderRecordCount = records.filter((record) => !isDateInsideThreeYears(authorityReferenceDate(record))).length
  const categoryAuthorities = (category: AuthorityCategory) => filteredAuthorities.filter((record) => record.category === category)

  /* ------------------------------------------------------------------ actions */

  const attempt = async (work: () => Promise<unknown>): Promise<boolean> => {
    setSaving(true)
    setModalError(null)
    try {
      await work()
      return true
    } catch (error) {
      setModalError(userMessage(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  const openManual = (next: ManualState) => {
    setModalError(null)
    setManualState(next)
  }

  const saveManual = async () => {
    if (!manualState) return
    if (manualState.mode === "safety") return setModalError(SAFETY_UNAVAILABLE.message)
    if (manualState.mode === "audit") return setModalError(AUDIT_UNAVAILABLE.message)
    const draft = manualState.draft
    let created: AuthorityRecord | null = null
    const ok = await attempt(async () => {
      created = await canonical.saveAuthority(draft)
    })
    if (ok) {
      setManualState(null)
      if (created) setSelectedId((created as AuthorityRecord).id)
    }
  }

  const saveEdit = async () => {
    if (!editingState || !selected || editingState.mode !== "authority") return
    const draft = editingState.draft
    const record = selected.record as AuthorityRecord
    const ok = await attempt(() => canonical.saveAuthority(draft, { record, mode: editMode }))
    if (ok) setEditingState(null)
  }

  const confirmArchive = async () => {
    if (!archiveConfirm) return
    const ok = await attempt(() => canonical.archive(archiveConfirm, archiveReasonInput))
    if (ok) {
      setArchiveConfirm(null)
      setArchiveReasonInput("")
      setSelectedId(null)
    }
  }

  const handleRestore = async () => {
    if (!selected) return
    setNotice(null)
    try {
      await canonical.restore(selected.record as AuthorityRecord)
    } catch (error) {
      setNotice(userMessage(error, "The record could not be restored."))
    }
  }

  const openEdit = () => {
    if (!selected) return
    const record = selected.record as AuthorityRecord
    setModalError(null)
    setEditMode("change")
    setEditingState({
      mode: "authority",
      draft: {
        category: record.category,
        authorityType: record.authorityType,
        canonicalKind: record.canonicalKind ?? "",
        name: record.name,
        number: record.number,
        issuingAuthority: record.issuingAuthority,
        jurisdictionCode: record.jurisdictionCode,
        jurisdictionLabel: record.jurisdictionLabel,
        country: record.country,
        status: record.status,
        issueDate: record.issueDate || "",
        effectiveDate: record.effectiveDate || "",
        expiryDate: record.expiryDate || "",
        eventDate: record.eventDate || "",
        nextActionDate: record.nextActionDate || "",
        notes: record.notes || "",
      },
    })
  }

  /* OCR / scan intake: the file is shown for review and the fields are entered by hand; the document is never stored. */
  const startOCRFile = async (file: File, source: DocumentSource) => {
    if (!sourceContext || !company || !profile) return
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setNotice("Please select a PDF or image.")
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    setModalError(null)
    const base = { source, file, dataUrl, processing: false, extractionComplete: false, documentDate: todayISO() }
    if (sourceContext.mode === "authority") {
      const category = sourceContext.category!
      const options = authorityOptions(category, profile)
      const type = sourceContext.authorityType || options[0]?.value || "OTHER"
      setOcrSession({ ...base, mode: "authority", authorityDraft: emptyAuthorityDraft(company, category, type) })
    } else if (sourceContext.mode === "safety") {
      setOcrSession({ ...base, mode: "safety", safetyDraft: emptySafetyDraft(company, sourceContext.safetySystem!) })
    } else {
      setOcrSession({ ...base, mode: "audit", auditDraft: emptyAuditDraft(company) })
    }
    setSourceContext(null)
  }

  const saveOCR = async () => {
    if (!ocrSession) return
    if (ocrSession.mode === "safety") return setModalError(SAFETY_UNAVAILABLE.message)
    if (ocrSession.mode === "audit") return setModalError(AUDIT_UNAVAILABLE.message)
    if (!ocrSession.authorityDraft) return
    const draft = ocrSession.authorityDraft
    let created: AuthorityRecord | null = null
    const ok = await attempt(async () => {
      created = await canonical.saveAuthority(draft)
    })
    if (ok) {
      setOcrSession(null)
      if (created) setSelectedId((created as AuthorityRecord).id)
    }
  }

  /* ------------------------------------------------------------------ states */

  if (state === "loading") return <LoadingState message="Loading authorities and regulatory registrations..." />
  if (state === "missing") return <CompanyMissing failed={false} />
  if (state === "error") return <CompanyMissing failed />
  if (state === "denied") return <div role="alert" className="p-10 text-center">You are not permitted to view this company's authorities.</div>
  if (!company || !profile) return <CompanyMissing failed />

  /* ------------------------------------------------------------------ summary metrics */

  const deadlineStatuses = filteredAuthorities.filter((record) => !record.isArchived).map((record) => getDeadlineStatus(record.expiryDate, rules))
  const countStatus = (status: DeadlineStatus) => deadlineStatuses.filter((item) => item === status).length

  // IRP has no applicability gate (canonical, valid for Canadian and US carriers); UCR / PHMSA keep the original gates.
  const registrations = categoryAuthorities("operating_registration").filter((record) => {
    if (record.authorityType === "PHMSA") return profile.showPHMSA
    if (record.authorityType === "UCR") return profile.showUCR
    return true
  })

  const closeArchive = () => {
    setArchiveConfirm(null)
    setArchiveReasonInput("")
    setModalError(null)
  }

  return (
    <>
      <div className="flex max-w-[1600px] flex-col gap-6 pb-12">
        {/* HEADER */}
        <div>
          <CompanyWorkspaceHeader company={{ id: company.id, name: company.name, kind: company.kind || "", status: company.status || "" }} section="Authorities" />

          <div className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Registered Origin</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {company.regCorpState || "Unknown"}, {company.regCorpCountry || "Unknown"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Operating Region</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{company.region || "Not specified"}</p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cargo / Hazmat Trigger</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{profile.hazmat ? "Hazmat Operation" : "No Hazmat Trigger"}</p>
              </div>

              <div className="hidden h-8 w-px bg-border lg:block" />

              <button type="button" onClick={() => setNotice("Refresh Deadline Settings is not available yet: deadline thresholds have no canonical per-company store, so the TES default thresholds apply.")} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                <RefreshCcw className="size-3" />
                Refresh Deadline Settings
              </button>
            </div>
          </div>
        </div>

        {notice ? (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {notice}
          </p>
        ) : null}

        {/* AUTHORITY SUMMARY */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
          {[
            { label: "Authority Records", value: deadlineStatuses.length, detail: "Monitored", tone: "text-slate-900" },
            { label: "Healthy", value: countStatus("Healthy"), detail: "Good standing", tone: "text-emerald-600" },
            { label: "Watch", value: countStatus("Watch"), detail: "Upcoming", tone: "text-blue-600" },
            { label: "Urgent", value: countStatus("Urgent"), detail: "Action required", tone: "text-amber-600" },
            { label: "Critical / Expired", value: countStatus("Critical") + countStatus("Expired"), detail: "Immediate attention", tone: "text-red-600" },
            { label: "No Deadline", value: countStatus("No Deadline"), detail: "Continuous", tone: "text-slate-700" },
          ].map((card) => (
            <div key={card.label} className="min-w-0 rounded-2xl border border-[#d9e4fa] bg-card px-4 py-3.5 shadow-sm">
              <p className={`text-[10px] font-bold uppercase tracking-wide ${card.tone}`}>{card.label}</p>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className={`text-2xl font-bold leading-none ${card.tone}`}>{card.value}</span>
                <span className="text-[11px] text-muted-foreground">{card.detail}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 3-YEAR RETENTION BANNER */}
        <div className="border border-primary/15 rounded-xl bg-primary/[0.025] p-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <History className="mt-0.5 size-4 text-primary shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">Standard 3-Year Operational Retention Window</p>
                <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                  The primary view displays active and recent records within the 3-year compliance window. Older retained records remain safely accessible.
                </p>
              </div>
            </div>

            {olderRecordCount > 0 && (
              <button
                type="button"
                onClick={() => setShowOlderHistory((current) => !current)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors shrink-0"
              >
                <History className="mr-1.5 size-3.5" />
                {showOlderHistory ? "Show Standard View" : `Show Older History (${olderRecordCount})`}
              </button>
            )}
          </div>
        </div>

        {/* RECORD SECTIONS */}
        <div className="space-y-6">
          <div className="space-y-6">
            {profile.showCanadian && (
              <AuthoritySection
                title="Canadian Operations"
                description="Provincial carrier identifier (MVID / RIN) and NSC / Safety Fitness Certificate / CVOR records."
                records={categoryAuthorities("canadian")}
                rules={rules}
                selectedId={selectedId ?? undefined}
                onSelect={(record) => setSelectedId(record.id)}
                onScan={() => setSourceContext({ mode: "authority", category: "canadian" })}
                onManual={() => openManual({ mode: "authority", draft: emptyAuthorityDraft(company, "canadian") })}
              />
            )}

            {profile.showUS && (
              <AuthoritySection
                title="US Federal Operations"
                description="USDOT identifier, MC operating authority, and MCS-150 biennial update filings."
                records={categoryAuthorities("us_federal")}
                rules={rules}
                selectedId={selectedId ?? undefined}
                onSelect={(record) => setSelectedId(record.id)}
                onScan={() => setSourceContext({ mode: "authority", category: "us_federal" })}
                onManual={() => openManual({ mode: "authority", draft: emptyAuthorityDraft(company, "us_federal") })}
              />
            )}

            <AuthoritySection
              title="Operating Registrations"
              description={
                profile.showPHMSA
                  ? "Unified Carrier Registration (UCR), fleet PHMSA hazardous material registrations and IRP accounts."
                  : "Carrier-level operating registrations including UCR and IRP accounts."
              }
              records={registrations}
              rules={rules}
              selectedId={selectedId ?? undefined}
              onSelect={(record) => setSelectedId(record.id)}
              onScan={() => setSourceContext({ mode: "authority", category: "operating_registration" })}
              onManual={() => openManual({ mode: "authority", draft: emptyAuthorityDraft(company, "operating_registration", profile.showUCR ? "UCR" : "IRP") })}
            />

            {profile.showCarrierProfile && (
              <SafetySection
                title="Carrier Profile / CVOR"
                records={filteredSafety.filter((record) => record.system === "CARRIER_PROFILE_CVOR")}
                selected={selected}
                onSelect={() => undefined}
                onScan={() => setSourceContext({ mode: "safety", safetySystem: "CARRIER_PROFILE_CVOR" })}
                onManual={() => openManual({ mode: "safety", draft: emptySafetyDraft(company, "CARRIER_PROFILE_CVOR") })}
              />
            )}

            {profile.showSMSProfile && (
              <SafetySection
                title="SMS Safety Profile"
                records={filteredSafety.filter((record) => record.system === "SMS_PROFILE")}
                selected={selected}
                onSelect={() => undefined}
                onScan={() => setSourceContext({ mode: "safety", safetySystem: "SMS_PROFILE" })}
                onManual={() => openManual({ mode: "safety", draft: emptySafetyDraft(company, "SMS_PROFILE") })}
              />
            )}

            {/* AUDITS & INTERVENTIONS */}
            <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
              <div className="border-b border-border bg-muted/20 px-5 py-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Audits & Interventions</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">Regulatory notices, investigations, interventions, and outcomes.</p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSourceContext({ mode: "audit" })}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      <ScanDocumentIcon size={14} />
                      <span className="ml-1.5">Scan Notice</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openManual({ mode: "audit", draft: emptyAuditDraft(company) })}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      Add Audit
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-5 pt-3">
                <CanonicalUnavailable action="Audit and intervention records" reason="they have no canonical PostgreSQL storage yet, so none can be saved or listed here." />
              </div>
              <div>
                {filteredAudits.length === 0 ? (
                  <div className="p-10 text-center">
                    <FileCheck2 className="mx-auto size-9 text-muted-foreground/30" />
                    <p className="mt-3 text-sm font-medium text-foreground">No audit or intervention records found.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredAudits.map((record) => (
                      <div key={record.id}>
                        <AuditRow record={record} selected={false} onClick={() => undefined} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Unavailable actions (deferred, no canonical PostgreSQL storage yet): safety snapshots, audit records, supporting documents and OCR extraction, issuing-authority text, notes, filing dates, archive reasons, and the MCS-150, UCR, PHMSA and Other record types. These controls stay visible and refuse instead of saving anything in the browser.
        </p>
      </div>

      {/* RECORD DETAILS */}
      {selected && !manualState && !editingState && !archiveConfirm && !ocrSession && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedId(null)
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="Authority record details" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-card shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <RecordInspector
              selected={selected}
              evidence={data.evidence}
              rules={rules}
              onClose={() => setSelectedId(null)}
              onEdit={openEdit}
              onArchive={() => {
                setModalError(null)
                setArchiveConfirm(selected.record as AuthorityRecord)
              }}
              onRestore={handleRestore}
              onPreview={() => undefined}
            />
          </div>
        </div>
      )}

      {/* MANUAL MODAL */}
      {manualState && (
        <ManualModal
          state={manualState}
          profile={profile}
          onChange={setManualState}
          onCancel={() => setManualState(null)}
          onSave={saveManual}
          onCheckNumber={canonical.checkNumber}
          error={modalError}
          saving={saving}
        />
      )}

      {/* EDIT MODAL */}
      {editingState && selected && (
        <ManualModal
          state={editingState}
          profile={profile}
          isEditing
          editMode={editMode}
          onEditModeChange={setEditMode}
          onChange={setEditingState}
          onCancel={() => setEditingState(null)}
          onSave={saveEdit}
          onCheckNumber={canonical.checkNumber}
          error={modalError}
          saving={saving}
        />
      )}

      {/* ARCHIVE CONFIRMATION MODAL */}
      {archiveConfirm && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden p-6">
            <div className="flex items-center gap-2 text-destructive">
              <Archive className="size-5" />
              <h3 className="text-base font-semibold">Archive Compliance Record</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Archiving retains the record and its attached certificates in the compliance audit trail while removing it from active lists.
            </p>

            <div className="space-y-1.5 mt-4">
              <label className="text-xs font-semibold text-foreground">Archive Reason</label>
              <input
                type="text"
                value={archiveReasonInput}
                onChange={(e) => setArchiveReasonInput(e.target.value)}
                placeholder="e.g. Authority superseded / Policy renewed / Replaced"
                className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <CanonicalUnavailable action="Recording an archive reason" reason="it has no canonical home yet. Leave it empty to archive the record; a typed reason is refused rather than lost." />
            </div>

            {modalError ? (
              <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {modalError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-5">
              <button type="button" onClick={closeArchive} className="px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={confirmArchive}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors shadow-sm"
              >
                Confirm Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT SOURCE PICKER */}
      {sourceContext && (
        <DocumentSourcePicker
          isOpen={Boolean(sourceContext)}
          onClose={() => setSourceContext(null)}
          onSelectCamera={() => {
            setSourceContext(sourceContext)
            setShowCamera(true)
          }}
          onSelectFile={(file) => {
            void startOCRFile(file, "device")
          }}
        />
      )}

      {/* CAMERA CAPTURE */}
      {showCamera && (
        <CameraCapture
          onClose={() => setShowCamera(false)}
          onCapture={(file) => {
            setShowCamera(false)
            void startOCRFile(file, "camera")
          }}
        />
      )}

      {/* OCR WORKSPACE */}
      {ocrSession && (
        <OCRWorkspace
          session={ocrSession}
          profile={profile}
          companyName={company.name}
          setSession={setOcrSession}
          onCancel={() => setOcrSession(null)}
          onCheckNumber={canonical.checkNumber}
          error={modalError}
          saving={saving}
          onReplace={() => {
            const context =
              ocrSession.mode === "authority"
                ? { mode: "authority" as const, category: ocrSession.authorityDraft!.category, authorityType: ocrSession.authorityDraft!.authorityType }
                : ocrSession.mode === "safety"
                ? { mode: "safety" as const, safetySystem: ocrSession.safetyDraft!.system }
                : { mode: "audit" as const }
            setOcrSession(null)
            setSourceContext(context)
          }}
          onSave={saveOCR}
        />
      )}
    </>
  )
}
