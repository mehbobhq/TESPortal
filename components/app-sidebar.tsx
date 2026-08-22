"use client"

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
import { User, Briefcase, Users, FileText } from "lucide-react" // Added some basic icons for the context menu

export function AppSidebar() {
  const pathname = usePathname()

  // --- CONTEXTUAL ROUTING LOGIC ---
  // Check if we are inside a specific company record (e.g., /companies/CMP-12345/...)
  const pathSegments = pathname.split('/').filter(Boolean)
  const isCompanyContext = pathSegments[0] === "companies" && pathSegments[1] && pathSegments[1] !== "new"
  const companyId = isCompanyContext ? pathSegments[1] : null

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
        
        {/* GLOBAL NAVIGATION */}
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                
                // SMART ACTIVE STATE:
                // Drops the "Companies" highlight if we are inside a specific company profile
                let isActive = false
                if (item.url === "/") {
                  isActive = pathname === "/"
                } else if (item.url === "/companies") {
                  isActive = pathname === "/companies" || pathname === "/companies/new"
                } else {
                  isActive = pathname.startsWith(item.url)
                }

                return (
                  <SidebarMenuItem key={item.url}>
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
        ))}

        {/* CONTEXTUAL COMPANY MENU (Only visible when inside a company profile) */}
        {companyId && (
          <SidebarGroup className="mt-4 border-t border-sidebar-border pt-4">
            <SidebarGroupLabel className="text-primary font-semibold">Entity Workspace</SidebarGroupLabel>
            <SidebarMenu>
              
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.includes('/profile')} tooltip="Profile">
                  <Link href={`/companies/${companyId}/profile`}>
                    <User className="size-4" />
                    <span>Profile</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.includes('/business')} tooltip="Business">
                  <Link href={`/companies/${companyId}/business`}>
                    <Briefcase className="size-4" />
                    <span>Business</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.includes('/contacts')} tooltip="Contacts">
                  <Link href={`/companies/${companyId}/contacts`}>
                    <Users className="size-4" />
                    <span>Contacts</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.includes('/documents')} tooltip="Documents">
                  <Link href={`/companies/${companyId}/documents`}>
                    <FileText className="size-4" />
                    <span>Documents</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

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
