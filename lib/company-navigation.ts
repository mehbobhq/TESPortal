export type CompanyNavigationItem = {
  title: string
  segment: string
  customerOnly?: boolean
}

/**
 * Single source of truth for every company-scoped navigation surface.
 * The sidebar and /companies/[id] tab layout must both consume this list.
 */
export const COMPANY_NAVIGATION_ITEMS: readonly CompanyNavigationItem[] = [
  { title: "Profile", segment: "profile" },
  { title: "Business", segment: "business", customerOnly: true },
  { title: "Contacts", segment: "contacts" },
  { title: "Insurance", segment: "insurance", customerOnly: true },
  { title: "Authorities", segment: "authorities", customerOnly: true },
  { title: "Tax Filing", segment: "tax-filing", customerOnly: true },
  { title: "Vehicles", segment: "vehicles", customerOnly: true },
  { title: "Drivers", segment: "drivers", customerOnly: true },
  { title: "Citations", segment: "citations", customerOnly: true },
  { title: "Record of Events", segment: "record-of-events", customerOnly: true },
  { title: "Customs", segment: "customs", customerOnly: true },
  { title: "Programs", segment: "programs", customerOnly: true },
  { title: "Credentials", segment: "credentials" },
  { title: "Settings", segment: "settings" },
] as const

export function getCompanyNavigationItems(companyKind?: string | null) {
  const isCustomer = companyKind === "Customer"
  return COMPANY_NAVIGATION_ITEMS.filter((item) => isCustomer || !item.customerOnly)
}

export function companyNavigationHref(companyId: string, segment: string) {
  return `/companies/${companyId}/${segment}`
}

