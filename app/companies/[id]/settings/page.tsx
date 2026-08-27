"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  Globe2,
  History,
  MapPinned,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/* =========================================================
   TES COMPANY SETTINGS — REVIEWED FINAL

   Company Settings = company-specific operating facts,
   restrictions and evaluation criteria.

   Company Settings DO NOT own:
   - tax account / credential status
   - temporary permit vs permanent enrollment
   - filing frequency
   - recurring filing obligation
   - period result / zero return / final return

   Those belong to Tax Profile / Tax Filing / Vehicle / Permit
   records as appropriate.
========================================================= */

type RuleValue = "applies" | "does-not-apply" | "not-configured"
type CountryScope = "canada" | "us" | "both"
type TerritoryStatus =
  | "operating"
  | "planning"
  | "not-operating"
  | "suspended"
  | "not-configured"

type Company = {
  id: string
  name: string
  regCorpState?: string
  regCorpCountry?: string
  region?: string
  [key: string]: any
}

type Rule = {
  id: string
  title: string
  description: string
  appliesTo?: CountryScope
  defaultValue?: RuleValue
}

type TerritorySetting = {
  status: TerritoryStatus
  effectiveDate: string
  notes: string
}

type CargoSetting = {
  value: RuleValue
  effectiveDate: string
  notes: string
}

type DecisionEvidence = {
  source:
    | "email"
    | "portal-request"
    | "signed-instruction"
    | "authorized-ticket"
    | "other"
    | ""
  reference: string
  effectiveDate: string
  summary: string
}

type SettingChangeEvent = {
  id: string
  createdAt: string
  effectiveDate: string
  evidenceSource: DecisionEvidence["source"]
  evidenceReference: string
  summary: string
  changes: string[]
}

type SettingsState = {
  version: number
  jurisdiction: CountryScope
  minimumDriverAge: string
  minimumDriverExperience: string
  rules: Record<string, RuleValue>
  operatingTerritories: Record<string, TerritorySetting>
  cargo: Record<string, CargoSetting>
  history: SettingChangeEvent[]
}

type Jurisdiction = {
  code: string
  name: string
  country: "Canada" | "United States"
}

const STORAGE_PREFIX = "tes_company_compliance_settings_"
const SETTINGS_VERSION = 4

const DRIVER_RULES: Rule[] = [
  {
    id: "background_check",
    title: "Background check",
    description:
      "Require background-check completion before applicable personnel can be treated as compliant.",
    appliesTo: "both",
    defaultValue: "applies",
  },
  {
    id: "annual_road_test",
    title: "Annual road test",
    description:
      "Flag missing annual road-test documentation when this company requires it.",
    appliesTo: "both",
    defaultValue: "applies",
  },
  {
    id: "pre_employment_road_test",
    title: "Pre-employment road test",
    description:
      "Require road-test documentation during driver onboarding when applicable.",
    appliesTo: "both",
    defaultValue: "applies",
  },
  {
    id: "psp",
    title: "PSP screening",
    description:
      "Require PSP screening for applicable US driver operations.",
    appliesTo: "us",
  },
  {
    id: "canadian_drug_alcohol",
    title: "Drug & alcohol testing for Canadian drivers",
    description:
      "Apply the company's Canadian drug and alcohol testing requirements.",
    appliesTo: "canada",
    defaultValue: "applies",
  },
  {
    id: "work_permit",
    title: "Work permit",
    description:
      "Track work-permit documentation when required for this company.",
    appliesTo: "both",
  },
  {
    id: "permanent_resident_card",
    title: "Permanent resident card",
    description:
      "Track permanent-resident documentation when required for this company.",
    appliesTo: "both",
  },
  {
    id: "passport_us",
    title: "Passport for US operations",
    description:
      "Require passport documentation where the company's cross-border operations need it.",
    appliesTo: "us",
  },
  {
    id: "visa_us",
    title: "Visa for US operations",
    description:
      "Track visa documentation when required for US operations.",
    appliesTo: "us",
  },
]

