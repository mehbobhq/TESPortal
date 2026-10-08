import { NextResponse } from "next/server"

import { requireTesAuthorizationWithClient } from "@/lib/auth/tes-authorization"
import { withPostgresTransaction } from "@/lib/database/postgres-transaction"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await withPostgresTransaction(async (client) => {
      const decision = await requireTesAuthorizationWithClient(client, {
        capability: "TES_TRANSACTION_AUTHORIZATION_VERIFICATION",
        scope: { type: "SYSTEM" },
      })

      return {
        authenticated: true,
        allowed: decision.allowed,
        isMasterAccount: decision.isMasterAccount,
        transactionAware: true,
      }
    })

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      {
        authenticated: false,
        allowed: false,
        isMasterAccount: false,
        transactionAware: false,
      },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }
}
