/**
 * Canonical Shared TES Applicability Model
 * Distinguishes whether a regulatory regime or program applies to an entity.
 * Distinct from Compliance Status, Account Status, Filing Status, or Evidence Status.
 */

export type ApplicabilityState = "APPLIES" | "DOES_NOT_APPLY" | "NOT_CONFIGURED";

export interface ApplicabilityConfig {
  state: ApplicabilityState;
  reason?: string;
  configuredAt?: string;
  configuredBy?: string;
  effectiveFrom?: string;
}

export const APPLICABILITY_PRESENTATION: Record<
  ApplicabilityState,
  { label: string; badgeClass: string; description: string }
> = {
  APPLIES: {
    label: "Applies",
    badgeClass: "border-primary/30 bg-primary/10 text-primary font-bold",
    description: "Program or regulation is active and enforceable for this entity.",
  },
  DOES_NOT_APPLY: {
    label: "Doesn't Apply",
    badgeClass: "border-border bg-muted/60 text-muted-foreground font-medium",
    description: "Exempt or out of operational scope.",
  },
  NOT_CONFIGURED: {
    label: "Not Configured",
    badgeClass: "border-amber-400/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-semibold",
    description: "Applicability determination has not been completed.",
  },
};

export function getApplicabilityPresentation(state?: ApplicabilityState) {
  if (!state || !APPLICABILITY_PRESENTATION[state]) {
    return APPLICABILITY_PRESENTATION.NOT_CONFIGURED;
  }
  return APPLICABILITY_PRESENTATION[state];
}
