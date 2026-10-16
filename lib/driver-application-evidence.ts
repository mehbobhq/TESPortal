/**
 * Driver Application recognition - pure assessment logic.
 *
 * Decides whether a Driver's hiring application requirement is met from the records already held in TES.
 * It never creates, edits, links or supersedes a record, and never infers compliance from an OCR
 * classification, a filename or an upload alone: an application is only recognised when the canonical
 * record and its linked canonical evidence both pass every check below.
 */
import type {
  CompanyDriverRelationship,
  DriverApplicationRecord,
  DriverHiringContext,
  HiringRequirementAssessmentStatus,
  HiringWorkflowAction,
  DriverEvidenceItem,
  DriverMaster,
} from "../types/drivers";

/**
 * Classification gate. No canonical catalogue of application document types exists in TES (the Alberta NSC audit
 * regime names an audit evidence type, which is jurisdiction-specific and not a document catalogue), so no type list is
 * invented here. The only canonical classification used is the existing evidence link type: a document counts as an
 * application document only when it is explicitly linked to the application record as "Driver Application".
 * Everything else, including a free-text `documentType` or an OCR label, stays "classification pending review".
 */
export const isLinkedAsApplicationDocument = (item: DriverEvidenceItem, application: Pick<DriverApplicationRecord, "id">) =>
  item.linkedRecordType === "Driver Application" && item.linkedRecordId === application.id;

/** Evidence verification states that count as a completed review. Pending / difference states do not. */
const VERIFIED_EVIDENCE_STATES: ReadonlyArray<NonNullable<DriverEvidenceItem["verificationState"]>> = ["verified", "Source Matched", "Externally Verified"];

const SUBMITTED_STATUSES: ReadonlyArray<DriverApplicationRecord["status"]> = ["Submitted", "Under Review", "Approved"];
const TES_IN_FLIGHT_STATUSES: ReadonlyArray<DriverApplicationRecord["status"]> = ["Draft", "Invited", "Started", "In Progress"];
const DEAD_STATUSES: ReadonlyArray<DriverApplicationRecord["status"]> = ["Rejected", "Withdrawn", "Expired"];

export type ApplicationRecognitionState =
  | "VERIFIED_EXISTING"
  | "AWAITING_REVIEW"
  | "REQUIRES_CORRECTION"
  | "TES_IN_PROGRESS"
  | "INVITATION_READY"
  | "NEW_APPLICATION_REQUIRED"
  | "SUPERSEDED";

/**
 * Three independent facts about an application, never collapsed into one another:
 * - submission: lifecycle status (a TES application submitted through the applicant boundary is "Submitted");
 * - verification: whether a named reviewer verified the canonical source document (authorization: `driver.evidence.verify`,
 *   not yet implemented, so TES cannot produce "Verified" itself);
 * - completeness: regulatory completeness against the governing rules (authorization: `driver.dqf.assess`, not yet
 *   implemented). It is "Not Assessed" unless the record carries an explicit assessment outcome.
 */
export type ApplicationSubmission = "Submitted" | "Not Submitted";
export type ApplicationVerification = "Verified" | "Pending" | "Not Applicable";
export type ApplicationCompleteness = "Not Assessed" | "Complete" | "Incomplete" | "Review Required";

export interface ApplicationVerdict {
  applicationId: string;
  state: ApplicationRecognitionState;
  submission: ApplicationSubmission;
  verification: ApplicationVerification;
  completeness: ApplicationCompleteness;
  reasons: string[];
  /** Canonical evidence that passed every check for this application. */
  qualifyingEvidenceIds: string[];
  updatedAt: string;
}

export type ApplicationRequirementState =
  | "VERIFIED"
  | "AWAITING_REVIEW"
  | "REQUIRES_CORRECTION"
  | "NEW_APPLICATION_WORKFLOW"
  | "MISSING";

