import { NextResponse } from "next/server"

import { probePostgresConnection } from "@/lib/database/postgres"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  // Temporary production infrastructure probe.
  //
  // This route intentionally refuses normal requests. It will only execute
  // when the server-side probe key configured in Vercel matches the request
  // header. Remove this entire route after Cloud SQL verification.
  const expectedKey = process.env.TES_POSTGRES_PROBE_KEY

  if (!expectedKey) {
    return NextResponse.json(
      { ok: false, error: "Probe disabled." },
      { status: 404 },
    )
  }

  const suppliedKey = request.headers.get("x-tes-probe-key")

  if (!suppliedKey || suppliedKey !== expectedKey) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    )
  }

  try {
    const result = await probePostgresConnection()

    return NextResponse.json({
      ok: true,
      database: result.database,
      user: result.user,
      serverTime: result.serverTime,
    })
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "PostgreSQL connectivity probe failed.",
      },
      { status: 503 },
    )
  }
}