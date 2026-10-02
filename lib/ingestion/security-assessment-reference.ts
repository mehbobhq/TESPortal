/**
 * TES Ingestion Spine — reference to a scanner security assessment.
 *
 * This is deliberately NOT a copy of services/document-security-scanner/src/
 * types.ts's SecurityAssessment shape (sha256, reasonCodes, scannerVersion,
 * promotionStatus, etc.) - that scanner is a separate, isolated service, and
 * this application does not import its internals (nor should it; they are
 * two different deployables). This module holds only what a SourceFile
 * needs to carry forward: the fact that an assessment happened, its
 * resulting security decision (for quick reference without a cross-service
 * lookup), when, and an opaque id a future shared store could use to look up
 * the full assessment elsewhere.
 *
 * ARCHITECTURAL RECOMMENDATION (not implemented here): if the duplication
 * between this module's SecurityState and the scanner's own SecurityDecision
 * vocabulary ever becomes a real maintenance problem (the two drifting out
 * of sync), the long-term fix is a small, versioned, published shared
 * types package both the Next.js app and the scanner service depend on -
 * not importing one service's source tree into the other's.
 */

import type { SecurityState } from "./state.ts";

export interface SecurityAssessmentReference {
  /** Opaque reference to the scanner's own SecurityAssessment.securityAssessmentId - the full record, if ever persisted, lives in the scanner's own future store, not here. */
  securityAssessmentId: string;
  securityState: SecurityState;
  assessedAt?: string;
}
