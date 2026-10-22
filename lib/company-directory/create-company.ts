import "server-only"

import type { TesSystemCapability } from "@/lib/auth/tes-capabilities"
import { hasAdditionalSystemCapability, withAuthorizedSystem } from "@/lib/auth/tes-system-context"
import { CompanyCreationCapabilityError, domainContext, enterSystemCapability, runDeferredChecks } from "@/lib/company-directory/capability-context"
import * as profileFacts from "@/lib/company-profile/facts"
import * as profileOperations from "@/lib/company-profile/operations"
import * as contactOperations from "@/lib/contacts/operations"
import * as corporateOperations from "@/lib/corporate-identity/operations"
import * as customerOperations from "@/lib/customer-relationship/operations"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as authorityOperations from "@/lib/operating-authorities/operations"
import * as locationOperations from "@/lib/organization-locations/operations"
import * as taxOperations from "@/lib/tax-registrations/operations"
import { parseCreateCompanyInput, type CompanyCreationPlan } from "@/lib/company-directory/creation-input"

export { CompanyCreationCapabilityError }

export type CompanyCreationRecorded = {
  identifiers: number
  tradeName: boolean
  customer: boolean
  operatingScope: string
  primaryContact: boolean
  channels: number
  addresses: Array<"REGISTERED" | "MAILING" | "HOME_YARD">
  authorities: string[]
  registrations: string[]
  cargoCategories: number
  fleetProviders: Array<"ELD" | "GPS" | "FUEL">
  billingPreference: boolean
}

export type CompanyCreationResult = {
  organizationId: string
  displayName: string
  status: "active" | "archived" | "merged"
  primaryClassification: string | null
  formationCountry: string | null
  formationRegion: string | null
  recorded: CompanyCreationRecorded
  /** Advisory duplicate candidates (same legal name, or a formerly held identifier). Present only for callers who may read the registry; never a decision. */
  possibleDuplicates: Array<{ organizationId: string; legalName: string; reason: "SAME_LEGAL_NAME" | "SUPERSEDED_IDENTIFIER" }>
}

/** Capabilities the plan needs in addition to ORGANIZATION_CREATE (which the transaction wrapper has already proven). */
export function requiredCapabilities(plan: CompanyCreationPlan): TesSystemCapability[] {
  const required = new Set<TesSystemCapability>(["COMPANY_PROFILE_MANAGE"])
  if (plan.isCustomer) required.add("CUSTOMER_ESTABLISH")
  if (plan.addresses.length > 0 || plan.authorities.length > 0) required.add("ORGANIZATION_UPDATE")
  if (plan.contact || plan.channels.length > 0) required.add("CONTACT_MANAGE")
  if (plan.registrations.length > 0) required.add("TAX_REGISTRATION_MANAGE")
  if (plan.paymentMethod) required.add("CUSTOMER_RELATIONSHIP_MANAGE")
  return [...required]
}

/**
 * Creates the whole company record in ONE transaction: every canonical domain write, and its Master Register event, commit
 * together or not at all. A failure anywhere (validation, a number already registered to another company, authorization)
 * leaves no Organization, Customer, Location, Contact, Authority or Registration behind, so a retry starts clean.
 *
 * Each domain is written through its own operations module (never by SQL here), so every domain rule, uniqueness guard and
 * accountability event still applies exactly as it does when that domain is edited on its own.
 */
