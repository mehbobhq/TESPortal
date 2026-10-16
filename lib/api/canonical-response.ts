import { NextResponse } from "next/server"

/**
 * Maps a canonical service error to a non-destructive JSON response.
 *
 * Classification uses properties the error sets explicitly, never `constructor.name`: a production build minifies class
 * bindings (`class i extends Error`), so `constructor.name` is not the declared name there while the string literals the
 * errors assign survive minification.
 *   - The canonical domain errors follow one naming convention, carried by `error.name` (set in each constructor):
 *     ...ValidationError, ...NotFoundError, ...StateError, ...ConflictError, ...CollisionError.
 *   - Authentication/authorization denial is recognised by the explicit `code` of exactly two errors:
 *     TES_AUTHORIZATION_DENIED (TesAuthorizationDeniedError) and TES_IDENTITY_REQUIRED (TesIdentityRequiredError).
 * Anything else, including every other Tes* error and any infrastructure failure, is reported generically with the caller's
 * fallback message and status 500, so no internal detail leaks and an unknown error is never read as an authorization one.
 */
const TES_DENIAL_CODES: ReadonlySet<string> = new Set(["TES_AUTHORIZATION_DENIED", "TES_IDENTITY_REQUIRED"])

function declaredName(error: unknown): string {
  return error instanceof Error && typeof error.name === "string" ? error.name : ""
}

function declaredCode(error: unknown): string {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined
  return typeof code === "string" ? code : ""
}

/**
 * True only for the two TES authentication/authorization denials (TesAuthorizationDeniedError, TesIdentityRequiredError),
 * recognised by their explicit codes. For routes that decide between "denial" and their own failure handling; it is the same
 * test canonicalFailure uses for 403. Any other error, including every other Tes* error, is not a denial.
 */
export function isTesDenial(error: unknown): boolean {
  return TES_DENIAL_CODES.has(declaredCode(error))
}

export function canonicalFailure(error: unknown, fallback: string) {
  const name = declaredName(error)
  const message = error instanceof Error ? error.message : fallback
  if (name.endsWith("ValidationError")) return NextResponse.json({ error: message }, { status: 400 })
  if (name.endsWith("NotFoundError")) return NextResponse.json({ error: message }, { status: 404 })
  if (name.endsWith("StateError") || name.endsWith("ConflictError") || name.endsWith("CollisionError")) {
    return NextResponse.json({ error: message }, { status: 409 })
  }
  if (isTesDenial(error)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}
