export const PROSPECT_STATUSES = ["PROSPECT", "INVITED", "APPLICATION_SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"] as const
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number]

/** Words the portal already uses for the driver lifecycle; a prospect is never labelled Active or Qualified. */
export const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  PROSPECT: "Prospect",
  INVITED: "Invitation Sent",
  APPLICATION_SUBMITTED: "Application Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
}

export type ReviewTarget = "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN"
export const REVIEW_TARGETS: readonly ReviewTarget[] = ["UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"]

export type InvitationStatus = "PENDING" | "SENT" | "FAILED" | "OPENED" | "SUBMITTED" | "REVOKED"

export interface CreateProspectInput {
  organizationId: string
  fullName: string
  email?: string
  phone?: string
  /** Intended operating scope. Omitted or UNDETERMINED = saved as a prospect with the scope still to be established. */
  scope?: ScopeInput
}

import type { OnboardingProgress } from "./onboarding-stages"
import type { NormalizedScope, RequirementsProfile, ScopeEvaluation, ScopeInput } from "./operating-scope"

export interface ProspectView {
  prospectId: string
  personId: string
  status: ProspectStatus
  statusLabel: string
  givenName: string | null
  familyName: string | null
  email: string | null
  phone: string | null
  createdAt: string
  statusChangedAt: string
  convertedRelationshipId: string | null
  /** Stage chronology derived from recorded events. */
  onboarding: OnboardingProgress
  invitation: { invitationId: string; status: InvitationStatus; sentAt: string | null; expiresAt: string; deliveryFailed: boolean } | null
  /** The established intended operating scope (null until one is established) and what it means for the application. */
  operatingScope: (NormalizedScope & { establishedAt: string; rulesVersion: string }) | null
  scopeEvaluation: ScopeEvaluation
  scopeAvailable: boolean
  /** Whether a "Send application" action is possible, and why not. */
  canInvite: boolean
  inviteBlockedReason: string | null
}

export interface InvitationDelivery {
  to: string
  applicantName: string
  companyName: string
  link: string
  invitationId: string
  expiresAt: string
}
/** The approved delivery mechanism (Resend), injected so tests never send mail. Throws on failure; the error text is never stored. */
export type InvitationDeliveryPort = (message: InvitationDelivery) => Promise<{ messageId: string }>

export interface ConvertProspectInput {
  organizationId: string
  prospectId: string
  relationshipType: "EMPLOYEE" | "CONTRACTOR" | "OWNER_OPERATOR"
  relationshipStartDate: string
  dateOfBirth: string
  licence: { country: string; region: string; number: string; licenceClass?: string; effectiveFrom: string }
  driverNumber?: string
}

export type { RequirementsProfile }
