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
import { Separator } from "@/components/ui/separator"

type RuleValue = "applies" | "does-not-apply" | "not-configured"

type Rule = {
  id: string
  title: string
  description: string
  appliesTo?: "canada" | "us" | "both"
  defaultValue?: RuleValue
}

type SettingsState = {
  jurisdiction: "canada" | "us" | "both"
  minimumDriverAge: string
  minimumDriverExperience: string
  rules: Record<string, RuleValue>
}

const STORAGE_PREFIX = "tes_company_compliance_settings_"

const RULES: Record<string, Rule[]> = {
  cargo: [
    {
      id: "dg_canada",
      title: "Dangerous goods in Canada",
      description:
        "Generate dangerous-goods compliance requirements when this company transports regulated goods in Canada.",
      appliesTo: "canada",
      defaultValue: "applies",
    },
    {
      id: "dg_us",
      title: "Hazardous materials in the United States",
      description:
        "Generate hazardous-material compliance requirements for US operations.",
      appliesTo: "us",
      defaultValue: "applies",
    },
    {
      id: "dg_wv_nv",
      title: "Dangerous goods in West Virginia or Nevada",
      description:
        "Use the additional state-specific routing and documentation rules when applicable.",
      appliesTo: "us",
    },
    {
      id: "dg_colorado",
      title: "Dangerous goods in Colorado",
      description:
        "Apply Colorado-specific dangerous-goods routing and compliance requirements.",
      appliesTo: "us",
    },
    {
      id: "dg_idaho",
      title: "Dangerous goods in Idaho",
      description:
        "Apply Idaho-specific dangerous-goods routing and compliance requirements.",
      appliesTo: "us",
    },
    {
      id: "tobacco_ontario",
      title: "Tobacco transport in Ontario",
      description:
        "Generate Ontario tobacco permit and documentation alerts when this operation applies.",
      appliesTo: "canada",
    },
    {
      id: "alcohol_us",
      title: "Alcohol transport in the United States",
      description:
        "Enable US alcohol-transport compliance checks for this company.",
      appliesTo: "us",
    },
    {
      id: "alcohol_nj",
      title: "Alcohol transport in New Jersey",
      description:
        "Apply New Jersey-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_tx",
      title: "Alcohol transport in Texas",
      description:
        "Apply Texas-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_ky",
      title: "Alcohol transport in Kentucky",
      description:
        "Apply Kentucky-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_in",
      title: "Alcohol transport in Indiana",
      description:
        "Apply Indiana-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_oh",
      title: "Alcohol transport in Ohio",
      description:
        "Apply Ohio-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_ny",
      title: "Alcohol transport in New York",
      description:
        "Apply New York-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
  ],

  operations: [
    {
      id: "travel_oregon",
      title: "Operations in Oregon",
      description:
        "Generate Oregon weight, tax, and operating credential requirements.",
      appliesTo: "us",
      defaultValue: "applies",
    },
    {
      id: "travel_new_york",
      title: "Operations in New York",
      description:
        "Generate New York HUT and related operating requirements.",
      appliesTo: "us",
      defaultValue: "applies",
    },
    {
      id: "travel_new_mexico",
      title: "Operations in New Mexico",
      description:
        "Apply New Mexico weight-distance tax and related routing requirements.",
      appliesTo: "us",
    },
    {
      id: "travel_kentucky",
      title: "Operations in Kentucky",
      description:
        "Apply Kentucky-specific operating and credential requirements.",
      appliesTo: "us",
    },
    {
      id: "reefer_california",
      title: "Refrigerated operations in California",
      description:
        "Generate California-specific refrigerated-equipment compliance alerts.",
      appliesTo: "us",
    },
  ],

  drivers: [
    {
      id: "background_check",
      title: "Background check",
      description:
        "Require background-check completion before the driver can be treated as compliant.",
      appliesTo: "both",
      defaultValue: "applies",
    },
    {
      id: "annual_road_test",
      title: "Annual road test",
      description:
        "Flag missing annual road-test documentation for applicable drivers.",
      appliesTo: "both",
      defaultValue: "applies",
    },
    {
      id: "pre_employment_road_test",
      title: "Pre-employment road test",
      description:
        "Require road-test documentation during driver onboarding.",
      appliesTo: "both",
      defaultValue: "applies",
    },
    {
      id: "psp",
      title: "PSP screening",
      description:
        "Require Pre-Employment Screening Program checks for applicable US driver operations.",
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
      id: "tax_documents",
      title: "Driver tax documents",
      description:
        "Generate document alerts when required tax or payroll documentation is missing.",
      appliesTo: "both",
      defaultValue: "applies",
    },
    {
      id: "work_permit",
      title: "Work permit",
      description:
        "Track work-permit documentation and expiration dates for applicable personnel.",
      appliesTo: "both",
    },
    {
      id: "permanent_resident_card",
      title: "Permanent resident card",
      description:
        "Track permanent-resident documentation when it is required for the company's operations.",
      appliesTo: "both",
    },
    {
      id: "staff_incorporation",
      title: "Staff incorporation documents",
      description:
        "Require incorporation documentation for applicable owner-operators or subcontractors.",
      appliesTo: "both",
    },
    {
      id: "passport_us",
      title: "Passport for US operations",
      description:
        "Generate passport-document alerts for personnel who require them for cross-border operations.",
      appliesTo: "us",
      defaultValue: "applies",
    },
    {
      id: "visa_us",
      title: "Visa for US operations",
      description:
        "Track visa documentation and expiry dates when required for US operations.",
      appliesTo: "us",
    },
  ],

  programs: [
    {
      id: "ctpat",
      title: "CTPAT",
      description:
        "Identify the company as participating in the Customs-Trade Partnership Against Terrorism program.",
      appliesTo: "us",
    },
    {
      id: "fast",
      title: "FAST",
      description:
        "Identify participation in the Free and Secure Trade program.",
      appliesTo: "both",
    },
    {
      id: "pip",
      title: "PIP",
      description:
        "Identify participation in Canada's Partners in Protection program.",
      appliesTo: "canada",
    },
    {
      id: "csa",
      title: "Customs Self Assessment",
      description:
        "Identify participation in the Customs Self Assessment program.",
      appliesTo: "canada",
    },
    {
      id: "smartway",
      title: "EPA SmartWay",
      description:
        "Identify participation in the EPA SmartWay program.",
      appliesTo: "us",
    },
    {
      id: "cor",
      title: "COR",
      description:
        "Identify participation in a Certificate of Recognition safety program.",
      appliesTo: "canada",
    },
    {
      id: "pic",
      title: "Partners in Compliance",
      description:
        "Identify participation in the applicable Partners in Compliance program.",
      appliesTo: "canada",
    },
    {
      id: "weight_to_go",
      title: "Weight to Go",
      description:
        "Identify participation in the applicable weight enforcement program.",
      appliesTo: "canada",
    },
    {
      id: "premium_carrier",
      title: "Premium carrier designation",
      description:
        "Use this internal designation when the company should receive the associated premium-carrier treatment.",
      appliesTo: "both",
    },
  ],
}

const SECTIONS = [
  {
    id: "overview",
    label: "Profile",
    description: "Operating scope",
    icon: Globe2,
  },
  {
    id: "cargo",
    label: "Cargo",
    description: "Goods & permits",
    icon: Truck,
  },
  {
    id: "operations",
    label: "Operations",
    description: "Routes & states",
    icon: ShieldCheck,
  },
  {
    id: "drivers",
    label: "Drivers & Staff",
    description: "People & documents",
    icon: Users,
  },
  {
    id: "programs",
    label: "Programs",
    description: "Memberships",
    icon: FileCheck2,
  },
] as const

const DEFAULT_SETTINGS: SettingsState = {
  jurisdiction: "both",
  minimumDriverAge: "21",
  minimumDriverExperience: "24",
  rules: Object.fromEntries(
    Object.values(RULES)
      .flat()
      .map((rule) => [rule.id, rule.defaultValue ?? "not-configured"]),
  ),
}

function cloneSettings(settings: SettingsState): SettingsState {
  return {
    jurisdiction: settings.jurisdiction,
    minimumDriverAge: settings.minimumDriverAge,
    minimumDriverExperience: settings.minimumDriverExperience,
    rules: { ...settings.rules },
  }
}

function RadioChoice({
  name,
  value,
  checked,
  onChange,
  label,
  description,
}: {
  name: string
  value: string
  checked: boolean
  onChange: () => void
  label: string
  description?: string
}) {
  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all",
        checked
          ? "border-foreground/30 bg-muted/70"
          : "border-border hover:bg-muted/40",
      ].join(" ")}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 accent-foreground"
      />

      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

