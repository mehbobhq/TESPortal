"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  Search,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AuditEvent,
  AuditLogEntry,
  exportAuditLog,
  isExportRequired,
  clearExportRequiredFlag,
  readAuditLog,
} from "@/lib/audit-log"
import {
  isLockedOut,
  isPINConfigured,
  isAuditSessionVerified,
  lockoutRemainingMinutes,
  remainingAttempts,
  setAuditSessionVerified,
  setPIN,
  verifyPIN,
} from "@/lib/audit-log-auth"
import type { CurrentUser } from "@/lib/current-user"

const PAGE_SIZE = 100

const WARNING_EVENTS: AuditEvent[] = [
  "ANOMALY_DETECTED",
  "DOWNLOAD_ATTEMPTED",
  "PRINT_ATTEMPTED",
  "ACCESS_DENIED",
  "ADMIN_PIN_LOCKOUT",
]

const ACCENT_EVENTS: AuditEvent[] = ["AUDIT_LOG_ACCESSED", "AUDIT_LOG_EXPORTED"]

const EVENT_LABELS: Record<AuditEvent, string> = {
  LOGIN_SUCCESS: "Login Success",
  LOGIN_FAILED: "Login Failed",
  LOGOUT: "Logout",
  SESSION_EXPIRED: "Session Expired",
  PAGE_VIEW: "Page View",
  TAB_CHANGE: "Tab Change",
  RECORD_VIEWED: "Record Viewed",
  RECORD_CREATED: "Record Created",
  RECORD_UPDATED: "Record Updated",
  RECORD_ARCHIVED: "Record Archived",
  STATUS_CHANGED: "Status Changed",
  SENSITIVE_RECORD_ACCESSED: "Sensitive Record Accessed",
  DOCUMENT_OPENED: "Document Opened",
  DOCUMENT_UPLOADED: "Document Uploaded",
  EVIDENCE_ATTACHED: "Evidence Attached",
  DOWNLOAD_ATTEMPTED: "Download Attempted",
  PRINT_ATTEMPTED: "Print Attempted",
  APPLICATION_SENT: "Application Sent",
  EXPORT_PERFORMED: "Export Performed",
  ACCESS_DENIED: "Access Denied",
  ANOMALY_DETECTED: "Anomaly Detected",
  AUDIT_LOG_ACCESSED: "Audit Log Accessed",
  AUDIT_LOG_EXPORTED: "Audit Log Exported",
  ADMIN_PIN_FAILED: "Admin PIN Failed",
  ADMIN_PIN_LOCKOUT: "Admin PIN Lockout",
  ADMIN_PIN_SET: "Admin PIN Set",
}

const ALL_EVENT_TYPES = Object.keys(EVENT_LABELS) as AuditEvent[]

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })
  } catch {
    return iso
  }
}

function rowClass(event: AuditEvent): string {
  if (WARNING_EVENTS.includes(event)) return "border-l-2 border-l-amber-500 bg-amber-500/5"
  if (ACCENT_EVENTS.includes(event)) return "border-l-2 border-l-primary bg-primary/5"
  return "border-l-2 border-l-transparent"
}

type GateState = "locked_out" | "needs_pin_setup" | "needs_pin" | "verified"

export interface AuditLogSectionProps {
  currentUser: CurrentUser
}

