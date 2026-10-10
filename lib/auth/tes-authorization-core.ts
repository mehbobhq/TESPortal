/**
 * TES authorization core: pure database evaluation, no Clerk and no connection
 * management.
 *
 * Everything here takes an already-resolved actor and a database handle, so the
 * decision logic is testable against a real PostgreSQL without Clerk. Application
 * code must not import this module directly: it uses lib/auth/tes-authorization.ts
 * and the withAuthorized* wrappers, which resolve the actor from the authenticated
 * session and keep authorization and work on one transaction.
 *
 * Like lib/master-register/record-event.ts, this module does not import
 * "server-only" (the package throws under plain Node, which the test suite uses);
 * the server-only boundary is the entry modules that wrap it.
 */

import type { Pool, PoolClient } from "pg"
import type { TesActor } from "@/lib/auth/tes-actor"
import {
  accessibleCustomersSql,
  authorizationDecisionSql,
  masterAccountSql,
} from "@/lib/auth/tes-authorization-sql"
import {
  isTesCapability,
  tesCapabilityScope,
  type TesCapability,
  type TesCustomerCapability,
} from "@/lib/auth/tes-capabilities"

export type TesAuthorizationScope =
  | { type: "SYSTEM" }
  | { type: "CUSTOMER"; customerId: string }

export type TesAuthorizationRequest = {
  capability: TesCapability
  scope: TesAuthorizationScope
}

export type TesAuthorizationPrincipal = {
  actor: TesActor
  isMasterAccount: boolean
}

export type TesAuthorizationDecision<
  S extends TesAuthorizationScope = TesAuthorizationScope,
> = TesAuthorizationPrincipal & {
  allowed: true
  capability: TesCapability
  scope: S
}

export class TesAuthorizationDeniedError extends Error {
  readonly code = "TES_AUTHORIZATION_DENIED"

  constructor() {
    super("TES authorization denied.")
    this.name = "TesAuthorizationDeniedError"
  }
}

/**
 * The server asked for a capability that is not a real, known capability: a typo,
 * or code and the PostgreSQL catalogue have drifted. This is a server defect, not
 * an authorization outcome, so it is a distinct error (map to a 500 and log it) and
 * it applies to Master Account exactly as to everyone else.
 */
export class TesUnknownCapabilityError extends Error {
  readonly code = "TES_CAPABILITY_UNKNOWN"

  constructor() {
    super("TES capability is unknown.")
    this.name = "TesUnknownCapabilityError"
  }
}

/** A capability was requested under a scope it is not defined for (a server defect). */
export class TesCapabilityScopeError extends Error {
  readonly code = "TES_CAPABILITY_SCOPE_MISMATCH"

  constructor() {
    super("TES capability was requested under the wrong scope.")
    this.name = "TesCapabilityScopeError"
  }
}

export type AuthorizationQueryable = Pick<Pool | PoolClient, "query">

// Same shape as tes_security.current_customer_id(): RFC-variant UUID, any version.
const CUSTOMER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type MasterAccountRow = { is_master_account: boolean }

export async function resolveTesAuthorizationPrincipal(
  actor: TesActor,
  database: AuthorizationQueryable,
): Promise<TesAuthorizationPrincipal> {
  const result = await database.query<MasterAccountRow>(masterAccountSql(), [
    actor.id,
  ])

  const row = result.rows[0]
  if (!row) throw new TesAuthorizationDeniedError()

  return { actor, isMasterAccount: row.is_master_account === true }
}

type DecisionRow = {
  capability_known: boolean
  capability_active: boolean
  customer_exists: boolean
  allowed: boolean
}

/**
 * Evaluates one capability in one explicit scope. Throws unless authorized.
 *
 *   1. The capability must be a code this application defines, requested under
 *      the scope it is defined for. (Programmer error otherwise.)
 *   2. It must exist in public.capabilities (else TesUnknownCapabilityError) and
 *      be active (else denied) - for Master Account too.
 *   3. Master Account is then authorization-superior and needs no relationship,
 *      assignment or grant, but a CUSTOMER request still needs a real customer.
 *   4. Everyone else is default-deny and needs an effective relationship, an
 *      effective assignment in exactly this scope, and an effective grant (see
 *      tes-authorization-sql.ts). SYSTEM additionally requires TES_STAFF.
 *
 * SYSTEM and CUSTOMER never inherit from each other.
 */
export async function evaluateTesAuthorization(
  principal: TesAuthorizationPrincipal,
  request: TesAuthorizationRequest,
  database: AuthorizationQueryable,
): Promise<TesAuthorizationDecision> {
  const { capability } = request

  if (!isTesCapability(capability)) throw new TesUnknownCapabilityError()
  if (tesCapabilityScope(capability) !== request.scope.type) {
    throw new TesCapabilityScopeError()
  }

  let scope: TesAuthorizationScope
  let parameters: [string, string] | [string, string, string]

  if (request.scope.type === "CUSTOMER") {
    const customerId = request.scope.customerId?.trim().toLowerCase()
    if (!customerId || !CUSTOMER_ID_PATTERN.test(customerId)) {
      throw new TesAuthorizationDeniedError()
    }
    scope = { type: "CUSTOMER", customerId }
    parameters = [principal.actor.id, capability, customerId]
  } else {
    scope = { type: "SYSTEM" }
    parameters = [principal.actor.id, capability]
  }

  const result = await database.query<DecisionRow>(
    authorizationDecisionSql(scope.type),
    parameters,
  )

  const row = result.rows[0]
  if (!row || row.capability_known !== true) throw new TesUnknownCapabilityError()
  if (row.capability_active !== true) throw new TesAuthorizationDeniedError()
  if (row.customer_exists !== true) throw new TesAuthorizationDeniedError()
  if (!principal.isMasterAccount && row.allowed !== true) {
    throw new TesAuthorizationDeniedError()
  }

  return { ...principal, allowed: true, capability, scope }
}

export type AccessibleCustomer = {
  customerId: string
  organizationId: string
  legalName: string
  displayName: string | null
  organizationStatus: string
}

type AccessibleCustomerRow = {
  customer_id: string
  organization_id: string
  legal_name: string
  display_name: string | null
  organization_status: string
}

/** Defensive cap; an ordinary actor's own assignments are expected to be few. */
export const ACCESSIBLE_CUSTOMERS_LIMIT = 500

/**
 * Customers an ORDINARY actor can open: derived from the actor's own effective
 * relationship, CUSTOMER-scope assignment and grant of the capability - the same
 * predicate the evaluator uses - and never from the customers table at large.
 * SYSTEM assignments and ORGANIZATION_REGISTRY_READ contribute nothing: registry
 * visibility is not tenant access.
 *
 * Master Account has no assignments and is not enumerated here; see
 * listAccessibleCustomers() in tes-accessible-customers.ts.
 */
export async function findAccessibleCustomers(
  database: AuthorizationQueryable,
  actorId: string,
  capability: TesCustomerCapability = "ORGANIZATION_READ",
): Promise<AccessibleCustomer[]> {
  if (!isTesCapability(capability)) throw new TesUnknownCapabilityError()
  if (tesCapabilityScope(capability) !== "CUSTOMER") throw new TesCapabilityScopeError()

  const result = await database.query<AccessibleCustomerRow>(
    accessibleCustomersSql(),
    [actorId, capability, ACCESSIBLE_CUSTOMERS_LIMIT],
  )

  return result.rows.map((row) => ({
    customerId: row.customer_id,
    organizationId: row.organization_id,
    legalName: row.legal_name,
    displayName: row.display_name,
    organizationStatus: row.organization_status,
  }))
}
