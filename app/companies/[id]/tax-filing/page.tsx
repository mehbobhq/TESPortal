"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  FileText,
  Landmark,
  Pencil,
  Plus,
  Receipt,
  Settings2,
  Upload,
  X,
} from "lucide-react"

import { recordAuditEvent } from "@/lib/audit-logger"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer"
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker"
import { UnsavedChangesPrompt } from "@/src/components/shared/UnsavedChangesPrompt"
import { TESRecordOverlay } from "@/src/components/shared/TESRecordOverlay"
import { EmptyState, LoadingState } from "@/src/components/shared/StateDisplays"
import { Button } from "@/components/ui/button"
import { TESStatusRing, type TESStatusTone } from "@/src/components/design-system/TESStatusRing"
import { TESStatusSummaryStrip } from "@/src/components/design-system/TESStatusSummaryStrip"
import { TESStatusSummaryItem } from "@/src/components/design-system/TESStatusSummaryItem"
import { TESTabs, TESTabsList, TESTabsTrigger } from "@/src/components/design-system/TESTabs"
import { TESEvidenceLayout } from "@/src/components/design-system/TESEvidenceLayout"
import { FilingRecordForm } from "@/src/components/tax-filing/FilingRecordForm"
import { TaxProgramList } from "@/src/components/tax-filing/TaxProgramList"
import { TaxProfileWorkspace } from "@/src/components/tax-filing/TaxProfileWorkspace"
import { FilingCalendarWorkspace } from "@/src/components/tax-filing/FilingCalendarWorkspace"
import { FilingRecordsWorkspace } from "@/src/components/tax-filing/FilingRecordsWorkspace"
import type {
  Company,
  RuleValue,
  TaxCode,
  FilingFrequency,
  TaxProfileStatus,
  FilingStatus,
  ReturnType,
  FilingMethod,
  PaymentStatus,
  VerificationSource,
  AssignmentType,
  FrequencyAssignment,
  TaxProfile,
  FilingObligation,
  FilingSubmission,
  TaxDocument,
  TaxData,
  TaxDefinition,
  CompanySettings,
} from "@/src/components/tax-filing/types"
import { TAX_DEFINITIONS } from "@/src/components/tax-filing/tax-definitions"
import {
  isoNow,
  todayISO,
  createId,
  formatFrequency,
} from "@/src/components/tax-filing/tax-helpers"


/* =========================================================
   STORAGE / DEFINITIONS
========================================================= */

const SETTINGS_STORAGE_PREFIX = "tes_company_compliance_settings_"
const TAX_STORAGE_PREFIX = "tes_company_tax_filing_"
const DATA_VERSION = 1

const EMPTY_DATA: TaxData = {
  version: DATA_VERSION,
  profiles: [],
  obligations: [],
  submissions: [],
  documents: [],
}

/* =========================================================
   HELPERS & REUSABLE LOGIC
========================================================= */

function getDefinition(code: TaxCode): TaxDefinition {
  return TAX_DEFINITIONS.find((item) => item.code === code) || TAX_DEFINITIONS[0]
}

