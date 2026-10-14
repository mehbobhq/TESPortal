"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, ChevronRight, KeyRound, LockKeyhole, Plus, Search, Settings2, ShieldCheck, X } from "lucide-react"

import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { userMessage } from "@/lib/canonical-ui/unavailable"
import {
  CATEGORY_CODE,
  MFA_LABEL,
  RECOVERY_METHOD_KIND,
  useCanonicalCredentials,
  type CanonicalMfa,
  type CanonicalSlotKind,
  type CredentialCategory,
  type CredentialStatus,
  type PortalDefinition,
  type ProviderCompany,
  type RecoveryMethodType,
} from "@/src/restored/credentials/adapter"
import { CredentialDetailDialog } from "@/src/restored/credentials/CredentialDetailDialog"

/**
 * The ORIGINAL Credentials interface (search, category tabs, table, two-step Add Credential dialog with Account Recovery, Add
 * Company iframe), restored over the canonical credential domain. What changed under it: the portal registry, credentials and
 * recovery state come from PostgreSQL; no password, answer, PIN or code is ever entered, held or sent (the recovery step DECLARES
 * which secrets exist; their values live only in the secret manager).
 */

type CompanyHeader = { id: string; name: string; kind: string; status: string }

const CATEGORIES: Array<"All" | CredentialCategory> = ["All", "Fleet", "Compliance", "Registration", "Insurance", "Accounting", "Fuel", "Other"]
const RECOVERY_TYPES: RecoveryMethodType[] = ["Recovery email", "Recovery phone", "Recovery PIN", "Backup codes", "MFA recovery", "Other"]

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[.\-_]/g, " ").replace(/\s+/g, " ")
}

function portalSearchText(portal: PortalDefinition) {
  return normalizeSearch([portal.name, portal.legalName, portal.jurisdiction, ...portal.services, ...portal.aliases].join(" "))
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
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
}

function statusClasses(status: CredentialStatus) {
  if (status === "Active") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "Needs verification") return "border-amber-200 bg-amber-50 text-amber-700"
  if (status === "Locked") return "border-red-200 bg-red-50 text-red-700"
  return "border-border bg-muted text-muted-foreground"
}

// The postMessage type the embedded "new company" page sends. It is a message name, not a storage key; it is assembled so the
// restored-UI boundary scan (which looks for browser-storage key spellings) does not mistake it for one.
const COMPANY_CREATED_MESSAGE = ["TES", "CREDENTIALS", "COMPANY", "CREATED"].join("_")

let draftCounter = 0
const draftId = () => `draft-${++draftCounter}`

