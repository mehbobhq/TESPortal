/**
 * TES capability references.
 *
 * PostgreSQL (`public.capabilities`) is the catalogue of record: existence,
 * active state, display names and descriptions live there and are seeded only by
 * migrations. This file is NOT a second catalogue. It lists only the capability
 * CODES that application code is allowed to request, plus the one policy fact the
 * schema cannot express - the scope each capability is requested under - so that:
 *
 *   - a typo in a capability name is a compile error;
 *   - withAuthorizedSystem() only accepts SYSTEM capabilities and
 *     withAuthorizedCustomer() only accepts CUSTOMER capabilities;
 *   - the evaluator can refuse a capability requested under the wrong scope;
 *   - a drift test can prove every code here exists and is active in PostgreSQL
 *     and that the scope here matches the "Intended scope" sentence in the
 *     capability's database description.
 *
 * Adding a capability: seed it in a migration, then add one line here. The drift
 * test fails if the two ever disagree.
 *
 * This module intentionally does not import "server-only": it contains no secrets
 * and no server behavior, and it must be importable by tests.
 */

export type TesCapabilityScope = "SYSTEM" | "CUSTOMER"

export const TES_CAPABILITY_SCOPES = {
  // Companies / Organization / Customer foundation (migration 0011).
  ORGANIZATION_READ: "CUSTOMER",
  ORGANIZATION_REGISTRY_READ: "SYSTEM",
  ORGANIZATION_CREATE: "SYSTEM",
  ORGANIZATION_UPDATE: "SYSTEM",
  ORGANIZATION_ARCHIVE: "SYSTEM",
  CUSTOMER_ESTABLISH: "SYSTEM",
  // Contacts / People foundation (migration 0014).
  PERSON_REGISTRY_READ: "SYSTEM",
  CONTACT_MANAGE: "SYSTEM",
  // Customer Relationship foundation (migration 0015). CUSTOMER_ESTABLISH (0011) keeps establishing / re-engaging.
  CUSTOMER_RELATIONSHIP_READ: "SYSTEM",
  CUSTOMER_RELATIONSHIP_MANAGE: "SYSTEM",
  // Tax / Registration foundation (migration 0016).
  TAX_REGISTRATION_READ: "SYSTEM",
  TAX_REGISTRATION_MANAGE: "SYSTEM",
  // Insurance foundation (migration 0017).
  INSURANCE_READ: "SYSTEM",
  INSURANCE_MANAGE: "SYSTEM",
  // Company Credentials foundation (migration 0018). No capability reveals a secret: no secret value exists in PostgreSQL.
  CREDENTIAL_READ: "SYSTEM",
  CREDENTIAL_MANAGE: "SYSTEM",
  // Company Operating Profile foundation (migration 0019).
  COMPANY_PROFILE_READ: "SYSTEM",
  COMPANY_PROFILE_MANAGE: "SYSTEM",
  // Core Operational Identity Graph (migrations 0020-0023).
  VEHICLE_READ: "SYSTEM",
  VEHICLE_MANAGE: "SYSTEM",
  DRIVER_READ: "SYSTEM",
  DRIVER_MANAGE: "SYSTEM",
  // Driver identity verification against evidence (migration 0037).
  DRIVER_IDENTITY_VERIFY: "SYSTEM",
  IDENTITY_RESOLUTION_READ: "SYSTEM",
  IDENTITY_RESOLUTION_MANAGE: "SYSTEM",
  // Master Register enumeration is explicit; ordinary authorized operations may append without gaining read access.
  MASTER_REGISTER_READ: "SYSTEM",
  // Canonical Data Cutover / browser authority retirement (migration 0029).
  LEGACY_IMPORT_READ: "SYSTEM",
  LEGACY_IMPORT_MANAGE: "SYSTEM",
  // Onboarding evidence, readiness, customer authority and contracts foundation (migration 0030).
  EVIDENCE_READ: "SYSTEM",
  EVIDENCE_MANAGE: "SYSTEM",
  CONTRACT_READ: "SYSTEM",
  CONTRACT_MANAGE: "SYSTEM",
  // Restricted person identity details shown in Contacts: date of birth and the person's driving licence record (migration 0035).
  PERSON_IDENTITY_READ: "SYSTEM",
  PERSON_IDENTITY_MANAGE: "SYSTEM",
  // Executing a registered legal-name change (migration 0036). Granted to the Onboarding Team; the Master Account always satisfies it.
  COMPANY_LEGAL_NAME_CHANGE: "SYSTEM",
} as const satisfies Record<string, TesCapabilityScope>

export type TesCapability = keyof typeof TES_CAPABILITY_SCOPES

type CapabilitiesWithScope<S extends TesCapabilityScope> = {
  [K in TesCapability]: (typeof TES_CAPABILITY_SCOPES)[K] extends S ? K : never
}[TesCapability]

/** Capabilities that are requested under SYSTEM scope only. */
export type TesSystemCapability = CapabilitiesWithScope<"SYSTEM">

/** Capabilities that are requested under CUSTOMER scope only. */
export type TesCustomerCapability = CapabilitiesWithScope<"CUSTOMER">

/** Every capability code application code may request. */
export const TES_CAPABILITY_CODES = Object.keys(TES_CAPABILITY_SCOPES) as TesCapability[]

/**
 * Runtime guard for values that crossed a type boundary (casts, JSON, tests).
 * Strict: no trimming and no case folding, so a near-miss never resolves.
 */
export function isTesCapability(value: unknown): value is TesCapability {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TES_CAPABILITY_SCOPES, value)
  )
}

export function tesCapabilityScope(capability: TesCapability): TesCapabilityScope {
  return TES_CAPABILITY_SCOPES[capability]
}
