export const navGroups = [
  {
    label: "Business",
    items: [
      {
        title: "Dashboard",
        url: "/",
      },
      {
        title: "Trip Compliance",
        url: "/trip-compliance",
      },
      {
        title: "Business Intelligence",
        url: "/business-intelligence",
      },
      {
        title: "Decision Support",
        url: "/decision-support",
      },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        title: "Reports",
        url: "/reports",
      },
      {
        title: "Settings",
        url: "/settings",
      },
      {
        title: "Companies",
        url: "/companies",
      },
    ],
  },
  {
    label: "Compliance",
    items: [
      {
        title: "Customers",
        url: "/customers",
      },
      {
        title: "Profile",
        url: "/profile",
      },
      {
        title: "Business",
        url: "/business",
      },
      {
        title: "Contacts",
        url: "/contacts",
      },
      {
        title: "Insurance",
        url: "/insurance",
      },
      {
        title: "Authorities",
        url: "/authorities",
      },
      {
        title: "Tax Filing",
        url: "/tax-filing",
      },
      {
        title: "Vehicles",
        url: "/vehicles",
      },
      {
        title: "Drivers",
        url: "/drivers",
      },
      {
        title: "Citations",
        url: "/citations",
      },
      {
        title: "Record of Events",
        url: "/record-of-events",
      },
      {
        title: "Customs",
        url: "/customs",
      },
      {
        title: "Programs",
        url: "/programs",
      },
      {
        title: "Credentials",
        url: "/credentials",
      },
      {
        title: "Settings",
        url: "/settings",
      },
    ],
  },
]

export function findNavItem(pathname: string) {
  for (const group of navGroups) {
    const item = group.items.find((item) => item.url === pathname)

    if (item) {
      return item
    }
  }

  return undefined
}
