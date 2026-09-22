import { COMPANY_NAVIGATION_ITEMS } from "@/lib/company-navigation"

export const navGroups = [
  {
    label: "Business",
    items: [
      { title: "Dashboard", url: "/" },
      { title: "Trip Compliance", url: "/trip-compliance" },
      { title: "Business Intelligence", url: "/business-intelligence" },
      { title: "Decision Support", url: "/decision-support" },
    ],
  },
  {
    label: "Reports",
    items: [
      { title: "Reports", url: "/reports" },
      { title: "Settings", url: "/settings" },
      { title: "Companies", url: "/companies" },
    ],
  },
  {
    label: "Compliance",
    items: [
      { title: "Customers", url: "/customers" },
      ...COMPANY_NAVIGATION_ITEMS.map((item) => ({
        title: item.title,
        url: `/${item.segment}`,
      })),
    ],
  },
] as const

export function findNavItem(pathname: string) {
  for (const group of navGroups) {
    const item = group.items.find((item) => item.url === pathname)
    if (item) return item
  }
  return undefined
}