function readCompanies(): Company[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCompanies(companies: Company[]) {
  localStorage.setItem("tes_companies", JSON.stringify(companies))
}

function loadCompanySettings(companyId: string): CompanySettings {
  try {
    const raw = localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${companyId}`)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function getTaxApplicability(companyId: string, taxCode: TaxCode): RuleValue {
  const settings = loadCompanySettings(companyId)
  return settings.rules?.[taxCode] ?? "not-configured"
}

function normalizeAccountNumber(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function getCompanyAccountNumber(company: Company, definition: TaxDefinition): string {
  if (!definition.companyField) return ""
  const value = company[definition.companyField]
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

function findGlobalAccountConflict(companyId: string, taxCode: TaxCode, accountNumber: string) {
  const normalized = normalizeAccountNumber(accountNumber)
  if (!normalized) return undefined

  const definition = getDefinition(taxCode)
  const companies = readCompanies()

  for (const otherCompany of companies) {
    if (otherCompany.id === companyId) continue
    const otherValue = getCompanyAccountNumber(otherCompany, definition)
    if (normalizeAccountNumber(otherValue) === normalized) return otherCompany
  }

  for (const otherCompany of companies) {
    if (otherCompany.id === companyId) continue
    const otherData = loadTaxData(otherCompany.id)
    const conflict = otherData.profiles.find(
      (profile) =>
        profile.taxCode === taxCode &&
        profile.accountStatus !== "Closed" &&
        profile.accountStatus !== "Inactive" &&
        normalizeAccountNumber(profile.accountNumber || "") === normalized
    )
    if (conflict) return otherCompany
  }

  return undefined
}

function loadTaxData(companyId: string): TaxData {
  try {
    const raw = localStorage.getItem(`${TAX_STORAGE_PREFIX}${companyId}`)
    if (!raw) return EMPTY_DATA

    const parsed = JSON.parse(raw)
    return {
      ...EMPTY_DATA,
      ...parsed,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      obligations: Array.isArray(parsed.obligations) ? parsed.obligations : [],
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    }
  } catch {
    return EMPTY_DATA
  }
}

function saveTaxData(companyId: string, data: TaxData) {
  localStorage.setItem(`${TAX_STORAGE_PREFIX}${companyId}`, JSON.stringify(data))
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function toISODate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function endOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0)
}

function isWeekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6
}

/*
  Central business-day adjustment.
  Weekend adjustment (rolling forward Saturday/Sunday to Monday).
*/
function adjustToNextBusinessDay(date: Date) {
  const adjusted = new Date(date)
  while (isWeekend(adjusted)) {
    adjusted.setDate(adjusted.getDate() + 1)
  }
  return adjusted
}

function monthlyPeriod(year: number, monthIndex: number) {
  const start = new Date(year, monthIndex, 1)
  const end = endOfMonth(year, monthIndex)
  const nominalDue = endOfMonth(year, monthIndex + 1)
  const due = adjustToNextBusinessDay(nominalDue)

  return {
    label: start.toLocaleString("en-US", { month: "long", year: "numeric" }),
    start: toISODate(start),
    end: toISODate(end),
    nominalDue: toISODate(nominalDue),
    due: toISODate(due),
  }
}

function quarterlyPeriod(year: number, quarter: 1 | 2 | 3 | 4) {
  const startMonth = (quarter - 1) * 3
  const start = new Date(year, startMonth, 1)
  const end = endOfMonth(year, startMonth + 2)

  const dueMonth = startMonth + 3
  const dueYear = year + Math.floor(dueMonth / 12)
  const normalizedDueMonth = dueMonth % 12
  const nominalDue = endOfMonth(dueYear, normalizedDueMonth)
  const due = adjustToNextBusinessDay(nominalDue)

  return {
    label: `Q${quarter} ${year}`,
    start: toISODate(start),
    end: toISODate(end),
    nominalDue: toISODate(nominalDue),
    due: toISODate(due),
  }
}

function annualPeriod(year: number) {
  const start = new Date(year, 0, 1)
  const end = new Date(year, 11, 31)
  const nominalDue = new Date(year + 1, 0, 31)
  const due = adjustToNextBusinessDay(nominalDue)

  return {
    label: `${year}`,
    start: toISODate(start),
    end: toISODate(end),
    nominalDue: toISODate(nominalDue),
    due: toISODate(due),
  }
}

function getCurrentAssignment(profile: TaxProfile) {
  if (profile.frequencyHistory.length === 0) return undefined

  return [...profile.frequencyHistory].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom)
  )[0]
}

function getFrequencyAssignmentForDate(profile: TaxProfile, date: string) {
  return [...profile.frequencyHistory]
    .filter((assignment) => assignment.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
}

function getFrequencyForDate(profile: TaxProfile, date: string) {
  return getFrequencyAssignmentForDate(profile, date)?.frequency || profile.filingFrequency
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/* =========================================================
   MAIN COMPONENT: TaxFilingsPage
========================================================= */

export default function TaxFilingsPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<TaxData>(EMPTY_DATA)
  const [activeTab, setActiveTab] = useState<"profiles" | "calendar" | "records">("profiles")
  const [selectedTaxCode, setSelectedTaxCode] = useState<TaxCode | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<TaxProfile | null>(null)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [showFrequencyForm, setShowFrequencyForm] = useState(false)
  const [selectedObligationId, setSelectedObligationId] = useState<string | null>(null)
  const [editingSubmission, setEditingSubmission] = useState<FilingSubmission | undefined>(undefined)
  const [showFilingForm, setShowFilingForm] = useState(false)
  const [uploadContext, setUploadContext] = useState<{
    documentType: TaxDocument["documentType"]
    taxCode?: TaxCode
    profileId?: string
    obligationId?: string
    submissionId?: string
  } | null>(null)
  const [previewDocument, setPreviewDocument] = useState<TaxDocument | null>(null)
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear())
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const autoGeneratedRef = useRef(false)

  // 1. Initial Data Hydration
  useEffect(() => {
    const found = readCompanies().find((item) => item.id === companyId)
    setCompany(found || null)
    setData(loadTaxData(companyId))
    setLoading(false)
  }, [companyId])

  // 2. Initial Active Profile Generation (once per mount)
  useEffect(() => {
    if (loading || !companyId || autoGeneratedRef.current) return
    autoGeneratedRef.current = true

    const activeProfiles = data.profiles.filter((profile) => profile.accountStatus === "Active")
    const startYear = new Date().getFullYear()
    activeProfiles.forEach((profile) => {
      for (let year = startYear; year <= startYear + 3; year += 1) {
        generateObligations(profile, year)
      }
    })
  }, [loading, companyId, data.profiles])

  const applicableDefinitions = useMemo(
    () =>
      TAX_DEFINITIONS.map((definition) => ({
        definition,
        applicability: getTaxApplicability(companyId, definition.code),
      })),
    [companyId, data]
  )

  const appliedDefinitions = applicableDefinitions.filter(
    (item) => item.applicability === "applies"
  )

  const notConfiguredDefinitions = applicableDefinitions.filter(
    (item) => item.applicability === "not-configured"
  )

  const profileByCode = (taxCode: TaxCode) =>
    data.profiles.find((profile) => profile.taxCode === taxCode)

  const selectedObligation = selectedObligationId
    ? data.obligations.find((item) => item.id === selectedObligationId)
    : undefined

  const submissionsForObligation = (obligationId: string) =>
    data.submissions.filter((item) => item.obligationId === obligationId)

  // Open / Select Tax Profile
  const openProfile = (taxCode: TaxCode) => {
    const definition = getDefinition(taxCode)
    const existing = profileByCode(taxCode)

    if (existing) {
      const canonicalAccount = getCompanyAccountNumber(company || ({} as Company), definition)
      const hydrated: TaxProfile = {
        ...existing,
        accountNumber: canonicalAccount || existing.accountNumber || undefined,
        frequencyHistory: [...existing.frequencyHistory],
      }
      setSelectedProfileId(existing.id)
      setProfileDraft(hydrated)
      setSelectedTaxCode(taxCode)
      setIsEditingProfile(false)
      setShowFrequencyForm(false)
      return
    }

    const now = isoNow()
    const canonicalAccount = getCompanyAccountNumber(company || ({} as Company), definition)
    const initialFrequency: FrequencyAssignment = {
      id: createId("FREQ"),
      frequency: definition.defaultFrequency,
      effectiveFrom: todayISO(),
      assignmentType: "Regulatory Default",
      source: "",
      createdAt: now,
    }
    const draft: TaxProfile = {
      id: createId("TAX"),
      taxCode,
      accountNumber: canonicalAccount || undefined,
      accountStatus: "Pending",
      filingFrequency: definition.defaultFrequency,
      frequencyHistory: [initialFrequency],
      effectiveDate: todayISO(),
      closureDate: "",
      verificationSource: "",
      createdAt: now,
      updatedAt: now,
    }

    setSelectedTaxCode(taxCode)
    setSelectedProfileId(draft.id)
    setProfileDraft(draft)
    setIsEditingProfile(true)
    setShowFrequencyForm(false)
  }

  // Controlled Cross-Store Save with Rollback Protection
  const saveProfile = () => {
    if (!profileDraft) return

    const definition = getDefinition(profileDraft.taxCode)

    // 1. Validate required fields
    if (definition.accountRequired && !profileDraft.accountNumber?.trim()) {
      window.alert(`Account Number is required for ${definition.name}.`)
      return
    }

    // 2. Global Duplicate Collision Check
    const conflict = profileDraft.accountNumber
      ? findGlobalAccountConflict(companyId, profileDraft.taxCode, profileDraft.accountNumber)
      : undefined
    if (conflict) {
      window.alert(
        `This Account Number is already registered to another company (${conflict.name}). The tax profile was not saved to protect global identifier integrity.`
      )
      return
    }

    // 3. Pre-Mutation Snapshots
    const preTaxDataSnapshot = JSON.parse(JSON.stringify(data)) as TaxData
    const preCompaniesSnapshot = readCompanies()
    const preCompanyState = company ? { ...company } : null
    const isNew = !data.profiles.some((p) => p.id === profileDraft.id)
    const previousProfile = data.profiles.find((p) => p.id === profileDraft.id)

    const profileToSave: TaxProfile = {
      ...profileDraft,
      frequencyHistory:
        profileDraft.frequencyHistory.length > 0
          ? profileDraft.frequencyHistory
          : [
              {
                id: createId("FREQ"),
                frequency: profileDraft.filingFrequency,
                effectiveFrom: profileDraft.effectiveDate || todayISO(),
                assignmentType: "Manual Override",
                source: "",
                createdAt: isoNow(),
              },
            ],
      updatedAt: isoNow(),
    }

    const frequencyChanged = previousProfile
      ? JSON.stringify(previousProfile.frequencyHistory) !== JSON.stringify(profileToSave.frequencyHistory)
      : false

    try {
      // 4. Update Tax Store
      const updatedProfiles = isNew
        ? [profileToSave, ...data.profiles]
        : data.profiles.map((p) => (p.id === profileToSave.id ? profileToSave : p))
      const nextTaxData: TaxData = { ...data, profiles: updatedProfiles }
      saveTaxData(companyId, nextTaxData)

      // 5. Synchronize Mapped Company Master Account Field
      if (definition.companyField) {
        const nextCompanies = preCompaniesSnapshot.map((item) =>
          item.id === companyId
            ? { ...item, [definition.companyField!]: (profileToSave.accountNumber || "").trim() }
            : item
        )
        writeCompanies(nextCompanies)
      }

      // 6. Record Audit Event (Only after both storage operations succeed)
      recordAuditEvent({
        companyId,
        actor: "",
        role: "",
        entityType: "TaxFiling",
        entityId: profileToSave.id,
        action: isNew ? "CREATE" : "UPDATE",
        details: `${isNew ? "Created" : "Updated"} tax profile for ${definition.shortName} (${profileToSave.accountStatus}, Account: ${profileToSave.accountNumber || "None"})${frequencyChanged ? " [Filing frequency history updated]" : ""}`,
        oldValue: previousProfile
          ? JSON.stringify({
              taxCode: previousProfile.taxCode,
              accountNumber: previousProfile.accountNumber,
              accountStatus: previousProfile.accountStatus,
              filingFrequency: previousProfile.filingFrequency,
              frequencyHistory: previousProfile.frequencyHistory,
            })
          : undefined,
        newValue: JSON.stringify({
          taxCode: profileToSave.taxCode,
          accountNumber: profileToSave.accountNumber,
          accountStatus: profileToSave.accountStatus,
          filingFrequency: profileToSave.filingFrequency,
          frequencyHistory: profileToSave.frequencyHistory,
        }),
      })

      // 7. Commit React UI State
      setData(nextTaxData)
      if (company && definition.companyField) {
        setCompany({ ...company, [definition.companyField]: profileToSave.accountNumber || "" })
      }
      setSelectedProfileId(profileToSave.id)
      setProfileDraft(profileToSave)
      setIsEditingProfile(false)

      if (profileToSave.accountStatus === "Active") {
        generateObligations(profileToSave, new Date().getFullYear())
      }
    } catch (err) {
      // Rollback on any failure
      saveTaxData(companyId, preTaxDataSnapshot)
      writeCompanies(preCompaniesSnapshot)
      setData(preTaxDataSnapshot)
      setCompany(preCompanyState)
      window.alert("Failed to save tax profile due to a storage error. Changes were rolled back.")
    }
  }

  // Add Effective-Dated Frequency Assignment (Draft operation - persisted on saveProfile)
  const addFrequencyAssignment = (assignment: FrequencyAssignment) => {
    if (!profileDraft) return

    const history = [...profileDraft.frequencyHistory]
    if (history.some((item) => item.effectiveFrom === assignment.effectiveFrom)) {
      window.alert("A frequency assignment already exists for this effective date.")
      return
    }

    const previous = [...history]
      .filter((item) => item.effectiveFrom < assignment.effectiveFrom)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

    if (previous && !previous.effectiveTo) {
      const dayBefore = parseDate(assignment.effectiveFrom)
      dayBefore.setDate(dayBefore.getDate() - 1)
      previous.effectiveTo = toISODate(dayBefore)
    }

    const updatedProfile: TaxProfile = {
      ...profileDraft,
      filingFrequency: assignment.frequency,
      frequencyHistory: [...history, assignment],
      updatedAt: isoNow(),
    }

    setProfileDraft(updatedProfile)
    setShowFrequencyForm(false)
  }

  // Obligation Generation (Respects Effective Dating and Avoids Duplicates - Persist First)
  const generateObligations = (profile: TaxProfile, year: number) => {
    if (profile.accountStatus === "Closed" || profile.accountStatus === "Inactive") return

    const candidates: {
      label: string
      start: string
      end: string
      nominalDue: string
      due: string
      frequency: FilingFrequency
      assignmentId?: string
    }[] = []

    const effective = profile.effectiveDate || ""
    const closure = profile.closureDate || ""

    const addPeriod = (
      period: { label: string; start: string; end: string; nominalDue: string; due: string },
      frequency: FilingFrequency
    ) => {
      if (effective && period.end < effective) return
      if (closure && period.start > closure) return
      const assignment = getFrequencyAssignmentForDate(profile, period.start)
      candidates.push({ ...period, frequency, assignmentId: assignment?.id })
    }

    // Monthly evaluation across 12 months
    for (let month = 0; month < 12; month++) {
      const monthStart = toISODate(new Date(year, month, 1))
      const frequency = getFrequencyForDate(profile, monthStart)
      if (frequency === "monthly") addPeriod(monthlyPeriod(year, month), frequency)
    }

    // Quarterly evaluation
    ;([1, 2, 3, 4] as const).forEach((quarter) => {
      const quarterStart = toISODate(new Date(year, (quarter - 1) * 3, 1))
      const frequency = getFrequencyForDate(profile, quarterStart)
      if (frequency === "quarterly") addPeriod(quarterlyPeriod(year, quarter), frequency)
    })

    // Annual evaluation
    const annualFrequency = getFrequencyForDate(profile, `${year}-01-01`)
    if (annualFrequency === "annual") addPeriod(annualPeriod(year), annualFrequency)

    const currentTaxData = loadTaxData(companyId)
    const existingKeys = new Set(
      currentTaxData.obligations
        .filter((item) => item.taxProfileId === profile.id)
        .map((item) => `${item.reportingPeriodStart}|${item.reportingPeriodEnd}`)
    )

    const now = isoNow()
    const newItems = candidates
      .filter((period) => !existingKeys.has(`${period.start}|${period.end}`))
      .map(
        (period): FilingObligation => ({
          id: createId("OBL"),
          taxProfileId: profile.id,
          taxCode: profile.taxCode,
          frequencySnapshot: period.frequency,
          reportingPeriodLabel: period.label,
          reportingPeriodStart: period.start,
          reportingPeriodEnd: period.end,
          nominalDueDate: period.nominalDue,
          dueDate: period.due,
          status: "Not Started",
          profileUpdatedAtSnapshot: profile.updatedAt,
          frequencyAssignmentId: period.assignmentId,
          createdAt: now,
          updatedAt: now,
        })
      )

    if (newItems.length === 0) return

    const nextTaxData: TaxData = {
      ...currentTaxData,
      obligations: [...newItems, ...currentTaxData.obligations],
    }

    try {
      saveTaxData(companyId, nextTaxData)
      setData(nextTaxData)

      // Audit only newly created and successfully persisted obligations
      newItems.forEach((obl) => {
        recordAuditEvent({
          companyId,
          actor: "",
          role: "",
          entityType: "TaxFiling",
          entityId: obl.id,
          action: "CREATE",
          details: `Generated filing obligation for ${obl.taxCode.toUpperCase()} (${obl.reportingPeriodLabel}, Due: ${obl.dueDate})`,
        })
      })
    } catch (err) {
      window.alert("Failed to save generated obligations due to a storage error.")
    }
  }

  // Create Manual Obligation (Persist First)
  const createManualObligation = (profile: TaxProfile) => {
    const start = window.prompt("Reporting period start (YYYY-MM-DD):")
    if (!start) return
    const end = window.prompt("Reporting period end (YYYY-MM-DD):")
    if (!end) return
    const due = window.prompt("Due date (YYYY-MM-DD):")
    if (!due) return
    const label = window.prompt("Reporting period label:", `${start} – ${end}`) || `${start} – ${end}`

    const now = isoNow()
    const currentAssignment = getCurrentAssignment(profile)

    const obligation: FilingObligation = {
      id: createId("OBL"),
      taxProfileId: profile.id,
      taxCode: profile.taxCode,
      frequencySnapshot: profile.filingFrequency,
      reportingPeriodLabel: label,
      reportingPeriodStart: start,
      reportingPeriodEnd: end,
      nominalDueDate: due,
      dueDate: due,
      status: "Not Started",
      profileUpdatedAtSnapshot: profile.updatedAt,
      frequencyAssignmentId: currentAssignment?.id,
      createdAt: now,
      updatedAt: now,
    }

    const currentTaxData = loadTaxData(companyId)
    const nextTaxData: TaxData = {
      ...currentTaxData,
      obligations: [obligation, ...currentTaxData.obligations],
    }

    try {
      saveTaxData(companyId, nextTaxData)
      setData(nextTaxData)

      recordAuditEvent({
        companyId,
        actor: "",
        role: "",
        entityType: "TaxFiling",
        entityId: obligation.id,
        action: "CREATE",
        details: `Manually created tax filing obligation ${obligation.reportingPeriodLabel} for ${profile.taxCode.toUpperCase()}`,
      })
    } catch (err) {
      window.alert("Failed to save manual obligation due to a storage error.")
    }
  }

  // Save / Update Submission (Persist First)
  const saveSubmission = (submission: FilingSubmission) => {
    const currentTaxData = loadTaxData(companyId)
    const isNew = !currentTaxData.submissions.some((item) => item.id === submission.id)
    const previousSubmission = currentTaxData.submissions.find((item) => item.id === submission.id)

    const hasFilingEvidence = currentTaxData.documents.some(
      (document) =>
        document.obligationId === submission.obligationId ||
        document.submissionId === submission.id
    )

    if (!hasFilingEvidence) {
      window.alert(
        "Tax filing evidence is required before this filing record can be saved. Attach the filed return or other filing evidence first."
      )
      return
    }

    const nextSubmissions = isNew
      ? [submission, ...currentTaxData.submissions]
      : currentTaxData.submissions.map((item) => (item.id === submission.id ? submission : item))

    const nextObligations = currentTaxData.obligations.map((obligation) => {
      if (obligation.id !== submission.obligationId) return obligation

      let status: FilingStatus = obligation.status

      if (submission.returnType === "No Return Required") {
        status = "No Return Required"
      } else if (
        submission.filingDate &&
        (submission.paymentStatus === "Paid" ||
          submission.paymentStatus === "Not Applicable" ||
          submission.paymentStatus === "Refund")
      ) {
        status = "Completed"
      } else if (submission.filingDate) {
        status = "Payment Pending"
      }

      return { ...obligation, status, updatedAt: isoNow() }
    })

    const nextTaxData: TaxData = {
      ...currentTaxData,
      submissions: nextSubmissions,
      obligations: nextObligations,
    }

    try {
      saveTaxData(companyId, nextTaxData)
      setData(nextTaxData)

      recordAuditEvent({
        companyId,
        actor: "",
        role: "",
        entityType: "TaxFiling",
        entityId: submission.id,
        action: isNew ? "CREATE" : "UPDATE",
        details: `${isNew ? "Recorded" : "Updated"} filing submission for obligation ${submission.obligationId} (${submission.returnType}, ${submission.filingMethod}, Status: ${submission.paymentStatus})`,
        oldValue: previousSubmission
          ? JSON.stringify({
              returnType: previousSubmission.returnType,
              filingDate: previousSubmission.filingDate,
              amountDue: previousSubmission.amountDue,
              amountPaid: previousSubmission.amountPaid,
              confirmationNumber: previousSubmission.confirmationNumber,
              paymentStatus: previousSubmission.paymentStatus,
              filingMethod: previousSubmission.filingMethod,
            })
          : undefined,
        newValue: JSON.stringify({
          returnType: submission.returnType,
          filingDate: submission.filingDate,
          amountDue: submission.amountDue,
          amountPaid: submission.amountPaid,
          confirmationNumber: submission.confirmationNumber,
          paymentStatus: submission.paymentStatus,
          filingMethod: submission.filingMethod,
        }),
      })

      setShowFilingForm(false)
      setEditingSubmission(undefined)

      const savedObligation = nextTaxData.obligations.find(
        (item) => item.id === submission.obligationId
      )
      const savedProfile = savedObligation
        ? nextTaxData.profiles.find((profile) => profile.id === savedObligation.taxProfileId)
        : undefined
      if (savedObligation && savedProfile) {
        const periodYear = Number(savedObligation.reportingPeriodStart.slice(0, 4))
        generateObligations(savedProfile, periodYear + 1)
      }
    } catch (err) {
      window.alert("Failed to save filing submission due to a storage error.")
    }
  }

  // Handle Document Ingestion (via DocumentSourcePicker - Persist First)
  const handleSelectFile = async (file: File) => {
    if (!uploadContext) return

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const document: TaxDocument = {
        id: createId("DOC"),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl,
        documentType: uploadContext.documentType,
        taxCode: uploadContext.taxCode,
        profileId: uploadContext.profileId,
        obligationId: uploadContext.obligationId,
        submissionId: uploadContext.submissionId,
        documentDate: todayISO(),
        uploadedAt: isoNow(),
      }

      const currentTaxData = loadTaxData(companyId)
      const nextTaxData: TaxData = {
        ...currentTaxData,
        documents: [document, ...currentTaxData.documents],
      }

      saveTaxData(companyId, nextTaxData)
      setData(nextTaxData)

      recordAuditEvent({
        companyId,
        actor: "",
        role: "",
        entityType: "Evidence",
        entityId: document.id,
        evidenceId: document.id,
        action: "CREATE",
        details: `Attached tax evidence document "${document.fileName}" (${document.documentType}) for ${document.taxCode || "Tax Filing"}`,
      })

      setUploadContext(null)
      setSourcePickerOpen(false)
    } catch (err) {
      window.alert("Failed to attach evidence document due to a storage or file reading error.")
    }
  }

  const startUpload = (context: typeof uploadContext) => {
    setUploadContext(context)
    setSourcePickerOpen(true)
  }

  const displayedObligations = useMemo(
    () => [...data.obligations].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data.obligations]
  )

  const getDisplayStatus = (obligation: FilingObligation): FilingStatus => {
    if (obligation.status === "Completed" || obligation.status === "No Return Required") {
      return obligation.status
    }
    return obligation.dueDate < todayISO() ? "Overdue" : obligation.status
  }

  // Presentational mapping of the existing FilingStatus value (from getDisplayStatus, unchanged) to a ring tone.
  const filingStatusTone = (status: FilingStatus): TESStatusTone => {
    switch (status) {
      case "Completed":
        return "current"
      case "Filed":
      case "Payment Pending":
      case "Ready to File":
      case "Awaiting Data":
        return "attention"
      case "Overdue":
        return "critical"
      case "No Return Required":
      default:
        return "neutral"
    }
  }

  const statusBadge = (status: FilingStatus) => (
    <TESStatusRing tone={filingStatusTone(status)} label={status} />
  )

  const obligationHasFiledRecord = (obligationId: string) =>
    data.submissions.some((submission) => submission.obligationId === obligationId) &&
    data.documents.some((document) => document.obligationId === obligationId)

  const filingCalendarItems = displayedObligations
    .filter((obligation) => !obligationHasFiledRecord(obligation.id))
    .map((obligation) => ({
      obligation,
      definition: getDefinition(obligation.taxCode),
      status: getDisplayStatus(obligation),
      submissionCount: 0,
    }))

  const filingRecordItems = displayedObligations
    .filter((obligation) => obligationHasFiledRecord(obligation.id))
    .flatMap((obligation) => {
      const submissions = submissionsForObligation(obligation.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      const submission = submissions[0]
      if (!submission) return []
      return [{
        submission,
        obligation,
        definition: getDefinition(obligation.taxCode),
      }]
    })


  if (loading) {
    return <LoadingState message="Loading tax compliance records..." />
  }

  if (!company) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Building2 className="size-10 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold text-foreground">Company Not Found</h2>
        <Button type="button" variant="outline" onClick={() => router.push("/companies")}>
          <ArrowLeft className="size-4" /> Return to Companies
        </Button>
      </div>
    )
  }

  const taxProgramListItems = appliedDefinitions.map(({ definition }) => {
    const profile = profileByCode(definition.code)

    return {
      definition,
      profile,
      accountDisplayValue:
        getCompanyAccountNumber(company, definition) ||
        profile?.accountNumber ||
        "Not configured",
    }
  })

  return (
    <>
      <div className="flex flex-col gap-6 pb-12">
        {/* HEADER & OPERATIONAL SUMMARY */}
        <div>
          <CompanyWorkspaceHeader
            company={{ id: company.id, name: company.name, kind: company.kind || "", status: company.status || "" }}
            section="Tax Filing"
          />

          <div className="mt-5">
            <TESStatusSummaryStrip>
              <TESStatusSummaryItem
                label="Registered Origin"
                primaryValue={`${company.regCorpState || "Unknown"}, ${company.regCorpCountry || "Unknown"}`}
              />
              <TESStatusSummaryItem
                label="Operating Region"
                primaryValue={company.region || "Not recorded"}
              />
              <TESStatusSummaryItem
                label="Applicable Taxes"
                primaryValue={String(appliedDefinitions.length)}
              />
              <TESStatusSummaryItem
                label="Tax Applicability"
                tone={notConfiguredDefinitions.length > 0 ? "attention" : "current"}
                primaryValue={
                  notConfiguredDefinitions.length > 0
                    ? `${notConfiguredDefinitions.length} Not Configured`
                    : "Fully Configured"
                }
                secondaryValue={notConfiguredDefinitions.length > 0 ? "Action required in Company Settings" : undefined}
              />
            </TESStatusSummaryStrip>
          </div>
        </div>

        {/* INCOMPLETE APPLICABILITY WARNING */}
        {notConfiguredDefinitions.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-xs dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Tax applicability is incomplete
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-900/70 dark:text-amber-300/70">
                    {notConfiguredDefinitions.length} tax program
                    {notConfiguredDefinitions.length === 1 ? "" : "s"} still require a Yes / No determination in Company Settings.
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push(`/companies/${company.id}/settings`)}
                className="shrink-0 border-amber-300 bg-amber-100/50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              >
                <Settings2 className="size-3.5" /> Company Settings
              </Button>
            </div>
          </div>
        )}

        {/* TABS */}
        <TESTabs value={activeTab} onValueChange={(value) => setActiveTab(value as "profiles" | "calendar" | "records")}>
          <TESTabsList>
            <TESTabsTrigger value="profiles">
              <Landmark className="size-4" /> Tax Profile
            </TESTabsTrigger>
            <TESTabsTrigger value="calendar">
              <CalendarDays className="size-4" /> Filing Calendar
            </TESTabsTrigger>
            <TESTabsTrigger value="records">
              <Receipt className="size-4" /> Filing Records
            </TESTabsTrigger>
          </TESTabsList>
        </TESTabs>

        {/* TAB 1: TAX PROFILE */}
        {activeTab === "profiles" && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_640px]">
            <TaxProgramList
              items={taxProgramListItems}
              selectedTaxCode={selectedTaxCode}
              onSelectTaxCode={openProfile}
              onOpenCompanySettings={() =>
                router.push(`/companies/${company.id}/settings`)
              }
            />

            <TaxProfileWorkspace
              profile={profileDraft}
              definition={selectedTaxCode ? getDefinition(selectedTaxCode) : null}
              isEditing={isEditingProfile}
              showFrequencyForm={showFrequencyForm}
              calendarYear={calendarYear}
              isPersistedProfile={
                !!profileDraft &&
                data.profiles.some((profile) => profile.id === profileDraft.id)
              }
              documents={
                profileDraft
                  ? data.documents.filter(
                      (document) => document.profileId === profileDraft.id
                    )
                  : []
              }
              onClose={() => {
                setProfileDraft(null)
                setSelectedTaxCode(null)
                setSelectedProfileId(null)
                setIsEditingProfile(false)
                setShowFrequencyForm(false)
              }}
              onProfileChange={setProfileDraft}
              onEdit={() => setIsEditingProfile(true)}
              onCancelEdit={() => {
                if (!profileDraft) return
                const stored = data.profiles.find((profile) => profile.id === profileDraft.id)
                if (stored) {
                  setProfileDraft({
                    ...stored,
                    frequencyHistory: [...stored.frequencyHistory],
                  })
                }
                setIsEditingProfile(false)
                setShowFrequencyForm(false)
              }}
              onSaveProfile={saveProfile}
              onBeginFrequencyChange={() => {
                setIsEditingProfile(true)
                setShowFrequencyForm(true)
              }}
              onCancelFrequencyChange={() => setShowFrequencyForm(false)}
              onSaveFrequencyAssignment={addFrequencyAssignment}
              onUploadEvidence={() => {
                if (!profileDraft) return
                startUpload({
                  documentType: "Registration",
                  taxCode: profileDraft.taxCode,
                  profileId: profileDraft.id,
                })
              }}
              onGenerateYear={() => {
                if (profileDraft) generateObligations(profileDraft, calendarYear)
              }}
              onCreateManualPeriod={() => {
                if (profileDraft) createManualObligation(profileDraft)
              }}
              onPreviewDocument={setPreviewDocument}
            />
          </div>
        )}

        {/* TAB 2: FILING CALENDAR */}
        {activeTab === "calendar" && (
          <div className="space-y-6">
            <FilingCalendarWorkspace
              calendarYear={calendarYear}
              items={filingCalendarItems}
              selectedObligationId={selectedObligationId}
              onCalendarYearChange={setCalendarYear}
              onUpload={() =>
                startUpload({
                  documentType: "Return",
                })
              }
              onGenerateActive={() =>
                data.profiles
                  .filter((profile) => profile.accountStatus === "Active")
                  .forEach((profile) => {
                    for (let year = calendarYear; year <= calendarYear + 3; year += 1) {
                      generateObligations(profile, year)
                    }
                  })
              }
              onSelectObligation={(obligationId) => {
                setSelectedObligationId(obligationId)
                setShowFilingForm(false)
              }}
              renderStatus={statusBadge}
            />

            {/* FILING PERIOD RECORD OVERLAY */}
            {selectedObligation && (
              <TESRecordOverlay
                open={true}
                title={getDefinition(selectedObligation.taxCode).name}
                subtitle={company.name}
                context={`${selectedObligation.reportingPeriodLabel} · Due ${selectedObligation.dueDate} · ${formatFrequency(selectedObligation.frequencySnapshot)}`}
                onClose={() => {
                  setSelectedObligationId(null)
                  setShowFilingForm(false)
                  setEditingSubmission(undefined)
                }}
                closeOnBackdrop={!showFilingForm}
                ariaLabel="Tax filing period record"
                contentHeight="natural"
              >
                <div className="p-5 sm:p-6">
                <TESEvidenceLayout
                  evidenceLabel="Period Evidence"
                  record={
                <div className="space-y-6">

                  <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-4">
                    <ReadOnlyField
                      label="Period Start"
                      value={selectedObligation.reportingPeriodStart}
                    />
                    <ReadOnlyField
                      label="Period End"
                      value={selectedObligation.reportingPeriodEnd}
                    />
                    <ReadOnlyField
                      label="Nominal Due"
                      value={selectedObligation.nominalDueDate}
                    />
                    <ReadOnlyField
                      label="Adjusted Due"
                      value={selectedObligation.dueDate}
                    />
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                    Frequency snapshot: <span className="font-semibold text-foreground">{formatFrequency(selectedObligation.frequencySnapshot)}</span>. Historical reporting requirements remain permanently preserved.
                  </div>

                  {data.documents.filter(
                    (document) => document.obligationId === selectedObligation.id
                  ).length === 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                            Filing Evidence Required
                          </p>
                          <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
                            Attach the filed return or other filing evidence to complete this tax filing record.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            startUpload({
                              taxProfileId: selectedObligation.taxProfileId,
                              obligationId: selectedObligation.id,
                              documentType: "Return",
                            })
                          }
                          className="shrink-0 border-amber-300 hover:bg-amber-100/60 dark:border-amber-700 dark:hover:bg-amber-950/60"
                        >
                          <Upload className="size-3.5" /> Upload Evidence
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                      <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                        Filing Evidence Attached
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {submissionsForObligation(selectedObligation.id).length === 0 && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setEditingSubmission(undefined)
                          setShowFilingForm(true)
                        }}
                      >
                        <Plus className="size-3.5" /> Record Filing Submission
                      </Button>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startUpload({
                          documentType: "Supporting Document",
                          taxCode: selectedObligation.taxCode,
                          obligationId: selectedObligation.id,
                        })
                      }
                    >
                      <Upload className="size-3.5" /> Attach Evidence
                    </Button>
                  </div>

                  {showFilingForm && (
                    <FilingRecordForm
                      obligation={selectedObligation}
                      existingSubmission={editingSubmission}
                      onSave={saveSubmission}
                      onCancel={() => {
                        setShowFilingForm(false)
                        setEditingSubmission(undefined)
                      }}
                    />
                  )}

                  {/* SUBMISSION HISTORY */}
                  <div className="border-t border-border/60 pt-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Submission History
                    </p>
                    <div className="mt-3 space-y-3">
                      {submissionsForObligation(selectedObligation.id).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                          No filing submission recorded for this obligation.
                        </div>
                      ) : (
                        submissionsForObligation(selectedObligation.id).map((submission) => (
                          <div key={submission.id} className="rounded-xl border border-border bg-card p-4 shadow-2xs">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold text-foreground">{submission.returnType}</p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  {submission.filingMethod}{submission.filingDate ? ` · Filed ${submission.filingDate}` : ""}
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground">
                                  {submission.paymentStatus}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => {
                                    setEditingSubmission(submission)
                                    setShowFilingForm(true)
                                  }}
                                  aria-label="Edit submission"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <ReadOnlyField
                                label="Amount Due"
                                value={submission.amountDue}
                              />
                              <ReadOnlyField
                                label="Amount Paid"
                                value={submission.amountPaid}
                              />
                              <ReadOnlyField
                                label="Confirmation Reference"
                                value={submission.confirmationNumber}
                                mono
                                copyable
                              />
                            </div>

                            <div className="mt-3 flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  startUpload({
                                    documentType: "Filing Receipt",
                                    taxCode: selectedObligation.taxCode,
                                    obligationId: selectedObligation.id,
                                    submissionId: submission.id,
                                  })
                                }
                              >
                                <Upload className="size-3" /> Filing Receipt
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  startUpload({
                                    documentType: "Payment Receipt",
                                    taxCode: selectedObligation.taxCode,
                                    obligationId: selectedObligation.id,
                                    submissionId: submission.id,
                                  })
                                }
                              >
                                <Upload className="size-3" /> Payment Receipt
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                  }
                  evidence={
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Attached Period Evidence
                      </p>
                      <div className="mt-3 space-y-2">
                        {data.documents.filter((doc) => doc.obligationId === selectedObligation.id).length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                            No documents attached to this reporting period.
                          </div>
                        ) : (
                          data.documents
                            .filter((doc) => doc.obligationId === selectedObligation.id)
                            .map((doc) => (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() => setPreviewDocument(doc)}
                                className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted/30"
                              >
                                <FileText className="mt-0.5 size-4 text-primary shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-semibold text-foreground">{doc.fileName}</p>
                                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                                    {doc.documentType} · {doc.documentDate || doc.uploadedAt.slice(0, 10)}
                                  </p>
                                </div>
                              </button>
                            ))
                        )}
                      </div>
                    </div>
                  }
                />
                </div>
              </TESRecordOverlay>
            )}
          </div>
        )}

        {/* TAB 3: FILING RECORDS */}
        {activeTab === "records" && (
          <FilingRecordsWorkspace
            items={filingRecordItems}
            onSelectRecord={(obligationId) => {
              setActiveTab("calendar")
              setSelectedObligationId(obligationId)
              setShowFilingForm(false)
              setEditingSubmission(undefined)
            }}
          />
        )}
      </div>

      {/* SHARED FOUNDATION: DOCUMENT SOURCE PICKER */}
      <div className="relative z-[250]">
        <DocumentSourcePicker
          isOpen={sourcePickerOpen}
          onClose={() => setSourcePickerOpen(false)}
          onSelectFile={handleSelectFile}
        onSelectCamera={() => {
          setSourcePickerOpen(false)
        }}
        title={`Attach Tax Evidence (${uploadContext?.documentType || "Document"})`}
        subtitle="Select document file for secure compliance archive attachment."
          allowedExtensions={[".pdf", ".jpg", ".jpeg", ".png", ".webp"]}
        />
      </div>

      {/* SHARED FOUNDATION: SECURE DOCUMENT VIEWER
          Evidence opened from a Record Overlay must sit above that overlay. */}
      {previewDocument && (
        <div className="relative z-[300]">
          <SecureDocumentViewer
            fileName={previewDocument.fileName}
            mimeType={previewDocument.mimeType}
            dataUrl={previewDocument.dataUrl}
            documentTitle={`Tax Evidence: ${previewDocument.fileName}`}
            documentDate={previewDocument.documentDate || previewDocument.uploadedAt.slice(0, 10)}
            companyName={company.name}
            companyId={company.id}
            auditEventId={previewDocument.id}
            onClose={() => setPreviewDocument(null)}
          />
        </div>
      )}

      {/* UNSAVED CHANGES GUARD */}
      <UnsavedChangesPrompt
        hasChanges={isEditingProfile}
        onSave={saveProfile}
        onDiscard={() => {
          if (profileDraft) {
            const stored = data.profiles.find((p) => p.id === profileDraft.id)
            if (stored) {
              setProfileDraft({ ...stored, frequencyHistory: [...stored.frequencyHistory] })
            } else {
              setProfileDraft(null)
              setSelectedTaxCode(null)
              setSelectedProfileId(null)
            }
          }
          setIsEditingProfile(false)
          setShowFrequencyForm(false)
        }}
        message="You have unsaved changes in this tax profile configuration."
      />
    </>
  )
}
