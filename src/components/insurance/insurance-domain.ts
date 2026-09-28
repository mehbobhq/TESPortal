// Standard string similarity helper for fuzzy entity candidate discovery
export function levenshteinDistance(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: bn + 1 }, () => new Array(an + 1).fill(0));
  for (let i = 0; i <= an; i++) matrix[0][i] = i;
  for (let j = 0; j <= bn; j++) matrix[j][0] = j;
  for (let j = 1; j <= bn; j++) {
    for (let i = 1; i <= an; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1,
        matrix[j][i - 1] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[bn][an];
}

export function similarityRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return (maxLen - dist) / maxLen;
}

// =========================================================================
// 1. DOMAIN DATA CONTRACTS & INTERFACES (FROZEN)
// =========================================================================

export interface CoverageItem {
  id: string; // "COV-..."
  coverageType: string; // e.g. "Auto Liability CSL", "Motor Truck Cargo", "Reefer Breakdown"
  limitAmount: number;
  deductibleAmount?: number;
  currency: "CAD" | "USD";
  scheduledVehiclesOnly?: boolean;
}

export interface BrokerReference {
  organizationId: string; // Canonical CMP-* identifier for Brokerage Firm
  organizationName: string;
  contactId?: string; // Canonical CNT-* identifier for Individual Broker
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export interface InsuranceEvidence {
  id: string; // "DOC-..."
  fileName: string;
  fileType: string;
  uploadedAt: string;
  source: "Device" | "Camera" | "OCR";
  dataUrl: string;
  extractedData?: any;
}

export interface TransportationInsuranceRecord {
  id: string; // "INS-..."
  insuranceType: string; // e.g. "Auto Liability", "Motor Truck Cargo", "General Liability", "Physical Damage", "Umbrella"
  policyNumber: string;
  insurerId: string; // Canonical CMP-*
  insurerName: string;
  effectiveDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  coverageAmount: number;
  coverageItems?: CoverageItem[];
  broker?: BrokerReference;
  status: "Active" | "Expired" | "Archived";
  evidenceId?: string; // Singular DOC-* pointer
  groupId?: string; // COI-* certificate grouping
  previousRecordId?: string; // Predecessor renewal pointer
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  notes?: string;
}

export interface WorkersInsuranceRecord {
  id: string; // "WCB-..."
  jurisdiction: string; // Province / State code (e.g. "ON", "AB", "BC")
  providerId: string; // Canonical CMP-* (e.g. WSIB, WCB Alberta)
  providerName: string;
  accountNumber: string;
  effectiveDate: string;
  expiryDate: string;
  status: "Active" | "Expired" | "Archived";
  evidenceId?: string;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  notes?: string;
}

export interface BondRecord {
  id: string; // "BND-..."
  bondType: string; // "BMC-84 (Freight Broker)", "Customs / In-Transit Bond", "Performance Bond"
  suretyOrganizationId: string; // Canonical CMP-*
  suretyName: string;
  bondNumber: string;
  principalName: string;
  bondAmount: number | string;
  effectiveDate: string;
  expiryDate?: string;
  source: "Manual" | "OCR";
  status: "Active" | "Expired" | "Archived";
  evidenceId?: string;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  notes?: string;
}

// Persisted Stored Envelope in tes_company_insurance_${companyId}
export interface StoredInsuranceData {
  transportation: TransportationInsuranceRecord[];
  workers: WorkersInsuranceRecord[];
  bonds: BondRecord[];
  evidence: InsuranceEvidence[];
}

export interface CanonicalCompany {
  id: string;
  name: string;
  kind?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface CanonicalContact {
  id: string;
  globalId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role?: string;
  isPrimary?: boolean;
  isArchived?: boolean;
  relationships?: Array<{
    id: string;
    companyId: string;
    companyName?: string;
    role: string;
    status: "active" | "ended";
    startDate: string;
  }>;
  [key: string]: any;
}

export interface InsuranceOCRDraft {
  evidence: InsuranceEvidence;
  insurerName: string;
  policyNumber: string;
  effectiveDate: string;
  expiryDate: string;
  coverageAmount: number;
  brokerOrgName: string;
  brokerAgentName: string;
  brokerPhone: string;
  brokerEmail: string;
  autoLiabilityLimit: number;
  cargoLimit: number;
  generalLiabilityLimit: number;
  physicalDamageLimit: number;
  confidence: number;
}

// =========================================================================
// 2. ID GENERATOR HELPERS (COMPATIBLE WITH FROZEN PREFIXES)
// =========================================================================

export function generateInsuranceId(prefix: "INS" | "WCB" | "BND" | "COI" | "DOC" | "COV"): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().substring(0, 8).toUpperCase()
      : Math.random().toString(36).substring(2, 9).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export function generateCompanyId(): string {
  return `CMP-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateContactId(): string {
  return `CNT-${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateRelationshipId(): string {
  return `REL-${Math.floor(10000 + Math.random() * 90000)}`;
}

export const EMPTY_STORE: StoredInsuranceData = {
  transportation: [],
  workers: [],
  bonds: [],
  evidence: [],
};

