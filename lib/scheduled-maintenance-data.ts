export type ScheduledMaintenanceBasis = "CALENDAR" | "ODOMETER" | "ENGINE_HOURS" | "COMBINED" | "CONDITION_TRIGGERED"
export type ScheduledMaintenanceOutcome = "COMPLETED_NO_DEFECT" | "COMPLETED_ATTENTION_REQUIRED" | "COMPLETED_REPAIR_REQUIRED"
export type ScheduledMaintenanceStatus = "DRAFT" | "SUBMITTED_LOCKED" | "INTERNAL_REVIEW" | "ARCHIVED"
export type ScheduledMaintenanceSource = "CLIENT_PORTAL" | "TES_INTERNAL" | "OCR_IMPORT" | "SYSTEM_MIGRATION"
export type MaintenancePerformedBy = "IN_HOUSE" | "EXTERNAL_REPAIR_SHOP" | "MOBILE_MECHANIC" | "DEALER_OEM" | "ROADSIDE_SERVICE" | "OTHER"
export type MaintenanceChecklistStatus = "OK" | "SERVICED" | "ATTENTION_REQUIRED" | "REPAIR_REQUIRED" | "NOT_APPLICABLE"
export type DistanceUnit = "KM" | "MI"

export interface ScheduledMaintenanceProgramRule {
  id: string
  companyId: string
  vehicleId?: string
  name: string
  basis: ScheduledMaintenanceBasis
  intervalDays?: number
  intervalDistance?: number
  distanceUnit?: DistanceUnit
  intervalEngineHours?: number
  active: boolean
  notes?: string
}

export interface ScheduledMaintenanceChecklistItem {
  id: string
  system: string
  component: string
  status: MaintenanceChecklistStatus
  actionTaken?: string
  measurement?: string
  notes?: string
  createsRepairNeed?: boolean
  linkedRepairRecordId?: string
}

export interface ScheduledMaintenanceServiceAction {
  id: string
  action: string
  performed: boolean
  notes?: string
}

export interface ScheduledMaintenanceSubmission {
  id: string
  companyId: string
  vehicleId: string
  unitNumber: string
  vin: string
  plateNumber?: string
  plateJurisdiction?: string
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
  tireSize?: string
  ownershipProviderName?: string

  source: ScheduledMaintenanceSource
  status: ScheduledMaintenanceStatus
  submittedByName: string
  submittedByRole?: string
  submittedAt: string
  lockedAt?: string

  programRuleId?: string
  programName: string
  basis: ScheduledMaintenanceBasis
  triggerSource: "SCHEDULED" | "ODOMETER" | "ENGINE_HOURS" | "CLIENT_REPORTED_CONDITION" | "FOLLOW_UP"
  dueDate?: string
  dueOdometer?: number
  dueEngineHours?: number
  serviceDate: string
  serviceCompletionDate: string
  odometer: number
  odometerUnit: DistanceUnit
  engineHours?: number
  nextDueDate?: string
  nextDueOdometer?: number
  nextDueEngineHours?: number

  performedBy: MaintenancePerformedBy
  facilityName?: string
  facilityAddress?: string
  technicianName?: string
  workOrderNumber?: string
  invoiceNumber?: string

  outcome: ScheduledMaintenanceOutcome
  checklist: ScheduledMaintenanceChecklistItem[]
  serviceActions: ScheduledMaintenanceServiceAction[]
  remarks?: string

  evidenceIds: string[]
  generatedPdfEvidenceId?: string
  linkedRepairRecordIds: string[]
  amendmentOfRecordId?: string
  createdAt: string
  updatedAt: string
}

export interface ScheduledMaintenanceValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export const PREVENTIVE_MAINTENANCE_PROGRAM_TYPES = [
  "Preventive / Scheduled Maintenance",
  "Oil and Filter Service",
  "Lubrication Service",
  "Tire Service / Rotation",
  "Wheel Alignment",
  "Reefer Unit Service",
  "Other Maintenance Service",
] as const

