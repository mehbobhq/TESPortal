/**
 * TES Audit Log — self-contained, append-only NDJSON event log.
 *
 * This module has ZERO imports from TES domain files. It must stay fully
 * portable: nothing here should ever depend on company/driver/vehicle types
 * or any other application module.
 *
 * Storage contract:
 *  - localStorage key "tes_audit_log" holds newline-separated JSON objects
 *    (NDJSON). Entries are appended only — never rewritten or removed.
 */

const STORAGE_KEY = "tes_audit_log"
const EXPORT_REQUIRED_FLAG_KEY = "tes_audit_export_required"
const SESSION_ID_KEY = "tes_sid"
const SIZE_LIMIT_BYTES = 4 * 1024 * 1024

export type AuditEvent =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "SESSION_EXPIRED"
  | "PAGE_VIEW"
  | "TAB_CHANGE"
  | "RECORD_VIEWED"
  | "RECORD_CREATED"
  | "RECORD_UPDATED"
  | "RECORD_ARCHIVED"
  | "STATUS_CHANGED"
  | "SENSITIVE_RECORD_ACCESSED"
  | "DOCUMENT_OPENED"
  | "DOCUMENT_UPLOADED"
  | "EVIDENCE_ATTACHED"
  | "DOWNLOAD_ATTEMPTED"
  | "PRINT_ATTEMPTED"
  | "APPLICATION_SENT"
  | "EXPORT_PERFORMED"
  | "ACCESS_DENIED"
  | "ANOMALY_DETECTED"
  | "AUDIT_LOG_ACCESSED"
  | "AUDIT_LOG_EXPORTED"
  | "ADMIN_PIN_FAILED"
  | "ADMIN_PIN_LOCKOUT"
  | "ADMIN_PIN_SET"

export interface AuditLogEntry {
  t: string // ISO 8601 UTC with milliseconds
  e: AuditEvent // event type
  u?: string // user ID
  un?: string // user name
  r?: string // user role
  co?: string // company ID
  cn?: string // company name
  rt?: string // route/URL at time of event
  tab?: string // active tab if relevant
  sf?: string[] // sensitive fields visible (array of field names)
  dev?: string // browser + OS (from navigator.userAgent, simplified)
  sid?: string // session ID (from sessionStorage, generated once)
  eid?: string // entity ID (vehicle, driver, policy etc.)
  el?: string // entity label ("Unit 496", "John Smith")
  doc?: string // document ID
  dn?: string // document name
  wm?: boolean // watermark was applied
  det?: string // human-readable detail
  blk?: boolean // action was blocked
  alt?: boolean // alert was triggered
}

function parseUserAgent(ua: string): string {
  try {
    let os = "Unknown OS"
    if (/Windows NT 10/.test(ua)) os = "Windows 10/11"
    else if (/Windows/.test(ua)) os = "Windows"
    else if (/Mac OS X/.test(ua)) os = "macOS"
    else if (/Android/.test(ua)) os = "Android"
    else if (/iPhone|iPad|iOS/.test(ua)) os = "iOS"
    else if (/Linux/.test(ua)) os = "Linux"

    let browser = "Unknown Browser"
    const edgeMatch = ua.match(/Edg\/(\d+)/)
    const chromeMatch = ua.match(/Chrome\/(\d+)/)
    const firefoxMatch = ua.match(/Firefox\/(\d+)/)
    const safariMatch = ua.match(/Version\/(\d+).*Safari/)

    if (edgeMatch) browser = `Edge ${edgeMatch[1]}`
    else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`
    else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`
    else if (safariMatch) browser = `Safari ${safariMatch[1]}`

    return `${browser} / ${os}`
  } catch {
    return "Unknown"
  }
}

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY)
    if (existing) return existing
    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `sid-${Date.now()}-${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem(SESSION_ID_KEY, generated)
    return generated
  } catch {
    return "unknown-session"
  }
}

function readRawLog(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || ""
  } catch {
    return ""
  }
}

function parseLines(raw: string): AuditLogEntry[] {
  const entries: AuditLogEntry[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line) as AuditLogEntry)
    } catch {
      // skip malformed lines silently
    }
  }
  return entries
}

function detectAnomaly(entry: AuditLogEntry): boolean {
  try {
    if (entry.e === "DOWNLOAD_ATTEMPTED" || entry.e === "PRINT_ATTEMPTED") return true
    if (entry.e === "ADMIN_PIN_FAILED") return true
    if (entry.e === "ACCESS_DENIED") return true

    if (entry.u) {
      const raw = readRawLog()
      const lines = raw.split("\n").filter(Boolean)
      const last100 = lines.slice(-100)
      const entryTime = new Date(entry.t).getTime()
      let count = 0
      for (const line of last100) {
        try {
          const parsed = JSON.parse(line) as AuditLogEntry
          if (parsed.u !== entry.u) continue
          const parsedTime = new Date(parsed.t).getTime()
          if (Number.isFinite(parsedTime) && entryTime - parsedTime <= 60000) count += 1
        } catch {
          // skip malformed lines silently
        }
      }
      if (count > 30) return true
    }

    return false
  } catch {
    return false
  }
}

function appendLine(line: string): void {
  const existing = readRawLog()
  localStorage.setItem(STORAGE_KEY, existing ? existing + "\n" + line : line)
}

export function logAuditEvent(entry: Omit<AuditLogEntry, "t" | "dev" | "sid">): void {
  try {
    const full: AuditLogEntry = {
      ...entry,
      t: new Date().toISOString(),
      dev: parseUserAgent(navigator.userAgent),
      sid: getOrCreateSessionId(),
    }

    const isAnomaly = detectAnomaly(full)
    if (isAnomaly) full.alt = true

    appendLine(JSON.stringify(full))

    if (isAnomaly) {
      const alert: AuditLogEntry = {
        t: new Date().toISOString(),
        e: "ANOMALY_DETECTED",
        u: entry.u,
        un: entry.un,
        det: `Anomaly detected on event: ${entry.e}`,
        sid: full.sid,
        dev: full.dev,
      }
      appendLine(JSON.stringify(alert))
    }

    const size = new Blob([readRawLog()]).size
    if (size > SIZE_LIMIT_BYTES) {
      localStorage.setItem(EXPORT_REQUIRED_FLAG_KEY, "true")
    }
  } catch {
    // Never throw. Never alert. Silent.
  }
}

export function readAuditLog(fromViewer = false): AuditLogEntry[] {
  const entries = parseLines(readRawLog())
  entries.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime())

  if (fromViewer) {
    logAuditEvent({ e: "AUDIT_LOG_ACCESSED", det: "Audit log viewer opened" })
  }

  return entries
}

export function isExportRequired(): boolean {
  try {
    return localStorage.getItem(EXPORT_REQUIRED_FLAG_KEY) === "true"
  } catch {
    return false
  }
}

export function clearExportRequiredFlag(): void {
  try {
    localStorage.removeItem(EXPORT_REQUIRED_FLAG_KEY)
  } catch {
    // silent
  }
}

export function exportAuditLog(): void {
  try {
    const raw = readRawLog()
    const blob = new Blob([raw], { type: "application/x-ndjson" })
    const url = URL.createObjectURL(blob)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    const filename = `tes-audit-log-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.ndjson`

    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    logAuditEvent({ e: "AUDIT_LOG_EXPORTED", det: `Exported as ${filename}` })
  } catch {
    // Never throw. Silent.
  }
}
