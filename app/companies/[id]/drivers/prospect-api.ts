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
