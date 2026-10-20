"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, FileBadge, Lock, MapPin, MessageSquare, RefreshCw, Save, Truck, XCircle } from "lucide-react"

import { CARGO_CATEGORY_DEFINITIONS, PAYMENT_METHOD_DEFINITIONS } from "@/lib/company-profile/definitions"
import { COMPANY_FIELD_INVENTORY } from "@/lib/company-directory/field-inventory"
import {
  ADDRESS_KEYS,
  ADDRESS_PARTS,
  buildPatch,
  changedFields,
  channelReplacements,
  valuesFromRecords,
  validateEdit,
  type AddressKey,
  type EditIssue,
  type EditValues,
} from "@/lib/company-directory/edit-validation"
import { ENGAGEMENT_END_REASONS } from "@/lib/customer-relationship/definitions"
import { CompanyMissing } from "@/components/company-missing"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EditTabs, Field, ReadOnlyRow, Section } from "@/src/components/company/form-parts"
import { LegalNameChange } from "@/src/components/company/LegalNameChange"

type EditRecord = { id: string; companyName: string; dba: string; incorpNo: string; businessNo: string; ein: string; formationCountry: string | null; formationRegion: string | null }
type Access = { identity: boolean; communication: boolean; operatingProfile: boolean; billing: boolean; registrations: boolean; service: boolean; legalName: boolean }
type ServiceTypeState = { state: "contracted"; packages: string[]; contractReference: string | null } | { state: "not_contracted" } | { state: "restricted" }
type Holder = { personId: string; name: string | null; since: string } | null
type Profile = Record<string, unknown> & {
  kind: string
  legalName: string
  status: string
  region: string
  serviceStage: string | null
  startDate: string | null
  serviceType: ServiceTypeState | null
  sections: Record<string, "ok" | "not_permitted">
  editAccess: Access
  changeTracking: "ABSENT" | "COMPLETE" | "INCONSISTENT"
  channelsEverRecorded: Record<"website" | "phone" | "email" | "billingEmail", boolean> | null
  customerDetails: null | {
    authorities: { state: "ok"; serviceDecisionAuthority: Holder; contractSignatory: Holder; samePerson: boolean | null } | { state: "restricted" }
    contracts: { state: "ok"; byStatus: Record<string, number>; signedInForce: boolean; signedReference: string | null } | { state: "restricted" }
  }
}
type Banner = { kind: "success" | "error" | "warning"; text: string; detail?: string[] } | null
type Phase = "loading" | "ready" | "missing" | "failed"

const NO_ACCESS: Access = { identity: false, communication: false, operatingProfile: false, billing: false, registrations: false, service: false, legalName: false }
const UNSAVED = "You have unsaved changes. Leave this page and discard them?"
const TABS = [
  { id: "company", label: "Company" },
  { id: "registrations", label: "Registrations" },
  { id: "communication", label: "Phone, email & web" },
  { id: "addresses", label: "Addresses" },
  { id: "service", label: "Service & fleet" },
] as const
type TabId = (typeof TABS)[number]["id"]

/** Which tab a field belongs to (so errors and unsaved changes can be counted per tab and the first problem can be shown). */
const TAB_OF = (field: string): TabId => {
  if (["dba", "opRegion"].includes(field)) return "company"
  if (["incorpNo", "businessNo", "ein", "gstHst"].includes(field)) return "registrations"
  if (["website", "phone", "email", "billingEmail", "channelChangeReference", "channelChangeSender", "channelChangeSource"].includes(field)) return "communication"
  if (/^(reg|mail|yard)_/.test(field)) return "addresses"
  if (["dbaBasis", "dbaBasisReference"].includes(field)) return "company"
  return "service"
}

const ADDRESS_BLOCKS = [
  { prefix: "reg", title: "Registered address", customerOnly: false },
  { prefix: "mail", title: "Mailing address", customerOnly: true },
  { prefix: "yard", title: "Yard / home terminal address", customerOnly: true },
] as const
const PART_LABEL = { street: "Street", city: "City", state: "Province / State", zip: "Postal / ZIP", country: "Country" } as const
const CHANNEL_LABEL: Record<string, string> = { website: "Website", phone: "Phone", email: "Account email", billingEmail: "Billing email" }

const asText = (value: unknown) => (typeof value === "string" ? value : "")
const workspace = (id: string, name: string) => `/companies/${encodeURIComponent(id)}/${name}`

