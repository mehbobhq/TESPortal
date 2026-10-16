import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import * as operations from "@/lib/contracts/operations"
import { ContractStateError, ContractValidationError } from "@/lib/contracts/errors"
import type { ContractsView } from "@/lib/contracts/types"
import { getCustomerRelationship } from "@/lib/customer-relationship/service"
import { getOnboardingFoundation, type EvidenceDocumentRecord } from "@/lib/onboarding-foundation/service"
import { getOrganizationContacts } from "@/lib/contacts/service"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"

export * from "@/lib/contracts/errors"
export * from "@/lib/contracts/definitions"
export type * from "@/lib/contracts/types"

/**
 * Contracts service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> PostgreSQL
 *                                                                        \-> Master Register, same transaction
 *
 * Capabilities (all SYSTEM scope; there is no CUSTOMER-facing path):
 *   CONTRACT_READ     getContractsWorkspace (also writes a RECORD_VIEWED Master Register event: viewing contracts is accountable)
 *   CONTRACT_MANAGE   every mutation
 * Reading the workspace additionally needs EVIDENCE_READ (evidence metadata) and CUSTOMER_RELATIONSHIP_READ (scopes);
 * contact candidates are optional and degrade to an empty list when PERSON_REGISTRY_READ is not held.
 *
 * Evidence payloads are never touched here: only GCS-backed metadata rows are referenced by id.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
  }
}

function manage<T>(work: (ctx: operations.OperationContext) => Promise<T>): Promise<T> {
  return withAuthorizedSystem("CONTRACT_MANAGE", (client, decision) => work(context(client, decision)))
}

export type ContractsWorkspace = ContractsView & {
  /** Verified-or-not evidence metadata the operator can choose from (no storage locations, no payload). */
  evidenceDocuments: Array<Pick<EvidenceDocumentRecord, "id" | "documentType" | "documentTitle" | "documentStatus" | "expiresAt">>
  /** Active contacts of the organization that can be named as an authority holder. */
  people: Array<{ personId: string; displayName: string }>
  /** Current scopes of the open engagement. */
  openEngagement: { id: string; scopes: Array<{ id: string; productLevel: string; serviceCode: string | null; responsibilityStartsAt: string | null }> } | null
}

/** TesAuthorizationDeniedError, by its stable code. TesIdentityRequiredError and every other error are NOT a denial here. */
function isAuthorizationDenied(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === "TES_AUTHORIZATION_DENIED"
}

/**
 * Reads the contracts workspace and readiness. The read is itself recorded in the Master Register (contract-significant
 * views are accountable), inside the same CONTRACT_READ transaction.
 */
export async function getContractsWorkspace(organizationId: string): Promise<ContractsWorkspace> {
  const [relationship, foundation, contacts] = await Promise.all([
    getCustomerRelationship(organizationId),
    getOnboardingFoundation(organizationId),
    getOrganizationContacts(organizationId).catch((error: unknown) => {
      // Only a denial degrades. Application code does not import the authorization core, so the denial is recognised by its
      // explicit code (never constructor.name, which a production build minifies).
      if (isAuthorizationDenied(error)) return null
      throw error
    }),
  ])
  const customerId = relationship.customer?.id ?? null
  const view = await withAuthorizedSystem("CONTRACT_READ", async (client, decision) => {
    const result = await operations.readContractsView(client, organizationId, customerId)
    await operations.recordContractsViewed(context(client, decision), organizationId, result.contracts.map((contract) => contract.id))
    return result
  })

  const open = relationship.openEngagement
  return {
    ...view,
    evidenceDocuments: foundation.evidenceDocuments
      .filter((document) => document.documentStatus !== "archived" && document.documentStatus !== "rejected")
      .map(({ id, documentType, documentTitle, documentStatus, expiresAt }) => ({ id, documentType, documentTitle, documentStatus, expiresAt })),
    people: (contacts?.contacts ?? []).map((contact) => ({
      personId: contact.person.id,
      displayName:
        [contact.current.name?.givenName, contact.current.name?.familyName].filter((part): part is string => Boolean(part)).join(" ") || `Person ${contact.person.id.slice(0, 8)}`,
    })),
    openEngagement: open
      ? {
          id: open.engagement.id,
          scopes: open.current.scopes.map((scope) => ({
            id: scope.id,
            productLevel: scope.productLevel,
            serviceCode: scope.serviceCode,
            responsibilityStartsAt: open.current.responsibilities.find((row) => row.scopeId === scope.id)?.effectiveFrom ?? null,
          })),
        }
      : null,
  }
}

// --- mutations (CONTRACT_MANAGE) -------------------------------------------------------------------------------------

export async function createContractDraft(organizationId: string, input: { contractReference?: unknown }): Promise<string> {
  const relationship = await getCustomerRelationship(organizationId)
  if (!relationship.customer || !relationship.openEngagement) {
    throw new ContractStateError("A contract needs an established customer relationship with an open engagement.", ["CUSTOMER_RELATIONSHIP"])
  }
  return manage((ctx) =>
    operations.createContractDraft(ctx, {
      organizationId,
      customerId: relationship.customer!.id,
      engagementId: relationship.openEngagement!.engagement.id,
      contractReference: input.contractReference,
    }),
  )
}

