// E2E harness stub: the signed-in Clerk subject is whatever /tmp/tes-e2e/actor.txt says (so a test can switch actors).
import fs from "node:fs"
export async function auth() {
  let id = ""
  try { id = fs.readFileSync("/tmp/tes-e2e/actor.txt", "utf8").trim() } catch {}
  const result = { userId: id || null }
  result.protect = async () => result
  return result
}
export function createRouteMatcher() { return () => false }
export function clerkMiddleware() { return () => undefined }
