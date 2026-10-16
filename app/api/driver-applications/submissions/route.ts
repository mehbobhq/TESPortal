import { auth } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"
import { verifyDriverInvitationToken } from "@/lib/driver-invitation-token"
import { canonicalFailure } from "@/lib/api/canonical-response"
import {
  APPLICANT_SUBMISSION_READ_UNAVAILABLE_MESSAGE,
  APPLICANT_SUBMISSION_WRITE_UNAVAILABLE_MESSAGE,
  authorizeApplicantSubmissionRead,
} from "@/lib/driver-applications/access"
import type { ServerApplicantSubmission } from "@/lib/server/driver-application-submission-repository"

export const dynamic = "force-dynamic"

// Retained for the PostgreSQL-backed implementation; intentionally unused while submissions are closed.
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

/**
 * Applicant submission acceptance is CLOSED, like retrieval. The only place a submission can be written today is the local
 * JSON file in `.tes-data` (lib/server/driver-application-submission-repository.ts): it is not durable on serverless hosting,
 * is not tenant-scoped, and no canonical application record exists to verify ownership. Accepting data there would lose it
 * or park it somewhere nothing can safely read.
 *
 * The invitation-token check is kept exactly as it was so a future PostgreSQL-backed implementation can reuse it: an invalid
 * token is still 401. A valid token no longer reaches the body or the repository: the request is answered with a fixed 503
 * that contains no applicant data and no internal error text. Existing stored submissions are not read, changed or deleted.
 * `isSubmission` and the application-id binding below are the validation to re-apply when persistence returns.
 */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization")
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  const invitation = match ? verifyDriverInvitationToken(match[1].trim()) : null

  if (!invitation) {
    return NextResponse.json({ error: "A valid driver application invitation is required." }, { status: 401 })
  }

  return NextResponse.json(
    { error: APPLICANT_SUBMISSION_WRITE_UNAVAILABLE_MESSAGE },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  )
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
