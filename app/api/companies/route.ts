import { NextResponse } from "next/server"
import { createCompanyDirectoryRecord, listCompanyDirectory } from "@/lib/company-directory/service"

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

export async function POST(request: Request) {
  try {
    const company = await createCompanyDirectoryRecord(await request.json())
    return NextResponse.json(company, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create company." },
      { status: 400 },
    )
  }
}
