/**
 * Describes an error for server logs WITHOUT its message, stack or cause. Driver and connector errors can embed hosts, user
 * names, access tokens or request bodies, so only the class name and a short machine code are kept. The one exception is
 * DatabaseConfigurationError, whose messages name variables and rules but never a value by construction.
 */
import { DatabaseConfigurationError } from "@/lib/database/postgres-config"

export type SafeErrorSummary = { name: string; code?: string; table?: string; constraint?: string; column?: string; routine?: string; detail?: string }

const word = (v: unknown, max: number) => (typeof v === "string" && /^[A-Za-z0-9_.:-]+$/.test(v) && v.length <= max ? v : undefined)

export function describeError(error: unknown): SafeErrorSummary {
  const e = error as { name?: unknown; code?: unknown; cause?: unknown } | null
  const out: SafeErrorSummary = { name: word(e?.name, 60) ?? "Error" }
  const code = word(e?.code, 40) ?? word((e?.cause as { code?: unknown } | undefined)?.code, 40)
  if (code) out.code = code
  // PostgreSQL error fields that name schema objects (never data values): which table, constraint, column or function refused.
  const pgErr = error as { table?: unknown; constraint?: unknown; column?: unknown; routine?: unknown } | null
  for (const k of ["table", "constraint", "column", "routine"] as const) {
    const v = word(pgErr?.[k], 80)
    if (v) out[k] = v
  }
  if (error instanceof DatabaseConfigurationError) out.detail = error.message.slice(0, 200)
  return out
}

export function logSafeError(scope: string, error: unknown): void {
  console.error(`[tes] ${scope} failed: ${JSON.stringify(describeError(error))}`)
}
