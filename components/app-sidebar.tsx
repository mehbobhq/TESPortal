"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"

import { navGroups } from "@/lib/nav"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function AppSidebar() {
  const pathname = usePathname()

  // --- CONTEXTUAL STATE ---
  const [activeCompany, setActiveCompany] = useState<any | null>(null)

  // 1. Identify if we are in a company context
  const pathSegments = pathname.split('/').filter(Boolean)
  const isCompanyContext = pathSegments[0] === "companies" && pathSegments[1] && pathSegments[1] !== "new"
  const companyId = isCompanyContext ? pathSegments[1] : null

  // 2. Fetch the full company object securely
  useEffect(() => {
    if (companyId) {
      const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
      const found = savedCompanies.find((c: any) => c.id === companyId)
      setActiveCompany(found || null)
    } else {
      setActiveCompany(null)
    }
  }, [companyId])

  return (
    <Sidebar
        collapsible="icon"
        className="border-r border-sidebar-border/60 bg-sidebar shadow-sm"
      >
      <SidebarHeader className="border-b border-sidebar-border/60 px-2 pb-3 pt-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! rounded-xl px-2 hover:bg-sidebar-accent/60"
            >
              <Link href="/" className="flex items-center gap-3">
                <div className="flex shrink-0 aspect-square size-9 items-center justify-center rounded-xl bg-primary/10 border border-primary/15 shadow-sm overflow-hidden transition-transform duration-200 group-hover:scale-[1.03]">
                  <Image 
                    src="/logo.png" 
                    alt="TES Logo" 
                    width={32} 
                    height={32} 
                    className="size-full object-contain p-1"
                  />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-bold tracking-tight text-lg text-foreground">
                    TES
                  </span>
                  <span className="text-muted-foreground truncate text-[11px] font-medium tracking-wide uppercase">
                    Operational Intel
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2.5 py-3 scrollbar-hide">
        <div className="space-y-1">
        
        {/* ========================================================= */}
        {/* SECTION 1: PLATFORM (Global Navigation)                   */}
        {/* ========================================================= */}
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
            Platform
          </SidebarGroupLabel>
          <SidebarMenu className="gap-0.5">
            {navGroups.map((group) => {
              const isComplianceGroup = group.items.some(item => ['Profile', 'Business', 'Contacts'].includes(item.title))
              
              // FIX: If it's the compliance group, ONLY extract 'Customers' to show in the global nav
              let platformItems = group.items
              if (isComplianceGroup) {
                platformItems = group.items.filter(item => item.title === "Customers")
              }

              return platformItems.map((item) => {
                let isActive = false
                if (item.url === "/") {
                  isActive = pathname === "/"
                } else if (item.url === "/companies") {
                  isActive = pathname === "/companies" || pathname === "/companies/new"
                } else if (item.url === "/customers") {
                  isActive = pathname === "/customers"
                } else {
                  isActive = pathname.startsWith(item.url)
                }

                // Assume item.icon exists in your navGroups, otherwise fallback to standard text mapping
                const Icon = item.icon

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive} 
                      tooltip={item.title}
                      className={`
                        h-10 rounded-lg transition-colors duration-150 group relative
                        data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-medium
                        hover:bg-sidebar-accent/70
                      `}
                    >
                      <Link href={item.url} className="flex items-center gap-3">
                        {/* The Active Left Ribbon Effect */}
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-primary" />
                        )}
                        {Icon && <Icon className={`size-[17px] shrink-0 transition-colors ${isActive ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground"}`} />}
                        <span className="truncate">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })
            })}
          </SidebarMenu>
        </SidebarGroup>

        {/* ========================================================= */}
        {/* SECTION 2: COMPANY WORKSPACE (Contextual Navigation)      */}
        {/* ========================================================= */}
        {activeCompany && (
          <SidebarGroup className="mt-4 pt-4 border-t border-sidebar-border/50">
            <SidebarGroupLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 px-3">
              Workspace Environment
            </SidebarGroupLabel>
            
            {/* ⚓ THE BEAUTIFUL CONTEXT ANCHOR CARD ⚓ */}
            <div className="mb-4 px-1">
              <div className="relative flex flex-col gap-1.5 overflow-hidden rounded-xl border border-primary/15 bg-gradient-to-br from-primary/10 via-primary/[0.03] to-transparent p-3 shadow-sm">
                {/* Subtle top-glow effect */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                
                <span className="font-bold text-primary truncate text-sm leading-tight pr-2">
                  {activeCompany.name}
                </span>
                <div className="flex items-center gap-2 text-[10px] text-foreground font-semibold uppercase tracking-wider">
                  <span className="truncate">{activeCompany.region}</span>
                  <span className="size-1 shrink-0 rounded-full bg-border"></span>
                  <div className="flex items-center gap-1">
                    <span className={`size-1.5 rounded-full ${activeCompany.status === "Active" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse"}`}></span>
                    <span className={activeCompany.status === "Active" ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400"}>
                      {activeCompany.status || "Active"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <SidebarMenu className="ml-1 gap-0.5 border-l border-sidebar-border/60 pl-2">
              {navGroups.map((group) => {
                const isComplianceGroup = group.items.some(item => ['Profile', 'Business', 'Contacts'].includes(item.title))
                if (!isComplianceGroup) return null

                // Strip 'Customers' out of the Company Workspace list
                let processedItems = group.items.filter(item => item.title !== "Customers")
                
                const isCustomerOrProspect = activeCompany.kind === "Customer" || activeCompany.kind === "Prospect"
                const allowedForOthers = ["Profile", "Contacts", "Credentials", "Settings"]

                if (!isCustomerOrProspect) {
                  processedItems = processedItems.filter(item => allowedForOthers.includes(item.title))
                }

                const companySpecificTabs = [
                  "Profile", "Business", "Contacts", "Insurance", "Authorities", 
                  "Tax Filing", "Vehicles", "Drivers", "Citations", "Record of Events", 
                  "Customs", "Programs", "Credentials", "Settings"
                ]

                return processedItems.map(item => {
                  let finalUrl = item.url
                  
                  if (companySpecificTabs.includes(item.title)) {
                    const formattedPath = item.title.toLowerCase().replace(/ /g, '-')
                    finalUrl = `/companies/${companyId}/${formattedPath}`
                  }

                  const isActive = pathname === finalUrl || pathname.startsWith(finalUrl + "/")
                  const Icon = item.icon

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton 
                        asChild 
                        isActive={isActive} 
                        tooltip={item.title}
                        className={`
                          h-9 rounded-lg text-sm transition-colors duration-150 relative
                          data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-medium
                          hover:bg-sidebar-accent/70
                        `}
                      >
                        <Link href={finalUrl} className="flex items-center gap-3">
                          {isActive && (
                            <div className="absolute -left-[9px] top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-primary ring-2 ring-sidebar" />
                          )}
                          {Icon && <Icon className={`size-4 shrink-0 transition-colors ${isActive ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground"}`} />}
                          <span className="truncate">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })
              })}
            </SidebarMenu>
          </SidebarGroup>
        )}
        </div>
      </SidebarContent>

      {/* ========================================================= */}
      {/* SECTION 3: FOOTER (User Profile)                          */}
      {/* ========================================================= */}
      <SidebarFooter className="border-sidebar-border/60 border-t bg-sidebar/95 p-2.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
                size="lg"
                className="rounded-xl border border-transparent px-2.5 transition-colors hover:border-sidebar-border/60 hover:bg-sidebar-accent/70 group-data-[collapsible=icon]:justify-center"
              >
              <Avatar className="size-9 rounded-xl border border-primary/15 shadow-sm">
                <AvatarFallback className="bg-primary/10 text-primary font-bold rounded-lg text-sm">
                  MB
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight ml-1">
                <span className="truncate font-bold text-foreground">Mehboob</span>
                <span className="text-muted-foreground truncate text-[11px] font-medium tracking-wide uppercase">
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
