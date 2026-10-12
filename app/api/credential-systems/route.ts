import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { createSystem, listSystems } from "@/lib/company-credentials/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json({ systems: await listSystems() }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load credential systems.")
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ system: await createSystem(await readJsonBody(request)) }, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to create credential system.")
  }
}
