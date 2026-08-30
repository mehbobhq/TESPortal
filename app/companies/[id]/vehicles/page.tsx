"use client"

import { useMemo, useState } from "react"
import { useParams } from "next/navigation"
import type { ReactNode } from "react"
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Filter,
  Plus,
  Search,
  Settings2,
  Truck,
  Upload,
  Wrench,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"

/* ============================================================================
   TYPES
   ========================================================================== */

type VehicleType =
  | "Tractor"
  | "Converter Dolly"
  | "Tractor - Day Cab"
  | "Tractor - Sleeper"
  | "Tractor - Straight Truck"
  | "Trailer"
  | "Trailer - Chassis"
  | "Trailer - Curtain Side"
  | "Trailer - Dry Van"
  | "Trailer - Flat Deck"
  | "Trailer - Heater"
  | "Trailer - Reefer"
  | "Trailer - Step Deck"

type VehicleStatus = "Active" | "Inactive"

type OperatingRegion = "Canada" | "US" | "Cross Border"

type AssetRelationship =
  | "Company-Owned"
  | "Leased"
  | "Owner-Operator"
  | "Third-Party / Rented"

type FinancingStatus = "No Financing" | "Financed" | "Paid Off"

type RegistrationStatus =
  | "Draft"
  | "Active"
  | "Expired"
  | "Replaced"
  | "Cancelled"

type PermitStatus = "Cancelled" | "Active"

type InspectionStatus =
  | "Pass"
  | "Pass with Defects"
  | "Fail"
  | "Out of Service"

type InspectionSource =
  | "Internal"
  | "Third-Party Shop"
  | "Roadside Enforcement"

type MaintenanceStatus =
  | "Scheduled"
  | "In Progress"
  | "Completed"
  | "Cancelled"

interface Vehicle {
  id: string
  recordId: string
  equipmentNumber: string
  vehicleType: VehicleType
  status: VehicleStatus
  vin: string
  year: string
  make: string
  model: string
  color: string
  operatingRegion: OperatingRegion
  equipmentAxles: string
  fleetStartDate: string
  fleetEndDate: string
  tareWeight: string
  tareWeightUnit: "kg" | "lb"
  fuelType: string
  equipmentLength: string
  equipmentLengthUnit: "ft" | "m"
  gpsProvider: string
}

interface OwnershipRecord {
  id: string
  relationship: AssetRelationship
  financingStatus: FinancingStatus
  ownershipStartDate: string
  ownershipEndDate: string
  purchaseDate: string
  purchasePrice: string
  legalOwner: string
  leasingCompany: string
  leaseTermMonths: string
  leaseEndDate: string
  ownerOperatorCompany: string
  documents: string[]
  archived: boolean
  createdAt: string
}

interface RegistrationRecord {
  id: string
  registrationType: string
  stateProvince: string
  registrationDate: string
  expiryDate: string
  plate: string
  price: string
  status: RegistrationStatus
  registrationDocument: string
  cabCard: string
  archived: boolean
  createdAt: string
}

interface PermitRecord {
  id: string
  permitType: string
  customPermitType: string
  permitNumber: string
  jurisdiction: string
  startDate: string
  expiryDate: string
  status: PermitStatus
  permitDocument: string
  notes: string
  archived: boolean
  createdAt: string
}

interface InspectionRecord {
  id: string
  inspectionType: string
  inspectionSource: InspectionSource
  inspectionStatus: InspectionStatus
  inspectionDate: string
  expiryDate: string
  nextDueDate: string
  inspectorShopName: string
  odometer: string
  engineHours: string
  defectsFound: "Yes" | "No"
  serviceFacility: string
  file: string
  notes: string
  archived: boolean
  createdAt: string
}

interface MaintenanceRecord {
  id: string
  maintenanceType: string
  maintenanceStatus: MaintenanceStatus
  serviceDate: string
  odometer: string
  engineHours: string
  vendor: string
  workOrderNumber: string
  invoiceNumber: string
  partsCost: string
  labourCost: string
  nextServiceDueDate: string
  nextServiceDueOdometer: string
  file: string
  notes: string
  archived: boolean
  createdAt: string
}

type PrimaryTab =
  | "profile"
  | "ownership"
  | "registrations"
  | "permits"
  | "maintenance"
  | "settings"

type MaintenanceView = "inspections" | "maintenance"

/* ============================================================================
   CONSTANTS
   ========================================================================== */

const VEHICLE_TYPES: VehicleType[] = [
  "Tractor",
  "Converter Dolly",
  "Tractor - Day Cab",
  "Tractor - Sleeper",
  "Tractor - Straight Truck",
  "Trailer",
  "Trailer - Chassis",
  "Trailer - Curtain Side",
  "Trailer - Dry Van",
  "Trailer - Flat Deck",
  "Trailer - Heater",
  "Trailer - Reefer",
  "Trailer - Step Deck",
]

const OPERATING_REGIONS: OperatingRegion[] = [
  "Canada",
  "US",
  "Cross Border",
]

const FUEL_TYPES = ["Diesel", "Gasoline", "Electric", "Other", "None"]

const OWNERSHIP_RELATIONSHIPS: AssetRelationship[] = [
  "Company-Owned",
  "Leased",
  "Owner-Operator",
  "Third-Party / Rented",
]

const FINANCING_STATUSES: FinancingStatus[] = [
  "No Financing",
  "Financed",
  "Paid Off",
]

const REGISTRATION_TYPES = [
  "Prorate PSV",
  "Urban",
  "Continuous",
  "Prorate Exempt Goods",
  "Public Service",
]

const REGISTRATION_STATUSES: RegistrationStatus[] = [
  "Draft",
  "Active",
  "Expired",
  "Replaced",
  "Cancelled",
]

const PERMIT_TYPES = [
  "Transponder (Annual)",
  "Transponder (Single Crossing)",
  "New Mexico WDT",
  "New York HUT",
  "KYU",
  "Oregon WMT",
  "Connecticut WDF",
  "California CTC",
  "ARBER",
  "Dangerous Goods Registration",
  "Trip Permit",
  "Fuel Permit",
  "OS Permit",
  "OW Permit",
  "OSOW Permit",
  "Alcohol Transportation Permit",
  "Hazmat Transportation Permit",
  "LCV",
  "Axle Lift",
  "TAC Permit",
  "Other",
]

const INSPECTION_TYPES = [
  "Annual / Periodic Vehicle Inspection",
  "Provincial / State Safety Inspection",
  "Emissions Test",
  "Pre-Trip Inspection",
  "Post-Trip Inspection / DVIR",
  "Scheduled Internal Inspection",
  "Brake Inspection",
  "Trailer Inspection",
  "Reefer / Temperature-Control Unit Inspection",
  "CVSA / Roadside Inspection",
  "Special Inspection",
  "Other",
]

const INSPECTION_SOURCES: InspectionSource[] = [
  "Internal",
  "Third-Party Shop",
  "Roadside Enforcement",
]

const INSPECTION_STATUSES: InspectionStatus[] = [
  "Pass",
  "Pass with Defects",
  "Fail",
  "Out of Service",
]

const MAINTENANCE_TYPES = [
  "Preventive Maintenance / Scheduled Service",
  "Oil and Filter Change",
  "Lubrication Service",
  "Brake Repair",
  "Tire Service / Replacement",
  "Wheel Alignment",
  "Suspension Repair",
  "Engine Repair",
  "Transmission / Driveline Repair",
  "Electrical / Lighting Repair",
  "HVAC Repair",
  "Cooling System Repair",
  "Exhaust / Emissions Repair",
  "Fuel System Repair",
  "Trailer Repair",
  "Reefer Unit Service",
  "Defect Repair",
  "Accident Repair",
  "Recall Repair",
  "Emergency / Roadside Repair",
  "Other",
]

const MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  "Scheduled",
  "In Progress",
  "Completed",
  "Cancelled",
]

/* ============================================================================
   HELPERS
   ========================================================================== */

