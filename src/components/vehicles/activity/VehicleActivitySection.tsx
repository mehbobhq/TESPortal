"use client"

import { useEffect, useState } from "react"

export interface VehicleActivityEntry {
  id: string
  t: string
  event: string
  detail: string
  section: string
}

export interface VehicleActivitySectionProps {
  companyId: string
  vehicleId: string
  refreshKey?: number
  showAll?: boolean
  loadVehicleActivity: (
    companyId: string,
    vehicleId: string
  ) => VehicleActivityEntry[]
}

export function VehicleActivitySection({
  companyId,
  vehicleId,
  refreshKey,
  showAll = false,
  loadVehicleActivity,
}: VehicleActivitySectionProps) {
  const [entries, setEntries] = useState<VehicleActivityEntry[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setEntries(loadVehicleActivity(companyId, vehicleId))
  }, [companyId, vehicleId, refreshKey])

  const visible = showAll || expanded ? entries : entries.slice(0, 5)

  const dotColor = (event: string) => {
    if (event.includes("CREATED")) return "bg-muted-foreground"
    if (event.includes("ARCHIVED")) return "bg-destructive"
    if (event.includes("INGESTED")) return "bg-primary"
    if (event.includes("ADDED") || event.includes("RENEWED"))
      return "bg-green-500"
    if (event.includes("UPDATED")) return "bg-amber-500"
    return "bg-muted-foreground"
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vehicle Activity</p>
        <span className="text-[10px] text-muted-foreground">
          Append-only compliance trail
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-4 text-center">
          No activity recorded yet.
        </p>
      ) : (
        <div className="space-y-0">
          {visible.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 py-2.5 border-b border-border last:border-0"
            >
              <div className={`mt-1.5 size-2 rounded-full shrink-0 ${dotColor(entry.event)}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-foreground tracking-wide">
                    {entry.event}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {entry.t.split("T")[0]}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  {entry.detail}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                {new Date(entry.t).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      {!showAll && entries.length > 5 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-primary hover:underline"
        >
          {expanded
            ? "Show less"
            : `View all ${entries.length} activity entries`}
        </button>
      ) : null}
    </div>
  )
}
