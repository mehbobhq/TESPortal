"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Fingerprint,
  Gauge,
  History,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Workflow,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

/* =========================================================
   TYPES
========================================================= */

type ExpiryRules = {
  healthyMinDays: number
  watchMinDays: number
  urgentMinDays: number
  criticalMinDays: number
  criticalMaxDays: number
}

type SystemSettings = {
  version: number

  expiryRules: ExpiryRules

  updatedAt?: string
  updatedBy?: string
}

type SettingCategory = {
  id: string
  title: string
  description: string
  icon: React.ElementType
  status: "active" | "planned"
}

/* =========================================================
   CONSTANTS
========================================================= */

const SETTINGS_STORAGE_KEY = "tes_system_settings"

const DEFAULT_SETTINGS: SystemSettings = {
  version: 1,

  expiryRules: {
    healthyMinDays: 61,
    watchMinDays: 31,
    urgentMinDays: 11,
    criticalMinDays: 0,
    criticalMaxDays: 10,
  },
}

const SETTING_CATEGORIES: SettingCategory[] = [
  {
    id: "expiry",
    title: "Expiry & Renewal Rules",
    description:
      "Central thresholds used across licences, insurance, permits, registrations and other expiring records.",
    icon: Clock3,
    status: "active",
  },
  {
    id: "notifications",
    title: "Notifications & Escalations",
    description:
      "Control reminders, escalation timing and communication workflows.",
    icon: Bell,
    status: "planned",
  },
  {
    id: "ocr",
    title: "Document Intelligence",
    description:
      "OCR confidence, document quality and evidence acceptance rules.",
    icon: FileText,
    status: "planned",
  },
  {
    id: "identity",
    title: "Identity & Duplicate Rules",
    description:
      "Configure duplicate detection and identity-confidence thresholds.",
    icon: Fingerprint,
    status: "planned",
  },
  {
    id: "compliance",
    title: "Compliance Defaults",
    description:
      "Default system behavior for compliance evaluation and risk handling.",
    icon: ShieldCheck,
    status: "planned",
  },
  {
    id: "permissions",
    title: "Roles & Permissions",
    description:
      "Control managerial actions, editing, archive access and approvals.",
    icon: Workflow,
    status: "planned",
  },
  {
    id: "audit",
    title: "Audit & Retention",
    description:
      "Master Register, retention and historical access configuration.",
    icon: History,
    status: "planned",
  },
  {
    id: "integrations",
    title: "Integrations",
    description:
      "External systems, providers and automation connections.",
    icon: SlidersHorizontal,
    status: "planned",
  },
]

/* =========================================================
   HELPERS
========================================================= */

