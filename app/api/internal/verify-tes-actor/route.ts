import { NextResponse } from "next/server"
import { TesIdentityRequiredError, requireTesActor } from "@/lib/auth/tes-actor"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const actor = await requireTesActor()

    return NextResponse.json(
      {
        authenticated: true,
        tesActorId: actor.id,
        actorType: actor.actorType,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    if (error instanceof TesIdentityRequiredError) {
      return NextResponse.json(
        { authenticated: false, error: "TES identity required." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      )
    }

    return NextResponse.json(
      { authenticated: false, error: "TES identity verification failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
