import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { applyCustomerOnboardingAction, getCustomerOnboarding } from "@/lib/customer-onboarding/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getCustomerOnboarding(id), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load onboarding.")
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await applyCustomerOnboardingAction(id, await readJsonBody(request)), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to update onboarding.")
  }
}
