/**
 * Service-provider profiles used by the repair-bill form. The original module kept them in this browser's storage; there is no
 * canonical service-provider record, so reads answer "none recorded" and creating a profile refuses with
 * CanonicalOperationUnavailableError. Types are the original types (erased at build time).
 */
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import type {
  ServiceProviderProfile,
  ServiceProviderType,
  createServiceProviderProfile as OriginalCreateServiceProviderProfile,
} from "@/lib/service-provider-data"

export type { ServiceProviderProfile, ServiceProviderType } from "@/lib/service-provider-data"

export const PROVIDER_TYPE_OPTIONS: { value: ServiceProviderType; label: string }[] = [
  { value: "REPAIR_SHOP", label: "Repair shop" },
  { value: "DEALER", label: "Dealer" },
  { value: "TIRE_SHOP", label: "Tire shop" },
  { value: "MOBILE_MECHANIC", label: "Mobile mechanic" },
  { value: "TOWING_RECOVERY", label: "Towing/recovery" },
  { value: "PARTS_SUPPLIER", label: "Parts supplier" },
  { value: "INSPECTION_FACILITY", label: "Inspection facility" },
  { value: "REEFER_SPECIALIST", label: "Reefer specialist" },
  { value: "BODY_SHOP", label: "Body/collision shop" },
  { value: "OTHER", label: "Other" },
]

export function getServiceProviderByOrganizationId(_organizationId: string): ServiceProviderProfile | undefined {
  return undefined
}

export function listServiceProviders(): ServiceProviderProfile[] {
  return []
}

export const createServiceProviderProfile: typeof OriginalCreateServiceProviderProfile = () => {
  throw new CanonicalOperationUnavailableError(
    "Creating a service-provider profile",
    "service providers have no canonical record yet, and the browser-local provider store is not used by the TES records view",
  )
}
