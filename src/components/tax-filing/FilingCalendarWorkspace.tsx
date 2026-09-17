import type { ReactNode } from "react"
import { CalendarDays, ChevronRight, RefreshCcw } from "lucide-react"

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
  onSelectObligation: (obligationId: string) => void
  renderStatus: (status: FilingStatus) => ReactNode
}

function FilingCalendarWorkspace({
  calendarYear,
  items,
  selectedObligationId,
  onCalendarYearChange,
  onGenerateActive,
  onSelectObligation,
  renderStatus,
}: FilingCalendarWorkspaceProps) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="border-b border-border/60 p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-base font-bold text-foreground">Filing Obligations Calendar</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Period obligations with snapshotted filing frequencies and business-day adjusted due dates.
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

            <button
              type="button"
              onClick={onGenerateActive}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCcw className="size-3.5" /> Generate Active
            </button>
          </div>
        </div>
      </div>

      <div>
        {items.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-8 text-muted-foreground/50" />}
            title="No Obligations Generated"
            description="No filing obligations currently exist for this calendar year. Configure tax profiles and generate active periods."
          />
        ) : (
          <div className="divide-y divide-border/60">
            {items.map(({ obligation, definition, status, submissionCount }) => {
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
                  <div className="md:col-span-3 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{definition.shortName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{definition.jurisdiction}</p>
                  </div>

                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Period</p>
                    <p className="mt-0.5 text-xs font-semibold text-foreground">{obligation.reportingPeriodLabel}</p>
                  </div>

                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Frequency</p>
                    <p className="mt-0.5 text-xs text-foreground">{formatFrequency(obligation.frequencySnapshot)}</p>
                  </div>

                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</p>
                    <p className="mt-0.5 text-xs font-semibold text-foreground">{obligation.dueDate}</p>
                  </div>

                  <div className="md:col-span-2">{renderStatus(status)}</div>

                  <div className="flex items-center justify-end gap-2 md:col-span-1">
                    {submissionCount > 0 && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                        {submissionCount}
                      </span>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export { FilingCalendarWorkspace }
export type { FilingCalendarItem, FilingCalendarWorkspaceProps }
