import type { Contact, ContactEvent, Evidence, OCRReviewDraft } from "./types";

// --- Strict Contact Normalizers (Preserved for Duplicate Identity Resolution) ---
export function normalizeLicence(value?: string | null): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeEmail(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizePhone(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeName(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// --- ID Generators ---
export function generateContactId(): string {
  return `CNT-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateGlobalUserId(): string {
  return `USR-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateRelationshipId(): string {
  return `REL-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateEvidenceId(): string {
  return `DOC-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateEventId(): string {
  return `EVT-${Math.floor(10000 + Math.random() * 90000)}`;
}

// --- Jurisdiction Constants ---
export const CANADIAN_PROVINCES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"
];
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];
export const ALL_JURISDICTIONS = [...CANADIAN_PROVINCES, ...US_STATES];

// NOTE (Section D decision point): "Broker Agent" is a role that Insurance can
// write onto a canonical Contact via its broker-contact resolution flow, but it
// is intentionally NOT added here as a first-class Contacts-owned role. Whether
// "Broker Agent" should become a canonical, Contacts-recognized company role or
// remain an external/custom role written by another module is a product
// decision, not something to resolve silently in this pass. See the task's
// final report ("Remaining Issues -> FUTURE ARCHITECTURAL DECISION").
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

// --- Duplicate Resolution Business Rule ---
export function findDuplicateContact(
  draft: {
    firstName?: string;
    lastName?: string;
    dob?: string;
    dlNumber?: string;
    email?: string;
    phone?: string;
  },
  contacts: Contact[],
  excludeId?: string
): { match: Contact | null; reason: string | null } {
  const dl = normalizeLicence(draft.dlNumber);
  const email = normalizeEmail(draft.email);
  const phone = normalizePhone(draft.phone);
  const fullName = normalizeName(`${draft.firstName || ""}${draft.lastName || ""}`);
  const dob = draft.dob?.trim();

  for (const c of contacts) {
    if (excludeId && c.id === excludeId) continue;

    // 1. Exact Driver Licence match (Strongest Identity Signal)
    if (dl && normalizeLicence(c.dlNumber) === dl) {
      return { match: c, reason: `Matching Driver Licence Number (${draft.dlNumber})` };
    }

    // 2. Exact Email match
    if (email && normalizeEmail(c.email) === email) {
      return { match: c, reason: `Matching Email Address (${draft.email})` };
    }

    // 3. Exact Phone match (>= 7 digits)
    if (phone && phone.length >= 7 && normalizePhone(c.phone) === phone) {
      return { match: c, reason: `Matching Phone Number (${draft.phone})` };
    }

    // 4. Exact Full Name + Date of Birth compound match
    if (fullName && dob && c.dob && normalizeName(`${c.firstName}${c.lastName}`) === fullName && c.dob === dob) {
      return { match: c, reason: `Matching Full Name & Date of Birth (${c.firstName} ${c.lastName}, DOB: ${dob})` };
    }
  }

  return { match: null, reason: null };
}

// --- Primary Contact Enforcement Business Rule ---
export function applyPrimaryRule(
  updatedContact: Contact,
  companyId: string,
  allContacts: Contact[],
  companyName: string
): Contact[] {
  const currentRel = updatedContact.relationships.find((r) => r.companyId === companyId);
  const isNowPrimary = !!currentRel?.isPrimary;

  if (!isNowPrimary) {
    return allContacts.map((c) => (c.id === updatedContact.id ? updatedContact : c));
  }

  // If this contact is now primary, demote any other contact for this company
  return allContacts.map((c) => {
    if (c.id === updatedContact.id) {
      return updatedContact;
    }

    const relIndex = c.relationships.findIndex((r) => r.companyId === companyId);
    if (relIndex !== -1 && c.relationships[relIndex].isPrimary) {
      const updatedRelationships = [...c.relationships];
      updatedRelationships[relIndex] = {
        ...updatedRelationships[relIndex],
        isPrimary: false,
      };

      const demotionEvent: ContactEvent = {
        id: generateEventId(),
        timestamp: new Date().toISOString(),
        action: "PRIMARY_CHANGED",
        summary: `Primary contact designation transferred to ${updatedContact.firstName} ${updatedContact.lastName} at ${companyName}.`,
        actor: "System Administrator",
      };

      return {
        ...c,
        isPrimary: false,
        relationships: updatedRelationships,
        events: [demotionEvent, ...(c.events || [])],
        updatedAt: new Date().toISOString(),
      };
    }

    return c;
  });
}

// --- OCR Demo Extraction Simulator (85% Threshold Invariant) ---
export const OCR_REQUIRED_THRESHOLD = 85;

export function simulateOCRExtraction(
  file: File,
  dataUrl: string,
  source: "camera" | "device" = "device"
): OCRReviewDraft {
  const isHighQuality = file.size > 20000;
  return {
    firstName: { value: "Amandeep", confidence: isHighQuality ? 94 : 82 },
    lastName: { value: "Dhillon", confidence: isHighQuality ? 96 : 88 },
    dob: { value: "1988-04-12", confidence: isHighQuality ? 92 : 79 },
    dlNumber: { value: "D4928-19482-94819", confidence: isHighQuality ? 91 : 86 },
    dlState: { value: "ON", confidence: 98 },
    dlExpiry: { value: "2028-04-12", confidence: isHighQuality ? 90 : 81 },
    dlIssueDate: { value: "2023-04-10", confidence: 89 },
    dlClass: { value: "Class A / AZ", confidence: 95 },
    dlRestrictions: { value: "Condition 1 / Corrective Lenses", confidence: 87 },
    email: { value: "", confidence: 100 },
    phone: { value: "", confidence: 100 },
    role: "Safety Manager",
    isPrimary: false,
    evidence: {
      id: generateEvidenceId(),
      type: "Driver Licence",
      fileName: file.name || (source === "camera" ? "camera-id-capture.jpg" : "id-scan.jpg"),
      fileType: file.type || "image/jpeg",
      uploadedAt: new Date().toISOString(),
      documentDate: "2023-04-10",
      confidence: isHighQuality ? 93 : 84,
      status: isHighQuality ? "verified" : "review_required",
      source,
      dataUrl,
    },
  };
}

// --- Section D: defensive normalization at the Contacts boundary ---
// A canonical Contact can be created/updated by another TES module (e.g.
// Insurance's Broker Agent contact resolution) that does not populate every
// field this module's UI unconditionally reads (evidence[], events[]).
// Normalize once, at load time, so downstream rendering code never needs to
// special-case a missing array. This does NOT fabricate historical data -
// missing arrays become empty arrays, nothing more.
export function normalizeLoadedContact(contact: Contact): Contact {
  return {
    ...contact,
    relationships: Array.isArray(contact.relationships) ? contact.relationships : [],
    evidence: Array.isArray(contact.evidence) ? contact.evidence : [],
    events: Array.isArray(contact.events) ? contact.events : [],
  };
}

export function normalizeLoadedContacts(contacts: Contact[]): Contact[] {
  return (contacts || []).map(normalizeLoadedContact);
}
