import "server-only"
import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as operations from "./operations"
import type { ConvertProspectInput, CreateProspectInput, InvitationDeliveryPort, ReviewTarget } from "./types"

const context = (client: PoolClient, decision: SystemAuthorizationDecision): operations.ProspectContext => ({
  client,
  actor: { id: decision.actor.id, actorType: decision.actor.actorType },
  masterRegister: new PostgresMasterRegisterRepository(client),
})

export const createProspect = (input: CreateProspectInput) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => operations.createProspect(context(c, d), d, input))
export const addProspectEmail = (input: { organizationId: string; prospectId: string; email: string }) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => operations.addProspectEmail(context(c, d), input))
export const listProspects = (organizationId: string) =>
  withAuthorizedSystem("DRIVER_READ", (c, d) => operations.listProspects(context(c, d), organizationId))
export const reviewProspect = (input: { organizationId: string; prospectId: string; to: ReviewTarget }) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => operations.reviewProspect(context(c, d), input))
export const convertProspectToCompanyDriver = (input: ConvertProspectInput) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => operations.convertProspectToCompanyDriver(context(c, d), d, input))

/**
 * Two transactions so mail is never sent for an uncommitted token and a delivery failure is still recorded:
 * (1) authorize + store the token HASH, (2) deliver, (3) record the outcome. The company comes from the path, never a body.
 */
export async function sendInvitation(input: { organizationId: string; prospectId: string; baseUrl: string; stage?: import("@/lib/driver-application/catalogue/types").Stage; supplementsApplicationId?: string }, deliver: InvitationDeliveryPort) {
  const prepared = await withAuthorizedSystem("DRIVER_MANAGE", (c, d) =>
    operations.prepareInvitation(context(c, d), d, { organizationId: input.organizationId, prospectId: input.prospectId, stage: input.stage, supplementsApplicationId: input.supplementsApplicationId }),
  )
  let outcome: { sent: true; messageId: string } | { sent: false }
  try {
    const { messageId } = await deliver({
      to: prepared.to,
      applicantName: prepared.applicantName,
      companyName: prepared.companyName,
      link: `${input.baseUrl.replace(/\/+$/, "")}/driver-application#k=${encodeURIComponent(prepared.token)}`,
      invitationId: prepared.invitationId,
      expiresAt: prepared.expiresAt,
    })
    outcome = { sent: true, messageId }
  } catch {
    outcome = { sent: false }
  }
  await withAuthorizedSystem("DRIVER_MANAGE", (c, d) =>
    operations.recordInvitationOutcome(context(c, d), { organizationId: input.organizationId, prospectId: input.prospectId, invitationId: prepared.invitationId, outcome }),
  )
  return { invitationId: prepared.invitationId, sent: outcome.sent, expiresAt: prepared.expiresAt }
}
export const getProspectSubmission = (input: { organizationId: string; prospectId: string }) =>
  withAuthorizedSystem("DRIVER_READ", (c, d) => operations.getProspectSubmission(context(c, d), input))
export const establishOperatingScope = (input: { organizationId: string; prospectId: string; scope: import("./operating-scope").ScopeInput }) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => operations.establishOperatingScope(context(c, d), input))
export const getPresentationContext = (organizationId: string) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => operations.getPresentationContext(context(c, d), d, organizationId))
export const establishPresentationJurisdiction = (input: { organizationId: string; country: unknown }) =>
  withAuthorizedSystem("DRIVER_MANAGE", (c, d) => operations.establishPresentationJurisdiction(context(c, d), d, input))
