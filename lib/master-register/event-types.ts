/**
 * TES Master Register — versioned event catalogue.
 *
 * Event family is derived EXCLUSIVELY from this registry (never supplied by
 * a caller — see record-event.ts). The catalogue is registry data, not
 * scattered string literals: adding, deprecating, or versioning an event
 * type happens here, in one place.
 *
 * Deprecation, not renaming: an event type already recorded in a real
 * Master Register must never have its string value changed or removed,
 * because historical events carry that exact string forever. When a type
 * needs to be replaced, mark it `deprecated: true` and point
 * `supersededBy` at its replacement — the old entry stays in the registry
 * permanently so historical events still resolve to a known family.
 *
 * CATALOGUE STATUS:
 * Families 01–20 below constitute Catalogue Version 1 (CATALOGUE_VERSION)
 * of the implementation baseline. Version 1 does not mean this catalogue is
 * frozen forever — it means future changes are handled through explicit
 * catalogue/schema evolution (adding new types, deprecating old ones via
 * `deprecated`/`supersededBy`, bumping a type's own `schemaVersion`), never
 * by silently changing what an already-recorded historical event type
 * means.
 */

export interface EventFamilyDefinition {
  code: string;
  name: string;
}

export const EVENT_FAMILIES = {
  AUTHENTICATION: { code: "01", name: "AUTHENTICATION" },
  ACCESS: { code: "02", name: "ACCESS" },
  RECORD_DATA: { code: "03", name: "RECORD_DATA" },
  DOCUMENT_EVIDENCE: { code: "04", name: "DOCUMENT_EVIDENCE" },
  OCR_DOCUMENT_PROCESSING: { code: "05", name: "OCR_DOCUMENT_PROCESSING" },
  ENTITY_RESOLUTION: { code: "06", name: "ENTITY_RESOLUTION" },
  VALIDATION: { code: "07", name: "VALIDATION" },
  COMPLIANCE: { code: "08", name: "COMPLIANCE" },
  WORKFLOW: { code: "09", name: "WORKFLOW" },
  REVIEW_APPROVAL: { code: "10", name: "REVIEW_APPROVAL" },
  ASSIGNMENT: { code: "11", name: "ASSIGNMENT" },
  COMMUNICATION_NOTIFICATION: { code: "12", name: "COMMUNICATION_NOTIFICATION" },
  SECURITY: { code: "13", name: "SECURITY" },
  ADMINISTRATION: { code: "14", name: "ADMINISTRATION" },
  CONFIGURATION: { code: "15", name: "CONFIGURATION" },
  ORGANIZATIONAL: { code: "16", name: "ORGANIZATIONAL" },
  INTEGRATION_API: { code: "17", name: "INTEGRATION_API" },
  SYSTEM_AUTOMATION: { code: "18", name: "SYSTEM_AUTOMATION" },
  INVESTIGATION: { code: "19", name: "INVESTIGATION" },
  MASTER_REGISTER_GOVERNANCE: { code: "20", name: "MASTER_REGISTER_GOVERNANCE" },
} as const satisfies Record<string, EventFamilyDefinition>;

export type EventFamilyName = (typeof EVENT_FAMILIES)[keyof typeof EVENT_FAMILIES]["name"];

/** The catalogue's own version. Bump this when the registry's overall shape changes materially, independent of any single event type's schemaVersion. */
export const CATALOGUE_VERSION = 1;

export interface EventTypeDefinition {
  family: EventFamilyName;
  /** Independent per-event-type schema version, so one type can evolve without bumping every other type's version. */
  schemaVersion: number;
  description: string;
  deprecated?: boolean;
  /** Set only when deprecated: true. The event type that replaces this one going forward. */
  supersededBy?: string;
}

function def(family: EventFamilyName, description: string): EventTypeDefinition {
  return { family, schemaVersion: 1, description };
}

