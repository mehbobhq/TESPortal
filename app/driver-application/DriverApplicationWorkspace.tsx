"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import DriverApplicationShell, {
  DRIVER_APPLICATION_STEPS,
  driverApplicationStepHref,
  type DriverApplicationStepId,
} from "./DriverApplicationShell"
import type { DriverApplicationCompanyContact } from "./DriverApplicationBrandHeader"
import { DriverDateInput } from "@/src/components/drivers/DriverDateInput"
import {
  browserApplicantApplicationStore,
  createEmptyApplicantDraft,
  type ApplicantApplicationDraft,
  type ApplicantDraftEnvelope,
  type ApplicantFileSelection,
  type ApplicantSaveState,
  type ApplicantSubmittedSnapshot,
} from "./applicant-application-store"


function fileSelection(file?: File): ApplicantFileSelection | undefined {
  return file ? { name: file.name, type: file.type, size: file.size } : undefined
}

function FileEvidenceField({
  label,
  hint,
  accept,
  cameraFacing,
  value,
  onChange,
}: {
  label: string
  hint: string
  accept: string
  cameraFacing?: "user" | "environment"
  value?: ApplicantFileSelection
  onChange: (file?: File) => void
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const [cameraOpen, setCameraOpen] = React.useState(false)
  const [cameraError, setCameraError] = React.useState<string | null>(null)

  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOpen(false)
  }, [])

  React.useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  const openCamera = async () => {
    setCameraError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported by this browser. Please use Upload Photo.")
      return
    }

    try {
      streamRef.current?.getTracks().forEach((track) => track.stop())

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: cameraFacing } },
          audio: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
      }

      streamRef.current = stream
      setCameraOpen(true)

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
    } catch {
      setCameraOpen(false)
      setCameraError("TES could not access the camera. Allow camera permission and try again, or use Upload Photo.")
    }
  }

  const capturePhoto = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("The camera is still starting. Please try again.")
      return
    }

    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const context = canvas.getContext("2d")
    if (!context) {
      setCameraError("TES could not capture this image. Please try again.")
      return
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("TES could not capture this image. Please try again.")
          return
        }

        const file = new File(
          [blob],
          `tes-camera-${Date.now()}.jpg`,
          { type: "image/jpeg", lastModified: Date.now() },
        )

        onChange(file)
        stopCamera()
      },
      "image/jpeg",
      0.92,
    )
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-[#E5E7EB] bg-white p-4 sm:p-5">
      <div className="text-sm font-semibold text-[#111827]">{label}</div>
      <div className="mt-1 min-h-[40px] text-xs leading-5 text-[#6B7280]">{hint}</div>

      <div className="mt-4 flex flex-col gap-2 min-[430px]:flex-row">
        {cameraFacing ? (
          <button
            type="button"
            onClick={() => void openCamera()}
            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg bg-[#1457F5] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0F4BDC]"
          >
            Camera Capture
          </button>
        ) : null}

        <label className="inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#374151] transition hover:bg-[#F9FAFB]">
          Upload Photo
          <input
            type="file"
            accept={accept}
            onChange={(event) => onChange(event.target.files?.[0])}
            className="sr-only"
          />
        </label>
      </div>

      {cameraOpen ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-[#CBD5E1] bg-[#0F172A]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="aspect-[4/3] w-full bg-black object-cover"
          />
          <div className="flex flex-col gap-2 bg-white p-3 min-[430px]:flex-row">
            <button
              type="button"
              onClick={capturePhoto}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg bg-[#1457F5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F4BDC]"
            >
              Capture Photo
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {cameraError ? (
        <div className="mt-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs leading-5 text-[#991B1B]">
          {cameraError}
        </div>
      ) : null}

      {value ? (
        <span className="mt-3 block break-all text-xs font-medium text-[#166534]">
          Selected: {value.name}
        </span>
      ) : null}
    </div>
  )
}

const CANADIAN_PROVINCES_TERRITORIES = ["Alberta","British Columbia","Manitoba","New Brunswick","Newfoundland and Labrador","Northwest Territories","Nova Scotia","Nunavut","Ontario","Prince Edward Island","Quebec","Saskatchewan","Yukon"] as const
const US_STATES_DC = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"] as const

function JurisdictionSelect({ value, onChange, className, required }: { value: string; onChange: (value: string) => void; className: string; required?: boolean }) {
  return <select className={className} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
    <option value="">Select province / state</option>
    <optgroup label="Canada">{CANADIAN_PROVINCES_TERRITORIES.map((item) => <option key={item} value={item}>{item}</option>)}</optgroup>
    <optgroup label="United States">{US_STATES_DC.map((item) => <option key={item} value={item}>{item}</option>)}</optgroup>
  </select>
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#334155]">
        {label}{required ? <span className="text-[#B91C1C]"> *</span> : null}
      </span>
      {children}
    </label>
  )
}

const inputClass =
  "min-h-11 w-full rounded-[10px] border border-[#D8E0EC] bg-white px-3.5 py-2 text-sm text-[#0F172A] outline-none transition-colors placeholder:text-[#A9B8CE] focus:border-[#1457F5] focus:ring-2 focus:ring-[#DCE7FF]"


function SafetyHistoryEditor({
  title,
  answer,
  items,
  typeLabel,
  onAnswerChange,
  onItemsChange,
}: {
  title: string
  answer: "" | "yes" | "no"
  items: Array<{ id: string; date: string; location: string; type: string; outcome: string; description: string }>
  typeLabel: string
  onAnswerChange: (value: "" | "yes" | "no") => void
  onItemsChange: (items: Array<{ id: string; date: string; location: string; type: string; outcome: string; description: string }>) => void
}) {
  const addItem = () =>
    onItemsChange([
      ...items,
      { id: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`, date: "", location: "", type: "", outcome: "", description: "" },
    ])

  const updateItem = (id: string, patch: Partial<(typeof items)[number]>) =>
    onItemsChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const removeItem = (id: string) => onItemsChange(items.filter((item) => item.id !== id))

  return (
    <div className="rounded-[14px] border border-[#DDE6F0] bg-[#FCFDFE] p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-semibold text-[#111827]">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-[#6B7280]">Answer from your own knowledge. TES can later compare this claim with supporting records without overwriting what you submitted.</p>
        </div>
        <select className={`${inputClass} sm:w-40`} value={answer} onChange={(e) => onAnswerChange(e.target.value as "" | "yes" | "no")}>
          <option value="">Select</option>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </div>

      {answer === "yes" ? (
        <div className="mt-4 space-y-4">
          {items.map((item, index) => (
            <div key={item.id} className="rounded-xl bg-[#F9FAFB] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{typeLabel} {index + 1}</div>
                <button type="button" onClick={() => removeItem(item.id)} className="text-xs font-semibold text-[#B91C1C] hover:underline">Remove</button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Date" required>
                  <DriverDateInput className={inputClass} value={item.date} onChange={(value) => updateItem(item.id, { date: value })} />
                </Field>
                <Field label="Location" required>
                  <input className={inputClass} value={item.location} onChange={(e) => updateItem(item.id, { location: e.target.value })} placeholder="City, State / Province" />
                </Field>
                <Field label={typeLabel === "Collision" ? "Collision type" : "Violation / conviction"} required>
                  <input className={inputClass} value={item.type} onChange={(e) => updateItem(item.id, { type: e.target.value })} />
                </Field>
                <Field label={typeLabel === "Collision" ? "Outcome" : "Penalty / outcome"}>
                  <input className={inputClass} value={item.outcome} onChange={(e) => updateItem(item.id, { outcome: e.target.value })} />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Additional details">
                  <textarea className={`${inputClass} min-h-24 resize-y`} value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} />
                </Field>
              </div>
            </div>
          ))}
          <button type="button" onClick={addItem} className="min-h-10 rounded-lg border border-[#D1D5DB] px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">
            Add {typeLabel}
          </button>
        </div>
      ) : null}
    </div>
  )
}


function ReviewBlock({
  title,
  editHref,
  children,
}: {
  title: string
  editHref: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[14px] border border-[#DDE6F0] bg-[#FCFDFE] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-[#111827]">{title}</h3>
        <a href={editHref} className="text-xs font-semibold text-[#1457F5] hover:underline">Review section</a>
      </div>
      {children}
    </div>
  )
}

function SummaryRows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</dt>
          <dd className="mt-1 text-sm text-[#111827]">{value || <span className="text-[#9CA3AF]">Not provided</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function DriverApplicationWorkspace({
  token,
  applicationId,
  employerName,
  employerContact,
  applicantName,
  invitationEmail,
  operatingRegion,
  activeStep,
}: {
  token: string
  applicationId: string
  employerName: string
  employerContact?: DriverApplicationCompanyContact
  applicantName: string
  invitationEmail: string
  operatingRegion: "Canada" | "United States" | "Cross-Border"
  activeStep: DriverApplicationStepId
}) {
  const router = useRouter()
  const [record, setRecord] = React.useState<ApplicantDraftEnvelope>(() => createEmptyApplicantDraft(applicationId))
  const [hydrated, setHydrated] = React.useState(false)
  const [saveState, setSaveState] = React.useState<ApplicantSaveState>("idle")
  const [submitted, setSubmitted] = React.useState<ApplicantSubmittedSnapshot | null>(null)
  const [submitState, setSubmitState] = React.useState<"idle" | "submitting" | "error">("idle")
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordRef = React.useRef(record)

  React.useEffect(() => {
    recordRef.current = record
  }, [record])

  React.useEffect(() => {
    let cancelled = false

    Promise.all([
      browserApplicantApplicationStore.loadSubmittedSnapshot(applicationId),
      browserApplicantApplicationStore.loadDraft(applicationId),
    ]).then(([submittedSnapshot, saved]) => {
      if (cancelled) return

      if (submittedSnapshot) {
        setSubmitted(submittedSnapshot)
        setHydrated(true)
        return
      }

      const next = saved ?? createEmptyApplicantDraft(applicationId)

      // Invitation email is authoritative for the invited address during this dev phase.
      if (!next.draft.aboutYou.email) {
        next.draft.aboutYou.email = invitationEmail
      }

      next.currentStep = activeStep
      setRecord(next)
      setHydrated(true)
    })

    return () => {
      cancelled = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [applicationId, activeStep, invitationEmail])

  const persist = React.useCallback(async (next: ApplicantDraftEnvelope) => {
    setSaveState("saving")
    try {
      const saved = await browserApplicantApplicationStore.saveDraft(next)
      setRecord(saved)
      setSaveState("saved")
      return saved
    } catch {
      setSaveState("error")
      return null
    }
  }, [])

  const scheduleSave = React.useCallback((next: ApplicantDraftEnvelope) => {
    setRecord(next)
    setSaveState("saving")
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void persist(next)
    }, 500)
  }, [persist])

  const updateDraft = React.useCallback((updater: (draft: ApplicantApplicationDraft) => ApplicantApplicationDraft) => {
    const current = recordRef.current
    const next: ApplicantDraftEnvelope = {
      ...current,
      currentStep: activeStep,
      draft: updater(current.draft),
    }
    recordRef.current = next
    scheduleSave(next)
  }, [activeStep, scheduleSave])

  const markCompleteAndContinue = async () => {
    const current = recordRef.current
    const index = DRIVER_APPLICATION_STEPS.findIndex((step) => step.id === activeStep)
    const nextStep = DRIVER_APPLICATION_STEPS[index + 1]?.id

    const next: ApplicantDraftEnvelope = {
      ...current,
      currentStep: nextStep ?? activeStep,
      completedSteps: current.completedSteps.includes(activeStep)
        ? current.completedSteps
        : [...current.completedSteps, activeStep],
    }

    recordRef.current = next
    const saved = await persist(next)
    if (saved && nextStep) router.push(driverApplicationStepHref(token, nextStep))
  }

  const goBack = () => {
    const index = DRIVER_APPLICATION_STEPS.findIndex((step) => step.id === activeStep)
    const previous = DRIVER_APPLICATION_STEPS[index - 1]?.id
    if (previous) router.push(driverApplicationStepHref(token, previous))
  }

  const submitApplication = async () => {
    setSubmitState("submitting")
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current)

      const current = recordRef.current
      const reviewComplete: ApplicantDraftEnvelope = {
        ...current,
        currentStep: "review",
        completedSteps: current.completedSteps.includes("review")
          ? current.completedSteps
          : [...current.completedSteps, "review"],
      }

      const snapshot = await browserApplicantApplicationStore.submitApplication(reviewComplete, token)
      setSubmitted(snapshot)
      setSubmitState("idle")
    } catch {
      setSubmitState("error")
    }
  }

  const identityReady = Boolean(
    record.draft.identity.driverPhoto &&
    record.draft.identity.licenceFront &&
    record.draft.identity.licenceBack
  )

  const about = record.draft.aboutYou
  const aboutReady = Boolean(
    (about.legalFirstName ?? "").trim() && (about.legalLastName ?? "").trim() && (about.phone ?? "").trim() && (about.email ?? "").trim() &&
    about.dateOfBirth && (about.currentAddress ?? "").trim() && (about.currentCity ?? "").trim() && about.currentJurisdiction &&
    (about.currentPostalCode ?? "").trim() && about.currentCountry && about.otherResidencesLast3Years &&
    (about.otherResidencesLast3Years !== "yes" || ((about.priorAddresses ?? []).length > 0 && (about.priorAddresses ?? []).every((a) => (a.address ?? "").trim() && (a.city ?? "").trim() && (a.jurisdiction ?? "").trim() && (a.postalCode ?? "").trim() && a.country))) &&
    about.employmentType && about.citizenshipStatus && about.workAuthorized &&
    about.ableToTravelUnitedStates && about.highestEducation && about.englishProficiency
  )

  const licence = record.draft.drivingLicence
  const licenceReady = Boolean(
    (licence.licenceNumber ?? "").trim() &&
    (licence.jurisdiction ?? "").trim() &&
    licence.country &&
    (licence.licenceClass ?? "").trim() &&
    licence.expiryDate &&
    licence.recentlyTransferredOrOtherLicenceLast3Years &&
    licence.otherJurisdictionOrName &&
    licence.everDeniedSuspendedRevoked &&
    licence.safetyAffectingMedicalCondition &&
    licence.unpardonedCriminalConviction &&
    licence.drugAlcoholPositiveRefusalAlterSubstitute &&
    licence.otherCompanyWhileEmployed &&
    (licence.recentlyTransferredOrOtherLicenceLast3Years !== "yes" || ((licence.previousLicences ?? []).length > 0 && (licence.previousLicences ?? []).every((x) => (x.nameOnLicence ?? "").trim() && (x.jurisdiction ?? "").trim() && (x.licenceNumber ?? "").trim() && (x.licenceClass ?? "").trim() && x.suspendedOrRevoked))) &&
    (licence.otherJurisdictionOrName !== "yes" || (licence.otherJurisdictionOrNameDetails ?? "").trim()) &&
    (licence.everDeniedSuspendedRevoked !== "yes" || (licence.deniedSuspendedRevokedDetails ?? "").trim()) &&
    licence.safetyAffectingMedicalCondition &&
    (licence.unpardonedCriminalConviction !== "yes" || (licence.unpardonedCriminalConvictionDetails ?? "").trim()) &&
    (licence.drugAlcoholPositiveRefusalAlterSubstitute !== "yes" || ((licence.drugAlcoholPositiveRefusalDetails ?? "").trim() && licence.failedRehabilitationOrReturnToDuty && (licence.failedRehabilitationOrReturnToDuty !== "yes" || (licence.rehabilitationDetails ?? "").trim()))) &&
    (licence.otherCompanyWhileEmployed !== "yes" || (licence.otherCompanyDetails ?? "").trim()) &&
    (licence.willingCanada || licence.willingUnitedStates)
  )

  const safety = record.draft.experienceSafety
  const safetyItemsComplete = (items: typeof safety.collisions) =>
    items.every((item) => item.date && (item.location ?? "").trim() && (item.type ?? "").trim())
  const safetyReady = Boolean(
    safety.commercialDrivingYears !== "" &&
    safety.collisionsLast5Years &&
    safety.convictionsLast5Years &&
    (safety.collisionsLast5Years === "no" || (safety.collisions.length > 0 && safetyItemsComplete(safety.collisions))) &&
    (safety.convictionsLast5Years === "no" || (safety.convictions.length > 0 && safetyItemsComplete(safety.convictions)))
  )

  const employment = record.draft.employment
  const employmentItemComplete = (item: (typeof employment.history)[number]) => {
    const periodComplete = Boolean(
      item.startDate &&
      (item.currentlyEmployed || item.endDate) &&
      (item.city ?? "").trim() &&
      (item.stateProvince ?? "").trim() &&
      item.country
    )
    if (!periodComplete) return false
    if ((item.historyType ?? "Employment") !== "Employment") {
      return Boolean((item.employerName ?? "").trim())
    }
    return Boolean(
      (item.employerName ?? "").trim() &&
      (item.position ?? "").trim() &&
      (item.contactName ?? "").trim() &&
      (item.contactPosition ?? "").trim() &&
      (item.employerPhone ?? "").trim() &&
      (item.employerEmail ?? "").trim()
    )
  }
  /*
   * Employment-history collection rule:
   * - Canada: 3 continuous years in the current TES Canadian baseline. Alberta's
   *   carrier rule requires the 3 years immediately preceding hire. Other
   *   provinces/territories remain rules-engine work and must not silently be
   *   treated as a 5-year employment-history rule.
   * - United States application: TES collects 10 continuous years. FMCSA
   *   requires 3 years of all employers and, for applicable Part 383 CMV
   *   drivers, the preceding 7 years of CMV employers. A carrier may request
   *   additional information under 49 CFR 391.21(c); collecting the full
   *   continuous 10-year timeline prevents the older CMV-employer period from
   *   being bypassed in this application workflow.
   * - Cross-Border: 10 years in this TES application because U.S. operating
   *   history can be relevant. The later rules engine can narrow the legal
   *   applicability for a Canadian foreign motor carrier where appropriate.
   */
  const requiredEmploymentHistoryYears =
    operatingRegion === "United States" || operatingRegion === "Cross-Border" ? 10 : 3

  const employmentHistoryCoverage = React.useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const requiredStart = new Date(today)
    requiredStart.setFullYear(requiredStart.getFullYear() - requiredEmploymentHistoryYears)

    const DAY = 24 * 60 * 60 * 1000

    const parseDate = (value?: string) => {
      if (!value) return null
      const date = new Date(`${value}T00:00:00`)
      return Number.isNaN(date.getTime()) ? null : date
    }

    const periods = employment.history
      .map((item) => {
        const start = parseDate(item.startDate)
        const end = item.currentlyEmployed ? new Date(today) : parseDate(item.endDate)

        if (!start || !end || start > end || start > today) return null

        return {
          start: start < requiredStart ? new Date(requiredStart) : start,
          end: end > today ? new Date(today) : end,
        }
      })
      .filter((period): period is { start: Date; end: Date } => Boolean(period))
      .filter((period) => period.end >= requiredStart && period.start <= today)
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    const yearsLabel = `${requiredEmploymentHistoryYears}-year`

    if (periods.length === 0) {
      return {
        complete: false,
        message: `Add work or activity records covering the full previous ${requiredEmploymentHistoryYears} years.`,
      }
    }

    // Coverage must begin at or before the exact required lookback date.
    if (periods[0].start.getTime() > requiredStart.getTime() + DAY) {
      return {
        complete: false,
        message: `Your ${yearsLabel} history does not reach the required start date. Add the missing earlier work or activity period.`,
      }
    }

    let coveredThrough = new Date(requiredStart)

    for (const period of periods) {
      // More than a one-day boundary between records is a real uncovered gap.
      if (period.start.getTime() > coveredThrough.getTime() + DAY) {
        return {
          complete: false,
          message: `Your ${yearsLabel} history contains a gap. Add an Employment, School, Unemployed, Self-employment, or Other record for every missing period.`,
        }
      }

      if (period.end > coveredThrough) coveredThrough = new Date(period.end)
    }

    if (coveredThrough.getTime() < today.getTime() - DAY) {
      return {
        complete: false,
        message: `Your history does not yet cover the full previous ${requiredEmploymentHistoryYears} years through today. Add the missing current work or activity period.`,
      }
    }

    return { complete: true, message: "" }
  }, [employment.history, requiredEmploymentHistoryYears])

  const employmentReady = Boolean(
    employment.historyComplete &&
    employment.history.length > 0 &&
    employment.history.every(employmentItemComplete) &&
    employmentHistoryCoverage.complete
  )

  const authorizations = record.draft.authorizations
  const expectedSignature = `${about.legalFirstName} ${about.legalLastName}`.trim().toLowerCase().replace(/\s+/g, " ")
  const enteredSignature = (authorizations.signatureName ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  const authorizationsReady = Boolean(
    authorizations.informationAccuracy &&
    authorizations.employmentVerification &&
    authorizations.mvrAuthorization &&
    authorizations.backgroundAuthorization &&
    authorizations.electronicRecordsConsent &&
    authorizations.driverCertificationsAccepted &&
    authorizations.hosResetCertification &&
    authorizations.hosPrevious14DaysCertification &&
    authorizations.clearinghouseLimitedQueryApplicable &&
    (authorizations.clearinghouseLimitedQueryApplicable !== "yes" || (
      authorizations.clearinghouseRegistered &&
      authorizations.clearinghouseConsentScope &&
      authorizations.clearinghouseConsentStartDate &&
      (authorizations.clearinghouseConsentScope !== "multiple" || authorizations.clearinghouseConsentEndDate) &&
      authorizations.clearinghouseLimitedQueryConsent
    )) &&
    authorizations.pspApplicable &&
    (authorizations.pspApplicable !== "yes" || (
      authorizations.pspOfficialFormPresented &&
      authorizations.pspDisclosureReviewed &&
      authorizations.pspAuthorization
    )) &&
    expectedSignature &&
    enteredSignature === expectedSignature
  )

  const documents = record.draft.documents
  const documentsReady = documents.documentsReviewed

  const finalCertification = record.draft.finalCertification
  const finalSignature = (finalCertification.signatureName ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  const finalCertificationReady = Boolean(
    finalCertification.reviewedApplication &&
    finalCertification.certificationAccepted &&
    expectedSignature &&
    finalSignature === expectedSignature
  )

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] px-4 py-12 text-[#111827]">
        <div className="mx-auto max-w-xl rounded-2xl border border-[#E5E7EB] bg-white p-8 text-sm text-[#6B7280] shadow-sm">
          Loading your application…
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <main className="min-h-screen bg-[#F8F9FA] px-4 py-10 text-[#111827]">
        <div className="mx-auto max-w-2xl">
          <header className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-bold">TES</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">Driver Application</div>
            </div>
            <div className="text-right text-xs text-[#6B7280]">
              <div className="font-semibold text-[#111827]">{employerName}</div>
              <div>{applicantName}</div>
              <div>Powered by TES</div>
            </div>
          </header>

          <section className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] px-6 py-7 text-center sm:px-8">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#ECFDF5] text-xl font-bold text-[#166534]">✓</div>
              <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#166534]">Application received</div>
              <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">Thank you, {applicantName}</h1>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#6B7280]">
                Your application has been submitted. The submitted record is now locked and cannot be edited from this application.
              </p>
            </div>

            <div className="space-y-5 px-6 py-6 sm:px-8">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Receipt</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{submitted.receiptId}</div>
                </div>
                <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Submitted</div>
                  <div className="mt-1 text-sm font-semibold">{new Date(submitted.submittedAt).toLocaleString()}</div>
                </div>
              </div>

              <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] p-4">
                <div className="text-sm font-semibold text-[#1E3A8A]">What happens next</div>
                <p className="mt-1 text-xs leading-5 text-[#1E3A8A]">
                  TES can process supporting documents, compare application information with connected evidence, identify missing information or factual discrepancies, and route items for review. Submission does not itself mean the driver has been approved, rejected, or qualified.
                </p>
              </div>

              <div className="rounded-xl border border-[#E5E7EB] p-4 text-xs leading-5 text-[#4B5563]">
                If a material correction is required after review, this submitted application remains unchanged. A new application can be issued and linked to this historical record instead of editing the original submission.
              </div>
            </div>
          </section>
        </div>
      </main>
    )
  }

  const addPriorAddress = () => updateDraft((d) => ({ ...d, aboutYou: { ...d.aboutYou, priorAddresses: [...d.aboutYou.priorAddresses, { id: `ADDR-${Date.now()}`, address: "", city: "", jurisdiction: "", postalCode: "", country: "" }] } }))
  const updatePriorAddress = (id: string, patch: Partial<(typeof about.priorAddresses)[number]>) => updateDraft((d) => ({ ...d, aboutYou: { ...d.aboutYou, priorAddresses: d.aboutYou.priorAddresses.map((item) => item.id === id ? { ...item, ...patch } : item) } }))
  const removePriorAddress = (id: string) => updateDraft((d) => ({ ...d, aboutYou: { ...d.aboutYou, priorAddresses: d.aboutYou.priorAddresses.filter((item) => item.id !== id) } }))

  let content: React.ReactNode

  if (activeStep === "identity") {
    content = (
      <section className="overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E7EDF5] px-5 py-6 sm:px-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Identity</div>
          <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">Identity & Driver Photo</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
            Provide both sides of your current driver licence and a current driver photo. These items support identity review and later verification.
          </p>
        </div>

        <div className="space-y-5 px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3.5 text-xs leading-5 text-[#475569] sm:text-sm sm:leading-6">
            <span className="font-semibold text-[#334155]">Image quality matters.</span>{" "}
            Capture or upload clear, complete images. Make sure the document is readable, in focus, not cut off, and all four edges are visible.
          </div>

          <div className="grid items-stretch gap-4 md:grid-cols-2">
            <FileEvidenceField
              label="Driver Licence — Front *"
              hint="Capture or upload a clear image of the entire front of your current driver licence. All information and all four edges must be visible."
              accept="image/*"
              cameraFacing="environment"
              value={record.draft.identity.licenceFront}
              onChange={(file) => updateDraft((draft) => ({ ...draft, identity: { ...draft.identity, licenceFront: fileSelection(file) } }))}
            />

            <FileEvidenceField
              label="Driver Licence — Back *"
              hint="Capture or upload a clear image of the entire back of your current driver licence. All information and all four edges must be visible."
              accept="image/*"
              cameraFacing="environment"
              value={record.draft.identity.licenceBack}
              onChange={(file) => updateDraft((draft) => ({ ...draft, identity: { ...draft.identity, licenceBack: fileSelection(file) } }))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FileEvidenceField
              label="Current Driver Photo *"
              hint="Use a clear, recent photo showing your full face. Make sure the image is well-lit, in focus and not cropped or obstructed."
              accept="image/*"
              cameraFacing="user"
              value={record.draft.identity.driverPhoto}
              onChange={(file) => updateDraft((draft) => ({ ...draft, identity: { ...draft.identity, driverPhoto: fileSelection(file) } }))}
            />
          </div>

          <div className="flex justify-end border-t border-[#E5E7EB] pt-5">
            <button
              type="button"
              disabled={!identityReady || saveState === "saving"}
              onClick={() => void markCompleteAndContinue()}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#1457F5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F4BDC] disabled:cursor-not-allowed disabled:bg-[#9CA3AF] sm:w-auto"
            >
              Save & Continue
            </button>
          </div>
        </div>
      </section>
    )
  } else if (activeStep === "about-you") {
    content = (
      <section className="overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E7EDF5] px-6 py-6 sm:px-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Personal information</div>
          <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">About You</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">Complete your personal, residence, work-status and operating-preference information.</p>
        </div>
        <div className="space-y-7 px-6 py-6 sm:px-8">
          <div>
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#334155]">Personal details</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Legal first name" required><input className={inputClass} value={about.legalFirstName} onChange={(e) => updateDraft((d) => ({...d,aboutYou:{...d.aboutYou,legalFirstName:e.target.value}}))}/></Field>
              <Field label="Legal middle name"><input className={inputClass} value={about.legalMiddleName} onChange={(e) => updateDraft((d) => ({...d,aboutYou:{...d.aboutYou,legalMiddleName:e.target.value}}))}/></Field>
              <Field label="Legal last name" required><input className={inputClass} value={about.legalLastName} onChange={(e) => updateDraft((d) => ({...d,aboutYou:{...d.aboutYou,legalLastName:e.target.value}}))}/></Field>
              <Field label="Date of birth" required><DriverDateInput className={inputClass} value={about.dateOfBirth} onChange={(value) => updateDraft((d) => ({...d,aboutYou:{...d.aboutYou,dateOfBirth:value}}))}/></Field>
              <Field label="Phone number" required><input type="tel" className={inputClass} value={about.phone} onChange={(e) => updateDraft((d) => ({...d,aboutYou:{...d.aboutYou,phone:e.target.value}}))}/></Field>
              <Field label="Email" required><input type="email" className={inputClass} value={about.email} onChange={(e) => updateDraft((d) => ({...d,aboutYou:{...d.aboutYou,email:e.target.value}}))}/></Field>
            </div>
          </div>

          <div className="border-t border-[#E7EDF5] pt-6">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#334155]">Current residence</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Street address" required><input className={inputClass} value={about.currentAddress} onChange={(e) => updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,currentAddress:e.target.value}}))}/></Field>
              <Field label="City" required><input className={inputClass} value={about.currentCity} onChange={(e) => updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,currentCity:e.target.value}}))}/></Field>
              <Field label="Country" required><select className={inputClass} value={about.currentCountry} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,currentCountry:e.target.value as ""|"Canada"|"United States",currentJurisdiction:""}}))}><option value="">Select</option><option value="Canada">Canada</option><option value="United States">United States</option></select></Field>
              <Field label="Province / state" required><JurisdictionSelect className={inputClass} value={about.currentJurisdiction} onChange={(value)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,currentJurisdiction:value}}))} required/></Field>
              <Field label="Postal / ZIP code" required><input className={inputClass} value={about.currentPostalCode} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,currentPostalCode:e.target.value}}))}/></Field>
            </div>
            <div className="mt-4"><Field label="In the previous 3 years, have you resided in any other province or state?" required><select className={inputClass} value={about.otherResidencesLast3Years} onChange={(e)=>{const value=e.target.value as ""|"yes"|"no";updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,otherResidencesLast3Years:value,priorAddresses:value==="no"?[]:d.aboutYou.priorAddresses}}))}}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></Field></div>
            {about.otherResidencesLast3Years==="yes" && <div className="mt-4 rounded-xl border border-[#E5E7EB]">
              <div className="flex items-center justify-between bg-[#F9FAFB] px-4 py-3"><div><div className="text-sm font-semibold">Previous 3-year residence history</div><div className="text-xs text-[#6B7280]">List every other address.</div></div><button type="button" onClick={addPriorAddress} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold">+ Add address</button></div>
              <div className="divide-y">{about.priorAddresses.map((item,index)=><div key={item.id} className="p-4"><div className="mb-3 flex justify-between"><span className="text-xs font-semibold">Address {index+1}</span><button type="button" onClick={()=>removePriorAddress(item.id)} className="text-xs font-semibold text-red-600">Remove</button></div><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                <Field label="Address"><input className={inputClass} value={item.address} onChange={(e)=>updatePriorAddress(item.id,{address:e.target.value})}/></Field>
                <Field label="City"><input className={inputClass} value={item.city} onChange={(e)=>updatePriorAddress(item.id,{city:e.target.value})}/></Field>
                <Field label="Country"><select className={inputClass} value={item.country} onChange={(e)=>updatePriorAddress(item.id,{country:e.target.value as ""|"Canada"|"United States",jurisdiction:""})}><option value="">Select</option><option value="Canada">Canada</option><option value="United States">United States</option></select></Field>
                <Field label="Province / state"><JurisdictionSelect className={inputClass} value={item.jurisdiction} onChange={(value)=>updatePriorAddress(item.id,{jurisdiction:value})}/></Field>
                <Field label="Postal / ZIP"><input className={inputClass} value={item.postalCode} onChange={(e)=>updatePriorAddress(item.id,{postalCode:e.target.value})}/></Field>
              </div></div>)}</div>
            </div>}
          </div>

          <div className="border-t border-[#E7EDF5] pt-6">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#334155]">Employment & work status</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Employment type" required><select className={inputClass} value={about.employmentType} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,employmentType:e.target.value as typeof d.aboutYou.employmentType}}))}><option value="">Select</option><option>Employee</option><option>Sub Contractor</option><option>Owner Operator</option></select></Field>
              <Field label="Citizenship / work status" required><select className={inputClass} value={about.citizenshipStatus} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,citizenshipStatus:e.target.value as typeof d.aboutYou.citizenshipStatus,workPermitConditions:e.target.value==="Work Permit"?"":"not-applicable"}}))}><option value="">Select</option><option>Citizen</option><option>Permanent Resident</option><option>Work Permit</option><option>Other</option></select></Field>
              {about.citizenshipStatus==="Other" && <Field label="Other status"><input className={inputClass} value={about.citizenshipOther} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,citizenshipOther:e.target.value}}))}/></Field>}
              {about.citizenshipStatus==="Work Permit" && <Field label="Are any work-permit conditions listed?" required><select className={inputClass} value={about.workPermitConditions} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,workPermitConditions:e.target.value as "yes"|"no"}}))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></Field>}
              {about.citizenshipStatus==="Work Permit" && about.workPermitConditions==="yes" && <Field label="Work-permit conditions"><input className={inputClass} value={about.workPermitConditionDetails} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,workPermitConditionDetails:e.target.value}}))}/></Field>}
              <Field label="Legally authorized to work for this position?" required><select className={inputClass} value={about.workAuthorized} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,workAuthorized:e.target.value as ""|"yes"|"no"}}))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
            </div>
            {about.employmentType==="Owner Operator" && <div className="mt-4 grid gap-4 md:grid-cols-3"><Field label="Vehicle year"><input className={inputClass} value={about.ownerOperatorVehicleYear} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,ownerOperatorVehicleYear:e.target.value}}))}/></Field><Field label="Vehicle make"><input className={inputClass} value={about.ownerOperatorVehicleMake} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,ownerOperatorVehicleMake:e.target.value}}))}/></Field><Field label="Vehicle model"><input className={inputClass} value={about.ownerOperatorVehicleModel} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,ownerOperatorVehicleModel:e.target.value}}))}/></Field></div>}
          </div>

          <div className="border-t border-[#E7EDF5] pt-6">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#334155]">Operating availability & HR information</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Are you able to travel to the United States?" required><select className={inputClass} value={about.ableToTravelUnitedStates} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,ableToTravelUnitedStates:e.target.value as typeof d.aboutYou.ableToTravelUnitedStates}}))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option><option value="pending">Pending</option></select></Field>
              <Field label="Highest level of education" required><select className={inputClass} value={about.highestEducation} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,highestEducation:e.target.value as typeof d.aboutYou.highestEducation}}))}><option value="">Select</option><option>High School</option><option>Technical Diploma</option><option>College</option><option>University</option><option>Other</option></select></Field>
              <Field label="English proficiency" required><select className={inputClass} value={about.englishProficiency} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,englishProficiency:e.target.value as typeof d.aboutYou.englishProficiency}}))}><option value="">Select</option><option>Poor</option><option>Basic</option><option>Good</option><option>Fluent</option></select></Field>
              {about.highestEducation==="Other" && <Field label="Other education"><input className={inputClass} value={about.educationOther} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,educationOther:e.target.value}}))}/></Field>}
            </div>
            <div className="mt-4"><div className="text-xs font-semibold">Regions / work type you are interested in</div><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={about.operatingInterestLocal} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,operatingInterestLocal:e.target.checked}}))}/>Local Driver</label>
              <label className="flex gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={about.operatingInterestShortHaul} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,operatingInterestShortHaul:e.target.checked}}))}/>Short Haul</label>
              <label className="flex gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={about.operatingInterestCanada} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,operatingInterestCanada:e.target.checked}}))}/>Canada</label>
              <label className="flex gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={about.operatingInterestUnitedStates} onChange={(e)=>updateDraft((d)=>({...d,aboutYou:{...d.aboutYou,operatingInterestUnitedStates:e.target.checked}}))}/>United States</label>
            </div></div>
          </div>

          <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] p-4 text-xs leading-5 text-[#1E3A8A]">English proficiency here is applicant-provided information. Any required carrier/TES English-language qualification assessment remains a separate qualification record.</div>
          <div className="flex items-center justify-between border-t pt-5"><button type="button" onClick={goBack} className="min-h-11 rounded-lg border px-4 py-2.5 text-sm font-semibold">Back</button><button type="button" disabled={!aboutReady||saveState==="saving"} onClick={()=>void markCompleteAndContinue()} className="min-h-11 rounded-lg bg-[#1457F5] px-5 py-2.5 text-sm font-semibold text-white disabled:bg-[#9CA3AF]">Save & Continue</button></div>
        </div>
      </section>
    )
  } else if (activeStep === "driving-licence") {
    content = (
      <section className="overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E7EDF5] px-6 py-6 sm:px-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Driving</div>
          <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">Driving & Licence</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
            Enter the information shown on your current driver licence and tell the carrier where you are willing and available to operate.
          </p>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8">
          <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] p-4 text-sm leading-6 text-[#1E3A8A]">
            These are applicant-provided facts. Licence OCR and other evidence will be compared separately; TES will not silently replace your answers with extracted data.
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Licence number" required>
              <input className={inputClass} value={licence.licenceNumber} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, licenceNumber: e.target.value } }))} />
            </Field>
            <Field label="Issuing jurisdiction" required>
              <JurisdictionSelect className={inputClass} value={licence.jurisdiction} onChange={(value) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, jurisdiction: value } }))} required />
            </Field>
            <Field label="Country" required>
              <select className={inputClass} value={licence.country} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, country: e.target.value as "" | "Canada" | "United States" } }))}>
                <option value="">Select</option>
                <option value="Canada">Canada</option>
                <option value="United States">United States</option>
              </select>
            </Field>
            <Field label="Licence class" required>
              <input className={inputClass} value={licence.licenceClass} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, licenceClass: e.target.value } }))} placeholder="e.g. Class 1, AZ, Class A" />
            </Field>
            <Field label="Issue date">
              <DriverDateInput className={inputClass} value={licence.issueDate} onChange={(value) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, issueDate: value } }))} />
            </Field>
            <Field label="Expiry date" required>
              <DriverDateInput className={inputClass} value={licence.expiryDate} onChange={(value) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, expiryDate: value } }))} />
            </Field>
            <Field label="Endorsements">
              <input className={inputClass} value={licence.endorsements} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, endorsements: e.target.value } }))} placeholder="Separate multiple items with commas" />
            </Field>
            <Field label="Restrictions">
              <input className={inputClass} value={licence.restrictions} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, restrictions: e.target.value } }))} placeholder="Enter none if there are no restrictions" />
            </Field>
          </div>

          <div className="rounded-[14px] border border-[#DDE6F0] bg-[#FCFDFE] p-4 sm:p-5">
            <h3 className="text-sm font-semibold">Licence history & eligibility declarations</h3>
            <p className="mt-1 text-xs leading-5 text-[#6B7280]">Answer from your own knowledge. TES will verify applicable items separately.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Date first commercial licence received">
                <DriverDateInput className={inputClass} value={licence.firstCommercialLicenceDate ?? ""} onChange={(value) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, firstCommercialLicenceDate: value } }))} />
              </Field>
              <Field label="Transferred / held another licence in the previous 3 years?" required>
                <select className={inputClass} value={licence.recentlyTransferredOrOtherLicenceLast3Years ?? ""} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, recentlyTransferredOrOtherLicenceLast3Years: e.target.value as ""|"yes"|"no" } }))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
              </Field>
              {licence.recentlyTransferredOrOtherLicenceLast3Years === "yes" && (
                <div className="md:col-span-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div><h4 className="text-sm font-semibold">Previous / transferred licences</h4><p className="mt-1 text-xs text-[#6B7280]">Add each licence held in another province/state or under another name during the previous 3 years.</p></div>
                    <button type="button" className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" onClick={() => updateDraft((d) => ({...d, drivingLicence: {...d.drivingLicence, previousLicences: [...(d.drivingLicence.previousLicences ?? []), {id: crypto.randomUUID(), nameOnLicence:"", jurisdiction:"", licenceNumber:"", licenceClass:"", suspendedOrRevoked:""}]}}))}>+ Add licence</button>
                  </div>
                  <div className="mt-4 space-y-4">
                    {(licence.previousLicences ?? []).map((item, index) => (
                      <div key={item.id} className="rounded-lg border bg-white p-4">
                        <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">Licence {index + 1}</span><button type="button" className="text-xs font-semibold text-[#B91C1C]" onClick={() => updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,previousLicences:(d.drivingLicence.previousLicences ?? []).filter((x)=>x.id!==item.id)}}))}>Remove</button></div>
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                          <Field label="Name on licence"><input className={inputClass} value={item.nameOnLicence ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,previousLicences:(d.drivingLicence.previousLicences ?? []).map((x)=>x.id===item.id?{...x,nameOnLicence:e.target.value}:x)}}))}/></Field>
                          <Field label="Jurisdiction"><JurisdictionSelect className={inputClass} value={item.jurisdiction ?? ""} onChange={(value)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,previousLicences:(d.drivingLicence.previousLicences ?? []).map((x)=>x.id===item.id?{...x,jurisdiction:value}:x)}}))}/></Field>
                          <Field label="Licence number"><input className={inputClass} value={item.licenceNumber ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,previousLicences:(d.drivingLicence.previousLicences ?? []).map((x)=>x.id===item.id?{...x,licenceNumber:e.target.value}:x)}}))}/></Field>
                          <Field label="Class"><input className={inputClass} value={item.licenceClass ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,previousLicences:(d.drivingLicence.previousLicences ?? []).map((x)=>x.id===item.id?{...x,licenceClass:e.target.value}:x)}}))}/></Field>
                          <Field label="Suspended / revoked?"><select className={inputClass} value={item.suspendedOrRevoked ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,previousLicences:(d.drivingLicence.previousLicences ?? []).map((x)=>x.id===item.id?{...x,suspendedOrRevoked:e.target.value as ""|"yes"|"no"}:x)}}))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Field label="Licence in another jurisdiction or another name?" required>
                <select className={inputClass} value={licence.otherJurisdictionOrName ?? ""} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, otherJurisdictionOrName: e.target.value as ""|"yes"|"no" } }))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
              </Field>
              <Field label="Ever denied a licence, or licence suspended / revoked?" required>
                <select className={inputClass} value={licence.everDeniedSuspendedRevoked ?? ""} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, everDeniedSuspendedRevoked: e.target.value as ""|"yes"|"no" } }))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
              </Field>
              <Field label="Can you perform the essential safety-related duties of the position, with or without reasonable accommodation?" required>
                <select className={inputClass} value={licence.safetyAffectingMedicalCondition ?? ""} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, safetyAffectingMedicalCondition: e.target.value as ""|"yes"|"no" } }))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
              </Field>
              <Field label="Unpardoned criminal conviction?" required>
                <select className={inputClass} value={licence.unpardonedCriminalConviction ?? ""} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, unpardonedCriminalConviction: e.target.value as ""|"yes"|"no" } }))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
              </Field>
              <Field label="Positive / refused / altered / substituted drug or alcohol test?" required>
                <select className={inputClass} value={licence.drugAlcoholPositiveRefusalAlterSubstitute ?? ""} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, drugAlcoholPositiveRefusalAlterSubstitute: e.target.value as ""|"yes"|"no" } }))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
              </Field>
              <Field label="Will you work with another company while employed here?" required>
                <select className={inputClass} value={licence.otherCompanyWhileEmployed ?? ""} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, otherCompanyWhileEmployed: e.target.value as ""|"yes"|"no" } }))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
              </Field>
            </div>
            {(licence.otherJurisdictionOrName === "yes" || licence.everDeniedSuspendedRevoked === "yes" || licence.safetyAffectingMedicalCondition === "yes" || licence.unpardonedCriminalConviction === "yes" || licence.drugAlcoholPositiveRefusalAlterSubstitute === "yes" || licence.otherCompanyWhileEmployed === "yes") && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {licence.otherJurisdictionOrName === "yes" && <Field label="Other licence / name details"><textarea className={inputClass} value={licence.otherJurisdictionOrNameDetails ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,otherJurisdictionOrNameDetails:e.target.value}}))}/></Field>}
                {licence.everDeniedSuspendedRevoked === "yes" && <Field label="Suspension / revocation details"><textarea className={inputClass} value={licence.deniedSuspendedRevokedDetails ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,deniedSuspendedRevokedDetails:e.target.value}}))}/></Field>}
                {licence.unpardonedCriminalConviction === "yes" && <Field label="Conviction details"><textarea className={inputClass} value={licence.unpardonedCriminalConvictionDetails ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,unpardonedCriminalConvictionDetails:e.target.value}}))}/></Field>}
                {licence.drugAlcoholPositiveRefusalAlterSubstitute === "yes" && <Field label="Drug / alcohol test details"><textarea className={inputClass} value={licence.drugAlcoholPositiveRefusalDetails ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,drugAlcoholPositiveRefusalDetails:e.target.value}}))}/></Field>}
                {licence.drugAlcoholPositiveRefusalAlterSubstitute === "yes" && <Field label="Failed to complete a required rehabilitation / return-to-duty process?"><select className={inputClass} value={licence.failedRehabilitationOrReturnToDuty ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,failedRehabilitationOrReturnToDuty:e.target.value as ""|"yes"|"no"|"not-applicable"}}))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option><option value="not-applicable">Not applicable</option></select></Field>}
                {licence.failedRehabilitationOrReturnToDuty === "yes" && <Field label="Rehabilitation / return-to-duty details"><textarea className={inputClass} value={licence.rehabilitationDetails ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,rehabilitationDetails:e.target.value}}))}/></Field>}
                {licence.otherCompanyWhileEmployed === "yes" && <Field label="Other-company details"><textarea className={inputClass} value={licence.otherCompanyDetails ?? ""} onChange={(e)=>updateDraft((d)=>({...d,drivingLicence:{...d.drivingLicence,otherCompanyDetails:e.target.value}}))}/></Field>}
              </div>
            )}
          </div>

          <div className="rounded-[14px] border border-[#DDE6F0] bg-[#FCFDFE] p-4 sm:p-5">
            <h3 className="text-sm font-semibold">Where are you willing and available to operate? *</h3>
            <p className="mt-1 text-xs leading-5 text-[#6B7280]">
              This is your stated operating availability. The carrier&apos;s operating scope and final assignment are separate records.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#E5E7EB] p-3 text-sm">
                <input type="checkbox" checked={licence.willingCanada} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, willingCanada: e.target.checked } }))} className="h-4 w-4" />
                Canada
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#E5E7EB] p-3 text-sm">
                <input type="checkbox" checked={licence.willingUnitedStates} onChange={(e) => updateDraft((d) => ({ ...d, drivingLicence: { ...d.drivingLicence, willingUnitedStates: e.target.checked } }))} className="h-4 w-4" />
                United States
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[#E7EDF5] pt-5">
            <button type="button" onClick={goBack} className="min-h-11 rounded-lg border border-[#D1D5DB] px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">Back</button>
            <button type="button" disabled={!licenceReady || saveState === "saving"} onClick={() => void markCompleteAndContinue()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1457F5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F4BDC] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]">
              Save & Continue
            </button>
          </div>
        </div>
      </section>
    )
  } else if (activeStep === "experience-safety") {
    content = (
      <section className="overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E7EDF5] px-6 py-6 sm:px-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Experience</div>
          <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">Experience & Safety History</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
            Tell us what you know about your commercial driving experience, collisions and traffic convictions. Supporting records are analyzed separately.
          </p>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Commercial driving experience (years)" required>
              <input type="number" min="0" step="0.5" className={inputClass} value={safety.commercialDrivingYears} onChange={(e) => updateDraft((d) => ({ ...d, experienceSafety: { ...d.experienceSafety, commercialDrivingYears: e.target.value } }))} />
            </Field>
            <Field label="Equipment experience">
              <input className={inputClass} value={safety.equipmentExperience} onChange={(e) => updateDraft((d) => ({ ...d, experienceSafety: { ...d.experienceSafety, equipmentExperience: e.target.value } }))} placeholder="e.g. tractor-trailer, flatbed, reefer" />
            </Field>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {[
              ["Equipment experience", ["Straight Trucks","Tractors","Dump Truck","Dry Vans","Refrigerated Trailers","Flat Deck Trailers","Step Deck Trailers","Grain / Bulk Haulers","Livestock Trailers","Low Boy Trailers","Super B / Dual Trailers","Other"]],
              ["Operating regions", ["Western Canada","Central Canada","Atlantic Canada","Territories","Western United States","Midwest United States","Southern United States","Northeast United States"]],
              ["Road / terrain experience", ["Urban / City","Highways","Mountains","Steep Grades","Rural / Lease Roads","Flat / Plain Roads","Snowy / Icy / Wet Roads","Hot / Desert Roads"]],
            ].map(([title, options]) => {
              const field = title === "Equipment experience" ? "equipmentTypes" : title === "Operating regions" ? "operatingRegions" : "terrainExperience"
              const selected = safety[field as "equipmentTypes"|"operatingRegions"|"terrainExperience"] ?? []
              return <div key={title as string} className="rounded-xl border border-[#E5E7EB] p-4"><h3 className="text-sm font-semibold">{title as string}</h3><div className="mt-3 space-y-2">{(options as string[]).map((option)=><label key={option} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(option)} onChange={(e)=>updateDraft((d)=>{const current=d.experienceSafety[field as "equipmentTypes"|"operatingRegions"|"terrainExperience"] ?? []; return {...d,experienceSafety:{...d.experienceSafety,[field]:e.target.checked?[...current,option]:current.filter((x)=>x!==option)}}})}/>{option}</label>)}</div></div>
            })}
          </div>

          <SafetyHistoryEditor
            title="Any reportable collisions in the last 5 years?"
            answer={safety.collisionsLast5Years}
            items={safety.collisions}
            typeLabel="Collision"
            onAnswerChange={(value) => updateDraft((d) => ({ ...d, experienceSafety: { ...d.experienceSafety, collisionsLast5Years: value, collisions: value === "no" ? [] : d.experienceSafety.collisions } }))}
            onItemsChange={(items) => updateDraft((d) => ({ ...d, experienceSafety: { ...d.experienceSafety, collisions: items } }))}
          />

          <SafetyHistoryEditor
            title="Any traffic convictions or violations in the last 5 years?"
            answer={safety.convictionsLast5Years}
            items={safety.convictions}
            typeLabel="Conviction"
            onAnswerChange={(value) => updateDraft((d) => ({ ...d, experienceSafety: { ...d.experienceSafety, convictionsLast5Years: value, convictions: value === "no" ? [] : d.experienceSafety.convictions } }))}
            onItemsChange={(items) => updateDraft((d) => ({ ...d, experienceSafety: { ...d.experienceSafety, convictions: items } }))}
          />

          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-xs leading-5 text-[#4B5563]">
            TES preserves these answers as applicant claims. If a Driver Abstract, MVR, CVOR or other connected evidence later contains different information, TES can flag the factual discrepancy for review without characterizing why the difference occurred.
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[#E7EDF5] pt-5">
            <button type="button" onClick={goBack} className="min-h-11 rounded-lg border border-[#D1D5DB] px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">Back</button>
            <button type="button" disabled={!safetyReady || saveState === "saving"} onClick={() => void markCompleteAndContinue()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1457F5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F4BDC] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]">
              Save & Continue
            </button>
          </div>
        </div>
      </section>
    )
  } else if (activeStep === "employment") {
    const addEmployment = () => {
      const item = {
        id: `employment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        employerName: "",
        position: "",
        startDate: "",
        endDate: "",
        currentlyEmployed: false,
        commercialDriving: true,
        dotRegulated: false,
        reasonForLeaving: "",
        employerPhone: "",
        employerEmail: "",
        employerAddress: "",
        contactName: "",
        contactPosition: "",
        alcoholSubstanceTesting: "unknown" as const,
        historyType: "Employment" as const,
        city: "",
        stateProvince: "",
        country: "" as const,
      }
      updateDraft((d) => ({ ...d, employment: { ...d.employment, history: [...d.employment.history, item], historyComplete: false } }))
    }

    const updateEmployment = (id: string, patch: Partial<(typeof employment.history)[number]>) =>
      updateDraft((d) => ({
        ...d,
        employment: {
          ...d.employment,
          historyComplete: false,
          history: d.employment.history.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        },
      }))

    const removeEmployment = (id: string) =>
      updateDraft((d) => ({ ...d, employment: { ...d.employment, history: d.employment.history.filter((item) => item.id !== id), historyComplete: false } }))

    content = (
      <section className="overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E7EDF5] px-6 py-6 sm:px-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Employment</div>
          <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">Employment History</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
            Add your employment history accurately. TES can use this information to support applicable verification and reference-check workflows after submission.
          </p>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8">
          <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] p-4 text-sm leading-6 text-[#1E3A8A]">
            You must provide a continuous <strong>{requiredEmploymentHistoryYears}-year</strong> work and activity history for this application. Every period must be accounted for. Use Employment, School, Unemployed, Self-employment or Other so there are no unexplained gaps.
            <span className="mt-2 block">This is a history requirement, not a minimum driving-experience requirement. A new driver can satisfy the timeline with school, training, unemployment or non-driving work where that is what actually occurred.</span>
          </div>

          <div className="rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#374151]">
            Required history for this application: <span className="font-bold text-[#0B1F44]">{requiredEmploymentHistoryYears} continuous years</span>
            <span className="ml-1 text-[#6B7280]">({operatingRegion})</span>
          </div>

          {employment.history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#D1D5DB] p-6 text-center">
              <div className="text-sm font-semibold">At least one work / activity record is required</div>
              <p className="mt-1 text-xs text-[#6B7280]">Start with your current or most recent work, school, unemployment, self-employment or other activity period.</p>
            </div>
          ) : null}

          <div className="space-y-4">
            {employment.history.map((item, index) => (
              <div key={item.id} className="rounded-[14px] border border-[#DDE6F0] bg-[#FCFDFE] p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{(item.historyType ?? "Employment") === "Employment" ? "Employer" : "History record"} {index + 1}</div>
                    <div className="text-xs text-[#6B7280]">{index === 0 ? "Current or most recent period first" : "Previous work / activity period"}</div>
                  </div>
                  <button type="button" onClick={() => removeEmployment(item.id)} className="text-xs font-semibold text-[#B91C1C] hover:underline">Remove</button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={(item.historyType ?? "Employment") === "Employment" ? "Employer name" : (item.historyType === "School" ? "School / institution" : "Activity / organization")} required>
                    <input className={inputClass} value={item.employerName} onChange={(e) => updateEmployment(item.id, { employerName: e.target.value })} />
                  </Field>
                  <Field label={(item.historyType ?? "Employment") === "Employment" ? "Position / role" : "Role / description"} required={(item.historyType ?? "Employment") === "Employment"}>
                    <input className={inputClass} value={item.position} onChange={(e) => updateEmployment(item.id, { position: e.target.value })} />
                  </Field>
                  <Field label="Start date" required>
                    <DriverDateInput className={inputClass} value={item.startDate} onChange={(value) => updateEmployment(item.id, { startDate: value })} />
                  </Field>
                  <Field label="End date" required={!item.currentlyEmployed}>
                    <DriverDateInput className={`${inputClass} disabled:bg-[#F3F4F6]`} value={item.endDate} disabled={item.currentlyEmployed} onChange={(value) => updateEmployment(item.id, { endDate: value })} />
                  </Field>
                </div>

                <label className="mt-3 flex items-center gap-3 text-sm text-[#374151]">
                  <input type="checkbox" className="h-4 w-4" checked={item.currentlyEmployed} onChange={(e) => updateEmployment(item.id, { currentlyEmployed: e.target.checked, endDate: e.target.checked ? "" : item.endDate })} />
                  I currently work here
                </label>

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <Field label="City" required>
                    <input className={inputClass} value={item.city} onChange={(e) => updateEmployment(item.id, { city: e.target.value })} />
                  </Field>
                  <Field label="State / Province" required>
                    <input className={inputClass} value={item.stateProvince} onChange={(e) => updateEmployment(item.id, { stateProvince: e.target.value })} />
                  </Field>
                  <Field label="Country" required>
                    <select className={inputClass} value={item.country} onChange={(e) => updateEmployment(item.id, { country: e.target.value as "Canada" | "United States" | "Other" })}>
                      <option value="">Select</option>
                      <option value="Canada">Canada</option>
                      <option value="United States">United States</option>
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="Employer / school / activity address">
                    <input className={inputClass} value={item.employerAddress ?? ""} onChange={(e) => updateEmployment(item.id, { employerAddress: e.target.value })} />
                  </Field>
                  <Field label="Contact name" required={item.historyType === "Employment"}>
                    <input className={inputClass} value={item.contactName ?? ""} onChange={(e) => updateEmployment(item.id, { contactName: e.target.value })} />
                  </Field>
                  <Field label="Contact position" required={item.historyType === "Employment"}>
                    <input className={inputClass} value={item.contactPosition ?? ""} onChange={(e) => updateEmployment(item.id, { contactPosition: e.target.value })} />
                  </Field>
                  <Field label="History type">
                    <select className={inputClass} value={item.historyType ?? "Employment"} onChange={(e)=>updateEmployment(item.id,{historyType:e.target.value as typeof item.historyType})}><option>Employment</option><option>Unemployed</option><option>School</option><option>Other</option></select>
                  </Field>
                  <Field label="Employer phone" required={item.historyType === "Employment"}>
                    <input type="tel" className={inputClass} value={item.employerPhone} onChange={(e) => updateEmployment(item.id, { employerPhone: e.target.value })} />
                  </Field>
                  <Field label="Employer email" required={item.historyType === "Employment"}>
                    <input type="email" className={inputClass} value={item.employerEmail} onChange={(e) => updateEmployment(item.id, { employerEmail: e.target.value })} />
                  </Field>
                  <Field label="Reason for leaving (optional)">
                    <input className={inputClass} disabled={item.currentlyEmployed} value={item.reasonForLeaving} onChange={(e) => updateEmployment(item.id, { reasonForLeaving: e.target.value })} />
                  </Field>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] p-3 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={item.commercialDriving} onChange={(e) => updateEmployment(item.id, { commercialDriving: e.target.checked })} />
                    Commercial driving position
                  </label>
                  <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] p-3 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={item.dotRegulated} onChange={(e) => updateEmployment(item.id, { dotRegulated: e.target.checked })} />
                    U.S. DOT-regulated position, if known
                  </label>
                  <Field label="Drug / alcohol testing participation">
                    <select className={inputClass} value={item.alcoholSubstanceTesting ?? "unknown"} onChange={(e)=>updateEmployment(item.id,{alcoholSubstanceTesting:e.target.value as typeof item.alcoholSubstanceTesting})}><option value="unknown">Unknown / not sure</option><option value="yes">Yes</option><option value="no">No</option></select>
                  </Field>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addEmployment} className="min-h-10 rounded-lg border border-[#D1D5DB] px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">
            Add Work / Activity Record
          </button>

          {employment.history.length > 0 && !employmentHistoryCoverage.complete ? (
            <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm leading-6 text-[#991B1B]">
              <span className="font-semibold">Employment / activity history is incomplete.</span>{" "}
              {employmentHistoryCoverage.message}
              <span className="mt-1 block text-xs font-semibold">Save & Continue remains locked until the required timeline is complete.</span>
            </div>
          ) : null}

          {employment.history.length > 0 ? (
            <label className="flex items-start gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-sm text-[#374151]">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={employment.historyComplete} onChange={(e) => updateDraft((d) => ({ ...d, employment: { ...d.employment, historyComplete: e.target.checked } }))} />
              <span>
                <span className="font-semibold">I have added my work and activity history to the best of my knowledge.</span>
                <span className="mt-1 block text-xs leading-5 text-[#6B7280]">This statement does not override TES timeline validation. Employment, school, unemployment, self-employment and other material activity periods must collectively cover the required history with no unexplained gaps.</span>
              </span>
            </label>
          ) : null}

          <div className="flex items-center justify-between gap-4 border-t border-[#E7EDF5] pt-5">
            <button type="button" onClick={goBack} className="min-h-11 rounded-lg border border-[#D1D5DB] px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">Back</button>
            <button type="button" disabled={!employmentReady || saveState === "saving"} onClick={() => void markCompleteAndContinue()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1457F5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F4BDC] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]">
              Save & Continue
            </button>
          </div>
        </div>
      </section>
    )
  } else if (activeStep === "authorizations") {
    const authorizationRow = (
      key: keyof Pick<typeof authorizations, "informationAccuracy" | "employmentVerification" | "mvrAuthorization" | "backgroundAuthorization" | "electronicRecordsConsent">,
      title: string,
      description: string
    ) => (
      <label className="flex items-start gap-3 rounded-xl border border-[#E5E7EB] p-4">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={authorizations[key]} onChange={(e) => updateDraft((d) => ({ ...d, authorizations: { ...d.authorizations, [key]: e.target.checked } }))} />
        <span>
          <span className="block text-sm font-semibold text-[#111827]">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-[#6B7280]">{description}</span>
        </span>
      </label>
    )

    content = (
      <section className="overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E7EDF5] px-6 py-6 sm:px-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Consent & Certification</div>
          <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">Review, consent and certify</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
            Read each item before accepting it. TES keeps general application acknowledgements separate from regulated authorizations that require their own scope, disclosure, signature or external consent process.
          </p>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8">
          <div className="rounded-xl border border-[#E5E7EB] p-4">
            <h3 className="text-sm font-semibold">Application acknowledgements</h3>
            <p className="mt-1 text-xs leading-5 text-[#6B7280]">These acknowledgements apply to this application only and do not replace a jurisdiction-specific statutory form.</p>
            <div className="mt-4 space-y-3">
              {authorizationRow("informationAccuracy", "Accuracy of application information", "I certify that the information I submitted is true, complete and accurate to the best of my knowledge. I understand that TES/carrier review may identify information that requires clarification or supporting evidence.")}
              {authorizationRow("employmentVerification", "Employment and reference verification", "I authorize the prospective employer, TES acting on its behalf, and authorized service providers to contact the employers and references I identified and to request information reasonably relevant to evaluating my employment and commercial-driving history, subject to applicable law.")}
              {authorizationRow("mvrAuthorization", "Driver record / abstract verification", "Where permitted and applicable, I authorize the prospective employer, TES acting on its behalf, and authorized service providers to obtain and review driver-licence, abstract or motor-vehicle-record information relevant to this application. I understand that a jurisdiction may require an additional prescribed authorization.")}
              {authorizationRow("backgroundAuthorization", "Other permitted hiring verification", "I authorize other job-related verification that is lawful and applicable to this driver position. Where a separate disclosure, authorization or consent is legally required, this acknowledgement does not replace it.")}
              {authorizationRow("electronicRecordsConsent", "Electronic records and signatures", "I consent to receiving, reviewing and signing records electronically in this application workflow. My electronic acknowledgements may be retained with the application audit record.")}
            </div>
          </div>

          <div className="rounded-xl border border-[#E5E7EB] p-4">
            <h3 className="text-sm font-semibold">Driver certification & prior duty-status information</h3>
            <p className="mt-1 text-xs leading-5 text-[#6B7280]">
              Complete this section truthfully. TES will determine which hours-of-service requirements apply to the carrier, jurisdiction and intended operation; these statements do not themselves authorize driving.
            </p>
            <label className="mt-4 flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1" checked={authorizations.driverCertificationsAccepted ?? false} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,driverCertificationsAccepted:e.target.checked}}))}/>
              <span>I certify that I will hold and use only licences for which I am legally entitled, will promptly report a suspension, revocation, restriction or other material change in my driving privilege, and will comply with the safety and reporting requirements that apply to the work I perform.</span>
            </label>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Total on-duty hours during the previous 7 days" required>
                <input type="number" min="0" step="0.25" className={inputClass} value={authorizations.previous7DaysOnDutyHours ?? ""} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,previous7DaysOnDutyHours:e.target.value}}))}/>
              </Field>
            </div>
            <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={authorizations.hosResetCertification ?? false} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,hosResetCertification:e.target.checked}}))}/><span>I will not begin safety-sensitive driving until the carrier/TES has confirmed that any applicable off-duty, cycle-reset or other hours-of-service requirement has been satisfied.</span></label>
            <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={authorizations.hosPrevious14DaysCertification ?? false} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,hosPrevious14DaysCertification:e.target.checked}}))}/><span>I will provide prior duty-status information or records when required for the applicable operation, and I understand that TES/carrier may request additional records before dispatch.</span></label>
          </div>

          <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-4">
            <h3 className="text-sm font-semibold text-[#1E3A8A]">FMCSA Drug & Alcohol Clearinghouse — limited-query general consent</h3>
            <p className="mt-1 text-xs leading-5 text-[#1E40AF]">
              This section applies only when the driver and position are subject to the FMCSA Clearinghouse rules. A limited query only tells the employer whether information exists in the Clearinghouse; it does not disclose the underlying violation details. A pre-employment full query requires separate, specific electronic consent inside the FMCSA Clearinghouse.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Does this consent apply to this position?" required>
                <select className={inputClass} value={authorizations.clearinghouseLimitedQueryApplicable ?? ""} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,clearinghouseLimitedQueryApplicable:e.target.value as ""|"yes"|"no"}}))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No / not applicable</option></select>
              </Field>
              {authorizations.clearinghouseLimitedQueryApplicable==="yes" && <Field label="Are you registered with the FMCSA Clearinghouse?"><select className={inputClass} value={authorizations.clearinghouseRegistered ?? ""} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,clearinghouseRegistered:e.target.value as ""|"yes"|"no"}}))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></Field>}
              {authorizations.clearinghouseLimitedQueryApplicable==="yes" && <Field label="Limited-query consent scope" required><select className={inputClass} value={authorizations.clearinghouseConsentScope ?? ""} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,clearinghouseConsentScope:e.target.value as ""|"single"|"multiple"}}))}><option value="">Select</option><option value="single">One limited query</option><option value="multiple">Multiple limited queries during the stated period</option></select></Field>}
              {authorizations.clearinghouseLimitedQueryApplicable==="yes" && <Field label="Consent begins" required><DriverDateInput className={inputClass} value={authorizations.clearinghouseConsentStartDate ?? ""} onChange={(value)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,clearinghouseConsentStartDate:value}}))}/></Field>}
              {authorizations.clearinghouseLimitedQueryApplicable==="yes" && authorizations.clearinghouseConsentScope==="multiple" && <Field label="Consent ends" required><DriverDateInput className={inputClass} value={authorizations.clearinghouseConsentEndDate ?? ""} onChange={(value)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,clearinghouseConsentEndDate:value}}))}/></Field>}
            </div>
            {authorizations.clearinghouseLimitedQueryApplicable==="yes" && (
              <label className="mt-4 flex items-start gap-3 rounded-lg border border-[#BFDBFE] bg-white p-4 text-sm">
                <input type="checkbox" className="mt-1" checked={authorizations.clearinghouseLimitedQueryConsent ?? false} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,clearinghouseLimitedQueryConsent:e.target.checked}}))}/>
                <span>
                  I give the prospective employer permission to conduct {authorizations.clearinghouseConsentScope === "multiple" ? "limited queries" : "a limited query"} of my FMCSA Drug and Alcohol Clearinghouse record during the consent period shown above to determine whether the Clearinghouse indicates that drug or alcohol violation information about me exists. I understand that a limited query does not disclose the detailed information. If a limited query indicates that information exists, the employer must obtain the additional specific consent required by FMCSA before detailed information can be released. I understand that withholding consent may prevent me from performing safety-sensitive functions for this employer when FMCSA regulations require the query.
                </span>
              </label>
            )}
          </div>

          <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4">
            <h3 className="text-sm font-semibold text-[#78350F]">FMCSA Pre-Employment Screening Program (PSP)</h3>
            <p className="mt-1 text-xs leading-5 text-[#92400E]">
              PSP is a separate pre-employment screening process. FMCSA requires its prescribed PSP disclosure and authorization to be presented as a standalone document, in the required form, before a prospective employer requests a PSP record. TES must not substitute this application checkbox for that document.
            </p>
            <div className="mt-4">
              <Field label="Is PSP being used for this application?" required>
                <select className={inputClass} value={authorizations.pspApplicable ?? ""} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,pspApplicable:e.target.value as ""|"yes"|"no"}}))}><option value="">Select</option><option value="yes">Yes</option><option value="no">No / not applicable</option></select>
              </Field>
            </div>
            {authorizations.pspApplicable==="yes" && (
              <div className="mt-4 space-y-3 rounded-lg border border-[#FDE68A] bg-white p-4">
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={authorizations.pspOfficialFormPresented ?? false} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,pspOfficialFormPresented:e.target.checked}}))}/><span>I confirm that the standalone FMCSA-required PSP disclosure and authorization form has been presented to me separately from this application.</span></label>
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={authorizations.pspDisclosureReviewed ?? false} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,pspDisclosureReviewed:e.target.checked}}))}/><span>I acknowledge that I had the opportunity to review that standalone PSP disclosure before authorizing the request.</span></label>
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={authorizations.pspAuthorization ?? false} onChange={(e)=>updateDraft((d)=>({...d,authorizations:{...d.authorizations,pspAuthorization:e.target.checked}}))}/><span>I signed/authorized the standalone PSP document presented for this pre-employment screening request.</span></label>
                <p className="text-[11px] leading-5 text-[#92400E]">Production rule: TES should retain the exact standalone PSP artifact, its version, presentation timestamp and signature. This acknowledgement alone must never be treated as PSP authorization.</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-xs leading-5 text-[#4B5563]">
            TES records what was presented, accepted and signed. Applicability is determined from the carrier, jurisdiction, intended operation and driver role. A “not applicable” selection does not waive a requirement that actually applies.
          </div>

          <Field label="Type your full legal name to acknowledge the applicable selections above" required>
            <input className={inputClass} value={authorizations.signatureName} onChange={(e) => updateDraft((d) => ({ ...d, authorizations: { ...d.authorizations, signatureName: e.target.value } }))} placeholder={`${about.legalFirstName} ${about.legalLastName}`.trim()} />
          </Field>
          {authorizations.signatureName && enteredSignature !== expectedSignature ? <p className="text-xs font-medium text-[#B91C1C]">The typed name must match the legal first and last name entered in About You.</p> : null}

          <div className="flex items-center justify-between gap-4 border-t border-[#E7EDF5] pt-5">
            <button type="button" onClick={goBack} className="min-h-11 rounded-lg border border-[#D1D5DB] px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">Back</button>
            <button type="button" disabled={!authorizationsReady || saveState === "saving"} onClick={() => void markCompleteAndContinue()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1457F5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F4BDC] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]">Save & Continue</button>
          </div>
        </div>
      </section>
    )
  } else if (activeStep === "documents") {
    const updateDocument = (id: string, patch: Partial<(typeof documents.documents)[number]>) =>
      updateDraft((d) => ({
        ...d,
        documents: {
          ...d.documents,
          documentsReviewed: false,
          documents: d.documents.documents.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        },
      }))

    const addDocument = () =>
      updateDraft((d) => ({
        ...d,
        documents: {
          ...d.documents,
          documentsReviewed: false,
          documents: [
            ...d.documents.documents,
            {
              id: `document-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              category: "Other",
              label: "",
            },
          ],
        },
      }))

    const removeDocument = (id: string) =>
      updateDraft((d) => ({
        ...d,
        documents: {
          ...d.documents,
          documentsReviewed: false,
          documents: d.documents.documents.filter((item) => item.id !== id),
        },
      }))

    content = (
      <section className="overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E7EDF5] px-6 py-6 sm:px-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Evidence</div>
          <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">Documents</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
            Add the documents you currently have. TES can request additional evidence later when it is applicable to your actual operating and qualification requirements.
          </p>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-8">
          <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] p-4 text-sm leading-6 text-[#1E3A8A]">
            Your driver licence front and back were selected in Identity & Driver Photo. Do not upload them again here.
          </div>

          <div className="space-y-4">
            {documents.documents.map((item) => (
              <div key={item.id} className="rounded-[14px] border border-[#DDE6F0] bg-[#FCFDFE] p-4 sm:p-5">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Field label="Document type">
                    <select
                      className={inputClass}
                      value={item.category}
                      onChange={(e) => updateDocument(item.id, { category: e.target.value as typeof item.category })}
                    >
                      <option>Driver Abstract / MVR / CVOR</option>
                      <option>Medical / Health Certificate</option>
                      <option>Training Certificate</option>
                      <option>Work Authorization / Travel</option>
                      <option>Other</option>
                    </select>
                  </Field>
                  <Field label="Document description">
                    <input className={inputClass} value={item.label} onChange={(e) => updateDocument(item.id, { label: e.target.value })} placeholder="e.g. Alberta Driver Abstract" />
                  </Field>
                </div>

                <div className="mt-4">
                  <FileEvidenceField
                    label="Select document"
                    hint="Choose the clearest available image or PDF."
                    accept="image/*,.pdf"
                    value={item.file}
                    onChange={(file) => updateDocument(item.id, { file: fileSelection(file) })}
                  />
                </div>

                {!["driver-abstract", "medical"].includes(item.id) ? (
                  <button type="button" onClick={() => removeDocument(item.id)} className="mt-3 text-xs font-semibold text-[#B91C1C] hover:underline">Remove document</button>
                ) : null}
              </div>
            ))}
          </div>

          <button type="button" onClick={addDocument} className="min-h-10 rounded-lg border border-[#D1D5DB] px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">
            Add Another Document
          </button>

          <label className="flex items-start gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-sm text-[#374151]">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={documents.documentsReviewed} onChange={(e) => updateDraft((d) => ({ ...d, documents: { ...d.documents, documentsReviewed: e.target.checked } }))} />
            <span>
              <span className="font-semibold">I have added the documents I currently have available.</span>
              <span className="mt-1 block text-xs leading-5 text-[#6B7280]">Missing or additional applicable documents can be requested separately; their absence does not rewrite the information you have already provided.</span>
            </span>
          </label>

          <div className="flex items-center justify-between gap-4 border-t border-[#E7EDF5] pt-5">
            <button type="button" onClick={goBack} className="min-h-11 rounded-lg border border-[#D1D5DB] px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">Back</button>
            <button type="button" disabled={!documentsReady || saveState === "saving"} onClick={() => void markCompleteAndContinue()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1457F5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F4BDC] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]">
              Review Application
            </button>
          </div>
        </div>
      </section>
    )
  } else if (activeStep === "review") {
    const href = (step: DriverApplicationStepId) => driverApplicationStepHref(token, step)
    const completedBeforeReview = DRIVER_APPLICATION_STEPS.filter((step) => step.id !== "review").every((step) => record.completedSteps.includes(step.id))

    content = (
      <section className="overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#E7EDF5] px-6 py-6 sm:px-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Final review</div>
          <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">Review & Submit</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748B]">
            Review the information below carefully. Submission freezes this applicant record. TES/carrier review, evidence comparison, previous-employer verification and applicable external checks occur afterward; those review records do not silently alter your submitted answers.
          </p>
        </div>

        <div className="space-y-4 px-6 py-6 sm:px-8">
          {!completedBeforeReview ? (
            <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-sm leading-6 text-[#78350F]">
              One or more earlier sections are not marked complete. Return to those sections before final submission.
            </div>
          ) : null}

          <ReviewBlock title="About You" editHref={href("about-you")}>
            <SummaryRows rows={[
              ["Legal name", `${about.legalFirstName} ${about.legalMiddleName} ${about.legalLastName}`.replace(/\s+/g, " ").trim()],
              ["Date of birth", about.dateOfBirth],
              ["Email", about.email],
              ["Phone", about.phone],
              ["Current residence", [about.currentAddress, about.currentCity, about.currentJurisdiction, about.currentPostalCode, about.currentCountry].filter(Boolean).join(", ")],
              ["Previous 3-year residences", about.otherResidencesLast3Years === "yes" ? `${(about.priorAddresses ?? []).length} additional address(es)` : "None reported"],
              ["Employment type", about.employmentType],
              ["Citizenship / status", about.citizenshipStatus],
              ["Work authorization response", about.workAuthorized === "yes" ? "Yes" : about.workAuthorized === "no" ? "No" : ""],
              ["U.S. travel", about.ableToTravelUnitedStates],
              ["Education", about.highestEducation],
              ["English proficiency (self-reported)", about.englishProficiency],
            ]} />
          </ReviewBlock>

          <ReviewBlock title="Driving & Licence" editHref={href("driving-licence")}>
            <SummaryRows rows={[
              ["Licence", [licence.licenceNumber, licence.licenceClass].filter(Boolean).join(" · ")],
              ["Issued by", [licence.jurisdiction, licence.country].filter(Boolean).join(", ")],
              ["Expiry", licence.expiryDate],
              ["Operating availability", [licence.willingCanada ? "Canada" : "", licence.willingUnitedStates ? "United States" : ""].filter(Boolean).join(" + ")],
              ["Endorsements", licence.endorsements],
              ["Restrictions", licence.restrictions],
              ["First commercial licence", licence.firstCommercialLicenceDate],
              ["Previous / transferred licences", licence.recentlyTransferredOrOtherLicenceLast3Years === "yes" ? `${(licence.previousLicences ?? []).length} record(s)` : "None reported"],
              ["Other jurisdiction / name", licence.otherJurisdictionOrName],
              ["Denied / suspended / revoked", licence.everDeniedSuspendedRevoked],
              ["Can perform essential safety-related duties", licence.safetyAffectingMedicalCondition],
              ["Unpardoned conviction", licence.unpardonedCriminalConviction],
              ["Drug / alcohol test declaration", licence.drugAlcoholPositiveRefusalAlterSubstitute],
              ["Other company while employed", licence.otherCompanyWhileEmployed],
            ]} />
          </ReviewBlock>

          <ReviewBlock title="Experience & Safety History" editHref={href("experience-safety")}>
            <SummaryRows rows={[
              ["Commercial experience", safety.commercialDrivingYears === "" ? "" : `${safety.commercialDrivingYears} years`],
              ["Equipment notes", safety.equipmentExperience],
              ["Equipment types", (safety.equipmentTypes ?? []).join(", ")],
              ["Operating regions", (safety.operatingRegions ?? []).join(", ")],
              ["Terrain / road experience", (safety.terrainExperience ?? []).join(", ")],
              ["Collisions reported", safety.collisionsLast5Years === "yes" ? `${safety.collisions.length} item(s)` : safety.collisionsLast5Years === "no" ? "None reported" : ""],
              ["Convictions / violations reported", safety.convictionsLast5Years === "yes" ? `${safety.convictions.length} item(s)` : safety.convictionsLast5Years === "no" ? "None reported" : ""],
            ]} />
          </ReviewBlock>

          <ReviewBlock title="Employment History" editHref={href("employment")}>
            <div className="space-y-3">
              {employment.history.map((item) => (
                <div key={item.id} className="rounded-lg bg-[#F9FAFB] p-3 text-sm">
                  <div className="font-semibold">{item.employerName} · {item.historyType ?? "Employment"}{item.position ? ` · ${item.position}` : ""}</div>
                  <div className="mt-1 text-xs text-[#6B7280]">
                    {item.startDate} → {item.currentlyEmployed ? "Present" : item.endDate} · {[item.city, item.stateProvince, item.country].filter(Boolean).join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </ReviewBlock>

          <ReviewBlock title="Authorizations" editHref={href("authorizations")}>
            <SummaryRows rows={[
              ["Application information", authorizations.informationAccuracy ? "Acknowledged" : "Not acknowledged"],
              ["Employment verification", authorizations.employmentVerification ? "Authorized" : "Not authorized"],
              ["Driver record / MVR", authorizations.mvrAuthorization ? "Authorized" : "Not authorized"],
              ["Background-related verification", authorizations.backgroundAuthorization ? "Authorized" : "Not authorized"],
              ["Electronic records", authorizations.electronicRecordsConsent ? "Accepted" : "Not accepted"],
              ["Driver certifications", authorizations.driverCertificationsAccepted ? "Certified" : "Not certified"],
              ["Prior 7-day on-duty hours", authorizations.previous7DaysOnDutyHours],
              ["HOS reset / first-trip certification", authorizations.hosResetCertification ? "Certified" : "Not certified"],
              ["Prior 14-day HOS statement", authorizations.hosPrevious14DaysCertification ? "Certified" : "Not certified"],
              ["Clearinghouse limited-query applicability", authorizations.clearinghouseLimitedQueryApplicable],
              ["Clearinghouse limited-query consent", authorizations.clearinghouseLimitedQueryApplicable === "yes" ? (authorizations.clearinghouseLimitedQueryConsent ? "Consented" : "Not consented") : "Not applicable"],
              ["PSP applicability", authorizations.pspApplicable],
              ["PSP disclosure / authorization", authorizations.pspApplicable === "yes" ? (authorizations.pspDisclosureReviewed && authorizations.pspAuthorization ? "Reviewed and authorized" : "Incomplete") : "Not applicable"],
            ]} />
          </ReviewBlock>

          <ReviewBlock title="Documents" editHref={href("documents")}>
            <div className="space-y-2">
              {documents.documents.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-4 rounded-lg bg-[#F9FAFB] px-3 py-2 text-sm">
                  <span>{item.label || item.category}</span>
                  <span className={`text-xs font-semibold ${item.file ? "text-[#166534]" : "text-[#6B7280]"}`}>{item.file ? "Selected" : "Not selected"}</span>
                </div>
              ))}
            </div>
          </ReviewBlock>

          <div className="mt-5 rounded-[14px] border border-[#DDE6F0] bg-[#FCFDFE] p-4 sm:p-5">
            <h3 className="text-sm font-semibold">Final certification</h3>
            <div className="mt-4 space-y-3">
              <label className="flex items-start gap-3 text-sm text-[#374151]">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={finalCertification.reviewedApplication} onChange={(e) => updateDraft((d) => ({ ...d, finalCertification: { ...d.finalCertification, reviewedApplication: e.target.checked } }))} />
                <span>I have reviewed the information in this application before submission.</span>
              </label>
              <label className="flex items-start gap-3 text-sm text-[#374151]">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={finalCertification.certificationAccepted} onChange={(e) => updateDraft((d) => ({ ...d, finalCertification: { ...d.finalCertification, certificationAccepted: e.target.checked } }))} />
                <span>I certify that the information I am submitting is complete and accurate to the best of my knowledge.</span>
              </label>
            </div>

            <div className="mt-4">
              <Field label="Type your full legal name" required>
                <input className={inputClass} value={finalCertification.signatureName} onChange={(e) => updateDraft((d) => ({ ...d, finalCertification: { ...d.finalCertification, signatureName: e.target.value } }))} placeholder={`${about.legalFirstName} ${about.legalLastName}`.trim()} />
              </Field>
              {finalCertification.signatureName && finalSignature !== expectedSignature ? (
                <p className="mt-2 text-xs font-medium text-[#B91C1C]">The typed name must match the legal first and last name entered in About You.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-xs leading-5 text-[#78350F]">
            Development mode: this submission creates an immutable browser-stored snapshot so the workflow and freeze behavior can be tested now. Before real applicant testing, this exact operation must move to the authenticated TES server/database transaction.
          </div>

          {submitState === "error" ? (
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm font-medium text-[#B91C1C]">
              The application could not be submitted. Your existing draft has not been intentionally changed. Try again.
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4 border-t border-[#E7EDF5] pt-5">
            <button type="button" onClick={goBack} disabled={submitState === "submitting"} className="min-h-11 rounded-lg border border-[#D1D5DB] px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50">Back</button>
            <button
              type="button"
              disabled={!completedBeforeReview || !finalCertificationReady || submitState === "submitting"}
              onClick={() => void submitApplication()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1457F5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F4BDC] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
            >
              {submitState === "submitting" ? "Submitting…" : "Submit Application"}
            </button>
          </div>
        </div>
      </section>
    )
  } else {
    const step = DRIVER_APPLICATION_STEPS.find((item) => item.id === activeStep)!
    content = (
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm sm:p-8">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1457F5]">Next section</div>
        <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-2xl">{step.label}</h1>
        <p className="mt-3 text-sm leading-6 text-[#6B7280]">
          The shared shell and autosave boundary are active. This section will be connected next without changing the completed sections.
        </p>
        <div className="mt-6">
          <button type="button" onClick={goBack} className="min-h-11 rounded-lg border border-[#D1D5DB] px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">Back</button>
        </div>
      </section>
    )
  }

  return (
    <DriverApplicationShell
      token={token}
      employerName={employerName}
      employerContact={employerContact}
      applicantName={applicantName}
      activeStep={activeStep}
      completedSteps={record.completedSteps}
      lastSavedAt={record.lastSavedAt}
      saveState={saveState}
    >
      {content}
    </DriverApplicationShell>
  )
}
