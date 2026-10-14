"use client"

/**
 * Canonical adapter for the restored Credentials workspace.
 *
 * It hydrates an in-memory model from the PostgreSQL-backed API and maps canonical records onto the shapes the ORIGINAL
 * Credentials interface uses (portal definitions, credential rows, recovery status). Nothing is kept in browser storage, and
 * NO SECRET VALUE exists anywhere in this module: a password, an answer, a PIN or a backup code is never read, held or sent. The
 * only thing that can be recorded about a secret is that a slot of some kind exists (and, optionally, the Secret Manager
 * resource NAME it lives under). Fields the original showed that have no canonical home are reported as "Not recorded".
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"

// --- canonical response shapes (what the routes return; no secret field exists in them) --------------------------------

export type CanonicalCategory = "FLEET" | "COMPLIANCE" | "REGISTRATION" | "INSURANCE" | "ACCOUNTING" | "FUEL" | "OTHER"
export type CanonicalStatus = "ACTIVE" | "NEEDS_VERIFICATION" | "LOCKED" | "DISABLED"
export type CanonicalMfa = "NONE" | "AUTHENTICATOR_APP" | "SMS" | "EMAIL" | "HARDWARE_KEY" | "OTHER"
export type CanonicalSlotKind = "PASSWORD" | "MFA_SECRET" | "RECOVERY_EMAIL" | "RECOVERY_PHONE" | "RECOVERY_PIN" | "BACKUP_CODES" | "SECURITY_ANSWER" | "OTHER_RECOVERY"
export type CanonicalSecretState = "UNRESOLVED" | "STORED" | "RETIRED"

export type CanonicalSystem = {
  id: string
  displayName: string
  providerOrganizationId: string | null
  jurisdictionCountry: string | null
  jurisdictionRegion: string | null
  loginUrl: string | null
  recordStatus: "active" | "archived"
  aliases: { id: string; systemId: string; alias: string; recordStatus: "active" | "retired" }[]
}

export type StatusPeriod = { id: string; status: CanonicalStatus; reason: string; effectiveFrom: string; effectiveTo: string | null; recordStatus: "active" | "corrected" }
export type Verification = { id: string; outcome: "VERIFIED" | "FAILED" | "LOCKED_OUT"; method: string; verifiedAt: string; recordStatus: "active" | "voided" }
export type Slot = { id: string; slotKind: CanonicalSlotKind; secretState: CanonicalSecretState; storedAt: string | null; retiredAt: string | null }

export type CanonicalCredentialView = {
  credential: {
    id: string
    systemId: string
    category: CanonicalCategory
    username: string
    mfaMethod: CanonicalMfa | null
    recordStatus: "active" | "archived"
    createdAt: string
    replacesCredentialId: string | null
    replacementReason: string | null
  }
  system: { id: string; displayName: string }
  statusHistory: StatusPeriod[]
  currentStatus: StatusPeriod | null
  verifications: Verification[]
  lastVerification: Verification | null
  slots: Slot[]
  replacedByCredentialId: string | null
}

export type ProviderCompany = { id: string; name: string; kind: string }

// --- original UI shapes ---------------------------------------------------------------------------------------------

export type CredentialCategory = "Fleet" | "Compliance" | "Registration" | "Insurance" | "Accounting" | "Fuel" | "Other"
export type CredentialStatus = "Active" | "Needs verification" | "Locked" | "Disabled"
export type RecoveryStatus = "Not added" | "Partially added" | "Recovery added"

export type PortalDefinition = {
  id: string
  providerCompanyId: string
  name: string
  legalName: string
  jurisdiction: string
  country: string
  services: string[]
  aliases: string[]
  loginUrl: string
  archived: boolean
}

export type CredentialRow = {
  id: string
  portalId: string
  category: CredentialCategory
  username: string
  status: CredentialStatus
  recoveryStatus: RecoveryStatus
  lastVerifiedAt?: string
  createdAt: string
  archived: boolean
  view: CanonicalCredentialView
}

export const CATEGORY_LABEL: Record<CanonicalCategory, CredentialCategory> = {
  FLEET: "Fleet",
  COMPLIANCE: "Compliance",
  REGISTRATION: "Registration",
  INSURANCE: "Insurance",
  ACCOUNTING: "Accounting",
  FUEL: "Fuel",
  OTHER: "Other",
}
export const CATEGORY_CODE: Record<CredentialCategory, CanonicalCategory> = {
  Fleet: "FLEET",
  Compliance: "COMPLIANCE",
  Registration: "REGISTRATION",
  Insurance: "INSURANCE",
  Accounting: "ACCOUNTING",
  Fuel: "FUEL",
  Other: "OTHER",
}
export const STATUS_LABEL: Record<CanonicalStatus, CredentialStatus> = {
  ACTIVE: "Active",
  NEEDS_VERIFICATION: "Needs verification",
  LOCKED: "Locked",
  DISABLED: "Disabled",
}
export const MFA_LABEL: Record<CanonicalMfa, string> = {
  NONE: "None",
  AUTHENTICATOR_APP: "Authenticator app",
  SMS: "SMS",
  EMAIL: "Email",
  HARDWARE_KEY: "Hardware key",
  OTHER: "Other",
}
export const SLOT_LABEL: Record<CanonicalSlotKind, string> = {
  PASSWORD: "Password",
  MFA_SECRET: "MFA recovery",
  RECOVERY_EMAIL: "Recovery email",
  RECOVERY_PHONE: "Recovery phone",
  RECOVERY_PIN: "Recovery PIN",
  BACKUP_CODES: "Backup codes",
  SECURITY_ANSWER: "Security question answer",
  OTHER_RECOVERY: "Other recovery method",
}

/** Original "Add recovery method" menu entries and the slot kind each declares. */
export type RecoveryMethodType = "Recovery email" | "Recovery phone" | "Recovery PIN" | "Backup codes" | "MFA recovery" | "Other"
export const RECOVERY_METHOD_KIND: Record<RecoveryMethodType, CanonicalSlotKind> = {
  "Recovery email": "RECOVERY_EMAIL",
  "Recovery phone": "RECOVERY_PHONE",
  "Recovery PIN": "RECOVERY_PIN",
  "Backup codes": "BACKUP_CODES",
  "MFA recovery": "MFA_SECRET",
  Other: "OTHER_RECOVERY",
}

