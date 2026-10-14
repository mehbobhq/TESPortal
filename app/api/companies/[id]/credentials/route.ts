import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { getOrganizationCredentials } from "@/lib/company-credentials/service"
import { createCredentialWithRecoverySlots } from "@/lib/company-credential-scope/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getOrganizationCredentials(id), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load credentials.")
  }
}

/**
 * Credential metadata only. The body is passed to the canonical service, which has no field for a secret value (an extra key is
 * refused). `recoverySlots` is an optional list of slot KINDS the Account Recovery step declared; the credential and its slots
 * are created in one transaction. The organization always comes from the URL.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json({ credential: await createCredentialWithRecoverySlots(id, body) }, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to create credential.")
  }
}
