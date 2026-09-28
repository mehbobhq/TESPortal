import { getDeadlineStatus } from "@/lib/deadline-engine";
import type { StoredInsuranceData, TransportationInsuranceRecord, WorkersInsuranceRecord, BondRecord } from "./insurance-domain";

export function getInsuranceSummaryMetrics(store: StoredInsuranceData) {
    const allActiveTransportation = store.transportation.filter((t) => t.status !== "Archived");
    const allActiveWorkers = store.workers.filter((w) => w.status !== "Archived");
    const allActiveBonds = store.bonds.filter((b) => b.status !== "Archived");

    let healthyCount = 0;
    let watchCount = 0;
    let urgentCount = 0;
    let criticalCount = 0;
    let expiredCount = 0;
    let totalLiabilityLimit = 0;

    allActiveTransportation.forEach((t) => {
      const st = getDeadlineStatus(t.expiryDate);
      if (st === "Healthy") healthyCount++;
      else if (st === "Watch") watchCount++;
      else if (st === "Urgent") urgentCount++;
      else if (st === "Critical") criticalCount++;
      else if (st === "Expired") expiredCount++;

      if (t.insuranceType.toLowerCase().includes("liability") || t.insuranceType.toLowerCase().includes("auto")) {
        totalLiabilityLimit += t.coverageAmount || 0;
      }
    });

    allActiveWorkers.forEach((w) => {
      const st = getDeadlineStatus(w.expiryDate);
      if (st === "Healthy") healthyCount++;
      else if (st === "Watch") watchCount++;
      else if (st === "Urgent") urgentCount++;
      else if (st === "Critical") criticalCount++;
      else if (st === "Expired") expiredCount++;
    });

    allActiveBonds.forEach((b) => {
      if (b.expiryDate) {
        const st = getDeadlineStatus(b.expiryDate);
        if (st === "Healthy") healthyCount++;
        else if (st === "Watch") watchCount++;
        else if (st === "Urgent") urgentCount++;
        else if (st === "Critical") criticalCount++;
        else if (st === "Expired") expiredCount++;
      }
    });

    return {
      activeTotal: allActiveTransportation.length + allActiveWorkers.length + allActiveBonds.length,
      healthyCount,
      watchCount,
      urgentCount,
      criticalCount,
      expiredCount,
      totalLiabilityLimit,
    };

}

export function filterTransportationRecords(records: TransportationInsuranceRecord[], showArchived: boolean, searchQuery: string) {
    return records.filter((t) => {
      if (!showArchived && t.status === "Archived") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.policyNumber.toLowerCase().includes(q) ||
          t.insurerName.toLowerCase().includes(q) ||
          t.insuranceType.toLowerCase().includes(q) ||
          t.broker?.organizationName?.toLowerCase().includes(q) ||
          t.broker?.contactName?.toLowerCase().includes(q)
        );
      }
      return true;
    });

}

export function filterWorkersRecords(records: WorkersInsuranceRecord[], showArchived: boolean, searchQuery: string) {
    return records.filter((w) => {
      if (!showArchived && w.status === "Archived") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          w.accountNumber.toLowerCase().includes(q) ||
          w.providerName.toLowerCase().includes(q) ||
          w.jurisdiction.toLowerCase().includes(q)
        );
      }
      return true;
    });

}

export function filterBondRecords(records: BondRecord[], showArchived: boolean, searchQuery: string) {
    return records.filter((b) => {
      if (!showArchived && b.status === "Archived") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          b.bondNumber.toLowerCase().includes(q) ||
          b.suretyName.toLowerCase().includes(q) ||
          b.bondType.toLowerCase().includes(q) ||
          b.principalName.toLowerCase().includes(q)
        );
      }
      return true;
    });

}