/** Warn before the browser leaves, before an in-app link is followed and before the Back button leaves, while there are unsaved changes. */
function useUnsavedChangesGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.target === "_blank" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return
      if (!window.confirm(UNSAVED)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const onPopState = () => {
      if (!dirtyRef.current) return
      if (window.confirm(UNSAVED)) {
        window.removeEventListener("popstate", onPopState)
        window.history.go(-1)
      } else {
        window.history.pushState({ ...(window.history.state ?? {}), tesGuard: true }, "", window.location.href)
      }
    }
    if (!window.history.state?.tesGuard) window.history.pushState({ ...(window.history.state ?? {}), tesGuard: true }, "", window.location.href)
    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onClick, true)
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("popstate", onPopState)
    }
  }, [dirty])
}

export default function EditCompanyPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string
  const [phase, setPhase] = useState<Phase>("loading")
  const [record, setRecord] = useState<EditRecord | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [baseline, setBaseline] = useState<EditValues | null>(null)
  const [values, setValues] = useState<EditValues | null>(null)
  const [tab, setTab] = useState<TabId>("company")
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [serverIssues, setServerIssues] = useState<EditIssue[]>([])
  const [banner, setBanner] = useState<Banner>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [stale, setStale] = useState(false)
  const [legalOpen, setLegalOpen] = useState(false)
  const [replacement, setReplacement] = useState({ source: "COMPANY_WRITTEN_REQUEST", reference: "", sender: "" })
  const [dbaBasis, setDbaBasis] = useState({ kind: "", reference: "" })

  /** Reads the canonical record again and makes it the new baseline (initial load, after a save, and after a lifecycle action). */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const [editResponse, profileResponse] = await Promise.all([
        fetch(`/api/companies/${encodeURIComponent(companyId)}`, { cache: "no-store" }),
        fetch(`/api/companies/${encodeURIComponent(companyId)}/profile`, { cache: "no-store" }),
      ])
      if (editResponse.status === 404 || profileResponse.status === 404) {
        setPhase("missing")
        return false
      }
      if (!editResponse.ok || !profileResponse.ok) {
        setPhase((current) => (current === "loading" ? "failed" : current))
        return false
      }
      const edit = (await editResponse.json()).company as EditRecord
      const loaded = (await profileResponse.json()).company as Profile | null
      if (!loaded) {
        setPhase("missing")
        return false
      }
      const canonical = valuesFromRecords(edit, loaded)
      setRecord(edit)
      setProfile(loaded)
      setBaseline(canonical)
      setValues(canonical)
      setTouched(new Set())
      setSubmitted(false)
      setServerIssues([])
      setReplacement({ source: "COMPANY_WRITTEN_REQUEST", reference: "", sender: "" })
      setDbaBasis({ kind: "", reference: "" })
      setStale(false)
      setPhase("ready")
      return true
    } catch {
      setPhase((current) => (current === "loading" ? "failed" : current))
      return false
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  const access = profile?.editAccess ?? NO_ACCESS
  const isCustomer = profile?.kind === "Customer"
  const contactsWithheld = profile?.sections?.contacts === "not_permitted"
  const registrationsWithheld = profile?.sections?.registrations === "not_permitted"
  const profileWithheld = profile?.sections?.operatingProfile === "not_permitted"
  const customerWithheld = profile?.sections?.customer === "not_permitted"
  const tracking = profile?.changeTracking ?? "ABSENT"
  const trackingNote =
    tracking === "INCONSISTENT"
      ? "Company change tracking is partly set up on this database (migration 0036), so edits are paused until it is repaired. Nothing can be saved."
      : "Company change tracking (database migration 0036) has not been applied yet. Edits are still recorded in the Master Register, but the change history is unavailable, and changing the legal name or replacing an established phone, email or website is not available until it is applied."

  const changed = useMemo(() => (values && baseline ? new Set(changedFields(values, baseline)) : new Set<string>()), [values, baseline])
  const everRecorded = profile?.channelsEverRecorded ?? null
  const replacements = useMemo(() => (values && baseline ? channelReplacements(values, baseline, everRecorded) : []), [values, baseline, everRecorded])
  const dbaChanged = changed.has("dba")
  const dirty = changed.size > 0

  /** Why a field cannot be changed by this viewer (null = editable). The server re-proves every capability when the change is saved. */
  const lockReason = (field: string): string | null => {
    if (!access.identity) return "You can view this company but do not have permission to edit company records."
    if (tracking === "INCONSISTENT") return "Edits are paused: company change tracking is partly set up on this database."
    if (["website", "phone", "email", "billingEmail"].includes(field)) {
      if (field !== "website" && contactsWithheld) return "Restricted: you do not have permission to view or change the company's contact details."
      if (!access.communication) return "You do not have permission to change the company's phone, email or website."
      if (tracking !== "COMPLETE" && baseline && (baseline[field as "website"] !== "" || profile?.channelsEverRecorded?.[field as "website"])) return "Replacing or removing an established value needs company change tracking (database migration 0036), which is not available yet."
    }
    if (field === "gstHst") {
      if (registrationsWithheld) return "Restricted: you do not have permission to view or change tax registrations."
      if (!access.registrations) return "You do not have permission to change tax registrations."
    }
    if (field === "opRegion" && !access.operatingProfile) return "You do not have permission to change the operating profile."
    if (["cargoTypes", "eldProvider", "gpsProvider", "fuelProvider"].includes(field)) {
      if (profileWithheld) return "Restricted: you do not have permission to view or change the operating profile."
      if (!access.operatingProfile) return "You do not have permission to change the operating profile."
    }
    if (field === "payMethod") {
      if (customerWithheld) return "Restricted: you do not have permission to view or change the customer relationship."
      if (!access.billing) return "You do not have permission to change the customer relationship."
    }
    if (/^(mail|yard)_/.test(field) && customerWithheld) return "Restricted: you do not have permission to view or change customer addresses."
    return null
  }

  const ctx = useMemo(
    () => ({ isCustomer, formationCountry: record?.formationCountry ?? null, contactsWithheld, registrationsWithheld }),
    [isCustomer, record?.formationCountry, contactsWithheld, registrationsWithheld],
  )
  const localIssues = useMemo<EditIssue[]>(() => {
    if (!values || !baseline) return []
    const found = validateEdit(values, baseline, ctx)
    if (replacements.length > 0 && replacement.reference.trim().length < 3) found.push({ field: "channelChangeReference", message: "Say how the change was requested (at least 3 characters) so it can be confirmed." })
    if (dbaChanged && dbaBasis.kind && dbaBasis.reference.trim().length < 3) found.push({ field: "dbaBasisReference", message: "Say how the trade-name change was confirmed (at least 3 characters)." })
    return found
  }, [values, baseline, ctx, replacements.length, replacement.reference, dbaChanged, dbaBasis])

  /** The message shown under a field: a server refusal wins; a local problem shows once the field was touched or a save was attempted. */
  const issueFor = (field: string): string | null => {
    const server = serverIssues.find((issue) => issue.field === field)
    if (server) return server.message
    if (!submitted && !touched.has(field)) return null
    return localIssues.find((issue) => issue.field === field)?.message ?? null
  }
  const visibleIssues = useMemo(
    () => [...serverIssues, ...localIssues.filter((issue) => submitted || touched.has(issue.field))].filter((issue, index, all) => all.findIndex((other) => other.field === issue.field) === index),
    [serverIssues, localIssues, submitted, touched],
  )
  const tabs = TABS.filter((entry) => entry.id !== "service" || isCustomer).map((entry) => ({
    ...entry,
    changes: [...changed].filter((field) => TAB_OF(field) === entry.id).length,
    errors: visibleIssues.filter((issue) => TAB_OF(issue.field) === entry.id).length,
  }))

  useUnsavedChangesGuard(dirty && !saving)

  const set = <K extends keyof EditValues>(field: K, value: EditValues[K]) => {
    setValues((current) => (current ? { ...current, [field]: value } : current))
    setServerIssues((current) => current.filter((issue) => issue.field !== field))
    setBanner((current) => (current?.kind === "success" ? null : current))
  }
  const touch = (field: string) => setTouched((current) => (current.has(field) ? current : new Set(current).add(field)))
  const bind = (field: Exclude<keyof EditValues, "cargoTypes">) => ({
    id: field,
    name: field,
    value: values?.[field] ?? "",
    "aria-invalid": issueFor(field) ? true : undefined,
    "aria-describedby": issueFor(field) ? `${field}-error` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(field, event.target.value as never),
    onBlur: () => touch(field),
    disabled: lockReason(field) !== null || saving || stale,
  })

  const summarize = (details: Record<string, unknown> | null | undefined): string[] => {
    const lines: string[] = []
    if (!details) return lines
    const addresses = (details.addresses as Array<{ role: string; action: string }> | undefined) ?? []
    for (const entry of addresses) if (entry.action !== "unchanged") lines.push(`${entry.role === "HOME_YARD" ? "Yard" : entry.role[0] + entry.role.slice(1).toLowerCase()} address ${entry.action}${entry.action === "changed" ? " (the previous address is kept in history)" : ""}`)
    if (details.website === "pending_confirmation") lines.push("Website: the change is awaiting confirmation with verified evidence; the current website stays in use until then")
    for (const channel of (details.channels as Array<{ field: string; action: string }> | undefined) ?? []) {
      if (channel.action === "pending_confirmation") lines.push(`${CHANNEL_LABEL[channel.field] ?? channel.field}: the change is awaiting confirmation with verified evidence; the current value stays in use until then`)
    }
    return lines
  }

  const save = async () => {
    if (!values || !baseline || !profile || savingRef.current) return
    setSubmitted(true)
    setBanner(null)
    if (localIssues.length > 0) {
      const first = localIssues[0]
      setTab(TAB_OF(first.field))
      setBanner({ kind: "error", text: `Nothing was saved. Fix ${localIssues.length === 1 ? "the highlighted problem" : `the ${localIssues.length} highlighted problems`} and try again.` })
      window.setTimeout(() => document.getElementById(first.field)?.focus(), 50)
      return
    }
    const body = buildPatch(values, baseline, {
      includeContacts: !contactsWithheld && access.communication,
      includeRegistrations: !registrationsWithheld && access.registrations,
      isCustomer,
      replacement,
      dbaBasis,
      everRecorded,
    })
    if (Object.keys(body).length === 0) return
    savingRef.current = true
    setSaving(true)
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const issues: EditIssue[] = Array.isArray(payload?.issues) ? payload.issues : []
        setServerIssues(issues)
        if (issues[0]) setTab(TAB_OF(issues[0].field))
        const unplaced = issues.filter((issue) => !document.getElementById(issue.field) && !(ADDRESS_KEYS as string[]).includes(issue.field))
        setBanner({
          kind: "error",
          text: response.status === 403 ? (payload?.error ?? "You are not permitted to save one or more of these changes.") : (payload?.error ?? "The changes could not be saved."),
          detail: unplaced.map((issue) => issue.message),
        })
        return // the entered values stay exactly as typed
      }
      const lines = summarize(payload?.details)
      const refreshed = await load()
      if (refreshed) setBanner({ kind: "success", text: "Changes saved.", detail: lines })
      else {
        setStale(true)
        setBanner({ kind: "warning", text: "Your changes were saved, but the page could not re-read the record. Reload the page before editing again.", detail: lines })
      }
    } catch {
      setBanner({ kind: "error", text: "The changes could not be saved because the server could not be reached. Your entries are still here; try again." })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const cancel = () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return
    if (baseline) setValues(baseline)
    router.push(`/companies/${encodeURIComponent(companyId)}/profile`)
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <PageHeader title="Edit Company" />
        <div className="h-10 w-2/3 animate-pulse rounded-lg bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
        <span className="sr-only">Loading company…</span>
      </div>
    )
  }
  if (phase === "missing") return <CompanyMissing failed={false} />
  if (phase === "failed" || !record || !profile || !values || !baseline) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 p-10 text-center">
        <p>The company could not be opened. This is a temporary or permission problem, not a missing company.</p>
        <Button variant="outline" onClick={() => { setPhase("loading"); void load() }}>
          <RefreshCw className="mr-2 size-4" /> Try again
        </Button>
      </div>
    )
  }

  const readOnlyForm = !access.identity
  const group = (names: string[]) => names.filter((name) => changed.has(name)).length
  const details = profile.customerDetails
  const serviceEnded = profile.serviceStage === "ENDED" || (!profile.serviceStage && Boolean(profile.endDate))

  const textField = (field: Exclude<keyof EditValues, "cargoTypes">, label: string, extra: { type?: string; placeholder?: string; maxLength?: number; hint?: string; className?: string } = {}) => (
    <Field label={label} htmlFor={field} error={issueFor(field)} locked={lockReason(field)} hint={extra.hint} className={extra.className}>
      <Input {...bind(field)} type={extra.type} placeholder={extra.placeholder} maxLength={extra.maxLength} autoComplete="off" />
    </Field>
  )

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Edit Company"
        description={`${asText(profile.name)} · ${profile.kind} · ${profile.status}`}
        actions={
          <Button variant="outline" onClick={cancel}>
            <ArrowLeft className="mr-2 size-4" />
            Back to profile
          </Button>
        }
      />

      {readOnlyForm && (
        <div role="note" className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>You can view this company but you do not have permission to edit company records. Every field below is read-only.</span>
        </div>
      )}

      {tracking !== "COMPLETE" && !readOnlyForm && (
        <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>{trackingNote}</span>
        </div>
      )}

      {banner && (
        <div
          role={banner.kind === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${banner.kind === "success" ? "border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-950/20" : banner.kind === "warning" ? "border-amber-500/40 bg-amber-50/70 dark:bg-amber-950/20" : "border-destructive/30 bg-destructive/5"}`}
        >
          {banner.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : banner.kind === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
          <div className="min-w-0">
            <p className={`font-medium ${banner.kind === "error" ? "text-destructive" : ""}`}>{banner.text}</p>
            {banner.detail && banner.detail.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {banner.detail.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
            {banner.kind === "success" && (
              <Link href={`/companies/${encodeURIComponent(companyId)}/profile`} className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">View profile</Link>
            )}
          </div>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        className="flex max-w-6xl flex-col gap-4"
        noValidate
        aria-label="Edit company"
      >
        <EditTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />

        {/* ------------------------------------------------------------ COMPANY */}
        <div role="tabpanel" id="panel-company" aria-labelledby="tab-company" hidden={tab !== "company"} className="flex flex-col gap-4">
          <Section title="Company identity" icon={Building2} accent>
            <Field label="Registered legal name" className="sm:col-span-2" locked="Changes only through a verified request: a government document, the company's written request and an authorized TES approver. It is never changed by Save Changes.">
              <div className="flex gap-2">
                <Input readOnly value={record.companyName} aria-label="Registered legal name" className="bg-muted/30" />
                <Button type="button" variant="outline" disabled={readOnlyForm || tracking !== "COMPLETE"} title={tracking !== "COMPLETE" ? "Needs company change tracking (migration 0036)" : undefined} onClick={() => setLegalOpen(true)}>Change…</Button>
              </div>
            </Field>
            {textField("dba", "DBA / trade name", { maxLength: 200 })}
            {dbaChanged && (
              <div className="sm:col-span-2 lg:col-span-4 grid gap-4 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-3" role="group" aria-label="Trade-name basis">
                <Field label="Trade name confirmed by" htmlFor="dbaBasis">
                  <select id="dbaBasis" value={dbaBasis.kind} onChange={(event) => setDbaBasis({ ...dbaBasis, kind: event.target.value })} className="h-9 w-full rounded-lg border bg-background px-3 text-sm">
                    <option value="">Not recorded</option>
                    <option value="BUSINESS_CONFIRMATION">Business confirmation</option>
                    <option value="REGISTRATION_EVIDENCE">Registration evidence</option>
                  </select>
                </Field>
                {dbaBasis.kind && (
                  <Field label="Reference" htmlFor="dbaBasisReference" error={issueFor("dbaBasisReference")} className="sm:col-span-2">
                    <Input id="dbaBasisReference" value={dbaBasis.reference} onChange={(event) => setDbaBasis({ ...dbaBasis, reference: event.target.value })} onBlur={() => touch("dbaBasisReference")} placeholder="Who confirmed it, or the registration number" />
                  </Field>
                )}
              </div>
            )}
            <Field label="Operating region" htmlFor="opRegion" error={issueFor("opRegion")} locked={lockReason("opRegion")}>
              <select {...bind("opRegion")} className="h-9 w-full rounded-lg border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                {baseline.opRegion === "" && <option value="">Not recorded</option>}
                <option value="Canada Only">Canada Only</option>
                <option value="US Only">US Only</option>
                <option value="Cross-Border">Cross-Border</option>
              </select>
            </Field>
            <ReadOnlyRow label="Company record type" value={profile.kind} reason={COMPANY_FIELD_INVENTORY.kind.note} />
            <ReadOnlyRow label="Record status" value={profile.status} reason={COMPANY_FIELD_INVENTORY.status.note} />
            <ReadOnlyRow label="Registered in" value={profile.region === "Not recorded" ? null : profile.region} reason={COMPANY_FIELD_INVENTORY.region.note} />
          </Section>
        </div>

        {/* ------------------------------------------------------------ REGISTRATIONS */}
        <div role="tabpanel" id="panel-registrations" aria-labelledby="tab-registrations" hidden={tab !== "registrations"} className="flex flex-col gap-4">
          <Section title="Business registrations" icon={FileBadge}>
            {textField("incorpNo", "Incorporation / charter number", { maxLength: 60 })}
            {textField("businessNo", "CRA Business Number (BN)", { placeholder: "123456789", maxLength: 20 })}
            {textField("gstHst", "GST/HST account", { placeholder: "123456789 RT 0001", maxLength: 40 })}
            {textField("ein", "IRS Employer ID (EIN)", { placeholder: "12-3456789", maxLength: 20 })}
          </Section>
          <Section title="Carrier and tax accounts managed elsewhere" icon={FileBadge}>
            {([
              ["usdot", "authorities"], ["mc", "authorities"], ["nsc", "authorities"], ["mvid", "authorities"], ["accIrp", "authorities"],
              ["accIfta", "tax-filing"], ["accNyhut", "tax-filing"], ["accNm", "tax-filing"], ["accKyu", "tax-filing"], ["accOr", "tax-filing"], ["accCt", "tax-filing"], ["scac", "tax-filing"], ["carrierCode", "tax-filing"],
            ] as const)
              .filter(([key]) => asText(profile[key]) !== "")
              .map(([key, place]) => (
                <ReadOnlyRow key={key} label={COMPANY_FIELD_INVENTORY[key].label} value={asText(profile[key])} />
              ))}
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
              Carrier numbers (USDOT, MC, NSC, MVID, IRP) are managed in{" "}
              <Link href={workspace(companyId, "authorities")} className="font-semibold text-primary hover:underline">Authorities</Link>, and tax-programme accounts and customs codes in{" "}
              <Link href={workspace(companyId, "tax-filing")} className="font-semibold text-primary hover:underline">Tax Filing</Link>; each has its own history and jurisdiction rules.
            </p>
          </Section>
        </div>

        {/* ------------------------------------------------------------ COMMUNICATION */}
        <div role="tabpanel" id="panel-communication" aria-labelledby="tab-communication" hidden={tab !== "communication"} className="flex flex-col gap-4">
          <Section title="Company phone, email and website" icon={MessageSquare}>
            {textField("website", "Website", { type: "url", placeholder: "https://", maxLength: 254 })}
            {textField("phone", "Phone", { type: "tel", maxLength: 40 })}
            {textField("email", "Account email", { type: "email", maxLength: 254 })}
            {textField("billingEmail", "Billing email", { type: "email", maxLength: 254 })}
            {replacements.length > 0 && (
              <div className="sm:col-span-2 lg:col-span-4 grid gap-4 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 sm:grid-cols-3 dark:bg-amber-950/20" role="group" aria-label="Replacement needs confirmation">
                <p className="sm:col-span-3 text-xs font-medium text-amber-800 dark:text-amber-300">
                  {replacements.map((entry) => `${entry.label} (${entry.removal ? "removal" : "replacement"})`).join(", ")}: changing or removing an established value waits for confirmation with verified evidence through an established channel, by a different TES user; the current value stays in use until then.
                </p>
                <Field label="Requested by" htmlFor="channelChangeSource">
                  <select id="channelChangeSource" value={replacement.source} onChange={(event) => setReplacement({ ...replacement, source: event.target.value })} className="h-9 w-full rounded-lg border bg-background px-3 text-sm">
                    <option value="COMPANY_WRITTEN_REQUEST">Company written request</option>
                    <option value="COMPANY_VERBAL_CONFIRMED">Company verbal instruction</option>
                    <option value="STAFF_ENTRY">TES staff entry</option>
                  </select>
                </Field>
                <Field label="Reference" htmlFor="channelChangeReference" error={issueFor("channelChangeReference")}>
                  <Input id="channelChangeReference" value={replacement.reference} onChange={(event) => setReplacement({ ...replacement, reference: event.target.value })} onBlur={() => touch("channelChangeReference")} placeholder="e.g. email of 2026-10-19" aria-invalid={issueFor("channelChangeReference") ? true : undefined} />
                </Field>
                <Field label="Sender address (if any)" htmlFor="channelChangeSender">
                  <Input id="channelChangeSender" type="email" value={replacement.sender} onChange={(event) => setReplacement({ ...replacement, sender: event.target.value })} />
                </Field>
              </div>
            )}
            <ReadOnlyRow
              label="Primary Contact"
              value={contactsWithheld ? "Restricted" : asText(profile.contact) || null}
              reason="A person is designated Primary Contact in Contacts, never typed here."
              href={workspace(companyId, "contacts")}
              linkLabel="Open Contacts"
              className="sm:col-span-2"
            />
          </Section>
        </div>

        {/* ------------------------------------------------------------ ADDRESSES */}
        <div role="tabpanel" id="panel-addresses" aria-labelledby="tab-addresses" hidden={tab !== "addresses"} className="flex flex-col gap-4">
          <Section title="Addresses" icon={MapPin} grid={false}>
            {ADDRESS_BLOCKS.filter((block) => !block.customerOnly || isCustomer).map((block) => {
              const keys = ADDRESS_PARTS.map((part) => `${block.prefix}_${part}` as AddressKey)
              const blockChanged = keys.some((key) => changed.has(key))
              return (
                <fieldset key={block.prefix} className="space-y-2" disabled={saving || stale}>
                  <legend className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    {block.title}
                    {blockChanged && <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">changed</span>}
                  </legend>
                  <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
                    {ADDRESS_PARTS.map((part) => {
                      const key = `${block.prefix}_${part}` as AddressKey
                      return (
                        <Field key={key} label={PART_LABEL[part]} htmlFor={key} error={issueFor(key)} locked={part === "street" ? lockReason(key) : null}>
                          <Input {...bind(key)} autoComplete="off" />
                        </Field>
                      )
                    })}
                  </div>
                  {blockChanged && <p className="text-[11px] text-muted-foreground">A changed address is recorded as a move: the previous address stays in history with its dates.</p>}
                </fieldset>
              )
            })}
          </Section>
        </div>

        {/* ------------------------------------------------------------ SERVICE & FLEET */}
        {isCustomer && (
          <div role="tabpanel" id="panel-service" aria-labelledby="tab-service" hidden={tab !== "service"} className="flex flex-col gap-4">
            <Section title="Fleet and billing preferences" icon={Truck}>
              <Field label="Preferred payment method" htmlFor="payMethod" error={issueFor("payMethod")} locked={lockReason("payMethod")} hint="A billing preference only. Contract payment terms are agreed separately and no payment credentials are stored.">
                <select {...bind("payMethod")} className="h-9 w-full rounded-lg border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                  <option value="">Not specified</option>
                  {PAYMENT_METHOD_DEFINITIONS.map((method) => <option key={method.code} value={method.displayName}>{method.displayName}</option>)}
                </select>
              </Field>
              {textField("eldProvider", "ELD / HOS provider", { maxLength: 120 })}
              {textField("gpsProvider", "Truck GPS provider", { maxLength: 120 })}
              {textField("fuelProvider", "Fuel provider", { maxLength: 120 })}
              <Field label="Cargo types" className="sm:col-span-2 lg:col-span-4" error={issueFor("cargoTypes")} locked={lockReason("cargoTypes")}>
                <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Cargo types">
                  {CARGO_CATEGORY_DEFINITIONS.map((option) => (
                    <label key={option.code} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={values.cargoTypes.includes(option.displayName)}
                        disabled={lockReason("cargoTypes") !== null || saving || stale}
                        onChange={(event) => {
                          set("cargoTypes", event.target.checked ? [...values.cargoTypes.filter((item) => item !== option.displayName), option.displayName] : values.cargoTypes.filter((item) => item !== option.displayName))
                          touch("cargoTypes")
                        }}
                      />
                      {option.displayName}
                    </label>
                  ))}
                </div>
              </Field>
            </Section>

            <Section title="Contract-governed service (read-only)" icon={FileBadge}>
              <ReadOnlyRow
                label="Contracted service"
                value={profile.serviceType?.state === "restricted" ? "Restricted" : profile.serviceType?.state === "not_contracted" ? "Not contracted" : profile.serviceType?.state === "contracted" ? (profile.serviceType.packages.join(", ") || "Contracted (no package recorded)") : null}
                reason="Comes from the signed contract; a profile edit can never change or override it."
                href={workspace(companyId, "onboarding")}
                linkLabel="Open contracts"
              />
              <ReadOnlyRow label="Service status" value={customerWithheld ? "Restricted" : profile.serviceStage} reason="The stage of the current engagement." />
              <ReadOnlyRow label="Service start date" value={customerWithheld ? "Restricted" : profile.startDate} reason={COMPANY_FIELD_INVENTORY.startDate.note} />
              <ReadOnlyRow
                label="Contract standing"
                value={details?.contracts.state === "ok" ? (Object.entries(details.contracts.byStatus).map(([status, count]) => `${count} ${status.replace(/_/g, " ")}`).join(", ") || "No contracts") : details?.contracts.state === "restricted" ? "Restricted" : null}
              />
              <ReadOnlyRow
                label="Service Decision Authority"
                value={details?.authorities.state === "ok" ? (details.authorities.serviceDecisionAuthority ? details.authorities.serviceDecisionAuthority.name ?? "Assigned (name restricted)" : "None assigned") : details?.authorities.state === "restricted" ? "Restricted" : null}
                reason="Exactly one active Service Decision Authority per company."
              />
              <ReadOnlyRow
                label="Contract Signatory"
                value={details?.authorities.state === "ok" ? (details.authorities.contractSignatory ? details.authorities.contractSignatory.name ?? "Assigned (name restricted)" : "None assigned") : details?.authorities.state === "restricted" ? "Restricted" : null}
                reason={details?.authorities.state === "ok" && details.authorities.samePerson ? "The same person holds both roles. Exactly one active Contract Signatory per company." : "Exactly one active Contract Signatory per company (the same person may hold both roles). Operational contacts hold no contractual authority."}
              />
            </Section>

          </div>
        )}

        {/* ------------------------------------------------------------ ACTION BAR */}
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-md backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="min-w-0 text-sm" aria-live="polite">
            {saving ? (
              <span className="text-muted-foreground">Saving…</span>
            ) : visibleIssues.length > 0 ? (
              <span className="flex items-center gap-2 font-medium text-destructive">
                <XCircle className="size-4 shrink-0" />
                {visibleIssues.length} problem{visibleIssues.length === 1 ? "" : "s"} to fix before saving
              </span>
            ) : dirty ? (
              <span className="font-medium text-foreground">
                {changed.size} unsaved change{changed.size === 1 ? "" : "s"}
                <span className="font-normal text-muted-foreground"> in {tabs.filter((entry) => entry.changes > 0).map((entry) => entry.label).join(", ")}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{readOnlyForm ? "Read-only" : "No unsaved changes"}</span>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            {/* onMouseDown: the field being left would show its error on blur, shifting the layout between press and release and swallowing the click. */}
            <Button type="button" variant="outline" onClick={cancel} onMouseDown={(event) => event.preventDefault()} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" onMouseDown={(event) => event.preventDefault()} disabled={saving || !dirty || readOnlyForm || stale}>
              <Save className="mr-2 size-4" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </form>

      {/* Outside the form on purpose: a form inside a form is invalid, and ending a service is never part of Save Changes. */}
      {isCustomer && tab === "service" && (
        <div id="service-lifecycle" className="max-w-6xl">
          <ServiceLifecycle
            companyId={companyId}
            access={access}
            ended={serviceEnded}
            startDate={profile.startDate}
            signedReference={details?.contracts.state === "ok" && details.contracts.signedInForce ? (details.contracts.signedReference ?? "signed contract") : null}
            contractsRestricted={details?.contracts.state === "restricted"}
            disabled={dirty}
            onEnded={async () => {
              const ok = await load()
              setBanner(ok ? { kind: "success", text: "The service was ended and recorded permanently with its reason." } : { kind: "warning", text: "The service was ended, but the page could not re-read the record. Reload the page." })
            }}
          />
        </div>
      )}

      {legalOpen && <LegalNameChange companyId={companyId} currentName={record.companyName} canExecuteHint={access.legalName} onClose={() => setLegalOpen(false)} onDone={() => void load()} />}
    </div>
  )
}

/**
 * Ending a customer's service is a lifecycle action, never part of Save Changes: it needs a date and a reason from the catalogue, and it is
 * recorded permanently (an ended service is never reopened or deleted). A service governed by a SIGNED contract cannot be ended here at all.
 */
function ServiceLifecycle({
  companyId,
  access,
  ended,
  startDate,
  signedReference,
  contractsRestricted,
  disabled,
  onEnded,
}: {
  companyId: string
  access: Access
  ended: boolean
  startDate: string | null
  signedReference: string | null
  contractsRestricted: boolean
  disabled: boolean
  onEnded: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const note = ended
    ? "This service has ended. An ended service is never reopened or deleted."
    : signedReference
      ? `This service is governed by a signed contract (${signedReference}), so it cannot be ended from the company page. Contracted services are changed or terminated through the signed-agreement process: the Service Decision Authority's instruction, with evidence.`
      : contractsRestricted
        ? "Ending a service needs permission to read the company's contracts, so that a signed agreement is never overridden by accident."
        : !access.service
          ? "You do not have permission to end a customer's service."
          : null

  return (
    <Section title="Service lifecycle" icon={XCircle} grid={false}>
      {note ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>{note}</span>
        </p>
      ) : (
        <form
          className="grid items-end gap-4 sm:grid-cols-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            const form = new FormData(event.currentTarget)
            const endedAt = String(form.get("endedAt") ?? "")
            if (!endedAt) return setMessage("Choose the date the service ends.")
            if (startDate && endedAt <= startDate) return setMessage(`The service must end after it started (${startDate}).`)
            if (!window.confirm("End this customer's service? This is recorded permanently with its reason and is never reopened or deleted.")) return
            setBusy(true)
            setMessage(null)
            try {
              const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/engagement`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ endedAt: `${endedAt}T00:00:00Z`, endReason: String(form.get("endReason")) }),
              })
              if (!response.ok) return setMessage((await response.json().catch(() => null))?.error ?? "The service could not be ended.")
              await onEnded()
            } catch {
              setMessage("The service could not be ended because the server could not be reached.")
            } finally {
              setBusy(false)
            }
          }}
        >
          {disabled && <p className="sm:col-span-4 text-xs text-muted-foreground">Save or cancel your unsaved changes before ending the service.</p>}
          <div className="space-y-1">
            <Label htmlFor="endedAt" className="text-xs font-medium text-muted-foreground">End date</Label>
            <Input id="endedAt" name="endedAt" type="date" min={startDate ?? undefined} required disabled={disabled || busy} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="endReason" className="text-xs font-medium text-muted-foreground">Reason</Label>
            <select id="endReason" name="endReason" required disabled={disabled || busy} className="h-9 w-full rounded-lg border bg-background px-3 text-sm">
              {ENGAGEMENT_END_REASONS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <Button type="submit" variant="outline" disabled={disabled || busy}>{busy ? "Ending…" : "End service"}</Button>
          {message ? <p role="alert" className="text-sm text-destructive sm:col-span-4">{message}</p> : null}
        </form>
      )}
    </Section>
  )
}