export function AuditLogSection({ currentUser }: AuditLogSectionProps) {
  const [gateState, setGateState] = useState<GateState>("needs_pin")
  const [lockoutMinutes, setLockoutMinutes] = useState(0)

  const [pinDraft, setPinDraft] = useState("")
  const [pinConfirmDraft, setPinConfirmDraft] = useState("")
  const [setupError, setSetupError] = useState<string | null>(null)

  const [pinEntry, setPinEntry] = useState("")
  const [entryError, setEntryError] = useState<string | null>(null)
  const [attemptsLeft, setAttemptsLeft] = useState(3)

  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [page, setPage] = useState(1)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [eventFilter, setEventFilter] = useState<string>("ALL")
  const [search, setSearch] = useState("")
  const [showExportConfirm, setShowExportConfirm] = useState(false)
  const [exportRequired, setExportRequired] = useState(false)

  const evaluateGate = () => {
    if (isLockedOut()) {
      setLockoutMinutes(lockoutRemainingMinutes())
      setGateState("locked_out")
    } else if (!isPINConfigured()) {
      setGateState("needs_pin_setup")
    } else if (!isAuditSessionVerified()) {
      setGateState("needs_pin")
    } else {
      setGateState("verified")
    }
  }

  useEffect(() => {
    evaluateGate()
  }, [])

  useEffect(() => {
    if (gateState !== "locked_out") return
    const interval = window.setInterval(() => {
      if (!isLockedOut()) {
        evaluateGate()
      } else {
        setLockoutMinutes(lockoutRemainingMinutes())
      }
    }, 15000)
    return () => window.clearInterval(interval)
  }, [gateState])

  useEffect(() => {
    if (gateState !== "verified") return
    setEntries(readAuditLog(true))
    setExportRequired(isExportRequired())
  }, [gateState])

  const handleSetupPIN = async () => {
    setSetupError(null)
    if (!/^\d+$/.test(pinDraft) || pinDraft.length < 6) {
      setSetupError("PIN must be at least 6 digits, numbers only.")
      return
    }
    if (pinDraft !== pinConfirmDraft) {
      setSetupError("PINs do not match.")
      return
    }
    await setPIN(pinDraft)
    setPinDraft("")
    setPinConfirmDraft("")
    setAuditSessionVerified()
    evaluateGate()
  }

  const handleUnlock = async () => {
    setEntryError(null)
    const ok = await verifyPIN(pinEntry)
    if (ok) {
      setAuditSessionVerified()
      setPinEntry("")
      evaluateGate()
      return
    }
    setPinEntry("")
    const left = remainingAttempts()
    setAttemptsLeft(left)
    if (left <= 0) {
      evaluateGate()
    } else {
      setEntryError("Incorrect PIN.")
    }
  }

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (dateFrom && entry.t < dateFrom) return false
      if (dateTo && entry.t > dateTo + "T23:59:59.999Z") return false
      if (eventFilter !== "ALL" && entry.e !== eventFilter) return false
      if (search.trim()) {
        const term = search.trim().toLowerCase()
        const haystack = [entry.un, entry.cn, entry.el, entry.dn, entry.det]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [entries, dateFrom, dateTo, eventFilter, search])

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE))
  const pageEntries = filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleExport = () => {
    exportAuditLog()
    setShowExportConfirm(false)
    setEntries(readAuditLog())
    setExportRequired(isExportRequired())
  }

  const handleClearExportFlag = () => {
    clearExportRequiredFlag()
    setExportRequired(false)
  }

  if (gateState === "locked_out") {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-xs">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Lock className="size-5" />
        </div>
        <p className="text-sm font-bold text-foreground">
          Access locked for {lockoutMinutes} minute{lockoutMinutes === 1 ? "" : "s"}.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Too many incorrect attempts.</p>
      </div>
    )
  }

  if (gateState === "needs_pin_setup") {
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <p className="text-sm font-bold text-foreground">Set your audit log PIN</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This PIN is separate from your account password. Minimum 6 digits.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Input
            type="password"
            inputMode="numeric"
            placeholder="New PIN"
            value={pinDraft}
            onChange={(event) => setPinDraft(event.target.value.replace(/\D/g, ""))}
          />
          <Input
            type="password"
            inputMode="numeric"
            placeholder="Confirm PIN"
            value={pinConfirmDraft}
            onChange={(event) => setPinConfirmDraft(event.target.value.replace(/\D/g, ""))}
          />
          {setupError && <p className="text-xs text-destructive">{setupError}</p>}
          <Button onClick={handleSetupPIN}>Set PIN</Button>
        </div>
      </div>
    )
  }

  if (gateState === "needs_pin") {
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <p className="text-sm font-bold text-foreground">Enter audit log PIN</p>
        </div>
        <div className="flex flex-col gap-3">
          <Input
            type="password"
            inputMode="numeric"
            placeholder="PIN"
            value={pinEntry}
            onChange={(event) => setPinEntry(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => event.key === "Enter" && handleUnlock()}
            autoFocus
          />
          {entryError && <p className="text-xs text-destructive">{entryError}</p>}
          {attemptsLeft < 3 && attemptsLeft > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {attemptsLeft} attempt{attemptsLeft === 1 ? "" : "s"} remaining
            </p>
          )}
          <Button onClick={handleUnlock}>Unlock</Button>
        </div>
      </div>
    )
  }

  // gateState === "verified"
  return (
    <div className="flex flex-col gap-4">
      {exportRequired && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            ⚠ Audit log is approaching storage limit. Export and acknowledge to continue logging.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowExportConfirm(true)}>
              Export now
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClearExportFlag}>
              I have exported — clear flag
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">Audit Log</h2>
          <p className="text-xs text-muted-foreground">{entries.length} total entries</p>
        </div>
        <Button size="sm" onClick={() => setShowExportConfirm(true)}>
          <Download className="mr-1.5 size-3.5" />
          Export .ndjson
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Input
          type="date"
          value={dateFrom}
          onChange={(event) => {
            setDateFrom(event.target.value)
            setPage(1)
          }}
          className="h-9 w-auto text-xs"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(event) => {
            setDateTo(event.target.value)
            setPage(1)
          }}
          className="h-9 w-auto text-xs"
        />
        <select
          value={eventFilter}
          onChange={(event) => {
            setEventFilter(event.target.value)
            setPage(1)
          }}
          className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
        >
          <option value="ALL">All Events</option>
          {ALL_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_LABELS[type]}
            </option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Search user, company, entity, document, detail…"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Timestamp</th>
                <th className="px-4 py-2.5">Event</th>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Company</th>
                <th className="px-4 py-2.5">Entity</th>
                <th className="px-4 py-2.5">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {pageEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No audit entries match the current filters.
                  </td>
                </tr>
              ) : (
                pageEntries.map((entry, index) => (
                  <tr key={`${entry.t}-${index}`} className={rowClass(entry.e)}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px]">{formatTimestamp(entry.t)}</td>
                    <td className="px-4 py-2.5 font-medium">
                      {entry.e in EVENT_LABELS ? EVENT_LABELS[entry.e] : entry.e}
                      {entry.alt && <AlertTriangle className="ml-1.5 inline size-3 text-amber-600" />}
                    </td>
                    <td className="px-4 py-2.5">{entry.un ?? "System"}</td>
                    <td className="px-4 py-2.5">{entry.cn ?? "—"}</td>
                    <td className="px-4 py-2.5">{entry.el ?? entry.dn ?? "—"}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-muted-foreground" title={entry.det}>
                      {entry.det ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Showing {filteredEntries.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
            {Math.min(page * PAGE_SIZE, filteredEntries.length)} of {filteredEntries.length}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {showExportConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl">
            <p className="text-sm font-bold text-foreground">Download full audit log as NDJSON?</p>
            <p className="mt-1 text-xs text-muted-foreground">This action will itself be logged.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowExportConfirm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleExport}>
                Download
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
