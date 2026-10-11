/**
 * Customer Relationship vocabulary. PostgreSQL's catalogues (engagement_types, engagement_stage_types, product_levels)
 * are authoritative; this file only lets application code name the codes it may request, and a drift test proves the
 * two agree. There is deliberately NO stage-transition matrix here or in the database: which stage may follow which is
 * policy for a future Rules layer. The managed-probation maximum is policy too and is not encoded anywhere in 0015.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node.
 */

export const ENGAGEMENT_TYPES = ["RECURRING", "ONE_OFF"] as const
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number]

export const STAGE_DEFINITIONS = {
  ONBOARDING: { bounded: false, terminal: false },
  TRIAL: { bounded: true, terminal: false },
  ACTIVE: { bounded: false, terminal: false },
  MANAGED_PROBATION: { bounded: true, terminal: false },
  SUSPENDED: { bounded: false, terminal: false },
  ENDED: { bounded: false, terminal: true },
} as const
export type EngagementStage = keyof typeof STAGE_DEFINITIONS
export const ENGAGEMENT_STAGES = Object.keys(STAGE_DEFINITIONS) as EngagementStage[]

/**
 * Structural termination reasons: a deliberately small, stable set. There is no "other" and no free-text companion: any
 * explanatory narrative belongs in a future notes/evidence record, never in the structural termination fact. More codes are
 * added by migration (engagement_end_reasons is authoritative; a drift test keeps this list honest).
 */
export const ENGAGEMENT_END_REASONS = ["COMPLETED", "CUSTOMER_TERMINATED", "TES_TERMINATED", "MUTUAL_AGREEMENT", "ENTERED_IN_ERROR"] as const
export type EngagementEndReason = (typeof ENGAGEMENT_END_REASONS)[number]

export const PRODUCT_LEVELS = ["COMPLIANCE", "BUSINESS_INTELLIGENCE", "DECISION_SUPPORT"] as const
export type ProductLevel = (typeof PRODUCT_LEVELS)[number]

export const isEngagementType = (value: unknown): value is EngagementType => typeof value === "string" && (ENGAGEMENT_TYPES as readonly string[]).includes(value)
export const isEngagementStage = (value: unknown): value is EngagementStage => typeof value === "string" && Object.prototype.hasOwnProperty.call(STAGE_DEFINITIONS, value)
export const isEngagementEndReason = (value: unknown): value is EngagementEndReason => typeof value === "string" && (ENGAGEMENT_END_REASONS as readonly string[]).includes(value)
export const isProductLevel = (value: unknown): value is ProductLevel => typeof value === "string" && (PRODUCT_LEVELS as readonly string[]).includes(value)

/** A service code is a catalogue key: upper snake case. The catalogue itself decides whether it exists. */
export const isServiceCode = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)