export interface ApplicationRequirementAssessment {
  state: ApplicationRequirementState;
  /** The application the decision rests on. Never defaulted to the first record in the list. */
  authoritativeApplicationId?: string;
  qualifyingEvidenceIds: string[];
  reasons: string[];
  verdicts: ApplicationVerdict[];
  /** Application-type evidence that no application record references yet. */
  unlinkedApplicationEvidenceIds: string[];
  submission: ApplicationSubmission;
  verification: ApplicationVerification;
  completeness: ApplicationCompleteness;
  /** Submitted (and, for carrier documents, verified) but regulatory completeness is Not Assessed. Not a satisfied requirement. */
  completenessNotAssessed: boolean;
  /** True only when a TES-created application is in flight (invited / started) rather than just missing. */
  tesInvitationInFlight: boolean;
  /** True when a TES workflow application already exists whose invitation has not been sent. */
  invitationReady: boolean;
}

export interface ApplicationRecognitionContext {
  companyId: string;
  driverMasterId: string;
  /** Active relationship id, when known. An application stamped with a different relationship is not recognised. */
  relationshipId?: string;
  identity?: Pick<DriverMaster["identity"], "legalFirstName" | "legalLastName" | "dateOfBirth">;
}

const norm = (value: string | undefined | null) => (value || "").trim().replace(/\s+/g, " ").toLowerCase();

/** An evidence item that has been replaced, explicitly or by a newer version that points back at it. */
export function isEvidenceSuperseded(item: DriverEvidenceItem, all: DriverEvidenceItem[]) {
  if (item.verificationState === "superseded") return true;
  return all.some((other) => other.id !== item.id && !other.isArchived && other.supersedesEvidenceId === item.id);
}

/** Company, driver and lifecycle checks shared by every evidence use. */
export function isEvidenceUsable(item: DriverEvidenceItem, all: DriverEvidenceItem[], companyId: string, driverMasterId: string) {
  return item.companyId === companyId && item.driverMasterId === driverMasterId && !item.isArchived && !isEvidenceSuperseded(item, all);
}

/** A completed review recorded by a named reviewer at a recorded time. Upload/OCR alone never reaches this. */
export function isEvidenceSufficientlyVerified(item: DriverEvidenceItem) {
  return Boolean(
    item.verificationState &&
      VERIFIED_EVIDENCE_STATES.includes(item.verificationState) &&
      item.verifiedBy?.trim() &&
      item.verifiedAt,
  );
}

/** Canonical link in either direction: the application lists the evidence, or the evidence points at the application. */
export function isEvidenceLinkedToApplication(item: DriverEvidenceItem, application: Pick<DriverApplicationRecord, "id" | "evidenceIds">) {
  return (application.evidenceIds || []).includes(item.id) || (item.linkedRecordType === "Driver Application" && item.linkedRecordId === application.id);
}

const hasText = (value: string | undefined | null) => Boolean(value && value.trim());

function identityMismatch(application: DriverApplicationRecord, identity: ApplicationRecognitionContext["identity"]) {
  const personal = application.personalInfoClaimed;
  if (!personal || !identity) return false;
  return (
    norm(personal.legalFirstName) !== norm(identity.legalFirstName) ||
    norm(personal.legalLastName) !== norm(identity.legalLastName) ||
    (hasText(identity.dateOfBirth) && norm(personal.dateOfBirth) !== norm(identity.dateOfBirth))
  );
}

const openFindings = (application: DriverApplicationRecord) =>
  (application.findings || []).filter((finding) => finding.type !== "MATCH" && finding.status !== "Resolved");

