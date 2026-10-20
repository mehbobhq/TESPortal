import "server-only"

import { hasAdditionalSystemCapability, withAuthorizedSystem } from "@/lib/auth/tes-system-context"
import { enterSystemCapability } from "@/lib/company-directory/capability-context"
import * as contractOperations from "@/lib/contracts/operations"
import * as customerOperations from "@/lib/customer-relationship/operations"
import { CustomerRelationshipNotFoundError } from "@/lib/customer-relationship/errors"
import type { EngagementView } from "@/lib/customer-relationship/types"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"

/** The service cannot be ended from the company page right now; the message says why and what to do instead. Maps to HTTP 409. */
export class CompanyServiceStateError extends Error {
  readonly code: "SIGNED_CONTRACT_IN_FORCE" | "CONTRACT_STATE_UNVERIFIABLE"
  constructor(code: CompanyServiceStateError["code"], message: string) {
    super(message)
    this.name = "CompanyServiceStateError"
    this.code = code
  }
}

/**
 * Ends the company's OPEN customer engagement (the service) with a reason from the closed catalogue.
 *
 * A service that is governed by a SIGNED agreement is NOT ended from here: terminating or changing contracted services belongs to the
 * signed-agreement and authority model (the Service Decision Authority's written instruction, with evidence), which has no
 * termination workflow yet. So the end is refused while the current engagement has a signed contract, and it is also refused when the
 * caller cannot read contracts (the rule cannot be checked, so it fails closed). Both checks and the end run in ONE transaction, so a
 * contract cannot be signed between the check and the end. Without a signed contract (onboarding, trial, a lapsed prospect) the service
 * can be ended with a reason, exactly as before; an ended engagement is never reopened or deleted.
 */
export async function endCompanyService(organizationId: string, input: { endedAt: unknown; endReason: unknown }): Promise<EngagementView> {
  return withAuthorizedSystem("CUSTOMER_RELATIONSHIP_MANAGE", async (client, decision) => {
    const actor = { id: decision.actor.id, actorType: decision.actor.actorType }
    const ctx = { client, actor, masterRegister: new PostgresMasterRegisterRepository(client) }

    if (!(await hasAdditionalSystemCapability(client, decision, "CUSTOMER_RELATIONSHIP_READ"))) {
      throw new CompanyServiceStateError("CONTRACT_STATE_UNVERIFIABLE", "Ending a service needs permission to read the customer relationship. Nothing was changed.")
    }
    await enterSystemCapability(client, "CUSTOMER_RELATIONSHIP_READ")
    const relationship = await customerOperations.readCustomerRelationship(client, organizationId)
    const open = relationship.openEngagement
    if (!relationship.customer || !open) throw new CustomerRelationshipNotFoundError("Open engagement")

    if (!(await hasAdditionalSystemCapability(client, decision, "CONTRACT_READ"))) {
      throw new CompanyServiceStateError(
        "CONTRACT_STATE_UNVERIFIABLE",
        "Ending a service needs permission to read the company's contracts, so that a signed agreement is never overridden by accident. Nothing was changed.",
      )
    }
    await enterSystemCapability(client, "CONTRACT_READ")
    const view = await contractOperations.readContractsView(client, organizationId, relationship.customer.id)
    if (view.contracts.some((contract) => contract.contractStatus === "signed" && contract.engagementId === open.engagement.id)) {
      throw new CompanyServiceStateError(
        "SIGNED_CONTRACT_IN_FORCE",
        "This service is governed by a signed contract, so it cannot be ended from the company page. Contracted services are changed or terminated through the signed-agreement process (the Service Decision Authority's instruction with evidence). Nothing was changed.",
      )
    }

    await enterSystemCapability(client, "CUSTOMER_RELATIONSHIP_MANAGE")
    return customerOperations.endEngagement(ctx, { engagementId: open.engagement.id, endedAt: input.endedAt, endReason: input.endReason })
  })
}
