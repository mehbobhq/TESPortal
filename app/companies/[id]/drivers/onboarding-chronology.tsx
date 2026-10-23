"use client"

import { Check } from "lucide-react"
import type { OnboardingProgress } from "@/lib/driver-prospects/onboarding-stages"

const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null)

/** Compact vertical hiring chronology. Shown only while the driver is onboarding; every timestamp is a recorded event. */
export function OnboardingChronology({ progress }: { progress: OnboardingProgress }) {
  return (
    <ol aria-label="Hiring chronology" data-testid="onboarding-chronology" className="space-y-0">
      {progress.stages.map((stage, index) => {
        const last = index === progress.stages.length - 1
        const done = stage.state === "DONE"
        const current = stage.state === "CURRENT"
        return (
          <li key={stage.key} data-state={stage.state} className="relative flex gap-3 pb-4 last:pb-0">
            {!last ? <span aria-hidden className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-px ${done ? "bg-emerald-500" : "bg-border"}`} /> : null}
            <span
              aria-hidden
              className={`z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                done ? "border-emerald-600 bg-emerald-600 text-white" : current ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent"
              }`}
            >
              {done ? <Check className="size-3" /> : current ? "●" : "·"}
            </span>
            <div className="min-w-0">
              <p className={`text-sm leading-5 ${current ? "font-semibold" : done ? "font-medium" : "text-muted-foreground"}`}>
                {stage.label}
                <span className="sr-only"> — {done ? "completed" : current ? "current stage" : "pending"}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">{stamp(stage.at) ?? (current || done ? "" : "Pending")}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
