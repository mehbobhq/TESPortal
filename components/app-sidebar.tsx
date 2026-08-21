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

export function AppSidebar() {
  const pathname = usePathname()

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
                {/* Image Logo Container */}
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
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>

            <SidebarMenu>
              {group.items.map((item) => {
                // FIXED ACTIVE STATE LOGIC:
                // If it's the home page ("/"), require an exact match.
                // Otherwise, check if the current pathname starts with the item's URL.
                const isActive = item.url === "/" 
                  ? pathname === "/" 
                  : pathname.startsWith(item.url)

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