export const DEFAULT_SCHEDULED_MAINTENANCE_CHECKLIST: Omit<ScheduledMaintenanceChecklistItem, "id" | "status">[] = [
  { system: "Engine / Fuel / Exhaust", component: "Engine, fuel system, exhaust, belts, leaks" },
  { system: "Fluids", component: "Engine oil, coolant, washer fluid, power steering, brake reservoir" },
  { system: "Electrical / Lighting", component: "Lamps, reflectors, wiring, charging system" },
  { system: "Wheels / Tires", component: "Tire condition, tread depth, wheels, fasteners" },
  { system: "Brakes", component: "Friction components, air brake system, park brake, brake adjustment" },
  { system: "Steering / Suspension", component: "Steering linkage, suspension, shocks, alignment condition" },
  { system: "Body / Frame", component: "Body, chassis frame, fifth wheel, hitch, rear impact guard" },
  { system: "Cab / Visibility", component: "Windshield, mirrors, wipers, washers, heater/defroster" },
  { system: "Safety Equipment", component: "Fire extinguisher, warning devices, emergency equipment" },
  { system: "Reefer / Auxiliary Unit", component: "Reefer or auxiliary equipment, if applicable" },
]

export const DEFAULT_SCHEDULED_MAINTENANCE_ACTIONS: Omit<ScheduledMaintenanceServiceAction, "id" | "performed">[] = [
  { action: "Oil change" },
  { action: "Oil filter" },
  { action: "Fuel filter" },
  { action: "Engine air filter" },
  { action: "Cabin air filter" },
  { action: "Lubrication / greasing" },
  { action: "Fluid level check and top-up" },
  { action: "Tire rotation" },
  { action: "Brake inspection / measurement" },
  { action: "Coolant / DEF / washer fluid check" },
]

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

export function todayISODate(now = new Date()): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`
}

export function isValidISODateStrict(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
}

export function addDaysISO(value: string, days: number): string {
  if (!isValidISODateStrict(value)) return ""
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return todayISODate(date)
}

export function createScheduledMaintenanceId(prefix = "PM"): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`
}

export function buildDefaultScheduledMaintenanceChecklist(): ScheduledMaintenanceChecklistItem[] {
  return DEFAULT_SCHEDULED_MAINTENANCE_CHECKLIST.map((item) => ({
    ...item,
    id: createScheduledMaintenanceId("PMI"),
    status: "OK",
  }))
}

export function buildDefaultScheduledMaintenanceActions(): ScheduledMaintenanceServiceAction[] {
  return DEFAULT_SCHEDULED_MAINTENANCE_ACTIONS.map((item) => ({
    ...item,
    id: createScheduledMaintenanceId("PMA"),
    performed: false,
  }))
}

export function deriveScheduledMaintenanceOutcome(items: Pick<ScheduledMaintenanceChecklistItem, "status">[]): ScheduledMaintenanceOutcome {
  if (items.some((item) => item.status === "REPAIR_REQUIRED")) return "COMPLETED_REPAIR_REQUIRED"
  if (items.some((item) => item.status === "ATTENTION_REQUIRED")) return "COMPLETED_ATTENTION_REQUIRED"
  return "COMPLETED_NO_DEFECT"
}

export function calculateNextScheduledMaintenanceDue(input: {
  serviceDate: string
  odometer?: number
  engineHours?: number
  intervalDays?: number
  intervalDistance?: number
  intervalEngineHours?: number
}): { nextDueDate?: string; nextDueOdometer?: number; nextDueEngineHours?: number } {
  return {
    nextDueDate: input.intervalDays ? addDaysISO(input.serviceDate, input.intervalDays) : undefined,
    nextDueOdometer: input.intervalDistance && Number.isFinite(input.odometer) ? Number(input.odometer) + input.intervalDistance : undefined,
    nextDueEngineHours: input.intervalEngineHours && Number.isFinite(input.engineHours) ? Number(input.engineHours) + input.intervalEngineHours : undefined,
  }
}

