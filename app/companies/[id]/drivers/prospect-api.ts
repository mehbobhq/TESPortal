import type { ProspectView } from "@/lib/driver-prospects/types"

const base = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/driver-prospects`

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? "The request could not be completed.")
  return body as T
}
const post = (url: string, body?: unknown) => call<any>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })

export const listOnboardingDrivers = async (companyId: string) => (await call<{ prospects: ProspectView[] }>(base(companyId))).prospects
export const createOnboardingDriver = (companyId: string, input: { fullName: string; email?: string; phone?: string; scope?: ScopeInput }) => post(base(companyId), input)
export const sendApplication = (companyId: string, prospectId: string) => post(`${base(companyId)}/${encodeURIComponent(prospectId)}/invitation`)
export const reviewOnboardingDriver = (companyId: string, prospectId: string, to: string) => post(`${base(companyId)}/${encodeURIComponent(prospectId)}/review`, { to })
export const convertOnboardingDriver = (companyId: string, prospectId: string, body: unknown) => post(`${base(companyId)}/${encodeURIComponent(prospectId)}/convert`, body)
export const addOnboardingEmail = (companyId: string, prospectId: string, email: string) => post(`${base(companyId)}/${encodeURIComponent(prospectId)}/email`, { email })
export const getSubmission = (companyId: string, prospectId: string) => call<{ receiptId: string; submittedAt: string; payload: any }>(`${base(companyId)}/${encodeURIComponent(prospectId)}/submission`)

export const prospectRoute = (companyId: string, prospectId: string) => `/companies/${companyId}/drivers/prospect-${prospectId}`

import type { PresentationContext } from "@/lib/jurisdiction-context"
import type { ScopeInput } from "@/lib/driver-prospects/operating-scope"

const ctxBase = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/driver-onboarding-context`
export const getOnboardingContext = async (companyId: string) => (await call<{ presentation: PresentationContext }>(ctxBase(companyId))).presentation
export const setPresentationCountry = async (companyId: string, country: "US" | "CA") => (await post(ctxBase(companyId), { country })).presentation as PresentationContext
export const setOperatingScope = (companyId: string, prospectId: string, scope: ScopeInput) => post(`${base(companyId)}/${encodeURIComponent(prospectId)}/scope`, { scope })

export interface ReviewRequirement {
  key: string; title: string; type: string; requiredForQualification: boolean; external: boolean; consentKey: string | null
  consent: { signed: boolean; legalStatus: string | null; relianceAllowed: boolean; reason: string | null } | null
  current: { status: string; note: string | null; recordedAt: string } | null
  history: Array<{ status: string; note: string | null; recordedAt: string }>
}
export interface ReviewApplication {
  id: string; status: string; stage: string; receiptId: string | null; submittedAt: string | null; snapshotSha256: string | null; planSha256: string; supplementsApplicationId: string | null
  pdf: { documentId: string; sha256: string | null } | null
  snapshot: { fields: Array<{ id: string; section: string; label: string; value: unknown; type: string }>; retainedNotApplicable: string[]; sensitive: Array<{ fieldId: string; collected: boolean }>; sensitiveNotCollected: Array<{ fieldId: string; reason: string }> } | null
  snapshotIntact?: boolean
  requirements: ReviewRequirement[]
  consents: Array<{ id: string; key: string; version: string; legalStatus: string; acceptedAt: string; signatureName: string; jurisdiction: string | null; purpose: string; revoked: boolean }>
  uploads: Array<{ fieldId: string; documentId: string; documentClass: string; sensitivity: string; current: boolean; state: string | null; filename: string | null }>
  decisions: Array<{ id: string; decision: string; reasons: unknown; decidedAt: string }>
  corrections: Array<{ id: string; fieldId: string; previousValue: unknown; correctedValue: unknown; reason: string; recordedAt: string }>
  sensitive: Array<{ fieldId: string; collected: true; masked?: string }>
  reviewRequirements: Array<{ id: string; text: string }>
  canQualify: boolean
  blockers: string[]
}
const appBase = (companyId: string, prospectId: string) => `${base(companyId)}/${encodeURIComponent(prospectId)}/application`
export const getApplicationReview = (companyId: string, prospectId: string) => call<{ applications: ReviewApplication[]; canSeeSensitive: boolean }>(appBase(companyId, prospectId))
export const dossierUrl = (companyId: string, prospectId: string, applicationId: string) => `${appBase(companyId, prospectId)}/dossier?applicationId=${encodeURIComponent(applicationId)}`
export const recordVerification = (companyId: string, prospectId: string, body: unknown) => post(`${appBase(companyId, prospectId)}/verification`, body)
export const recordDecision = (companyId: string, prospectId: string, body: unknown) => post(`${appBase(companyId, prospectId)}/decision`, body)
export const recordCorrection = (companyId: string, prospectId: string, body: unknown) => post(`${appBase(companyId, prospectId)}/correction`, body)
export const revealSensitiveValue = (companyId: string, prospectId: string, body: unknown) => post(`${appBase(companyId, prospectId)}/sensitive`, body) as Promise<{ value: string }>
export const requestSupplement = (companyId: string, prospectId: string, supplementsApplicationId: string) => post(`${base(companyId)}/${encodeURIComponent(prospectId)}/invitation`, { stage: "CONDITIONAL_OFFER", supplementsApplicationId })
export const documentUrl = (companyId: string, prospectId: string, applicationId: string, documentId: string) => `${appBase(companyId, prospectId)}/documents/${encodeURIComponent(documentId)}?applicationId=${encodeURIComponent(applicationId)}`