export const updateContractDraft = (input: Parameters<typeof operations.updateContractDraft>[1]) => manage((ctx) => operations.updateContractDraft(ctx, input))
export const establishAccountabilityBaseline = (input: Parameters<typeof operations.establishAccountabilityBaseline>[1]) =>
  manage((ctx) => operations.establishAccountabilityBaseline(ctx, input))
export const attachServiceScopes = (input: Parameters<typeof operations.attachServiceScopes>[1]) => manage((ctx) => operations.attachServiceScopes(ctx, input))
export const detachServiceScope = (input: Parameters<typeof operations.detachServiceScope>[1]) => manage((ctx) => operations.detachServiceScope(ctx, input))
export const defineResponsibilityBoundary = (input: Parameters<typeof operations.defineResponsibilityBoundary>[1]) =>
  manage((ctx) => operations.defineResponsibilityBoundary(ctx, input))
export const assignPricingPackage = (input: Parameters<typeof operations.assignPricingPackage>[1]) => manage((ctx) => operations.assignPricingPackage(ctx, input))
export const linkContractEvidence = (input: Parameters<typeof operations.linkContractEvidence>[1]) => manage((ctx) => operations.linkContractEvidence(ctx, input))
export const advanceContractStatus = (input: Parameters<typeof operations.advanceContractStatus>[1]) => manage((ctx) => operations.advanceContractStatus(ctx, input))
export const definePackage = (organizationId: string, input: Omit<Parameters<typeof operations.definePackage>[1], "organizationId">) =>
  manage((ctx) => operations.definePackage(ctx, { ...input, organizationId }))
export const assignCustomerAuthority = (input: Parameters<typeof operations.assignCustomerAuthority>[1]) => manage((ctx) => operations.assignCustomerAuthority(ctx, input))
export const revokeCustomerAuthority = (input: Parameters<typeof operations.revokeCustomerAuthority>[1]) => manage((ctx) => operations.revokeCustomerAuthority(ctx, input))

/** Read-only validation of the customer's current authority holders (CONTRACT_READ). */
export async function validateAuthorities(organizationId: string): Promise<operations.AuthorityValidation> {
  const relationship = await getCustomerRelationship(organizationId)
  if (!relationship.customer) throw new ContractValidationError("organizationId", "The organization is not a customer yet.")
  const customerId = relationship.customer.id
  return withAuthorizedSystem("CONTRACT_READ", (client) => operations.validateAuthorities(client, customerId, organizationId))
}

/** Dispatches one contracts API action. Unknown actions are refused; nothing here deletes anything. */
export async function applyContractsAction(organizationId: string, input: Record<string, unknown>): Promise<ContractsWorkspace> {
  switch (input.action) {
    case "createDraft":
      await createContractDraft(organizationId, { contractReference: input.contractReference })
      break
    case "updateDraft":
      await updateContractDraft({ contractId: input.contractId, contractReference: input.contractReference, syncAuthorities: input.syncAuthorities })
      break
    case "establishBaseline":
      await establishAccountabilityBaseline({ contractId: input.contractId })
      break
    case "attachScopes":
      await attachServiceScopes({ contractId: input.contractId, scopeIds: input.scopeIds })
      break
    case "detachScope":
      await detachServiceScope({ lineItemId: input.lineItemId })
      break
    case "defineResponsibility":
      await defineResponsibilityBoundary({ lineItemId: input.lineItemId, decisionEvidenceDocumentId: input.decisionEvidenceDocumentId, rows: input.rows })
      break
    case "assignPricing":
      await assignPricingPackage({
        lineItemId: input.lineItemId,
        decisionEvidenceDocumentId: input.decisionEvidenceDocumentId,
        pricingBasis: input.pricingBasis,
        packageCode: input.packageCode,
        feeMinorUnits: input.feeMinorUnits,
        feeCurrency: input.feeCurrency,
      })
      break
    case "definePackage":
      await definePackage(organizationId, { packageCode: input.packageCode, packageName: input.packageName, pricingBasis: input.pricingBasis })
      break
    case "linkEvidence":
      await linkContractEvidence({ contractId: input.contractId, ruleCode: input.ruleCode, evidenceDocumentId: input.evidenceDocumentId })
      break
    case "assignAuthority": {
      const relationship = await getCustomerRelationship(organizationId)
      if (!relationship.customer) throw new ContractStateError("The organization is not a customer yet.", ["CUSTOMER_RELATIONSHIP"])
      await assignCustomerAuthority({
        customerId: relationship.customer.id,
        organizationId,
        personId: input.personId,
        authorityType: input.authorityType,
        noticeEvidenceDocumentId: input.noticeEvidenceDocumentId,
        effectiveFrom: input.effectiveFrom,
      })
      break
    }
    case "revokeAuthority":
      await revokeCustomerAuthority({ assignmentId: input.assignmentId, noticeEvidenceDocumentId: input.noticeEvidenceDocumentId })
      break
    case "advanceStatus":
      await advanceContractStatus({ contractId: input.contractId, toStatus: input.toStatus, evidenceDocumentId: input.evidenceDocumentId })
      break
    default:
      throw new ContractValidationError("action", "Unsupported contracts action.")
  }
  return getContractsWorkspace(organizationId)
}
