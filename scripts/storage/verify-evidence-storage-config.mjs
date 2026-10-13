#!/usr/bin/env node
// Verifies the GCS side of the evidence payload lifecycle fails SAFE.
//
//   node scripts/storage/verify-evidence-storage-config.mjs            offline: environment shape only (no network, no credentials)
//   node scripts/storage/verify-evidence-storage-config.mjs --live     read-only bucket checks through keyless ADC / Workload Identity
//
// Exit codes: 0 verified; 1 a requirement is definitely violated; 2 something could not be verified (treated as a failure).
// It never prints a credential, never writes, never reads an object, and never prints a bucket's contents.
//
// Required environment (all non-secret deployment identifiers; see docs/evidence-payload-lifecycle.md):
//   GOOGLE_CLOUD_PROJECT_ID, GOOGLE_GCS_QUARANTINE_BUCKET, GOOGLE_GCS_INTAKE_BUCKET, GOOGLE_GCS_EVIDENCE_BUCKET
// Production additionally (--production): GOOGLE_CLOUD_PROJECT_NUMBER, GOOGLE_WIF_POOL_ID, GOOGLE_WIF_PROVIDER_ID,
//   GOOGLE_BACKEND_SERVICE_ACCOUNT, GOOGLE_WIF_OIDC_AUDIENCE

import { pathToFileURL } from "node:url"

export const REQUIRED_ENV = ["GOOGLE_CLOUD_PROJECT_ID", "GOOGLE_GCS_QUARANTINE_BUCKET", "GOOGLE_GCS_INTAKE_BUCKET", "GOOGLE_GCS_EVIDENCE_BUCKET"]
export const PRODUCTION_ENV = ["GOOGLE_CLOUD_PROJECT_NUMBER", "GOOGLE_WIF_POOL_ID", "GOOGLE_WIF_PROVIDER_ID", "GOOGLE_BACKEND_SERVICE_ACCOUNT", "GOOGLE_WIF_OIDC_AUDIENCE"]
// Same shape the database enforces on evidence_payloads.quarantine_bucket / evidence_bucket.
export const BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$/
// Static credentials must never be configured for this block; production authenticates keylessly.
export const FORBIDDEN_ENV = ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GOOGLE_PRIVATE_KEY", "GOOGLE_CLIENT_SECRET", "GCS_KEY", "GCS_SERVICE_ACCOUNT_KEY", "PGPASSWORD"]

/** Pure: returns the list of problems with an environment. Never includes a value. */
export function checkStorageEnvironment(env, { production = false } = {}) {
  const problems = []
  for (const name of [...REQUIRED_ENV, ...(production ? PRODUCTION_ENV : [])]) {
    if (!env[name] || !String(env[name]).trim()) problems.push(`missing required variable ${name}`)
  }
  for (const name of FORBIDDEN_ENV) {
    if (env[name] && String(env[name]).trim()) problems.push(`forbidden static credential variable ${name} is set; production must stay keyless`)
  }
  const buckets = { quarantine: env.GOOGLE_GCS_QUARANTINE_BUCKET?.trim(), intake: env.GOOGLE_GCS_INTAKE_BUCKET?.trim(), evidence: env.GOOGLE_GCS_EVIDENCE_BUCKET?.trim() }
  for (const [role, name] of Object.entries(buckets)) {
    if (name && !BUCKET_PATTERN.test(name)) problems.push(`the ${role} bucket name is not a valid GCS bucket name`)
  }
  const named = Object.values(buckets).filter(Boolean)
  if (new Set(named).size !== named.length) problems.push("quarantine, intake and evidence must be three different buckets")
  for (const name of Object.keys(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /BUCKET|GCS|STORAGE|EVIDENCE/i.test(name)) problems.push(`${name} would expose storage configuration to browsers`)
  }
  return problems
}

/** Pure: judges one bucket's metadata and IAM members. */
export function checkBucketSafety(role, metadata, iamMembers) {
  const problems = []
  if (metadata?.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true) problems.push(`${role}: uniform bucket-level access is not enabled (object ACLs could grant access)`)
  if (metadata?.iamConfiguration?.publicAccessPrevention !== "enforced") problems.push(`${role}: public access prevention is not enforced`)
  if (role === "evidence" && metadata?.versioning?.enabled !== true) problems.push("evidence: object versioning is not enabled (needed to recover from overwrite or corruption)")
  if (role === "evidence" && !metadata?.retentionPolicy && !metadata?.softDeletePolicy) problems.push("evidence: neither a retention policy nor a soft-delete policy is configured")
  for (const member of iamMembers) {
    if (member === "allUsers" || member === "allAuthenticatedUsers") problems.push(`${role}: the bucket grants access to ${member}`)
  }
  return problems
}

async function live(env) {
  const { Storage } = await import("@google-cloud/storage")
  const storage = new Storage({ projectId: env.GOOGLE_CLOUD_PROJECT_ID })
  const roles = { quarantine: env.GOOGLE_GCS_QUARANTINE_BUCKET, intake: env.GOOGLE_GCS_INTAKE_BUCKET, evidence: env.GOOGLE_GCS_EVIDENCE_BUCKET }
  const problems = []
  const unverified = []
  for (const [role, name] of Object.entries(roles)) {
    try {
      const bucket = storage.bucket(name)
      const [metadata] = await bucket.getMetadata()
      let members = []
      try {
        const [policy] = await bucket.iam.getPolicy({ requestedPolicyVersion: 3 })
        members = (policy.bindings ?? []).flatMap((binding) => binding.members ?? [])
      } catch {
        unverified.push(`${role}: the bucket IAM policy could not be read`)
      }
      problems.push(...checkBucketSafety(role, metadata, members))
    } catch {
      unverified.push(`${role}: bucket metadata could not be read (missing bucket or missing storage.buckets.get)`)
    }
  }
  return { problems, unverified }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const production = args.has("--production")
  const problems = checkStorageEnvironment(process.env, { production })
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`)
    process.exit(1)
  }
  console.log("OK environment shape (names validated, values not printed)")
  if (!args.has("--live")) {
    console.log("Offline check passed. Run with --live to verify buckets (read-only).")
    return
  }
  const result = await live(process.env)
  for (const problem of result.problems) console.error(`FAIL ${problem}`)
  for (const item of result.unverified) console.error(`UNVERIFIED ${item}`)
  if (result.problems.length > 0) process.exit(1)
  if (result.unverified.length > 0) process.exit(2)
  console.log("OK live bucket checks passed")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("UNVERIFIED storage verification failed to run")
    process.exit(2)
  })
}
