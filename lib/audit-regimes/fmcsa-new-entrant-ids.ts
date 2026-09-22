/**
 * Shared identifier(s) for the FMCSA New Entrant Safety Audit regime.
 *
 * Extracted into its own file (Phase 2E) so fmcsa-new-entrant.ts and
 * fmcsa-new-entrant-outcome-methodology.ts can both reference the regime id
 * without importing from each other — fmcsa-new-entrant.ts now needs
 * FMCSA_NE_GATE_RULES from the outcome-methodology file (to wire
 * outcomeRuleIds), and the outcome-methodology file already needed this id
 * from fmcsa-new-entrant.ts, which would otherwise be a circular import.
 */
export const FMCSA_NEW_ENTRANT_REGIME_ID = "fmcsa-new-entrant-safety-audit";
