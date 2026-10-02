/**
 * TES Master Register — assessment context contract.
 *
 * This fixes the shape later events use to relate to a company/compliance
 * assessment. It does NOT implement the assessment engine and does NOT
 * generate reports — those remain separate, future work. An assessment is
 * an explicit, recorded occurrence (invariant #13): its presence or absence
 * must be distinguishable from "nothing changed," which is why this exists
 * as a first-class reference other events can point to via
 * EventRelationships.assessmentId, rather than being inferred from the
 * absence of other events.
 */

import type { MaterialOperationCoverage } from "./coverage.ts";

export interface AssessmentScopeReference {
  scopeType: string;
  scopeReference?: string;
}

export interface AssessmentContext {
  assessmentId: string;
  companyId: string;
  assessmentDate: string;
  assessmentType: string;
  assessmentReportReference?: string;
  assessmentScope?: AssessmentScopeReference;
  coverage?: MaterialOperationCoverage;
  automationRunId?: string;
  reviewerActorId?: string;
}
