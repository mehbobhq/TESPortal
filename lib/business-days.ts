/**
 * Generic Business-Day Calculation Infrastructure for TES Portal.
 * Pure Layer-1 utilities for standard business-day adjustment.
 * Designed with an optional holiday-provider interface for future jurisdiction-specific holiday calendar extension.
 */

export interface HolidayCalendarProvider {
  isHoliday: (date: Date, jurisdiction?: string) => boolean;
  getHolidayName?: (date: Date, jurisdiction?: string) => string | null;
}

/**
 * Checks if a given date falls on a weekend (Saturday or Sunday).
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Checks if a given date is a valid business day (not a weekend and not a registered holiday).
 */
export function isBusinessDay(
  date: Date,
  holidayProvider?: HolidayCalendarProvider,
  jurisdiction?: string
): boolean {
  if (isWeekend(date)) return false;
  if (holidayProvider && holidayProvider.isHoliday(date, jurisdiction)) return false;
  return true;
}

/**
 * Adjusts a target date to the next valid business day if it falls on a weekend or holiday.
 * If the date is already a business day, it is returned unchanged.
 */
export function adjustForwardToBusinessDay(
  date: Date | string,
  holidayProvider?: HolidayCalendarProvider,
  jurisdiction?: string
): Date {
  const current = typeof date === "string" ? new Date(`${date}T00:00:00`) : new Date(date);
  while (!isBusinessDay(current, holidayProvider, jurisdiction)) {
    current.setDate(current.getDate() + 1);
  }
  return current;
}

/**
 * Adjusts a target date to the previous valid business day if it falls on a weekend or holiday.
 * If the date is already a business day, it is returned unchanged.
 */
export function adjustBackwardToBusinessDay(
  date: Date | string,
  holidayProvider?: HolidayCalendarProvider,
  jurisdiction?: string
): Date {
  const current = typeof date === "string" ? new Date(`${date}T00:00:00`) : new Date(date);
  while (!isBusinessDay(current, holidayProvider, jurisdiction)) {
    current.setDate(current.getDate() - 1);
  }
  return current;
}

/**
 * Calculates a future or past date by adding/subtracting N business days.
 */
export function addBusinessDays(
  startDate: Date | string,
  daysCount: number,
  holidayProvider?: HolidayCalendarProvider,
  jurisdiction?: string
): Date {
  const current = typeof startDate === "string" ? new Date(`${startDate}T00:00:00`) : new Date(startDate);
  const direction = daysCount >= 0 ? 1 : -1;
  let remaining = Math.abs(daysCount);

  while (remaining > 0) {
    current.setDate(current.getDate() + direction);
    if (isBusinessDay(current, holidayProvider, jurisdiction)) {
      remaining--;
    }
  }

  return current;
}

/**
 * Counts the number of working business days between two dates (inclusive of start, exclusive of end).
 */
export function countBusinessDaysBetween(
  startDate: Date | string,
  endDate: Date | string,
  holidayProvider?: HolidayCalendarProvider,
  jurisdiction?: string
): number {
  const start = typeof startDate === "string" ? new Date(`${startDate}T00:00:00`) : new Date(startDate);
  const end = typeof endDate === "string" ? new Date(`${endDate}T00:00:00`) : new Date(endDate);

  if (start > end) return 0;

  let count = 0;
  const current = new Date(start);

  while (current < end) {
    if (isBusinessDay(current, holidayProvider, jurisdiction)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}