function verdictFor(
  application: DriverApplicationRecord,
  evidence: DriverEvidenceItem[],
  context: ApplicationRecognitionContext,
): ApplicationVerdict {
  const isTes = application.source === "TES Workflow" || !application.source;
  const base = {
    applicationId: application.id,
    qualifyingEvidenceIds: [] as string[],
    updatedAt: application.updatedAt,
    submission: (SUBMITTED_STATUSES.includes(application.status) || application.status === "Additional Information Requested" ? "Submitted" : "Not Submitted") as ApplicationSubmission,
    verification: (isTes ? "Not Applicable" : "Pending") as ApplicationVerification,
    completeness: (application.processing?.fileCompleteness && application.processing.fileCompleteness !== "Not Assessed" ? application.processing.fileCompleteness : "Not Assessed") as ApplicationCompleteness,
  };
  const verdict = (state: ApplicationRecognitionState, reasons: string[], qualifyingEvidenceIds: string[] = [], verification: ApplicationVerification = base.verification): ApplicationVerdict => ({ ...base, verification, state, reasons, qualifyingEvidenceIds });
  // Completeness outcome shared by TES and carrier-supplied paths; submission and verification never stand in for it.
  const byCompleteness = (verification: ApplicationVerification, evidenceIds: string[], subject: string): ApplicationVerdict => {
    switch (base.completeness) {
      case "Complete":
        return verdict("VERIFIED_EXISTING", [], evidenceIds, verification);
      case "Incomplete":
      case "Review Required":
        return verdict("REQUIRES_CORRECTION", [`Application completeness outcome is "${base.completeness}".`], evidenceIds, verification);
      default:
        return verdict("AWAITING_REVIEW", [`${subject} Regulatory completeness is Not Assessed.`], evidenceIds, verification);
    }
  };

  if (application.status === "Superseded" || application.supersededByApplicationId) {
    return verdict("SUPERSEDED", [`Superseded by ${application.supersededByApplicationId || "a later application"}; kept as history.`]);
  }
  if (application.companyId !== context.companyId || application.driverMasterId !== context.driverMasterId) {
    return verdict("REQUIRES_CORRECTION", ["Application belongs to a different company or driver."]);
  }
  if (application.companyDriverRelationshipId && context.relationshipId && application.companyDriverRelationshipId !== context.relationshipId) {
    return verdict("REQUIRES_CORRECTION", ["Application is attributed to a different company-driver relationship."]);
  }
  if (DEAD_STATUSES.includes(application.status) || application.companyDetermination === "Rejected" || application.companyDetermination === "Withdrawn") {
    return verdict("NEW_APPLICATION_REQUIRED", [`Application is ${application.status}.`]);
  }
  if ((application.findings || []).some((finding) => finding.status === "New Application Required")) {
    return verdict("NEW_APPLICATION_REQUIRED", ["A finding records that a new application is required."]);
  }
  if (application.status === "Invitation Ready") return verdict("INVITATION_READY", ["Invitation has not been sent."]);
  if (TES_IN_FLIGHT_STATUSES.includes(application.status)) return verdict("TES_IN_PROGRESS", ["Awaiting the applicant's submission."]);
  if (application.status === "Additional Information Requested") return verdict("REQUIRES_CORRECTION", ["Additional information has been requested on this application."]);
  if (!SUBMITTED_STATUSES.includes(application.status)) return verdict("TES_IN_PROGRESS", [`Application status is ${application.status}.`]);

  const open = openFindings(application);
  if (open.length > 0) return verdict("REQUIRES_CORRECTION", open.map((finding) => `Open finding: ${finding.label}`));

  // A TES workflow application was submitted through TES's own applicant boundary; its status is the record.
  if (isTes) {
    return byCompleteness("Not Applicable", (application.evidenceIds || []).filter((id) => evidence.some((item) => item.id === id)), "Application was submitted through TES.");
  }

  // Carrier supplied / driver supplied / imported: recognised only through validated, attributed evidence.
  // Step 1 - document identity and verification (who/what the document is, and that a named reviewer confirmed it).
  const linked = evidence.filter((item) => isEvidenceLinkedToApplication(item, application));
  const usable = linked.filter((item) => isEvidenceUsable(item, evidence, context.companyId, context.driverMasterId));
  const classified = usable.filter((item) => isLinkedAsApplicationDocument(item, application));
  if (classified.length === 0) {
    const reason = linked.length === 0
      ? "No canonical document is linked to this application."
      : usable.length === 0
        ? "Linked evidence is not usable (wrong company/driver, archived or superseded)."
        : "Document classification is pending review: the linked evidence is not recorded as a Driver Application document.";
    return verdict(linked.length === 0 || usable.length === 0 ? "REQUIRES_CORRECTION" : "AWAITING_REVIEW", [reason]);
  }
  const verified = classified.filter(isEvidenceSufficientlyVerified);
  if (verified.length === 0) {
    if (classified.some((item) => item.verificationState === "Difference Present")) {
      return verdict("REQUIRES_CORRECTION", ["Review found a difference between the application document and its source."]);
    }
    return verdict("AWAITING_REVIEW", ["Application document has no completed verification (named reviewer and review time required)."]);
  }
  if (identityMismatch(application, context.identity)) {
    return verdict("REQUIRES_CORRECTION", ["Applicant identity on the application does not match the driver record."]);
  }

  // Step 2 - regulatory completeness. Verifying the document says it is genuine and belongs to this driver; it does not
  // say the application is regulatorily complete.
  return byCompleteness("Verified", verified.map((item) => item.id), "Application document is verified.");
}

