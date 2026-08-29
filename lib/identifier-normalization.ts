/**
 * TES Canonical Identifier Normalization Utilities
 * Pure string normalization functions for regulatory, vehicle, and person identities.
 */

/**
 * Standardize 17-character VIN (removes whitespace/hyphens, capitalizes, strips invalid characters I, O, Q).
 */
export function normalizeVIN(vin: string): string {
  if (!vin) return "";
  return vin
    .trim()
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, ""); // VIN standard excludes letters I, O, Q
}

/**
 * Validates whether a normalized string matches standard 17-character VIN syntax.
 */
export function is17CharVIN(vin: string): boolean {
  const norm = normalizeVIN(vin);
  return norm.length === 17;
}

/**
 * Standardize license plate numbers (uppercase, strips all spaces, hyphens, and non-alphanumerics).
 */
export function normalizePlate(plate: string): string {
  if (!plate) return "";
  return plate
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Standardize USDOT carrier numbers (digits only).
 */
export function normalizeUSDOT(usdot: string): string {
  if (!usdot) return "";
  return usdot.replace(/\D/g, "");
}

/**
 * Standardize Motor Carrier (MC / FF / MX) numbers.
 */
export function normalizeMC(mc: string): string {
  if (!mc) return "";
  return mc.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Standardize North American telephone numbers to (XXX) XXX-XXXX or E.164 digits.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone.trim();
}

/**
 * Standardize email addresses (lowercase, trimmed).
 */
export function normalizeEmail(email: string): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

/**
 * Standardize entity names (collapses extra spaces, trims).
 */
export function normalizeName(name: string): string {
  if (!name) return "";
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Standardize tax or registration accounts (e.g., IFTA, KYU, NY HUT).
 */
export function normalizeTaxId(taxId: string): string {
  if (!taxId) return "";
  return taxId.trim().toUpperCase().replace(/\s+/g, "");
}
