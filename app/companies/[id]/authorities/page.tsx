"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Archive, ArrowLeft, Building2, FileCheck2, History, Plus, RefreshCcw } from "lucide-react"
import { getDeadlineStatus, DEFAULT_DEADLINE_RULES } from "@/lib/deadline-engine"
import { normalizeUSDOT, normalizeMC, normalizeTaxId } from "@/lib/identifier-normalization"
import { recordAuditEvent } from "@/lib/audit-logger"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer"
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker"
import { CameraCapture } from "@/src/components/CameraCapture"
import { LoadingState, EmptyState, ErrorAlert } from "@/src/components/shared/StateDisplays"
import type { Company, AuthorityRecord, SafetyRecord, AuditRecord, StoredAuthoritiesData, AuthorityEvidence, AuthorityType, AuthorityCategory, SafetySystem, SourceType, DocumentSource, OCRSession, SelectedRecord, DeadlineRules, DeadlineStatus, AuthorityDraft, SafetyDraft, AuditDraft } from "@/lib/authorities/types"
import { EMPTY_DATA, createId, isoNow, todayISO, getCompanies, loadDeadlineRules, readFileAsDataUrl, captureCrossStoreSnapshot, rollbackCrossStoreSnapshot, deriveAuthorityProfile, isDateInsideThreeYears, authorityReferenceDate, safetyReferenceDate, auditReferenceDate, findGlobalAuthorityConflict, authorityOptions, emptyAuthorityDraft, emptySafetyDraft, emptyAuditDraft } from "@/lib/authorities/model"
import { ScanDocumentIcon } from "@/src/components/authorities/shared-fields"
import { ManualModal } from "@/src/components/authorities/forms"
import type { ManualState } from "@/src/components/authorities/forms"
import { requestOCR, OCRWorkspace } from "@/src/components/authorities/ocr-workspace"
import { AuthoritySection, SafetySection, AuditRow } from "@/src/components/authorities/sections"
import { RecordInspector } from "@/src/components/authorities/record-inspector"

