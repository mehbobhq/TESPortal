import test from "node:test";
import assert from "node:assert/strict";

import {
  CATALOGUE_VERSION,
  EVENT_FAMILIES,
  EVENT_TYPE_REGISTRY,
  UnregisteredEventTypeError,
  isRegisteredEventType,
  resolveEventFamily,
} from "../../../lib/master-register/event-types.ts";

/**
 * The exact Catalogue Version 1 baseline, mirrored here as the test's own
 * source of truth (not imported from the registry) so a test can actually
 * catch the registry silently drifting from what was specified, rather than
 * just re-asserting whatever the registry happens to contain.
 */
const EXPECTED_CATALOGUE: Record<string, string[]> = {
  AUTHENTICATION: [
    "SIGN_IN_ATTEMPTED",
    "MFA_CHALLENGE_ISSUED",
    "MFA_CHALLENGE_RESPONDED",
    "SESSION_CREATED",
    "SESSION_TERMINATED",
    "SESSION_EXPIRED",
    "SESSION_REVOKED",
    "PASSWORD_CHANGE_ATTEMPTED",
    "PASSWORD_RESET_REQUESTED",
    "PASSWORD_RESET_CHALLENGE_RESPONDED",
    "REAUTHENTICATION_REQUESTED",
    "REAUTHENTICATION_RESPONDED",
    "IDENTITY_VERIFICATION_ATTEMPTED",
  ],
  ACCESS: [
    "RESOURCE_ACCESS_ATTEMPTED",
    "RECORD_VIEWED",
    "DOCUMENT_VIEWED",
    "SENSITIVE_DATA_REVEALED",
    "PROTECTED_SEARCH_EXECUTED",
    "DOCUMENT_DOWNLOADED",
    "DATA_EXPORTED",
    "PRINT_REQUESTED",
  ],
  RECORD_DATA: [
    "RECORD_CREATED",
    "RECORD_UPDATED",
    "RECORD_CORRECTED",
    "RECORD_ARCHIVED",
    "RECORD_RESTORED",
    "RECORD_STATUS_CHANGED",
    "RECORD_LINK_ESTABLISHED",
    "RECORD_LINK_REMOVED",
  ],
  DOCUMENT_EVIDENCE: [
    "DOCUMENT_INGESTED",
    "DOCUMENT_GENERATED",
    "DOCUMENT_CLASSIFICATION_CONFIRMED",
    "DOCUMENT_CLASSIFICATION_CHANGED",
    "EVIDENCE_ASSOCIATED",
    "EVIDENCE_ASSOCIATION_REMOVED",
    "DOCUMENT_SUPERSEDED",
    "DOCUMENT_ARCHIVED",
    "DOCUMENT_RESTORED",
  ],
  OCR_DOCUMENT_PROCESSING: [
    "PROCESSING_STARTED",
    "SOURCE_SEGMENTATION_COMPLETED",
    "MACHINE_CLASSIFICATION_COMPLETED",
    "OCR_PROCESSING_COMPLETED",
    "FIELD_EXTRACTION_COMPLETED",
    "PROCESSING_NORMALIZATION_COMPLETED",
    "PROCESSING_RETRY_INITIATED",
    "PROCESSING_FAILED",
    "PROCESSING_OUTPUT_CORRECTED",
    "PROCESSING_OUTPUT_INVALIDATED",
  ],
  ENTITY_RESOLUTION: [
    "ENTITY_RESOLUTION_COMPLETED",
    "ENTITY_IDENTITY_CONFLICT_DETECTED",
    "ENTITY_DUPLICATE_CANDIDATES_DETECTED",
    "ENTITY_RESOLUTION_CORRECTED",
    "ENTITY_RESOLUTION_INVALIDATED",
  ],
  VALIDATION: ["VALIDATION_COMPLETED", "VALIDATION_RESULT_INVALIDATED"],
  COMPLIANCE: [
    "COMPLIANCE_ASSESSMENT_COMPLETED",
    "COMPLIANCE_APPLICABILITY_DETERMINED",
    "COMPLIANCE_REQUIREMENT_ASSESSED",
    "COMPLIANCE_STATUS_CHANGED",
    "COMPLIANCE_DEADLINE_ESTABLISHED",
    "COMPLIANCE_SUBMISSION_RECORDED",
    "REGULATORY_OUTCOME_RECORDED",
  ],
  WORKFLOW: [
    "WORKFLOW_STARTED",
    "WORKFLOW_STAGE_CHANGED",
    "WORKFLOW_BLOCKED",
    "WORKFLOW_RESUMED",
    "WORKFLOW_COMPLETED",
    "WORKFLOW_CANCELLED",
    "WORKFLOW_REOPENED",
  ],
  REVIEW_APPROVAL: [
    "REVIEW_STARTED",
    "REVIEW_COMPLETED",
    "REVIEW_DECISION_RECORDED",
    "APPROVAL_DECISION_RECORDED",
    "ACKNOWLEDGEMENT_RECORDED",
    "REVIEW_REOPENED",
  ],
  ASSIGNMENT: ["ASSIGNMENT_CREATED", "ASSIGNMENT_ACCEPTED", "ASSIGNMENT_REASSIGNED", "ASSIGNMENT_RELEASED", "ASSIGNMENT_ESCALATED"],
  COMMUNICATION_NOTIFICATION: ["COMMUNICATION_SENT", "COMMUNICATION_RECEIVED", "NOTIFICATION_CREATED", "NOTIFICATION_DELIVERY_RECORDED"],
  SECURITY: [
    "SECURITY_ANOMALY_DETECTED",
    "AUTHORIZATION_CONTRADICTION_DETECTED",
    "SECURITY_ALERT_CREATED",
    "SECURITY_SCOPE_CONTAINED",
    "SECURITY_CONTAINMENT_RELEASED",
    "SECURITY_INCIDENT_DECLARED",
  ],
  ADMINISTRATION: [
    "ACCOUNT_CREATED",
    "ACCOUNT_STATUS_CHANGED",
    "CAPABILITY_GRANTED",
    "CAPABILITY_REVOKED",
    "ACCESS_GRANT_CREATED",
    "ACCESS_GRANT_CHANGED",
    "ACCESS_GRANT_REVOKED",
    "ADMINISTRATIVE_RESTRICTION_APPLIED",
    "ADMINISTRATIVE_RESTRICTION_RELEASED",
  ],
  CONFIGURATION: ["CONFIGURATION_CREATED", "CONFIGURATION_CHANGED", "CONFIGURATION_ACTIVATED", "CONFIGURATION_DEACTIVATED"],
  ORGANIZATIONAL: [
    "ORGANIZATION_CREATED",
    "ORGANIZATION_STATUS_CHANGED",
    "ORGANIZATIONAL_MEMBERSHIP_ESTABLISHED",
    "ORGANIZATIONAL_MEMBERSHIP_CHANGED",
    "ORGANIZATIONAL_MEMBERSHIP_ENDED",
    "ORGANIZATIONAL_RELATIONSHIP_ESTABLISHED",
    "ORGANIZATIONAL_RELATIONSHIP_CHANGED",
    "ORGANIZATIONAL_RELATIONSHIP_ENDED",
  ],
  INTEGRATION_API: [
    "INTEGRATION_CONNECTED",
    "INTEGRATION_CONNECTION_STATUS_CHANGED",
    "INTEGRATION_DISCONNECTED",
    "INTEGRATION_OPERATION_STARTED",
    "INTEGRATION_OPERATION_COMPLETED",
    "INTEGRATION_OPERATION_FAILED",
    "INTEGRATION_OPERATION_RETRIED",
    "INTEGRATION_ITEM_FAILED",
    "INTEGRATION_SYNC_COMPLETED",
  ],
  SYSTEM_AUTOMATION: [
    "AUTOMATION_EXECUTION_STARTED",
    "AUTOMATION_EXECUTION_COMPLETED",
    "AUTOMATION_EXECUTION_FAILED",
    "AUTOMATION_EXECUTION_RETRIED",
    "AUTOMATION_EXPECTED_EXECUTION_MISSED",
    "AUTOMATION_SUSPENDED",
    "AUTOMATION_RESUMED",
    "SYSTEM_OPERATIONAL_STATE_CHANGED",
  ],
  INVESTIGATION: [
    "INVESTIGATION_OPENED",
    "INVESTIGATION_SCOPE_CHANGED",
    "INVESTIGATION_EVIDENCE_ADDED",
    "INVESTIGATION_FINDING_RECORDED",
    "INVESTIGATION_DISPOSITION_RECORDED",
    "INVESTIGATION_CLOSED",
    "INVESTIGATION_REOPENED",
  ],
  MASTER_REGISTER_GOVERNANCE: [
    "MASTER_REGISTER_ACCESSED",
    "MASTER_REGISTER_QUERY_EXECUTED",
    "MASTER_REGISTER_EVENT_INSPECTED",
    "MASTER_REGISTER_EXPORT_CREATED",
    "MASTER_REGISTER_EXPORT_DELIVERED",
    "MASTER_REGISTER_INTEGRITY_VERIFIED",
    "MASTER_REGISTER_INTEGRITY_FAILURE_DETECTED",
    "MASTER_REGISTER_GOVERNANCE_CHANGED",
  ],
};

