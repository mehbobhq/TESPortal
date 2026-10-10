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