function makeRecordId(prefix: string) {
  const timestamp = Date.now().toString().slice(-8)
  const random = Math.floor(Math.random() * 900 + 100)
  return `${prefix}-${timestamp}-${random}`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function isTrailerType(type: VehicleType) {
  return type.startsWith("Trailer")
}

function isContinuousRegistration(vehicle: Vehicle, registrationType: string) {
  return (
    isTrailerType(vehicle.vehicleType) &&
    registrationType === "Continuous"
  )
}

function getRegistrationStatus(
  record: RegistrationRecord
): RegistrationStatus {
  if (record.status === "Cancelled" || record.status === "Replaced") {
    return record.status
  }

  if (!record.expiryDate) {
    return record.status === "Draft" ? "Draft" : "Active"
  }

  const now = new Date()
  const expiry = new Date(record.expiryDate)

  if (expiry < now) {
    return "Expired"
  }

  return record.status === "Draft" ? "Draft" : "Active"
}

function getPermitDisplayStatus(record: PermitRecord) {
  if (record.status === "Cancelled") {
    return "Cancelled"
  }

  if (!record.startDate) {
    return "Upcoming"
  }

  const now = new Date()
  const start = new Date(record.startDate)
  const expiry = record.expiryDate ? new Date(record.expiryDate) : null

  if (start > now) {
    return "Upcoming"
  }

  if (expiry && expiry < now) {
    return "Expired"
  }

  if (expiry) {
    const days =
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

    if (days <= 30) {
      return "Expiring Soon"
    }
  }

  return "Active"
}

function calculateLeaseEnd(startDate: string, months: string) {
  if (!startDate || !months) return ""

  const date = new Date(startDate)
  const term = Number(months)

  if (!Number.isFinite(term) || term <= 0) return ""

  date.setMonth(date.getMonth() + term)

  return date.toISOString().slice(0, 10)
}

function money(value: string) {
  const amount = Number(value)

  if (!Number.isFinite(amount)) return "$0.00"

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

/* ============================================================================
   MAIN PAGE
   ========================================================================== */

export default function VehiclesPage() {
  const params = useParams()
  const companyId = params.id as string

  /*
   * Backend/API integration can replace these state collections later.
   * No fake/demo vehicle records are seeded here intentionally.
   */
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  const [ownershipRecords, setOwnershipRecords] = useState<
    Record<string, OwnershipRecord[]>
  >({})

  const [registrationRecords, setRegistrationRecords] = useState<
    Record<string, RegistrationRecord[]>
  >({})

  const [permitRecords, setPermitRecords] = useState<
    Record<string, PermitRecord[]>
  >({})

  const [inspectionRecords, setInspectionRecords] = useState<
    Record<string, InspectionRecord[]>
  >({})

  const [maintenanceRecords, setMaintenanceRecords] = useState<
    Record<string, MaintenanceRecord[]>
  >({})

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    null
  )

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [typeFilter, setTypeFilter] = useState("All")
  const [regionFilter, setRegionFilter] = useState("All")
  const [showFilters, setShowFilters] = useState(false)
  const [showCreateVehicle, setShowCreateVehicle] = useState(false)

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId]
  )

  const filteredVehicles = useMemo(() => {
    const term = search.trim().toLowerCase()

    return vehicles.filter((vehicle) => {
      const matchesSearch =
        !term ||
        vehicle.equipmentNumber.toLowerCase().includes(term) ||
        vehicle.vin.toLowerCase().includes(term) ||
        getCurrentPlate(
          vehicle.id,
          registrationRecords
        )
          .toLowerCase()
          .includes(term)

      const matchesStatus =
        statusFilter === "All" || vehicle.status === statusFilter

      const matchesType =
        typeFilter === "All" || vehicle.vehicleType === typeFilter

      const matchesRegion =
        regionFilter === "All" ||
        vehicle.operatingRegion === regionFilter

      return (
        matchesSearch &&
        matchesStatus &&
        matchesType &&
        matchesRegion
      )
    })
  }, [
    vehicles,
    search,
    statusFilter,
    typeFilter,
    regionFilter,
    registrationRecords,
  ])

  function createVehicle(vehicle: Vehicle) {
    setVehicles((current) => [...current, vehicle])
    setShowCreateVehicle(false)
    setSelectedVehicleId(vehicle.id)
  }

  function saveVehicle(updated: Vehicle) {
    setVehicles((current) =>
      current.map((vehicle) =>
        vehicle.id === updated.id ? updated : vehicle
      )
    )
  }

  function addOwnership(record: OwnershipRecord) {
    if (!selectedVehicle) return

    setOwnershipRecords((current) => ({
      ...current,
      [selectedVehicle.id]: [
        ...(current[selectedVehicle.id] ?? []),
        record,
      ],
    }))
  }

  function addRegistration(record: RegistrationRecord) {
    if (!selectedVehicle) return

    setRegistrationRecords((current) => ({
      ...current,
      [selectedVehicle.id]: [
        ...(current[selectedVehicle.id] ?? []),
        record,
      ],
    }))
  }

  function addPermit(record: PermitRecord) {
    if (!selectedVehicle) return

    setPermitRecords((current) => ({
      ...current,
      [selectedVehicle.id]: [
        ...(current[selectedVehicle.id] ?? []),
        record,
      ],
    }))
  }

  function addInspection(record: InspectionRecord) {
    if (!selectedVehicle) return

    setInspectionRecords((current) => ({
      ...current,
      [selectedVehicle.id]: [
        ...(current[selectedVehicle.id] ?? []),
        record,
      ],
    }))
  }

  function addMaintenance(record: MaintenanceRecord) {
    if (!selectedVehicle) return

    setMaintenanceRecords((current) => ({
      ...current,
      [selectedVehicle.id]: [
        ...(current[selectedVehicle.id] ?? []),
        record,
      ],
    }))
  }

  if (selectedVehicle) {
    return (
      <VehicleDetail
        companyId={companyId}
        vehicle={selectedVehicle}
        ownershipRecords={ownershipRecords[selectedVehicle.id] ?? []}
        registrationRecords={
          registrationRecords[selectedVehicle.id] ?? []
        }
        permitRecords={permitRecords[selectedVehicle.id] ?? []}
        inspectionRecords={
          inspectionRecords[selectedVehicle.id] ?? []
        }
        maintenanceRecords={
          maintenanceRecords[selectedVehicle.id] ?? []
        }
        onBack={() => setSelectedVehicleId(null)}
        onSaveVehicle={saveVehicle}
        onAddOwnership={addOwnership}
        onAddRegistration={addRegistration}
        onAddPermit={addPermit}
        onAddInspection={addInspection}
        onAddMaintenance={addMaintenance}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] p-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <div className="rounded-md bg-primary/10 p-1.5">
                <Truck className="h-5 w-5 text-primary" />
              </div>

              <h1 className="text-2xl font-semibold tracking-tight">
                Vehicles
              </h1>
            </div>

            <p className="text-sm text-muted-foreground">
              Vehicle master records, registrations, permits and maintenance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />

              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search equipment, VIN or plate..."
                className="w-[280px] pl-9"
              />
            </div>

            <Button
              variant="outline"
              onClick={() => setShowFilters((value) => !value)}
            >
              <Filter className="mr-2 h-4 w-4" />
              Filters
            </Button>

            <Button onClick={() => setShowCreateVehicle(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Vehicle
            </Button>
          </div>
        </div>

        {showFilters && (
          <Card className="mb-5 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FieldGroup label="Status">
                <SelectInput
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={["All", "Active", "Inactive"]}
                />
              </FieldGroup>

              <FieldGroup label="Vehicle Type">
                <SelectInput
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={["All", ...VEHICLE_TYPES]}
                />
              </FieldGroup>

              <FieldGroup label="Operating Region">
                <SelectInput
                  value={regionFilter}
                  onChange={setRegionFilter}
                  options={["All", ...OPERATING_REGIONS]}
                />
              </FieldGroup>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden border-border shadow-sm">
          {filteredVehicles.length === 0 ? (
            <EmptyVehicleList
              hasSearch={Boolean(search || statusFilter !== "All" || typeFilter !== "All" || regionFilter !== "All")}
              onCreate={() => setShowCreateVehicle(true)}
            />
          ) : (
            <VehicleListTable
              vehicles={filteredVehicles}
              registrationRecords={registrationRecords}
              inspectionRecords={inspectionRecords}
              onSelect={setSelectedVehicleId}
            />
          )}
        </Card>
      </div>

      {showCreateVehicle && (
        <CreateVehicleModal
          onClose={() => setShowCreateVehicle(false)}
          onCreate={createVehicle}
        />
      )}
    </div>
  )
}

/* ============================================================================
   VEHICLE LIST
   ========================================================================== */

function VehicleListTable({
  vehicles,
  registrationRecords,
  inspectionRecords,
  onSelect,
}: {
  vehicles: Vehicle[]
  registrationRecords: Record<string, RegistrationRecord[]>
  inspectionRecords: Record<string, InspectionRecord[]>
  onSelect: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-5 py-3">Equipment #</th>
            <th className="px-5 py-3">Vehicle Type</th>
            <th className="px-5 py-3">VIN</th>
            <th className="px-5 py-3">Current Plate</th>
            <th className="px-5 py-3">Year / Make / Model</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Region</th>
            <th className="px-5 py-3">Registration</th>
            <th className="px-5 py-3">Inspection</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {vehicles.map((vehicle) => {
            const registrations = registrationRecords[vehicle.id] ?? []
            const inspections = inspectionRecords[vehicle.id] ?? []

            const activeRegistration = getActiveRegistration(registrations)
            const currentPlate = activeRegistration?.plate || "—"

            const inspection = inspections
              .filter((item) => !item.archived)
              .sort((a, b) =>
                (b.nextDueDate || "").localeCompare(a.nextDueDate || "")
              )[0]

            const registrationStatus = activeRegistration
              ? getRegistrationStatus(activeRegistration)
              : "No Record"

            return (
              <tr
                key={vehicle.id}
                className="cursor-pointer transition-colors hover:bg-muted/40"
                onClick={() => onSelect(vehicle.id)}
              >
                <td className="px-5 py-4">
                  <div className="font-medium text-primary">
                    {vehicle.equipmentNumber || "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {vehicle.recordId}
                  </div>
                </td>

                <td className="px-5 py-4">{vehicle.vehicleType}</td>

                <td className="px-5 py-4 font-mono text-xs">
                  {vehicle.vin || "—"}
                </td>

                <td className="px-5 py-4 font-medium">
                  {currentPlate}
                </td>

                <td className="px-5 py-4">
                  {[vehicle.year, vehicle.make, vehicle.model]
                    .filter(Boolean)
                    .join(" / ") || "—"}
                </td>

                <td className="px-5 py-4">
                  <StatusBadge
                    value={vehicle.status}
                    tone={
                      vehicle.status === "Active"
                        ? "success"
                        : "neutral"
                    }
                  />
                </td>

                <td className="px-5 py-4">
                  {vehicle.operatingRegion}
                </td>

                <td className="px-5 py-4">
                  {registrationStatus === "No Record" ? (
                    <span className="text-muted-foreground">No record</span>
                  ) : (
                    <StatusBadge
                      value={registrationStatus}
                      tone={
                        registrationStatus === "Active"
                          ? "success"
                          : registrationStatus === "Expired"
                            ? "danger"
                            : "warning"
                      }
                    />
                  )}
                </td>

                <td className="px-5 py-4">
                  {inspection ? (
                    <div>
                      <div className="flex items-center gap-1.5">
                        {inspection.nextDueDate &&
                        inspection.nextDueDate < today() ? (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        )}

                        <span>
                          {inspection.nextDueDate || "No due date"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      No record
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EmptyVehicleList({
  hasSearch,
  onCreate,
}: {
  hasSearch: boolean
  onCreate: () => void
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-full bg-muted p-4">
        <Truck className="h-7 w-7 text-muted-foreground" />
      </div>

      <h2 className="text-base font-semibold">
        {hasSearch ? "No vehicles match your filters" : "No vehicles yet"}
      </h2>

      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {hasSearch
          ? "Try changing the search term or filters."
          : "Create the first vehicle master record to begin managing registrations, permits, inspections and maintenance."}
      </p>

      {!hasSearch && (
        <Button className="mt-5" onClick={onCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create Vehicle
        </Button>
      )}
    </div>
  )
}

/* ============================================================================
   VEHICLE DETAIL
   ========================================================================== */

function VehicleDetail({
  vehicle,
  ownershipRecords,
  registrationRecords,
  permitRecords,
  inspectionRecords,
  maintenanceRecords,
  onBack,
  onSaveVehicle,
  onAddOwnership,
  onAddRegistration,
  onAddPermit,
  onAddInspection,
  onAddMaintenance,
}: {
  companyId: string
  vehicle: Vehicle
  ownershipRecords: OwnershipRecord[]
  registrationRecords: RegistrationRecord[]
  permitRecords: PermitRecord[]
  inspectionRecords: InspectionRecord[]
  maintenanceRecords: MaintenanceRecord[]
  onBack: () => void
  onSaveVehicle: (vehicle: Vehicle) => void
  onAddOwnership: (record: OwnershipRecord) => void
  onAddRegistration: (record: RegistrationRecord) => void
  onAddPermit: (record: PermitRecord) => void
  onAddInspection: (record: InspectionRecord) => void
  onAddMaintenance: (record: MaintenanceRecord) => void
}) {
  const [tab, setTab] = useState<PrimaryTab>("profile")

  const activeRegistration = getActiveRegistration(registrationRecords)

  const currentPlate = activeRegistration?.plate || "Not registered"

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1500px] p-6">
        <div className="mb-5">
          <Button
            variant="ghost"
            className="-ml-2 mb-3"
            onClick={onBack}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Vehicles
          </Button>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-primary/10 p-2">
                  <Truck className="h-5 w-5 text-primary" />
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-xl font-semibold tracking-tight">
                      {vehicle.equipmentNumber || "Vehicle"}
                    </h1>

                    <StatusBadge
                      value={vehicle.status}
                      tone={
                        vehicle.status === "Active"
                          ? "success"
                          : "neutral"
                      }
                    />
                  </div>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {vehicle.vehicleType}
                    {" · "}
                    {[vehicle.year, vehicle.make, vehicle.model]
                      .filter(Boolean)
                      .join(" / ")}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <HeaderValue label="Equipment #" value={vehicle.equipmentNumber || "—"} />
              <HeaderValue label="VIN" value={vehicle.vin || "—"} />
              <HeaderValue label="Current Plate" value={currentPlate} />
              <HeaderValue label="Region" value={vehicle.operatingRegion} />
            </div>
          </div>
        </div>

        <div className="mb-5 border-b border-border">
          <nav className="-mb-px flex gap-1 overflow-x-auto">
            <DetailTab
              active={tab === "profile"}
              onClick={() => setTab("profile")}
              label="Profile"
            />

            <DetailTab
              active={tab === "ownership"}
              onClick={() => setTab("ownership")}
              label="Ownership"
            />

            <DetailTab
              active={tab === "registrations"}
              onClick={() => setTab("registrations")}
              label="Registrations"
            />

            <DetailTab
              active={tab === "permits"}
              onClick={() => setTab("permits")}
              label="Permits"
            />

            <DetailTab
              active={tab === "maintenance"}
              onClick={() => setTab("maintenance")}
              label="Maintenance"
            />

            <DetailTab
              active={tab === "settings"}
              onClick={() => setTab("settings")}
              label="Settings"
            />
          </nav>
        </div>

        {tab === "profile" && (
          <VehicleProfile
            vehicle={vehicle}
            onSave={onSaveVehicle}
          />
        )}

        {tab === "ownership" && (
          <OwnershipSection
            vehicle={vehicle}
            records={ownershipRecords}
            onAdd={onAddOwnership}
          />
        )}

        {tab === "registrations" && (
          <RegistrationsSection
            vehicle={vehicle}
            records={registrationRecords}
            onAdd={onAddRegistration}
          />
        )}

        {tab === "permits" && (
          <PermitsSection
            records={permitRecords}
            onAdd={onAddPermit}
          />
        )}

        {tab === "maintenance" && (
          <MaintenanceSection
            vehicle={vehicle}
            inspectionRecords={inspectionRecords}
            maintenanceRecords={maintenanceRecords}
            onAddInspection={onAddInspection}
            onAddMaintenance={onAddMaintenance}
          />
        )}

        {tab === "settings" && <VehicleSettings />}
      </div>
    </div>
  )
}

/* ============================================================================
   PROFILE
   ========================================================================== */

function VehicleProfile({
  vehicle,
  onSave,
}: {
  vehicle: Vehicle
  onSave: (vehicle: Vehicle) => void
}) {
  const [form, setForm] = useState(vehicle)
  const [registrationFile, setRegistrationFile] = useState("")

  const set = <K extends keyof Vehicle>(key: K, value: Vehicle[K]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const showFleetEndDate =
    form.status === "Inactive" || Boolean(form.fleetEndDate)

  function submit() {
    onSave(form)
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Vehicle Profile"
        description="Current permanent vehicle master information."
        action={
          <DocumentUploadButton
            label="Upload Registration"
            onChange={setRegistrationFile}
          />
        }
      />

      {registrationFile && (
        <UploadNotice
          filename={registrationFile}
          message="Registration document selected. Review any extracted information before saving."
        />
      )}

      <Card className="p-6">
        <SectionTitle title="Vehicle Identity" />

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <FieldGroup label="Record ID">
            <Input value={form.recordId} disabled />
          </FieldGroup>

          <FieldGroup label="Vehicle Type">
            <SelectInput
              value={form.vehicleType}
              onChange={(value) =>
                set("vehicleType", value as VehicleType)
              }
              options={VEHICLE_TYPES}
            />
          </FieldGroup>

          <FieldGroup label="Status">
            <SelectInput
              value={form.status}
              onChange={(value) =>
                set("status", value as VehicleStatus)
              }
              options={["Active", "Inactive"]}
            />
          </FieldGroup>

          <FieldGroup label="Equipment #">
            <Input
              value={form.equipmentNumber}
              onChange={(event) =>
                set("equipmentNumber", event.target.value)
              }
              placeholder="e.g. Unit 101"
            />
          </FieldGroup>

          <FieldGroup label="VIN">
            <Input
              value={form.vin}
              onChange={(event) =>
                set("vin", event.target.value.toUpperCase())
              }
              placeholder="17-character VIN"
              maxLength={17}
            />
          </FieldGroup>

          <FieldGroup label="Year">
            <Input
              type="number"
              min="1900"
              value={form.year}
              onChange={(event) => set("year", event.target.value)}
              placeholder="2026"
            />
          </FieldGroup>

          <FieldGroup label="Make">
            <Input
              value={form.make}
              onChange={(event) => set("make", event.target.value)}
              placeholder="Manufacturer"
            />
          </FieldGroup>

          <FieldGroup label="Model">
            <Input
              value={form.model}
              onChange={(event) => set("model", event.target.value)}
              placeholder="Model"
            />
          </FieldGroup>

          <FieldGroup label="Color">
            <Input
              value={form.color}
              onChange={(event) => set("color", event.target.value)}
              placeholder="White"
            />
          </FieldGroup>

          <FieldGroup label="Operating Region">
            <SelectInput
              value={form.operatingRegion}
              onChange={(value) =>
                set("operatingRegion", value as OperatingRegion)
              }
              options={OPERATING_REGIONS}
            />
          </FieldGroup>

          <FieldGroup label="Equipment Axles">
            <Input
              type="number"
              min="0"
              value={form.equipmentAxles}
              onChange={(event) =>
                set("equipmentAxles", event.target.value)
              }
            />
          </FieldGroup>
        </div>
      </Card>

      <Card className="p-6">
        <SectionTitle
          title="Fleet & Operating Information"
          description="Current fleet attributes and normalized units."
        />

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <FieldGroup label="Fleet Start Date">
            <Input
              type="date"
              value={form.fleetStartDate}
              onChange={(event) =>
                set("fleetStartDate", event.target.value)
              }
            />
          </FieldGroup>

          {showFleetEndDate && (
            <FieldGroup label="Fleet End Date">
              <Input
                type="date"
                value={form.fleetEndDate}
                onChange={(event) =>
                  set("fleetEndDate", event.target.value)
                }
              />
            </FieldGroup>
          )}

          <FieldGroup label="Tare Weight">
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                value={form.tareWeight}
                onChange={(event) =>
                  set("tareWeight", event.target.value)
                }
                className="flex-1"
              />

              <SelectInput
                value={form.tareWeightUnit}
                onChange={(value) =>
                  set("tareWeightUnit", value as "kg" | "lb")
                }
                options={["kg", "lb"]}
                className="w-[90px]"
              />
            </div>
          </FieldGroup>

          <FieldGroup label="Fuel Type">
            <SelectInput
              value={form.fuelType}
              onChange={(value) => set("fuelType", value)}
              options={FUEL_TYPES}
            />
          </FieldGroup>

          <FieldGroup label="Equipment Length">
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                value={form.equipmentLength}
                onChange={(event) =>
                  set("equipmentLength", event.target.value)
                }
                className="flex-1"
              />

              <SelectInput
                value={form.equipmentLengthUnit}
                onChange={(value) =>
                  set("equipmentLengthUnit", value as "ft" | "m")
                }
                options={["ft", "m"]}
                className="w-[90px]"
              />
            </div>
          </FieldGroup>

          <FieldGroup label="GPS Provider">
            <Input
              value={form.gpsProvider}
              onChange={(event) =>
                set("gpsProvider", event.target.value)
              }
              placeholder="Provider"
            />
          </FieldGroup>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={submit}>Save Vehicle</Button>
      </div>
    </div>
  )
}

/* ============================================================================
   OWNERSHIP
   ========================================================================== */

function OwnershipSection({
  vehicle,
  records,
  onAdd,
}: {
  vehicle: Vehicle
  records: OwnershipRecord[]
  onAdd: (record: OwnershipRecord) => void
}) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Ownership"
        description="Historical ownership and financing records."
        action={
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Ownership Record
          </Button>
        }
      />

      {records.length === 0 ? (
        <EmptyRecordState
          title="No ownership records"
          description="Add the first ownership record for this vehicle."
          actionLabel="Add Ownership Record"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="space-y-3">
          {records
            .filter((record) => !record.archived)
            .map((record) => (
              <OwnershipRecordCard key={record.id} record={record} />
            ))}
        </div>
      )}

      {showForm && (
        <OwnershipForm
          onClose={() => setShowForm(false)}
          onSave={(record) => {
            onAdd(record)
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function OwnershipRecordCard({
  record,
}: {
  record: OwnershipRecord
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{record.relationship}</h3>

            <StatusBadge
              value={record.financingStatus}
              tone="neutral"
            />
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            Record ID: {record.id}
          </p>
        </div>

        <div className="text-left text-sm lg:text-right">
          <p>
            {record.ownershipStartDate || "—"}
            {" → "}
            {record.ownershipEndDate || "Current"}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 md:grid-cols-3">
        <InfoItem label="Legal Owner" value={record.legalOwner} />
        <InfoItem label="Purchase Date" value={record.purchaseDate} />
        <InfoItem
          label="Purchase Price"
          value={record.purchasePrice ? money(record.purchasePrice) : "—"}
        />

        {record.leasingCompany && (
          <InfoItem
            label="Leasing Company"
            value={record.leasingCompany}
          />
        )}

        {record.leaseTermMonths && (
          <InfoItem
            label="Lease Term"
            value={`${record.leaseTermMonths} months`}
          />
        )}

        {record.leaseEndDate && (
          <InfoItem
            label="Lease End Date"
            value={record.leaseEndDate}
          />
        )}

        {record.ownerOperatorCompany && (
          <InfoItem
            label="Owner-Operator Company"
            value={record.ownerOperatorCompany}
          />
        )}
      </div>

      {record.documents.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Evidence
          </p>

          <div className="flex flex-wrap gap-2">
            {record.documents.map((document) => (
              <span
                key={document}
                className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs"
              >
                {document}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function OwnershipForm({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (record: OwnershipRecord) => void
}) {
  const [relationship, setRelationship] =
    useState<AssetRelationship>("Company-Owned")
  const [financingStatus, setFinancingStatus] =
    useState<FinancingStatus>("No Financing")

  const [ownershipStartDate, setOwnershipStartDate] = useState("")
  const [ownershipEndDate, setOwnershipEndDate] = useState("")
  const [purchaseDate, setPurchaseDate] = useState("")
  const [purchasePrice, setPurchasePrice] = useState("")
  const [legalOwner, setLegalOwner] = useState("")
  const [leasingCompany, setLeasingCompany] = useState("")
  const [leaseTermMonths, setLeaseTermMonths] = useState("")
  const [ownerOperatorCompany, setOwnerOperatorCompany] = useState("")
  const [documents, setDocuments] = useState<string[]>([])
  const [error, setError] = useState("")

  const leaseEndDate = calculateLeaseEnd(
    ownershipStartDate,
    leaseTermMonths
  )

  function submit() {
    if (
      ownershipStartDate &&
      ownershipEndDate &&
      ownershipEndDate < ownershipStartDate
    ) {
      setError("Ownership end date cannot precede the start date.")
      return
    }

    if (relationship === "Leased" && !documents.includes("Lease Agreement")) {
      setError("Lease Agreement is required for leased vehicles.")
      return
    }

    onSave({
      id: makeRecordId("OWN"),
      relationship,
      financingStatus,
      ownershipStartDate,
      ownershipEndDate,
      purchaseDate,
      purchasePrice,
      legalOwner,
      leasingCompany,
      leaseTermMonths,
      leaseEndDate,
      ownerOperatorCompany,
      documents,
      archived: false,
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <RecordModal
      title="Add Ownership Record"
      onClose={onClose}
      onSave={submit}
      error={error}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FieldGroup label="Asset Relationship">
          <SelectInput
            value={relationship}
            onChange={(value) =>
              setRelationship(value as AssetRelationship)
            }
            options={OWNERSHIP_RELATIONSHIPS}
          />
        </FieldGroup>

        <FieldGroup label="Financing Status">
          <SelectInput
            value={financingStatus}
            onChange={(value) =>
              setFinancingStatus(value as FinancingStatus)
            }
            options={FINANCING_STATUSES}
          />
        </FieldGroup>

        <FieldGroup label="Ownership Start Date">
          <Input
            type="date"
            value={ownershipStartDate}
            onChange={(event) =>
              setOwnershipStartDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Ownership End Date">
          <Input
            type="date"
            value={ownershipEndDate}
            onChange={(event) =>
              setOwnershipEndDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Purchase Date">
          <Input
            type="date"
            value={purchaseDate}
            onChange={(event) =>
              setPurchaseDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Purchase Price">
          <Input
            type="number"
            min="0"
            value={purchasePrice}
            onChange={(event) =>
              setPurchasePrice(event.target.value)
            }
          />
        </FieldGroup>

        {relationship === "Company-Owned" && (
          <FieldGroup label="Legal Owner">
            <Input
              value={legalOwner}
              onChange={(event) =>
                setLegalOwner(event.target.value)
              }
            />
          </FieldGroup>
        )}

        {relationship === "Leased" && (
          <>
            <FieldGroup label="Legal Owner">
              <Input
                value={legalOwner}
                onChange={(event) =>
                  setLegalOwner(event.target.value)
                }
              />
            </FieldGroup>

            <FieldGroup label="Leasing Company">
              <Input
                value={leasingCompany}
                onChange={(event) =>
                  setLeasingCompany(event.target.value)
                }
              />
            </FieldGroup>

            <FieldGroup label="Lease Term (months)">
              <Input
                type="number"
                min="1"
                value={leaseTermMonths}
                onChange={(event) =>
                  setLeaseTermMonths(event.target.value)
                }
              />
            </FieldGroup>

            <FieldGroup label="Lease End Date">
              <Input value={leaseEndDate} disabled />
            </FieldGroup>
          </>
        )}

        {relationship === "Owner-Operator" && (
          <FieldGroup label="Owner-Operator Company">
            <Input
              value={ownerOperatorCompany}
              onChange={(event) =>
                setOwnerOperatorCompany(event.target.value)
              }
            />
          </FieldGroup>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <DocumentEvidenceSelector
          documents={documents}
          onChange={setDocuments}
          options={[
            "Bill of Sale",
            "Lease Agreement",
            "Power of Attorney",
            "Other ownership evidence",
          ]}
        />
      </div>
    </RecordModal>
  )
}

/* ============================================================================
   REGISTRATIONS
   ========================================================================== */

function RegistrationsSection({
  vehicle,
  records,
  onAdd,
}: {
  vehicle: Vehicle
  records: RegistrationRecord[]
  onAdd: (record: RegistrationRecord) => void
}) {
  const [showForm, setShowForm] = useState(false)

  const sortedRecords = [...records]
    .filter((record) => !record.archived)
    .sort((a, b) =>
      (b.registrationDate || "").localeCompare(
        a.registrationDate || ""
      )
    )

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Registrations"
        description="Registration history and current plate source of truth."
        action={
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Registration
          </Button>
        }
      />

      {sortedRecords.length === 0 ? (
        <EmptyRecordState
          title="No registration records"
          description="Add a registration record to establish the vehicle's current plate."
          actionLabel="Add Registration"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="space-y-3">
          {sortedRecords.map((record) => {
            const status = getRegistrationStatus(record)

            return (
              <Card key={record.id} className="p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {record.registrationType}
                      </h3>

                      <StatusBadge
                        value={status}
                        tone={
                          status === "Active"
                            ? "success"
                            : status === "Expired"
                              ? "danger"
                              : "neutral"
                        }
                      />
                    </div>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Record ID: {record.id}
                    </p>
                  </div>

                  {status === "Active" && (
                    <span className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      Current Registration
                    </span>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 md:grid-cols-3 xl:grid-cols-4">
                  <InfoItem
                    label="State / Province"
                    value={record.stateProvince}
                  />

                  <InfoItem
                    label="Registration Date"
                    value={record.registrationDate}
                  />

                  <InfoItem
                    label="Expiry Date"
                    value={
                      isContinuousRegistration(
                        vehicle,
                        record.registrationType
                      )
                        ? "Continuous"
                        : record.expiryDate || "—"
                    }
                  />

                  <InfoItem label="Plate" value={record.plate} />

                  <InfoItem
                    label="Price"
                    value={record.price ? money(record.price) : "—"}
                  />

                  <InfoItem
                    label="Registration Document"
                    value={record.registrationDocument || "Not attached"}
                  />

                  <InfoItem
                    label="Cab Card"
                    value={record.cabCard || "Not attached"}
                  />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {showForm && (
        <RegistrationForm
          vehicle={vehicle}
          onClose={() => setShowForm(false)}
          onSave={(record) => {
            onAdd(record)
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function RegistrationForm({
  vehicle,
  onClose,
  onSave,
}: {
  vehicle: Vehicle
  onClose: () => void
  onSave: (record: RegistrationRecord) => void
}) {
  const defaultType = isTrailerType(vehicle.vehicleType)
    ? "Continuous"
    : "Prorate PSV"

  const [registrationType, setRegistrationType] =
    useState(defaultType)
  const [stateProvince, setStateProvince] = useState("")
  const [registrationDate, setRegistrationDate] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [plate, setPlate] = useState("")
  const [price, setPrice] = useState("")
  const [status, setStatus] =
    useState<RegistrationStatus>("Active")
  const [registrationDocument, setRegistrationDocument] =
    useState("")
  const [cabCard, setCabCard] = useState("")
  const [error, setError] = useState("")

  const continuous = isContinuousRegistration(
    vehicle,
    registrationType
  )

  function submit() {
    if (
      registrationDate &&
      expiryDate &&
      expiryDate < registrationDate
    ) {
      setError("Expiry date cannot precede registration date.")
      return
    }

    if (
      registrationType === "Prorate PSV" &&
      !cabCard
    ) {
      setError("Cab Card is required for Prorate PSV registration.")
      return
    }

    onSave({
      id: makeRecordId("REG"),
      registrationType,
      stateProvince,
      registrationDate,
      expiryDate: continuous ? "" : expiryDate,
      plate,
      price,
      status,
      registrationDocument,
      cabCard,
      archived: false,
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <RecordModal
      title="Add Registration"
      onClose={onClose}
      onSave={submit}
      error={error}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FieldGroup label="Record ID">
          <Input value="Generated on save" disabled />
        </FieldGroup>

        <FieldGroup label="Registration Type">
          <SelectInput
            value={registrationType}
            onChange={setRegistrationType}
            options={REGISTRATION_TYPES}
          />
        </FieldGroup>

        <FieldGroup label="State / Province">
          <Input
            value={stateProvince}
            onChange={(event) =>
              setStateProvince(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Registration Date">
          <Input
            type="date"
            value={registrationDate}
            onChange={(event) =>
              setRegistrationDate(event.target.value)
            }
          />
        </FieldGroup>

        {!continuous && (
          <FieldGroup label="Expiry Date">
            <Input
              type="date"
              value={expiryDate}
              onChange={(event) =>
                setExpiryDate(event.target.value)
              }
            />
          </FieldGroup>
        )}

        {continuous && (
          <FieldGroup label="Expiry Date">
            <Input value="Continuous" disabled />
          </FieldGroup>
        )}

        <FieldGroup label="Plate">
          <Input
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Price">
          <Input
            type="number"
            min="0"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Registration Status">
          <SelectInput
            value={status}
            onChange={(value) =>
              setStatus(value as RegistrationStatus)
            }
            options={REGISTRATION_STATUSES}
          />
        </FieldGroup>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 border-t border-border pt-5 md:grid-cols-2">
        <FileField
          label="Registration Document"
          value={registrationDocument}
          onChange={setRegistrationDocument}
        />

        <FileField
          label={
            registrationType === "Prorate PSV"
              ? "Cab Card *"
              : "Cab Card"
          }
          value={cabCard}
          onChange={setCabCard}
        />
      </div>
    </RecordModal>
  )
}

/* ============================================================================
   PERMITS
   ========================================================================== */

function PermitsSection({
  records,
  onAdd,
}: {
  records: PermitRecord[]
  onAdd: (record: PermitRecord) => void
}) {
  const [showForm, setShowForm] = useState(false)

  const activeRecords = records.filter((record) => !record.archived)

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Permits"
        description="Permit and transponder history."
        action={
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Permit
          </Button>
        }
      />

      {activeRecords.length === 0 ? (
        <EmptyRecordState
          title="No permit records"
          description="Add permits, transponders or jurisdiction-specific credentials."
          actionLabel="Add Permit"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="space-y-3">
          {activeRecords.map((record) => {
            const displayType =
              record.permitType === "Other"
                ? record.customPermitType || "Other"
                : record.permitType

            return (
              <Card key={record.id} className="p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {displayType}
                      </h3>

                      <StatusBadge
                        value={getPermitDisplayStatus(record)}
                        tone={
                          getPermitDisplayStatus(record) === "Active"
                            ? "success"
                            : getPermitDisplayStatus(record) ===
                                "Expired"
                              ? "danger"
                              : "warning"
                        }
                      />
                    </div>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Record ID: {record.id}
                    </p>
                  </div>

                  {record.permitNumber && (
                    <span className="rounded-md border border-border px-2.5 py-1 font-mono text-xs">
                      {record.permitNumber}
                    </span>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 md:grid-cols-3">
                  <InfoItem
                    label="Jurisdiction"
                    value={record.jurisdiction}
                  />

                  <InfoItem
                    label="Start Date"
                    value={record.startDate}
                  />

                  <InfoItem
                    label="Expiry Date"
                    value={record.expiryDate || "—"}
                  />

                  <InfoItem
                    label="Document"
                    value={record.permitDocument || "Not attached"}
                  />
                </div>

                {record.notes && (
                  <div className="mt-5 border-t border-border pt-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      Notes
                    </p>
                    <p className="mt-1 text-sm">{record.notes}</p>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {showForm && (
        <PermitForm
          onClose={() => setShowForm(false)}
          onSave={(record) => {
            onAdd(record)
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function PermitForm({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (record: PermitRecord) => void
}) {
  const [permitType, setPermitType] = useState(PERMIT_TYPES[0])
  const [customPermitType, setCustomPermitType] = useState("")
  const [permitNumber, setPermitNumber] = useState("")
  const [jurisdiction, setJurisdiction] = useState("")
  const [startDate, setStartDate] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [permitDocument, setPermitDocument] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")

  function submit() {
    if (permitType === "Other" && !customPermitType.trim()) {
      setError("Provide a custom Permit Type description.")
      return
    }

    if (
      startDate &&
      expiryDate &&
      expiryDate < startDate
    ) {
      setError("Expiry date cannot precede start date.")
      return
    }

    onSave({
      id: makeRecordId("PRM"),
      permitType,
      customPermitType,
      permitNumber,
      jurisdiction,
      startDate,
      expiryDate,
      status: "Active",
      permitDocument,
      notes,
      archived: false,
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <RecordModal
      title="Add Permit"
      onClose={onClose}
      onSave={submit}
      error={error}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FieldGroup label="Record ID">
          <Input value="Generated on save" disabled />
        </FieldGroup>

        <SearchableSelect
          label="Permit Type"
          value={permitType}
          options={PERMIT_TYPES}
          onChange={setPermitType}
        />

        {permitType === "Other" && (
          <FieldGroup label="Custom Permit Type">
            <Input
              value={customPermitType}
              onChange={(event) =>
                setCustomPermitType(event.target.value)
              }
              placeholder="Describe permit type"
            />
          </FieldGroup>
        )}

        <FieldGroup label="Permit #">
          <Input
            value={permitNumber}
            onChange={(event) =>
              setPermitNumber(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="State / Province / Jurisdiction">
          <Input
            value={jurisdiction}
            onChange={(event) =>
              setJurisdiction(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Start Date">
          <Input
            type="date"
            value={startDate}
            onChange={(event) =>
              setStartDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Expiry Date">
          <Input
            type="date"
            value={expiryDate}
            onChange={(event) =>
              setExpiryDate(event.target.value)
            }
          />
        </FieldGroup>
      </div>

      <div className="mt-6 space-y-5 border-t border-border pt-5">
        <FileField
          label="Permit Document"
          value={permitDocument}
          onChange={setPermitDocument}
        />

        <FieldGroup label="Notes">
          <textarea
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </FieldGroup>
      </div>
    </RecordModal>
  )
}

/* ============================================================================
   MAINTENANCE
   ========================================================================== */

function MaintenanceSection({
  vehicle,
  inspectionRecords,
  maintenanceRecords,
  onAddInspection,
  onAddMaintenance,
}: {
  vehicle: Vehicle
  inspectionRecords: InspectionRecord[]
  maintenanceRecords: MaintenanceRecord[]
  onAddInspection: (record: InspectionRecord) => void
  onAddMaintenance: (record: MaintenanceRecord) => void
}) {
  const [view, setView] =
    useState<MaintenanceView>("inspections")

  const [showInspectionForm, setShowInspectionForm] =
    useState(false)

  const [showMaintenanceForm, setShowMaintenanceForm] =
    useState(false)

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Maintenance"
        description="Inspection and maintenance history for this vehicle."
      />

      <div className="border-b border-border">
        <div className="flex gap-1">
          <SecondaryTab
            active={view === "inspections"}
            onClick={() => setView("inspections")}
            label="Inspections"
          />

          <SecondaryTab
            active={view === "maintenance"}
            onClick={() => setView("maintenance")}
            label="Maintenance"
          />
        </div>
      </div>

      {view === "inspections" && (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setShowInspectionForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Inspection
            </Button>
          </div>

          {inspectionRecords.filter((item) => !item.archived).length ===
          0 ? (
            <EmptyRecordState
              title="No inspection records"
              description="Add annual, safety, emissions, roadside or other inspection records."
              actionLabel="Add Inspection"
              onAction={() => setShowInspectionForm(true)}
            />
          ) : (
            <div className="space-y-3">
              {inspectionRecords
                .filter((item) => !item.archived)
                .map((record) => (
                  <InspectionRecordCard
                    key={record.id}
                    record={record}
                  />
                ))}
            </div>
          )}

          {showInspectionForm && (
            <InspectionForm
              onClose={() => setShowInspectionForm(false)}
              onSave={(record) => {
                onAddInspection(record)
                setShowInspectionForm(false)
              }}
            />
          )}
        </>
      )}

      {view === "maintenance" && (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setShowMaintenanceForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Maintenance Record
            </Button>
          </div>

          {maintenanceRecords.filter((item) => !item.archived).length ===
          0 ? (
            <EmptyRecordState
              title="No maintenance records"
              description="Add service, repair, preventive maintenance or defect repair history."
              actionLabel="Add Maintenance Record"
              onAction={() => setShowMaintenanceForm(true)}
            />
          ) : (
            <div className="space-y-3">
              {maintenanceRecords
                .filter((item) => !item.archived)
                .map((record) => (
                  <MaintenanceRecordCard
                    key={record.id}
                    record={record}
                  />
                ))}
            </div>
          )}

          {showMaintenanceForm && (
            <MaintenanceForm
              onClose={() => setShowMaintenanceForm(false)}
              onSave={(record) => {
                onAddMaintenance(record)
                setShowMaintenanceForm(false)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

/* ============================================================================
   INSPECTIONS
   ========================================================================== */

function InspectionRecordCard({
  record,
}: {
  record: InspectionRecord
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {record.inspectionType}
            </h3>

            <StatusBadge
              value={record.inspectionStatus}
              tone={
                record.inspectionStatus === "Pass"
                  ? "success"
                  : record.inspectionStatus === "Out of Service"
                    ? "danger"
                    : "warning"
              }
            />
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            Record ID: {record.id}
          </p>
        </div>

        <div className="text-sm text-muted-foreground">
          {record.inspectionDate || "No date"}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 md:grid-cols-3">
        <InfoItem
          label="Inspection Source"
          value={record.inspectionSource}
        />

        <InfoItem
          label="Next Due Date"
          value={record.nextDueDate || "—"}
        />

        <InfoItem
          label="Inspector / Shop"
          value={record.inspectorShopName}
        />

        <InfoItem
          label="Odometer"
          value={record.odometer || "—"}
        />

        <InfoItem
          label="Engine Hours"
          value={record.engineHours || "—"}
        />

        <InfoItem
          label="Defects Found"
          value={record.defectsFound}
        />

        <InfoItem
          label="Service Facility"
          value={record.serviceFacility}
        />

        <InfoItem
          label="Inspection File"
          value={record.file || "Not attached"}
        />
      </div>

      {record.inspectionType ===
        "Reefer / Temperature-Control Unit Inspection" && (
        <div className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          TCU: Temperature Control Unit
        </div>
      )}

      {record.defectsFound === "Yes" && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Defect relationship available</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This inspection can later connect to Defect → Repair →
              Evidence → Closed without changing the inspection record.
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}

function InspectionForm({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (record: InspectionRecord) => void
}) {
  const [inspectionType, setInspectionType] =
    useState(INSPECTION_TYPES[0])

  const [inspectionSource, setInspectionSource] =
    useState<InspectionSource>("Internal")

  const [inspectionStatus, setInspectionStatus] =
    useState<InspectionStatus>("Pass")

  const [inspectionDate, setInspectionDate] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [nextDueDate, setNextDueDate] = useState("")
  const [inspectorShopName, setInspectorShopName] = useState("")
  const [odometer, setOdometer] = useState("")
  const [engineHours, setEngineHours] = useState("")
  const [defectsFound, setDefectsFound] =
    useState<"Yes" | "No">("No")
  const [serviceFacility, setServiceFacility] = useState("")
  const [file, setFile] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")

  function submit() {
    if (Number(odometer) < 0 || Number(engineHours) < 0) {
      setError("Odometer and engine hours cannot be negative.")
      return
    }

    if (
      inspectionDate &&
      expiryDate &&
      expiryDate < inspectionDate
    ) {
      setError("Expiry date cannot precede inspection date.")
      return
    }

    if (
      inspectionDate &&
      nextDueDate &&
      nextDueDate < inspectionDate
    ) {
      setError("Next due date cannot precede inspection date.")
      return
    }

    onSave({
      id: makeRecordId("INS"),
      inspectionType,
      inspectionSource,
      inspectionStatus,
      inspectionDate,
      expiryDate,
      nextDueDate,
      inspectorShopName,
      odometer,
      engineHours,
      defectsFound,
      serviceFacility,
      file,
      notes,
      archived: false,
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <RecordModal
      title="Add Inspection"
      onClose={onClose}
      onSave={submit}
      error={error}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FieldGroup label="Record ID">
          <Input value="Generated on save" disabled />
        </FieldGroup>

        <FieldGroup label="Inspection Type">
          <SelectInput
            value={inspectionType}
            onChange={setInspectionType}
            options={INSPECTION_TYPES}
          />
        </FieldGroup>

        <FieldGroup label="Inspection Source">
          <SelectInput
            value={inspectionSource}
            onChange={(value) =>
              setInspectionSource(value as InspectionSource)
            }
            options={INSPECTION_SOURCES}
          />
        </FieldGroup>

        <FieldGroup label="Inspection Status">
          <SelectInput
            value={inspectionStatus}
            onChange={(value) =>
              setInspectionStatus(value as InspectionStatus)
            }
            options={INSPECTION_STATUSES}
          />
        </FieldGroup>

        <FieldGroup label="Inspection Date">
          <Input
            type="date"
            value={inspectionDate}
            onChange={(event) =>
              setInspectionDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Expiry Date">
          <Input
            type="date"
            value={expiryDate}
            onChange={(event) =>
              setExpiryDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Next Due Date">
          <Input
            type="date"
            value={nextDueDate}
            onChange={(event) =>
              setNextDueDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Inspector / Shop Name">
          <Input
            value={inspectorShopName}
            onChange={(event) =>
              setInspectorShopName(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Odometer">
          <Input
            type="number"
            min="0"
            value={odometer}
            onChange={(event) =>
              setOdometer(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Engine Hours">
          <Input
            type="number"
            min="0"
            value={engineHours}
            onChange={(event) =>
              setEngineHours(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Defects Found">
          <SelectInput
            value={defectsFound}
            onChange={(value) =>
              setDefectsFound(value as "Yes" | "No")
            }
            options={["Yes", "No"]}
          />
        </FieldGroup>

        <FieldGroup label="Service Facility">
          <Input
            value={serviceFacility}
            onChange={(event) =>
              setServiceFacility(event.target.value)
            }
          />
        </FieldGroup>
      </div>

      <div className="mt-6 space-y-5 border-t border-border pt-5">
        <FileField
          label="Inspection File / Report"
          value={file}
          onChange={setFile}
        />

        <FieldGroup label="Notes">
          <textarea
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </FieldGroup>
      </div>
    </RecordModal>
  )
}

/* ============================================================================
   MAINTENANCE RECORDS
   ========================================================================== */

function MaintenanceRecordCard({
  record,
}: {
  record: MaintenanceRecord
}) {
  const total =
    Number(record.partsCost || 0) +
    Number(record.labourCost || 0)

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {record.maintenanceType}
            </h3>

            <StatusBadge
              value={record.maintenanceStatus}
              tone={
                record.maintenanceStatus === "Completed"
                  ? "success"
                  : record.maintenanceStatus === "Cancelled"
                    ? "danger"
                    : "warning"
              }
            />
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            Record ID: {record.id}
          </p>
        </div>

        <div className="text-sm">
          {record.serviceDate || "No service date"}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 md:grid-cols-3 xl:grid-cols-4">
        <InfoItem
          label="Vendor / Repair Shop"
          value={record.vendor}
        />

        <InfoItem
          label="Work Order"
          value={record.workOrderNumber}
        />

        <InfoItem
          label="Invoice"
          value={record.invoiceNumber}
        />

        <InfoItem
          label="Parts Cost"
          value={money(record.partsCost)}
        />

        <InfoItem
          label="Labour Cost"
          value={money(record.labourCost)}
        />

        <InfoItem
          label="Total Cost"
          value={money(String(total))}
        />

        <InfoItem
          label="Next Service Due"
          value={record.nextServiceDueDate || "—"}
        />

        <InfoItem
          label="Next Service Odometer"
          value={record.nextServiceDueOdometer || "—"}
        />
      </div>

      {record.file && (
        <div className="mt-4 border-t border-border pt-4">
          <InfoItem
            label="Maintenance File / Invoice"
            value={record.file}
          />
        </div>
      )}

      {record.notes && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">
            Notes
          </p>
          <p className="mt-1 text-sm">{record.notes}</p>
        </div>
      )}
    </Card>
  )
}

function MaintenanceForm({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (record: MaintenanceRecord) => void
}) {
  const [maintenanceType, setMaintenanceType] =
    useState(MAINTENANCE_TYPES[0])

  const [maintenanceStatus, setMaintenanceStatus] =
    useState<MaintenanceStatus>("Completed")

  const [serviceDate, setServiceDate] = useState("")
  const [odometer, setOdometer] = useState("")
  const [engineHours, setEngineHours] = useState("")
  const [vendor, setVendor] = useState("")
  const [workOrderNumber, setWorkOrderNumber] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [partsCost, setPartsCost] = useState("")
  const [labourCost, setLabourCost] = useState("")
  const [nextServiceDueDate, setNextServiceDueDate] =
    useState("")
  const [nextServiceDueOdometer, setNextServiceDueOdometer] =
    useState("")
  const [file, setFile] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")

  const total =
    Number(partsCost || 0) + Number(labourCost || 0)

  function submit() {
    if (
      Number(partsCost) < 0 ||
      Number(labourCost) < 0 ||
      Number(odometer) < 0 ||
      Number(engineHours) < 0 ||
      Number(nextServiceDueOdometer) < 0
    ) {
      setError(
        "Costs, odometer and service odometer values cannot be negative."
      )
      return
    }

    onSave({
      id: makeRecordId("MNT"),
      maintenanceType,
      maintenanceStatus,
      serviceDate,
      odometer,
      engineHours,
      vendor,
      workOrderNumber,
      invoiceNumber,
      partsCost,
      labourCost,
      nextServiceDueDate,
      nextServiceDueOdometer,
      file,
      notes,
      archived: false,
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <RecordModal
      title="Add Maintenance Record"
      onClose={onClose}
      onSave={submit}
      error={error}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FieldGroup label="Record ID">
          <Input value="Generated on save" disabled />
        </FieldGroup>

        <FieldGroup label="Maintenance Type">
          <SelectInput
            value={maintenanceType}
            onChange={setMaintenanceType}
            options={MAINTENANCE_TYPES}
          />
        </FieldGroup>

        <FieldGroup label="Maintenance Status">
          <SelectInput
            value={maintenanceStatus}
            onChange={(value) =>
              setMaintenanceStatus(value as MaintenanceStatus)
            }
            options={MAINTENANCE_STATUSES}
          />
        </FieldGroup>

        <FieldGroup label="Service Date">
          <Input
            type="date"
            value={serviceDate}
            onChange={(event) =>
              setServiceDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Odometer">
          <Input
            type="number"
            min="0"
            value={odometer}
            onChange={(event) =>
              setOdometer(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Engine Hours">
          <Input
            type="number"
            min="0"
            value={engineHours}
            onChange={(event) =>
              setEngineHours(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Vendor / Repair Shop">
          <Input
            value={vendor}
            onChange={(event) =>
              setVendor(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Work Order Number">
          <Input
            value={workOrderNumber}
            onChange={(event) =>
              setWorkOrderNumber(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Invoice Number">
          <Input
            value={invoiceNumber}
            onChange={(event) =>
              setInvoiceNumber(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Parts Cost">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={partsCost}
            onChange={(event) =>
              setPartsCost(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Labour Cost">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={labourCost}
            onChange={(event) =>
              setLabourCost(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Total Cost">
          <Input value={money(String(total))} disabled />
        </FieldGroup>

        <FieldGroup label="Next Service Due Date">
          <Input
            type="date"
            value={nextServiceDueDate}
            onChange={(event) =>
              setNextServiceDueDate(event.target.value)
            }
          />
        </FieldGroup>

        <FieldGroup label="Next Service Due Odometer">
          <Input
            type="number"
            min="0"
            value={nextServiceDueOdometer}
            onChange={(event) =>
              setNextServiceDueOdometer(event.target.value)
            }
          />
        </FieldGroup>
      </div>

      <div className="mt-6 space-y-5 border-t border-border pt-5">
        <FileField
          label="Maintenance File / Invoice"
          value={file}
          onChange={setFile}
        />

        <FieldGroup label="Notes">
          <textarea
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </FieldGroup>
      </div>
    </RecordModal>
  )
}

/* ============================================================================
   SETTINGS
   ========================================================================== */

function VehicleSettings() {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Settings"
        description="Vehicle-specific configuration reserved for future TES functionality."
      />

      <Card className="p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsPlaceholder
            title="Alert Preferences"
            description="Vehicle-specific compliance and expiry alert configuration."
          />

          <SettingsPlaceholder
            title="Maintenance Intervals"
            description="Future vehicle-specific service interval configuration."
          />

          <SettingsPlaceholder
            title="Integrations"
            description="Future GPS, telematics and other vehicle integrations."
          />

          <SettingsPlaceholder
            title="Compliance Configuration"
            description="Future vehicle-specific compliance rules."
          />

          <SettingsPlaceholder
            title="Custom Fields"
            description="Future organization-specific vehicle fields."
          />
        </div>
      </Card>
    </div>
  )
}

/* ============================================================================
   CREATE VEHICLE
   ========================================================================== */

function CreateVehicleModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (vehicle: Vehicle) => void
}) {
  const [vehicleType, setVehicleType] =
    useState<VehicleType>("Tractor")

  const [status, setStatus] =
    useState<VehicleStatus>("Active")

  const [equipmentNumber, setEquipmentNumber] = useState("")
  const [vin, setVin] = useState("")
  const [year, setYear] = useState("")
  const [make, setMake] = useState("")
  const [model, setModel] = useState("")
  const [operatingRegion, setOperatingRegion] =
    useState<OperatingRegion>("Cross Border")

  const [error, setError] = useState("")

  function submit() {
    if (!equipmentNumber.trim()) {
      setError("Equipment # is required.")
      return
    }

    if (vin && vin.length !== 17) {
      setError("VIN should contain 17 characters.")
      return
    }

    const recordId = makeRecordId("VEH")

    onCreate({
      id: crypto.randomUUID(),
      recordId,
      equipmentNumber,
      vehicleType,
      status,
      vin,
      year,
      make,
      model,
      color: "",
      operatingRegion,
      equipmentAxles: "",
      fleetStartDate: "",
      fleetEndDate: "",
      tareWeight: "",
      tareWeightUnit: "kg",
      fuelType: "Diesel",
      equipmentLength: "",
      equipmentLengthUnit: "ft",
      gpsProvider: "",
    })
  }

  return (
    <RecordModal
      title="Create Vehicle"
      onClose={onClose}
      onSave={submit}
      error={error}
      saveLabel="Create Vehicle"
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FieldGroup label="Record ID">
          <Input value="Generated automatically" disabled />
        </FieldGroup>

        <FieldGroup label="Vehicle Type">
          <SelectInput
            value={vehicleType}
            onChange={(value) =>
              setVehicleType(value as VehicleType)
            }
            options={VEHICLE_TYPES}
          />
        </FieldGroup>

        <FieldGroup label="Status">
          <SelectInput
            value={status}
            onChange={(value) =>
              setStatus(value as VehicleStatus)
            }
            options={["Active", "Inactive"]}
          />
        </FieldGroup>

        <FieldGroup label="Equipment #">
          <Input
            value={equipmentNumber}
            onChange={(event) =>
              setEquipmentNumber(event.target.value)
            }
            placeholder="e.g. Unit 101"
          />
        </FieldGroup>

        <FieldGroup label="VIN">
          <Input
            value={vin}
            maxLength={17}
            onChange={(event) =>
              setVin(event.target.value.toUpperCase())
            }
            placeholder="17-character VIN"
          />
        </FieldGroup>

        <FieldGroup label="Year">
          <Input
            type="number"
            min="1900"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Make">
          <Input
            value={make}
            onChange={(event) => setMake(event.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Model">
          <Input
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Operating Region">
          <SelectInput
            value={operatingRegion}
            onChange={(value) =>
              setOperatingRegion(value as OperatingRegion)
            }
            options={OPERATING_REGIONS}
          />
        </FieldGroup>
      </div>
    </RecordModal>
  )
}

/* ============================================================================
   REUSABLE UI
   ========================================================================== */

function FieldGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function SelectInput({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`flex h-9 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring ${className}`}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

function SearchableSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const filtered = options.filter((option) =>
    option.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm shadow-sm"
        >
          <span>{value}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover p-2 shadow-lg">
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search permit type..."
              className="mb-2"
            />

            <div className="max-h-56 overflow-y-auto">
              {filtered.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                    setSearch("")
                  }}
                >
                  {option}
                </button>
              ))}

              {filtered.length === 0 && (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  No matching permit types.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>

        {description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      {action}
    </div>
  )
}

function SectionTitle({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>

      {description && (
        <p className="mt-1 text-sm text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}

function DetailTab({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

function SecondaryTab({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-2.5 text-sm font-medium ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

function HeaderValue({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-medium">
        {value}
      </p>
    </div>
  )
}

function InfoItem({
  label,
  value,
}: {
  label: string
  value?: string
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm">
        {value || "—"}
      </p>
    </div>
  )
}

function StatusBadge({
  value,
  tone,
}: {
  value: string
  tone: "success" | "danger" | "warning" | "neutral"
}) {
  const classes = {
    success:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    danger:
      "bg-destructive/10 text-destructive",
    warning:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    neutral:
      "bg-muted text-muted-foreground",
  }

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classes[tone]}`}
    >
      {value}
    </span>
  )
}

function EmptyRecordState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <Card className="flex min-h-[260px] flex-col items-center justify-center p-8 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">
        <FileText className="h-5 w-5 text-muted-foreground" />
      </div>

      <h3 className="font-semibold">{title}</h3>

      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {description}
      </p>

      <Button
        variant="outline"
        className="mt-4"
        onClick={onAction}
      >
        <Plus className="mr-2 h-4 w-4" />
        {actionLabel}
      </Button>
    </Card>
  )
}

function SettingsPlaceholder({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <Settings2 className="mt-0.5 h-4 w-4 text-muted-foreground" />

        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ============================================================================
   DOCUMENT / FILE UI
   ========================================================================== */

function DocumentUploadButton({
  label,
  onChange,
}: {
  label: string
  onChange: (filename: string) => void
}) {
  return (
    <label className="inline-flex cursor-pointer items-center">
      <span className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
        <Upload className="mr-2 h-4 w-4" />
        {label}
      </span>

      <input
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(event) =>
          onChange(event.target.files?.[0]?.name || "")
        }
      />
    </label>
  )
}

function FileField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <FieldGroup label={label}>
      <label className="flex cursor-pointer items-center justify-between rounded-md border border-dashed border-input bg-muted/20 px-3 py-2.5 text-sm hover:bg-muted/40">
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />

          <span className="truncate">
            {value || "Choose document"}
          </span>
        </span>

        <span className="ml-3 shrink-0 text-xs font-medium text-primary">
          Browse
        </span>

        <input
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(event) =>
            onChange(event.target.files?.[0]?.name || "")
          }
        />
      </label>
    </FieldGroup>
  )
}

function UploadNotice({
  filename,
  message,
}: {
  filename: string
  message: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
      <Upload className="mt-0.5 h-4 w-4 text-primary" />

      <div className="min-w-0">
        <p className="text-sm font-medium">{filename}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  )
}

function DocumentEvidenceSelector({
  documents,
  options,
  onChange,
}: {
  documents: string[]
  options: string[]
  onChange: (documents: string[]) => void
}) {
  function toggle(document: string) {
    if (documents.includes(document)) {
      onChange(documents.filter((item) => item !== document))
    } else {
      onChange([...documents, document])
    }
  }

  return (
    <div>
      <div className="mb-3">
        <p className="text-sm font-medium">Ownership Evidence</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Attach the evidence applicable to this ownership record.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {options.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-muted/40"
          >
            <input
              type="checkbox"
              checked={documents.includes(option)}
              onChange={() => toggle(option)}
              className="rounded border-input"
            />

            {option}
          </label>
        ))}
      </div>
    </div>
  )
}

/* ============================================================================
   MODAL
   ========================================================================== */

function RecordModal({
  title,
  children,
  onClose,
  onSave,
  error,
  saveLabel = "Save Record",
}: {
  title: string
  children: ReactNode
  onClose: () => void
  onSave: () => void
  error?: string
  saveLabel?: string
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              New record — existing historical records are not overwritten.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {children}

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>

          <Button onClick={onSave}>{saveLabel}</Button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================================
   SMALL HELPERS
   ========================================================================== */

function getActiveRegistration(
  records: RegistrationRecord[]
) {
  return records
    .filter(
      (record) =>
        !record.archived &&
        getRegistrationStatus(record) === "Active"
    )
    .sort((a, b) =>
      (b.registrationDate || "").localeCompare(
        a.registrationDate || ""
      )
    )[0]
}

function getCurrentPlate(
  vehicleId: string,
  registrationRecords: Record<string, RegistrationRecord[]>
) {
  const registration = getActiveRegistration(
    registrationRecords[vehicleId] ?? []
  )

  return registration?.plate || ""
}
