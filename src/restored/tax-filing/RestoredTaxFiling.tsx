"use client"

/**
 * The original Tax Filing workspace (tabs Tax Profile / Filing Calendar / Filing Records, applicable program list, profile
 * workspace with frequency history, calendar and filing record forms) restored over the canonical tax-registrations domain and
 * the company-profile TAX applicability rules. Adapted from the pre-cutover page: every browser-storage, audit-logger and
 * cross-store statement was replaced by the canonical adapter. The canonical system has no filing / obligation / frequency /
 * evidence entities, so those controls stay visible and refuse honestly instead of persisting anything.
 */

import React, { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CalendarDays, Landmark, Plus, Receipt, Settings2, Upload } from "lucide-react"

import { CompanyMissing } from "@/components/company-missing"
import { Button } from "@/components/ui/button"
import { CanonicalOperationUnavailableError, userMessage } from "@/lib/canonical-ui/unavailable"
import { TESEvidenceLayout } from "@/src/components/design-system/TESEvidenceLayout"
import { TESStatusRing, type TESStatusTone } from "@/src/components/design-system/TESStatusRing"
import { TESStatusSummaryItem } from "@/src/components/design-system/TESStatusSummaryItem"
import { TESStatusSummaryStrip } from "@/src/components/design-system/TESStatusSummaryStrip"
import { TESTabs, TESTabsList, TESTabsTrigger } from "@/src/components/design-system/TESTabs"
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { LoadingState } from "@/src/components/shared/StateDisplays"
import { TESRecordOverlay } from "@/src/components/shared/TESRecordOverlay"
import { UnsavedChangesPrompt } from "@/src/components/shared/UnsavedChangesPrompt"
import { FilingCalendarWorkspace } from "@/src/components/tax-filing/FilingCalendarWorkspace"
import { FilingRecordForm } from "@/src/components/tax-filing/FilingRecordForm"
import { FilingRecordsWorkspace } from "@/src/components/tax-filing/FilingRecordsWorkspace"
import { TAX_DEFINITIONS } from "@/src/components/tax-filing/tax-definitions"
import { TaxProgramList } from "@/src/components/tax-filing/TaxProgramList"
import { isoNow, todayISO } from "@/src/components/tax-filing/tax-helpers"
import type { FilingObligation, FilingStatus, TaxCode, TaxDefinition } from "@/src/components/tax-filing/types"

import { NO_FILING_DOMAIN, useCanonicalTaxFiling } from "./adapter"
import { TaxProfileWorkspace } from "./TaxProfileWorkspace"
import type { EditMode, RestoredTaxProfile } from "./types"

const getDefinition = (code: TaxCode): TaxDefinition => TAX_DEFINITIONS.find((item) => item.code === code) || TAX_DEFINITIONS[0]

const unavailable = (action: string, reason = NO_FILING_DOMAIN) => new CanonicalOperationUnavailableError(action, reason).message

const EVIDENCE_REQUIRED = "Tax filing evidence is required before this filing record can be saved. Attach the filed return or other filing evidence first."

/** Presentational mapping of a filing status to a ring tone (as in the original). */
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
    default:
      return "neutral"
  }
}

/** The form needs an obligation to label its period; none exists canonically, so it is shown unselected. */
const NO_PERIOD: FilingObligation = {
  id: "no-period",
  taxProfileId: "",
  taxCode: "ifta",
  frequencySnapshot: "not-set",
  reportingPeriodLabel: "No reporting period selected",
  reportingPeriodStart: "",
  reportingPeriodEnd: "",
  nominalDueDate: "",
  dueDate: "—",
  status: "Not Started",
  profileUpdatedAtSnapshot: "",
  createdAt: "",
  updatedAt: "",
}

function newDraft(taxCode: TaxCode): RestoredTaxProfile {
  const now = isoNow()
  return {
    id: `new-${taxCode}`,
    taxCode,
    accountStatus: "Pending",
    // No filing frequency is recorded canonically: never defaulted, shown as "Not set".
    filingFrequency: "not-set",
    frequencyHistory: [],
    effectiveDate: todayISO(),
    closureDate: "",
    verificationSource: "",
    createdAt: now,
    updatedAt: now,
    persisted: false,
  }
}

