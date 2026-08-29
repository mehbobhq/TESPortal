/**
 * TES Master Register & Audit Event Logger
 * Defines the immutable append-only event logging interface.
 * Operates on a safe local buffer with clean extension points for the future backend sync service.
 */

export interface ComplianceAuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  role: string;
  companyId: string;
  entityType: "Company" | "Contact" | "Vehicle" | "Driver" | "Authority" | "Insurance" | "TaxFiling" | "Permit" | "Inspection" | "Evidence";
  entityId: string;
  action: "CREATE" | "UPDATE" | "ARCHIVE" | "RESTORE" | "VIEW_DOCUMENT" | "OCR_INGEST" | "QUICK_LOG";
  details: string;
  oldValue?: string;
  newValue?: string;
  evidenceId?: string;
  sessionRef?: string;
}

const AUDIT_STORAGE_KEY = "tes_audit_events";

export function recordAuditEvent(
  event: Omit<ComplianceAuditEvent, "id" | "timestamp">
): ComplianceAuditEvent {
  const fullEvent: ComplianceAuditEvent = {
    id: `AUD-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp: new Date().toISOString(),
    ...event,
  };

  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    const list: ComplianceAuditEvent[] = raw ? JSON.parse(raw) : [];
    list.unshift(fullEvent);
    // Keep last 500 audit events in local cache
    if (list.length > 500) {
      list.length = 500;
    }
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("Could not persist audit event to localStorage:", err);
  }

  return fullEvent;
}

export function loadAuditEvents(companyId?: string, entityId?: string): ComplianceAuditEvent[] {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return [];
    const list: ComplianceAuditEvent[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    return list.filter((item) => {
      if (companyId && item.companyId !== companyId) return false;
      if (entityId && item.entityId !== entityId) return false;
      return true;
    });
  } catch {
    return [];
  }
}
