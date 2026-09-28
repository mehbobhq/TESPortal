interface InsuranceSummaryMetrics {
  activeTotal: number;
  healthyCount: number;
  watchCount: number;
  urgentCount: number;
  criticalCount: number;
  expiredCount: number;
  totalLiabilityLimit: number;
}

export function InsuranceSummary({ summaryMetrics }: { summaryMetrics: InsuranceSummaryMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Policies</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">{summaryMetrics.activeTotal}</span>
            <span className="text-[11px] text-muted-foreground font-medium">Monitored</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Healthy (&gt;60d)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {summaryMetrics.healthyCount}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Good Standing</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            Watch (31–60d)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {summaryMetrics.watchCount}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Upcoming</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Urgent (11–30d)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {summaryMetrics.urgentCount}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Action Req.</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-destructive">
            Critical / Expired
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-destructive">
              {summaryMetrics.criticalCount + summaryMetrics.expiredCount}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Breach Risk</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Liability</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-bold tracking-tight text-foreground truncate">
              ${(summaryMetrics.totalLiabilityLimit / 1000000).toFixed(1)}M
            </span>
            <span className="text-[10px] text-muted-foreground uppercase font-bold">CSL</span>
          </div>
        </div>
      </div>
  );
}
