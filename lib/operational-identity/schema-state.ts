/**
 * Which part of migration 0037 (driver identity integrity and exclusive assignment) this database has. The application is deployed
 * independently of the migrations: licence and assignment writes keep working (with the application-level checks) on a database that has not
 * received 0037, the 0037 operations (end, transfer, identity verification) are offered only when the WHOLE migration is present, and a partly
 * applied one is never treated as supported. Not cached; a genuine query error propagates. Read from the objects 0037 creates, in one catalogue
 * query (the runtime role cannot read the migration ledger).
 *   ABSENT        none of the 0037 objects exists.
 *   COMPLETE      all of them exist.
 *   INCONSISTENT  anything else: the 0037 operations are refused (fail closed).
 */
import type { PoolClient } from "pg"

export type Migration0037State = "ABSENT" | "COMPLETE" | "INCONSISTENT"

let reportedInconsistent = false

export const migration0037Message = (state: Migration0037State, what: string): string =>
  state === "INCONSISTENT"
    ? `${what} is unavailable: this database has a partly applied migration 0037. It must be repaired first. Nothing was changed.`
    : `${what} is not available yet: it needs database migration 0037, which has not been applied. Nothing was changed.`

export async function migration0037State(client: Pick<PoolClient, "query">): Promise<Migration0037State> {
  const result = await client.query<{ present: number; total: number }>(
    `WITH checks(present) AS (VALUES
       (to_regclass('public.driver_identity_verifications') IS NOT NULL),
       (to_regclass('public.organization_driver_open_assignment_uq') IS NOT NULL),
       (to_regclass('public.driver_licences_current_canonical_identity_uq') IS NOT NULL),
       (to_regclass('public.driver_licences_person_current_canonical_jurisdiction_uq') IS NOT NULL),
       (to_regprocedure('tes_security.canonical_country_code(text)') IS NOT NULL),
       (to_regprocedure('tes_security.canonical_region_code(text)') IS NOT NULL),
       (to_regprocedure('tes_security.canonical_licence_number(text)') IS NOT NULL),
       (EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.organization_driver_relationships') AND conname = 'organization_driver_assignment_no_overlap')),
       (EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.driver_licences') AND conname = 'driver_licences_canonical_identity_no_overlap')),
       (EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.driver_licences') AND tgname = 'driver_licences_canonical_identity' AND NOT tgisinternal)),
       ((SELECT count(*) = 4 FROM pg_attribute WHERE attrelid = to_regclass('public.organization_driver_relationships') AND attname IN ('activated_at', 'closed_at', 'end_reason', 'transfer_id') AND NOT attisdropped)),
       (EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.driver_identity_verifications') AND c.relrowsecurity)
         AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public.driver_identity_verifications'))),
       (EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'DRIVER_IDENTITY_VERIFY' AND is_active))
     )
     SELECT count(*) FILTER (WHERE present)::int AS present, count(*)::int AS total FROM checks`,
  )
  const { present, total } = result.rows[0]
  if (present === total) return "COMPLETE"
  if (present === 0) return "ABSENT"
  if (!reportedInconsistent) {
    reportedInconsistent = true
    console.error(`[operational-identity] migration 0037 is partly applied (${present} of ${total} objects); its operations are disabled`)
  }
  return "INCONSISTENT"
}
