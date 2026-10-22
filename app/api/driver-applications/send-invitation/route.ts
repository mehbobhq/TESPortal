import { NextResponse } from "next/server"

export const runtime = "nodejs"

/**
 * DISABLED. This browser-workspace path accepted a company id, company details and an application id from the request body, so the company
 * could not be verified and the application was not stored durably. Applications are now sent only from a saved Driver Prospect:
 * POST /api/companies/{companyId}/driver-prospects/{prospectId}/invitation (authorized, company taken from the path, token hash stored).
 */
export async function POST() {
  return NextResponse.json(
    { error: "This way of sending applications is no longer available. Add the person under Drivers → Driver prospects and use “Send application”." },
    { status: 410 },
  )
}
