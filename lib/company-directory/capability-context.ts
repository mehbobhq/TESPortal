import "server-only"

import type { PoolClient } from "pg"
import type { TesSystemCapability } from "@/lib/auth/tes-capabilities"
import { hasAdditionalSystemCapability, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"

/**
 * Several canonical domains are written or read inside ONE transaction (company creation, the profile read). Each domain's
 * row-level security accepts only its own capability, so before a domain's statements run the transaction re-proves that
 * capability for RLS on the SAME connection. It never grants anything: the actor must already hold the capability (the caller
 * checks hasAdditionalSystemCapability first, or relies on the transaction wrapper), and a denial throws.
 */
/** A submission needs capabilities beyond the one the transaction was opened with; the caller is told exactly which are missing. */
export class CompanyCreationCapabilityError extends Error {
  readonly missing: TesSystemCapability[]
  constructor(missing: TesSystemCapability[]) {
    super(`Not authorized to record every submitted field. Missing capability: ${missing.join(", ")}.`)
    this.name = "CompanyCreationCapabilityError"
    this.missing = missing
  }
}

export async function enterSystemCapability(client: PoolClient, capability: TesSystemCapability): Promise<void> {
  await client.query("SELECT set_config('tes.system_capability', $1, true)", [capability])
  const rls = await client.query<{ allowed: boolean }>("SELECT tes_security.system_context_authorized(ARRAY[$1]::text[]) AS allowed", [capability])
  if (rls.rows[0]?.allowed !== true) throw new CompanyCreationCapabilityError([capability])
}

/** An operations context whose registry-disclosure check is lazily evaluated for `registryCapability` on the same transaction. */
export function domainContext(client: PoolClient, decision: SystemAuthorizationDecision, registryCapability: TesSystemCapability) {
  let registryRead: Promise<boolean> | undefined
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
    canViewRegistry: () => (registryRead ??= hasAdditionalSystemCapability(client, decision, registryCapability)),
  }
}

/**
 * Runs the deferred integrity checks (constraint triggers that normally fire at COMMIT) NOW, while the capability of the domain
 * that just wrote is still in force. Several of them read rows through row-level security, and at COMMIT only the LAST
 * capability entered would be in force, so a check of an earlier domain would not see its own rows. Each domain block is a
 * consistent unit by itself (it is exactly what that domain commits when used alone), so checking it at its boundary is safe,
 * and nothing is skipped: every check still runs, and a failure still rolls the whole transaction back.
 */
export async function runDeferredChecks(client: PoolClient): Promise<void> {
  await client.query("SET CONSTRAINTS ALL IMMEDIATE")
  await client.query("SET CONSTRAINTS ALL DEFERRED")
}