const PROGRAM_RULES: Rule[] = [
  { id: "ctpat", title: "CTPAT", description: "Company participates in CTPAT.", appliesTo: "us" },
  { id: "fast", title: "FAST", description: "Company participates in FAST.", appliesTo: "both" },
  { id: "pip", title: "PIP", description: "Company participates in Partners in Protection.", appliesTo: "canada" },
  { id: "csa", title: "Customs Self Assessment", description: "Company participates in CSA.", appliesTo: "canada" },
  { id: "smartway", title: "EPA SmartWay", description: "Company participates in EPA SmartWay.", appliesTo: "us" },
  { id: "cor", title: "COR", description: "Company participates in an applicable Certificate of Recognition program.", appliesTo: "canada" },
  { id: "pic", title: "Partners in Compliance", description: "Company participates in the applicable Partners in Compliance program.", appliesTo: "canada" },
  { id: "weight_to_go", title: "Weight to Go", description: "Company participates in the applicable Weight to Go program.", appliesTo: "canada" },
]

const CARGO_OPTIONS = [
  { id: "general_freight", title: "General freight", description: "General commercial freight." },
  { id: "tobacco", title: "Tobacco", description: "May trigger jurisdiction-specific tax and permit review." },
  { id: "alcohol", title: "Alcohol", description: "May trigger jurisdiction-specific permit review." },
  { id: "fuel_petroleum", title: "Fuel / petroleum", description: "May trigger fuel-tax, dangerous-goods and registration review." },
  { id: "hazmat", title: "Hazardous materials / dangerous goods", description: "May trigger PHMSA / dangerous-goods and related requirements." },
  { id: "oversize_overweight", title: "Oversize / overweight", description: "Company conducts OS/OW operations; vehicle-specific permits stay with Vehicles." },
  { id: "other_regulated_cargo", title: "Other regulated cargo", description: "Another regulated commodity requires company-level review." },
] as const

const CANADA: Jurisdiction[] = [
  ["AB","Alberta"],["BC","British Columbia"],["MB","Manitoba"],["NB","New Brunswick"],
  ["NL","Newfoundland and Labrador"],["NS","Nova Scotia"],["NT","Northwest Territories"],
  ["NU","Nunavut"],["ON","Ontario"],["PE","Prince Edward Island"],["QC","Quebec"],
  ["SK","Saskatchewan"],["YT","Yukon"],
].map(([code,name]) => ({ code, name, country: "Canada" as const }))

