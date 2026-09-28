import React from "react"
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, XCircle } from "lucide-react"
import { getDeadlineClasses } from "@/lib/deadline-engine"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import type { DeadlineStatus } from "@/lib/authorities/types"

export function DeadlineBadge({ status }: { status: DeadlineStatus }) {
  const style = getDeadlineClasses(status)

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${style.badge}`}
    >
      {status === "Healthy" && <CheckCircle2 className="size-3" />}
      {status === "Watch" && <CalendarClock className="size-3" />}
      {(status === "Urgent" || status === "Critical") && (
        <AlertTriangle className="size-3" />
      )}
      {status === "Expired" && <XCircle className="size-3" />}
      {status}
    </span>
  )
}

export function ScanDocumentIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0">
        <span className="absolute left-0 top-0 h-[35%] w-[35%] rounded-tl-[2px] border-l-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute right-0 top-0 h-[35%] w-[35%] rounded-tr-[2px] border-r-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute bottom-0 left-0 h-[35%] w-[35%] rounded-bl-[2px] border-b-[1.5px] border-l-[1.5px] border-current" />
        <span className="absolute bottom-0 right-0 h-[35%] w-[35%] rounded-br-[2px] border-b-[1.5px] border-r-[1.5px] border-current" />
      </span>
      <FileText
        style={{
          width: size * 0.58,
          height: size * 0.58,
          strokeWidth: 1.8,
        }}
      />
    </span>
  )
}

/* =========================================================
   JURISDICTION / COUNTRY FORM FIELD
========================================================= */

export function JurisdictionCountryFields({
  jurisdictionCode,
  country,
  allowedCountries,
  onChange,
}: {
  jurisdictionCode: string
  country: string
  allowedCountries?: ("Canada" | "United States")[]
  onChange: (value: {
    jurisdictionCode: string
    jurisdictionLabel: string
    country: string
  }) => void
}) {
  const options = allowedCountries?.length
    ? JURISDICTIONS.filter((item) => allowedCountries.includes(item.country))
    : JURISDICTIONS

  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Jurisdiction *</label>
        <select
          value={jurisdictionCode || ""}
          onChange={(e) => {
            const code = e.target.value
            const selected = JURISDICTIONS.find((item) => item.code === code)
            if (!selected) return

            onChange({
              jurisdictionCode: selected.code,
              jurisdictionLabel: selected.label,
              country: selected.country,
            })
          }}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="" disabled>Select jurisdiction</option>
          {options.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label} ({item.code})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Country</label>
        <input
          type="text"
          value={country}
          readOnly
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-muted/40 text-muted-foreground focus:outline-none"
        />
      </div>
    </>
  )
}

