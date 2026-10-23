/**
 * Which part of migrations 0039 and 0041 (driver prospects, application invitations, applicant sessions) this database has. The application is deployed independently of the
 * migrations: every prospect operation reports "not available yet" until the WHOLE migration is present, and a partly applied one fails closed.
 * Not cached; a genuine query error propagates.
 */
import type { PoolClient } from "pg"

export type ProspectSchemaState = "ABSENT" | "COMPLETE" | "INCONSISTENT"

export const prospectSchemaMessage = (state: ProspectSchemaState, what: string): string =>
  state === "INCONSISTENT"
    ? `${what} is unavailable: this database has a partly applied driver-prospects migration. Nothing was changed.`
    : `${what} is not available yet: it needs the driver-prospects database migration, which has not been applied. Nothing was changed.`

export async function prospectSchemaState(client: Pick<PoolClient, "query">): Promise<ProspectSchemaState> {
  const result = await client.query<{ present: number; total: number }>(
    `WITH checks(present) AS (VALUES
       (to_regclass('public.driver_prospects') IS NOT NULL),
       (to_regclass('public.driver_application_invitations') IS NOT NULL),
       (to_regclass('public.driver_application_submissions') IS NOT NULL),
       (to_regclass('public.driver_prospect_events') IS NOT NULL),
       (to_regprocedure('tes_security.open_applicant_session(text,text,text,integer,text)') IS NOT NULL),
       (to_regprocedure('tes_security.submit_driver_application(uuid,text,jsonb)') IS NOT NULL),
       (EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.driver_prospects') AND c.relrowsecurity))
     )
     SELECT count(*) FILTER (WHERE present)::int AS present, count(*)::int AS total FROM checks`,
  )
  const { present, total } = result.rows[0]
  return present === total ? "COMPLETE" : present === 0 ? "ABSENT" : "INCONSISTENT"
}

/** Migration 0040 (operating scope, requirements frozen on invitations, presentation jurisdiction). Applications cannot be issued without it. */
export async function scopeSchemaAvailable(client: Pick<PoolClient, "query">): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `SELECT (to_regclass('public.driver_prospect_operating_scopes') IS NOT NULL
         AND to_regclass('public.organization_presentation_jurisdictions') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.driver_application_invitations') AND attname = 'requirements_profile' AND NOT attisdropped)) AS ok`,
  )
  return r.rows[0]?.ok === true
}

export const scopeSchemaMessage = (what: string) =>
  `${what} is not available yet: it needs the operating-scope database migration (0040), which has not been applied. Nothing was changed.`
