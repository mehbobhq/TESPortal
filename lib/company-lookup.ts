/**
 * Client-safe helpers for workspace pages that open a company through /api/companies/[id]/profile.
 * A missing company (404) and a failed lookup (network, 5xx, not authorized) are different outcomes: only the first may be
 * reported as "Company not found".
 */
export type CompanyLookup<T> = { company: T | null; failed: boolean }

export async function readCompanyLookup<T>(response: Response): Promise<CompanyLookup<T>> {
  if (response.ok) {
    const body = await response.json().catch(() => null)
    return body?.company ? { company: body.company as T, failed: false } : { company: null, failed: true }
  }
  return { company: null, failed: response.status !== 404 }
}
