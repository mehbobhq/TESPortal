/**
 * TES Master Register & Audit Event Logger (Layer-1 Local Buffer)
 * 
 * Note on Persistence & Retention:
 * - This module manages the Layer-1 client-side local audit buffer (`tes_audit_events` in localStorage),
 *   retaining the latest 500 events for active session review, forensic verification, and fast client querying.
 * - Permanent, immutable append-only retention across all historical records is the responsibility of the
 *   future backend Master Register sync service.
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
  viewRef?: string;
}

const AUDIT_STORAGE_KEY = "tes_audit_events";

/**
 * Generate a short, human-readable forensic View Reference (e.g. VW-8F42C910)
 * Uses cryptographically secure browser-supported randomness (crypto.getRandomValues / crypto.randomUUID).
 */
export function generateViewRef(): string {
  try {
    if (typeof globalThis !== "undefined" && globalThis.crypto) {
      if (typeof globalThis.crypto.getRandomValues === "function") {
        const buffer = new Uint8Array(4); // 4 bytes = 8 hex characters
        globalThis.crypto.getRandomValues(buffer);
        const hex = Array.from(buffer)
          .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
          .join("");
        return `VW-${hex}`;
      }
      if (typeof globalThis.crypto.randomUUID === "function") {
        const uuid = globalThis.crypto.randomUUID().replace(/-/g, "").toUpperCase();
        return `VW-${uuid.slice(0, 8)}`;
      }
    }
  } catch {
    // Fallback if crypto access fails
  }

  // Graceful fallback for non-crypto runtime environments
  const timestampHex = Date.now().toString(16).slice(-4).toUpperCase();
  const hexPart = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0").toUpperCase();
  return `VW-${timestampHex}${hexPart}`;
}

/**
 * Generate a unique Audit Event ID using cryptographic randomness when available.
 */
function generateAuditId(): string {
  try {
    if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
      const buffer = new Uint8Array(2);
      globalThis.crypto.getRandomValues(buffer);
      const num = (buffer[0] << 8) | buffer[1];
      return `AUD-${Date.now().toString().slice(-6)}-${String(1000 + (num % 9000))}`;
    }
  } catch {}
  return `AUD-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Format timestamp in America/New_York (Eastern Time).
 * Dynamically resolves "EST" (Eastern Standard Time, UTC-5) or "EDT" (Eastern Daylight Time, UTC-4)
 * based on daylight saving rules.
 * If abbreviation resolution unexpectedly fails, uses the truthful neutral fallback "ET" (never guesses).
 * Output format: YYYY-MM-DD HH:MM:SS [EST|EDT|ET]
 */
export function formatEasternTimestamp(dateInput?: Date | string | number): string {
  let date: Date;
  if (!dateInput) {
    date = new Date();
  } else if (typeof dateInput === "string" || typeof dateInput === "number") {
    date = new Date(dateInput);
  } else {
    date = dateInput;
  }

  if (isNaN(date.getTime())) {
    date = new Date();
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  let tz = partMap["timeZoneName"] || "";
  if (tz === "GMT-4" || tz === "EDT" || tz === "Eastern Daylight Time") {
    tz = "EDT";
  } else if (tz === "GMT-5" || tz === "EST" || tz === "Eastern Standard Time") {
    tz = "EST";
  } else {
    // Truthful neutral fallback if timeZoneName is unresolvable
    tz = "ET";
  }

  const year = partMap["year"] || String(date.getFullYear());
  const month = partMap["month"] || String(date.getMonth() + 1).padStart(2, "0");
  const day = partMap["day"] || String(date.getDate()).padStart(2, "0");
  const hour = partMap["hour"] || String(date.getHours()).padStart(2, "0");
  const minute = partMap["minute"] || String(date.getMinutes()).padStart(2, "0");
  const second = partMap["second"] || String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${tz}`;
}

export function recordAuditEvent(
  event: Omit<ComplianceAuditEvent, "id" | "timestamp">
): ComplianceAuditEvent {
  // If this is a VIEW_DOCUMENT action and no viewRef was supplied, generate one to maintain traceability
  const viewRef = event.viewRef || (event.action === "VIEW_DOCUMENT" ? generateViewRef() : undefined);

  const fullEvent: ComplianceAuditEvent = {
    id: generateAuditId(),
    timestamp: new Date().toISOString(),
    ...event,
    actor: event.actor ?? "",
    role: event.role ?? "",
    companyId: event.companyId ?? "",
    ...(viewRef ? { viewRef } : {}),
  };

  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    const list: ComplianceAuditEvent[] = raw ? JSON.parse(raw) : [];
    list.unshift(fullEvent);
    // Retain latest 500 events in the Layer-1 local cache buffer
    if (list.length > 500) {
      list.length = 500;
    }
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("Could not persist audit event to Layer-1 buffer:", err);
  }

  return fullEvent;
}

/**
 * Record a dedicated VIEW_DOCUMENT audit event with an explicitly traceable View Reference.
 * Records only factual identity context supplied by authenticated/session/watermark context.
 * Never invents fabricated actors or roles.
 */
export function recordDocumentViewEvent(params: {
  fileName: string;
  entityId?: string;
  companyId?: string;
  actor?: string;
  role?: string;
  details?: string;
  evidenceId?: string;
  viewRef?: string;
}): { event: ComplianceAuditEvent; viewRef: string } {
  const finalViewRef = params.viewRef || generateViewRef();
  const event = recordAuditEvent({
    action: "VIEW_DOCUMENT",
    entityType: "Evidence",
    entityId: params.entityId || params.evidenceId || "DOC-VIEW",
    companyId: params.companyId?.trim() || "",
    actor: params.actor?.trim() || "",
    role: params.role?.trim() || "",
    details: params.details || `Forensic document view for ${params.fileName} (Ref: ${finalViewRef})`,
    evidenceId: params.evidenceId,
    viewRef: finalViewRef,
    sessionRef: finalViewRef,
  });

  return { event, viewRef: finalViewRef };
}

/**
 * Locate a VIEW_DOCUMENT audit event from a captured watermark View Reference.
 */
export function findAuditEventByViewRef(viewRef: string): ComplianceAuditEvent | undefined {
  if (!viewRef) return undefined;
  const list = loadAuditEvents();
  return list.find((e) => e.viewRef === viewRef || e.sessionRef === viewRef);
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
