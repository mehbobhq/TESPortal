"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  BarChart3,
  Briefcase,
  Building2,
  Contact,
  FileText,
  Gavel,
  IdCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  Package,
  Receipt,
  Route,
  Settings,
  ShieldCheck,
  Truck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  companyNavigationHref,
  getCompanyNavigationItems,
} from "@/lib/company-navigation"
import { navGroups } from "@/lib/nav"

type StoredCompany = {
  id: string
  name?: string
  kind?: string
  region?: string
  status?: string
}

const PLATFORM_ICONS: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  "Trip Compliance": Route,
  "Business Intelligence": BarChart3,
  "Decision Support": Lightbulb,
  Reports: FileText,
  Settings,
  Companies: Building2,
  Customers: Users,
}

const COMPANY_ICONS: Record<string, LucideIcon> = {
  Profile: Building2,
  Business: Briefcase,
  Contacts: Contact,
  Insurance: ShieldCheck,
  Authorities: Landmark,
  "Tax Filing": Receipt,
  Vehicles: Truck,
  Drivers: User,
  Citations: Gavel,
  "Record of Events": Activity,
  Customs: Package,
  Programs: IdCard,
  Credentials: KeyRound,
  Settings,
}

export function AppSidebar() {
  const pathname = usePathname()
  const pathSegments = pathname.split("/").filter(Boolean)
  const isCompanyContext =
    pathSegments[0] === "companies" &&
    Boolean(pathSegments[1]) &&
    pathSegments[1] !== "new"
  const companyId = isCompanyContext ? pathSegments[1] : null
  const [activeCompany, setActiveCompany] = useState<StoredCompany | null>(null)

  useEffect(() => {
    if (!companyId) {
      setActiveCompany(null)
      return
    }

    try {
      const companies = JSON.parse(localStorage.getItem("tes_companies") || "[]") as StoredCompany[]
      setActiveCompany(companies.find((company) => company.id === companyId) || null)
    } catch {
      setActiveCompany(null)
    }
  }, [companyId])

  const platformItems = useMemo(
    () =>
      navGroups.flatMap((group) =>
        group.label === "Compliance"
          ? group.items.filter((item) => item.title === "Customers")
          : group.items
      ),
    []
  )

  const companyItems = useMemo(
    () => getCompanyNavigationItems(activeCompany?.kind),
    [activeCompany?.kind]
  )

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-none [&_[data-sidebar=sidebar]]:bg-sidebar [&_[data-sidebar=sidebar]]:text-sidebar-foreground"
    >
      <SidebarHeader className="border-b border-sidebar-border bg-sidebar px-2.5 py-2.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="rounded-lg px-2 text-foreground hover:bg-accent/60 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
            >
              <Link href="/" className="flex items-center gap-3">
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card shadow-none">
                  <Image
                    src="/logo.png"
                    alt="TES Logo"
                    width={32}
                    height={32}
                    className="size-full object-contain p-1"
                  />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-extrabold tracking-[-0.02em] text-foreground">TES</span>
                  <span className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Operational Intelligence
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="scrollbar-hide bg-sidebar px-2 py-3">
        <SidebarGroup className="p-0">
          <SidebarMenu className="gap-0.5">
            {platformItems.map((item) => {
              const Icon = PLATFORM_ICONS[item.title] || FileText
              const active =
                item.url === "/"
                  ? pathname === "/"
                  : item.url === "/companies"
                    ? pathname === "/companies" || pathname === "/companies/new"
                    : pathname === item.url || pathname.startsWith(`${item.url}/`)

              return (
                <SidebarMenuItem key={`${item.title}-${item.url}`}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={item.title}
                    className="h-9 rounded-lg px-2.5 text-sidebar-foreground transition-colors hover:bg-accent/70 hover:text-foreground data-[active=true]:bg-accent data-[active=true]:font-semibold data-[active=true]:text-primary data-[active=true]:shadow-none"
                  >
                    <Link href={item.url} className="flex items-center gap-2.5">
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate text-[13px]">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>

        {activeCompany && companyId ? (
          <SidebarGroup className="mt-2 border-t border-sidebar-border p-0 pt-2">
            <div className="mb-1 px-1 group-data-[collapsible=icon]:hidden">
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 shadow-none">
                <Building2 className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-foreground">
                    {activeCompany.name || "Company"}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span className="truncate">{activeCompany.region || "Region not recorded"}</span>
                    <span className="size-1 shrink-0 rounded-full bg-border" />
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-status-current">
                      <span className="size-3 shrink-0 rounded-full border-2 border-current bg-transparent" />
                      {activeCompany.status || "Active"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <SidebarMenu className="gap-0.5">
              {companyItems.map((item) => {
                const href = companyNavigationHref(companyId, item.segment)
                const active = pathname === href || pathname.startsWith(`${href}/`)
                const Icon = COMPANY_ICONS[item.title] || FileText

                return (
                  <SidebarMenuItem key={item.segment}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                      className="h-9 rounded-lg px-2.5 text-sidebar-foreground transition-colors hover:bg-accent/70 hover:text-foreground data-[active=true]:bg-accent data-[active=true]:font-semibold data-[active=true]:text-primary"
                    >
                      <Link href={href} className="flex items-center gap-2.5">
                        <Icon className="size-4 shrink-0" />
                        <span className="truncate text-[13px]">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border bg-sidebar p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="rounded-lg px-2 text-sidebar-foreground hover:bg-accent/60 group-data-[collapsible=icon]:justify-center"
            >
              <Avatar className="size-8 rounded-lg border border-border bg-card shadow-none">
                <AvatarFallback className="rounded-lg bg-accent text-sm font-bold text-primary">
                  MB
                </AvatarFallback>
              </Avatar>
              <div className="ml-1 grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold text-foreground">Mehboob</span>
                <span className="truncate text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  System Admin
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
