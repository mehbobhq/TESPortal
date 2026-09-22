import type { ReactNode } from "react"
import { CalendarDays, ChevronRight, RefreshCcw, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/src/components/shared/StateDisplays"
import { formatFrequency } from "@/src/components/tax-filing/tax-helpers"
import type {
  FilingObligation,
  FilingStatus,
  TaxDefinition,
} from "@/src/components/tax-filing/types"

type FilingCalendarItem = {
  obligation: FilingObligation
  definition: TaxDefinition
  status: FilingStatus
  submissionCount: number
}

type FilingCalendarWorkspaceProps = {
  calendarYear: number
  items: FilingCalendarItem[]
  selectedObligationId: string | null
  onCalendarYearChange: (year: number) => void
  onGenerateActive: () => void
  onUpload: () => void
  onSelectObligation: (obligationId: string) => void
  renderStatus: (status: FilingStatus) => ReactNode
}

function FilingCalendarWorkspace({
  calendarYear,
  items,
  selectedObligationId,
  onCalendarYearChange,
  onGenerateActive,
  onUpload,
  onSelectObligation,
  renderStatus,
}: FilingCalendarWorkspaceProps) {
  const programOrder = [
    "ifta",
    "ny_hut",
    "nm_wdt",
    "kyu",
    "or_wmt",
    "ct_huf",
    "form_2290",
  ]

  const groups = Array.from(
    items.reduce((grouped, item) => {
      const existing = grouped.get(item.obligation.taxCode)
      if (existing) {
        existing.items.push(item)
      } else {
        grouped.set(item.obligation.taxCode, {
          definition: item.definition,
          items: [item],
        })
      }
      return grouped
    }, new Map<string, { definition: TaxDefinition; items: FilingCalendarItem[] }>())
  )
    .map(([, group]) => ({
      ...group,
      items: [...group.items]
        .sort((a, b) =>
          a.obligation.reportingPeriodStart.localeCompare(b.obligation.reportingPeriodStart)
        )
        .slice(0, 4),
    }))
    .sort((a, b) => {
      const aIndex = programOrder.indexOf(a.definition.code)
      const bIndex = programOrder.indexOf(b.definition.code)
      const aRank = aIndex === -1 ? programOrder.length : aIndex
      const bRank = bIndex === -1 ? programOrder.length : bIndex
      return aRank - bRank || a.definition.shortName.localeCompare(b.definition.shortName)
    })

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-base font-bold text-foreground">Filing Obligations Calendar</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                The next four unresolved or upcoming obligations are shown for each tax program.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                className="w-28 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={calendarYear}
                onChange={(event) =>
                  onCalendarYearChange(Number(event.target.value) || new Date().getFullYear())
                }
              />

              <Button type="button" size="sm" onClick={onUpload}>
                <Upload className="size-3.5" /> Upload
              </Button>

              <Button type="button" variant="outline" size="sm" onClick={onGenerateActive}>
                <RefreshCcw className="size-3.5" /> Generate Active
              </Button>
            </div>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
          <EmptyState
            icon={<CalendarDays className="size-8 text-muted-foreground/50" />}
            title="No Obligations Generated"
            description="No filing obligations currently exist for this calendar year. Configure tax profiles and generate active periods."
          />
        </div>
      ) : (
        groups.map(({ definition, items: groupItems }) => (
          <section
            key={definition.code}
            className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden"
          >
            <div className="flex flex-col gap-2 border-b border-border/60 bg-muted/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-bold text-foreground">{definition.shortName}</h4>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {definition.jurisdiction} · {definition.name}
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {groupItems.length} {groupItems.length === 1 ? "Period" : "Periods"}
              </span>
            </div>

            <div className="divide-y divide-border/60">
              {groupItems.map(({ obligation, status, submissionCount }) => {
                const isSelected = selectedObligationId === obligation.id

                return (
                  <button
                    key={obligation.id}
                    type="button"
                    onClick={() => onSelectObligation(obligation.id)}
                    className={`grid w-full gap-4 p-4 text-left transition-colors md:grid-cols-12 ${
                      isSelected ? "bg-primary/[0.04]" : "hover:bg-muted/20"
                    }`}
                  >
                    <div className="md:col-span-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Period</p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground">{obligation.reportingPeriodLabel}</p>
                    </div>

                    <div className="md:col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Frequency</p>
                      <p className="mt-0.5 text-xs text-foreground">{formatFrequency(obligation.frequencySnapshot)}</p>
                    </div>

                    <div className="md:col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</p>
                      <p className="mt-0.5 text-xs font-semibold text-foreground">{obligation.dueDate}</p>
                    </div>

                    <div className="flex items-center md:col-span-3">
                      {renderStatus(status)}
                    </div>

                    <div className="flex items-center justify-end gap-2 md:col-span-2">
                      {submissionCount > 0 && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                          {submissionCount} {submissionCount === 1 ? "submission" : "submissions"}
                        </span>
                      )}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

export { FilingCalendarWorkspace }
export type { FilingCalendarItem, FilingCalendarWorkspaceProps }
