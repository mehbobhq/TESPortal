// Restored Contacts UI types. The shapes the original components expect (src/components/contacts/types.ts) are kept so the
// original layout and controls work unchanged; every value is mapped from the canonical contacts domain by ./adapter.ts and
// carries the canonical references the adapter needs under `canonical`. Fields with no canonical home are empty and are shown
// as "Not recorded" (never defaulted).

export type Evidence = {
  id: string;
  type: "Driver Licence" | "Government ID" | "Other";
  fileName: string;
  fileType: string;
  uploadedAt: string;
  documentDate?: string;
  confidence?: number;
  status: "uploaded" | "review_required" | "verified" | "rejected";
  source: "camera" | "device";
  dataUrl?: string;
};

export type Relationship = {
  id: string;
  companyId: string;
  companyName: string;
  role: string;
  isPrimary?: boolean;
  status: "active" | "ended";
  startDate: string;
  endDate?: string;
  source: "manual" | "document" | "system";
};

export type ContactEvent = {
  id: string;
  timestamp: string;
  action:
    | "CREATED"
    | "PRIMARY_CHANGED"
    | "ROLE_UPDATED"
    | "STATUS_CHANGED"
    | "DOCUMENT_ATTACHED"
    | "CONTACT_UPDATED"
    | "RELATIONSHIP_ADDED"
    | "ARCHIVED"
    | "RESTORED";
  summary: string;
  actor: string;
};

/** Canonical references behind one displayed contact (one person at this company). */
export type ContactCanonicalRefs = {
  relationshipId: string;
  personId: string;
  /** The relationship with this company has ended. */
  relationshipEnded: boolean;
  /** The person record itself is archived (a record lifecycle, independent of the relationship). */
  personArchived: boolean;
  phone: { channelId: string; value: string } | null;
  email: { channelId: string; value: string } | null;
  /** The title shown as the contact's role (the most recent current title), and every current title. */
  title: { id: string; text: string } | null;
  titles: { id: string; text: string }[];
  /** Current purposes at this company (PRIMARY / BILLING / SAFETY / OPERATIONS / COMPLIANCE / EMERGENCY). */
  purposes: { id: string; purpose: string; isPrimary: boolean }[];
  primaryAssignmentId: string | null;
  givenName: string;
  familyName: string;
};

export type Contact = {
  /** Display code derived from the canonical relationship id. */
  id: string;
  /** Display code derived from the canonical person id. */
  globalId: string;
  firstName: string;
  lastName: string;
  dob: string;
  dlNumber: string;
  dlState: string;
  dlExpiry: string;
  dlIssueDate: string;
  dlClass: string;
  dlRestrictions: string;
  email: string;
  phone: string;
  role: string;
  isPrimary: boolean;
  isArchived: boolean;
  notes: string;
  identityStatus: "unverified" | "documented" | "review_required";
  identityConfidence?: number;
  relationships: Relationship[];
  evidence: Evidence[];
  events: ContactEvent[];
  createdAt: string;
  updatedAt: string;
  canonical: ContactCanonicalRefs;
};

/** An OCR field: `confidence` is null when no extraction ran (the value was typed, not read from the document). */
export type OCRFieldConfidence = {
  value: string;
  confidence: number | null;
};

export type OCRReviewDraft = {
  firstName: OCRFieldConfidence;
  lastName: OCRFieldConfidence;
  dob: OCRFieldConfidence;
  dlNumber: OCRFieldConfidence;
  dlState: OCRFieldConfidence;
  dlExpiry: OCRFieldConfidence;
  dlIssueDate: OCRFieldConfidence;
  dlClass: OCRFieldConfidence;
  dlRestrictions: OCRFieldConfidence;
  email: OCRFieldConfidence;
  phone: OCRFieldConfidence;
  role: string;
  isPrimary: boolean;
  evidence: Evidence;
};

export type CompanyRecord = {
  id: string;
  name: string;
  kind?: string;
  status?: string;
  [key: string]: unknown;
};
