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
  const [companyType, setCompanyType] = useState<string | null>(null)

  // 1. Identify if we are in a company context
  const pathSegments = pathname.split('/').filter(Boolean)
  const isCompanyContext = pathSegments[0] === "companies" && pathSegments[1] && pathSegments[1] !== "new"
  const companyId = isCompanyContext ? pathSegments[1] : null

  // 2. Fetch the company type securely on the client to avoid Next.js hydration errors
  useEffect(() => {
    if (companyId) {
      const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
      const found = savedCompanies.find((c: any) => c.id === companyId)
      if (found) {
        setCompanyType(found.kind)
      }
    } else {
      setCompanyType(null)
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
        {navGroups.map((group) => {
          
          // Create a mutable copy of the navigation items
          let processedItems = [...group.items]

          // Detect if this is the "Compliance" group by checking a few known items
          const isComplianceGroup = group.items.some(item => 
            ['Profile', 'Business', 'Contacts', 'Tax Filing', 'Vehicles'].includes(item.title)
          )

          // --- THE MAGIC FILTER & REWRITE ENGINE ---
          if (isComplianceGroup && companyId) {
            
            // Step 1: Filter out unnecessary tabs if it is NOT a Customer/Prospect
            const isCustomerOrProspect = companyType === "Customer" || companyType === "Prospect"
            const allowedForOthers = ["Customers", "Profile", "Contacts", "Credentials", "Settings"]

            // Only filter if we have loaded the companyType and it's not a Customer/Prospect
            if (companyType && !isCustomerOrProspect) {
              processedItems = processedItems.filter(item => allowedForOthers.includes(item.title))
            }

            // Step 2: Rewrite URLs to inject the specific company ID
            const companySpecificTabs = [
              "Profile", "Business", "Contacts", "Insurance", "Authorities", 
              "Tax Filing", "Vehicles", "Drivers", "Citations", "Record of Events", 
              "Customs", "Programs", "Credentials", "Settings"
            ]

            processedItems = processedItems.map(item => {
              if (companySpecificTabs.includes(item.title)) {
                // Formats titles to URLs (e.g., "Record of Events" -> "record-of-events")
                const formattedPath = item.title.toLowerCase().replace(/ /g, '-')
                return { ...item, url: `/companies/${companyId}/${formattedPath}` }
              }
              return item
            })
          }

          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {processedItems.map((item) => {
                  
                  // SMART ACTIVE STATE:
                  let isActive = false
                  if (item.url === "/") {
                    isActive = pathname === "/"
                  } else if (item.url === "/companies") {
                    // Drop global "Companies" highlight if inside a company profile
                    isActive = pathname === "/companies" || pathname === "/companies/new"
                  } else {
                    // Exact match or sub-route match for rewritten URLs
                    isActive = pathname === item.url || pathname.startsWith(item.url + "/")
                  }

                  return (
                    // Using item.title as key because item.url might be dynamically modified
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                      >
                        <Link href={item.url}>
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}
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
