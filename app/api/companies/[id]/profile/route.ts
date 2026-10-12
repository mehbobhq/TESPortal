import { NextRequest, NextResponse } from "next/server"
import { getCompanyProfile } from "@/lib/company-directory/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const company = await getCompanyProfile(id)
    if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 })
    return NextResponse.json({ company }, { status: 200 })
  } catch {
    return NextResponse.json({ error: "Unable to load company profile." }, { status: 500 })
  }
}