/**
 * Recovery status, derived from the credential's recovery slots (the PASSWORD slot is the login, not recovery):
 * no live recovery slot = Not added; every live recovery slot holds a Secret Manager reference = Recovery added; otherwise
 * (declared, but at least one has no stored secret yet) = Partially added.
 */
export function deriveRecoveryStatus(slots: { slotKind: CanonicalSlotKind; secretState: CanonicalSecretState }[]): RecoveryStatus {
  const live = slots.filter((slot) => slot.slotKind !== "PASSWORD" && slot.secretState !== "RETIRED")
  if (live.length === 0) return "Not added"
  return live.every((slot) => slot.secretState === "STORED") ? "Recovery added" : "Partially added"
}

export function toCredentialRow(view: CanonicalCredentialView): CredentialRow {
  const verified = view.verifications.filter((item) => item.recordStatus === "active" && item.outcome === "VERIFIED")
  const last = verified.map((item) => item.verifiedAt).sort().at(-1)
  return {
    id: view.credential.id,
    portalId: view.credential.systemId,
    category: CATEGORY_LABEL[view.credential.category],
    username: view.credential.username,
    status: view.currentStatus ? STATUS_LABEL[view.currentStatus.status] : "Needs verification",
    recoveryStatus: deriveRecoveryStatus(view.slots),
    lastVerifiedAt: last,
    createdAt: view.credential.createdAt,
    archived: view.credential.recordStatus === "archived",
    view,
  }
}

export function toPortal(system: CanonicalSystem, providers: ProviderCompany[]): PortalDefinition {
  const provider = system.providerOrganizationId ? providers.find((item) => item.id === system.providerOrganizationId) : undefined
  return {
    id: system.id,
    providerCompanyId: system.providerOrganizationId ?? "",
    name: system.displayName,
    // The registry has no separate legal name or service list: shown as "Not recorded", never invented.
    legalName: provider?.name ?? "",
    jurisdiction: system.jurisdictionRegion ?? "",
    country: system.jurisdictionCountry ?? "",
    services: [],
    aliases: system.aliases.filter((alias) => alias.recordStatus === "active").map((alias) => alias.alias),
    loginUrl: system.loginUrl ?? "",
    archived: system.recordStatus === "archived",
  }
}

// --- API -------------------------------------------------------------------------------------------------------------

