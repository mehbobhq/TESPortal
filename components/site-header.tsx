"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
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

const SECTION_LABELS: Record<string, string> = {
  profile: "Profile",
  business: "Business",
  contacts: "Contacts",
  insurance: "Insurance",
  authorities: "Authorities",
  "tax-filing": "Tax Filing",
  vehicles: "Vehicles",
  drivers: "Drivers",
  citations: "Citations",
  settings: "Settings",
  credentials: "Credentials",
  edit: "Edit",
  new: "New Company",
}

const GLOBAL_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/customers": "Customers",
  "/contacts": "Contacts",
  "/authorities": "Authorities",
  "/tax-filing": "Tax Filing",
  "/programs": "Programs",
  "/credentials": "Credentials",
  "/reports": "Reports",
  "/settings": "Settings",
  "/business-intelligence": "Business Intelligence",
  "/trip-compliance": "Trip Compliance",
  "/decision-support": "Decision Support",
  "/customs": "Customs",
  "/insurance": "Insurance",
  "/drivers": "Drivers",
  "/vehicles": "Vehicles",
}

const DRIVER_TAB_LABELS: Record<string, string> = {
  profile: "Profile",
  qualifications: "Qualifications & Licensing",
  documents: "Documents",
  screening: "Screening & Medical",
  training: "Training",
  performance: "Performance & Events",
}

const VEHICLE_TAB_LABELS: Record<string, string> = {
  profile: "Profile",
  ownership: "Ownership",
  registrations: "Registration",
  permits: "Permits",
  maintenance: "Maintenance",
  evidence: "Evidence",
}

const PERFORMANCE_VIEW_LABELS: Record<string, string> = {
  overview: "Overview",
  intelligence: "Performance Intelligence",
  register: "Event Register",
  followup: "Open Follow-up",
  hos: "HOS & Telematics",
  actions: "Company Actions",
  chronology: "Chronology",
}

type Crumb = {
  label: string
  href?: string
}