const US: Jurisdiction[] = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],
  ["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],
  ["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],
  ["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],
  ["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],
  ["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],
  ["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],
  ["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
].map(([code,name]) => ({ code, name, country: "United States" as const }))

const ALL_JURISDICTIONS = [...CANADA, ...US]

const SECTIONS = [
  { id: "overview", label: "Profile", description: "Master operating facts", icon: Globe2 },
  { id: "territory", label: "Operating Territory", description: "Where the company operates", icon: MapPinned },
  { id: "cargo", label: "Cargo & Operations", description: "Company activity", icon: Truck },
  { id: "drivers", label: "Drivers & Staff", description: "Company policies", icon: Users },
  { id: "programs", label: "Programs", description: "Memberships", icon: FileCheck2 },
  { id: "history", label: "Decision History", description: "Authorized changes", icon: History },
] as const

const DEFAULT_RULES = Object.fromEntries(
  [...DRIVER_RULES, ...PROGRAM_RULES].map((r) => [r.id, r.defaultValue ?? "not-configured"]),
)

const DEFAULT_SETTINGS: SettingsState = {
  version: SETTINGS_VERSION,
  jurisdiction: "both",
  minimumDriverAge: "21",
  minimumDriverExperience: "24",
  rules: DEFAULT_RULES,
  operatingTerritories: Object.fromEntries(
    ALL_JURISDICTIONS.map((j) => [
      j.code,
      { status: "not-configured", effectiveDate: "", notes: "" },
    ]),
  ),
  cargo: Object.fromEntries(
    CARGO_OPTIONS.map((c) => [
      c.id,
      { value: "not-configured", effectiveDate: "", notes: "" },
    ]),
  ),
  history: [],
}

function cloneSettings(v: SettingsState): SettingsState {
  return JSON.parse(JSON.stringify(v))
}

function createId(prefix: string) {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function getCompany(id: string): Company | null {
  try {
    const companies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    return Array.isArray(companies) ? companies.find((c: Company) => c.id === id) || null : null
  } catch {
    return null
  }
}

function normalizeCompanyScope(company: Company): CountryScope {
  const region = String(company.region || "").toLowerCase()
  const country = String(company.regCorpCountry || "").toLowerCase()

  if (
    region.includes("cross") ||
    (region.includes("canada") &&
      (region.includes("united states") || region.includes("usa") || region.includes("u.s.")))
  ) return "both"

  if (
    region.includes("united states") ||
    region.includes("usa") ||
    region.includes("u.s.") ||
    country.includes("united states") ||
    country === "usa" ||
    country === "us"
  ) return "us"

  if (region.includes("canada") || country.includes("canada")) return "canada"

  return "both"
}

function migrateSettings(parsed: Partial<SettingsState>, company: Company): SettingsState {
  const base = cloneSettings(DEFAULT_SETTINGS)
  return {
    ...base,
    ...parsed,
    version: SETTINGS_VERSION,
    jurisdiction: normalizeCompanyScope(company),
    rules: { ...base.rules, ...(parsed.rules || {}) },
    operatingTerritories: {
      ...base.operatingTerritories,
      ...(parsed.operatingTerritories || {}),
    },
    cargo: { ...base.cargo, ...(parsed.cargo || {}) },
    history: Array.isArray(parsed.history) ? parsed.history : [],
  }
}

function buildChanges(before: SettingsState, after: SettingsState) {
  const changes: string[] = []

  if (before.minimumDriverAge !== after.minimumDriverAge) {
    changes.push(`Minimum driver age: ${before.minimumDriverAge} → ${after.minimumDriverAge}.`)
  }
  if (before.minimumDriverExperience !== after.minimumDriverExperience) {
    changes.push(
      `Minimum driver experience: ${before.minimumDriverExperience} → ${after.minimumDriverExperience} months.`,
    )
  }

  ALL_JURISDICTIONS.forEach((j) => {
    const a = before.operatingTerritories[j.code]
    const b = after.operatingTerritories[j.code]
    if (!a || !b) return
    if (a.status !== b.status || a.effectiveDate !== b.effectiveDate || a.notes !== b.notes) {
      changes.push(
        `${j.name}: ${a.status} → ${b.status}${b.effectiveDate ? ` effective ${b.effectiveDate}` : ""}.`,
      )
    }
  })

  CARGO_OPTIONS.forEach((c) => {
    const a = before.cargo[c.id]
    const b = after.cargo[c.id]
    if (!a || !b) return
    if (a.value !== b.value || a.effectiveDate !== b.effectiveDate || a.notes !== b.notes) {
      changes.push(
        `${c.title}: ${a.value} → ${b.value}${b.effectiveDate ? ` effective ${b.effectiveDate}` : ""}.`,
      )
    }
  })

  ;[...DRIVER_RULES, ...PROGRAM_RULES].forEach((r) => {
    const a = before.rules[r.id] ?? "not-configured"
    const b = after.rules[r.id] ?? "not-configured"
    if (a !== b) changes.push(`${r.title}: ${a} → ${b}.`)
  })

  return changes
}

function FactRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-sm font-medium">{value || "Not recorded"}</p>
    </div>
  )
}

function RuleRow({
  rule,
  value,
  onChange,
}: {
  rule: Rule
  value: RuleValue
  onChange: (value: RuleValue) => void
}) {
  return (
    <div className="border-b py-5 last:border-b-0">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
        <div>
          <div className="text-sm font-medium">{rule.title}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{rule.description}</p>
        </div>
        <Select value={value} onValueChange={(v) => onChange(v as RuleValue)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="applies">Applies</SelectItem>
            <SelectItem value="does-not-apply">Doesn't apply</SelectItem>
            <SelectItem value="not-configured">Not configured</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function TerritoryRow({
  jurisdiction,
  setting,
  onChange,
}: {
  jurisdiction: Jurisdiction
  setting: TerritorySetting
  onChange: (next: TerritorySetting) => void
}) {
  return (
    <div className="border-b py-4 last:border-b-0">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_160px] xl:items-start">
        <div>
          <p className="text-sm font-medium">{jurisdiction.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {jurisdiction.country} · {jurisdiction.code}
          </p>
        </div>

        <Select
          value={setting.status}
          onValueChange={(v) =>
            onChange({
              ...setting,
              status: v as TerritoryStatus,
              effectiveDate: v === "not-configured" ? "" : setting.effectiveDate,
            })
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="operating">Operating</SelectItem>
            <SelectItem value="planning">Planning to operate</SelectItem>
            <SelectItem value="not-operating">Not operating</SelectItem>
            <SelectItem value="suspended">Operations suspended</SelectItem>
            <SelectItem value="not-configured">Not configured</SelectItem>
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={setting.effectiveDate}
          disabled={setting.status === "not-configured"}
          onChange={(e) => onChange({ ...setting, effectiveDate: e.target.value })}
        />
      </div>

      {setting.status !== "not-configured" && (
        <Input
          className="mt-3"
          value={setting.notes}
          placeholder="Optional operating note — not tax account/permit status"
          onChange={(e) => onChange({ ...setting, notes: e.target.value })}
        />
      )}
    </div>
  )
}

function CargoRow({
  item,
  setting,
  onChange,
}: {
  item: (typeof CARGO_OPTIONS)[number]
  setting: CargoSetting
  onChange: (next: CargoSetting) => void
}) {
  return (
    <div className="border-b py-5 last:border-b-0">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_160px] xl:items-start">
        <div>
          <p className="text-sm font-medium">{item.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
        </div>

        <Select
          value={setting.value}
          onValueChange={(v) =>
            onChange({
              ...setting,
              value: v as RuleValue,
              effectiveDate: v === "not-configured" ? "" : setting.effectiveDate,
            })
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="applies">Applies</SelectItem>
            <SelectItem value="does-not-apply">Doesn't apply</SelectItem>
            <SelectItem value="not-configured">Not configured</SelectItem>
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={setting.effectiveDate}
          disabled={setting.value === "not-configured"}
          onChange={(e) => onChange({ ...setting, effectiveDate: e.target.value })}
        />
      </div>

      {setting.value !== "not-configured" && (
        <Input
          className="mt-3"
          value={setting.notes}
          placeholder="Optional company-level note"
          onChange={(e) => onChange({ ...setting, notes: e.target.value })}
        />
      )}
    </div>
  )
}

export default function SettingsPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState("overview")
  const [savedSettings, setSavedSettings] = useState(cloneSettings(DEFAULT_SETTINGS))
  const [draftSettings, setDraftSettings] = useState(cloneSettings(DEFAULT_SETTINGS))
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [territorySearch, setTerritorySearch] = useState("")
  const [decisionEvidence, setDecisionEvidence] = useState<DecisionEvidence>({
    source: "",
    reference: "",
    effectiveDate: "",
    summary: "",
  })

  useEffect(() => {
    if (!companyId) return
    try {
      const found = getCompany(companyId)
      setCompany(found)
      if (!found) return

      const raw = localStorage.getItem(`${STORAGE_PREFIX}${companyId}`)
      const hydrated = raw
        ? migrateSettings(JSON.parse(raw), found)
        : migrateSettings({}, found)

      setSavedSettings(cloneSettings(hydrated))
      setDraftSettings(cloneSettings(hydrated))
    } catch {
      setCompany(null)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  const companyScope = company ? normalizeCompanyScope(company) : "both"

  const isDirty = useMemo(
    () => JSON.stringify(savedSettings) !== JSON.stringify(draftSettings),
    [savedSettings, draftSettings],
  )

  const pendingChanges = useMemo(
    () => buildChanges(savedSettings, draftSettings),
    [savedSettings, draftSettings],
  )

  const visibleTerritories = useMemo(() => {
    const q = territorySearch.trim().toLowerCase()
    return ALL_JURISDICTIONS.filter((j) => {
      if (companyScope === "canada" && j.country !== "Canada") return false
      if (companyScope === "us" && j.country !== "United States") return false
      if (!q) return true
      return j.name.toLowerCase().includes(q) || j.code.toLowerCase().includes(q)
    })
  }, [territorySearch, companyScope])

  const visibleDriverRules = DRIVER_RULES.filter(
    (r) => r.appliesTo === "both" || companyScope === "both" || r.appliesTo === companyScope,
  )
  const visibleProgramRules = PROGRAM_RULES.filter(
    (r) => r.appliesTo === "both" || companyScope === "both" || r.appliesTo === companyScope,
  )

  const updateRule = (id: string, value: RuleValue) => {
    setSaveMessage(null)
    setDraftSettings((s) => ({ ...s, rules: { ...s.rules, [id]: value } }))
  }

  const updateTerritory = (code: string, next: TerritorySetting) => {
    setSaveMessage(null)
    setDraftSettings((s) => ({
      ...s,
      operatingTerritories: { ...s.operatingTerritories, [code]: next },
    }))
  }

  const updateCargo = (id: string, next: CargoSetting) => {
    setSaveMessage(null)
    setDraftSettings((s) => ({ ...s, cargo: { ...s.cargo, [id]: next } }))
  }

  const handleSave = () => {
    if (!company) return

    if (
      !decisionEvidence.source ||
      !decisionEvidence.reference.trim() ||
      !decisionEvidence.effectiveDate ||
      !decisionEvidence.summary.trim()
    ) {
      setSaveMessage(
        "Add the written authorization source, reference, effective date and decision summary before saving.",
      )
      return
    }

    const event: SettingChangeEvent = {
      id: createId("SET"),
      createdAt: new Date().toISOString(),
      effectiveDate: decisionEvidence.effectiveDate,
      evidenceSource: decisionEvidence.source,
      evidenceReference: decisionEvidence.reference.trim(),
      summary: decisionEvidence.summary.trim(),
      changes: pendingChanges,
    }

    const finalSettings: SettingsState = {
      ...draftSettings,
      jurisdiction: normalizeCompanyScope(company),
      history: [event, ...savedSettings.history],
    }

    try {
      localStorage.setItem(`${STORAGE_PREFIX}${companyId}`, JSON.stringify(finalSettings))
      setSavedSettings(cloneSettings(finalSettings))
      setDraftSettings(cloneSettings(finalSettings))
      setSavedAt(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      )
      setDecisionEvidence({ source: "", reference: "", effectiveDate: "", summary: "" })
      setSaveMessage(
        "Company settings saved. Relevant modules may now evaluate the change; no obligation was silently activated.",
      )
    } catch {
      setSaveMessage("Unable to save company settings.")
    }
  }

  const handleDiscard = () => {
    setDraftSettings(cloneSettings(savedSettings))
    setDecisionEvidence({ source: "", reference: "", effectiveDate: "", summary: "" })
    setSaveMessage(null)
  }

  if (loading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading company settings...</div>
  }

  if (!company) {
    return <div className="p-10 text-center"><h1 className="text-lg font-semibold">Company Not Found</h1></div>
  }

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col pb-12">
      <div className="border-b pb-6">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/companies/${companyId}/profile`)}
            className="mt-0.5 shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Company Settings</h1>
              {!isDirty && savedAt && (
                <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                  <Check className="size-3" /> Saved {savedAt}
                </span>
              )}
            </div>

            <p className="mt-1 text-sm text-muted-foreground">
              {company.name} · {company.id}
            </p>

            <p className="mt-4 max-w-4xl text-sm leading-6 text-muted-foreground">
              Company Settings define this company's operating scope, restrictions and evaluation criteria.
              They provide context to TES; they do not silently create tax filings, permits, authorities or other compliance records.
            </p>
          </div>
        </div>
      </div>

      <div className="grid min-h-[640px] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-b py-5 lg:border-b-0 lg:border-r lg:pr-5">
          <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Company settings
          </div>

          <nav className="space-y-1">
            {SECTIONS.map((section) => {
              const Icon = section.icon
              const active = activeSection === section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={[
                    "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    active
                      ? "bg-muted font-medium"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{section.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{section.description}</span>
                  </span>
                  {active && <ChevronRight className="size-3.5" />}
                </button>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0 py-6 lg:pl-7">
          {activeSection === "overview" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Master operating profile</h2>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
                  Registered origin and Operating Region remain on the Company master record.
                  Settings consume those exact fields instead of creating a competing source of truth.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Company master facts</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <FactRow label="Registered Country" value={company.regCorpCountry} />
                  <FactRow label="Registered Province / State" value={company.regCorpState} />
                  <FactRow label="Operating Region" value={company.region} />
                </CardContent>
              </Card>

              <Card className="border-dashed">
                <CardContent className="flex gap-3 p-5">
                  <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Tax boundary: Company Settings answer where and what the company operates.
                    Tax Profile will answer how it is authorized there, which account/credential exists,
                    and whether recurring filing is required.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === "territory" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Operating territory</h2>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
                  Record operating scope only. Temporary permits, permanent enrollment, tax account status,
                  filing frequency and vehicle enrollment belong elsewhere.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Provinces and states</CardTitle>
                  <CardDescription>
                    Effective dates are retained so previous periods keep the facts that applied at that time.
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <Input
                    className="mb-5"
                    placeholder="Search province, state or code..."
                    value={territorySearch}
                    onChange={(e) => setTerritorySearch(e.target.value)}
                  />
                  <div className="rounded-lg border px-4">
                    {visibleTerritories.map((j) => (
                      <TerritoryRow
                        key={j.code}
                        jurisdiction={j}
                        setting={
                          draftSettings.operatingTerritories[j.code] || {
                            status: "not-configured",
                            effectiveDate: "",
                            notes: "",
                          }
                        }
                        onChange={(next) => updateTerritory(j.code, next)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === "cargo" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Cargo & operations</h2>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
                  Company-level operational facts that can affect Authorities, Tax, Insurance, Permits and Documents.
                </p>
              </div>

              <Card>
                <CardContent className="pt-0">
                  {CARGO_OPTIONS.map((item) => (
                    <CargoRow
                      key={item.id}
                      item={item}
                      setting={
                        draftSettings.cargo[item.id] || {
                          value: "not-configured",
                          effectiveDate: "",
                          notes: "",
                        }
                      }
                      onChange={(next) => updateCargo(item.id, next)}
                    />
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === "drivers" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Drivers & Staff — company requirements</CardTitle>
                <CardDescription>
                  Only company-specific rules belong here. Individual driver records remain in Drivers.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-5 border-b py-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Minimum driver age</Label>
                    <Input
                      type="number"
                      min="18"
                      max="99"
                      value={draftSettings.minimumDriverAge}
                      onChange={(e) =>
                        setDraftSettings((s) => ({ ...s, minimumDriverAge: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Minimum experience (months)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="600"
                      value={draftSettings.minimumDriverExperience}
                      onChange={(e) =>
                        setDraftSettings((s) => ({ ...s, minimumDriverExperience: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {visibleDriverRules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    value={draftSettings.rules[rule.id] ?? "not-configured"}
                    onChange={(v) => updateRule(rule.id, v)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {activeSection === "programs" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Company programs</CardTitle>
                <CardDescription>
                  Keep a program here only when participation changes TES requirements, monitoring or reporting.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {visibleProgramRules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    value={draftSettings.rules[rule.id] ?? "not-configured"}
                    onChange={(v) => updateRule(rule.id, v)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {activeSection === "history" && (
            <div className="space-y-3">
              {savedSettings.history.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-10 text-center text-sm text-muted-foreground">
                    No settings decision history yet.
                  </CardContent>
                </Card>
              ) : (
                savedSettings.history.map((event) => (
                  <Card key={event.id}>
                    <CardContent className="p-4">
                      <div className="flex justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">{event.summary}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {event.evidenceSource} · {event.evidenceReference}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">Effective {event.effectiveDate}</p>
                      </div>

                      <div className="mt-3 rounded-lg border bg-muted/20 p-3">
                        {event.changes.map((change) => (
                          <p key={change} className="text-xs leading-5 text-muted-foreground">
                            • {change}
                          </p>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </main>
      </div>

      {isDirty ? (
        <div className="mt-6 rounded-xl border bg-background shadow-sm">
          <div className="border-b p-4">
            <div className="flex items-start gap-3">
              <FileCheck2 className="mt-0.5 size-4 text-primary" />
              <div>
                <p className="text-sm font-medium">Written authorization required</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Save material Company Settings changes only when an accepted written client instruction supports them.
                  TES stores the decision reference, not every email.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Authorization source *</Label>
              <Select
                value={decisionEvidence.source || undefined}
                onValueChange={(v) =>
                  setDecisionEvidence((d) => ({
                    ...d,
                    source: v as DecisionEvidence["source"],
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="portal-request">Portal request</SelectItem>
                  <SelectItem value="signed-instruction">Signed instruction</SelectItem>
                  <SelectItem value="authorized-ticket">Authorized ticket</SelectItem>
                  <SelectItem value="other">Other written communication</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reference *</Label>
              <Input
                value={decisionEvidence.reference}
                onChange={(e) =>
                  setDecisionEvidence((d) => ({ ...d, reference: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Effective date *</Label>
              <Input
                type="date"
                value={decisionEvidence.effectiveDate}
                onChange={(e) =>
                  setDecisionEvidence((d) => ({ ...d, effectiveDate: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Decision summary *</Label>
              <Input
                value={decisionEvidence.summary}
                onChange={(e) =>
                  setDecisionEvidence((d) => ({ ...d, summary: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="border-t p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pending changes
            </p>
            <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border bg-muted/20 p-3">
              {pendingChanges.map((change) => (
                <p key={change} className="text-xs leading-5 text-muted-foreground">
                  • {change}
                </p>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t p-4">
            <Button variant="outline" onClick={handleDiscard}>Discard</Button>
            <Button onClick={handleSave}>
              <Check className="mr-2 size-4" /> Save company settings
            </Button>
          </div>
        </div>
      ) : saveMessage ? (
        <div className="mt-6 flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Check className="size-4" /> {saveMessage}
          </div>
          <button
            type="button"
            onClick={() => setSaveMessage(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
