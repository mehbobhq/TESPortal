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
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/50 shadow-sm">
      <SidebarHeader className="border-b border-sidebar-border/50 pb-4 pt-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="group-data-[collapsible=icon]:p-0! hover:bg-transparent"
            >
              <Link href="/" className="flex items-center gap-3">
                <div className="flex shrink-0 aspect-square size-9 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 shadow-sm overflow-hidden transition-all group-hover:scale-105">
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

      <SidebarContent className="px-2 pt-2 scrollbar-hide">
        
        {/* ========================================================= */}
        {/* SECTION 1: PLATFORM (Global Navigation)                   */}
        {/* ========================================================= */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-3">
            Platform
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1">
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
                        h-9 rounded-md transition-all duration-200 group relative
                        data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-semibold
                        hover:bg-muted/50
                      `}
                    >
                      <Link href={item.url} className="flex items-center gap-3">
                        {/* The Active Left Ribbon Effect */}
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-2/3 w-1 bg-primary rounded-r-full" />
                        )}
                        {Icon && <Icon className={`size-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />}
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
            <div className="mb-5 px-2">
              <div className="bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 rounded-xl p-3 flex flex-col gap-1.5 shadow-sm backdrop-blur-sm relative overflow-hidden">
                {/* Subtle top-glow effect */}
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                
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

            <SidebarMenu className="gap-1 border-l border-sidebar-border/50 ml-3 pl-2">
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
                          h-8 text-sm rounded-md transition-all duration-200 relative
                          data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-semibold
                          hover:bg-muted/50
                        `}
                      >
                        <Link href={finalUrl} className="flex items-center gap-3">
                          {isActive && (
                            <div className="absolute -left-[9px] top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-primary" />
                          )}
                          {Icon && <Icon className={`size-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />}
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
      </SidebarContent>

      {/* ========================================================= */}
      {/* SECTION 3: FOOTER (User Profile)                          */}
      {/* ========================================================= */}
      <SidebarFooter className="border-sidebar-border/50 border-t p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="hover:bg-muted/50 transition-colors rounded-xl">
              <Avatar className="size-9 rounded-lg border border-border shadow-sm">
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
