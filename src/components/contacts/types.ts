// --- Types & Interfaces ---
// Canonical Contacts domain types. Moved out of app/companies/[id]/contacts/page.tsx
// so that reusable Contacts components do not depend on a route page for their types.

export type Evidence = {
  id: string; // "DOC-..."
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
  id: string; // "REL-..."
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
  id: string; // "EVT-..."
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

export type Contact = {
  id: string; // "CNT-..."
  globalId: string; // "USR-..."
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
};

export type OCRFieldConfidence = {
  value: string;
  confidence: number;
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
  [key: string]: unknown;
};
