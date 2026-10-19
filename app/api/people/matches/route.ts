import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { findPersonMatches } from "@/lib/contacts/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Advisory lookup for the Primary Contact field of the company form: people already in the canonical registry whose name is the
 * same as the one being typed. It is a SUGGESTION for the user to accept or ignore: nothing is linked, reused or merged here.
 * Only the caller's PERSON_REGISTRY_READ capability opens it (otherwise the service refuses and the form just creates a new
 * person), and it exposes no more than a person's id, their display name and how many company records they are linked to.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request)
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (name.length < 2) return NextResponse.json({ matches: [] }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
    const matches = await findPersonMatches({ givenName: name.slice(0, 200) })
    return NextResponse.json(
      { matches: matches.slice(0, 5).map((match) => ({ personId: match.personId, displayName: match.displayName, linkedCompanies: match.organizationIds.length })) },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return canonicalFailure(error, "Unable to look up existing people.")
  }
}
