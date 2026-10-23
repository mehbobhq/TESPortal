import "server-only"
import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import type { ProspectContext } from "@/lib/driver-prospects/operations"
import * as review from "./review"

const context = (client: PoolClient, decision: SystemAuthorizationDecision): ProspectContext => ({
  client,
  actor: { id: decision.actor.id, actorType: decision.actor.actorType },
  masterRegister: new PostgresMasterRegisterRepository(client),
})

export const getApplicationReview = (input: { organizationId: string; prospectId: string }) =>
  withAuthorizedSystem("DRIVER_READ", (c, d) => review.getApplicationReview(context(c, d), d, input))
export const recordVerification = (input: Parameters<typeof review.recordVerification>[1]) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => review.recordVerification(context(c, d), input))
export const recordDecision = (input: Parameters<typeof review.recordDecision>[1]) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => review.recordDecision(context(c, d), input))
export const recordCorrection = (input: Parameters<typeof review.recordCorrection>[1]) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => review.recordCorrection(context(c, d), input))
export const revealSensitive = (input: Parameters<typeof review.revealSensitive>[2]) =>
  withAuthorizedSystem("DRIVER_READ", (c, d) => review.revealSensitive(context(c, d), d, input))
export const authorizeDocumentView = (input: Parameters<typeof review.authorizeDocumentView>[2]) =>
  withAuthorizedSystem("DRIVER_READ", (c, d) => review.authorizeDocumentView(context(c, d), d, input))
export const getHrProfile = (organizationId: string) => withAuthorizedSystem("DRIVER_READ", (c, d) => review.getHrProfile(context(c, d), organizationId))
export const saveHrProfile = (input: Parameters<typeof review.saveHrProfile>[1]) => withAuthorizedSystem("DRIVER_MANAGE", (c, d) => review.saveHrProfile(context(c, d), input))
