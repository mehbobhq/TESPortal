import { NextResponse } from "next/server"

/**
 * Maps a canonical service error to a non-destructive JSON response. The canonical modules share one naming convention for
 * their errors (...ValidationError, ...NotFoundError, ...StateError, ...ConflictError, ...CollisionError); anything else is
 * reported generically so no internal detail leaks.
 */
export function canonicalFailure(error: unknown, fallback: string) {
  const name = error instanceof Error ? error.constructor.name : ""
  const message = error instanceof Error ? error.message : fallback
  if (name.endsWith("ValidationError")) {
    // Services that collect every problem (Driver Events) expose them as `issues` so a form can mark each field.
    const issues = (error as { issues?: unknown }).issues
    return NextResponse.json(Array.isArray(issues) ? { error: message, issues } : { error: message }, { status: 400 })
  }
  if (name.endsWith("NotFoundError")) return NextResponse.json({ error: message }, { status: 404 })
  if (name.endsWith("StateError") || name.endsWith("ConflictError") || name.endsWith("CollisionError")) {
    return NextResponse.json({ error: message }, { status: 409 })
  }
  if (name === "TesAuthorizationDeniedError" || name === "TesIdentityRequiredError") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}