export default function RestoredTaxFiling({ companyId }: { companyId: string }) {
  const router = useRouter()
  const tax = useCanonicalTaxFiling(companyId)
  const { company, profiles, applicability, state } = tax

  const [activeTab, setActiveTab] = useState<"profiles" | "calendar" | "records">("profiles")
  const [selectedTaxCode, setSelectedTaxCode] = useState<TaxCode | null>(null)
  const [profileDraft, setProfileDraft] = useState<RestoredTaxProfile | null>(null)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [showFrequencyForm, setShowFrequencyForm] = useState(false)
  const [editMode, setEditMode] = useState<EditMode>("change")
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear())
  const [saving, setSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showFilingForm, setShowFilingForm] = useState(false)
  const [filingError, setFilingError] = useState<string | null>(null)

  const profileByCode = (taxCode: TaxCode) => {
    const matches = profiles.filter((item) => item.taxCode === taxCode)
    return matches.find((item) => !item.isArchived) ?? matches[0]
  }

  // After a save or reload, a profile that is not being edited follows the stored canonical record.
  useEffect(() => {
    if (isEditingProfile || !selectedTaxCode) return
    const stored = profiles.find((item) => item.taxCode === selectedTaxCode && !item.isArchived) ?? profiles.find((item) => item.taxCode === selectedTaxCode)
    if (!stored) return
    setProfileDraft((current) => (current && current.id === stored.id && current.updatedAt === stored.updatedAt && current.isArchived === stored.isArchived ? current : { ...stored }))
  }, [profiles, isEditingProfile, selectedTaxCode])

  const applicableDefinitions = useMemo(
    () => TAX_DEFINITIONS.map((definition) => ({ definition, applicability: applicability[definition.code] })),
    [applicability],
  )
  // A program the company holds a registration for is never hidden, whatever its applicability setting says.
  const appliedDefinitions = applicableDefinitions.filter((item) => item.applicability === "applies" || profiles.some((profile) => profile.taxCode === item.definition.code))
  const notConfiguredDefinitions = applicableDefinitions.filter((item) => item.applicability === "not-configured")

  const openProfile = (taxCode: TaxCode) => {
    setProfileError(null)
    setNotice(null)
    const existing = profileByCode(taxCode)
    setSelectedTaxCode(taxCode)
    setShowFrequencyForm(false)
    setEditMode("change")
    if (existing) {
      setProfileDraft({ ...existing })
      setIsEditingProfile(false)
      return
    }
    setProfileDraft(newDraft(taxCode))
    setIsEditingProfile(true)
  }

  const closeProfile = () => {
    setProfileDraft(null)
    setSelectedTaxCode(null)
    setIsEditingProfile(false)
    setShowFrequencyForm(false)
    setProfileError(null)
  }

  const saveProfile = async () => {
    if (!profileDraft) return
    setSaving(true)
    setProfileError(null)
    try {
      await tax.saveProfile(profileDraft, editMode)
      setIsEditingProfile(false)
      setShowFrequencyForm(false)
    } catch (error) {
      setProfileError(userMessage(error, "The tax profile could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  const cancelEdit = () => {
    if (!profileDraft) return
    const stored = profileByCode(profileDraft.taxCode)
    if (stored && stored.persisted) setProfileDraft({ ...stored })
    setProfileError(null)
    setIsEditingProfile(false)
    setShowFrequencyForm(false)
  }

  const lifecycle = async (action: "archive" | "restore") => {
    if (!profileDraft || !profileDraft.persisted) return
    if (action === "archive" && !window.confirm("Archive this registration? It stays in the audit trail and can be restored.")) return
    setProfileError(null)
    try {
      await (action === "archive" ? tax.archive(profileDraft) : tax.restore(profileDraft))
    } catch (error) {
      setProfileError(userMessage(error, "The change could not be saved."))
    }
  }

  const refuse = (action: string, reason?: string) => setNotice(unavailable(action, reason))

  if (state === "loading") return <LoadingState message="Loading tax compliance records..." />
  if (state === "missing") return <CompanyMissing failed={false} />
  if (state === "error") return <CompanyMissing failed />
  if (state === "denied") return <div role="alert" className="p-10 text-center">You are not permitted to view this company's tax registrations.</div>
  if (!company) return <CompanyMissing failed />

  const taxProgramListItems = appliedDefinitions.map(({ definition }) => {
    const profile = profileByCode(definition.code)
    return { definition, profile, accountDisplayValue: profile?.accountNumber || "Not configured" }
  })

  return (
    <>
      <div className="flex flex-col gap-6 pb-12">
        {/* HEADER & OPERATIONAL SUMMARY */}
        <div>
          <CompanyWorkspaceHeader company={{ id: company.id, name: company.name, kind: company.kind || "", status: company.status || "" }} section="Tax Filing" />

          <div className="mt-5">
            <TESStatusSummaryStrip>
              <TESStatusSummaryItem label="Registered Origin" primaryValue={`${company.regCorpState || "Unknown"}, ${company.regCorpCountry || "Unknown"}`} />
              <TESStatusSummaryItem label="Operating Region" primaryValue={company.region || "Not recorded"} />
              <TESStatusSummaryItem label="Applicable Taxes" primaryValue={String(appliedDefinitions.length)} />
              <TESStatusSummaryItem
                label="Tax Applicability"
                tone={notConfiguredDefinitions.length > 0 ? "attention" : "current"}
                primaryValue={notConfiguredDefinitions.length > 0 ? `${notConfiguredDefinitions.length} Not Configured` : "Fully Configured"}
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
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Tax applicability is incomplete</p>
                  <p className="mt-1 text-xs leading-5 text-amber-900/70 dark:text-amber-300/70">
                    {tax.applicabilityKnown
                      ? `${notConfiguredDefinitions.length} tax program${notConfiguredDefinitions.length === 1 ? "" : "s"} still require a Yes / No determination in Company Settings.`
                      : "The company's tax applicability settings could not be read, so no program is assumed to apply. Check Company Settings."}
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

        {notice ? (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {notice}
          </p>
        ) : null}

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
            <TaxProgramList items={taxProgramListItems} selectedTaxCode={selectedTaxCode} onSelectTaxCode={openProfile} onOpenCompanySettings={() => router.push(`/companies/${company.id}/settings`)} />

            <TaxProfileWorkspace
              profile={profileDraft}
              definition={selectedTaxCode ? getDefinition(selectedTaxCode) : null}
              isEditing={isEditingProfile}
              showFrequencyForm={showFrequencyForm}
              calendarYear={calendarYear}
              isPersistedProfile={Boolean(profileDraft?.persisted)}
              documents={[]}
              error={profileError}
              saving={saving}
              editMode={editMode}
              onEditModeChange={setEditMode}
              onCheckNumber={tax.checkNumber}
              onArchive={() => void lifecycle("archive")}
              onRestore={() => void lifecycle("restore")}
              onClose={closeProfile}
              onProfileChange={setProfileDraft}
              onEdit={() => {
                setProfileError(null)
                setIsEditingProfile(true)
              }}
              onCancelEdit={cancelEdit}
              onSaveProfile={() => void saveProfile()}
              onBeginFrequencyChange={() => {
                setIsEditingProfile(true)
                setShowFrequencyForm(true)
              }}
              onCancelFrequencyChange={() => setShowFrequencyForm(false)}
              onSaveFrequencyAssignment={() => {
                setProfileError(unavailable("Saving a filing frequency assignment", "TES does not record a filing frequency for a registration yet, so the assignment was not saved (and nothing is kept in this browser)."))
                setShowFrequencyForm(false)
              }}
              onUploadEvidence={() => refuse("Uploading tax evidence", "tax evidence has no canonical link to a registration yet, so nothing was uploaded or stored in this browser.")}
              onGenerateYear={() => refuse(`Generating ${calendarYear} filing obligations`)}
              onCreateManualPeriod={() => refuse("Creating a manual filing period")}
              onPreviewDocument={() => undefined}
            />
          </div>
        )}

        {/* TAB 2: FILING CALENDAR */}
        {activeTab === "calendar" && (
          <div className="space-y-6">
            <FilingCalendarWorkspace
              calendarYear={calendarYear}
              items={[]}
              selectedObligationId={null}
              onCalendarYearChange={setCalendarYear}
              onUpload={() => refuse("Uploading a filed return", "tax evidence has no canonical link to a filing yet, so nothing was uploaded or stored in this browser.")}
              onGenerateActive={() => refuse("Generating filing obligations")}
              onSelectObligation={() => undefined}
              renderStatus={(status) => <TESStatusRing tone={filingStatusTone(status)} label={status} />}
            />
            <FilingRecordEntry onOpen={() => { setFilingError(null); setShowFilingForm(true) }} />
          </div>
        )}

        {/* TAB 3: FILING RECORDS */}
        {activeTab === "records" && (
          <div className="space-y-6">
            <FilingRecordsWorkspace items={[]} onSelectRecord={() => undefined} />
            <FilingRecordEntry onOpen={() => { setFilingError(null); setShowFilingForm(true) }} />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Unavailable actions (deferred, no canonical PostgreSQL storage yet): filing obligations and the filing calendar, filing frequency history, filing records and amounts, tax evidence upload and preview, verification details and notes, and Form 2290. Tax registrations (account number, jurisdiction, dates, status, history, archive and restore) are saved in the TES database. These controls stay visible and refuse instead of saving anything in the browser.
        </p>
      </div>

      {/* FILING RECORD ENTRY: the original overlay, with its evidence-required rule */}
      {showFilingForm && (
        <TESRecordOverlay
          open
          title="Record Filing Submission"
          subtitle={company.name}
          context="No reporting period is selected: filing obligations are not recorded canonically yet."
          onClose={() => setShowFilingForm(false)}
          ariaLabel="Tax filing period record"
          contentHeight="natural"
          headerTone="neutral"
        >
          <div className="p-5 sm:p-6">
            <TESEvidenceLayout
              evidenceLabel="Period Evidence"
              record={
                <div className="space-y-6">
                  <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-4">
                    <ReadOnlyField label="Period Start" value={undefined} />
                    <ReadOnlyField label="Period End" value={undefined} />
                    <ReadOnlyField label="Nominal Due" value={undefined} />
                    <ReadOnlyField label="Adjusted Due" value={undefined} />
                  </div>
                  <CanonicalUnavailable action="Saving a filing record" reason="filing obligations, filing records and amounts have no canonical PostgreSQL storage yet, so a filing record cannot be saved." />
                  {filingError ? (
                    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                      {filingError}
                    </p>
                  ) : null}
                  <FilingRecordForm
                    obligation={NO_PERIOD}
                    onSave={() => setFilingError(`${EVIDENCE_REQUIRED} ${unavailable("Saving a filing record")}`)}
                    onCancel={() => setShowFilingForm(false)}
                  />
                </div>
              }
              evidence={
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="text-xs font-bold text-amber-900 dark:text-amber-200">Filing Evidence Required</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">Attach the filed return or other filing evidence to complete this record.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => setFilingError(unavailable("Uploading a filed return", "tax evidence has no canonical link to a filing yet, so nothing was uploaded or stored in this browser."))}>
                      <Upload className="size-3.5" /> Upload Filed Return
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setFilingError(unavailable("Adding a supporting document", "tax evidence has no canonical link to a filing yet, so nothing was uploaded or stored in this browser."))}>
                      <Upload className="size-3.5" /> Add Supporting Document
                    </Button>
                  </div>
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No documents attached to this reporting period.</div>
                </div>
              }
            />
          </div>
        </TESRecordOverlay>
      )}

      {/* UNSAVED CHANGES GUARD */}
      <UnsavedChangesPrompt
        hasChanges={isEditingProfile}
        isSaving={saving}
        onSave={() => void saveProfile()}
        onDiscard={() => {
          if (profileDraft) {
            const stored = profileByCode(profileDraft.taxCode)
            if (stored && stored.persisted) setProfileDraft({ ...stored })
            else {
              setProfileDraft(null)
              setSelectedTaxCode(null)
            }
          }
          setProfileError(null)
          setIsEditingProfile(false)
          setShowFrequencyForm(false)
        }}
        message="You have unsaved changes in this tax profile configuration."
      />
    </>
  )
}

/** Entry point to the original filing record form when no obligation can be selected (obligations are not canonical yet). */
function FilingRecordEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-foreground">Record Filing Submission</h4>
          <p className="mt-1 text-xs text-muted-foreground">Return type, method, date, amounts, payment status and confirmation number, with required filing evidence.</p>
        </div>
        <Button type="button" size="sm" onClick={onOpen}>
          <Plus className="size-3.5" /> Record Filing Submission
        </Button>
      </div>
      <div className="mt-3">
        <CanonicalUnavailable action="Filing obligations and filing records" reason="they have no canonical PostgreSQL storage yet, so the calendar and records stay empty and a filing record cannot be saved." />
      </div>
    </div>
  )
}