const EXPECTED_FAMILY_COUNTS: Record<string, number> = Object.fromEntries(
  Object.entries(EXPECTED_CATALOGUE).map(([family, types]) => [family, types.length]),
);

// The total is derived by summing the lists above, never a hardcoded number.
const EXPECTED_TOTAL = Object.values(EXPECTED_CATALOGUE).reduce((sum, types) => sum + types.length, 0);

test("every event type in the Catalogue Version 1 baseline is registered under its specified family", () => {
  for (const [family, eventTypes] of Object.entries(EXPECTED_CATALOGUE)) {
    for (const eventType of eventTypes) {
      assert.ok(isRegisteredEventType(eventType), `expected ${eventType} to be registered`);
      assert.equal(resolveEventFamily(eventType), family, `expected ${eventType} to belong to ${family}`);
    }
  }
});

test("no stale/replaced provisional event type remains in the registry unless it is part of the current catalogue", () => {
  const allowed = new Set(Object.values(EXPECTED_CATALOGUE).flat());
  const registered = Object.keys(EVENT_TYPE_REGISTRY);
  const unexpected = registered.filter((eventType) => !allowed.has(eventType));
  assert.deepEqual(unexpected, [], `unexpected event types found in registry: ${unexpected.join(", ")}`);
});

test("every registered event type maps to exactly one, recognized family", () => {
  const familyNames = new Set(Object.values(EVENT_FAMILIES).map((f) => f.name));
  for (const [eventType, definition] of Object.entries(EVENT_TYPE_REGISTRY)) {
    assert.ok(familyNames.has(definition.family), `${eventType} declares unknown family "${definition.family}"`);
    assert.equal(resolveEventFamily(eventType), definition.family);
  }
});

