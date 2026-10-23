import type { Cond } from "./catalogue/types"

export type Tri = "T" | "F" | "U"

export interface CondScope {
  ctx: Record<string, unknown>
  /** Answers by field id. `null` = answers are not known yet (plan time): answer references evaluate to U (unknown), so the field stays in the plan. */
  ans: Record<string, unknown> | null
  item?: Record<string, unknown>
}

const not = (t: Tri): Tri => (t === "T" ? "F" : t === "F" ? "T" : "U")

function resolve(ref: string, scope: CondScope): { known: boolean; value: unknown } {
  if (ref.startsWith("ctx.")) return { known: true, value: scope.ctx[ref.slice(4)] }
  if (ref.startsWith("ans.")) return scope.ans === null ? { known: false, value: undefined } : { known: true, value: scope.ans[ref.slice(4)] }
  if (ref.startsWith("item.")) return scope.item ? { known: true, value: scope.item[ref.slice(5)] } : { known: false, value: undefined }
  throw new Error(`Unknown condition reference: ${ref}`)
}

/** Three-valued evaluation: a condition that depends on a not-yet-known answer is U, never silently false. */
export function evalCond(cond: Cond | undefined, scope: CondScope): Tri {
  if (!cond) return "T"
  if ("all" in cond) {
    let unknown = false
    for (const c of cond.all) {
      const t = evalCond(c, scope)
      if (t === "F") return "F"
      if (t === "U") unknown = true
    }
    return unknown ? "U" : "T"
  }
  if ("any" in cond) {
    let unknown = false
    for (const c of cond.any) {
      const t = evalCond(c, scope)
      if (t === "T") return "T"
      if (t === "U") unknown = true
    }
    return unknown ? "U" : "F"
  }
  if ("not" in cond) return not(evalCond(cond.not, scope))
  const { known, value } = resolve(cond.ref, scope)
  if (!known) return "U"
  switch (cond.op) {
    case "eq": return value === cond.value ? "T" : "F"
    case "neq": return value !== cond.value ? "T" : "F"
    case "in": return Array.isArray(cond.value) && cond.value.includes(value) ? "T" : "F"
    case "includes": return Array.isArray(value) && value.includes(cond.value) ? "T" : "F"
    case "truthy": return value ? "T" : "F"
    case "falsy": return !value ? "T" : "F"
    case "gte": return typeof value === "number" && typeof cond.value === "number" && value >= cond.value ? "T" : "F"
  }
}

export const isTrue = (cond: Cond | undefined, scope: CondScope) => evalCond(cond, scope) === "T"