export default function AuthoritiesPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const deviceInputRef = useRef<HTMLInputElement | null>(null)

  const [company, setCompany] = useState<Company | null>(null)
  const [data, setData] = useState<StoredAuthoritiesData>(EMPTY_DATA)
  const [rules, setRules] = useState<DeadlineRules>(DEFAULT_DEADLINE_RULES)
  const [loading, setLoading] = useState(true)
  const [showOlderHistory, setShowOlderHistory] = useState(false)
  const [selected, setSelected] = useState<SelectedRecord | null>(null)
  const [previewEvidence, setPreviewEvidence] = useState<AuthorityEvidence | null>(null)
  const [manualState, setManualState] = useState<ManualState | null>(null)
  const [editingState, setEditingState] = useState<ManualState | null>(null)
  const [archiveConfirm, setArchiveConfirm] = useState<SelectedRecord | null>(null)
  const [archiveReasonInput, setArchiveReasonInput] = useState("")

  const [sourceContext, setSourceContext] = useState<{
    mode: "authority" | "safety" | "audit"
    category?: AuthorityCategory
    authorityType?: AuthorityType
    safetySystem?: SafetySystem
  } | null>(null)

  const [showCamera, setShowCamera] = useState(false)
  const [ocrSession, setOcrSession] = useState<OCRSession | null>(null)

  const storageKey = `tes_company_authorities_${companyId}`

  /* =======================================================
     LOAD INITIAL STATE
  ======================================================= */

  useEffect(() => {
    try {
      const companies = getCompanies()
      const found = companies.find((item) => item.id === companyId)
      setCompany(found || null)

      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        setData({
          ...EMPTY_DATA,
          ...parsed,
          authorities: Array.isArray(parsed.authorities) ? parsed.authorities : [],
          safety: Array.isArray(parsed.safety) ? parsed.safety : [],
          audits: Array.isArray(parsed.audits) ? parsed.audits : [],
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
        })
      }

      setRules(loadDeadlineRules())
    } catch (error) {
      console.error("Unable to load Authorities data:", error)
    } finally {
      setLoading(false)
    }
  }, [companyId, storageKey])

  const profile = useMemo(
    () => (company ? deriveAuthorityProfile(company) : null),
    [company]
  )

  /* =======================================================
     COMPANY MASTER SYNCHRONIZATION HELPER
  ======================================================= */

  const syncToCompanyMaster = (
    authorityType: AuthorityType,
    number: string
  ): boolean => {
    // Only these four authority types map to company master fields
    const mappedTypes: AuthorityType[] = [
      "USDOT",
      "MC",
      "PROVINCIAL_CARRIER_IDENTIFIER",
      "CANADIAN_SAFETY_AUTHORITY",
    ]

    if (!mappedTypes.includes(authorityType)) {
      return true
    }

    const companies = getCompanies()
    const index = companies.findIndex((c) => c.id === companyId)
    if (index === -1) {
      throw new Error(`Company ${companyId} not found for master synchronization`)
    }

    const updated = { ...companies[index] }
    let mutated = false

    if (authorityType === "USDOT") {
      updated.usdot = normalizeUSDOT(number)
      mutated = true
    } else if (authorityType === "MC") {
      updated.mc = normalizeMC(number)
      mutated = true
    } else if (authorityType === "PROVINCIAL_CARRIER_IDENTIFIER") {
      updated.mvid = normalizeTaxId(number)
      mutated = true
    } else if (authorityType === "CANADIAN_SAFETY_AUTHORITY") {
      updated.nsc = normalizeTaxId(number)
      mutated = true
    }

    if (mutated) {
      companies[index] = updated
      localStorage.setItem("tes_companies", JSON.stringify(companies))
      setCompany(updated)
    }

    return true
  }

  /* =======================================================
     EXPLICIT PERSISTENCE HELPER
  ======================================================= */

  const persistAuthoritiesData = (newData: StoredAuthoritiesData) => {
    localStorage.setItem(storageKey, JSON.stringify(newData))
    setData(newData)
  }

  /* =======================================================
     3-YEAR RECORD FILTERING
  ======================================================= */

  const filteredAuthorities = data.authorities.filter(
    (record) =>
      showOlderHistory || isDateInsideThreeYears(authorityReferenceDate(record))
  )

  const filteredSafety = data.safety.filter(
    (record) =>
      showOlderHistory || isDateInsideThreeYears(safetyReferenceDate(record))
  )

  const filteredAudits = data.audits.filter(
    (record) =>
      showOlderHistory || isDateInsideThreeYears(auditReferenceDate(record))
  )

  const olderRecordCount = [
    ...data.authorities.filter(
      (record) => !isDateInsideThreeYears(authorityReferenceDate(record))
    ),
    ...data.safety.filter(
      (record) => !isDateInsideThreeYears(safetyReferenceDate(record))
    ),
    ...data.audits.filter(
      (record) => !isDateInsideThreeYears(auditReferenceDate(record))
    ),
  ].length

  const categoryAuthorities = (category: AuthorityCategory) =>
    filteredAuthorities.filter((record) => record.category === category)

  /* =======================================================
     SAVE AUTHORITY
  ======================================================= */

  const saveAuthority = (
    draft: AuthorityDraft,
    source: SourceType,
    evidence?: AuthorityEvidence,
    editingId?: string
  ) => {
    const snapshot = captureCrossStoreSnapshot(companyId)

    const conflict = findGlobalAuthorityConflict({
      currentCompanyId: companyId,
      authorityType: draft.authorityType,
      number: draft.number,
      editingId,
    })

    if (conflict) {
      rollbackCrossStoreSnapshot(companyId, snapshot)
      if (conflict.sameCompany) {
        alert(
          `This identifier already exists for this company.\n\nOpen the existing ${draft.name} record instead of creating a duplicate.`
        )
      } else {
        alert(
          `Duplicate identifier conflict.\n\n${draft.name} ${draft.number} is already connected to ${conflict.companyName} (${conflict.companyId}). TES will not create a second authoritative record.`
        )
      }
      return false
    }

    const now = isoNow()

    try {
      if (editingId) {
        const updatedAuthorities = data.authorities.map((record) =>
          record.id === editingId
            ? {
                ...record,
                ...draft,
                evidenceIds: evidence
                  ? Array.from(new Set([...record.evidenceIds, evidence.id]))
                  : record.evidenceIds,
                source,
                updatedAt: now,
              }
            : record
        )

        const updatedEvidence = evidence
          ? [{ ...evidence, recordId: editingId }, ...data.evidence]
          : data.evidence

        const newData: StoredAuthoritiesData = {
          ...data,
          authorities: updatedAuthorities,
          evidence: updatedEvidence,
        }

        // Commit Authorities store
        persistAuthoritiesData(newData)

        // Commit Company Master store
        syncToCompanyMaster(draft.authorityType, draft.number)

        recordAuditEvent({
          actor: "Safety Director",
          role: "Compliance Officer",
          companyId,
          entityType: "Authority",
          entityId: editingId,
          action: "UPDATE",
          details: `Updated authority record ${draft.name} (${draft.number})`,
          newValue: JSON.stringify({ number: draft.number, status: draft.status }),
          evidenceId: evidence?.id,
        })

        return true
      }

      const newId = createId("AUTH")
      const record: AuthorityRecord = {
        id: newId,
        ...draft,
        evidenceIds: evidence ? [evidence.id] : [],
        source,
        createdAt: now,
        updatedAt: now,
      }

      const newData: StoredAuthoritiesData = {
        ...data,
        authorities: [record, ...data.authorities],
        evidence: evidence
          ? [{ ...evidence, recordId: record.id }, ...data.evidence]
          : data.evidence,
      }

      // Commit Authorities store
      persistAuthoritiesData(newData)

      // Commit Company Master store
      syncToCompanyMaster(draft.authorityType, draft.number)

      recordAuditEvent({
        actor: "Safety Director",
        role: "Compliance Officer",
        companyId,
        entityType: "Authority",
        entityId: newId,
        action: "CREATE",
        details: `Created new authority record ${draft.name} (${draft.number})`,
        newValue: JSON.stringify({ number: draft.number, status: draft.status }),
        evidenceId: evidence?.id,
      })

      setSelected({
        kind: "authority",
        record,
      })

      return true
    } catch (err) {
      console.error("Failed atomic transaction during authority save; rolling back:", err)
      rollbackCrossStoreSnapshot(companyId, snapshot)
      // Restore React states from pre-operation snapshot
      try {
        if (snapshot.authorities) {
          setData(JSON.parse(snapshot.authorities))
        }
        if (snapshot.companies) {
          const companies = JSON.parse(snapshot.companies)
          const found = companies.find((c: Company) => c.id === companyId)
          if (found) setCompany(found)
        }
      } catch (parseErr) {
        console.error("Failed to parse snapshot during rollback:", parseErr)
      }
      alert("Failed to save authority record. Changes have been rolled back to maintain consistency.")
      return false
    }
  }

  /* =======================================================
     SAVE SAFETY
  ======================================================= */

  const saveSafety = (
    draft: SafetyDraft,
    source: SourceType,
    evidence?: AuthorityEvidence,
    editingId?: string
  ) => {
    const now = isoNow()

    if (editingId) {
      const updatedSafety = data.safety.map((record) =>
        record.id === editingId
          ? {
              ...record,
              ...draft,
              evidenceIds: evidence
                ? Array.from(new Set([...record.evidenceIds, evidence.id]))
                : record.evidenceIds,
              source,
              updatedAt: now,
            }
          : record
      )

      const updatedEvidence = evidence
        ? [{ ...evidence, recordId: editingId }, ...data.evidence]
        : data.evidence

      const newData: StoredAuthoritiesData = {
        ...data,
        safety: updatedSafety,
        evidence: updatedEvidence,
      }

      persistAuthoritiesData(newData)

      recordAuditEvent({
        actor: "Safety Director",
        role: "Compliance Officer",
        companyId,
        entityType: "Authority",
        entityId: editingId,
        action: "UPDATE",
        details: `Updated safety profile snapshot ${draft.system}`,
        evidenceId: evidence?.id,
      })

      return
    }

    const newId = createId("SAFE")
    const record: SafetyRecord = {
      id: newId,
      ...draft,
      evidenceIds: evidence ? [evidence.id] : [],
      source,
      createdAt: now,
      updatedAt: now,
    }

    const newData: StoredAuthoritiesData = {
      ...data,
      safety: [record, ...data.safety],
      evidence: evidence
        ? [{ ...evidence, recordId: record.id }, ...data.evidence]
        : data.evidence,
    }

    persistAuthoritiesData(newData)

    recordAuditEvent({
      actor: "Safety Director",
      role: "Compliance Officer",
      companyId,
      entityType: "Authority",
      entityId: newId,
      action: "CREATE",
      details: `Created new safety profile snapshot ${draft.system}`,
      evidenceId: evidence?.id,
    })

    setSelected({
      kind: "safety",
      record,
    })
  }

  /* =======================================================
     SAVE AUDIT
  ======================================================= */

  const saveAudit = (
    draft: AuditDraft,
    source: SourceType,
    evidence?: AuthorityEvidence,
    editingId?: string
  ) => {
    const now = isoNow()

    if (editingId) {
      const updatedAudits = data.audits.map((record) =>
        record.id === editingId
          ? {
              ...record,
              ...draft,
              evidenceIds: evidence
                ? Array.from(new Set([...record.evidenceIds, evidence.id]))
                : record.evidenceIds,
              source,
              updatedAt: now,
            }
          : record
      )

      const updatedEvidence = evidence
        ? [{ ...evidence, recordId: editingId }, ...data.evidence]
        : data.evidence

      const newData: StoredAuthoritiesData = {
        ...data,
        audits: updatedAudits,
        evidence: updatedEvidence,
      }

      persistAuthoritiesData(newData)

      recordAuditEvent({
        actor: "Safety Director",
        role: "Compliance Officer",
        companyId,
        entityType: "Authority",
        entityId: editingId,
        action: "UPDATE",
        details: `Updated regulatory audit record ${draft.auditType} (${draft.regulator})`,
        evidenceId: evidence?.id,
      })

      return
    }

    const newId = createId("AUD")
    const record: AuditRecord = {
      id: newId,
      ...draft,
      evidenceIds: evidence ? [evidence.id] : [],
      source,
      createdAt: now,
      updatedAt: now,
    }

    const newData: StoredAuthoritiesData = {
      ...data,
      audits: [record, ...data.audits],
      evidence: evidence
        ? [{ ...evidence, recordId: record.id }, ...data.evidence]
        : data.evidence,
    }

    persistAuthoritiesData(newData)

    recordAuditEvent({
      actor: "Safety Director",
      role: "Compliance Officer",
      companyId,
      entityType: "Authority",
      entityId: newId,
      action: "CREATE",
      details: `Created new regulatory audit record ${draft.auditType} (${draft.regulator})`,
      evidenceId: evidence?.id,
    })

    setSelected({
      kind: "audit",
      record,
    })
  }

  /* =======================================================
     SOFT ARCHIVE & RESTORE
  ======================================================= */

  const confirmArchive = () => {
    if (!archiveConfirm) return

    const now = isoNow()
    const id = archiveConfirm.record.id
    const reason = archiveReasonInput.trim() || "Archived by operator"

    let updatedAuthorities = data.authorities
    let updatedSafety = data.safety
    let updatedAudits = data.audits

    if (archiveConfirm.kind === "authority") {
      updatedAuthorities = data.authorities.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: true,
              status: "Archived" as const,
              archivedAt: now,
              archivedBy: "Safety Director",
              archiveReason: reason,
              updatedAt: now,
            }
          : record
      )
    } else if (archiveConfirm.kind === "safety") {
      updatedSafety = data.safety.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: true,
              archivedAt: now,
              archivedBy: "Safety Director",
              archiveReason: reason,
              updatedAt: now,
            }
          : record
      )
    } else if (archiveConfirm.kind === "audit") {
      updatedAudits = data.audits.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: true,
              archivedAt: now,
              archivedBy: "Safety Director",
              archiveReason: reason,
              updatedAt: now,
            }
          : record
      )
    }

    const newData: StoredAuthoritiesData = {
      ...data,
      authorities: updatedAuthorities,
      safety: updatedSafety,
      audits: updatedAudits,
    }

    persistAuthoritiesData(newData)

    recordAuditEvent({
      actor: "Safety Director",
      role: "Compliance Officer",
      companyId,
      entityType: "Authority",
      entityId: id,
      action: "ARCHIVE",
      details: `Soft-archived ${archiveConfirm.kind} record ${id}: ${reason}`,
    })

    setArchiveConfirm(null)
    setArchiveReasonInput("")
    setSelected(null)
  }

  const handleRestore = () => {
    if (!selected) return

    const now = isoNow()
    const id = selected.record.id

    // Requirement 1: If restoring an AuthorityRecord, check global uniqueness before unarchiving
    if (selected.kind === "authority") {
      const conflict = findGlobalAuthorityConflict({
        currentCompanyId: companyId,
        authorityType: selected.record.authorityType,
        number: selected.record.number,
        editingId: selected.record.id,
      })

      if (conflict) {
        if (conflict.sameCompany) {
          alert(
            `This identifier already exists for this company.\n\nAn active ${selected.record.name} record already uses this identifier. TES cannot restore this duplicate record.`
          )
        } else {
          alert(
            `Duplicate identifier conflict.\n\n${selected.record.name} ${selected.record.number} is currently active in ${conflict.companyName} (${conflict.companyId}). TES will not restore a conflicting authoritative record.`
          )
        }
        return
      }
    }

    const snapshot = captureCrossStoreSnapshot(companyId)

    let updatedAuthorities = data.authorities
    let updatedSafety = data.safety
    let updatedAudits = data.audits

    if (selected.kind === "authority") {
      updatedAuthorities = data.authorities.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: false,
              status: "Active" as const,
              updatedAt: now,
            }
          : record
      )
    } else if (selected.kind === "safety") {
      updatedSafety = data.safety.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: false,
              updatedAt: now,
            }
          : record
      )
    } else if (selected.kind === "audit") {
      updatedAudits = data.audits.map((record) =>
        record.id === id
          ? {
              ...record,
              isArchived: false,
              updatedAt: now,
            }
          : record
      )
    }

    const newData: StoredAuthoritiesData = {
      ...data,
      authorities: updatedAuthorities,
      safety: updatedSafety,
      audits: updatedAudits,
    }

    try {
      // Commit Authorities store
      persistAuthoritiesData(newData)

      // Requirement 3: If restoring an authority record, synchronize active identifier to company master
      if (selected.kind === "authority") {
        syncToCompanyMaster(selected.record.authorityType, selected.record.number)
      }

      recordAuditEvent({
        actor: "Safety Director",
        role: "Compliance Officer",
        companyId,
        entityType: "Authority",
        entityId: id,
        action: "RESTORE",
        details: `Restored ${selected.kind} record ${id}`,
      })

      setSelected((current) =>
        current
          ? {
              ...current,
              record: {
                ...current.record,
                isArchived: false,
                status: selected.kind === "authority" ? "Active" : (current.record as any).status,
                updatedAt: now,
              } as any,
            }
          : null
      )
    } catch (err) {
      console.error("Failed atomic transaction during record restore; rolling back:", err)
      rollbackCrossStoreSnapshot(companyId, snapshot)
      // Restore React states from pre-operation snapshot
      try {
        if (snapshot.authorities) {
          setData(JSON.parse(snapshot.authorities))
        }
        if (snapshot.companies) {
          const companies = JSON.parse(snapshot.companies)
          const found = companies.find((c: Company) => c.id === companyId)
          if (found) setCompany(found)
        }
      } catch (parseErr) {
        console.error("Failed to parse snapshot during rollback:", parseErr)
      }
      alert("Failed to restore record. Changes have been rolled back to maintain consistency.")
    }
  }

  /* =======================================================
     EDIT HANDLER
  ======================================================= */

  const openEdit = () => {
    if (!selected) return

    if (selected.kind === "authority") {
      const record = selected.record
      setEditingState({
        mode: "authority",
        draft: {
          category: record.category,
          authorityType: record.authorityType,
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
      return
    }

    if (selected.kind === "safety") {
      const record = selected.record
      setEditingState({
        mode: "safety",
        draft: {
          system: record.system,
          jurisdictionCode: record.jurisdictionCode,
          jurisdictionLabel: record.jurisdictionLabel,
          country: record.country,
          reviewDate: record.reviewDate,
          summary: record.summary,
          notes: record.notes || "",
        },
      })
      return
    }

    const record = selected.record
    setEditingState({
      mode: "audit",
      draft: {
        auditType: record.auditType,
        regulator: record.regulator,
        jurisdictionCode: record.jurisdictionCode,
        jurisdictionLabel: record.jurisdictionLabel,
        country: record.country,
        referenceNumber: record.referenceNumber,
        noticeDate: record.noticeDate || "",
        dueDate: record.dueDate || "",
        completedDate: record.completedDate || "",
        status: record.status,
        outcome: record.outcome || "",
        score: record.score || "",
        followUpRequired: record.followUpRequired,
        followUpDueDate: record.followUpDueDate || "",
        notes: record.notes || "",
      },
    })
  }

  /* =======================================================
     START OCR FILE
  ======================================================= */

  const startOCRFile = async (file: File, source: DocumentSource) => {
    if (!sourceContext || !company || !profile) return

    if (
      !file.type.startsWith("image/") &&
      file.type !== "application/pdf"
    ) {
      alert("Please select a PDF or image.")
      return
    }

    const dataUrl = await readFileAsDataUrl(file)

    if (sourceContext.mode === "authority") {
      const category = sourceContext.category!
      const options = authorityOptions(category, profile)
      const type = sourceContext.authorityType || options[0]?.value || "OTHER"

      setOcrSession({
        mode: "authority",
        source,
        file,
        dataUrl,
        processing: false,
        extractionComplete: false,
        documentDate: todayISO(),
        authorityDraft: emptyAuthorityDraft(company, category, type),
      })
    } else if (sourceContext.mode === "safety") {
      setOcrSession({
        mode: "safety",
        source,
        file,
        dataUrl,
        processing: false,
        extractionComplete: false,
        documentDate: todayISO(),
        safetyDraft: emptySafetyDraft(company, sourceContext.safetySystem!),
      })
    } else {
      setOcrSession({
        mode: "audit",
        source,
        file,
        dataUrl,
        processing: false,
        extractionComplete: false,
        documentDate: todayISO(),
        auditDraft: emptyAuditDraft(company),
      })
    }

    setSourceContext(null)
  }

  /* =======================================================
     SAVE OCR SESSION
  ======================================================= */

  const saveOCR = () => {
    if (!ocrSession) return

    const evidence: AuthorityEvidence = {
      id: createId("DOC"),
      fileName: ocrSession.file.name,
      mimeType: ocrSession.file.type,
      dataUrl: ocrSession.dataUrl,
      documentDate: ocrSession.documentDate,
      uploadedAt: isoNow(),
      source: ocrSession.source,
      ocrConfidence: ocrSession.confidence,
    }

    if (ocrSession.mode === "authority" && ocrSession.authorityDraft) {
      const saved = saveAuthority(ocrSession.authorityDraft, "OCR", evidence)
      if (saved) {
        setOcrSession(null)
      }
      return
    }

    if (ocrSession.mode === "safety" && ocrSession.safetyDraft) {
      saveSafety(ocrSession.safetyDraft, "OCR", evidence)
      setOcrSession(null)
      return
    }

    if (ocrSession.mode === "audit" && ocrSession.auditDraft) {
      saveAudit(ocrSession.auditDraft, "OCR", evidence)
      setOcrSession(null)
    }
  }

  /* =======================================================
     PREVIEW DOCUMENT HELPER WITH AUDIT
  ======================================================= */

  const handlePreviewDocument = (doc: AuthorityEvidence) => {
    setPreviewEvidence(doc)
    recordAuditEvent({
      actor: "Safety Director",
      role: "Compliance Officer",
      companyId,
      entityType: "Evidence",
      entityId: doc.id,
      action: "VIEW_DOCUMENT",
      details: `Viewed document ${doc.fileName}`,
      evidenceId: doc.id,
    })
  }

  /* =======================================================
     LOADING / NOT FOUND STATES
  ======================================================= */

  if (loading) {
    return <LoadingState message="Loading authorities and regulatory registrations..." />
  }

  if (!company || !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Building2 className="size-10 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold text-foreground">Company Not Found</h2>
        <button
          type="button"
          onClick={() => router.push("/companies")}
          className="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
        >
          <ArrowLeft className="mr-2 size-4" />
          Companies
        </button>
      </div>
    )
  }

  /* =======================================================
     SUMMARY METRICS
  ======================================================= */

  const deadlineStatuses = filteredAuthorities
    .filter((r) => !r.isArchived)
    .map((record) =>
      getDeadlineStatus(
        record.authorityType === "MCS150"
          ? record.nextActionDate
          : record.expiryDate,
        rules
      )
    )

  const countStatus = (status: DeadlineStatus) =>
    deadlineStatuses.filter((item) => item === status).length

  const registrations = categoryAuthorities("operating_registration").filter(
    (record) => {
      if (record.authorityType === "PHMSA") {
        return profile.showPHMSA
      }
      if (record.authorityType === "UCR") {
        return profile.showUCR
      }
      return true
    }
  )

  const showOperatingRegistrations = profile.showUCR || profile.showPHMSA

  return (
    <>
      <div className="flex max-w-[1600px] flex-col gap-6 pb-12">
        {/* HEADER */}
        <div>
          <CompanyWorkspaceHeader
            company={{ id: company.id, name: company.name, kind: company.kind || "", status: company.status || "" }}
            section="Authorities"
          />

          <div className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Registered Origin
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {company.regCorpState || "Unknown"},{" "}
                  {company.regCorpCountry || "Unknown"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Operating Region
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {company.region || "Not specified"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Cargo / Hazmat Trigger
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {profile.hazmat ? "Hazmat Operation" : "No Hazmat Trigger"}
                </p>
              </div>

              <div className="hidden h-8 w-px bg-border lg:block" />

              <button
                type="button"
                onClick={() => setRules(loadDeadlineRules())}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <RefreshCcw className="size-3" />
                Refresh Deadline Settings
              </button>
            </div>
          </div>
        </div>

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
                <p className="text-xs font-semibold text-foreground">
                  Standard 3-Year Operational Retention Window
                </p>
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
                {showOlderHistory
                  ? "Show Standard View"
                  : `Show Older History (${olderRecordCount})`}
              </button>
            )}
          </div>
        </div>

        {/* RECORD SECTIONS */}
        <div className="space-y-6">
          <div className="space-y-6">
            {/* CANADIAN OPERATIONS */}
            {profile.showCanadian && (
              <AuthoritySection
                title="Canadian Operations"
                description="Provincial carrier identifier (MVID / RIN) and NSC / Safety Fitness Certificate / CVOR records."
                records={categoryAuthorities("canadian")}
                rules={rules}
                selectedId={
                  selected?.kind === "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(record) =>
                  setSelected({
                    kind: "authority",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "authority",
                    category: "canadian",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "authority",
                    draft: emptyAuthorityDraft(company, "canadian"),
                  })
                }
              />
            )}

            {/* US FEDERAL OPERATIONS */}
            {profile.showUS && (
              <AuthoritySection
                title="US Federal Operations"
                description="USDOT identifier, MC operating authority, and MCS-150 biennial update filings."
                records={categoryAuthorities("us_federal")}
                rules={rules}
                selectedId={
                  selected?.kind === "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(record) =>
                  setSelected({
                    kind: "authority",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "authority",
                    category: "us_federal",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "authority",
                    draft: emptyAuthorityDraft(company, "us_federal"),
                  })
                }
              />
            )}

            {/* OPERATING REGISTRATIONS (UCR & PHMSA) */}
            {showOperatingRegistrations && (
              <AuthoritySection
                title="Operating Registrations"
                description={
                  profile.showPHMSA
                    ? "Unified Carrier Registration (UCR) and fleet PHMSA hazardous material registrations."
                    : "Carrier-level operating registrations including UCR."
                }
                records={registrations}
                rules={rules}
                selectedId={
                  selected?.kind === "authority"
                    ? selected.record.id
                    : undefined
                }
                onSelect={(record) =>
                  setSelected({
                    kind: "authority",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "authority",
                    category: "operating_registration",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "authority",
                    draft: emptyAuthorityDraft(
                      company,
                      "operating_registration",
                      profile.showUCR ? "UCR" : "PHMSA"
                    ),
                  })
                }
              />
            )}

            {/* CANADIAN SAFETY SNAPSHOT */}
            {profile.showCarrierProfile && (
              <SafetySection
                title="Carrier Profile / CVOR"
                records={filteredSafety.filter(
                  (record) => record.system === "CARRIER_PROFILE_CVOR"
                )}
                selected={selected}
                onSelect={(record) =>
                  setSelected({
                    kind: "safety",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "safety",
                    safetySystem: "CARRIER_PROFILE_CVOR",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "safety",
                    draft: emptySafetyDraft(company, "CARRIER_PROFILE_CVOR"),
                  })
                }
              />
            )}

            {/* US SMS PROFILE SNAPSHOT */}
            {profile.showSMSProfile && (
              <SafetySection
                title="SMS Safety Profile"
                records={filteredSafety.filter(
                  (record) => record.system === "SMS_PROFILE"
                )}
                selected={selected}
                onSelect={(record) =>
                  setSelected({
                    kind: "safety",
                    record,
                  })
                }
                onScan={() =>
                  setSourceContext({
                    mode: "safety",
                    safetySystem: "SMS_PROFILE",
                  })
                }
                onManual={() =>
                  setManualState({
                    mode: "safety",
                    draft: emptySafetyDraft(company, "SMS_PROFILE"),
                  })
                }
              />
            )}

            {/* AUDITS & INTERVENTIONS */}
            <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
              <div className="border-b border-border bg-muted/20 px-5 py-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Audits & Interventions</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Regulatory notices, investigations, interventions, and outcomes.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSourceContext({
                          mode: "audit",
                        })
                      }
                      className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      <ScanDocumentIcon size={14} />
                      <span className="ml-1.5">Scan Notice</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setManualState({
                          mode: "audit",
                          draft: emptyAuditDraft(company),
                        })
                      }
                      className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      Add Audit
                    </button>
                  </div>
                </div>
              </div>

              <div>
                {filteredAudits.length === 0 ? (
                  <div className="p-10 text-center">
                    <FileCheck2 className="mx-auto size-9 text-muted-foreground/30" />
                    <p className="mt-3 text-sm font-medium text-foreground">
                      No audit or intervention records found.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredAudits.map((record) => (
                      <div key={record.id}>
                        <AuditRow
                          record={record}
                          selected={
                            selected?.kind === "audit" &&
                            selected.record.id === record.id
                          }
                          onClick={() =>
                            setSelected({
                              kind: "audit",
                              record,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* RECORD DETAILS */}
      {selected && !manualState && !editingState && !archiveConfirm && !ocrSession && !previewEvidence && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelected(null)
        }}>
          <div role="dialog" aria-modal="true" aria-label="Authority record details" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-card shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <RecordInspector
              selected={selected}
              evidence={data.evidence}
              rules={rules}
              onClose={() => setSelected(null)}
              onEdit={openEdit}
              onArchive={() => selected && setArchiveConfirm(selected)}
              onRestore={handleRestore}
              onPreview={handlePreviewDocument}
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
          onSave={() => {
            if (manualState.mode === "authority") {
              const saved = saveAuthority(manualState.draft, "Manual")
              if (saved) {
                setManualState(null)
              }
              return
            }

            if (manualState.mode === "safety") {
              saveSafety(manualState.draft, "Manual")
              setManualState(null)
              return
            }

            saveAudit(manualState.draft, "Manual")
            setManualState(null)
          }}
        />
      )}

      {/* EDIT MODAL */}
      {editingState && selected && (
        <ManualModal
          state={editingState}
          profile={profile}
          onChange={setEditingState}
          onCancel={() => setEditingState(null)}
          onSave={() => {
            const editingId = selected.record.id

            if (editingState.mode === "authority") {
              const saved = saveAuthority(
                editingState.draft,
                selected.record.source,
                undefined,
                editingId
              )

              if (saved) {
                setSelected({
                  kind: "authority",
                  record: {
                    ...(selected.record as AuthorityRecord),
                    ...editingState.draft,
                    updatedAt: isoNow(),
                  },
                })
                setEditingState(null)
              }
              return
            }

            if (editingState.mode === "safety") {
              saveSafety(
                editingState.draft,
                selected.record.source,
                undefined,
                editingId
              )

              setSelected({
                kind: "safety",
                record: {
                  ...(selected.record as SafetyRecord),
                  ...editingState.draft,
                  updatedAt: isoNow(),
                },
              })
              setEditingState(null)
              return
            }

            saveAudit(
              editingState.draft,
              selected.record.source,
              undefined,
              editingId
            )

            setSelected({
              kind: "audit",
              record: {
                ...(selected.record as AuditRecord),
                ...editingState.draft,
                updatedAt: isoNow(),
              },
            })
            setEditingState(null)
          }}
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
            </div>

            <div className="flex justify-end gap-2 pt-5">
              <button
                type="button"
                onClick={() => {
                  setArchiveConfirm(null)
                  setArchiveReasonInput("")
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmArchive}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm"
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
            startOCRFile(file, "device")
          }}
        />
      )}

      {/* CAMERA CAPTURE */}
      {showCamera && (
        <CameraCapture
          onClose={() => setShowCamera(false)}
          onCapture={(file) => {
            setShowCamera(false)
            startOCRFile(file, "camera")
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
          onReplace={() => {
            const context =
              ocrSession.mode === "authority"
                ? {
                    mode: "authority" as const,
                    category: ocrSession.authorityDraft!.category,
                    authorityType: ocrSession.authorityDraft!.authorityType,
                  }
                : ocrSession.mode === "safety"
                ? {
                    mode: "safety" as const,
                    safetySystem: ocrSession.safetyDraft!.system,
                  }
                : {
                    mode: "audit" as const,
                  }

            setOcrSession(null)
            setSourceContext(context)
          }}
          onSave={saveOCR}
        />
      )}

      {/* SECURE DOCUMENT PREVIEW */}
      {previewEvidence && (
        <div className="fixed inset-0 z-[170] bg-background">
          <SecureDocumentViewer
            fileName={previewEvidence.fileName}
            mimeType={previewEvidence.mimeType}
            dataUrl={previewEvidence.dataUrl}
            documentTitle="Attached Operating Authority Certificate"
            documentDate={previewEvidence.documentDate}
            ocrConfidence={previewEvidence.ocrConfidence}
            watermarkContext={{
              viewerName: "Safety Director",
              viewerRole: "Compliance Officer",
              companyName: company.name,
              timestamp: isoNow(),
            }}
            onClose={() => setPreviewEvidence(null)}
          />
        </div>
      )}

      {/* DEVICE FILE INPUT */}
      <input
        ref={deviceInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          await startOCRFile(file, "device")
        }}
      />
    </>
  )
}
