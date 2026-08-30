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

/**
 * Standardize 9-digit CRA Business Number (strips whitespace and non-digits).
 */
export function normalizeCRABusinessNumber(bn: string): string {
  if (!bn) return "";
  const digits = bn.replace(/\D/g, "");
  return digits.slice(0, 9);
}

/**
 * Validates whether a string matches the 9-digit CRA Business Number syntax format.
 * (Note: Validates string format syntax only; does not perform authoritative government verification).
 */
export function validateCRABusinessNumberFormat(bn: string): boolean {
  if (!bn) return false;
  const digits = bn.replace(/\D/g, "");
  return digits.length === 9;
}

/**
 * Standardize 15-character CRA Program Account (e.g. 123456789RC0001, 123456789RT0001).
 * Strips whitespace, hyphens, and converts to uppercase.
 */
export function normalizeCRAProgramAccount(account: string): string {
  if (!account) return "";
  return account.trim().toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Parses a CRA Program Account into root BN, program identifier, and sequence number.
 */
export function parseCRAProgramAccount(account: string): {
  rootBN: string;
  programIdentifier: string;
  programSequence: string;
  fullAccount: string;
  isValid: boolean;
} {
  const normalized = normalizeCRAProgramAccount(account);
  const match = normalized.match(/^(\d{9})([A-Z]{2})(\d{4})$/);
  if (match) {
    return {
      rootBN: match[1],
      programIdentifier: match[2],
      programSequence: match[3],
      fullAccount: normalized,
      isValid: true,
    };
  }
  // Check if at least 9-digit root is present
  const digitsOnly = account.replace(/\D/g, "");
  return {
    rootBN: digitsOnly.slice(0, 9),
    programIdentifier: "",
    programSequence: "",
    fullAccount: normalized,
    isValid: false,
  };
}

/**
 * Standardize 9-digit IRS Employer Identification Number (EIN).
 * Formats as XX-XXXXXXX if 9 digits are provided.
 */
export function normalizeEIN(ein: string): string {
  if (!ein) return "";
  const digits = ein.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }
  return ein.trim();
}

/**
 * Validates whether a string matches standard 9-digit IRS EIN syntax (XX-XXXXXXX or 9 digits).
 * (Note: Validates format syntax only; does not perform authoritative government verification).
 */
export function validateEINFormat(ein: string): boolean {
  if (!ein) return false;
  const digits = ein.replace(/\D/g, "");
  return digits.length === 9;
}