export async function createCompanyRecord(raw: unknown): Promise<CompanyCreationResult> {
  const plan = parseCreateCompanyInput(raw)

  return withAuthorizedSystem("ORGANIZATION_CREATE", async (client, decision) => {
    const missing: TesSystemCapability[] = []
    for (const capability of requiredCapabilities(plan)) {
      if (!(await hasAdditionalSystemCapability(client, decision, capability))) missing.push(capability)
    }
    if (missing.length > 0) throw new CompanyCreationCapabilityError(missing)

    const actor = { id: decision.actor.id, actorType: decision.actor.actorType }
    const masterRegister = new PostgresMasterRegisterRepository(client)
    const recorded: CompanyCreationRecorded = {
      identifiers: plan.organization.identifiers?.length ?? 0,
      tradeName: (plan.organization.aliases?.length ?? 0) > 0,
      customer: false,
      operatingScope: plan.operatingScope,
      primaryContact: false,
      channels: 0,
      addresses: [],
      authorities: [],
      registrations: [],
      cargoCategories: 0,
      fleetProviders: [],
      billingPreference: false,
    }

    // 1. Corporate identity (ORGANIZATION_CREATE is already in force).
    const created = await corporateOperations.createOrganization(
      { client, actor, masterRegister, canViewRegistry: () => hasAdditionalSystemCapability(client, decision, "ORGANIZATION_REGISTRY_READ") },
      plan.organization,
    )
    const organization = created.organization
    const organizationId = organization.id
    await runDeferredChecks(client)

    // 2. Customer relationship.
    if (plan.isCustomer) {
      await enterSystemCapability(client, "CUSTOMER_ESTABLISH")
      await customerOperations.establishCustomerRelationship({ client, actor, masterRegister }, {
        organizationId,
        engagementType: "RECURRING",
        stage: "ONBOARDING",
        startedAt: plan.customerStartedAt,
      })
      recorded.customer = true
      await runDeferredChecks(client)
    }

    // 3. Operating scope.
    await enterSystemCapability(client, "COMPANY_PROFILE_MANAGE")
    await profileOperations.setOperatingScope({ client, actor, masterRegister }, { organizationId, operatingScope: plan.operatingScope })
    // 3b. Customer profile facts that belong to the operating profile: cargo categories and fleet provider names.
    if (plan.cargoCategories.length > 0) {
      await profileFacts.setCargoCategories({ client, actor, masterRegister }, { organizationId, categories: plan.cargoCategories })
      recorded.cargoCategories = plan.cargoCategories.length
    }
    for (const provider of plan.fleetProviders) {
      await profileFacts.setFleetProvider({ client, actor, masterRegister }, { organizationId, kind: provider.kind, providerName: provider.name })
      recorded.fleetProviders.push(provider.kind)
    }
    await runDeferredChecks(client)

    // 3c. The Customer's billing preference (a preference only; never contract terms).
    if (plan.paymentMethod) {
      await enterSystemCapability(client, "CUSTOMER_RELATIONSHIP_MANAGE")
      await profileFacts.setBillingPreference({ client, actor, masterRegister }, { organizationId, paymentMethod: plan.paymentMethod })
      recorded.billingPreference = true
      await runDeferredChecks(client)
    }

    // 4. Addresses: registered, mailing and yard stay independent assignments.
    if (plan.addresses.length > 0 || plan.authorities.length > 0) await enterSystemCapability(client, "ORGANIZATION_UPDATE")
    for (const planned of plan.addresses) {
      await locationOperations.createLocation(domainContext(client, decision, "ORGANIZATION_REGISTRY_READ"), {
        kind: "PHYSICAL",
        address: planned.address,
        assignment: { organizationId, role: planned.role },
      })
      recorded.addresses.push(planned.role)
    }
    if (plan.addresses.length > 0) await runDeferredChecks(client)

    // 5. Contacts.
    if (plan.contact || plan.channels.length > 0) await enterSystemCapability(client, "CONTACT_MANAGE")
    if (plan.contact?.kind === "new") {
      await contactOperations.createContact(domainContext(client, decision, "PERSON_REGISTRY_READ"), {
        organizationId,
        name: { ...(plan.contact.givenName ? { givenName: plan.contact.givenName } : {}), ...(plan.contact.familyName ? { familyName: plan.contact.familyName } : {}) },
        purposes: [{ purpose: "PRIMARY", primary: true }],
        // The new person's own designated email is the company's Account Email (a person channel, preferred). The company phone and the
        // billing email stay company-level channels below and are never assigned to the person.
        ...(plan.contact.accountEmail ? { channels: [{ type: "EMAIL", value: plan.contact.accountEmail, preferred: true }] } : {}),
      })
      recorded.primaryContact = true
    } else if (plan.contact?.kind === "existing") {
      // The user chose this person explicitly: the same person is related to the new company (no second person record is created,
      // nothing is merged). The person stays visible through the registry only for a caller who may read it.
      const contactContext = domainContext(client, decision, "PERSON_REGISTRY_READ")
      const linked = await contactOperations.addRelationship(contactContext, { organizationId, personId: plan.contact.personId })
      await contactOperations.assignPurpose(contactContext, { organizationId, relationshipId: linked.relationship.id, purpose: "PRIMARY", primary: true })
      recorded.primaryContact = true
    }
    for (const channel of plan.channels) {
      await contactOperations.addOrganizationChannel(domainContext(client, decision, "PERSON_REGISTRY_READ"), {
        organizationId,
        channel: { type: channel.type, value: channel.value, usage: channel.usage },
      })
      recorded.channels += 1
    }
    if (plan.contact || plan.channels.length > 0) await runDeferredChecks(client)

    // 6. Operating authorities (ORGANIZATION_UPDATE).
    if (plan.authorities.length > 0) await enterSystemCapability(client, "ORGANIZATION_UPDATE")
    for (const authority of plan.authorities) {
      await authorityOperations.createAuthority(domainContext(client, decision, "ORGANIZATION_REGISTRY_READ"), {
        organizationId,
        kind: authority.kind,
        number: authority.number,
        ...(authority.jurisdiction ? { jurisdiction: authority.jurisdiction } : {}),
      })
      recorded.authorities.push(authority.kind)
    }
    if (plan.authorities.length > 0) await runDeferredChecks(client)

    // 7. Tax registrations and carrier codes.
    if (plan.registrations.length > 0) await enterSystemCapability(client, "TAX_REGISTRATION_MANAGE")
    for (const registration of plan.registrations) {
      await taxOperations.createRegistration(domainContext(client, decision, "TAX_REGISTRATION_READ"), {
        organizationId,
        program: registration.program,
        number: registration.number,
        ...(registration.jurisdiction ? { jurisdiction: registration.jurisdiction } : {}),
      })
      recorded.registrations.push(registration.program)
    }
    if (plan.registrations.length > 0) await runDeferredChecks(client)

    return {
      organizationId,
      displayName: organization.displayName ?? organization.legalName,
      status: organization.status,
      primaryClassification: organization.classifications.find((classification) => classification.isPrimary)?.code ?? null,
      formationCountry: organization.formationCountry,
      formationRegion: organization.formationRegion,
      recorded,
      possibleDuplicates: created.reviewMatches.map((match) => ({ organizationId: match.organizationId, legalName: match.legalName, reason: match.kind })),
    }
  })
}
