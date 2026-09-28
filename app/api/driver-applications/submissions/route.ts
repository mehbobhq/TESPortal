import { NextRequest, NextResponse } from "next/server"
import {
  getApplicantSubmissions,
  saveApplicantSubmission,
  type ServerApplicantSubmission,
} from "@/lib/server/driver-application-submission-repository"

export const dynamic = "force-dynamic"

function isSubmission(value: unknown): value is ServerApplicantSubmission {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ServerApplicantSubmission>
  return Boolean(
    candidate.applicationId &&
    candidate.submittedAt &&
    candidate.receiptId &&
    Array.isArray(candidate.completedSteps) &&
    candidate.draft &&
    typeof candidate.draft === "object"
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!isSubmission(body)) {
      return NextResponse.json({ error: "Invalid application submission payload." }, { status: 400 })
    }

    const saved = await saveApplicantSubmission(body)
    return NextResponse.json({ submission: saved }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save application submission."
    return NextResponse.json({ error: message }, { status: 409 })
  }
}

export async function GET(request: NextRequest) {
  const applicationIds = (request.nextUrl.searchParams.get("applicationIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 50)

  if (applicationIds.length === 0) {
    return NextResponse.json({ submissions: [] }, { status: 200 })
  }

  const submissions = await getApplicantSubmissions(applicationIds)
  return NextResponse.json({ submissions }, { status: 200 })
}
