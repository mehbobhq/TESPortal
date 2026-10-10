/**
 * SQL for TES authorization decisions.
 *
 * One definition of "an effective authorization path" is shared by the
 * authorization evaluator and accessible-customer discovery, so "may this actor
 * open customer X" and "which customers may this actor open" can never disagree.
 *
 * Effective-time rules (all evaluated on DATABASE time, never the application
 * clock, so clock skew cannot matter and the comparison matches the
 * `DEFAULT now()` that wrote the rows):
 *
 *   a row is usable at T  <=>  status = 'active'
 *                              AND start <= T                      (start inclusive)
 *                              AND (end IS NULL OR end > T)        (end exclusive)
 *
 * applied to actor_relationships and relationship_assignments (starts_at/ends_at),
 * relationship_capability_grants (granted_at/ended_at) and master_account_authority
 * (designated_at/ended_at). Note the schema only allows an end timestamp on an
 * 'ended' row, so the end clause is defence in depth today; the start clause is
 * what rejects future-dated rows.
 *
 * T defaults to statement_timestamp(), not now(): under READ COMMITTED a request
 * whose transaction began just before a row was committed would otherwise see a
 * row whose start is later than its own now() and wrongly treat it as future.
 *
 * SYSTEM scope additionally requires a TES_STAFF relationship. A CUSTOMER_USER or
 * DRIVER relationship can never exercise SYSTEM authority, even if a SYSTEM
 * assignment and grant row exist for it.
 *
 * Parameters (positional):
 *   $1  actor id (uuid)
 *   $2  capability code
 *   $3  customer id (uuid) - authorization decision for CUSTOMER scope only
 *
 * This module intentionally does not import "server-only": it is pure string
 * construction and must be importable by tests.
 */

/** Database-time default for the evaluation instant. */
export const DEFAULT_AS_OF_SQL = "statement_timestamp()"

// The evaluation instant is interpolated into SQL text, so it may only ever be the
// database clock or an explicit ISO timestamp literal (used by boundary tests).
const AS_OF_SQL_PATTERN =
  /^(?:statement_timestamp\(\)|'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})'::timestamptz)$/

function assertSafeAsOfSql(asOfSql: string): string {
  if (!AS_OF_SQL_PATTERN.test(asOfSql)) {
    throw new Error("Unsafe authorization evaluation instant.")
  }
  return asOfSql
}

function activeWindow(
  alias: string,
  startColumn: string,
  endColumn: string,
  asOfSql: string,
): string {
  return `${alias}.status = 'active'
        AND ${alias}.${startColumn} <= ${asOfSql}
        AND (${alias}.${endColumn} IS NULL OR ${alias}.${endColumn} > ${asOfSql})`
}

/** Master Account authority: an active, effective designation for the actor ($1). */
export function masterAccountSql(asOfSql: string = DEFAULT_AS_OF_SQL): string {
  const asOf = assertSafeAsOfSql(asOfSql)
  return `SELECT EXISTS (
       SELECT 1
       FROM public.master_account_authority AS maa
       WHERE maa.actor_id = $1
         AND ${activeWindow("maa", "designated_at", "ended_at", asOf)}
     ) AS is_master_account`
}

type PathOptions = {
  scope: "SYSTEM" | "CUSTOMER"
  /** true: restrict to the customer in $3. false: any customer (discovery). */
  customerFilter: boolean
  asOfSql?: string
}

/**
 * The effective authorization path join, for actor $1 and capability $2.
 * A broad grant (assignment_id IS NULL) applies only through an effective
 * assignment of its own relationship; an assignment-specific grant must point at
 * that exact assignment, so a grant can never borrow another relationship's or
 * another assignment's scope.
 */
export function authorizationPathsSql(options: PathOptions): string {
  const asOf = assertSafeAsOfSql(options.asOfSql ?? DEFAULT_AS_OF_SQL)

  const scopePredicate =
    options.scope === "SYSTEM"
      ? `ra.scope_type = 'SYSTEM'
        AND ra.customer_id IS NULL
        AND ar.relationship_type = 'TES_STAFF'`
      : options.customerFilter
        ? `ra.scope_type = 'CUSTOMER'
        AND ra.customer_id = $3::uuid`
        : `ra.scope_type = 'CUSTOMER'
        AND ra.customer_id IS NOT NULL`

  return `FROM public.actor_relationships AS ar
       INNER JOIN public.relationship_assignments AS ra
         ON ra.relationship_id = ar.id
        AND ${activeWindow("ra", "starts_at", "ends_at", asOf)}
        AND ${scopePredicate}
       INNER JOIN public.relationship_capability_grants AS rcg
         ON rcg.relationship_id = ar.id
        AND ${activeWindow("rcg", "granted_at", "ended_at", asOf)}
        AND (
          rcg.assignment_id IS NULL
          OR rcg.assignment_id = ra.id
        )
       INNER JOIN public.capabilities AS c
         ON c.id = rcg.capability_id
        AND c.is_active = true
        AND c.code = $2
       WHERE ar.actor_id = $1
         AND ${activeWindow("ar", "starts_at", "ends_at", asOf)}`
}

/**
 * One round trip that answers: is the capability known, is it active, and is the
 * actor (ignoring Master Account) allowed in this scope. Master Account still
 * needs the first two to be true; it is never allowed a nonexistent capability.
 */
export function authorizationDecisionSql(
  scope: "SYSTEM" | "CUSTOMER",
  asOfSql: string = DEFAULT_AS_OF_SQL,
): string {
  // CUSTOMER scope also reports whether the customer exists, so Master Account
  // (which is authorized before relationship evaluation) can never "open" a
  // customer that does not exist. SYSTEM scope has no customer.
  const customerExists =
    scope === "CUSTOMER"
      ? `
       EXISTS (SELECT 1 FROM public.customers WHERE id = $3::uuid) AS customer_exists,`
      : `
       true AS customer_exists,`

  return `SELECT
       EXISTS (SELECT 1 FROM public.capabilities WHERE code = $2) AS capability_known,
       EXISTS (SELECT 1 FROM public.capabilities WHERE code = $2 AND is_active = true) AS capability_active,${customerExists}
       EXISTS (
         SELECT 1
         ${authorizationPathsSql({ scope, customerFilter: scope === "CUSTOMER", asOfSql })}
       ) AS allowed`
}

/**
 * Customers an ordinary actor can open for capability $2 under CUSTOMER scope,
 * with just enough organization detail for a switcher. Distinct, so duplicate
 * paths (broad plus specific grants, several relationships) yield one row.
 * $3 is a defensive row cap.
 */
export function accessibleCustomersSql(asOfSql: string = DEFAULT_AS_OF_SQL): string {
  return `WITH accessible AS (
       SELECT DISTINCT ra.customer_id
       ${authorizationPathsSql({ scope: "CUSTOMER", customerFilter: false, asOfSql })}
     )
     SELECT
       cu.id AS customer_id,
       o.id AS organization_id,
       o.legal_name,
       o.display_name,
       o.status AS organization_status
     FROM accessible AS a
     INNER JOIN public.customers AS cu ON cu.id = a.customer_id
     INNER JOIN public.organizations AS o ON o.id = cu.organization_id
     ORDER BY lower(coalesce(o.display_name, o.legal_name)), cu.id
     LIMIT $3`
}
