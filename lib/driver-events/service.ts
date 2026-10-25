import "server-only"
import type { PoolClient } from "pg"
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
export const releaseEventRestriction = (organizationId: string, eventId: string, restrictionId: string, input: Parameters<typeof ops.releaseRestriction>[4]) =>
  withAuthorizedSystem("DRIVER_EVENT_SAFETY_RELEASE", async (client, decision) => {
    await requireAdditionalSystemCapability(client, decision, "DRIVER_EVENT_MANAGE")
    return ops.releaseRestriction(context(client, decision), organizationId, eventId, restrictionId, input, {
      enterRelease: () => enterSystemCapability(client, "DRIVER_EVENT_SAFETY_RELEASE"),
      enterManage: () => enterSystemCapability(client, "DRIVER_EVENT_MANAGE"),
    })
  })

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
