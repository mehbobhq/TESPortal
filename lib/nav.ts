import {
  LayoutDashboard,
  FileText,
  Settings,
  Route,
  ChartNoAxesCombined,
  Lightbulb,
  Building2,
  Users,
  UserCircle,
  Contact,
  ShieldCheck,
  Landmark,
  ReceiptText,
  Truck,
  IdCard,
  PackageCheck,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  title: string
  url: string
  icon: LucideIcon
  description: string
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        title: "Dashboard",
        url: "/",
        icon: LayoutDashboard,
        description: "Fleet compliance at a glance — expiring credentials, open filings, and risk signals.",
      },
      {
        title: "Reports",
        url: "/reports",
        icon: FileText,
        description: "Generate, schedule, and export operational and regulatory reports.",
      },
      {
        title: "Business Intelligence",
        url: "/business-intelligence",
        icon: ChartNoAxesCombined,
        description: "Trends across mileage, spend, and compliance performance over time.",
      },
      {
        title: "Decision Support",
        url: "/decision-support",
        icon: Lightbulb,
        description: "Recommended actions and scenario modeling to reduce compliance risk.",
      },
    ],
  },
  {
    label: "Compliance",
    items: [
      {
        title: "Trip Compliance",
        url: "/trip-compliance",
        icon: Route,
        description: "Cross-border trips, jurisdiction mileage, and IFTA-ready trip logs.",
      },
      {
        title: "Tax Filing",
        url: "/tax-filing",
        icon: ReceiptText,
        description: "IFTA and IRP quarterly filings, fuel tax reconciliation, and deadlines.",
      },
      {
        title: "Customs",
        url: "/customs",
        icon: PackageCheck,
        description: "Border crossings, manifests, ACE/ACI e-manifests, and bond status.",
      },
      {
        title: "Authorities",
        url: "/authorities",
        icon: Landmark,
        description: "Operating authorities, DOT/MC numbers, and regulator registrations.",
      },
      {
        title: "Insurance",
        url: "/insurance",
        icon: ShieldCheck,
        description: "Policies, certificates of insurance, and coverage expirations.",
      },
      {
        title: "Credentials",
        url: "/credentials",
        icon: IdCard,
        description: "Permits, licenses, and registrations across all jurisdictions.",
      },
      {
        title: "Programs",
        url: "/programs",
        icon: BadgeCheck,
        description: "Trusted-trader and safety programs — FAST, CTPAT, PIP, and more.",
      },
    ],
  },
  {
    label: "Fleet",
    items: [
      {
        title: "Vehicles",
        url: "/vehicles",
        icon: Truck,
        description: "Power units and trailers, plates, VINs, and compliance status.",
      },
      {
        title: "Drivers",
        url: "/drivers",
        icon: Users,
        description: "Driver roster, licenses, medical cards, and hours-of-service standing.",
      },
    ],
  },
  {
    label: "Relationships",
    items: [
      {
        title: "Companies",
        url: "/companies",
        icon: Building2,
        description: "Government agencies, insurance brokers, and carriers you work with.",
      },
      {
        title: "Customers",
        url: "/customers",
        icon: UserCircle,
        description: "Monthly and one-off clients, contracts, and billing status.",
      },
      {
        title: "Contacts",
        url: "/contacts",
        icon: Contact,
        description: "People across your companies and customers, and their roles.",
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        title: "Profile",
        url: "/profile",
        icon: UserCircle,
        description: "Your account details, notification preferences, and activity.",
      },
      {
        title: "Settings",
        url: "/settings",
        icon: Settings,
        description: "Organization, team access, integrations, and system preferences.",
      },
    ],
  },
]

export const allNavItems: NavItem[] = navGroups.flatMap((g) => g.items)

export function findNavItem(pathname: string): NavItem | undefined {
  return allNavItems.find((item) => item.url === pathname)
}
