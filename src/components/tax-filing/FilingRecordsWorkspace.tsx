import { useState } from "react"
import { ChevronDown, ChevronRight, Receipt } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/src/components/shared/StateDisplays"
import { TESStatusRing, type TESStatusTone } from "@/src/components/design-system/TESStatusRing"
import type {
  FilingObligation,
  FilingSubmission,
  PaymentStatus,
  TaxDefinition,
} from "@/src/components/tax-filing/types"

type FilingRecordItem = {
  submission: FilingSubmission
  obligation: FilingObligation
  definition: TaxDefinition
}

type FilingRecordsWorkspaceProps = {
  items: FilingRecordItem[]
  onSelectRecord: (obligationId: string) => void
}

/** Presentational mapping of the existing PaymentStatus value to a ring tone. Does not compute status. */
function paymentStatusTone(status: PaymentStatus): TESStatusTone {
  switch (status) {
    case "Paid":
      return "current"
    case "Refund":
      return "neutral"
    case "Unpaid":
      return "critical"
    case "Partially Paid":
    case "Pending":
      return "attention"
    case "Not Applicable":
    default:
      return "neutral"
  }
}

function FilingRecordsWorkspace({ items, onSelectRecord }: FilingRecordsWorkspaceProps) {
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})

  const programOrder = ["ifta", "ny_hut", "nm_wdt", "kyu", "or_wmt", "ct_huf", "form_2290"]

  const groups = Array.from(
    items.reduce((grouped, item) => {
      const key = item.obligation.taxCode
      const existing = grouped.get(key)
      if (existing) existing.items.push(item)
      else grouped.set(key, { definition: item.definition, items: [item] })
      return grouped
    }, new Map<string, { definition: TaxDefinition; items: FilingRecordItem[] }>())
  )
    .map(([, group]) => ({
      ...group,
      items: [...group.items].sort((a, b) =>
        b.obligation.reportingPeriodEnd.localeCompare(a.obligation.reportingPeriodEnd)
      ),
    }))
    .sort((a, b) => {
      const ai = programOrder.indexOf(a.definition.code)
      const bi = programOrder.indexOf(b.definition.code)
      const ar = ai === -1 ? programOrder.length : ai
      const br = bi === -1 ? programOrder.length : bi
      return ar - br || a.definition.shortName.localeCompare(b.definition.shortName)
    })

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <EmptyState
          icon={<Receipt className="size-8 text-muted-foreground/50" />}
          title="No Filing Records"
          description="Completed filing periods will appear here after a filing record is saved with evidence."
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
        <h3 className="text-base font-bold text-foreground">Filing Records</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The latest four filed periods are shown for each tax program. Older history remains available in groups of four.
        </p>
      </div>

      {groups.map(({ definition, items: groupItems }) => {
        const visible = visibleCounts[definition.code] ?? 4
        const shown = groupItems.slice(0, visible)
        const remaining = groupItems.length - shown.length

        return (
          <section key={definition.code} className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/10 px-5 py-4">
              <div>
                <h4 className="text-sm font-bold text-foreground">{definition.shortName}</h4>
                <p className="mt-0.5 text-xs text-muted-foreground">{definition.jurisdiction} · {definition.name}</p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {groupItems.length} {groupItems.length === 1 ? "Record" : "Records"}
              </span>
            </div>

            <div className="divide-y divide-border/60">
              {shown.map(({ submission, obligation }) => (
                <button
                  key={obligation.id}
                  type="button"
                  onClick={() => onSelectRecord(obligation.id)}
                  className="grid w-full gap-4 p-4 text-left transition-colors hover:bg-muted/20 md:grid-cols-12"
                >
                  <div className="md:col-span-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Period</p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">{obligation.reportingPeriodLabel}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Return Type</p>
                    <p className="mt-0.5 text-xs font-medium text-foreground">{submission.returnType}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Filed</p>
                    <p className="mt-0.5 text-xs text-foreground">{submission.filingDate || "—"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount Due</p>
                    <p className="mt-0.5 select-text text-xs font-semibold text-foreground">{submission.amountDue || "—"}</p>
                  </div>
                  <div className="flex items-center md:col-span-2">
                    <TESStatusRing tone={paymentStatusTone(submission.paymentStatus)} label={submission.paymentStatus} />
                  </div>
                  <div className="flex items-center justify-end md:col-span-1">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>

            {remaining > 0 && (
              <div className="border-t border-border/60 p-3 text-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setVisibleCounts((current) => ({
                      ...current,
                      [definition.code]: visible + 4,
                    }))
                  }
                >
                  <ChevronDown className="size-3.5" /> View More
                </Button>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

export { FilingRecordsWorkspace }
export type { FilingRecordItem, FilingRecordsWorkspaceProps }