export const EVENT_TYPE_REGISTRY: Record<string, EventTypeDefinition> = {
  // ---- 01 AUTHENTICATION ----
  SIGN_IN_ATTEMPTED: def("AUTHENTICATION", "A sign-in was attempted (success or failure recorded via outcome)."),
  MFA_CHALLENGE_ISSUED: def("AUTHENTICATION", "A multi-factor authentication challenge was issued."),
  MFA_CHALLENGE_RESPONDED: def("AUTHENTICATION", "A principal responded to an MFA challenge."),
  SESSION_CREATED: def("AUTHENTICATION", "An authenticated session was created."),
  SESSION_TERMINATED: def("AUTHENTICATION", "An authenticated session was explicitly terminated."),
  SESSION_EXPIRED: def("AUTHENTICATION", "An authenticated session expired without explicit termination."),
  SESSION_REVOKED: def("AUTHENTICATION", "An authenticated session was revoked by another actor/system."),
  PASSWORD_CHANGE_ATTEMPTED: def("AUTHENTICATION", "A password change was attempted."),
  PASSWORD_RESET_REQUESTED: def("AUTHENTICATION", "A password reset was requested."),
  PASSWORD_RESET_CHALLENGE_RESPONDED: def("AUTHENTICATION", "A principal responded to a password reset challenge."),
  REAUTHENTICATION_REQUESTED: def("AUTHENTICATION", "Reauthentication was requested for a sensitive action."),
  REAUTHENTICATION_RESPONDED: def("AUTHENTICATION", "A principal responded to a reauthentication request."),
  IDENTITY_VERIFICATION_ATTEMPTED: def("AUTHENTICATION", "An identity verification step was attempted."),

  // ---- 02 ACCESS ----
  RESOURCE_ACCESS_ATTEMPTED: def("ACCESS", "Access to a resource was attempted (granted/denied recorded via outcome)."),
  RECORD_VIEWED: def("ACCESS", "A record was viewed."),
  DOCUMENT_VIEWED: def("ACCESS", "A document was viewed."),
  SENSITIVE_DATA_REVEALED: def("ACCESS", "A field/value classified as sensitive was revealed to a viewer."),
  PROTECTED_SEARCH_EXECUTED: def("ACCESS", "A search over protected/sensitive data was executed."),
  DOCUMENT_DOWNLOADED: def("ACCESS", "A document was downloaded."),
  DATA_EXPORTED: def("ACCESS", "Data was exported."),
  PRINT_REQUESTED: def("ACCESS", "A print of a record/document was requested."),

  // ---- 03 RECORD_DATA ----
  RECORD_CREATED: def("RECORD_DATA", "A material record was created."),
  RECORD_UPDATED: def("RECORD_DATA", "A material record was updated."),
  RECORD_CORRECTED: def("RECORD_DATA", "A material record was corrected (a factual fix, not a routine update)."),
  RECORD_ARCHIVED: def("RECORD_DATA", "A material record was archived."),
  RECORD_RESTORED: def("RECORD_DATA", "A previously archived record was restored."),
  RECORD_STATUS_CHANGED: def("RECORD_DATA", "A record's status changed."),
  RECORD_LINK_ESTABLISHED: def("RECORD_DATA", "A link between two records was established."),
  RECORD_LINK_REMOVED: def("RECORD_DATA", "A link between two records was removed."),

  // ---- 04 DOCUMENT_EVIDENCE ----
  DOCUMENT_INGESTED: def("DOCUMENT_EVIDENCE", "A document was ingested into TES (reference only — no content duplicated)."),
  DOCUMENT_GENERATED: def("DOCUMENT_EVIDENCE", "A document was generated by TES (reference only)."),
  DOCUMENT_CLASSIFICATION_CONFIRMED: def("DOCUMENT_EVIDENCE", "A document's classification was confirmed."),
  DOCUMENT_CLASSIFICATION_CHANGED: def("DOCUMENT_EVIDENCE", "A document's classification was changed."),
  EVIDENCE_ASSOCIATED: def("DOCUMENT_EVIDENCE", "Evidence was associated with a record (reference only)."),
  EVIDENCE_ASSOCIATION_REMOVED: def("DOCUMENT_EVIDENCE", "An evidence association was removed."),
  DOCUMENT_SUPERSEDED: def("DOCUMENT_EVIDENCE", "A document was superseded by a newer version/replacement."),
  DOCUMENT_ARCHIVED: def("DOCUMENT_EVIDENCE", "A document was archived."),
  DOCUMENT_RESTORED: def("DOCUMENT_EVIDENCE", "A previously archived document was restored."),

  // ---- 05 OCR_DOCUMENT_PROCESSING ----
  PROCESSING_STARTED: def("OCR_DOCUMENT_PROCESSING", "Document processing began."),
  SOURCE_SEGMENTATION_COMPLETED: def("OCR_DOCUMENT_PROCESSING", "Source document segmentation completed."),
  MACHINE_CLASSIFICATION_COMPLETED: def("OCR_DOCUMENT_PROCESSING", "Automated document-type classification completed."),
  OCR_PROCESSING_COMPLETED: def("OCR_DOCUMENT_PROCESSING", "OCR text/field recognition completed."),
  FIELD_EXTRACTION_COMPLETED: def("OCR_DOCUMENT_PROCESSING", "Structured field extraction completed."),
  PROCESSING_NORMALIZATION_COMPLETED: def("OCR_DOCUMENT_PROCESSING", "Extracted-field normalization completed."),
  PROCESSING_RETRY_INITIATED: def("OCR_DOCUMENT_PROCESSING", "A processing retry was initiated."),
  PROCESSING_FAILED: def("OCR_DOCUMENT_PROCESSING", "Document processing failed."),
  PROCESSING_OUTPUT_CORRECTED: def("OCR_DOCUMENT_PROCESSING", "A human corrected a processing output value."),
  PROCESSING_OUTPUT_INVALIDATED: def("OCR_DOCUMENT_PROCESSING", "A previously recorded processing output was invalidated."),

  // ---- 06 ENTITY_RESOLUTION ----
  ENTITY_RESOLUTION_COMPLETED: def("ENTITY_RESOLUTION", "Entity resolution completed for a candidate record."),
  ENTITY_IDENTITY_CONFLICT_DETECTED: def("ENTITY_RESOLUTION", "A conflicting identity was detected during resolution."),
  ENTITY_DUPLICATE_CANDIDATES_DETECTED: def("ENTITY_RESOLUTION", "Candidate duplicate entities were detected."),
  ENTITY_RESOLUTION_CORRECTED: def("ENTITY_RESOLUTION", "A prior entity resolution was corrected."),
  ENTITY_RESOLUTION_INVALIDATED: def("ENTITY_RESOLUTION", "A prior entity resolution was invalidated."),

  // ---- 07 VALIDATION ----
  VALIDATION_COMPLETED: def("VALIDATION", "A validation pass completed (pass/fail recorded via outcome)."),
  VALIDATION_RESULT_INVALIDATED: def("VALIDATION", "A previously recorded validation result was invalidated."),

  // ---- 08 COMPLIANCE ----
  COMPLIANCE_ASSESSMENT_COMPLETED: def("COMPLIANCE", "A company/compliance assessment completed and produced an explicit, recorded outcome."),
  COMPLIANCE_APPLICABILITY_DETERMINED: def("COMPLIANCE", "Whether a compliance requirement applies was determined."),
  COMPLIANCE_REQUIREMENT_ASSESSED: def("COMPLIANCE", "A specific compliance requirement was assessed."),
  COMPLIANCE_STATUS_CHANGED: def("COMPLIANCE", "A compliance status changed."),
  COMPLIANCE_DEADLINE_ESTABLISHED: def("COMPLIANCE", "A compliance deadline was established."),
  COMPLIANCE_SUBMISSION_RECORDED: def("COMPLIANCE", "A compliance submission to an authority was recorded."),
  REGULATORY_OUTCOME_RECORDED: def("COMPLIANCE", "A regulatory authority's outcome/decision was recorded."),

  // ---- 09 WORKFLOW ----
  WORKFLOW_STARTED: def("WORKFLOW", "A workflow instance started."),
  WORKFLOW_STAGE_CHANGED: def("WORKFLOW", "A workflow instance moved to a different stage."),
  WORKFLOW_BLOCKED: def("WORKFLOW", "A workflow instance became blocked."),
  WORKFLOW_RESUMED: def("WORKFLOW", "A blocked workflow instance resumed."),
  WORKFLOW_COMPLETED: def("WORKFLOW", "A workflow instance completed."),
  WORKFLOW_CANCELLED: def("WORKFLOW", "A workflow instance was cancelled before completion."),
  WORKFLOW_REOPENED: def("WORKFLOW", "A completed/cancelled workflow instance was reopened."),

  // ---- 10 REVIEW_APPROVAL ----
  REVIEW_STARTED: def("REVIEW_APPROVAL", "A review started."),
  REVIEW_COMPLETED: def("REVIEW_APPROVAL", "A review completed."),
  REVIEW_DECISION_RECORDED: def("REVIEW_APPROVAL", "A review decision was recorded."),
  APPROVAL_DECISION_RECORDED: def("REVIEW_APPROVAL", "An approval decision was recorded."),
  ACKNOWLEDGEMENT_RECORDED: def("REVIEW_APPROVAL", "An acknowledgement was recorded."),
  REVIEW_REOPENED: def("REVIEW_APPROVAL", "A completed review was reopened."),

  // ---- 11 ASSIGNMENT ----
  ASSIGNMENT_CREATED: def("ASSIGNMENT", "A task/assignment was created."),
  ASSIGNMENT_ACCEPTED: def("ASSIGNMENT", "An assignment was accepted by its assignee."),
  ASSIGNMENT_REASSIGNED: def("ASSIGNMENT", "A task/assignment was reassigned to a different actor."),
  ASSIGNMENT_RELEASED: def("ASSIGNMENT", "An assignment was released back without being completed."),
  ASSIGNMENT_ESCALATED: def("ASSIGNMENT", "An assignment was escalated."),

  // ---- 12 COMMUNICATION_NOTIFICATION ----
  COMMUNICATION_SENT: def("COMMUNICATION_NOTIFICATION", "A material communication was sent."),
  COMMUNICATION_RECEIVED: def("COMMUNICATION_NOTIFICATION", "A material communication was received."),
  NOTIFICATION_CREATED: def("COMMUNICATION_NOTIFICATION", "A notification was created."),
  NOTIFICATION_DELIVERY_RECORDED: def("COMMUNICATION_NOTIFICATION", "A notification's delivery outcome was recorded."),

  // ---- 13 SECURITY ----
  SECURITY_ANOMALY_DETECTED: def("SECURITY", "An anomalous pattern was detected. Does not itself imply an investigation was opened."),
  AUTHORIZATION_CONTRADICTION_DETECTED: def("SECURITY", "Contradictory authorization state was detected."),
  SECURITY_ALERT_CREATED: def("SECURITY", "A security alert was created."),
  SECURITY_SCOPE_CONTAINED: def("SECURITY", "A security scope (account, session, resource) was contained."),
  SECURITY_CONTAINMENT_RELEASED: def("SECURITY", "A prior security containment was released."),
  SECURITY_INCIDENT_DECLARED: def("SECURITY", "A security incident was formally declared."),

  // ---- 14 ADMINISTRATION ----
  ACCOUNT_CREATED: def("ADMINISTRATION", "An account was created."),
  ACCOUNT_STATUS_CHANGED: def("ADMINISTRATION", "An account's status changed."),
  CAPABILITY_GRANTED: def("ADMINISTRATION", "A capability/permission was granted."),
  CAPABILITY_REVOKED: def("ADMINISTRATION", "A capability/permission was revoked."),
  ACCESS_GRANT_CREATED: def("ADMINISTRATION", "An access grant was created."),
  ACCESS_GRANT_CHANGED: def("ADMINISTRATION", "An access grant was changed."),
  ACCESS_GRANT_REVOKED: def("ADMINISTRATION", "An access grant was revoked."),
  ADMINISTRATIVE_RESTRICTION_APPLIED: def("ADMINISTRATION", "An administrative restriction was applied."),
  ADMINISTRATIVE_RESTRICTION_RELEASED: def("ADMINISTRATION", "An administrative restriction was released."),

  // ---- 15 CONFIGURATION ----
  CONFIGURATION_CREATED: def("CONFIGURATION", "A system/application configuration value was created."),
  CONFIGURATION_CHANGED: def("CONFIGURATION", "A system/application configuration value was changed."),
  CONFIGURATION_ACTIVATED: def("CONFIGURATION", "A configuration was activated."),
  CONFIGURATION_DEACTIVATED: def("CONFIGURATION", "A configuration was deactivated."),

  // ---- 16 ORGANIZATIONAL ----
  ORGANIZATION_CREATED: def("ORGANIZATIONAL", "An organization (e.g. company) record was created."),
  ORGANIZATION_STATUS_CHANGED: def("ORGANIZATIONAL", "An organization's status changed."),
  ORGANIZATIONAL_MEMBERSHIP_ESTABLISHED: def("ORGANIZATIONAL", "An organizational membership was established."),
  ORGANIZATIONAL_MEMBERSHIP_CHANGED: def("ORGANIZATIONAL", "An organizational membership was changed."),
  ORGANIZATIONAL_MEMBERSHIP_ENDED: def("ORGANIZATIONAL", "An organizational membership ended."),
  ORGANIZATIONAL_RELATIONSHIP_ESTABLISHED: def("ORGANIZATIONAL", "A relationship between organizations was established."),
  ORGANIZATIONAL_RELATIONSHIP_CHANGED: def("ORGANIZATIONAL", "A relationship between organizations was changed."),
  ORGANIZATIONAL_RELATIONSHIP_ENDED: def("ORGANIZATIONAL", "A relationship between organizations ended."),

  // ---- 17 INTEGRATION_API (as specified) ----
  INTEGRATION_CONNECTED: def("INTEGRATION_API", "An external integration/API connection was established."),
  INTEGRATION_CONNECTION_STATUS_CHANGED: def("INTEGRATION_API", "An integration connection's status changed."),
  INTEGRATION_DISCONNECTED: def("INTEGRATION_API", "An external integration/API connection was disconnected."),
  INTEGRATION_OPERATION_STARTED: def("INTEGRATION_API", "A material integration/API operation started."),
  INTEGRATION_OPERATION_COMPLETED: def("INTEGRATION_API", "A material integration/API operation completed."),
  INTEGRATION_OPERATION_FAILED: def("INTEGRATION_API", "A material integration/API operation failed."),
  INTEGRATION_OPERATION_RETRIED: def("INTEGRATION_API", "A material integration/API operation was retried."),
  INTEGRATION_ITEM_FAILED: def("INTEGRATION_API", "A single item within a larger integration operation failed."),
  INTEGRATION_SYNC_COMPLETED: def("INTEGRATION_API", "An integration sync run completed."),

  // ---- 18 SYSTEM_AUTOMATION (as specified) ----
  AUTOMATION_EXECUTION_STARTED: def("SYSTEM_AUTOMATION", "A material automation run started."),
  AUTOMATION_EXECUTION_COMPLETED: def("SYSTEM_AUTOMATION", "A material automation run completed (see outcome.result for no-findings vs. partial)."),
  AUTOMATION_EXECUTION_FAILED: def("SYSTEM_AUTOMATION", "A material automation run failed."),
  AUTOMATION_EXECUTION_RETRIED: def("SYSTEM_AUTOMATION", "A material automation run was retried."),
  AUTOMATION_EXPECTED_EXECUTION_MISSED: def("SYSTEM_AUTOMATION", "An automation run that was expected to execute did not run at all."),
  AUTOMATION_SUSPENDED: def("SYSTEM_AUTOMATION", "A recurring automation was suspended."),
  AUTOMATION_RESUMED: def("SYSTEM_AUTOMATION", "A suspended automation was resumed."),
  SYSTEM_OPERATIONAL_STATE_CHANGED: def("SYSTEM_AUTOMATION", "A system component's operational state changed."),

  // ---- 19 INVESTIGATION (as specified) ----
  INVESTIGATION_OPENED: def("INVESTIGATION", "An investigation was opened. Investigations are optional downstream processing, never implied automatically by another event."),
  INVESTIGATION_SCOPE_CHANGED: def("INVESTIGATION", "An investigation's scope changed."),
  INVESTIGATION_EVIDENCE_ADDED: def("INVESTIGATION", "Evidence was added to an investigation (reference only)."),
  INVESTIGATION_FINDING_RECORDED: def("INVESTIGATION", "A finding was recorded within an investigation."),
  INVESTIGATION_DISPOSITION_RECORDED: def("INVESTIGATION", "An investigation's disposition was recorded."),
  INVESTIGATION_CLOSED: def("INVESTIGATION", "An investigation was closed."),
  INVESTIGATION_REOPENED: def("INVESTIGATION", "A previously closed investigation was reopened."),

  // ---- 20 MASTER_REGISTER_GOVERNANCE (as specified) ----
  MASTER_REGISTER_ACCESSED: def("MASTER_REGISTER_GOVERNANCE", "The Master Register itself was accessed."),
  MASTER_REGISTER_QUERY_EXECUTED: def("MASTER_REGISTER_GOVERNANCE", "A query against the Master Register was executed."),
  MASTER_REGISTER_EVENT_INSPECTED: def("MASTER_REGISTER_GOVERNANCE", "A specific Master Register event was inspected."),
  MASTER_REGISTER_EXPORT_CREATED: def("MASTER_REGISTER_GOVERNANCE", "An export of Master Register data was created."),
  MASTER_REGISTER_EXPORT_DELIVERED: def("MASTER_REGISTER_GOVERNANCE", "A Master Register export was delivered to its recipient."),
  MASTER_REGISTER_INTEGRITY_VERIFIED: def("MASTER_REGISTER_GOVERNANCE", "A Master Register integrity verification ran and passed."),
  MASTER_REGISTER_INTEGRITY_FAILURE_DETECTED: def("MASTER_REGISTER_GOVERNANCE", "A Master Register integrity verification detected a failure."),
  MASTER_REGISTER_GOVERNANCE_CHANGED: def("MASTER_REGISTER_GOVERNANCE", "A Master Register governance setting (retention, access classification, etc.) changed."),
};

export class UnregisteredEventTypeError extends Error {
  constructor(eventType: string) {
    super(`"${eventType}" is not a registered Master Register event type.`);
    this.name = "UnregisteredEventTypeError";
  }
}

/** The only place event family is ever derived. Throws for any eventType not in the registry — callers never supply family directly. */
export function resolveEventFamily(eventType: string): EventFamilyName {
  const definition = EVENT_TYPE_REGISTRY[eventType];
  if (!definition) {
    throw new UnregisteredEventTypeError(eventType);
  }
  return definition.family;
}

export function getEventTypeDefinition(eventType: string): EventTypeDefinition {
  const definition = EVENT_TYPE_REGISTRY[eventType];
  if (!definition) {
    throw new UnregisteredEventTypeError(eventType);
  }
  return definition;
}

export function isRegisteredEventType(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPE_REGISTRY, eventType);
}
