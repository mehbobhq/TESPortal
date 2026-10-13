import "server-only"

import type { TesSystemCapability } from "@/lib/auth/tes-capabilities"
import { hasAdditionalSystemCapability, withAuthorizedSystem } from "@/lib/auth/tes-system-context"
import { domainContext, enterSystemCapability, runDeferredChecks } from "@/lib/company-directory/capability-context"
import {
  addressBlockPresent,
  CompanyCreationValidationError,
  OPERATING_SCOPE_BY_OP_REGION,
  planAddressBlock,
  type CompanyCreationIssue,
  type PlannedAddress,
} from "@/lib/company-directory/creation-input"
import { CompanyCreationCapabilityError } from "@/lib/company-directory/create-company"
import { CompanyProfileConflictError } from "@/lib/company-profile/errors"
import * as profileOperations from "@/lib/company-profile/operations"
import * as customerOperations from "@/lib/customer-relationship/operations"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as locationOperations from "@/lib/organization-locations/operations"

const UPDATE_KEYS = new Set([
  "opRegion",
  "addressMode",
  ...(["reg", "mail", "yard"] as const).flatMap((prefix) => (["street", "city", "state", "zip", "country"] as const).map((part) => `${prefix}_${part}`)),
])

const IDENTITY_EDIT_KEYS = new Set(["companyName", "dba", "incorpNo", "businessNo", "ein"])

export type CompanyDetailsUpdate = {
  /** "change": the address really moved (the old one stays as history). "correct": the old one was recorded wrongly. */
  addressMode: "change" | "correct"
  operatingScope: { changed: boolean; value: string | null }
  addresses: Array<{ role: PlannedAddress["role"]; action: "created" | "changed" | "corrected" | "unchanged" }>
}

const prefixes = ["reg", "mail", "yard"] as const

/**
 * Edits the details that live in the Operating Profile and Locations domains, in ONE transaction: operating region, and the
 * registered / mailing / yard addresses (each independently). Only submitted fields are touched; an unchanged value is left
 * alone; nothing is ever silently cleared (an address block is all-or-nothing and cannot be blanked here).
 *
 * Every write is the existing domain operation (own validation, own Master Register event). An address that already exists is
 * revised with changeLocationAddress (real move; history kept) or correctLocationAddress (it was wrong), per `addressMode`.
 */
export type DetailsPlan = { mode: "change" | "correct"; scope: string | null; planned: PlannedAddress[] }

/** Pure validation of the details part of an edit; throws CompanyCreationValidationError listing every problem. */
export function planCompanyDetails(raw: unknown): DetailsPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CompanyCreationValidationError([{ field: "body", message: "A JSON object is required." }])
  const input = raw as Record<string, unknown>
  const issues: CompanyCreationIssue[] = []
  for (const [key, value] of Object.entries(input)) {
    if (!UPDATE_KEYS.has(key) && !IDENTITY_EDIT_KEYS.has(key) && value !== "" && value != null) issues.push({ field: key, message: "This field cannot be edited here and was not saved." })
  }

  const mode = input.addressMode === undefined || input.addressMode === "" ? "change" : input.addressMode
  if (mode !== "change" && mode !== "correct") issues.push({ field: "addressMode", message: "addressMode must be 'change' or 'correct'." })

  let scope: string | null = null
  if (typeof input.opRegion === "string" && input.opRegion.trim() !== "") {
    scope = (OPERATING_SCOPE_BY_OP_REGION as Record<string, string>)[input.opRegion.trim()] ?? null
    if (!scope) issues.push({ field: "opRegion", message: `Unsupported operating region '${input.opRegion}'.` })
  }

  const planned: PlannedAddress[] = []
  for (const prefix of prefixes) {
    if (!addressBlockPresent(input, prefix)) continue
    const result = planAddressBlock(input, prefix)
    if ("field" in result) issues.push(result)
    else planned.push(result)
  }
  if (issues.length > 0) throw new CompanyCreationValidationError(issues)
  return { mode: mode as "change" | "correct", scope, planned }
}

export function hasDetailsToUpdate(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false
  return Object.entries(raw as Record<string, unknown>).some(([key, value]) => UPDATE_KEYS.has(key) && key !== "addressMode" && typeof value === "string" && value.trim() !== "")
}

export async function updateCompanyDetails(organizationId: string, raw: unknown): Promise<CompanyDetailsUpdate> {
  const { mode, scope, planned } = planCompanyDetails(raw)
  return withAuthorizedSystem("ORGANIZATION_UPDATE", async (client, decision) => {
    const required: TesSystemCapability[] = []
    if (scope) required.push("COMPANY_PROFILE_MANAGE")
    if (planned.some((p) => p.role !== "REGISTERED")) required.push("CUSTOMER_RELATIONSHIP_READ")
    const missing: TesSystemCapability[] = []
    for (const capability of required) if (!(await hasAdditionalSystemCapability(client, decision, capability))) missing.push(capability)
    if (missing.length > 0) throw new CompanyCreationCapabilityError(missing)

    const result: CompanyDetailsUpdate = { addressMode: mode, operatingScope: { changed: false, value: scope }, addresses: [] }
    const actor = { id: decision.actor.id, actorType: decision.actor.actorType }

    if (planned.some((p) => p.role !== "REGISTERED")) {
      await enterSystemCapability(client, "CUSTOMER_RELATIONSHIP_READ")
      const relationship = await customerOperations.readCustomerRelationship(client, organizationId)
      if (!relationship.customer) {
        throw new CompanyCreationValidationError([{ field: "mail_street", message: "Mailing and yard addresses apply to Customer records only." }])
      }
    }

    if (scope) {
      await enterSystemCapability(client, "COMPANY_PROFILE_MANAGE")
      try {
        await profileOperations.setOperatingScope({ client, actor, masterRegister: new PostgresMasterRegisterRepository(client) }, { organizationId, operatingScope: scope })
        result.operatingScope.changed = true
      } catch (error) {
        if (!(error instanceof CompanyProfileConflictError)) throw error
      }
      await runDeferredChecks(client)
    }

    if (planned.length > 0) {
      await enterSystemCapability(client, "ORGANIZATION_UPDATE")
      const ctx = domainContext(client, decision, "ORGANIZATION_REGISTRY_READ")
      const view = await locationOperations.readOrganizationLocations(client, organizationId)
      for (const next of planned) {
        const existing = view.current[next.role]
        if (!existing) {
          await locationOperations.createLocation(ctx, { kind: "PHYSICAL", address: next.address, assignment: { organizationId, role: next.role } })
          result.addresses.push({ role: next.role, action: "created" })
          continue
        }
        const now = existing.address
        const same =
          now !== null &&
          now.country === next.address.country &&
          now.region === next.address.region &&
          now.locality.trim().toLowerCase() === next.address.locality.trim().toLowerCase() &&
          (now.postalCode ?? "").replace(/\s+/g, "").toUpperCase() === (next.address.postalCode ?? "").replace(/\s+/g, "").toUpperCase() &&
          [now.addressLine1, now.addressLine2, now.unit].filter(Boolean).join(", ").trim().toLowerCase() === next.address.addressLine1.trim().toLowerCase()
        if (same) {
          result.addresses.push({ role: next.role, action: "unchanged" })
          continue
        }
        const args = { organizationId, locationId: existing.location.id, address: next.address }
        if (mode === "correct") await locationOperations.correctLocationAddress(ctx, args)
        else await locationOperations.changeLocationAddress(ctx, args)
        result.addresses.push({ role: next.role, action: mode === "correct" ? "corrected" : "changed" })
      }
      await runDeferredChecks(client)
    }
    return result
  })
}

