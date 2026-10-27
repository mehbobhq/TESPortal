import { NextResponse } from "next/server"
import { listCustomerDirectory } from "@/lib/company-directory/service"
import { logSafeError } from "@/lib/database/safe-error"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const customers = await listCustomerDirectory()
    return NextResponse.json({ customers }, { status: 200 })
  } catch (error) {
    logSafeError("GET /api/customers", error)
    return NextResponse.json({ error: "Unable to load customers." }, { status: 500 })
  }
}
