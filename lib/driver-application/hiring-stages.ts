/**
 * The post-submission Driver Hiring Process. These stages group the EXISTING requirement records (and the existing gate, decision and approval) for display
 * in the review screen and in the carrier dossier. They add no data: the application itself never contains any of this.
 */
export const HIRING_STAGES = [
  { id: "intake", title: "Document intake and processing", types: [] as string[] },
  { id: "identity_licence", title: "Identity and licence verification", types: ["IDENTITY", "LICENCE"] },
  { id: "medical", title: "Medical qualification verification", types: ["MEDICAL"] },
  { id: "records", title: "Driving abstracts and applicable record checks", types: ["DRIVING_RECORD"] },
  { id: "employers", title: "Previous-employer investigations", types: ["PREVIOUS_EMPLOYER"] },
  { id: "external", title: "Applicable background and external regulatory checks", types: ["CLEARINGHOUSE", "PSP", "CRIMINAL_BACKGROUND", "WORK_ELIGIBILITY", "REFERENCES", "CARRIER_SPECIFIC"] },
  { id: "assessment", title: "Qualification assessment", types: [] as string[] },
  { id: "decision", title: "Authorized carrier hiring decision", types: [] as string[] },
  { id: "handoff", title: "Onboarding handoff", types: [] as string[] },
] as const

export type HiringStageId = (typeof HIRING_STAGES)[number]["id"]

/** The stage a requirement belongs to; an unknown type is shown with the external checks rather than dropped. */
export function stageOfRequirement(type: string): HiringStageId {
  return HIRING_STAGES.find((s) => (s.types as readonly string[]).includes(type))?.id ?? "external"
}

export type Attention = "ok" | "attention" | "bad" | "neutral"

/** Colour convention shared by the screens and the PDFs: green = confirmed verified, red = confirmed failure, yellow = needs attention (never "approved"), blue/neutral = information. */
export function requirementsAttention(rows: Array<{ required: boolean; status: string | null }>): { tone: Attention; label: string } {
  if (rows.length === 0) return { tone: "neutral", label: "No checks apply" }
  if (rows.some((r) => r.status === "REJECTED")) return { tone: "bad", label: "Rejected" }
  const open = rows.filter((r) => r.status !== "VERIFIED").length
  if (open === 0) return { tone: "ok", label: "Verified" }
  return { tone: "attention", label: `${open} unresolved` }
}