function RuleRow({
  rule,
  value,
  onChange,
  disabled,
}: {
  rule: Rule
  value: RuleValue
  onChange: (value: RuleValue) => void
  disabled: boolean
}) {
  return (
    <div
      className={[
        "border-b last:border-b-0 py-5",
        disabled ? "opacity-50" : "",
      ].join(" ")}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-center">
        <div>
          <div className="text-sm font-medium">{rule.title}</div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            {rule.description}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <RadioChoice
            name={rule.id}
            value="applies"
            checked={value === "applies"}
            onChange={() => onChange("applies")}
            label="Applies"
          />

          <RadioChoice
            name={rule.id}
            value="does-not-apply"
            checked={value === "does-not-apply"}
            onChange={() => onChange("does-not-apply")}
            label="Doesn't apply"
          />

          <RadioChoice
            name={rule.id}
            value="not-configured"
            checked={value === "not-configured"}
            onChange={() => onChange("not-configured")}
            label="Not configured"
          />
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const params = useParams()
  const router = useRouter()

  const companyId = params.id as string

  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState("overview")
  const [savedSettings, setSavedSettings] =
    useState<SettingsState>(cloneSettings(DEFAULT_SETTINGS))
  const [draftSettings, setDraftSettings] =
    useState<SettingsState>(cloneSettings(DEFAULT_SETTINGS))
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return

    try {
      const savedCompanies = JSON.parse(
        localStorage.getItem("tes_companies") || "[]",
      )

      const found = savedCompanies.find((c: any) => c.id === companyId)
      setCompany(found || null)

      const storedSettings = localStorage.getItem(
        `${STORAGE_PREFIX}${companyId}`,
      )

      if (storedSettings) {
        const parsed = JSON.parse(storedSettings) as Partial<SettingsState>

        const hydrated: SettingsState = {
          ...cloneSettings(DEFAULT_SETTINGS),
          ...parsed,
          rules: {
            ...DEFAULT_SETTINGS.rules,
            ...(parsed.rules || {}),
          },
        }

        setSavedSettings(cloneSettings(hydrated))
        setDraftSettings(cloneSettings(hydrated))
      }
    } catch {
      setCompany(null)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  const isDirty = useMemo(
    () => JSON.stringify(savedSettings) !== JSON.stringify(draftSettings),
    [savedSettings, draftSettings],
  )

  const configuredCount = useMemo(
    () =>
      Object.values(draftSettings.rules).filter(
        (value) => value !== "not-configured",
      ).length,
    [draftSettings.rules],
  )

  const totalRules = Object.keys(draftSettings.rules).length

  const activeRules = useMemo(() => {
    if (activeSection === "overview") return []

    return RULES[activeSection] || []
  }, [activeSection])

  const updateRule = (id: string, value: RuleValue) => {
    setSaveMessage(null)

    setDraftSettings((current) => ({
      ...current,
      rules: {
        ...current.rules,
        [id]: value,
      },
    }))
  }

  const handleSave = () => {
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}${companyId}`,
        JSON.stringify(draftSettings),
      )

      setSavedSettings(cloneSettings(draftSettings))
      setSavedAt(new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }))
      setSaveMessage("Compliance profile saved.")
    } catch {
      setSaveMessage("Unable to save the compliance profile.")
    }
  }

  const handleDiscard = () => {
    setDraftSettings(cloneSettings(savedSettings))
    setSaveMessage(null)
  }

  const handleBack = () => {
    if (isDirty) {
      const confirmed = window.confirm(
        "You have unsaved changes. Leave without saving?",
      )

      if (!confirmed) return
    }

    router.push(`/companies/${companyId}/profile`)
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Loading company settings...
      </div>
    )
  }

  if (!company) {
    return (
      <div className="p-10 text-center">
        <h1 className="text-lg font-semibold">Company Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The company associated with this settings page could not be found.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col pb-12">
      {/* HEADER */}
      <div className="border-b pb-6">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="mt-0.5 shrink-0"
            aria-label="Back to company profile"
          >
            <ArrowLeft className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Compliance Profile
              </h1>

              {!isDirty && savedAt ? (
                <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                  <Check className="size-3" />
                  Saved {savedAt}
                </span>
              ) : null}
            </div>

            <p className="mt-1 text-sm text-muted-foreground">
              {company.name}
              {company.id ? ` · ${company.id}` : ""}
            </p>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
              Tell TES which compliance rules actually apply to this company.
              These choices shape the alerts, document requirements, and
              compliance checks the system generates.
            </p>
          </div>
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="grid min-h-[620px] lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* LEFT NAV */}
        <aside className="border-b py-5 lg:border-b-0 lg:border-r lg:pr-5">
          <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Compliance profile
          </div>

          <nav className="space-y-1">
            {SECTIONS.map((section) => {
              const Icon = section.icon
              const active = activeSection === section.id

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(section.id)
                    setSaveMessage(null)
                  }}
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
                    <span className="block text-[11px] text-muted-foreground">
                      {section.description}
                    </span>
                  </span>

                  {active ? <ChevronRight className="size-3.5" /> : null}
                </button>
              )
            })}
          </nav>

          <div className="mt-6 rounded-lg border bg-muted/20 p-3">
            <div className="text-xs font-medium">Profile coverage</div>
            <div className="mt-2 text-2xl font-semibold">
              {configuredCount}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {totalRules}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              Rules have an explicit answer.
            </p>
          </div>
        </aside>

        {/* CONTENT */}
        <main className="min-w-0 py-6 lg:pl-7">
          {activeSection === "overview" ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Operating scope</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start here. TES uses the company's operating scope to decide
                  which jurisdiction-specific rules should be evaluated.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Where does this company operate?
                  </CardTitle>
                  <CardDescription>
                    Choose the jurisdictions that should be considered when
                    generating compliance alerts.
                  </CardDescription>
                </CardHeader>

                <CardContent className="grid gap-3 md:grid-cols-3">
                  <RadioChoice
                    name="jurisdiction"
                    value="canada"
                    checked={draftSettings.jurisdiction === "canada"}
                    onChange={() => {
                      setSaveMessage(null)
                      setDraftSettings((current) => ({
                        ...current,
                        jurisdiction: "canada",
                      }))
                    }}
                    label="Canada"
                    description="Canadian operations only"
                  />

                  <RadioChoice
                    name="jurisdiction"
                    value="us"
                    checked={draftSettings.jurisdiction === "us"}
                    onChange={() => {
                      setSaveMessage(null)
                      setDraftSettings((current) => ({
                        ...current,
                        jurisdiction: "us",
                      }))
                    }}
                    label="United States"
                    description="US operations only"
                  />

                  <RadioChoice
                    name="jurisdiction"
                    value="both"
                    checked={draftSettings.jurisdiction === "both"}
                    onChange={() => {
                      setSaveMessage(null)
                      setDraftSettings((current) => ({
                        ...current,
                        jurisdiction: "both",
                      }))
                    }}
                    label="Canada + United States"
                    description="Cross-border operations"
                  />
                </CardContent>
              </Card>

              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Driver requirements
                    </CardTitle>
                    <CardDescription>
                      These values determine baseline driver-profile
                      requirements.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="minimumDriverAge">
                        Minimum driver age
                      </Label>
                      <Input
                        id="minimumDriverAge"
                        type="number"
                        min="18"
                        max="99"
                        value={draftSettings.minimumDriverAge}
                        onChange={(event) => {
                          setSaveMessage(null)
                          setDraftSettings((current) => ({
                            ...current,
                            minimumDriverAge: event.target.value,
                          }))
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Used when evaluating driver eligibility.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="minimumDriverExperience">
                        Minimum experience
                      </Label>
                      <Input
                        id="minimumDriverExperience"
                        type="number"
                        min="0"
                        max="600"
                        value={draftSettings.minimumDriverExperience}
                        onChange={(event) => {
                          setSaveMessage(null)
                          setDraftSettings((current) => ({
                            ...current,
                            minimumDriverExperience: event.target.value,
                          }))
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Months of driving experience.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      How the alert engine uses this page
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-4 text-sm">
                    <div className="flex gap-3">
                      <div className="mt-0.5 rounded-full bg-muted p-1.5">
                        <Check className="size-3.5" />
                      </div>
                      <div>
                        <div className="font-medium">Applies</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          TES should evaluate the rule and create alerts when
                          requirements are missing or expiring.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="mt-0.5 rounded-full bg-muted p-1.5">
                        <X className="size-3.5" />
                      </div>
                      <div>
                        <div className="font-medium">Doesn't apply</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          TES should not create alerts for this rule because it
                          is outside this company's operations.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="mt-0.5 rounded-full bg-muted p-1.5">
                        <CircleHelp className="size-3.5" />
                      </div>
                      <div>
                        <div className="font-medium">Not configured</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          The company profile has not made a decision yet.
                          This is intentionally different from "Doesn't apply."
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-dashed">
                <CardContent className="flex gap-3 p-5">
                  <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">
                      Why this page exists
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      A compliance system should not warn a company about a
                      requirement that has nothing to do with its operations.
                      This profile gives the system the context it needs before
                      it starts evaluating documents, credentials, routes,
                      drivers, cargo, and programs.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">
                  {SECTIONS.find((section) => section.id === activeSection)
                    ?.label}
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Mark each requirement explicitly. This prevents an unanswered
                  setting from being interpreted as an operational decision.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Applicable requirements
                  </CardTitle>
                  <CardDescription>
                    Choose one answer for every rule that may affect this
                    company's compliance profile.
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0">
                  {activeRules.map((rule) => {
                    const jurisdictionMatches =
                      rule.appliesTo === "both" ||
                      draftSettings.jurisdiction === "both" ||
                      rule.appliesTo === draftSettings.jurisdiction

                    return (
                      <RuleRow
                        key={rule.id}
                        rule={rule}
                        value={
                          draftSettings.rules[rule.id] ??
                          "not-configured"
                        }
                        disabled={!jurisdictionMatches}
                        onChange={(value) => updateRule(rule.id, value)}
                      />
                    )
                  })}
                </CardContent>
              </Card>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="text-xs leading-5 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Important:
                  </span>{" "}
                  choosing <span className="font-medium">Doesn't apply</span>{" "}
                  tells TES to intentionally exclude the requirement. Choose{" "}
                  <span className="font-medium">Not configured</span> when the
                  company has not made that decision yet.
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* SAVE AREA — ONLY EXISTS WHEN DIRTY */}
      {isDirty ? (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">Unsaved changes</div>
            <p className="text-xs text-muted-foreground">
              Your changes are not active until you save this profile.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleDiscard}
            >
              Discard
            </Button>

            <Button type="button" onClick={handleSave}>
              <Check className="mr-2 size-4" />
              Save profile
            </Button>
          </div>
        </div>
      ) : saveMessage ? (
        <div className="mt-6 flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Check className="size-4" />
            {saveMessage}
          </div>

          <button
            type="button"
            onClick={() => setSaveMessage(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss save message"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
