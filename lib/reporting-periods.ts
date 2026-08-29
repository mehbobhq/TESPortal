/**
 * Pure Generic Reporting Period Infrastructure for TES Portal.
 * Supports standard Calendar Month, Calendar Quarter, and Calendar Year period calculations.
 * Domain-neutral: Contains ZERO knowledge of IFTA, HUT, or tax-specific due dates.
 */

export type ReportingPeriodCadence = "MONTHLY" | "QUARTERLY" | "ANNUAL";

export interface ReportingPeriod {
  cadence: ReportingPeriodCadence;
  year: number;
  periodIndex: number; // 1-12 for monthly, 1-4 for quarterly, 1 for annual
  label: string; // e.g. "2026-Q1", "2026-03", "2026"
  displayTitle: string; // e.g. "Q1 2026 (Jan - Mar)", "March 2026", "Calendar Year 2026"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

/**
 * Format a Date to YYYY-MM-DD in local context
 */
function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Resolves the reporting period containing a specific calendar date.
 */
export function getReportingPeriodForDate(
  date: Date | string,
  cadence: ReportingPeriodCadence
): ReportingPeriod {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00`) : new Date(date);
  const year = d.getFullYear();
  const monthIndex = d.getMonth(); // 0 to 11

  if (cadence === "MONTHLY") {
    const periodIndex = monthIndex + 1;
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0); // last day of month
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    return {
      cadence,
      year,
      periodIndex,
      label: `${year}-${String(periodIndex).padStart(2, "0")}`,
      displayTitle: `${monthNames[monthIndex]} ${year}`,
      startDate: toISODate(start),
      endDate: toISODate(end),
    };
  }

  if (cadence === "QUARTERLY") {
    const quarter = Math.floor(monthIndex / 3) + 1; // 1, 2, 3, 4
    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0);
    const quarterNames = ["Jan - Mar", "Apr - Jun", "Jul - Sep", "Oct - Dec"];

    return {
      cadence,
      year,
      periodIndex: quarter,
      label: `${year}-Q${quarter}`,
      displayTitle: `Q${quarter} ${year} (${quarterNames[quarter - 1]})`,
      startDate: toISODate(start),
      endDate: toISODate(end),
    };
  }

  // ANNUAL
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  return {
    cadence: "ANNUAL",
    year,
    periodIndex: 1,
    label: `${year}`,
    displayTitle: `Calendar Year ${year}`,
    startDate: toISODate(start),
    endDate: toISODate(end),
  };
}

/**
 * Returns the next reporting period in sequence.
 */
export function getNextReportingPeriod(period: ReportingPeriod): ReportingPeriod {
  const currentEnd = new Date(`${period.endDate}T00:00:00`);
  currentEnd.setDate(currentEnd.getDate() + 1);
  return getReportingPeriodForDate(currentEnd, period.cadence);
}

/**
 * Returns the previous reporting period in sequence.
 */
export function getPreviousReportingPeriod(period: ReportingPeriod): ReportingPeriod {
  const currentStart = new Date(`${period.startDate}T00:00:00`);
  currentStart.setDate(currentStart.getDate() - 1);
  return getReportingPeriodForDate(currentStart, period.cadence);
}