export function validateScheduledMaintenanceSubmission(record: ScheduledMaintenanceSubmission): ScheduledMaintenanceValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!record.companyId) errors.push("Company is required.")
  if (!record.vehicleId) errors.push("Vehicle is required.")
  if (!record.unitNumber.trim()) errors.push("Unit number is required.")
  if (!record.vin.trim()) errors.push("VIN is required.")
  if (!record.serviceDate || !isValidISODateStrict(record.serviceDate)) errors.push("Service date must be a real date in YYYY-MM-DD format.")
  if (!record.serviceCompletionDate || !isValidISODateStrict(record.serviceCompletionDate)) errors.push("Service completion date must be a real date in YYYY-MM-DD format.")
  if (record.dueDate && !isValidISODateStrict(record.dueDate)) errors.push("Due date must be a real date in YYYY-MM-DD format.")
  if (record.nextDueDate && !isValidISODateStrict(record.nextDueDate)) errors.push("Next due date must be a real date in YYYY-MM-DD format.")
  if (!Number.isFinite(record.odometer) || record.odometer < 0) errors.push("Odometer is required and must be zero or greater.")
  if (record.engineHours !== undefined && (!Number.isFinite(record.engineHours) || record.engineHours < 0)) errors.push("Engine hours must be zero or greater.")
  if (!record.submittedByName.trim()) errors.push("Submitted by is required.")
  if (!record.performedBy) errors.push("Performed by is required.")
  if (!record.checklist.length) errors.push("At least one maintenance checklist item is required.")

  const repairItems = record.checklist.filter((item) => item.status === "REPAIR_REQUIRED")
  if (record.outcome === "COMPLETED_REPAIR_REQUIRED" && repairItems.length === 0) {
    errors.push("Repair-required outcome needs at least one repair-required checklist item.")
  }
  if (repairItems.length && record.linkedRepairRecordIds.length === 0) {
    warnings.push("Repair-required findings should be linked to an in-house repair report or repair bill.")
  }
  if (!record.evidenceIds.length && !record.generatedPdfEvidenceId) {
    warnings.push("Submitted maintenance should have generated PDF evidence attached.")
  }

  return { ok: errors.length === 0, errors, warnings }
}

export function lockScheduledMaintenanceSubmission(record: ScheduledMaintenanceSubmission, lockedAt = new Date().toISOString()): ScheduledMaintenanceSubmission {
  return {
    ...record,
    status: "SUBMITTED_LOCKED",
    lockedAt,
    updatedAt: lockedAt,
  }
}

export function scheduledMaintenancePdfFileName(record: ScheduledMaintenanceSubmission): string {
  const unit = record.unitNumber.replace(/[^a-z0-9_-]+/gi, "_") || "unit"
  return `${record.serviceDate}_Scheduled_Maintenance_${unit}_${record.id}.pdf`
}

export function buildScheduledMaintenancePdfModel(record: ScheduledMaintenanceSubmission) {
  return {
    title: "Preventive / Scheduled Maintenance Report",
    subtitle: "Client-submitted locked maintenance record",
    fileName: scheduledMaintenancePdfFileName(record),
    company: {
      id: record.companyId,
    },
    vehicle: {
      unitNumber: record.unitNumber,
      vin: record.vin,
      plate: [record.plateNumber, record.plateJurisdiction].filter(Boolean).join(" "),
      yearMakeModel: [record.vehicleYear, record.vehicleMake, record.vehicleModel].filter(Boolean).join(" "),
      tireSize: record.tireSize,
      ownershipProviderName: record.ownershipProviderName,
    },
    service: {
      programName: record.programName,
      basis: record.basis,
      triggerSource: record.triggerSource,
      serviceDate: record.serviceDate,
      serviceCompletionDate: record.serviceCompletionDate,
      odometer: `${record.odometer.toLocaleString()} ${record.odometerUnit}`,
      engineHours: record.engineHours,
      dueDate: record.dueDate,
      dueOdometer: record.dueOdometer,
      dueEngineHours: record.dueEngineHours,
      nextDueDate: record.nextDueDate,
      nextDueOdometer: record.nextDueOdometer,
      nextDueEngineHours: record.nextDueEngineHours,
      outcome: record.outcome,
    },
    provider: {
      performedBy: record.performedBy,
      facilityName: record.facilityName,
      facilityAddress: record.facilityAddress,
      technicianName: record.technicianName,
      workOrderNumber: record.workOrderNumber,
      invoiceNumber: record.invoiceNumber,
    },
    checklist: record.checklist,
    serviceActions: record.serviceActions,
    remarks: record.remarks,
    submitted: {
      submittedByName: record.submittedByName,
      submittedByRole: record.submittedByRole,
      submittedAt: record.submittedAt,
      lockedAt: record.lockedAt,
    },
  }
}

