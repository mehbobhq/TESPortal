import test from "node:test"
import assert from "node:assert/strict"

import {
  addDaysISO,
  buildDefaultScheduledMaintenanceChecklist,
  calculateNextScheduledMaintenanceDue,
  deriveScheduledMaintenanceOutcome,
  isValidISODateStrict,
  lockScheduledMaintenanceSubmission,
  validateScheduledMaintenanceSubmission,
  type ScheduledMaintenanceSubmission,
} from "../lib/scheduled-maintenance-data.ts"

function baseRecord(): ScheduledMaintenanceSubmission {
  return {
    id: "PM-1",
    companyId: "C1",
    vehicleId: "V1",
    unitNumber: "105",
    vin: "1XPBD49X1MD123456",
    source: "CLIENT_PORTAL",
    status: "DRAFT",
    submittedByName: "Client Manager",
    submittedAt: "2026-09-23T18:30:00.000Z",
    programName: "Preventive / Scheduled Maintenance",
    basis: "COMBINED",
    triggerSource: "SCHEDULED",
    serviceDate: "2026-09-23",
    serviceCompletionDate: "2026-09-23",
    odometer: 183420,
    odometerUnit: "KM",
    performedBy: "IN_HOUSE",
    outcome: "COMPLETED_NO_DEFECT",
    checklist: buildDefaultScheduledMaintenanceChecklist(),
    serviceActions: [],
    evidenceIds: [],
    linkedRepairRecordIds: [],
    createdAt: "2026-09-23T18:30:00.000Z",
    updatedAt: "2026-09-23T18:30:00.000Z",
  }
}

test("strict ISO dates accept real dates and reject impossible dates", () => {
  assert.equal(isValidISODateStrict("2026-09-23"), true)
  assert.equal(isValidISODateStrict("2026-02-29"), false)
  assert.equal(isValidISODateStrict("2026-13-01"), false)
  assert.equal(isValidISODateStrict("09/23/2026"), false)
})

test("next scheduled maintenance due can be calculated by date, distance and hours", () => {
  assert.deepEqual(calculateNextScheduledMaintenanceDue({
    serviceDate: "2026-09-23",
    odometer: 183420,
    engineHours: 6240,
    intervalDays: 90,
    intervalDistance: 30000,
    intervalEngineHours: 500,
  }), {
    nextDueDate: "2026-12-22",
    nextDueOdometer: 213420,
    nextDueEngineHours: 6740,
  })
  assert.equal(addDaysISO("2026-02-30", 90), "")
})

test("checklist outcome escalates to attention or repair required", () => {
  const clean = buildDefaultScheduledMaintenanceChecklist()
  assert.equal(deriveScheduledMaintenanceOutcome(clean), "COMPLETED_NO_DEFECT")
  assert.equal(deriveScheduledMaintenanceOutcome([{ ...clean[0], status: "ATTENTION_REQUIRED" }]), "COMPLETED_ATTENTION_REQUIRED")
  assert.equal(deriveScheduledMaintenanceOutcome([{ ...clean[0], status: "REPAIR_REQUIRED" }]), "COMPLETED_REPAIR_REQUIRED")
})

test("submitted client records lock after submission", () => {
  const record = lockScheduledMaintenanceSubmission(baseRecord(), "2026-09-23T19:00:00.000Z")
  assert.equal(record.status, "SUBMITTED_LOCKED")
  assert.equal(record.lockedAt, "2026-09-23T19:00:00.000Z")
})

test("validation blocks missing required fields and invalid date formats", () => {
  const valid = baseRecord()
  assert.equal(validateScheduledMaintenanceSubmission(valid).ok, true)
  const invalid = { ...valid, serviceDate: "20260923", odometer: -1, submittedByName: "" }
  const result = validateScheduledMaintenanceSubmission(invalid)
  assert.equal(result.ok, false)
  assert.equal(result.errors.some((message) => message.includes("Service date")), true)
  assert.equal(result.errors.some((message) => message.includes("Odometer")), true)
  assert.equal(result.errors.some((message) => message.includes("Submitted by")), true)
})

