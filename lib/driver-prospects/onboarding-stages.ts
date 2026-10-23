import type { ProspectStatus } from "./types"

/** The five onboarding stages, in order. Progress is derived ONLY from recorded events (driver_prospect_events), never from UI state. */
export const ONBOARDING_STAGES = [
  { key: "APPLICATION_SENT", label: "Application Sent" },
  { key: "APPLICATION_OPENED", label: "Application Opened" },
  { key: "APPLICATION_SUBMITTED", label: "Application Submitted" },
  { key: "PRE_EMPLOYMENT_VERIFICATION", label: "Pre-Employment Verification" },
  { key: "HIRING_PACKAGE", label: "Hiring Package" },
] as const

export type OnboardingStageKey = (typeof ONBOARDING_STAGES)[number]["key"]
export type OnboardingStageState = "DONE" | "CURRENT" | "PENDING"
export type OnboardingStage = { key: OnboardingStageKey; label: string; state: OnboardingStageState; at: string | null }

export type OnboardingProgress = {
  /** False once the prospect is rejected/withdrawn or the driver has been activated: the chronology is then not shown. */
  onboarding: boolean
  /** "Not sent" before any invitation was delivered, otherwise the label of the current stage. */
  currentLabel: string
  stages: OnboardingStage[]
}

export type ProspectEventRow = { eventType: string; toStatus: string | null; occurredAt: string }

export function deriveOnboarding(input: { status: ProspectStatus; relationshipStatus: string | null; events: ProspectEventRow[] }): OnboardingProgress {
  const ev = [...input.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  const last = (pred: (e: ProspectEventRow) => boolean) => [...ev].reverse().find(pred)?.occurredAt ?? null
  const lastSent = last((e) => e.eventType === "INVITATION_SENT")
  // A link that was revoked (a resend that failed, or an operating-scope change) is not "sent": the application it carried can no longer be opened.
  const revokedAfter = lastSent !== null && last((e) => e.eventType === "INVITATION_REVOKED" && e.occurredAt > lastSent) !== null
  const sentAt = revokedAfter ? null : lastSent
  const openedAt = sentAt ? last((e) => e.eventType === "APPLICATION_OPENED" && e.occurredAt >= sentAt) : null
  const submittedAt = last((e) => e.eventType === "APPLICATION_SUBMITTED")
  const verificationAt = last((e) => e.eventType === "STATUS_CHANGED" && (e.toStatus === "UNDER_REVIEW" || e.toStatus === "APPROVED"))
  const hiringAt = last((e) => (e.eventType === "STATUS_CHANGED" && e.toStatus === "APPROVED") || e.eventType === "CONVERTED_TO_DRIVER")
  const at = [sentAt, openedAt, submittedAt, verificationAt, hiringAt]
  let reached = -1
  at.forEach((t, i) => {
    if (t) reached = i
  })
  const stillOnboarding =
    input.status !== "REJECTED" && input.status !== "WITHDRAWN" && (input.relationshipStatus === null || input.relationshipStatus === "ONBOARDING")
  return {
    onboarding: stillOnboarding,
    currentLabel: reached < 0 ? "Not sent" : ONBOARDING_STAGES[reached].label,
    stages: ONBOARDING_STAGES.map((s, i) => ({
      key: s.key,
      label: s.label,
      at: at[i],
      state: i < reached ? "DONE" : i === reached ? "CURRENT" : "PENDING",
    })),
  }
}
