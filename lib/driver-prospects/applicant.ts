import "server-only"

import { callInvitationFunction } from "@/lib/auth/tes-invitation-access"
import { createDriverInvitationToken } from "@/lib/driver-invitation-token"
import { hashInvitationToken } from "./operations"
import type { RequirementsProfile } from "./operating-scope"

/**
 * The APPLICANT side has no TES login. It is authorized only by possession of the secret invitation token (or the server-signed token derived from
 * it). Everything below runs through two narrow database functions that act on that one invitation; nothing here reads a company, a prospect or
 * an application by an identifier the caller supplies.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type OpenedInvitation = { invitationId: string; prospectId: string; organizationId: string; companyName: string; applicantName: string; recipientEmail: string; expiresAt: string; requirements: RequirementsProfile }

/** Opens a live invitation by its secret. Returns null for anything unknown, expired, revoked, failed or already used (the reasons are not distinguished). */
export async function openInvitation(token: unknown): Promise<OpenedInvitation | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null
  const row = (await callInvitationFunction("open", [hashInvitationToken(token)]))[0]
  if (!row) return null
  return {
    invitationId: row.invitation_id,
    prospectId: row.prospect_id,
    organizationId: row.organization_id,
    companyName: row.company_name ?? "Your carrier",
    applicantName: [row.given_name, row.family_name].filter(Boolean).join(" "),
    recipientEmail: row.recipient_email,
    expiresAt: new Date(row.expires_at).toISOString(),
    requirements: row.requirements_profile as RequirementsProfile,
  }
}

/**
 * The signed session token the existing applicant workspace and submissions endpoint already understand, built ONLY from the database record
 * (company name, applicant name and email come from the invitation, never from the request).
 */
export function signedApplicantToken(opened: OpenedInvitation): string {
  return createDriverInvitationToken({
    version: 1,
    companyId: opened.organizationId,
    companyName: opened.companyName,
    driverMasterId: opened.prospectId,
    applicationId: opened.invitationId,
    recipientEmail: opened.recipientEmail,
    driverName: opened.applicantName,
    operatingRegion: opened.requirements.applicationRegion,
    requirements: {
      version: opened.requirements.version,
      scopeKind: opened.requirements.scopeKind,
      employmentHistoryYears: opened.requirements.employmentHistoryYears,
      sections: opened.requirements.sections,
    },
    expiresAt: opened.expiresAt,
  })
}

export type SubmitOutcome = { kind: "SAVED"; submittedAt: string } | { kind: "NOT_A_DATABASE_APPLICATION" } | { kind: "CLOSED" }

/** Stores the submission durably against the invitation. It creates no person and no driver. */
export async function submitApplication(applicationId: string, receiptId: string, payload: unknown): Promise<SubmitOutcome> {
  if (!UUID.test(applicationId)) return { kind: "NOT_A_DATABASE_APPLICATION" }
  try {
    const submitted = (await callInvitationFunction("submit", [applicationId, receiptId, JSON.stringify(payload)]))[0].at as Date
    return { kind: "SAVED", submittedAt: new Date(submitted).toISOString() }
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "P0002") return { kind: "NOT_A_DATABASE_APPLICATION" }
    if (code === "55000") return { kind: "CLOSED" }
    throw error
  }
}
