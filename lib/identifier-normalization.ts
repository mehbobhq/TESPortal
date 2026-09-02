/**
 * TES Canonical Identifier Normalization Utilities
 * Pure string normalization functions for regulatory, vehicle, person,
 * and business identities.
 */

/**
 * Standardize 17-character VIN.
 * Removes whitespace/hyphens, capitalizes, and strips invalid VIN
 * characters including I, O, and Q.
 */
export function normalizeVIN(vin: string): string {
  if (!vin) return "";
  return vin
    .trim()
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "");
}

/**
 * Validate normalized VIN length.
 */
export function is17CharVIN(vin: string): boolean {
  const norm = normalizeVIN(vin);
  return norm.length === 17;
}

/**
 * Standardize license plate numbers.
 */
export function normalizePlate(plate: string): string {
  if (!plate) return "";
  return plate
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Standardize USDOT carrier numbers.
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
 * Standardize North American telephone numbers.
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
 * Standardize email addresses.
 */
export function normalizeEmail(email: string): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

/**
 * Standardize entity names.
 */
export function normalizeName(name: string): string {
  if (!name) return "";
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Standardize generic tax or registration account identifiers.
 */
export function normalizeTaxId(taxId: string): string {
  if (!taxId) return "";
  return taxId.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Normalize a Canadian CRA Business Number.
 *
 * A CRA Business Number root consists of 9 numeric digits.
 * Formatting characters and non-numeric characters are removed.
 */
export function normalizeCRABusinessNumber(value: string): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

/**
 * Validate the structural format of a CRA Business Number.
 *
 * Layer 1 validation verifies the 9-digit structure only.
 * It does not claim authoritative CRA registration verification.
 */
export function validateCRABusinessNumberFormat(value: string): boolean {
  const normalized = normalizeCRABusinessNumber(value);
  return /^\d{9}$/.test(normalized);
}

/**
 * Parsed representation of a CRA program account.
 *
 * Example:
 * 123456789RT0001
 */
export interface CRAProgramAccount {
  rootBN: string;
  programIdentifier: string;
  programSequence: string;
  fullAccount: string;
  isValid: boolean;
}

/**
 * Parse and structurally validate a CRA program account.
 *
 * Expected structure:
 * 9-digit Business Number
 * + 2-letter program identifier
 * + 4-digit reference number
 *
 * Example:
 * 123456789RT0001
 */
export function parseCRAProgramAccount(value: string): CRAProgramAccount {
  const normalized = (value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const match = normalized.match(/^(\d{9})([A-Z]{2})(\d{4})$/);

  if (!match) {
    return {
      rootBN: "",
      programIdentifier: "",
      programSequence: "",
      fullAccount: normalized,
      isValid: false,
    };
  }

  const [, rootBN, programIdentifier, programSequence] = match;

  return {
    rootBN,
    programIdentifier,
    programSequence,
    fullAccount: `${rootBN}${programIdentifier}${programSequence}`,
    isValid: true,
  };
}

/**
 * Normalize a United States Employer Identification Number (EIN).
 *
 * Canonical stored representation is 9 digits.
 */
export function normalizeEIN(value: string): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

/**
 * Validate the structural format of an EIN.
 *
 * Accepts:
 * 12-3456789
 * 123456789
 *
 * Layer 1 validation verifies structure only and does not represent
 * authoritative IRS verification.
 */
export function validateEINFormat(value: string): boolean {
  if (!value) return false;

  const trimmed = value.trim();

  return /^\d{2}-?\d{7}$/.test(trimmed);
}