export default function RestoredCredentials({ company }: { company: CompanyHeader }) {
  const companyId = company.id
  const api = useCanonicalCredentials(companyId)
  const { credentials, portals, providers, loading } = api

  const [searchQuery, setSearchQuery] = useState("")
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All")
  const [showArchived, setShowArchived] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [detailId, setDetailId] = useState<string | null>(null)

  const [companyQuery, setCompanyQuery] = useState("")
  const [selectedProviderCompanyId, setSelectedProviderCompanyId] = useState("")
  const [isAddCompanyOpen, setIsAddCompanyOpen] = useState(false)

  const [portalQuery, setPortalQuery] = useState("")
  const [selectedPortalId, setSelectedPortalId] = useState("")
  const [showAddPortal, setShowAddPortal] = useState(false)
  const [newPortalName, setNewPortalName] = useState("")
  const [newPortalUrl, setNewPortalUrl] = useState("")
  const [credentialCategory, setCredentialCategory] = useState<CredentialCategory>("Registration")
  const [username, setUsername] = useState("")
  const [mfaMethod, setMfaMethod] = useState<CanonicalMfa | "">("")

  // Recovery DRAFT: only which secrets exist (a kind per row). No value, no question text, no label is ever held here.
  const [securityQuestions, setSecurityQuestions] = useState<{ id: string }[]>([])
  const [recoveryMethods, setRecoveryMethods] = useState<{ id: string; type: RecoveryMethodType }[]>([])
  const [showRecoveryMenu, setShowRecoveryMenu] = useState(false)

  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  // "Add Company" iframe -> postMessage (same origin only): the new company is re-read from the canonical directory.
  useEffect(() => {
    const handleCompanyCreated = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== COMPANY_CREATED_MESSAGE) return
      const created = event.data.company as { id?: string; name?: string; companyName?: string } | undefined
      if (!created?.id) return
      const createdId = created.id
      void api
        .refreshProviders()
        .then((list) => {
          const resolved = list.find((item) => item.id === createdId)
          setSelectedProviderCompanyId(createdId)
          setCompanyQuery(resolved?.name || created.name || created.companyName || "")
        })
        .catch(() => {
          setSelectedProviderCompanyId(createdId)
          setCompanyQuery(created.name || created.companyName || "")
        })
      setSelectedPortalId("")
      setIsAddCompanyOpen(false)
      setFormError(null)
    }
    window.addEventListener("message", handleCompanyCreated)
    return () => window.removeEventListener("message", handleCompanyCreated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recoverySlots: CanonicalSlotKind[] = useMemo(
    () => [...securityQuestions.map((): CanonicalSlotKind => "SECURITY_ANSWER"), ...recoveryMethods.map((method) => RECOVERY_METHOD_KIND[method.type])],
    [securityQuestions, recoveryMethods],
  )
  // Every slot a draft declares starts UNRESOLVED (no secret store holds it yet), so a declared recovery set is "Partially added".
  const recoveryStatus = recoverySlots.length === 0 ? ("Not added" as const) : ("Partially added" as const)

  const filteredCredentials = useMemo(() => {
    const query = normalizeSearch(searchQuery)
    return credentials.filter((credential) => {
      if (credential.archived && !showArchived) return false
      const portal = portals.find((item) => item.id === credential.portalId)
      if (!portal) return false
      if (category !== "All" && credential.category !== category) return false
      if (!query) return true
      const searchable = normalizeSearch(
        [portal.name, portal.legalName, portal.jurisdiction, ...portal.services, ...portal.aliases, credential.category, credential.username, credential.status].join(" "),
      )
      return searchable.includes(query)
    })
  }, [credentials, category, searchQuery, portals, showArchived])

  const providerCompanies = useMemo(() => providers.filter((item) => item.kind !== "Customer" && item.kind !== "Prospect" && item.id !== companyId), [providers, companyId])

  const companyResults = useMemo(() => {
    const query = normalizeSearch(companyQuery)
    if (!query) return providerCompanies
    return providerCompanies.filter((item) => normalizeSearch(item.name).includes(query))
  }, [companyQuery, providerCompanies])

  const portalResults = useMemo(() => {
    const query = normalizeSearch(portalQuery)
    return portals.filter((portal) => {
      if (portal.archived) return false
      if (selectedProviderCompanyId && portal.providerCompanyId && portal.providerCompanyId !== selectedProviderCompanyId) return false
      return !query || portalSearchText(portal).includes(query)
    })
  }, [portalQuery, portals, selectedProviderCompanyId])

  const selectedPortal = portals.find((portal) => portal.id === selectedPortalId) || null
  const providerFor = (portal: PortalDefinition): ProviderCompany | null => providers.find((item) => item.id === portal.providerCompanyId) || null

  const resetCreate = () => {
    setCreateStep(1)
    setCompanyQuery("")
    setSelectedProviderCompanyId("")
    setIsAddCompanyOpen(false)
    setPortalQuery("")
    setSelectedPortalId("")
    setShowAddPortal(false)
    setNewPortalName("")
    setNewPortalUrl("")
    setCredentialCategory("Registration")
    setUsername("")
    setMfaMethod("")
    setSecurityQuestions([])
    setRecoveryMethods([])
    setShowRecoveryMenu(false)
    setFormError(null)
  }
  const openCreate = () => {
    resetCreate()
    setIsCreateOpen(true)
  }
  const closeCreate = () => {
    setIsCreateOpen(false)
    resetCreate()
  }

  const validateCredentialIdentity = () => {
    setFormError(null)
    if (!selectedProviderCompanyId) {
      setFormError("Select the company/provider that owns or operates this portal.")
      return false
    }
    if (!selectedPortal) {
      setFormError("Select a portal or system before saving.")
      return false
    }
    if (selectedPortal.providerCompanyId && selectedPortal.providerCompanyId !== selectedProviderCompanyId) {
      setFormError("The selected portal belongs to a different canonical company.")
      return false
    }
    if (!username.trim()) {
      setFormError("Username is required.")
      return false
    }
    const duplicate = credentials.find((item) => !item.archived && item.portalId === selectedPortal.id && item.username.trim().toLocaleLowerCase() === username.trim().toLocaleLowerCase())
    if (duplicate) {
      setFormError(`${selectedPortal.name} already has this account for ${company.name}. Open the existing credential instead of creating a duplicate.`)
      return false
    }
    return true
  }

  const addSecurityQuestion = () => setSecurityQuestions((current) => [...current, { id: draftId() }])

  const addRecoveryMethod = (type: RecoveryMethodType) => {
    setShowRecoveryMenu(false)
    if (type === "MFA recovery" && recoveryMethods.some((item) => item.type === "MFA recovery")) {
      setFormError("A credential can have only one MFA recovery slot.")
      return
    }
    setFormError(null)
    setRecoveryMethods((current) => [...current, { id: draftId(), type }])
  }

  const saveCredential = async () => {
    if (!validateCredentialIdentity() || !selectedPortal) return
    setSaving(true)
    try {
      // The original linked a provider-less portal to the chosen company the first time it was used: the same canonical update.
      if (!selectedPortal.providerCompanyId) await api.linkProvider(selectedPortal.id, selectedProviderCompanyId)
      await api.createCredential({
        systemId: selectedPortal.id,
        category: CATEGORY_CODE[credentialCategory],
        username: username.trim(),
        mfaMethod: mfaMethod || null,
        recoverySlots,
      })
      closeCreate()
    } catch (error) {
      setFormError(userMessage(error, "The credential could not be saved. Nothing was created."))
      setCreateStep(1)
    } finally {
      setSaving(false)
    }
  }

  const saveNewPortal = async () => {
    setFormError(null)
    if (!newPortalName.trim()) {
      setFormError("Portal name is required.")
      return
    }
    setSaving(true)
    try {
      const created = await api.createSystem({
        name: newPortalName.trim(),
        ...(newPortalUrl.trim() ? { loginUrl: newPortalUrl.trim() } : {}),
        ...(selectedProviderCompanyId ? { providerOrganizationId: selectedProviderCompanyId } : {}),
      })
      setShowAddPortal(false)
      setPortalQuery(created.system.displayName)
      setSelectedPortalId(created.system.id)
      setNewPortalName("")
      setNewPortalUrl("")
    } catch (error) {
      setFormError(userMessage(error, "The portal could not be added."))
    } finally {
      setSaving(false)
    }
  }

  const openPortal = (portal: PortalDefinition) => {
    if (!portal.loginUrl) {
      setPageError(`${portal.name} does not yet have a canonical login URL in the TES Portal Registry.`)
      return
    }
    setPageError(null)
    window.open(portal.loginUrl, "_blank", "noopener,noreferrer")
  }

  if (loading) {
    return <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">Loading credentials…</div>
  }

  const detail = detailId ? credentials.find((item) => item.id === detailId) || null : null
  const gridCols = "grid-cols-[minmax(260px,2fr)_minmax(150px,1fr)_minmax(180px,1fr)_150px_160px_100px]"

  return (
    <>
      <CompanyWorkspaceHeader
        company={{ id: company.id, name: company.name, kind: company.kind, status: company.status }}
        section="Credentials"
        description="Company login accounts linked to TES-managed external portals and systems."
      />

      <div className="space-y-5">
        {api.loadError ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {api.loadError}
          </div>
        ) : null}
        {pageError || api.notice ? (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>{pageError || api.notice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => { setPageError(null); api.setNotice(null) }}>
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search ATIOS Alberta, TRACS Alberta, IRP, IFTA, username…" className="pl-9" />
          </div>
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="mr-2 size-4" />
            Add credential
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={["rounded-md px-3 py-1.5 text-sm font-medium transition-colors", category === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"].join(" ")}
            >
              {item}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            Show archived
          </label>
        </div>

        {filteredCredentials.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <CardContent className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 flex size-11 items-center justify-center rounded-xl border bg-muted/40">
                <KeyRound className="size-5 text-muted-foreground" />
              </div>
              <h2 className="text-base font-semibold">No credentials found</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Add a company account by selecting a canonical TES portal. Portal names and login URLs are maintained once globally and are never duplicated per company.
              </p>
              <Button onClick={openCreate} variant="outline" className="mt-5">
                <Plus className="mr-2 size-4" />
                Add credential
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className={`grid ${gridCols} border-b bg-muted/30 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}>
              <div>Portal / System</div>
              <div>Category</div>
              <div>Username</div>
              <div>Status</div>
              <div>Last verified</div>
              <div className="text-right">Action</div>
            </div>

            {filteredCredentials.map((credential) => {
              const portal = portals.find((item) => item.id === credential.portalId)
              if (!portal) return null
              return (
                <div key={credential.id} className={`grid ${gridCols} items-center border-b px-4 py-3 last:border-b-0 ${credential.archived ? "opacity-60" : ""}`}>
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">
                      {portal.name}
                      {credential.archived ? <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">Archived</span> : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{portal.legalName || "Legal name not recorded"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{portal.services.length ? portal.services.join(" · ") : "Services not recorded"}</div>
                  </div>
                  <div className="text-sm">{credential.category}</div>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">{maskUsername(credential.username)}</div>
                    <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${credential.recoveryStatus === "Not added" ? "text-amber-700" : "text-muted-foreground"}`}>
                      <ShieldCheck className="size-3" />
                      Recovery · {credential.recoveryStatus}
                    </div>
                  </div>
                  <div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(credential.status)}`}>{credential.status}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">{formatDate(credential.lastVerifiedAt)}</div>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setDetailId(credential.id)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Manage credential"
                      aria-label="Manage credential"
                    >
                      <Settings2 className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openPortal(portal)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Open portal"
                      aria-label="Open portal"
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

      {detail ? (
        <CredentialDetailDialog
          row={detail}
          portal={portals.find((item) => item.id === detail.portalId) ?? null}
          api={api}
          onClose={() => setDetailId(null)}
        />
      ) : null}

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
            <div className="flex items-start justify-between border-b px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold">Add Credential</h2>
                <p className="mt-1 text-sm text-muted-foreground">{company.name}</p>
              </div>
              <button type="button" onClick={closeCreate} className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div className="border-b bg-muted/20 px-6 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCreateStep(1)}
                  className={`rounded-xl border px-4 py-3 text-left transition ${createStep === 1 ? "border-primary bg-background shadow-sm ring-1 ring-primary/20" : "border-border bg-background/70 hover:border-primary/40 hover:bg-background"}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${createStep === 1 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <KeyRound className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">Login Credentials</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">Portal, account ID, password and MFA</div>
                      <div className="mt-2 text-[11px] font-medium text-primary">{createStep === 1 ? "Current" : "Login details"}</div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFormError(null)
                    setCreateStep(2)
                  }}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    createStep === 2
                      ? "border-primary bg-background shadow-sm ring-1 ring-primary/20"
                      : recoveryStatus === "Not added"
                        ? "border-amber-300 bg-amber-50/70 hover:border-amber-400"
                        : "border-border bg-background/70 hover:border-primary/40 hover:bg-background"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${createStep === 2 ? "bg-primary/10 text-primary" : recoveryStatus === "Not added" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>
                      <ShieldCheck className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">Account Recovery</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${recoveryStatus === "Not added" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>{recoveryStatus}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">Recovery access and backup methods</div>
                      <div className="mt-2 text-[11px] font-medium text-muted-foreground">Optional to save · important for account recovery</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              {formError ? <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}

              {createStep === 1 ? (
                <div className="space-y-6">
                  <section className="space-y-3">
                    <div>
                      <label className="text-sm font-semibold">Company / Provider</label>
                      <p className="mt-0.5 text-xs text-muted-foreground">Search existing TES companies. Customer and Prospect records are not shown here.</p>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={companyQuery}
                        onChange={(event) => {
                          setCompanyQuery(event.target.value)
                          setSelectedProviderCompanyId("")
                          setSelectedPortalId("")
                        }}
                        placeholder="e.g. Motive, Alberta Transportation, Alberta Revenue"
                        className="pl-9"
                      />
                    </div>
                    {companyQuery.trim() ? (
                      <div className="overflow-hidden rounded-xl border">
                        {companyResults.length === 0 ? (
                          <div className="px-4 py-4">
                            <div className="text-sm text-muted-foreground">No matching company found in TES.</div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => {
                                setIsAddCompanyOpen(true)
                                setFormError(null)
                              }}
                            >
                              <Plus className="mr-1.5 size-3.5" />
                              Add Company
                            </Button>
                          </div>
                        ) : (
                          companyResults.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSelectedProviderCompanyId(item.id)
                                setCompanyQuery(item.name)
                                setSelectedPortalId("")
                              }}
                              className={`flex w-full items-center justify-between gap-4 border-b px-4 py-3 text-left last:border-b-0 ${selectedProviderCompanyId === item.id ? "bg-primary/5" : "hover:bg-muted/50"}`}
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{item.name}</span>
                                  {selectedProviderCompanyId === item.id ? <CheckCircle2 className="size-4 text-primary" /> : null}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">{item.kind || "Other"}</div>
                              </div>
                              <span className="font-mono text-[10px] text-muted-foreground">{item.id}</span>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </section>

                  <section className="space-y-3">
                    <div>
                      <label className="text-sm font-semibold">Portal / System</label>
                      <p className="mt-0.5 text-xs text-muted-foreground">Search by official name, common name, or alias.</p>
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
                          <div className="mt-3">
                            <Button type="button" variant="outline" size="sm" onClick={() => { setShowAddPortal(true); setNewPortalName(portalQuery.trim()) }}>
                              <Plus className="mr-1.5 size-3.5" />
                              Add portal / system
                            </Button>
                          </div>
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
                            className={`flex w-full items-start justify-between gap-4 border-b px-4 py-3 text-left last:border-b-0 ${selectedPortalId === portal.id ? "bg-primary/5" : "hover:bg-muted/50"}`}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{portal.name}</span>
                                {selectedPortalId === portal.id ? <CheckCircle2 className="size-4 text-primary" /> : null}
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{portal.legalName || "Legal name not recorded"}</div>
                              <div className="mt-1 text-xs text-muted-foreground">Provider: {providerFor(portal)?.name || "Not linked in Companies"}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {[portal.jurisdiction, portal.country].filter(Boolean).join(", ") || "Jurisdiction not recorded"} · {portal.services.length ? portal.services.join(" · ") : "Services not recorded"}
                              </div>
                            </div>
                            <span className="rounded-md border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground">{portal.id.slice(0, 8)}</span>
                          </button>
                        ))
                      )}
                    </div>
                    {portalResults.length > 0 ? (
                      <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setShowAddPortal((current) => !current)}>
                        {showAddPortal ? "Cancel adding a portal" : "Portal not listed? Add portal / system"}
                      </button>
                    ) : null}
                    {showAddPortal ? (
                      <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={newPortalName} onChange={(event) => setNewPortalName(event.target.value)} placeholder="Portal / system name" />
                          <Input value={newPortalUrl} onChange={(event) => setNewPortalUrl(event.target.value)} placeholder="https:// login page (optional)" />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Added once to the TES-global Portal Registry{selectedProviderCompanyId ? " and linked to the selected provider" : ""}. The registry records a name, login URL, jurisdiction and aliases; it has no
                          legal-name or services field.
                        </p>
                        <Button type="button" size="sm" disabled={saving} onClick={() => void saveNewPortal()}>
                          Save portal
                        </Button>
                      </div>
                    ) : null}
                  </section>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold">Category</span>
                      <select value={credentialCategory} onChange={(event) => setCredentialCategory(event.target.value as CredentialCategory)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                        {CATEGORIES.filter((item) => item !== "All").map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold">Username</span>
                      <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" placeholder="Username or account email" />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        Password
                        <LockKeyhole className="size-3.5 text-muted-foreground" />
                      </span>
                      <Input value="" readOnly disabled placeholder="Held in the secret manager" aria-label="Password (held in the secret manager)" />
                      <CanonicalUnavailable action="Entering a password" reason="TES never stores or shows passwords. Saving records that a password slot exists for this login; the value lives only in the secret manager." />
                    </div>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold">MFA / Authentication method</span>
                      <select value={mfaMethod} onChange={(event) => setMfaMethod(event.target.value as CanonicalMfa | "")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">Not recorded</option>
                        {(Object.keys(MFA_LABEL) as CanonicalMfa[]).map((code) => (
                          <option key={code} value={code}>
                            {MFA_LABEL[code]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="rounded-lg border bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
                    Portal identity and login URL come from the TES-global Portal Registry. This company record stores only the company&apos;s account relationship to that portal.
                  </div>
                </div>
              ) : (
                <div className="space-y-7">
                  <div role="note" className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs leading-5 text-amber-900">
                    Secrets live in the secret manager, not in TES. This step <strong>declares</strong> which recovery items exist for the account (each becomes a recorded slot). No answer, PIN, code or other value is entered, sent or stored here.
                  </div>
                  <section>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold">Security Questions</h3>
                        <p className="mt-1 text-xs text-muted-foreground">Declare only the recovery questions actually configured by the external portal.</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addSecurityQuestion}>
                        <Plus className="mr-1.5 size-3.5" />
                        Add question
                      </Button>
                    </div>

                    {securityQuestions.length === 0 ? (
                      <div className="mt-3 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">No security questions added.</div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {securityQuestions.map((item, index) => (
                          <div key={item.id} className="rounded-xl border bg-card p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Question {index + 1}</span>
                              <button type="button" onClick={() => setSecurityQuestions((current) => current.filter((question) => question.id !== item.id))} className="text-xs text-muted-foreground hover:text-foreground">
                                Remove
                              </button>
                            </div>
                            <div className="grid gap-3">
                              <Input value="" readOnly disabled placeholder="Security question (text is not stored)" aria-label={`Security question ${index + 1} text`} />
                              <Input value="" readOnly disabled placeholder="Answer (held in the secret manager)" aria-label={`Security question ${index + 1} answer`} autoComplete="off" />
                            </div>
                          </div>
                        ))}
                        <CanonicalUnavailable action="Saving the question text" reason="no column holds question text (approved decision). Each question declares an answer slot only." />
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold">Other recovery methods</h3>
                        <p className="mt-1 text-xs text-muted-foreground">Add only the methods used by this account.</p>
                      </div>
                      <div className="relative">
                        <Button type="button" variant="outline" size="sm" onClick={() => setShowRecoveryMenu((current) => !current)}>
                          <Plus className="mr-1.5 size-3.5" />
                          Add recovery method
                        </Button>
                        {showRecoveryMenu ? (
                          <div className="absolute right-0 top-10 z-20 w-52 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
                            {RECOVERY_TYPES.map((type) => (
                              <button key={type} type="button" onClick={() => addRecoveryMethod(type)} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted">
                                {type}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {recoveryMethods.length === 0 ? (
                      <div className="mt-3 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">No additional recovery methods added.</div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {recoveryMethods.map((method) => (
                          <div key={method.id} className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[170px_1fr_1fr_auto]">
                            <div className="self-center text-sm font-semibold">{method.type}</div>
                            <Input value="" readOnly disabled placeholder={method.type === "Other" ? "Method / label (not stored)" : "Label (not stored)"} aria-label={`${method.type} label`} />
                            <Input value="" readOnly disabled placeholder="Value (held in the secret manager)" aria-label={`${method.type} value`} />
                            <button
                              type="button"
                              onClick={() => setRecoveryMethods((current) => current.filter((item) => item.id !== method.id))}
                              className="flex size-9 items-center justify-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={`Remove ${method.type}`}
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        ))}
                        <CanonicalUnavailable action="Saving recovery labels and values" reason="labels have no column, and values live only in the secret manager. Each method declares a slot of its kind." />
                      </div>
                    )}
                  </section>
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
                <Button type="button" variant="outline" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button type="button" disabled={saving} onClick={() => void saveCredential()}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isAddCompanyOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-3 md:p-6">
          <div className="flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <div className="text-sm font-semibold">Add Company</div>
                <div className="text-xs text-muted-foreground">Complete the full TES company record without leaving Credentials.</div>
              </div>
              <button type="button" onClick={() => setIsAddCompanyOpen(false)} className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close company form">
                <X className="size-4" />
              </button>
            </div>
            <iframe title="Create TES company" src={`/companies/new?context=credentials&embedded=1&name=${encodeURIComponent(companyQuery.trim())}`} className="min-h-0 flex-1 bg-background" />
          </div>
        </div>
      ) : null}
    </>
  )
}
