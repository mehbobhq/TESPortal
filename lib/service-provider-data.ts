import { createId, isoNow } from "@/lib/vehicle-data"

export type ServiceProviderType = "REPAIR_SHOP" | "DEALER" | "TIRE_SHOP" | "MOBILE_MECHANIC" | "TOWING_RECOVERY" | "PARTS_SUPPLIER" | "INSPECTION_FACILITY" | "REEFER_SPECIALIST" | "BODY_SHOP" | "OTHER"

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

export interface ServiceProviderFacility {
  id: string
  name: string
  addressLine1: string
  city: string
  region: string
  postalCode?: string
  country: "CA" | "US" | "OTHER"
  phone?: string
  email?: string
  mobileService: boolean
  towingAvailable: boolean
  active: boolean
}

export interface ServiceProviderContact {
  id: string
  facilityId?: string
  fullName: string
  role?: string
  phone?: string
  email?: string
  technicianLicenceNumber?: string
  active: boolean
}

export interface ServiceProviderProfile {
  id: string
  /** Links to the reusable TES organization/company entity. */
  organizationId: string
  legalName: string
  tradeName?: string
  providerTypes: ServiceProviderType[]
  taxRegistrationNumber?: string
  businessNumber?: string
  website?: string
  generalPhone?: string
  generalEmail?: string
  facilities: ServiceProviderFacility[]
  contacts: ServiceProviderContact[]
  capabilities: string[]
  formerNames: string[]
  active: boolean
  createdAt: string
  updatedAt: string
}

interface ServiceProviderStore {
  version: 1
  providers: ServiceProviderProfile[]
}

const STORAGE_KEY = "tes_service_provider_store_v1"

function readStore(): ServiceProviderStore {
  if (typeof window === "undefined") return { version: 1, providers: [] }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Partial<ServiceProviderStore>
    return { version: 1, providers: Array.isArray(parsed.providers) ? parsed.providers : [] }
  } catch {
    return { version: 1, providers: [] }
  }
}

function writeStore(store: ServiceProviderStore): void {
  if (typeof window === "undefined") throw new Error("Service providers can only be saved in the browser.")
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function normalized(value?: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function getServiceProviderByOrganizationId(organizationId: string): ServiceProviderProfile | undefined {
  return readStore().providers.find((provider) => provider.organizationId === organizationId && provider.active)
}

export function listServiceProviders(): ServiceProviderProfile[] {
  return readStore().providers.filter((provider) => provider.active).sort((a, b) => a.legalName.localeCompare(b.legalName))
}

export function createServiceProviderProfile(input: {
  organizationId: string
  legalName: string
  tradeName?: string
  providerType: ServiceProviderType
  additionalProviderTypes?: ServiceProviderType[]
  taxRegistrationNumber?: string
  businessNumber?: string
  website?: string
  phone?: string
  email?: string
  facilityName?: string
  addressLine1: string
  city: string
  region: string
  postalCode?: string
  country: "CA" | "US" | "OTHER"
  mobileService?: boolean
  towingAvailable?: boolean
  contactName?: string
  contactRole?: string
  contactPhone?: string
  contactEmail?: string
  technicianLicenceNumber?: string
  capabilities?: string[]
}): ServiceProviderProfile {
  const store = readStore()
  const organizationProfile = store.providers.find((provider) => provider.active && provider.organizationId === input.organizationId)
  if (organizationProfile) throw new Error(`${organizationProfile.legalName} already has an active service-provider profile. Use the existing provider record.`)
  const taxNumber = normalized(input.taxRegistrationNumber)
  const duplicate = store.providers.find((provider) => provider.active && (
    (taxNumber && normalized(provider.taxRegistrationNumber) === taxNumber)
    || (
      normalized(provider.legalName) === normalized(input.legalName)
      && normalized(provider.facilities[0]?.addressLine1) === normalized(input.addressLine1)
      && normalized(provider.facilities[0]?.city) === normalized(input.city)
    )
  ))
  if (duplicate) throw new Error(`Possible duplicate service provider: ${duplicate.legalName}.`)

  const now = isoNow()
  const facilityId = createId("SPFAC")
  const profile: ServiceProviderProfile = {
    id: createId("SP"),
    organizationId: input.organizationId,
    legalName: input.legalName.trim(),
    tradeName: input.tradeName?.trim() || undefined,
    providerTypes: Array.from(new Set([input.providerType, ...(input.additionalProviderTypes || [])])),
    taxRegistrationNumber: input.taxRegistrationNumber?.trim() || undefined,
    businessNumber: input.businessNumber?.trim() || undefined,
    website: input.website?.trim() || undefined,
    generalPhone: input.phone?.trim() || undefined,
    generalEmail: input.email?.trim() || undefined,
    facilities: [{
      id: facilityId,
      name: input.facilityName?.trim() || input.tradeName?.trim() || input.legalName.trim(),
      addressLine1: input.addressLine1.trim(),
      city: input.city.trim(),
      region: input.region.trim(),
      postalCode: input.postalCode?.trim() || undefined,
      country: input.country,
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim() || undefined,
      mobileService: Boolean(input.mobileService),
      towingAvailable: Boolean(input.towingAvailable),
      active: true,
    }],
    contacts: input.contactName?.trim() ? [{
      id: createId("SPCON"),
      facilityId,
      fullName: input.contactName.trim(),
      role: input.contactRole?.trim() || undefined,
      phone: input.contactPhone?.trim() || undefined,
      email: input.contactEmail?.trim() || undefined,
      technicianLicenceNumber: input.technicianLicenceNumber?.trim() || undefined,
      active: true,
    }] : [],
    capabilities: (input.capabilities || []).map((value) => value.trim()).filter(Boolean),
    formerNames: [],
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  writeStore({ version: 1, providers: [profile, ...store.providers] })
  return profile
}