// Lower rank is more authoritative.
const RANK: Record<ApplicationRecognitionState, number> = {
  VERIFIED_EXISTING: 0,
  AWAITING_REVIEW: 1,
  REQUIRES_CORRECTION: 2,
  TES_IN_PROGRESS: 3,
  INVITATION_READY: 4,
  NEW_APPLICATION_REQUIRED: 5,
  SUPERSEDED: 6,
};

export function assessApplicationRequirement(
  applications: DriverApplicationRecord[],
  evidence: DriverEvidenceItem[],
  context: ApplicationRecognitionContext,
): ApplicationRequirementAssessment {
  const own = applications.filter((item) => item.driverMasterId === context.driverMasterId && item.companyId === context.companyId);
  const verdicts = own.map((application) => verdictFor(application, evidence, context));
  const live = verdicts.filter((item) => item.state !== "SUPERSEDED");
  const best = [...live].sort((a, b) => RANK[a.state] - RANK[b.state] || b.updatedAt.localeCompare(a.updatedAt))[0];

  const ownIds = new Set(own.map((application) => application.id));
  const unlinked = evidence
    .filter((item) => isEvidenceUsable(item, evidence, context.companyId, context.driverMasterId))
    .filter((item) => item.linkedRecordType === "Driver Application" && !(item.linkedRecordId && ownIds.has(item.linkedRecordId)))
    .map((item) => item.id);

  const result = (state: ApplicationRequirementState, reasons: string[], extra: Partial<ApplicationRequirementAssessment> = {}): ApplicationRequirementAssessment => ({
    state,
    reasons,
    qualifyingEvidenceIds: [],
    submission: best?.submission ?? "Not Submitted",
    verification: best?.verification ?? "Pending",
    completeness: best?.completeness ?? "Not Assessed",
    completenessNotAssessed: Boolean(best && best.state === "AWAITING_REVIEW" && best.submission === "Submitted" && best.verification !== "Pending" && best.completeness === "Not Assessed"),
    verdicts,
    unlinkedApplicationEvidenceIds: unlinked,
    tesInvitationInFlight: live.some((item) => item.state === "TES_IN_PROGRESS"),
    invitationReady: live.some((item) => item.state === "INVITATION_READY"),
    ...extra,
  });

  if (best) {
    const authority = { authoritativeApplicationId: best.applicationId, qualifyingEvidenceIds: best.qualifyingEvidenceIds };
    switch (best.state) {
      case "VERIFIED_EXISTING": return result("VERIFIED", [], authority);
      case "AWAITING_REVIEW": return result("AWAITING_REVIEW", best.reasons, authority);
      case "REQUIRES_CORRECTION": return result("REQUIRES_CORRECTION", best.reasons, authority);
      case "TES_IN_PROGRESS": return result("AWAITING_REVIEW", best.reasons, authority);
      case "INVITATION_READY": return result("NEW_APPLICATION_WORKFLOW", best.reasons, authority);
      default: return result("NEW_APPLICATION_WORKFLOW", best.reasons, authority);
    }
  }

  // No application record to carry claims or content: uploaded evidence is held for linking, never accepted by itself.
  if (unlinked.length > 0) {
    return result("AWAITING_REVIEW", ["Application document is on file but is not linked to an application record; it cannot satisfy the requirement on its own."]);
  }
  return result("MISSING", ["No application or application evidence is on file."]);
}

/** Verified Commercial Experience requires a completed review of correctly linked, non-application evidence. */
const EXPERIENCE_DOCUMENT_HINTS = ["verification", "employment", "mvr", "screening", "inquiry"];

