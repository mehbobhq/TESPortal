import type { Contact } from "./types";

// --- Normalizers used for the local (this company's loaded contacts) duplicate hint ---
export function normalizeLicence(value?: string | null): string {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeEmail(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizePhone(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeName(value?: string | null): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// --- Jurisdiction Constants (the licence fields are kept; they have no canonical home yet, see adapter.ts) ---
export const CANADIAN_PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];
export const ALL_JURISDICTIONS = [...CANADIAN_PROVINCES, ...US_STATES];

/**
 * The original standard roles. In the canonical contacts domain a role is a company-relationship TITLE (free text with
 * history): choosing a role records that text as the contact's title. Roles are NOT mapped to contact purposes (a purpose is
 * a separate, narrower concept with its own primary rules), and "Primary Contact" is NOT a role flag: being the primary
 * contact is the PRIMARY purpose, set with the Primary star / checkbox.
 */
export const STANDARD_ROLES = [
  "Primary Contact",
  "Director",
  "Safety Manager",
  "Fleet Manager",
  "Compliance Officer",
  "Dispatcher",
  "Billing / Accounting",
  "Driver",
  "Owner / Operator",
  "General Contact",
];

// --- 3-Year Visibility Cutoff Helper ---
export function isWithinThreeYears(dateString?: string): boolean {
  if (!dateString) return true;
  const docDate = new Date(dateString);
  if (isNaN(docDate.getTime())) return true;
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  return docDate >= threeYearsAgo;
}

/** A short display code from a canonical uuid, for example CNT-3F9A12BC. The full id stays in `canonical`. */
export function displayCode(prefix: string, uuid: string): string {
  return `${prefix}-${uuid.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

// --- Local duplicate hint on e-mail / phone only (the original also matched licence and name + date of birth, which are not recorded here). Advisory; the canonical, registry-wide advisory lookup is ContactsAdapter.findMatches) ---
export function findDuplicateContact(
  draft: { firstName?: string; lastName?: string; dob?: string; dlNumber?: string; email?: string; phone?: string },
  contacts: Contact[],
  excludeId?: string,
): { match: Contact | null; reason: string | null } {
  const email = normalizeEmail(draft.email);
  const phone = normalizePhone(draft.phone);

  for (const c of contacts) {
    if (excludeId && c.id === excludeId) continue;
    if (email && normalizeEmail(c.email) === email) {
      return { match: c, reason: `Matching Email Address (${draft.email})` };
    }
    if (phone && phone.length >= 7 && normalizePhone(c.phone) === phone) {
      return { match: c, reason: `Matching Phone Number (${draft.phone})` };
    }
  }
  return { match: null, reason: null };
}
