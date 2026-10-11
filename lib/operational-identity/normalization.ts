/**
 * Canonical operational identity normalization.
 * These functions are deliberately pure so browser adapters, OCR/intake and server services use identical rules.
 */
export function normalizeVin(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

export function isStructurallyValidVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(normalizeVin(value))
}

export function normalizePlate(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

export function normalizeUnitNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ")
}

export function normalizeDriverLicenceNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

export function normalizeSourceKey(value: string): string {
  return value.trim()
}
