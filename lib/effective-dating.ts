/**
 * Pure Generic Effective-Dated Value & Assignment Infrastructure for TES Portal.
 * Supports temporal interval records (effectiveFrom -> effectiveTo).
 * Open-ended assignments have effectiveTo = null / undefined.
 */

export interface EffectiveDatedRecord<T> {
  id: string;
  value: T;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string | null; // YYYY-MM-DD or null if currently active
  source?: string;
  reference?: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Finds the value that was actively effective on a target calendar date.
 */
export function getEffectiveValueOnDate<T>(
  records: Array<EffectiveDatedRecord<T>>,
  targetDate: string
): EffectiveDatedRecord<T> | null {
  const matching = records.filter((r) => {
    if (r.effectiveFrom > targetDate) return false;
    if (r.effectiveTo && r.effectiveTo < targetDate) return false;
    return true;
  });

  if (matching.length === 0) return null;

  // Return the record with the most recent effectiveFrom start date
  return matching.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

/**
 * Gets the current actively effective record (where effectiveFrom <= today and (effectiveTo is null or >= today)).
 */
export function getCurrentEffectiveRecord<T>(
  records: Array<EffectiveDatedRecord<T>>,
  todayISOString: string
): EffectiveDatedRecord<T> | null {
  return getEffectiveValueOnDate(records, todayISOString);
}

/**
 * Returns chronological history ordered from newest to oldest effective date.
 */
export function getChronologicalHistory<T>(
  records: Array<EffectiveDatedRecord<T>>
): Array<EffectiveDatedRecord<T>> {
  return [...records].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

/**
 * Checks if a proposed effective date range overlaps with any existing record in the collection.
 */
export function detectDateRangeOverlap<T>(
  existingRecords: Array<EffectiveDatedRecord<T>>,
  proposedFrom: string,
  proposedTo?: string | null,
  excludeRecordId?: string
): { hasOverlap: boolean; overlappingRecords: Array<EffectiveDatedRecord<T>> } {
  const filtered = excludeRecordId ? existingRecords.filter((r) => r.id !== excludeRecordId) : existingRecords;

  const overlaps = filtered.filter((r) => {
    const rFrom = r.effectiveFrom;
    const rTo = r.effectiveTo || "9999-12-31";
    const pFrom = proposedFrom;
    const pTo = proposedTo || "9999-12-31";

    // Standard interval overlap condition: (StartA <= EndB) and (EndA >= StartB)
    return pFrom <= rTo && pTo >= rFrom;
  });

  return {
    hasOverlap: overlaps.length > 0,
    overlappingRecords: overlaps,
  };
}

/**
 * Closes an existing open-ended assignment by setting its effectiveTo to (newAssignmentEffectiveFrom - 1 day).
 */
export function closePreviousOpenEndedAssignment<T>(
  records: Array<EffectiveDatedRecord<T>>,
  newEffectiveFrom: string
): Array<EffectiveDatedRecord<T>> {
  const prevDate = new Date(`${newEffectiveFrom}T00:00:00`);
  prevDate.setDate(prevDate.getDate() - 1);
  const closedToDate = prevDate.toISOString().slice(0, 10);

  return records.map((r) => {
    if (!r.effectiveTo && r.effectiveFrom < newEffectiveFrom) {
      return {
        ...r,
        effectiveTo: closedToDate,
      };
    }
    return r;
  });
}
