"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import {
  CheckCircle2,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react"

import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type CompanyRecord = {
  id: string
  name?: string
  kind?: string
  region?: string
  status?: string
}

type CredentialCategory =
  | "Fleet"
  | "Compliance"
  | "Registration"
  | "Insurance"
  | "Accounting"
  | "Fuel"
  | "Other"

type CredentialStatus = "Active" | "Needs verification" | "Locked" | "Disabled"

type PortalDefinition = {
  id: string
  name: string
  legalName: string
  jurisdiction: string
  country: string
  services: string[]
  aliases: string[]
  loginUrl: string
}

type RecoveryMethodType =
  | "Recovery email"
  | "Recovery phone"
  | "Recovery PIN"
  | "Backup codes"
  | "MFA recovery"
  | "Other"

type SecurityQuestionDraft = {
  id: string
  question: string
  answer: string
}

type RecoveryMethodDraft = {
  id: string
  type: RecoveryMethodType
  label: string
  value: string
}

type CredentialMetadata = {
  id: string
  companyId: string
  portalId: string
  category: CredentialCategory
  username: string
  status: CredentialStatus
  lastVerifiedAt?: string
  createdAt: string
  updatedAt: string
}

const CATEGORIES: Array<"All" | CredentialCategory> = [
  "All",
  "Fleet",
  "Compliance",
  "Registration",
  "Insurance",
  "Accounting",
  "Fuel",
  "Other",
]

/**
 * Phase-1 seed for the TES-global Portal Registry.
 *
 * IMPORTANT:
 * This is deliberately separate from company credentials. A company credential
 * references portalId; it never creates another ATIOS definition or URL.
 *
 * Move this registry to the production database when the backend is introduced.
 */
const PORTAL_REGISTRY: PortalDefinition[] = [
  {
    id: "CA-AB-ATIOS",
    name: "ATIOS Alberta",
    legalName: "Alberta Transportation Online Services",
    jurisdiction: "Alberta",
    country: "Canada",
    services: ["IRP"],
    aliases: ["ATIOS", "IRP Alberta", "Alberta IRP"],
    loginUrl: "",
  },
  {
    id: "CA-AB-TRACS",
    name: "TRACS Alberta",
    legalName: "Tax and Revenue Administration Client Self-Service",
    jurisdiction: "Alberta",
    country: "Canada",
    services: ["IFTA"],
    aliases: ["TRACS", "IFTA Alberta", "Alberta IFTA"],
    loginUrl: "",
  },
]


function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase()
}

function normalizeSearch(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[.\-_]/g, " ")
    .replace(/\s+/g, " ")
}

function portalSearchText(portal: PortalDefinition) {
  return normalizeSearch(
    [
      portal.name,
      portal.legalName,
      portal.jurisdiction,
      ...portal.services,
      ...portal.aliases,
    ].join(" ")
  )
}

function maskUsername(value: string) {
  if (!value) return "—"
  const at = value.indexOf("@")
  if (at > 1) {
    const local = value.slice(0, at)
    const domain = value.slice(at)
    return `${local[0]}${"•".repeat(Math.min(Math.max(local.length - 1, 4), 8))}${domain}`
  }
  if (value.length <= 3) return `${value[0] || ""}••`
  return `${value.slice(0, 2)}${"•".repeat(Math.min(value.length - 2, 8))}`
}

function formatDate(value?: string) {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Never"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function statusClasses(status: CredentialStatus) {
  if (status === "Active") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "Needs verification") return "border-amber-200 bg-amber-50 text-amber-700"
  if (status === "Locked") return "border-red-200 bg-red-50 text-red-700"
  return "border-border bg-muted text-muted-foreground"
}

