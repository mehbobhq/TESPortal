/** Shared organization duplicate checks used by Company and Provider creation. */

export interface CompanyValidationInput {
  name: string
  address?: string
  phone?: string
  email?: string
  taxRegistrationNumber?: string
}

export interface CompanyLike {
  id?: string
  name: string
  address?: string
  phone?: string
  email?: string
  taxRegistrationNumber?: string
}

const LEGAL_SUFFIXES = [
  /\bincorporated\b/g,
  /\binc\b/g,
  /\blimited\b/g,
  /\bltd\b/g,
  /\bcorporation\b/g,
  /\bcorp\b/g,
  /\bcompany\b/g,
  /\bco\b/g,
  /\bllc\b/g,
  /\bl\.l\.c\b/g,
  /\blimited liability company\b/g,
  /\bsoci[eé]t[eé] par actions\b/g,
  /\bs\.?e\.?n\.?c\.?r\.?l\.?\b/g,
]

export function normalizeSuffix(value: string): string {
  let normalized = value.normalize("NFKD").toLowerCase().replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^a-z0-9\s.]/g, " ")
  for (const suffix of LEGAL_SUFFIXES) normalized = normalized.replace(suffix, " ")
  return normalized.replace(/\./g, " ").replace(/\s+/g, " ").trim()
}

export function levenshtein(left: string, right: string): number {
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution)
    }
    previous = current
  }
  return previous[right.length]
}

function normalizedContact(value?: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export function validateCompany(input: CompanyValidationInput, companies: CompanyLike[]): { isValid: boolean; warning: boolean; message: string; possibleMatchId?: string } {
  const normalizedName = normalizeSuffix(input.name)
  if (!normalizedName) return { isValid: false, warning: false, message: "Company name is required." }
  const exactTax = normalizedContact(input.taxRegistrationNumber)
  for (const company of companies) {
    if (exactTax && normalizedContact(company.taxRegistrationNumber) === exactTax) {
      return { isValid: true, warning: true, message: `${company.name} uses the same tax/registration number. Attach the new role to the existing organization instead of creating another company.`, possibleMatchId: company.id }
    }
    const existingName = normalizeSuffix(company.name)
    if (!existingName) continue
    const distance = levenshtein(normalizedName, existingName)
    const similarity = 1 - distance / Math.max(normalizedName.length, existingName.length, 1)
    const samePhone = Boolean(input.phone && company.phone && normalizedContact(input.phone) === normalizedContact(company.phone))
    const sameEmail = Boolean(input.email && company.email && normalizedContact(input.email) === normalizedContact(company.email))
    const sameAddress = Boolean(input.address && company.address && normalizeSuffix(input.address) === normalizeSuffix(company.address))
    if (normalizedName === existingName || similarity >= 0.92 || (similarity >= 0.82 && (samePhone || sameEmail || sameAddress))) {
      return { isValid: true, warning: true, message: `${company.name} may already be the same organization. Review and attach the provider role to the existing company if it matches.`, possibleMatchId: company.id }
    }
  }
  return { isValid: true, warning: false, message: "" }
}

