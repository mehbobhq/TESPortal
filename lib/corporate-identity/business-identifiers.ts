/**
 * Business-workspace identifier operations: registering and retiring an Organization's CRA Business Number or IRS EIN with the
 * right history semantics, composed from the existing corporate-identity operations in ONE transaction.
 *
 *   register, nothing active      -> addIdentifier
 *   register as a CORRECTION      -> correctIdentifier (the wrong value is superseded and kept; same kind)
 *   register as a real CHANGE     -> supersedeIdentifier on every active identifier of that kind, then addIdentifier
 *                                    (the earlier number stays in the history as superseded)
 *   retire                        -> supersedeIdentifier (never a delete)
 *
 * Validation, normalization, collision detection, the Organization lock and the Master Register events all stay inside the
 * existing operations; this module only sequences them so a real change cannot end the old number without recording the new one.
 *
 * No "server-only" import: plain domain logic over a caller-supplied transaction.
 */

import { CorporateIdentityNotFoundError, CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import { prepareCorporateIdentifier } from "@/lib/corporate-identity/identifier-definitions"
import * as operations from "@/lib/corporate-identity/operations"
import type { OperationContext } from "@/lib/corporate-identity/operations"
import type { MutationResult } from "@/lib/corporate-identity/types"

/** The business-number kinds this workspace manages. INCORPORATION is edited on the company Edit page. */
export const BUSINESS_IDENTIFIER_KINDS = ["CRA_BN", "IRS_EIN"] as const
export type BusinessIdentifierKind = (typeof BUSINESS_IDENTIFIER_KINDS)[number]

export const REGISTRATION_RELATIONS = ["change", "correction"] as const
export type RegistrationRelation = (typeof REGISTRATION_RELATIONS)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseKind(value: unknown): BusinessIdentifierKind {
  if (typeof value !== "string" || !(BUSINESS_IDENTIFIER_KINDS as readonly string[]).includes(value)) {
    throw new CorporateIdentityValidationError("kind", "kind must be CRA_BN or IRS_EIN.")
  }
  return value as BusinessIdentifierKind
}

export async function registerBusinessIdentifier(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<MutationResult> {
  if (!isRecord(rawInput)) throw new CorporateIdentityValidationError("input", "input must be an object.")
  for (const key of Object.keys(rawInput)) {
    if (!["kind", "value", "relation"].includes(key)) throw new CorporateIdentityValidationError(`input.${key}`, `input.${key} is not accepted.`)
  }
  const kind = parseKind(rawInput.kind)
  const relation = rawInput.relation === undefined ? undefined : rawInput.relation
  if (relation !== undefined && !(REGISTRATION_RELATIONS as readonly unknown[]).includes(relation)) {
    throw new CorporateIdentityValidationError("input.relation", "relation must be change or correction.")
  }
  const identifier = { kind, value: rawInput.value }
  const prepared = prepareCorporateIdentifier(identifier, "identifier")

  const organization = await operations.readOrganization(ctx.client, organizationId)
  const active = organization.identifiers.filter((item) => item.status === "active" && item.kind === kind)
  if (active.some((item) => item.normalizedValue === prepared.normalizedValue)) {
    throw new CorporateIdentityValidationError("identifier.value", "That number is already the active one.")
  }
  if (active.length === 0) return operations.addIdentifier(ctx, organizationId, identifier)
  if (relation === undefined) {
    throw new CorporateIdentityValidationError("input.relation", "A number is already recorded: say whether this is a change (the earlier number is kept as history) or a correction of a wrong entry.")
  }
  if (relation === "correction") {
    if (active.length > 1) throw new CorporateIdentityValidationError("input.relation", "More than one active number is recorded; retire the extra ones before correcting.")
    return operations.correctIdentifier(ctx, organizationId, active[0].id, identifier)
  }
  for (const item of active) await operations.supersedeIdentifier(ctx, organizationId, item.id)
  return operations.addIdentifier(ctx, organizationId, identifier)
}

/** Retires (supersedes) one CRA BN or EIN of the Organization in the URL. The identifier is kept as history. */
export async function retireBusinessIdentifier(ctx: OperationContext, organizationId: string, identifierId: string): Promise<MutationResult> {
  const organization = await operations.readOrganization(ctx.client, organizationId)
  const found = organization.identifiers.find((item) => item.id === identifierId)
  if (!found || !found.kind || !(BUSINESS_IDENTIFIER_KINDS as readonly string[]).includes(found.kind)) throw new CorporateIdentityNotFoundError("Identifier")
  return operations.supersedeIdentifier(ctx, organizationId, identifierId)
}