function loadSettings(): SystemSettings {
  try {
    const raw = localStorage.getItem(
      SETTINGS_STORAGE_KEY
    )

    if (!raw) {
      return DEFAULT_SETTINGS
    }

    const parsed = JSON.parse(raw)

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,

      expiryRules: {
        ...DEFAULT_SETTINGS.expiryRules,
        ...(parsed.expiryRules || {}),
      },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function validateExpiryRules(
  rules: ExpiryRules
) {
  /*
    Required non-overlapping order:

    Healthy: 61+
    Watch: 31–60
    Urgent: 11–30
    Critical: 0–10
    Expired: < 0
  */

  if (
    rules.criticalMinDays !== 0
  ) {
    return "Critical must begin at 0 days."
  }

  if (
    rules.criticalMaxDays >=
    rules.urgentMinDays
  ) {
    return "Critical must end before Urgent begins."
  }

  if (
    rules.urgentMinDays >=
    rules.watchMinDays
  ) {
    return "Urgent must begin before Watch."
  }

  if (
    rules.watchMinDays >=
    rules.healthyMinDays
  ) {
    return "Watch must begin before Healthy."
  }

  return null
}

/* =========================================================
   EXPIRY PREVIEW
========================================================= */

function RulePreview({
  label,
  range,
  description,
  tone,
}: {
  label: string
  range: string
  description: string
  tone:
    | "healthy"
    | "watch"
    | "urgent"
    | "critical"
    | "expired"
}) {
  const classes = {
    healthy:
      "border-emerald-200 bg-emerald-50 text-emerald-800",
    watch:
      "border-amber-200 bg-amber-50 text-amber-800",
    urgent:
      "border-red-200 bg-red-50 text-red-700",
    critical:
      "border-red-400 bg-red-100 text-red-900",
    expired:
      "border-red-700 bg-red-950 text-white",
  }

  return (
    <div
      className={`rounded-lg border p-4 ${classes[tone]}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {label}
        </p>

        <Badge
          variant="outline"
          className="border-current bg-background/40 text-current"
        >
          {range}
        </Badge>
      </div>

      <p className="mt-2 text-xs opacity-80">
        {description}
      </p>
    </div>
  )
}

/* =========================================================
   PAGE
========================================================= */

export default function SettingsPage() {
  const [settings, setSettings] =
    useState<SystemSettings>(
      DEFAULT_SETTINGS
    )

  const [draftRules, setDraftRules] =
    useState<ExpiryRules>(
      DEFAULT_SETTINGS.expiryRules
    )

  const [
    activeSection,
    setActiveSection,
  ] = useState("expiry")

  const [saved, setSaved] =
    useState(false)

  /* =======================================================
     LOAD
  ======================================================= */

  useEffect(() => {
    const loaded = loadSettings()

    setSettings(loaded)

    setDraftRules(
      loaded.expiryRules
    )
  }, [])

  /* =======================================================
     VALIDATION
  ======================================================= */

  const validationError =
    useMemo(
      () =>
        validateExpiryRules(
          draftRules
        ),
      [draftRules]
    )

  const hasChanges =
    JSON.stringify(
      draftRules
    ) !==
    JSON.stringify(
      settings.expiryRules
    )

  /* =======================================================
     SAVE
  ======================================================= */

  const saveExpiryRules = () => {
    if (validationError) return

    const updated: SystemSettings = {
      ...settings,

      expiryRules: {
        ...draftRules,
      },

      updatedAt:
        new Date().toISOString(),

      updatedBy:
        "Current User",
    }

    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(updated)
    )

    setSettings(updated)

    setSaved(true)

    window.setTimeout(
      () => setSaved(false),
      1500
    )
  }

  /* =======================================================
     UPDATE
  ======================================================= */

  const updateRule = (
    key: keyof ExpiryRules,
    value: number
  ) => {
    setDraftRules(
      (current) => ({
        ...current,
        [key]: value,
      })
    )

    setSaved(false)
  }

  /* =======================================================
     DERIVED RANGES
  ======================================================= */

  const criticalRange =
    `${draftRules.criticalMinDays}–${draftRules.criticalMaxDays} days`

  const urgentMax =
    draftRules.watchMinDays - 1

  const urgentRange =
    `${draftRules.urgentMinDays}–${urgentMax} days`

  const watchMax =
    draftRules.healthyMinDays - 1

  const watchRange =
    `${draftRules.watchMinDays}–${watchMax} days`

  const healthyRange =
    `${draftRules.healthyMinDays}+ days`

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-12">
      {/* HEADER */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Settings2 className="size-5" />
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              System Settings
            </h1>

            <p className="mt-1 text-sm text-muted-foreground">
              Configure portal-wide rules and operational behavior from one central control point.
            </p>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* SETTINGS NAV */}
        <Card className="h-fit overflow-hidden lg:sticky lg:top-6">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-sm">
              Configuration
            </CardTitle>

            <CardDescription className="text-xs">
              System-wide settings
            </CardDescription>
          </CardHeader>

          <CardContent className="p-2">
            <div className="space-y-1">
              {SETTING_CATEGORIES.map(
                (category) => {
                  const Icon =
                    category.icon

                  const active =
                    activeSection ===
                    category.id

                  return (
                    <button
                      key={
                        category.id
                      }
                      type="button"
                      onClick={() => {
                        if (
                          category.status ===
                          "active"
                        ) {
                          setActiveSection(
                            category.id
                          )
                        }
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                        active
                          ? "bg-primary/10 text-primary"
                          : category.status ===
                            "planned"
                          ? "cursor-default opacity-60"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <div
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                          active
                            ? "bg-primary/10"
                            : "bg-muted"
                        }`}
                      >
                        <Icon className="size-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-semibold">
                            {
                              category.title
                            }
                          </p>

                          {category.status ===
                            "planned" && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[8px]"
                            >
                              Later
                            </Badge>
                          )}
                        </div>

                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                          {
                            category.description
                          }
                        </p>
                      </div>

                      {category.status ===
                        "active" && (
                        <ChevronRight className="size-3.5 shrink-0" />
                      )}
                    </button>
                  )
                }
              )}
            </div>
          </CardContent>
        </Card>

        {/* CONTENT */}
        <div className="space-y-6">
          {activeSection ===
            "expiry" && (
            <>
              {/* EXPLANATION */}
              <Card className="border-primary/15">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Clock3 className="size-4" />
                    </div>

                    <div>
                      <CardTitle className="text-base">
                        Expiry & Renewal Rules
                      </CardTitle>

                      <CardDescription className="mt-1 max-w-3xl leading-5">
                        These thresholds are used across all expiring TES records, including insurance policies, licences, permits, registrations, inspections and future compliance records.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="flex items-start gap-3">
                      <Gauge className="mt-0.5 size-4 shrink-0 text-primary" />

                      <div>
                        <p className="text-xs font-semibold">
                          One rule set for the entire portal
                        </p>

                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Individual pages should never hardcode their own expiry thresholds. They read these settings and display the resulting status.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* CONFIGURATION */}
              <Card>
                <CardHeader className="border-b bg-muted/20">
                  <CardTitle className="text-sm">
                    Renewal Thresholds
                  </CardTitle>

                  <CardDescription className="text-xs">
                    Set the number of days remaining that determines each renewal state.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6 p-6">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>
                        Healthy starts at
                      </Label>

                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={
                            draftRules.healthyMinDays
                          }
                          onChange={(
                            event
                          ) =>
                            updateRule(
                              "healthyMinDays",
                              Number(
                                event
                                  .target
                                  .value
                              )
                            )
                          }
                        />

                        <span className="text-xs text-muted-foreground">
                          days
                        </span>
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Default: 61+
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Watch starts at
                      </Label>

                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={
                            draftRules.watchMinDays
                          }
                          onChange={(
                            event
                          ) =>
                            updateRule(
                              "watchMinDays",
                              Number(
                                event
                                  .target
                                  .value
                              )
                            )
                          }
                        />

                        <span className="text-xs text-muted-foreground">
                          days
                        </span>
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Default: 31
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Urgent starts at
                      </Label>

                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={
                            draftRules.urgentMinDays
                          }
                          onChange={(
                            event
                          ) =>
                            updateRule(
                              "urgentMinDays",
                              Number(
                                event
                                  .target
                                  .value
                              )
                            )
                          }
                        />

                        <span className="text-xs text-muted-foreground">
                          days
                        </span>
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Default: 11
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Critical ends at
                      </Label>

                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          value={
                            draftRules.criticalMaxDays
                          }
                          onChange={(
                            event
                          ) =>
                            updateRule(
                              "criticalMaxDays",
                              Number(
                                event
                                  .target
                                  .value
                              )
                            )
                          }
                        />

                        <span className="text-xs text-muted-foreground">
                          days
                        </span>
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Critical always begins at 0.
                      </p>
                    </div>
                  </div>

                  {/* VALIDATION */}
                  {validationError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-semibold text-red-700">
                        Invalid threshold configuration
                      </p>

                      <p className="mt-1 text-xs text-red-600">
                        {
                          validationError
                        }
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* PREVIEW */}
              <Card>
                <CardHeader className="border-b bg-muted/20">
                  <CardTitle className="text-sm">
                    Status Preview
                  </CardTitle>

                  <CardDescription className="text-xs">
                    This is how expiring records will be classified throughout TES.
                  </CardDescription>
                </CardHeader>

                <CardContent className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
                  <RulePreview
                    label="Healthy"
                    range={
                      healthyRange
                    }
                    description="No immediate renewal action required."
                    tone="healthy"
                  />

                  <RulePreview
                    label="Watch"
                    range={
                      watchRange
                    }
                    description="Renewal is approaching."
                    tone="watch"
                  />

                  <RulePreview
                    label="Urgent"
                    range={
                      urgentRange
                    }
                    description="Renewal workflow should already be underway."
                    tone="urgent"
                  />

                  <RulePreview
                    label="Critical"
                    range={
                      criticalRange
                    }
                    description="Immediate follow-up and escalation."
                    tone="critical"
                  />

                  <RulePreview
                    label="Expired"
                    range="< 0 days"
                    description="The expiry date has passed."
                    tone="expired"
                  />
                </CardContent>
              </Card>

              {/* SAVE */}
              <div className="sticky bottom-4 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    {saved ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-700">
                        <CheckCircle2 className="size-4" />
                        Settings saved
                      </div>
                    ) : hasChanges ? (
                      <p className="text-sm text-muted-foreground">
                        You have unsaved changes.
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Renewal rules are up to date.
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={
                      saveExpiryRules
                    }
                    disabled={
                      Boolean(
                        validationError
                      ) ||
                      !hasChanges
                    }
                  >
                    <Save className="mr-2 size-4" />
                    Save Rules
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
