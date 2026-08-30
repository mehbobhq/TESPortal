/**
 * TES Canonical Business & Corporate Records Data Contracts
 * Layer 1 Persistence Definition for Company-Scoped Business Records
 */

export type CorporatePersonRole = "Director" | "Officer" | "Shareholder" | "Director & Shareholder";

export interface BusinessShareholderRecord {
  id: string;                         // Format: "SHR-{companyId}-{uuid}"
  name: string;                       // Legal entity or individual name
  role: CorporatePersonRole;          // Role classification
  shares: number;                     // Ownership equity percentage (0 - 100)
  address: string;                    // Registered residential / corporate address
  contactIdRef?: string;              // Optional unlinked reference to canonical Contact (CNT-*)
  isArchived: boolean;                // Soft-deletion flag (preserves historical continuity)
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
}

export interface BusinessAnnualReturnRecord {
  id: string;                         // Format: "RTN-{companyId}-{uuid}"
  dueDate: string;                    // Statutory deadline entered by operator (YYYY-MM-DD)
  filedDate?: string;                 // Actual submission date (YYYY-MM-DD)
  filedBy: string;                    // Submitter name / role (e.g. "Admin / Accountant")
  confirmationNumber?: string;        // Jurisdiction confirmation / receipt #
  evidenceIdRef?: string;             // Reference to attached document
  status?: "Draft" | "Pending" | "Filed" | "Overdue";
  isArchived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
}

export type BusinessTaxType = "CRA_BN" | "IRS_EIN" | "GST_HST" | "STATE_SALES_TAX";

export interface BusinessTaxAccountRecord {
  id: string;                         // Format: "TAX-{TYPE}-{companyId}-{uuid}"
  taxType: BusinessTaxType;
  jurisdiction?: string;              // "Federal", Canadian Province code, or US State code
  accountNo: string;                  // Normalized identifier string
  rootBN?: string;                    // Root 9-digit CRA BN if applicable
  programIdentifier?: string;         // e.g. "RC", "RT", "RP"
  programSequence?: string;           // e.g. "0001"
  obtainedDate: string;               // Effective / Obtained date (YYYY-MM-DD)
  obtainedBy: string;                 // Submitter / Agent name
  isPrimary?: boolean;                // Indicates active primary registration
  evidenceIdRef?: string;             // Reference to attached document
  isArchived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
}

export interface BusinessEvent {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  description: string;
}

export interface CompanyBusinessStore {
  version: "1.0";
  companyId: string;
  lastUpdated: string;
  lastUpdatedBy: string;
  shareholders: BusinessShareholderRecord[];
  annualReturns: BusinessAnnualReturnRecord[];
  taxAccounts: BusinessTaxAccountRecord[];
  eventHistory: BusinessEvent[];
}
