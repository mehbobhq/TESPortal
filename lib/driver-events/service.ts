import "server-only"
import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { recordEvent } from "@/lib/master-register/record-event"
import { DriverEventNotFoundError, DriverEventStateError, DriverEventValidationError } from "./errors"
import { requireAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { enterSystemCapability } from "@/lib/company-directory/capability-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as ops from "./operations"
import type { EventInput } from "./validation"

const context = (client: PoolClient, decision: SystemAuthorizationDecision): ops.EventContext => ({
  client,
  actor: { id: decision.actor.id, actorType: decision.actor.actorType },
  masterRegister: new PostgresMasterRegisterRepository(client),
})

const manage = <T>(work: (ctx: ops.EventContext) => Promise<T>) => withAuthorizedSystem("DRIVER_EVENT_MANAGE", (c, d) => work(context(c, d)))
const read = <T>(work: (ctx: ops.EventContext) => Promise<T>) => withAuthorizedSystem("DRIVER_EVENT_READ", (c, d) => work(context(c, d)))

export const createEvent = (organizationId: string, input: EventInput) => manage((ctx) => ops.createEvent(ctx, organizationId, input))
export const reviseEvent = (organizationId: string, eventId: string, input: { expectedVersion: number; event: EventInput; reason?: string | null }) => manage((ctx) => ops.reviseEvent(ctx, organizationId, eventId, input))
export const changeEventStatus = (organizationId: string, eventId: string, input: { to: string; reason?: string | null }) => manage((ctx) => ops.changeStatus(ctx, organizationId, eventId, input))
export const linkEventEvidence = (organizationId: string, eventId: string, input: { documentId: string; role: string; note?: string | null }) => manage((ctx) => ops.linkEvidence(ctx, organizationId, eventId, input))
export const verifyEventEvidence = (organizationId: string, eventId: string, linkId: string, input: { decision: string; note?: string | null }) => manage((ctx) => ops.verifyEvidence(ctx, organizationId, eventId, linkId, input))
export const unlinkEventEvidence = (organizationId: string, eventId: string, linkId: string, input: { reason: string }) => manage((ctx) => ops.unlinkEvidence(ctx, organizationId, eventId, linkId, input))
export const addEventRelationship = (organizationId: string, eventId: string, input: Parameters<typeof ops.addRelationship>[3]) => manage((ctx) => ops.addRelationship(ctx, organizationId, eventId, input))
export const removeEventRelationship = (organizationId: string, eventId: string, relationshipId: string, input: { reason: string }) => manage((ctx) => ops.removeRelationship(ctx, organizationId, eventId, relationshipId, input))
export const recordEventConsequence = (organizationId: string, eventId: string, input: ops.ConsequenceInput) => manage((ctx) => ops.recordConsequence(ctx, organizationId, eventId, input))
export const addEventAction = (organizationId: string, eventId: string, input: Parameters<typeof ops.addAction>[3]) => manage((ctx) => ops.addAction(ctx, organizationId, eventId, input))
export const updateEventAction = (organizationId: string, eventId: string, actionId: string, input: Parameters<typeof ops.updateAction>[4]) => manage((ctx) => ops.updateAction(ctx, organizationId, eventId, actionId, input))
export const issueEventRestriction = (organizationId: string, eventId: string, input: Parameters<typeof ops.issueRestriction>[3]) => manage((ctx) => ops.issueRestriction(ctx, organizationId, eventId, input))

/** Releasing a safety restriction needs the DEDICATED release capability (and the manage capability for the surrounding history). */
export async function releaseEventRestriction(organizationId: string, eventId: string, restrictionId: string, input: Parameters<typeof ops.releaseRestriction>[4], requestId?: string | null) {
  try {
    return await withAuthorizedSystem("DRIVER_EVENT_SAFETY_RELEASE", async (client, decision) => {
      await requireAdditionalSystemCapability(client, decision, "DRIVER_EVENT_MANAGE")
      return ops.releaseRestriction(context(client, decision), organizationId, eventId, restrictionId, input, {
        enterRelease: () => enterSystemCapability(client, "DRIVER_EVENT_SAFETY_RELEASE"),
        enterManage: () => enterSystemCapability(client, "DRIVER_EVENT_MANAGE"),
      })
    })
  } catch (error) {
    // The business transaction has rolled back, so the restriction is untouched. The refusal is recorded in a SEPARATE transaction; recording can never change the outcome.
    const reasonCode = releaseDenialCode(error)
    if (reasonCode) await recordReleaseDenial({ organizationId, eventId, restrictionId, reasonCode, requestId })
    throw error
  }
}

/** Recognised by name, as the API layer does (lib/api/canonical-response.ts): only lib/auth may import the authorization modules. */
const isAuthorizationDenied = (error: unknown) => error instanceof Error && error.name === "TesAuthorizationDeniedError"

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A fixed reason code for a refusal that is a DENIAL (never a server fault, never free text). */
export function releaseDenialCode(error: unknown): string | null {
  if (isAuthorizationDenied(error)) return "CAPABILITY_DENIED"
  if (error instanceof DriverEventStateError) return error.code ?? "STATE_REFUSED"
  if (error instanceof DriverEventValidationError) return error.field === "evidenceDocumentId" ? "RELEASE_DOCUMENT_REQUIRED" : "INVALID_REQUEST"
  if (error instanceof DriverEventNotFoundError) return "NOT_FOUND"
  return null
}

/**
 * Appends a Master Register RESOURCE_ACCESS_ATTEMPTED event (outcome FAILURE, a fixed reason code) for a refused release, in its own transaction, as the strongest SYSTEM
 * capability the actor actually holds (release, then manage, then read; an actor holding none cannot write the register and is covered by the structured log line only).
 * Identifiers are recorded exactly as submitted and are never looked up, so the record (system-readable only) discloses nothing about any company; the caller still sees only the
 * original refusal. No evidence content, document id or secret is recorded. A failure here is logged and swallowed: it must never turn a denial into a release.
 */
async function recordReleaseDenial(a: { organizationId: string; eventId: string; restrictionId: string; reasonCode: string; requestId?: string | null }) {
  const submitted = (v: string) => (UUID_SHAPE.test(v) ? v.toLowerCase() : "INVALID_IDENTIFIER")
  const org = submitted(a.organizationId), event = submitted(a.eventId), restriction = submitted(String(a.restrictionId))
  const request = a.requestId && /^[A-Za-z0-9._-]{1,64}$/.test(a.requestId) ? a.requestId : randomUUID()
  console.warn(JSON.stringify({ level: "WARNING", message: "driver event safety release refused", organizationId: org, eventId: event, restrictionId: restriction, reasonCode: a.reasonCode, requestId: request }))
  for (const capability of ["DRIVER_EVENT_SAFETY_RELEASE", "DRIVER_EVENT_MANAGE", "DRIVER_EVENT_READ"] as const) {
    try {
      await withAuthorizedSystem(capability, async (client, decision) => {
        await recordEvent(new PostgresMasterRegisterRepository(client), {
          eventType: "RESOURCE_ACCESS_ATTEMPTED",
          actor: { actorType: decision.actor.actorType, actorId: decision.actor.id },
          action: { operation: "driver-event-safety-release-refused" },
          target: { resourceType: "driver_event_restriction", resourceId: restriction, subjectReferences: [`organization:${org}`, `driver_event:${event}`] },
          source: { sourceType: "APPLICATION", component: "driver-events", workflow: "driver-event-safety-release", requestId: request },
          classification: { materiality: "MATERIAL" },
          outcome: { result: "FAILURE", reasonCode: a.reasonCode },
        } as never)
      })
      return
    } catch (error) {
      if (isAuthorizationDenied(error)) continue // the actor does not hold this capability: try the next
      console.error(JSON.stringify({ level: "ERROR", message: "driver event safety release refusal could not be recorded", requestId: request }))
      return
    }
  }
}

export const getEvent = (organizationId: string, eventId: string) => read((ctx) => ops.getEvent(ctx, organizationId, eventId))
export const getEventVersion = (organizationId: string, eventId: string, version: number) => read((ctx) => ops.getVersion(ctx, organizationId, eventId, version))
export const listEvents = (organizationId: string, filters: ops.ListFilters) => read((ctx) => ops.listEvents(ctx, organizationId, filters))
export const listEventFacts = (organizationId: string, filters: Parameters<typeof ops.listFacts>[2]) => read((ctx) => ops.listFacts(ctx, organizationId, filters))
export const findEventDuplicates = (organizationId: string, eventId: string) =>
  read(async (ctx) => {
    const { event } = await ops.getEvent(ctx, organizationId, eventId)
    const e = event as { category_code: string; occurred_at: string | null; occurred_local_date: Date | string | null; driver_relationship_id: string | null; vehicle_relationship_id: string | null }
    const day = e.occurred_local_date as string | null // already text (YYYY-MM-DD) from getEvent
    return ops.findPossibleDuplicates(ctx, organizationId, { categoryCode: e.category_code, occurredAt: e.occurred_at, occurredLocalDate: day, driverRelationshipId: e.driver_relationship_id, vehicleRelationshipId: e.vehicle_relationship_id }, eventId)
  })
export const listActiveEventRestrictions = (organizationId: string, subject: Parameters<typeof ops.listActiveRestrictions>[2]) => read((ctx) => ops.listActiveRestrictions(ctx, organizationId, subject))
