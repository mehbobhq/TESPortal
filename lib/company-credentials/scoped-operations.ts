/**
 * Company-scoped entry points over the existing Company Credentials operations.
 *
 * The company routes know which Organization a request is made under (the URL). The operations that take a credential, slot,
 * verification or status-period id do not take an Organization, so a route that called them directly could touch another
 * company's record by guessing an id. The functions here run INSIDE the same authorization transaction as the operation they
 * call and refuse, as "not found", any id that does not belong to the Organization in the URL. They add no new behaviour:
 * validation, lifecycle rules, correction-versus-change semantics and Master Register events stay in operations.ts.
 *
 * NO SECRET VALUE EXISTS HERE EITHER. Inputs are the same strict, value-free shapes as operations.ts (an unknown key such as
 * `password` is refused by the operation). The only thing that can be linked to a slot is a Secret Manager resource name.
 *
 * No "server-only" import: this is plain domain logic over a caller-supplied transaction.
 */

import { CompanyCredentialNotFoundError, CompanyCredentialValidationError } from "@/lib/company-credentials/errors"
import * as operations from "@/lib/company-credentials/operations"
import type { OperationContext } from "@/lib/company-credentials/operations"
import * as repo from "@/lib/company-credentials/repository"
import type { CredentialView, SystemView } from "@/lib/company-credentials/types"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) throw new CompanyCredentialValidationError(field, `${field} must be a UUID.`)
  return value.trim().toLowerCase()
}

function plain(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CompanyCredentialValidationError(field, `${field} must be an object.`)
  return value as Record<string, unknown>
}

/** The credential must belong to the Organization in the URL; a mismatch is indistinguishable from a missing credential. */
async function assertCredentialInOrganization(ctx: OperationContext, credentialId: string, organizationId: string): Promise<void> {
  const owner = await repo.findCredentialOrganization(ctx.client, credentialId)
  if (!owner || owner !== organizationId) throw new CompanyCredentialNotFoundError("Credential")
}

function without(input: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...input }
  for (const key of keys) delete copy[key]
  return copy
}

/**
 * A changed or wrongly entered login: a NEW credential replaces the old one (which is archived with its history intact).
 * `reason` is USERNAME_CHANGED (a real-world change) or CORRECTION (the first entry was wrong).
 */
export async function replaceCredentialInOrganization(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<CredentialView> {
  const input = plain(rawInput, "input")
  const credentialId = uuid(input.credentialId, "credentialId")
  await assertCredentialInOrganization(ctx, credentialId, uuid(organizationId, "organizationId"))
  return operations.replaceCredential(ctx, input)
}

export async function updateCredentialMetadataInOrganization(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<CredentialView> {
  const input = plain(rawInput, "input")
  const credentialId = uuid(input.credentialId, "credentialId")
  await assertCredentialInOrganization(ctx, credentialId, uuid(organizationId, "organizationId"))
  return operations.updateCredentialMetadata(ctx, input)
}

/** CORRECTION of the credential's current status (the wrong status period is kept and flagged). */
export async function correctCredentialStatusInOrganization(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<CredentialView> {
  const input = plain(rawInput, "input")
  const periodId = uuid(input.periodId, "periodId")
  const period = await repo.getPeriod(ctx.client, periodId)
  if (!period) throw new CompanyCredentialNotFoundError("Status period")
  await assertCredentialInOrganization(ctx, period.credentialId, uuid(organizationId, "organizationId"))
  return operations.correctCredentialStatus(ctx, input)
}

/** A verification entered in error is VOIDED (kept, never deleted). */
export async function voidVerificationInOrganization(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<CredentialView> {
  const input = plain(rawInput, "input")
  const verificationId = uuid(input.verificationId, "verificationId")
  const credentialId = await repo.findVerificationCredential(ctx.client, verificationId)
  if (!credentialId) throw new CompanyCredentialNotFoundError("Verification")
  await assertCredentialInOrganization(ctx, credentialId, uuid(organizationId, "organizationId"))
  return operations.voidVerification(ctx, input)
}

/** Declares that a credential has a secret of this kind somewhere. It declares STATE only; it never carries a value. */
export async function declareSecretSlotInOrganization(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<CredentialView> {
  const input = plain(rawInput, "input")
  const credentialId = uuid(input.credentialId, "credentialId")
  await assertCredentialInOrganization(ctx, credentialId, uuid(organizationId, "organizationId"))
  return operations.addSecretSlot(ctx, input)
}

export async function retireSecretSlotInOrganization(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<CredentialView> {
  const input = plain(rawInput, "input")
  const slotId = uuid(input.slotId, "slotId")
  const credentialId = await repo.findSlotCredential(ctx.client, slotId)
  if (!credentialId) throw new CompanyCredentialNotFoundError("Secret slot")
  await assertCredentialInOrganization(ctx, credentialId, uuid(organizationId, "organizationId"))
  return operations.retireSecretSlot(ctx, input)
}

/**
 * Links a slot to the Secret Manager RESOURCE NAME of a secret that already lives there (UNRESOLVED -> STORED). Only a
 * resource name is accepted (the operation refuses anything else without echoing it); no value is ever sent to TES.
 */
export async function linkSlotToSecretManagerInOrganization(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<CredentialView> {
  const input = plain(rawInput, "input")
  const slotId = uuid(input.slotId, "slotId")
  const credentialId = await repo.findSlotCredential(ctx.client, slotId)
  if (!credentialId) throw new CompanyCredentialNotFoundError("Secret slot")
  await assertCredentialInOrganization(ctx, credentialId, uuid(organizationId, "organizationId"))
  return operations.attachSecretReference(ctx, input)
}

/**
 * A new credential together with the secret slots its recovery details declare, in ONE transaction: if any slot is refused,
 * the credential is not created either. `recoverySlots` is a list of slot KINDS (no values). The PASSWORD slot is created by
 * createCredential itself.
 */
export async function createCredentialWithRecoverySlots(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<CredentialView> {
  const input = plain(rawInput, "input")
  const slots = input.recoverySlots === undefined ? [] : input.recoverySlots
  if (!Array.isArray(slots) || slots.length > 20 || slots.some((kind) => typeof kind !== "string")) {
    throw new CompanyCredentialValidationError("recoverySlots", "recoverySlots must be a short list of slot kinds.")
  }
  let view = await operations.createCredential(ctx, { ...without(input, "recoverySlots", "organizationId"), organizationId: uuid(organizationId, "organizationId") })
  for (const slotKind of slots as string[]) {
    view = await operations.addSecretSlot(ctx, { credentialId: view.credential.id, slotKind })
  }
  return view
}

// --- system registry (global): lifecycle and identity helpers kept inside the same transaction --------------------------

/** Retires an alias, but only if it belongs to the system named in the URL. */
export async function retireAliasOfSystem(ctx: OperationContext, systemId: string, rawInput: unknown): Promise<SystemView> {
  const input = plain(rawInput, "input")
  const aliasId = uuid(input.aliasId, "aliasId")
  const alias = await repo.getAlias(ctx.client, aliasId)
  if (!alias || alias.systemId !== uuid(systemId, "systemId")) throw new CompanyCredentialNotFoundError("Alias")
  return operations.retireAlias(ctx, { aliasId })
}
