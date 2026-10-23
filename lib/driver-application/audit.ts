import "server-only"
import type { PoolClient } from "pg"
import type { ApplicantSession } from "@/lib/auth/tes-applicant-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import { recordEvent } from "@/lib/master-register/record-event"

/**
 * Master Register events for an APPLICANT's own material actions. The actor is the applicant's own per-invitation actor (never a shared one), the
 * company is the application's, and the database accepts nothing else (policy master_register_applicant_insert). Values are references and hashes,
 * never personal data or sensitive identifiers.
 */
export async function recordApplicantEvent(
  client: PoolClient,
  session: ApplicantSession,
  input: {
    eventType: "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_LINK_ESTABLISHED"
    operation: string
    resourceType: string
    resourceId: string
    field: string
    after: { kind: "LITERAL"; value: string | number | boolean | null } | { kind: "REFERENCE"; reference: string } | { kind: "HASH"; algorithm: "SHA-256"; value: string }
    subjects?: string[]
  },
) {
  await recordEvent(new PostgresMasterRegisterRepository(client), {
    eventType: input.eventType,
    actor: { actorType: "HUMAN", actorId: session.actorId },
    action: { operation: input.operation },
    target: { resourceType: input.resourceType, resourceId: input.resourceId, companyId: session.organizationId, subjectReferences: [`organization:${session.organizationId}`, `application:${session.applicationId}`, ...(input.subjects ?? [])] },
    source: { sourceType: "APPLICATION", component: "driver-application", workflow: input.operation },
    classification: { materiality: "MATERIAL", sensitivity: "CONFIDENTIAL" },
    change: { changedFields: [input.field], fieldChanges: [{ field: input.field, after: input.after }] },
    outcome: { result: "SUCCESS" },
  } as never)
}
