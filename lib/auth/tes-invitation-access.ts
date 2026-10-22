import "server-only"

import { withPostgresTransaction } from "@/lib/database/postgres-transaction"

/**
 * The ONLY unauthenticated database entry point. An applicant has no TES identity; possession of the secret invitation token is the credential.
 * It can run exactly two statements, each a narrow SECURITY DEFINER function (migration 0039) that acts on one invitation and nothing else.
 * It never sets tenant or system context and never reads a table directly.
 */
const STATEMENTS = {
  open: `SELECT * FROM tes_security.open_driver_application_invitation($1)`,
  submit: `SELECT tes_security.submit_driver_application($1::uuid, $2, $3::jsonb) AS at`,
} as const

export async function callInvitationFunction(statement: keyof typeof STATEMENTS, params: readonly unknown[]) {
  return withPostgresTransaction(async (client) => (await client.query(STATEMENTS[statement], [...params])).rows as Array<Record<string, any>>)
}
