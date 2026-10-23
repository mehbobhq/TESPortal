import type { PoolClient } from "pg"
import { DriverProspectStateError } from "@/lib/driver-prospects/errors"

/** Approval gate: a prospect with a submitted plan-based application can be APPROVED only when every submitted application has a latest decision of QUALIFIED. */
export async function assertQualifiedForApproval(ctx: { client: PoolClient }, organizationId: string, prospectId: string): Promise<void> {
  const r = await ctx.client.query<{ id: string; latest: string | null }>(
    `SELECT a.id, (SELECT d.decision FROM public.driver_application_decisions d WHERE d.application_id = a.id ORDER BY d.decided_at DESC, d.id DESC LIMIT 1) AS latest
       FROM public.driver_applications a WHERE a.organization_id = $1 AND a.prospect_id = $2 AND a.status = 'SUBMITTED'`,
    [organizationId, prospectId],
  )
  const open = r.rows.filter((x) => x.latest !== "QUALIFIED")
  if (open.length) throw new DriverProspectStateError("Record a Qualified decision on each submitted application before approving. Submitting an application does not qualify the applicant. Nothing was changed.")
}

