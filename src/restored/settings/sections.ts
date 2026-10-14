// Original Settings section navigation (labels, descriptions, icons), restored verbatim.
import { FileCheck2, Globe2, ReceiptText, ShieldCheck, Truck, Users } from "lucide-react"

export const SECTIONS = [
  {
    id: "overview",
    label: "Profile",
    description: "Operating scope",
    icon: Globe2,
  },
  {
    id: "cargo",
    label: "Cargo",
    description: "Goods & permits",
    icon: Truck,
  },
  {
    id: "operations",
    label: "Operations",
    description: "Routes & states",
    icon: ShieldCheck,
  },
  {
    id: "tax",
    label: "Tax Filing",
    description: "Taxes & filings",
    icon: ReceiptText,
  },
  {
    id: "drivers",
    label: "Drivers & Staff",
    description: "People & documents",
    icon: Users,
  },
  {
    id: "programs",
    label: "Programs",
    description: "Memberships",
    icon: FileCheck2,
  },
] as const
