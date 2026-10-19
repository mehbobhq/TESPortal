import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { getContactIdentity } from "@/lib/contact-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/**
 * The restricted identity details (date of birth, driving licence record) of ONE contact of this company. The person must be a contact
 * of this company, and the details are returned only to an actor holding PERSON_IDENTITY_READ (the licence also DRIVER_READ); everyone
 * else receives just the access flags. Never cached. Writes go through the contacts route's saveContact action.
 */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const personId = request.nextUrl.searchParams.get("personId") || null
    return NextResponse.json(await getContactIdentity(id, personId), { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to load identity details.")
  }
}
