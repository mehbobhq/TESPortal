import { NextResponse } from "next/server"

export const runtime = "nodejs"

/** Retired. Submissions are stored in PostgreSQL through the applicant session API (POST /api/driver-applications/submit); staff review them from the driver record. */
const gone = () => NextResponse.json({ error: "This endpoint is retired." }, { status: 410, headers: { "Cache-Control": "no-store" } })
export const GET = gone
export const POST = gone