async function call<T>(url: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...(init ? { method: init.method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "The request was refused.")
  return body as T
}

export type CreateCredentialInput = {
  systemId: string
  category: CanonicalCategory
  username: string
  mfaMethod: CanonicalMfa | null
  recoverySlots: CanonicalSlotKind[]
}

export function useCanonicalCredentials(companyId: string) {
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [credentials, setCredentials] = useState<CredentialRow[]>([])
  const [systems, setSystems] = useState<CanonicalSystem[]>([])
  const [providers, setProviders] = useState<ProviderCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    const [list, sys, companies] = await Promise.allSettled([
      call<{ credentials: CanonicalCredentialView[] }>(`${base}/credentials`),
      call<{ systems: CanonicalSystem[] }>("/api/credential-systems"),
      call<{ companies: { id: string; name: string; kind: string }[] }>("/api/companies"),
    ])
    if (!alive.current) return
    const problems: string[] = []
    if (list.status === "fulfilled") setCredentials(list.value.credentials.map(toCredentialRow))
    else problems.push(list.reason instanceof Error ? list.reason.message : "Unable to load credentials.")
    if (sys.status === "fulfilled") setSystems(sys.value.systems)
    else problems.push("The portal registry could not be loaded.")
    if (companies.status === "fulfilled") setProviders(companies.value.companies)
    else problems.push("The company list could not be loaded, so providers cannot be searched.")
    setLoadError(problems.length ? problems.join(" ") : null)
    setLoading(false)
  }, [base])

  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])

  /** Runs one canonical change, then re-reads the canonical state so the screen always shows what PostgreSQL holds. */
  const mutate = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      setNotice(null)
      const result = await work()
      await reload()
      return result
    },
    [reload],
  )

  const refreshProviders = useCallback(async (): Promise<ProviderCompany[]> => {
    const body = await call<{ companies: ProviderCompany[] }>("/api/companies")
    setProviders(body.companies)
    return body.companies
  }, [])

  const credentialUrl = (credentialId: string) => `${base}/credentials/${encodeURIComponent(credentialId)}`
  const patch = (credentialId: string, body: Record<string, unknown>) => call<{ credential: CanonicalCredentialView }>(credentialUrl(credentialId), { method: "PATCH", body })
  const systemUrl = (systemId: string) => `/api/credential-systems/${encodeURIComponent(systemId)}`

  const portals = systems.map((system) => toPortal(system, providers))

  return {
    credentials,
    portals,
    systems,
    providers,
    loading,
    loadError,
    notice,
    setNotice,
    reload,
    refreshProviders,

    createCredential: (input: CreateCredentialInput) =>
      mutate(() =>
        call<{ credential: CanonicalCredentialView }>(`${base}/credentials`, {
          method: "POST",
          // A new login has not been verified yet: the original saved credentials as "Needs verification".
          body: { ...input, status: "NEEDS_VERIFICATION" },
        }),
      ),
    createSystem: (input: { name: string; loginUrl?: string; providerOrganizationId?: string }) =>
      mutate(() => call<{ system: CanonicalSystem }>("/api/credential-systems", { method: "POST", body: input })),
    linkProvider: (systemId: string, providerOrganizationId: string) =>
      mutate(() => call(systemUrl(systemId), { method: "PATCH", body: { action: "update", providerOrganizationId } })),
    updateSystem: (systemId: string, fields: Record<string, unknown>) => mutate(() => call(systemUrl(systemId), { method: "PATCH", body: { action: "update", ...fields } })),
    addAlias: (systemId: string, alias: string) => mutate(() => call(systemUrl(systemId), { method: "PATCH", body: { action: "addAlias", alias } })),
    retireAlias: (systemId: string, aliasId: string) => mutate(() => call(systemUrl(systemId), { method: "PATCH", body: { action: "retireAlias", aliasId } })),
    setSystemArchived: (systemId: string, archive: boolean) => mutate(() => call(systemUrl(systemId), { method: "PATCH", body: { action: archive ? "archive" : "restore" } })),

    changeStatus: (credentialId: string, status: CanonicalStatus) => mutate(() => patch(credentialId, { action: "status", status })),
    correctStatus: (credentialId: string, periodId: string, status: CanonicalStatus) => mutate(() => patch(credentialId, { action: "correctStatus", periodId, status })),
    recordVerification: (credentialId: string, outcome: Verification["outcome"], method: string) => mutate(() => patch(credentialId, { action: "verify", outcome, method })),
    voidVerification: (credentialId: string, verificationId: string) => mutate(() => patch(credentialId, { action: "voidVerification", verificationId })),
    updateMetadata: (credentialId: string, fields: { category?: CanonicalCategory; mfaMethod?: CanonicalMfa }) => mutate(() => patch(credentialId, { action: "metadata", ...fields })),
    replaceLogin: (credentialId: string, username: string, reason: "USERNAME_CHANGED" | "CORRECTION") => mutate(() => patch(credentialId, { action: "replace", username, reason })),
    declareSlot: (credentialId: string, slotKind: CanonicalSlotKind) => mutate(() => patch(credentialId, { action: "declareSlot", slotKind })),
    retireSlot: (credentialId: string, slotId: string) => mutate(() => patch(credentialId, { action: "retireSlot", slotId })),
    linkSecret: (credentialId: string, slotId: string, secretReference: string) => mutate(() => patch(credentialId, { action: "linkSecret", slotId, secretReference })),
    setArchived: (credentialId: string, archive: boolean) => mutate(() => patch(credentialId, { action: archive ? "archive" : "restore" })),

    /** Original controls that keep their place but have no canonical home. They refuse; they never store anything. */
    unavailable: {
      password: () =>
        new CanonicalOperationUnavailableError("Saving a password", "TES never stores or shows passwords. The credential's password slot records that one exists; the value lives only in the secret manager."),
      securityQuestionText: () =>
        new CanonicalOperationUnavailableError("Saving the security question text", "no column holds question text (approved decision), so only the answer slot is declared."),
      recoveryValue: (type: string) =>
        new CanonicalOperationUnavailableError(`Saving a ${type.toLowerCase()} value`, "recovery values live only in the secret manager; TES records that the slot exists."),
      recoveryLabel: () => new CanonicalOperationUnavailableError("Saving a recovery method label", "no column holds a label for a recovery slot."),
      portalServices: () => new CanonicalOperationUnavailableError("Portal services and legal name", "the portal registry records a name, jurisdiction, login URL and aliases only."),
    },
  }
}

export type CanonicalCredentials = ReturnType<typeof useCanonicalCredentials>