export function hasVerifiedExperienceEvidence(
  application: Pick<DriverApplicationRecord, "id" | "companyId" | "driverMasterId" | "evidenceIds">,
  evidence: DriverEvidenceItem[],
) {
  return evidence.some(
    (item) =>
      isEvidenceLinkedToApplication(item, application) &&
      isEvidenceUsable(item, evidence, application.companyId, application.driverMasterId) &&
      !norm(item.documentType).includes("application") &&
      EXPERIENCE_DOCUMENT_HINTS.some((hint) => norm(item.documentType).includes(hint)) &&
      isEvidenceSufficientlyVerified(item),
  );
}

/** Prospective only while no relationship has been established; a missing TES service start date never implies it. */
export function classifyHiringContext(relationship: Pick<CompanyDriverRelationship, "driverStatus"> | undefined): DriverHiringContext {
  return relationship && relationship.driverStatus !== "Not Established" ? "Existing Driver File Completion" : "Prospective Hire";
}

/** Maps the application requirement to its requirement status and the single operator action it calls for. Nothing is sent automatically. */
export function applicationWorkflowOutcome(recognition: ApplicationRequirementAssessment): {
  status: HiringRequirementAssessmentStatus;
  action?: HiringWorkflowAction;
  label?: string;
} {
  switch (recognition.state) {
    case "VERIFIED":
      return { status: "SATISFIED" };
    case "REQUIRES_CORRECTION":
      return { status: "INSUFFICIENT_EVIDENCE", action: "REMEDIATE_HIRING_FILE", label: "Application Requires Correction" };
    case "AWAITING_REVIEW":
      return { status: "PENDING", action: "CONTINUE_APPLICATION", label: recognition.completenessNotAssessed ? "Application Completeness Not Assessed" : recognition.tesInvitationInFlight ? "Application Pending" : "Application Evidence Awaiting Review" };
    case "NEW_APPLICATION_WORKFLOW":
      return { status: recognition.invitationReady ? "PENDING" : "MISSING", action: "SEND_APPLICATION", label: "Send Application" };
    default:
      return { status: "MISSING", action: "SEND_APPLICATION", label: "Send Application" };
  }
}

/**
 * Creation gate for a new application record. Returns the reason it must be refused, or undefined when allowed.
 * A replacement is created only by the replacement workflow (which supersedes the original); remediation is allowed only
 * against a live application of this driver that currently requires correction; any other TES application is refused
 * while a live, non-dead application exists.
 */
export function checkApplicationCreation(
  applications: DriverApplicationRecord[],
  evidence: DriverEvidenceItem[],
  context: ApplicationRecognitionContext,
  input: Pick<DriverApplicationRecord, "source" | "replacesApplicationId" | "remediatesApplicationId">,
): string | undefined {
  if (input.replacesApplicationId) {
    return "Use the linked replacement workflow to replace an application so the original is superseded and the link is recorded.";
  }
  const { verdicts } = assessApplicationRequirement(applications, evidence, context);
  if (input.remediatesApplicationId) {
    const target = verdicts.find((verdict) => verdict.applicationId === input.remediatesApplicationId);
    return target?.state === "REQUIRES_CORRECTION" ? undefined : "Remediation must reference an application of this driver that currently requires correction.";
  }
  if (input.source && input.source !== "TES Workflow") return undefined;
  const stillSubmitted = (applicationId: string) =>
    SUBMITTED_STATUSES.includes(applications.find((item) => item.id === applicationId)?.status as DriverApplicationRecord["status"]) ||
    applications.find((item) => item.id === applicationId)?.status === "Additional Information Requested";
  const blocking = verdicts.find(
    (verdict) =>
      ["VERIFIED_EXISTING", "AWAITING_REVIEW", "TES_IN_PROGRESS", "REQUIRES_CORRECTION"].includes(verdict.state) ||
      (verdict.state === "NEW_APPLICATION_REQUIRED" && stillSubmitted(verdict.applicationId)),
  );
  return blocking
    ? `Driver Application ${blocking.applicationId} is already on file for this driver. Review it, correct it, or issue a linked replacement from that application instead of creating a second application.`
    : undefined;
}
