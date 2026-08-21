"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bell, Search } from "lucide-react"

import { findNavItem } from "@/lib/nav"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export function SiteHeader() {
  const pathname = usePathname()
  
  // 1. Try to find an exact match first (works for standard pages)
  const active = findNavItem(pathname)
  let title = active?.title
  
  // 2. Setup state for dynamic nested routing
  let isProfilePage = false
  let parentPath = ""

  // 3. Fallback logic: If no exact match is found, parse the URL manually
  if (!title) {
    if (pathname.startsWith("/companies")) {
      title = "Companies"
      parentPath = "/companies"
      if (pathname.includes("/profile")) isProfilePage = true
    } else if (pathname.startsWith("/customers")) {
      title = "Customers"
      parentPath = "/customers"
      if (pathname.includes("/profile")) isProfilePage = true
    } else {
      title = "Dashboard" // Final safety fallback
    }
  }

  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="text-muted-foreground hidden md:block">TES</BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          
          {/* Dynamically render Breadcrumbs based on the route depth */}
          {isProfilePage ? (
            <>
              <BreadcrumbItem className="hidden md:block">
                <Link href={parentPath} className="text-muted-foreground hover:text-foreground transition-colors">
                  {title}
                </Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Profile</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search fleet, filings, credentials…"
            className="h-9 w-56 pl-8 lg:w-72"
            aria-label="Search"
          />
        </div>
        <Button variant="outline" size="icon" className="relative" aria-label="Notifications">
          <Bell />
          <span className="bg-destructive absolute right-1.5 top-1.5 size-1.5 rounded-full" />
        </Button>
      </div>
    </header>
  )
}
