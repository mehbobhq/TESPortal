import "server-only"

import type { PoolClient } from "pg"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { editPolicyRecord as applyPolicyRecordEdit } from "@/lib/insurance-workspace/edit-policy"
import type { OperationContext } from "@/lib/insurance/operations"
import type { PolicyView } from "@/lib/insurance/types"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"

/**
 * Entry point for the company Insurance workspace's composed operations. It lives beside, not inside, lib/insurance because that
 * service is pinned to exactly the designed operation list; this file adds no rule of its own. It is SYSTEM-only and checks the one
 * capability the composed operations need (INSURANCE_MANAGE) once, in the same transaction as the work (the wrapper), exactly like
 * lib/insurance/service.ts, and the collision-disclosure read check is evaluated lazily on that same transaction.
 */
function context(client: PoolClient, decision: SystemAuthorizationDecision): OperationContext {
  let readAllowed: Promise<boolean> | undefined
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
    canReadInsurance: () => (readAllowed ??= hasAdditionalSystemCapability(client, decision, "INSURANCE_READ")),
  }
}

/**
 * Edits the current term, coverage and broker of record of one policy as a CORRECTION (mistakes: the wrong rows are kept and
 * flagged) or as a real-world ENDORSEMENT / broker change (the earlier state stays as history), in ONE transaction. A refusal in
 * any step rolls the whole edit back. The insured Organization in the request must own the policy.
 */
export const editPolicyRecord = (input: unknown): Promise<PolicyView> => withAuthorizedSystem("INSURANCE_MANAGE", (client, decision) => applyPolicyRecordEdit(context(client, decision), input))
