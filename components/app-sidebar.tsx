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
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-sidebar-border border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="group-data-[collapsible=icon]:p-0!"
            >
              <Link href="/" className="flex items-center gap-2">
                <div className="flex shrink-0 aspect-square size-8 items-center justify-center rounded-md overflow-hidden">
                  <Image 
                    src="/logo.png" 
                    alt="TES Logo" 
                    width={32} 
                    height={32} 
                    className="size-full object-contain"
                  />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold tracking-tight text-base">
                    TES
                  </span>
                  <span className="text-sidebar-foreground/60 truncate text-xs">
                    Operational Intelligence
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        
        {/* ========================================================= */}
        {/* SECTION 1: PLATFORM (Global Navigation)                   */}
        {/* ========================================================= */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
            Platform
          </SidebarGroupLabel>
          <SidebarMenu>
            {navGroups.map((group) => {
              // Skip the compliance/workspace group here
              const isComplianceGroup = group.items.some(item => ['Profile', 'Business', 'Contacts'].includes(item.title))
              if (isComplianceGroup) return null

              return group.items.map((item) => {
                let isActive = false
                if (item.url === "/") {
                  isActive = pathname === "/"
                } else if (item.url === "/companies") {
                  isActive = pathname === "/companies" || pathname === "/companies/new"
                } else {
                  isActive = pathname.startsWith(item.url)
                }

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                      <Link href={item.url}><span>{item.title}</span></Link>
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
          <SidebarGroup className="mt-2 pt-4 border-t border-sidebar-border">
            <SidebarGroupLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              Company Workspace
            </SidebarGroupLabel>
            
            {/* ⚓ THE CONTEXT ANCHOR CARD ⚓ */}
            <div className="mb-4 px-2">
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 flex flex-col gap-1 shadow-sm transition-all">
                <span className="font-bold text-primary truncate text-sm leading-tight">
                  {activeCompany.name}
                </span>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                  <span className="truncate">{activeCompany.region}</span>
                  <span className="size-1 shrink-0 rounded-full bg-muted-foreground/50"></span>
                  <span className={activeCompany.status === "Active" ? "text-green-600" : "text-orange-500"}>
                    {activeCompany.status || "Active"}
                  </span>
                </div>
              </div>
            </div>

            <SidebarMenu>
              {navGroups.map((group) => {
                const isComplianceGroup = group.items.some(item => ['Profile', 'Business', 'Contacts'].includes(item.title))
                if (!isComplianceGroup) return null

                let processedItems = [...group.items]
                const isCustomerOrProspect = activeCompany.kind === "Customer" || activeCompany.kind === "Prospect"
                const allowedForOthers = ["Profile", "Contacts", "Credentials", "Settings"]

                // Apply dynamic hiding for non-customers
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
                  
                  // Inject the dynamic ID into the routes
                  if (companySpecificTabs.includes(item.title)) {
                    const formattedPath = item.title.toLowerCase().replace(/ /g, '-')
                    finalUrl = `/companies/${companyId}/${formattedPath}`
                  }

                  const isActive = pathname === finalUrl || pathname.startsWith(finalUrl + "/")

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                        <Link href={finalUrl}><span>{item.title}</span></Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })
              })}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <Avatar className="size-8 rounded-md">
                <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground rounded-md text-xs">
                  M
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">Mehboob</span>
                <span className="text-sidebar-foreground/60 truncate text-xs">
                  Compliance Lead
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
