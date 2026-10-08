import { NextResponse } from "next/server"
import { requireTesAuthorizationPrincipal } from "@/lib/auth/tes-authorization"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const principal = await requireTesAuthorizationPrincipal()

    return NextResponse.json(
      {
        authenticated: true,
        isMasterAccount: principal.isMasterAccount,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    )
  } catch {
    return NextResponse.json(
      {
        authenticated: false,
        isMasterAccount: false,
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    )
  }
}