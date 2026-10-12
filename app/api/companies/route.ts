import { NextResponse } from "next/server"
import { listCompanyDirectory } from "@/lib/company-directory/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const companies = await listCompanyDirectory()
    return NextResponse.json({ companies }, { status: 200 })
  } catch {
    return NextResponse.json({ error: "Unable to load companies." }, { status: 500 })
  }
}
