import { auth } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"
import { verifyDriverInvitationToken } from "@/lib/driver-invitation-token"
import { canonicalFailure } from "@/lib/api/canonical-response"
import {
  APPLICANT_SUBMISSION_READ_UNAVAILABLE_MESSAGE,
  authorizeApplicantSubmissionRead,
} from "@/lib/driver-applications/access"
import {
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
    const authorization = request.headers.get("authorization")
    const match = authorization?.match(/^Bearer\s+(.+)$/i)
    const invitation = match ? verifyDriverInvitationToken(match[1].trim()) : null

    if (!invitation) {
      return NextResponse.json({ error: "A valid driver application invitation is required." }, { status: 401 })
    }

    const body = await request.json()
    if (!isSubmission(body)) {
      return NextResponse.json({ error: "Invalid application submission payload." }, { status: 400 })
    }

    if (body.applicationId !== invitation.applicationId) {
      return NextResponse.json({ error: "The invitation does not authorize this application." }, { status: 403 })
    }

    const saved = await saveApplicantSubmission(body)
    return NextResponse.json({ submission: saved }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save application submission."
    return NextResponse.json({ error: message }, { status: 409 })
  }
}

/**
 * Applicant submission retrieval is CLOSED. The server-side store (.tes-data) keeps no record of which customer owns an
 * application, and browser data or caller-supplied ids are not a trustworthy substitute, so no submission can be released
 * safely. The route still authenticates and authorizes first (TES actor holding DRIVER_READ) so the answer does not depend
 * on who asks, and it never reads the store or looks at the requested ids. Stored submissions are untouched.
 * Re-open by adding a canonical ownership check in lib/driver-applications/access.ts once application records are in PostgreSQL.
 */
export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }
    await authorizeApplicantSubmissionRead()
    return NextResponse.json(
      { error: APPLICANT_SUBMISSION_READ_UNAVAILABLE_MESSAGE },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return canonicalFailure(error, "Unable to retrieve application submissions.")
  }
}
