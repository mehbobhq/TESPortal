/**
 * Which part of migration 0036 (company change accountability) this database has. The application is deployed independently of the
 * migrations, so it must keep every ordinary company read AND edit working on a database that has not received 0036 yet, must offer the
 * 0036 features (the change ledger, the verified legal-name procedure, confirmed channel replacements) only when the WHOLE migration is
 * present, and must never treat a partly applied one as supported. (The 0035 incident came from an application that assumed its migration.)
 *
 * The runtime role cannot read the migration ledger, so the state is read from the objects 0036 creates, in one catalogue query:
 *   - the four tables, each with row-level security ENABLED and a policy,
 *   - the COMPANY_LEGAL_NAME_CHANGE capability, active.
 *   ABSENT        none of them exists: a database that has not received 0036. Edits still work and every change is still recorded in the
 *                 Master Register by its own domain; the 0036 features report "not available yet", and a sensitive replacement that would
 *                 need the confirmation workflow is REFUSED rather than applied unverified.
 *   COMPLETE      everything exists and is wired.
 *   INCONSISTENT  anything else: reads keep working, every write that would need the ledger is refused (fail closed), logged once.
 * The state is NOT cached: remembering COMPLETE would keep the features on after a later inconsistency. A genuine query error propagates.
 */
import type { PoolClient } from "pg"

export type Migration0036State = "ABSENT" | "COMPLETE" | "INCONSISTENT"

let reportedInconsistent = false

export const migration0036Message = (state: Migration0036State, what: string): string =>
  state === "INCONSISTENT"
    ? `${what} is unavailable: this database has a partly applied migration 0036. It must be repaired first. Nothing was changed.`
    : `${what} is not available yet: it needs database migration 0036, which has not been applied. Nothing was changed.`

export async function migration0036State(client: Pick<PoolClient, "query">): Promise<Migration0036State> {
  const result = await client.query<{ tables: number; wired: number; capability: number }>(
    `SELECT
       (SELECT count(*)::int FROM unnest(ARRAY['public.company_change_records', 'public.company_change_record_evidence', 'public.company_legal_name_change_requests', 'public.company_channel_change_requests']) AS t(name) WHERE to_regclass(t.name) IS NOT NULL) AS tables,
       (SELECT count(*)::int
          FROM pg_class c
         WHERE c.oid IN (to_regclass('public.company_change_records'), to_regclass('public.company_change_record_evidence'), to_regclass('public.company_legal_name_change_requests'), to_regclass('public.company_channel_change_requests'))
           AND c.relrowsecurity
           AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)) AS wired,
       (SELECT count(*)::int FROM public.capabilities WHERE code = 'COMPANY_LEGAL_NAME_CHANGE' AND is_active) AS capability`,
  )
  const row = result.rows[0]
  if (row.tables === 4 && row.wired === 4 && row.capability === 1) return "COMPLETE"
  if (row.tables === 0 && row.capability === 0) return "ABSENT"
  if (!reportedInconsistent) {
    reportedInconsistent = true
    console.error(`[company-changes] migration 0036 is partly applied (tables=${row.tables}, rls+policy=${row.wired}, capability=${row.capability}); its features are disabled and writes are refused`)
  }
  return "INCONSISTENT"
}
