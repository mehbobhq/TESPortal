"use client"

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
  const active = findNavItem(pathname)
  const title = active?.title ?? "Dashboard"

  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="text-muted-foreground hidden md:block">TES</BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
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
