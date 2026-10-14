/**
 * Summary metrics and list filters for the restored Insurance workspace (the original selectors, computed from canonical data and
 * the canonical as-of date instead of the browser clock and stored statuses).
 */

import type { BondEntry, InsuranceModel, TransportationRecord, WorkersRecord } from "./model"
import { getDeadlineStatus } from "./deadline"

export function getInsuranceSummaryMetrics(model: InsuranceModel) {
  const live = [...model.transportation, ...model.workers, ...model.bonds].filter((record) => record.status !== "Archived")
  let healthyCount = 0
  let watchCount = 0
  let urgentCount = 0
  let criticalCount = 0
  let expiredCount = 0
  for (const record of live) {
    // A continuous bond (no stated end) has no deadline and is not counted in any band, as in the original.
    const status = getDeadlineStatus(record.deadlineDate, model.asOfDate)
    if (status === "Healthy") healthyCount++
    else if (status === "Watch") watchCount++
    else if (status === "Urgent") urgentCount++
    else if (status === "Critical") criticalCount++
    else if (status === "Expired") expiredCount++
  }
  return {
    activeTotal: live.length,
    healthyCount,
    watchCount,
    urgentCount,
    criticalCount,
    expiredCount,
    // The summary card shows one figure: the Canadian-dollar liability limits in force today; other currencies are listed beside it.
    totalLiabilityLimit: model.liabilityByCurrency.CAD ?? 0,
  }
}

export function filterTransportationRecords(records: TransportationRecord[], showArchived: boolean, searchQuery: string) {
  const q = searchQuery.trim().toLowerCase()
  return records.filter((t) => {
    if (!showArchived && t.status === "Archived") return false
    if (!q) return true
    return (
      t.policyNumber.toLowerCase().includes(q) ||
      t.insurerName.toLowerCase().includes(q) ||
      t.insuranceType.toLowerCase().includes(q) ||
      t.coverages.some((c) => c.label.toLowerCase().includes(q)) ||
      Boolean(t.broker?.organizationName?.toLowerCase().includes(q)) ||
      Boolean(t.broker?.contactName?.toLowerCase().includes(q))
    )
  })
}

export function filterWorkersRecords(records: WorkersRecord[], showArchived: boolean, searchQuery: string) {
  const q = searchQuery.trim().toLowerCase()
  return records.filter((w) => {
    if (!showArchived && w.status === "Archived") return false
    if (!q) return true
    return w.accountNumber.toLowerCase().includes(q) || w.providerName.toLowerCase().includes(q) || w.jurisdiction.toLowerCase().includes(q)
  })
}

export function filterBondRecords(records: BondEntry[], showArchived: boolean, searchQuery: string) {
  const q = searchQuery.trim().toLowerCase()
  return records.filter((b) => {
    if (!showArchived && b.status === "Archived") return false
    if (!q) return true
    return b.bondNumber.toLowerCase().includes(q) || b.suretyName.toLowerCase().includes(q) || b.bondType.toLowerCase().includes(q) || b.principalName.toLowerCase().includes(q)
  })
}