function SiteHeaderBreadcrumbs() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const pathSegments = pathname.split("/").filter(Boolean)

  const isCompanyContext = pathSegments[0] === "companies" && !!pathSegments[1] && pathSegments[1] !== "new"
  const companyId = isCompanyContext ? pathSegments[1] : null
  const section = isCompanyContext ? pathSegments[2] : null

  const isDriverDetail = isCompanyContext && section === "drivers" && !!pathSegments[3]
  const driverId = isDriverDetail ? pathSegments[3] : null

  const vehicleId = searchParams.get("vehicle")
  const driverTab = searchParams.get("driverTab")
  const vehicleTab = searchParams.get("vehicleTab")
  const trainingRecordId = searchParams.get("trainingRecord")
  const performanceView = searchParams.get("performanceView")

  const [companyName, setCompanyName] = useState<string | null>(null)
  const [vehicleUnitNumber, setVehicleUnitNumber] = useState<string | null>(null)
  const [driverName, setDriverName] = useState<string | null>(null)
  const [trainingCourseTitle, setTrainingCourseTitle] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) {
      setCompanyName(null)
      return
    }
    try {
      const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
      const found = savedCompanies.find((c: any) => c.id === companyId)
      setCompanyName(found?.name || null)
    } catch {
      setCompanyName(null)
    }
  }, [companyId])

  useEffect(() => {
    if (!companyId || !vehicleId) {
      setVehicleUnitNumber(null)
      return
    }
    try {
      const savedStore = JSON.parse(localStorage.getItem(`tes_company_vehicles_${companyId}`) || "null")
      const vehicles = Array.isArray(savedStore) ? savedStore : savedStore?.vehicles || []
      const found = vehicles.find((v: any) => v.id === vehicleId)
      setVehicleUnitNumber(found?.unitNumber || null)
    } catch {
      setVehicleUnitNumber(null)
    }
  }, [companyId, vehicleId])

  useEffect(() => {
    if (!driverId) {
      setDriverName(null)
      return
    }
    try {
      const savedDrivers = JSON.parse(localStorage.getItem("tes_driver_masters_v1") || "[]")
      const found = savedDrivers.find((d: any) => d.id === driverId)
      const first = found?.identity?.legalFirstName
      const last = found?.identity?.legalLastName
      setDriverName(first || last ? [first, last].filter(Boolean).join(" ") : null)
    } catch {
      setDriverName(null)
    }
  }, [driverId])

  useEffect(() => {
    if (!companyId || driverTab !== "training" || !trainingRecordId) {
      setTrainingCourseTitle(null)
      return
    }
    try {
      const savedStore = JSON.parse(localStorage.getItem(`tes_company_drivers_${companyId}`) || "null")
      const records = Array.isArray(savedStore?.trainingRecords) ? savedStore.trainingRecords : []
      const found = records.find((r: any) => r.id === trainingRecordId)
      setTrainingCourseTitle(found?.courseTitle || null)
    } catch {
      setTrainingCourseTitle(null)
    }
  }, [companyId, driverTab, trainingRecordId])

  const crumbs: Crumb[] = [{ label: "TES", href: "/" }]

  if (!isCompanyContext) {
    if (pathSegments[0] === "companies") {
      crumbs.push({ label: "Companies" })
    } else {
      const active = findNavItem(pathname)
      const title = active?.title || GLOBAL_LABELS[pathname] || "Dashboard"
      crumbs.push({ label: title })
    }
  } else {
    crumbs.push({ label: "Companies", href: "/companies" })
    const resolvedCompanyName = companyName || "Company"

    if (!section) {
      crumbs.push({ label: resolvedCompanyName })
    } else {
      crumbs.push({ label: resolvedCompanyName, href: `/companies/${companyId}/profile` })

      if (section === "drivers" && driverId) {
        crumbs.push({ label: "Drivers", href: `/companies/${companyId}/drivers` })
        const resolvedDriverName = driverName || "Driver"

        if (!driverTab) {
          crumbs.push({ label: resolvedDriverName })
        } else {
          crumbs.push({ label: resolvedDriverName, href: `?driverTab=profile` })
          const driverTabLabel = DRIVER_TAB_LABELS[driverTab] || driverTab

          if (driverTab === "training" && trainingRecordId) {
            crumbs.push({ label: "Training", href: `?driverTab=training` })
            crumbs.push({ label: trainingCourseTitle || driverTabLabel })
          } else if (driverTab === "performance" && performanceView) {
            crumbs.push({ label: "Performance & Events", href: `?driverTab=performance` })
            crumbs.push({ label: PERFORMANCE_VIEW_LABELS[performanceView] || performanceView })
          } else {
            crumbs.push({ label: driverTabLabel })
          }
        }
      } else if (section === "vehicles" && vehicleId) {
        crumbs.push({ label: "Vehicles", href: `/companies/${companyId}/vehicles` })
        const resolvedVehicleName = vehicleUnitNumber ? `Unit ${vehicleUnitNumber}` : "Vehicle"

        if (!vehicleTab) {
          crumbs.push({ label: resolvedVehicleName })
        } else {
          crumbs.push({ label: resolvedVehicleName, href: `?vehicle=${vehicleId}` })
          crumbs.push({ label: VEHICLE_TAB_LABELS[vehicleTab] || vehicleTab })
        }
      } else {
        crumbs.push({ label: SECTION_LABELS[section] || section })
      }
    }
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          const isHiddenOnMobile = index < crumbs.length - 2
          return (
            <div key={`${crumb.label}-${index}`} className={`flex items-center gap-1.5 ${isHiddenOnMobile ? "hidden md:flex" : ""}`}>
              <BreadcrumbItem className={index === 0 ? "text-muted-foreground" : undefined}>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <Link href={crumb.href} className="text-muted-foreground hover:text-foreground transition-colors">
                    {crumb.label}
                  </Link>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator className={isHiddenOnMobile ? "hidden md:flex" : ""} />}
            </div>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function SiteHeader() {
  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <Suspense fallback={null}>
        <SiteHeaderBreadcrumbs />
      </Suspense>

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
