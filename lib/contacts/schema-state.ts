/**
 * Which part of migration 0035 this database has. The application must keep its ordinary reads working on a database that has not received
 * 0035 yet, must expose 0035's features only when the WHOLE migration is present, and must never treat a partly applied one as supported.
 *
 * The runtime role cannot read the migration ledger (tes_system.schema_migrations is not granted to it), so the state is read from the objects
 * 0035 creates, in one catalogue query:
 *   - both tables (person_birth_dates, organization_person_operational_email_exclusions), with row-level security ENABLED and a policy on each,
 *   - both capabilities (PERSON_IDENTITY_READ / PERSON_IDENTITY_MANAGE), active,
 *   - the evidence_documents(id, organization_id) unique index.
 *   ABSENT        none of those exists: a genuine 0034 schema.
 *   COMPLETE      all of them exist and are wired: the 0035 features are available.
 *   INCONSISTENT  anything else: reported as such, never as supported (features stay off, 0035-only writes are refused, no identity access is
 *                 granted). A real query / permission error is NOT interpreted here: it propagates to the caller unchanged.
 * The state is NOT cached: it is one cheap catalogue statement, and remembering a COMPLETE result would keep the features enabled after the schema
 * later became inconsistent (for example a table's row-level security switched off). Every call reads the current state, so applying 0035 takes
 * effect without a restart and a regression is detected at once.
 */
import type { PoolClient } from "pg"

export type Migration0035State = "ABSENT" | "COMPLETE" | "INCONSISTENT"

let reportedInconsistent = false

export const migration0035Message = (state: Migration0035State, what: string): string =>
  state === "INCONSISTENT"
    ? `${what} is unavailable: this database has a partly applied migration 0035. It must be repaired before ${what.toLowerCase()} can be used. Nothing was changed.`
    : `${what} is not available yet: it needs database migration 0035, which has not been applied. Nothing was changed.`

export async function migration0035State(client: Pick<PoolClient, "query">): Promise<Migration0035State> {
  const result = await client.query<{ tables: number; wired: number; caps: number; index_present: boolean }>(
    `SELECT
       (SELECT count(*)::int FROM unnest(ARRAY['public.person_birth_dates', 'public.organization_person_operational_email_exclusions']) AS t(name) WHERE to_regclass(t.name) IS NOT NULL) AS tables,
       (SELECT count(*)::int
          FROM pg_class c
         WHERE c.oid IN (to_regclass('public.person_birth_dates'), to_regclass('public.organization_person_operational_email_exclusions'))
           AND c.relrowsecurity
           AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)) AS wired,
       (SELECT count(*)::int FROM public.capabilities WHERE code IN ('PERSON_IDENTITY_READ', 'PERSON_IDENTITY_MANAGE') AND is_active) AS caps,
       (to_regclass('public.evidence_documents_id_organization_uq') IS NOT NULL) AS index_present`,
  )
  const row = result.rows[0]
  if (row.tables === 2 && row.wired === 2 && row.caps === 2 && row.index_present) {
    return "COMPLETE"
  }
  if (row.tables === 0 && row.caps === 0 && !row.index_present) return "ABSENT"
  if (!reportedInconsistent) {
    reportedInconsistent = true
    console.error(`[contacts] migration 0035 is partly applied (tables=${row.tables}, rls+policy=${row.wired}, capabilities=${row.caps}, index=${row.index_present}); its features are disabled`)
  }
  return "INCONSISTENT"
}