export default function CredentialsPage() {
  const params = useParams<{ id: string }>()
  const companyId = params?.id ?? ""

  const [company, setCompany] = useState<CompanyRecord | null>(null)
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([])
  const [loading, setLoading] = useState(true)

  const [searchQuery, setSearchQuery] = useState("")
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All")
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)

  const [portalQuery, setPortalQuery] = useState("")
  const [selectedPortalId, setSelectedPortalId] = useState("")
  const [isPortalCreateOpen, setIsPortalCreateOpen] = useState(false)
  const [customPortalName, setCustomPortalName] = useState("")
  const [customPortalPurpose, setCustomPortalPurpose] = useState("")
  const [customPortalJurisdiction, setCustomPortalJurisdiction] = useState("")
  const [customPortalCountry, setCustomPortalCountry] = useState("")
  const [customPortalUrl, setCustomPortalUrl] = useState("")
  const [credentialCategory, setCredentialCategory] =
    useState<CredentialCategory>("Registration")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [mfaMethod, setMfaMethod] = useState("")

  const [securityQuestions, setSecurityQuestions] =
    useState<SecurityQuestionDraft[]>([])
  const [recoveryMethods, setRecoveryMethods] = useState<RecoveryMethodDraft[]>([])
  const [showRecoveryMenu, setShowRecoveryMenu] = useState(false)

  const [formError, setFormError] = useState<string | null>(null)
  const [securityNotice, setSecurityNotice] = useState<string | null>(null)

  const storageKey = `tes_company_credentials_${companyId}`
  const portalRegistryStorageKey = "tes_portal_registry_v1"
  const [customPortals, setCustomPortals] = useState<PortalDefinition[]>([])

  useEffect(() => {
    try {
      if (!companyId) {
        setLoading(false)
        return
      }

      const companies: CompanyRecord[] = JSON.parse(
        localStorage.getItem("tes_companies") || "[]"
      )
      setCompany(companies.find((item) => item.id === companyId) || null)

      const stored = localStorage.getItem(storageKey)
      const parsed = stored ? JSON.parse(stored) : []
      setCredentials(Array.isArray(parsed) ? parsed : [])

      const storedPortals = localStorage.getItem(portalRegistryStorageKey)
      const parsedPortals = storedPortals ? JSON.parse(storedPortals) : []
      setCustomPortals(Array.isArray(parsedPortals) ? parsedPortals : [])
    } catch (error) {
      console.error("Failed to load credential metadata:", error)
      setCredentials([])
    } finally {
      setLoading(false)
    }
  }, [companyId, storageKey])

  const allPortals = useMemo(
    () => [...PORTAL_REGISTRY, ...customPortals],
    [customPortals]
  )

  const filteredCredentials = useMemo(() => {
    const query = normalizeSearch(searchQuery)

    return credentials.filter((credential) => {
      const portal = allPortals.find((item) => item.id === credential.portalId)
      if (!portal) return false

      if (category !== "All" && credential.category !== category) return false
      if (!query) return true

      const searchable = normalizeSearch(
        [
          portal.name,
          portal.legalName,
          portal.jurisdiction,
          ...portal.services,
          ...portal.aliases,
          credential.category,
          credential.username,
          credential.status,
        ].join(" ")
      )

      return searchable.includes(query)
    })
  }, [credentials, category, searchQuery, allPortals])

  const portalResults = useMemo(() => {
    const query = normalizeSearch(portalQuery)
    if (!query) return allPortals

    return allPortals.filter((portal) =>
      portalSearchText(portal).includes(query)
    )
  }, [portalQuery, allPortals])

  const selectedPortal =
    allPortals.find((portal) => portal.id === selectedPortalId) || null

  const resetCreate = () => {
    setCreateStep(1)
    setPortalQuery("")
    setSelectedPortalId("")
    setIsPortalCreateOpen(false)
    setCustomPortalName("")
    setCustomPortalPurpose("")
    setCustomPortalJurisdiction("")
    setCustomPortalCountry("")
    setCustomPortalUrl("")
    setCredentialCategory("Registration")
    setUsername("")
    setPassword("")
    setMfaMethod("")
    setSecurityQuestions([])
    setRecoveryMethods([])
    setShowRecoveryMenu(false)
    setFormError(null)
    setSecurityNotice(null)
  }

  const openCreate = () => {
    resetCreate()
    setIsCreateOpen(true)
  }

  const closeCreate = () => {
    setIsCreateOpen(false)
    resetCreate()
  }

  const createPortalDefinition = () => {
    setFormError(null)

    const name = customPortalName.trim()
    const purpose = customPortalPurpose.trim()
    const jurisdiction = customPortalJurisdiction.trim()
    const country = customPortalCountry.trim()
    const loginUrl = customPortalUrl.trim()

    if (!name || !purpose || !loginUrl) {
      setFormError("Portal name, purpose and web portal link are required.")
      return
    }

    const normalizedName = normalizeSearch(name)
    const duplicatePortal = allPortals.find(
      (portal) => normalizeSearch(portal.name) === normalizedName
    )
    if (duplicatePortal) {
      setFormError(`"${duplicatePortal.name}" already exists in the TES Portal Registry.`)
      return
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(loginUrl)
      if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error()
    } catch {
      setFormError("Enter a valid http or https web portal link.")
      return
    }

    const newPortal: PortalDefinition = {
      id: `PORTAL-${crypto.randomUUID()}`,
      name,
      legalName: name,
      jurisdiction,
      country,
      services: [purpose],
      aliases: [],
      loginUrl: parsedUrl.toString(),
    }

    const next = [...customPortals, newPortal]
    try {
      localStorage.setItem(portalRegistryStorageKey, JSON.stringify(next))
      setCustomPortals(next)
      setSelectedPortalId(newPortal.id)
      setPortalQuery(newPortal.name)
      setIsPortalCreateOpen(false)
    } catch (error) {
      console.error("Failed to save portal registry metadata:", error)
      setFormError("The new portal/system could not be saved.")
    }
  }

  const validateCredentialIdentity = () => {
    setFormError(null)
    setSecurityNotice(null)

    if (!selectedPortal) {
      setFormError("Select a portal or system before saving.")
      return false
    }

    if (!username.trim()) {
      setFormError("Username is required.")
      return false
    }

    const duplicate = credentials.find(
      (item) =>
        item.portalId === selectedPortal.id &&
        normalizeUsername(item.username) === normalizeUsername(username)
    )

    if (duplicate) {
      setFormError(
        `${selectedPortal.name} already has this account for ${company?.name || "this company"}. Open the existing credential instead of creating a duplicate.`
      )
      return false
    }

    return true
  }

  const continueToRecovery = () => {
    if (!validateCredentialIdentity()) return
    setCreateStep(2)
  }

  const addSecurityQuestion = () => {
    setSecurityQuestions((current) => [
      ...current,
      { id: crypto.randomUUID(), question: "", answer: "" },
    ])
  }

  const addRecoveryMethod = (type: RecoveryMethodType) => {
    setRecoveryMethods((current) => [
      ...current,
      { id: crypto.randomUUID(), type, label: "", value: "" },
    ])
    setShowRecoveryMenu(false)
  }

  const saveCredential = () => {
    if (!validateCredentialIdentity() || !selectedPortal) return

    const hasSecretMaterial =
      Boolean(password.trim()) ||
      securityQuestions.some((item) => item.answer.trim()) ||
      recoveryMethods.some((item) =>
        ["Recovery PIN", "Backup codes", "MFA recovery", "Other"].includes(item.type)
          ? Boolean(item.value.trim())
          : false
      )

    if (hasSecretMaterial) {
      setSecurityNotice(
        "TES will not store passwords or protected recovery secrets in browser localStorage. Connect the protected secret-storage service before saving secret material. You can clear those protected fields and save the credential metadata now."
      )
      return
    }

    const now = new Date().toISOString()
    const newCredential: CredentialMetadata = {
      id: crypto.randomUUID(),
      companyId,
      portalId: selectedPortal.id,
      category: credentialCategory,
      username: username.trim(),
      status: "Needs verification",
      createdAt: now,
      updatedAt: now,
    }

    const next = [newCredential, ...credentials]

    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setCredentials(next)
      closeCreate()
    } catch (error) {
      console.error("Failed to save credential metadata:", error)
      setFormError("Credential metadata could not be saved. Please retry.")
    }
  }

  const openPortal = (portal: PortalDefinition) => {
    if (!portal.loginUrl) {
      window.alert(
        `${portal.name} does not yet have a canonical login URL in the TES Portal Registry.`
      )
      return
    }
    window.open(portal.loginUrl, "_blank", "noopener,noreferrer")
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
        Loading credentials…
      </div>
    )
  }

  return (
    <>
      <CompanyWorkspaceHeader
        company={{
          id: company?.id || companyId,
          name: company?.name || "Company",
          kind: company?.kind || "Customer",
          status: company?.status || "Active",
        }}
        section="Credentials"
        description="Company login accounts linked to TES-managed external portals and systems."
      />

      <div className="space-y-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search ATIOS Alberta, TRACS Alberta, IRP, IFTA, username…"
              className="pl-9"
            />
          </div>

          <Button onClick={openCreate} className="shrink-0">
            <Plus className="mr-2 size-4" />
            Add credential
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border pb-3">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={[
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                category === item
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {item}
            </button>
          ))}
        </div>

        {filteredCredentials.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <CardContent className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 flex size-11 items-center justify-center rounded-xl border bg-muted/40">
                <KeyRound className="size-5 text-muted-foreground" />
              </div>
              <h2 className="text-base font-semibold">No credentials found</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Add a company account by selecting a canonical TES portal. Portal
                names and login URLs are maintained once globally and are never
                duplicated per company.
              </p>
              <Button onClick={openCreate} variant="outline" className="mt-5">
                <Plus className="mr-2 size-4" />
                Add credential
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="grid grid-cols-[minmax(260px,2fr)_minmax(150px,1fr)_minmax(180px,1fr)_150px_160px_70px] border-b bg-muted/30 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <div>Portal / System</div>
              <div>Category</div>
              <div>Username</div>
              <div>Status</div>
              <div>Last verified</div>
              <div className="text-right">Action</div>
            </div>

            {filteredCredentials.map((credential) => {
              const portal = allPortals.find(
                (item) => item.id === credential.portalId
              )
              if (!portal) return null

              return (
                <div
                  key={credential.id}
                  className="grid grid-cols-[minmax(260px,2fr)_minmax(150px,1fr)_minmax(180px,1fr)_150px_160px_70px] items-center border-b px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">{portal.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {portal.legalName}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {portal.services.join(" · ")}
                    </div>
                  </div>
                  <div className="text-sm">{credential.category}</div>
                  <div className="truncate font-mono text-xs">
                    {maskUsername(credential.username)}
                  </div>
                  <div>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(
                        credential.status
                      )}`}
                    >
                      {credential.status}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(credential.lastVerifiedAt)}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => openPortal(portal)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Open portal"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
            <div className="flex items-start justify-between border-b px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold">Add Credential</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {company?.name || "Company"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreate}
                className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="border-b px-6">
              <div className="flex gap-8">
                <button
                  type="button"
                  onClick={() => setCreateStep(1)}
                  className={`border-b-2 py-3 text-sm font-semibold ${
                    createStep === 1
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground"
                  }`}
                >
                  1&nbsp;&nbsp;Login Credentials
                </button>
                <button
                  type="button"
                  disabled={!selectedPortalId || !username.trim()}
                  onClick={() => setCreateStep(2)}
                  className={`border-b-2 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                    createStep === 2
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground"
                  }`}
                >
                  2&nbsp;&nbsp;Account Recovery
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              {formError ? (
                <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              ) : null}

              {securityNotice ? (
                <div className="mb-5 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                  <div>{securityNotice}</div>
                </div>
              ) : null}

              {createStep === 1 ? (
                <div className="space-y-6">
                  <section className="space-y-3">
                    <div>
                      <label className="text-sm font-semibold">Portal / System</label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Search by official name, common name, service, or alias.
                      </p>
                    </div>

                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={portalQuery}
                        onChange={(event) => {
                          setPortalQuery(event.target.value)
                          setSelectedPortalId("")
                        }}
                        placeholder="e.g. ATIOS Alberta, TRACS Alberta, IRP, IFTA"
                        className="pl-9"
                      />
                    </div>

                    <div className="overflow-hidden rounded-xl border">
                      {portalResults.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                          No canonical TES portal matches this search.
                        </div>
                      ) : (
                        portalResults.map((portal) => (
                          <button
                            key={portal.id}
                            type="button"
                            onClick={() => {
                              setSelectedPortalId(portal.id)
                              setPortalQuery(portal.name)
                            }}
                            className={`flex w-full items-start justify-between gap-4 border-b px-4 py-3 text-left last:border-b-0 ${
                              selectedPortalId === portal.id
                                ? "bg-primary/5"
                                : "hover:bg-muted/50"
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{portal.name}</span>
                                {selectedPortalId === portal.id ? (
                                  <CheckCircle2 className="size-4 text-primary" />
                                ) : null}
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {portal.legalName}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {[portal.jurisdiction, portal.country].filter(Boolean).join(", ")} · {portal.services.join(" · ")}
                              </div>
                            </div>
                            <span className="rounded-md border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground">
                              {portal.id}
                            </span>
                          </button>
                        ))
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setIsPortalCreateOpen((current) => !current)
                        setCustomPortalName(portalQuery.trim())
                        setFormError(null)
                      }}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                    >
                      <Plus className="size-4" />
                      Add new portal/system
                    </button>

                    {isPortalCreateOpen ? (
                      <div className="rounded-xl border bg-muted/20 p-4">
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold">Create portal/system</h4>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Create a canonical TES portal only after confirming it does not already exist.
                          </p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold">Canonical name</span>
                            <Input
                              value={customPortalName}
                              onChange={(event) => setCustomPortalName(event.target.value)}
                              placeholder="e.g. ATIOS Alberta"
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold">Purpose</span>
                            <Input
                              value={customPortalPurpose}
                              onChange={(event) => setCustomPortalPurpose(event.target.value)}
                              placeholder="e.g. IRP"
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold">Jurisdiction</span>
                            <Input
                              value={customPortalJurisdiction}
                              onChange={(event) => setCustomPortalJurisdiction(event.target.value)}
                              placeholder="Province / state if applicable"
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold">Country</span>
                            <Input
                              value={customPortalCountry}
                              onChange={(event) => setCustomPortalCountry(event.target.value)}
                              placeholder="Country"
                            />
                          </label>
                          <label className="space-y-1.5 md:col-span-2">
                            <span className="text-xs font-semibold">Web portal link</span>
                            <Input
                              value={customPortalUrl}
                              onChange={(event) => setCustomPortalUrl(event.target.value)}
                              placeholder="https://..."
                            />
                          </label>
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsPortalCreateOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="button" size="sm" onClick={createPortalDefinition}>
                            Create & select
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold">Category</span>
                      <select
                        value={credentialCategory}
                        onChange={(event) =>
                          setCredentialCategory(
                            event.target.value as CredentialCategory
                          )
                        }
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {CATEGORIES.filter((item) => item !== "All").map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-semibold">Username</span>
                      <Input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        autoComplete="off"
                        placeholder="Username or account email"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        Password
                        <LockKeyhole className="size-3.5 text-muted-foreground" />
                      </span>
                      <Input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="new-password"
                        placeholder="Protected secret"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-semibold">
                        MFA / Authentication method
                      </span>
                      <Input
                        value={mfaMethod}
                        onChange={(event) => setMfaMethod(event.target.value)}
                        placeholder="Authenticator app, SMS, email…"
                      />
                    </label>
                  </div>

                  <div className="rounded-lg border bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
                    Portal identity and login URL come from the TES-global Portal
                    Registry. This company record stores only the company's account
                    relationship to that portal.
                  </div>
                </div>
              ) : (
                <div className="space-y-7">
                  <section>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold">Security Questions</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Store only the recovery questions actually configured by
                          the external portal.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addSecurityQuestion}
                      >
                        <Plus className="mr-1.5 size-3.5" />
                        Add question
                      </Button>
                    </div>

                    {securityQuestions.length === 0 ? (
                      <div className="mt-3 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
                        No security questions added.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {securityQuestions.map((item, index) => (
                          <div
                            key={item.id}
                            className="rounded-xl border bg-card p-4"
                          >
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Question {index + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setSecurityQuestions((current) =>
                                    current.filter((question) => question.id !== item.id)
                                  )
                                }
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                Remove
                              </button>
                            </div>
                            <div className="grid gap-3">
                              <Input
                                value={item.question}
                                onChange={(event) =>
                                  setSecurityQuestions((current) =>
                                    current.map((question) =>
                                      question.id === item.id
                                        ? { ...question, question: event.target.value }
                                        : question
                                    )
                                  )
                                }
                                placeholder="Security question"
                              />
                              <Input
                                type="password"
                                value={item.answer}
                                onChange={(event) =>
                                  setSecurityQuestions((current) =>
                                    current.map((question) =>
                                      question.id === item.id
                                        ? { ...question, answer: event.target.value }
                                        : question
                                    )
                                  )
                                }
                                placeholder="Protected answer"
                                autoComplete="off"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold">
                          Other recovery methods
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Add only the methods used by this account.
                        </p>
                      </div>

                      <div className="relative">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowRecoveryMenu((current) => !current)}
                        >
                          <Plus className="mr-1.5 size-3.5" />
                          Add recovery method
                        </Button>

                        {showRecoveryMenu ? (
                          <div className="absolute right-0 top-10 z-20 w-52 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
                            {(
                              [
                                "Recovery email",
                                "Recovery phone",
                                "Recovery PIN",
                                "Backup codes",
                                "MFA recovery",
                                "Other",
                              ] as RecoveryMethodType[]
                            ).map((type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => addRecoveryMethod(type)}
                                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                              >
                                {type}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {recoveryMethods.length === 0 ? (
                      <div className="mt-3 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
                        No additional recovery methods added.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {recoveryMethods.map((method) => (
                          <div
                            key={method.id}
                            className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[170px_1fr_1fr_auto]"
                          >
                            <div className="self-center text-sm font-semibold">
                              {method.type}
                            </div>
                            <Input
                              value={method.label}
                              onChange={(event) =>
                                setRecoveryMethods((current) =>
                                  current.map((item) =>
                                    item.id === method.id
                                      ? { ...item, label: event.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder={
                                method.type === "Other"
                                  ? "Method / label"
                                  : "Label (optional)"
                              }
                            />
                            <Input
                              type={
                                ["Recovery PIN", "Backup codes", "MFA recovery"].includes(
                                  method.type
                                )
                                  ? "password"
                                  : "text"
                              }
                              value={method.value}
                              onChange={(event) =>
                                setRecoveryMethods((current) =>
                                  current.map((item) =>
                                    item.id === method.id
                                      ? { ...item, value: event.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder={
                                method.type === "Recovery email"
                                  ? "Recovery email address"
                                  : method.type === "Recovery phone"
                                    ? "Recovery phone number"
                                    : "Protected recovery value"
                              }
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setRecoveryMethods((current) =>
                                  current.filter((item) => item.id !== method.id)
                                )
                              }
                              className="flex size-9 items-center justify-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={`Remove ${method.type}`}
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                    Passwords, security answers, recovery PINs, backup codes and MFA
                    recovery secrets are sensitive authentication material. TES will
                    not write them to browser localStorage.
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t px-6 py-4">
              <div className="text-xs text-muted-foreground">
                {selectedPortal ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5" />
                    {selectedPortal.name}
                  </span>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={createStep === 1 ? closeCreate : () => setCreateStep(1)}
                >
                  {createStep === 1 ? "Cancel" : "Back"}
                </Button>

                {createStep === 1 ? (
                  <>
                    <Button type="button" variant="outline" onClick={saveCredential}>
                      Save credential
                    </Button>
                    <Button type="button" onClick={continueToRecovery}>
                      Account Recovery
                      <ChevronRight className="ml-2 size-4" />
                    </Button>
                  </>
                ) : (
                  <Button type="button" onClick={saveCredential}>
                    Save credential
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