test("each family's registered event count matches the Catalogue Version 1 baseline exactly", () => {
  const actualCounts: Record<string, number> = {};
  for (const definition of Object.values(EVENT_TYPE_REGISTRY)) {
    actualCounts[definition.family] = (actualCounts[definition.family] ?? 0) + 1;
  }
  assert.deepEqual(actualCounts, EXPECTED_FAMILY_COUNTS);
});

test("Family 01 (AUTHENTICATION) count is 13", () => {
  assert.equal(EXPECTED_FAMILY_COUNTS.AUTHENTICATION, 13);
});

test("Family 02 (ACCESS) count is 8", () => {
  assert.equal(EXPECTED_FAMILY_COUNTS.ACCESS, 8);
});

test("total catalogue count is calculated from the registry and matches the Catalogue Version 1 baseline", () => {
  assert.equal(Object.keys(EVENT_TYPE_REGISTRY).length, EXPECTED_TOTAL);
});

test("unknown event type is rejected", () => {
  assert.throws(() => resolveEventFamily("NOT_A_REAL_EVENT_TYPE"), UnregisteredEventTypeError);
  assert.equal(isRegisteredEventType("NOT_A_REAL_EVENT_TYPE"), false);
});

test("MASTER_REGISTER_EVENT_INSPECTED belongs to Family 20 (MASTER_REGISTER_GOVERNANCE)", () => {
  assert.equal(resolveEventFamily("MASTER_REGISTER_EVENT_INSPECTED"), "MASTER_REGISTER_GOVERNANCE");
});

test("COMPLIANCE_ASSESSMENT_COMPLETED belongs to Family 08 (COMPLIANCE)", () => {
  assert.equal(resolveEventFamily("COMPLIANCE_ASSESSMENT_COMPLETED"), "COMPLIANCE");
});

test("INVESTIGATION remains an independent family from SECURITY - no security event type is itself an investigation type", () => {
  assert.equal(resolveEventFamily("SECURITY_ANOMALY_DETECTED"), "SECURITY");
  assert.equal(resolveEventFamily("SECURITY_INCIDENT_DECLARED"), "SECURITY");
  for (const investigationType of EXPECTED_CATALOGUE.INVESTIGATION!) {
    assert.notEqual(resolveEventFamily(investigationType), "SECURITY");
  }
  for (const securityType of EXPECTED_CATALOGUE.SECURITY!) {
    assert.notEqual(resolveEventFamily(securityType), "INVESTIGATION");
  }
});

test("family registry is versioned, and the catalogue carries its own version number", () => {
  assert.equal(typeof CATALOGUE_VERSION, "number");
  assert.ok(CATALOGUE_VERSION >= 1);
  for (const definition of Object.values(EVENT_TYPE_REGISTRY)) {
    assert.equal(typeof definition.schemaVersion, "number");
    assert.ok(definition.schemaVersion >= 1);
  }
});

test("historical event type strings are stable within the catalogue version (registry keys are exactly their own event type strings)", () => {
  for (const eventType of Object.keys(EVENT_TYPE_REGISTRY)) {
    assert.equal(resolveEventFamily(eventType), EVENT_TYPE_REGISTRY[eventType]!.family);
  }
});
