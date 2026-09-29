import { randomUUID, timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { isProductionRuntime } from "@/lib/google/config"
import {
  deleteVerificationEvidenceObject,
  deleteVerificationIntakeObject,
  downloadEvidenceObject,
  downloadIntakeObject,
  evidenceObjectExists,
  intakeObjectExists,
  moveIntakeObjectToEvidence,
  uploadIntakeObject,
} from "@/lib/google/storage"

export const runtime = "nodejs"

/**
 * TEMPORARY, tightly-scoped verification endpoint.
 *
 * Proves - from the real Vercel Production runtime only - that the existing
 * TES backend identity can perform the intended GCS operations end to end
 * (upload to intake, confirm existence, read back exact content, promote to
 * evidence via the existing lib/google/storage.ts move logic, confirm the
 * evidence copy, read it back, confirm intake was only removed after the
 * copy succeeded, then clean up). It reuses lib/google/auth.ts and
 * lib/google/storage.ts entirely unmodified except for two small additive
 * helpers (see the report this route was built for) - there is no second
 * authentication implementation and no redesign of the storage module here.
 *
 * This route intentionally never touches any real TES/company/driver/vehicle
 * object: every object it creates lives under the isolated
 * `_system/verification/` namespace, with a fresh crypto.randomUUID() name
 * per invocation, and `deleteVerificationEvidenceObject` in
 * lib/google/storage.ts refuses to delete anything outside that namespace.
 *
 * This file should be deleted once the production GCS path has been verified
 * and is no longer needed - it is not meant to be permanent diagnostic
 * infrastructure.
 */

const VERIFICATION_PREFIX = "_system/verification/"
const VERIFICATION_BODY = "TES GCS production verification"

type Checks = {
  intakeUpload: boolean
  intakeExists: boolean
  intakeReadMatches: boolean
  moveToEvidence: boolean
  evidenceExists: boolean
  evidenceReadMatches: boolean
  intakeRemovedAfterMove: boolean
  cleanup: boolean
}

function emptyChecks(): Checks {
  return {
    intakeUpload: false,
    intakeExists: false,
    intakeReadMatches: false,
    moveToEvidence: false,
    evidenceExists: false,
    evidenceReadMatches: false,
    intakeRemovedAfterMove: false,
    cleanup: false,
  }
}

/** Constant-time-ish comparison of the caller-supplied secret against the configured one. Never logs either value. */
function secretMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  if (providedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(providedBuffer, expectedBuffer)
}

export async function POST(req: NextRequest) {
  // Reject outside the real Vercel Production runtime. A 404 here (rather
  // than 401/403) avoids even confirming this route exists in Preview or
  // local development, where it must never be reachable.
  if (!isProductionRuntime()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }

  const expectedSecret = process.env.TES_GCS_VERIFICATION_SECRET
  if (!expectedSecret) {
    // Distinct from "wrong secret" so an operator can tell the route itself
    // isn't configured yet, without revealing which variable or any value -
    // this is a fixed, sanitized code, not the actual missing-variable name.
    return NextResponse.json({ error: "VERIFICATION_NOT_CONFIGURED" }, { status: 503 })
  }

  const authHeader = req.headers.get("authorization") || ""
  const providedSecret = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : ""
  if (!providedSecret || !secretMatches(providedSecret, expectedSecret)) {
    // Missing header and wrong secret return the identical response - never
    // reveal whether a supplied secret was close/correct or absent entirely.
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const objectName = `${VERIFICATION_PREFIX}gcs-verification-${randomUUID()}.txt`
  const body = Buffer.from(VERIFICATION_BODY, "utf8")
  const checks = emptyChecks()
  let failedStage: string | null = null
  let intakeCreated = false
  let evidenceCreated = false

  try {
    // 1. Create a harmless temporary object in the intake bucket.
    await uploadIntakeObject(objectName, body, { contentType: "text/plain" })
    intakeCreated = true
    checks.intakeUpload = true

    // 2. Confirm the intake object exists.
    checks.intakeExists = await intakeObjectExists(objectName)
    if (!checks.intakeExists) {
      failedStage = "intakeExists"
      throw new Error(failedStage)
    }

    // 3. Read the intake object and verify its exact content.
    const intakeContent = await downloadIntakeObject(objectName)
    checks.intakeReadMatches = intakeContent.equals(body)
    if (!checks.intakeReadMatches) {
      failedStage = "intakeReadMatches"
      throw new Error(failedStage)
    }

    // 4. Use the EXISTING move/copy logic to move intake -> evidence.
    await moveIntakeObjectToEvidence(objectName, objectName)
    evidenceCreated = true
    checks.moveToEvidence = true

    // 5. Confirm the evidence object exists.
    checks.evidenceExists = await evidenceObjectExists(objectName)
    if (!checks.evidenceExists) {
      failedStage = "evidenceExists"
      throw new Error(failedStage)
    }

    // 6. Read the evidence object and verify its exact content.
    const evidenceContent = await downloadEvidenceObject(objectName)
    checks.evidenceReadMatches = evidenceContent.equals(body)
    if (!checks.evidenceReadMatches) {
      failedStage = "evidenceReadMatches"
      throw new Error(failedStage)
    }

    // 7. Confirm the intake source was removed ONLY after the evidence copy
    // succeeded - moveIntakeObjectToEvidence (lib/google/storage.ts) only
    // deletes the intake source after the copy call above returns
    // successfully, so by this point intake should already be gone.
    checks.intakeRemovedAfterMove = !(await intakeObjectExists(objectName))
    if (!checks.intakeRemovedAfterMove) {
      failedStage = "intakeRemovedAfterMove"
      throw new Error(failedStage)
    }

    // 8. Clean up the temporary evidence object.
    await deleteVerificationEvidenceObject(objectName)
    checks.cleanup = true

    // 9. Confirm cleanup succeeded.
    const stillExists = await evidenceObjectExists(objectName)
    if (stillExists) {
      checks.cleanup = false
      failedStage = "cleanup"
      throw new Error(failedStage)
    }

    return NextResponse.json({ ok: true, checks })
  } catch (error) {
    // Server-side only, and sanitized: this never includes the underlying
    // Google error object (which could carry request/response detail), only
    // the object name (a random verification identifier, not real evidence)
    // and the stage we got to.
    console.error(`[GCS verification] failed at stage=${failedStage ?? "unknown"} object=${objectName}`)

    // Best-effort cleanup of ONLY what this invocation itself created -
    // never touches the intake source if the move already deleted it, and
    // never touches anything outside the verification namespace (enforced
    // structurally by deleteVerificationEvidenceObject itself for evidence;
    // intake cleanup below is scoped to the exact object name generated
    // above, nothing recursive or pattern-based).
    try {
      if (evidenceCreated) {
        const evidenceStillThere = await evidenceObjectExists(objectName)
        if (evidenceStillThere) await deleteVerificationEvidenceObject(objectName)
      }
    } catch {
      // Cleanup best-effort only; do not mask the original failure with a
      // cleanup failure, and never surface this detail to the client either.
    }
    try {
      if (intakeCreated) {
        const intakeStillThere = await intakeObjectExists(objectName)
        if (intakeStillThere) await deleteVerificationIntakeObject(objectName)
      }
    } catch {
      // Same best-effort, non-surfacing handling as above.
    }

    return NextResponse.json({ ok: false, checks, failedStage: failedStage ?? "UNKNOWN" }, { status: 500 })
  }
}
