import React, { useState } from "react";
import {
  Activity,
  ShieldCheck,
  Award,
  AlertTriangle,
  Clock,
  BookOpen,
  Calendar,
  Layers,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Info,
  Scale,
  Sparkles,
  HelpCircle,
  Eye,
  ShieldAlert,
  ArrowUpRight,
  BarChart3,
  Search,
} from "lucide-react";
import {
  DriverPerformanceSnapshot,
  PerformanceCategoryScore,
  FleetRankingResult,
  DriverPerformanceEvent,
} from "@/types/drivers";

export interface DriverIntelligenceViewProps {
  snapshot: DriverPerformanceSnapshot;
  fleetRankings?: {
    rankResult: FleetRankingResult;
    currentDriverRank?: { rank: number; total: number; cohortDescription: string };
  };
  events: DriverPerformanceEvent[];
  onSelectPeriod: (period: "30D" | "90D" | "12M" | "YTD" | "ALL") => void;
  onInspectEvent: (eventId: string) => void;
}

export function DriverIntelligenceView({
  snapshot,
  fleetRankings,
  events,
  onSelectPeriod,
  onInspectEvent,
}: DriverIntelligenceViewProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const selectedCategory = snapshot.categoryScores.find((c) => c.categoryId === selectedCategoryId);

  // Helper for trend badge
  const renderTrendBadge = () => {
    const trend = snapshot.trend;
    if (!trend) return null;

    if (trend.direction === "Improving") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          <TrendingUp className="size-3.5" />
          <span>+{trend.pointDelta} pts ({trend.direction})</span>
        </span>
      );
    }
    if (trend.direction === "Declining") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          <TrendingDown className="size-3.5" />
          <span>{trend.pointDelta} pts ({trend.direction})</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
        <Minus className="size-3.5" />
        <span>Stable (0 pt delta)</span>
      </span>
    );
  };

  // Helper for confidence badge
  const renderConfidenceBadge = () => {
    const tier = snapshot.dataCoverage.confidenceTier;
    if (tier === "High") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          <CheckCircle2 className="size-3.5" />
          <span>{snapshot.dataCoverage.coveragePercentage}% Data Coverage • High Confidence</span>
        </span>
      );
    }
    if (tier === "Moderate") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
          <Info className="size-3.5" />
          <span>{snapshot.dataCoverage.coveragePercentage}% Data Coverage • Moderate Confidence</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
        <AlertTriangle className="size-3.5" />
        <span>{snapshot.dataCoverage.coveragePercentage}% Data Coverage • Limited Data</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. PRODUCT GOVERNANCE DISCLAIMER LAW */}
      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 p-4 text-xs text-blue-950 dark:text-blue-200 shadow-2xs">
        <Scale className="size-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold uppercase tracking-wider text-[10px] text-blue-800 dark:text-blue-300">
              Commercial Fleet Intelligence & Decision Governance Standard
            </span>
            <span className="rounded bg-blue-100 dark:bg-blue-900/60 px-1.5 py-0.2 font-mono text-[9px] font-bold text-blue-700 dark:text-blue-300">
              Model {snapshot.calculationVersion}
            </span>
          </div>
          <p className="font-medium leading-relaxed">
            TES calculates transparent, evidence-backed performance metrics and may identify patterns, comparisons, rankings and correlations. TES does not make employment, disciplinary or operational decisions.
          </p>
        </div>
      </div>

      {/* 2. TOP BANNER: TIME WINDOW & MASTER SCORE */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-foreground">
                Driver Performance Intelligence Snapshot
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                {snapshot.periodStart} to {snapshot.periodEnd}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Calculated deterministically from verified HOS, roadside inspections, collisions, and training records.
            </p>
          </div>

          {/* Time Window Buttons */}
          <div className="flex items-center gap-1 rounded-xl bg-muted/60 p-1 self-start sm:self-auto">
            {(["30D", "90D", "12M", "YTD", "ALL"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onSelectPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  snapshot.periodLabel === p
                    ? "bg-background text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Master KPIs Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Overall Score */}
          <div className="rounded-xl border border-border bg-background/50 p-4 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Overall Performance Index
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold text-foreground">
                {snapshot.overallScore}
              </span>
              <span className="text-xs font-medium text-muted-foreground">/ 100</span>
            </div>
            <div className="pt-1">{renderTrendBadge()}</div>
          </div>

          {/* Data Coverage & Confidence */}
          <div className="rounded-xl border border-border bg-background/50 p-4 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Data Coverage & Confidence
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold text-foreground">
                {snapshot.dataCoverage.coveragePercentage}%
              </span>
            </div>
            <div className="pt-1">{renderConfidenceBadge()}</div>
          </div>

          {/* Fleet Cohort Rank */}
          <div className="rounded-xl border border-border bg-background/50 p-4 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Fleet Cohort Standing
            </span>
            <div className="flex items-baseline gap-2">
              {fleetRankings?.currentDriverRank ? (
                <>
                  <span className="font-mono text-3xl font-extrabold text-primary">
                    #{fleetRankings.currentDriverRank.rank}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">
                    of {fleetRankings.currentDriverRank.total} Active
                  </span>
                </>
              ) : (
                <span className="text-sm font-semibold text-muted-foreground">Active Roster</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground truncate">
              {fleetRankings?.currentDriverRank?.cohortDescription || "Standard Cross-Border Cohort"}
            </p>
          </div>

          {/* Historical Trend Summary */}
          <div className="rounded-xl border border-border bg-background/50 p-4 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Trend vs Prior Period
            </span>
            <p className="text-xs font-semibold text-foreground">
              {snapshot.trend?.direction || "Stable"}
            </p>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {snapshot.trend?.explanation}
            </p>
          </div>
        </div>
      </div>

      {/* 3. 6 CATEGORY SCORE CARDS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-foreground">Component Category Breakdown</h4>
            <p className="text-xs text-muted-foreground">
              Click any category card to inspect underlying source records, formulas, and exclusion reasons.
            </p>
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            Sum of Weights: 100%
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.categoryScores.map((cat) => {
            const isSelected = selectedCategoryId === cat.categoryId;
            const weightPercent = Math.round(cat.weight * 100);

            return (
              <div
                key={cat.categoryId}
                onClick={() => setSelectedCategoryId(isSelected ? null : cat.categoryId)}
                className={`cursor-pointer rounded-2xl border p-5 transition-all space-y-3 ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border bg-card hover:border-border/80 hover:shadow-2xs"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-foreground">{cat.label}</span>
                      <span className="rounded bg-muted px-1.5 py-0.2 font-mono text-[9px] font-bold text-muted-foreground">
                        {weightPercent}% Wt
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-mono text-xl font-extrabold text-foreground block">
                      {cat.score}
                    </span>
                    <span className="text-[10px] text-muted-foreground">/ 100</span>
                  </div>
                </div>

                {/* Key Findings List */}
                <div className="space-y-1 text-xs">
                  {cat.keyFindings.map((kf, i) => (
                    <p key={i} className="text-muted-foreground text-[11px] leading-tight">
                      {kf}
                    </p>
                  ))}
                </div>

                <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] font-semibold text-primary">
                  <span>{isSelected ? "Hide Audit Details" : "Inspect Formula & Exclusions"}</span>
                  <ChevronRight className={`size-3.5 transition-transform ${isSelected ? "rotate-90" : ""}`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. EXPANDED AUDIT DRAWER FOR SELECTED CATEGORY */}
      {selectedCategory && (
        <div className="rounded-2xl border border-primary/30 bg-card p-6 shadow-sm space-y-5 animate-in fade-in duration-150">
          <div className="flex items-start justify-between border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-foreground">
                  Audit Details: {selectedCategory.label}
                </span>
                <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-bold">
                  Score: {selectedCategory.score}/100 (Weight: {Math.round(selectedCategory.weight * 100)}%)
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Full transparency of records included in the scoring model vs. records excluded with verifiable rationale.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSelectedCategoryId(null)}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted text-xs font-semibold"
            >
              Close Details
            </button>
          </div>

          {/* Metric Results */}
          {selectedCategory.metricResults.map((m) => (
            <div key={m.metricId} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 text-xs">
                <div className="rounded-xl bg-muted/40 p-3 space-y-1">
                  <span className="font-bold text-foreground block">Metric Description</span>
                  <p className="text-muted-foreground">{m.label}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">Raw: {m.rawValue}</p>
                </div>
                <div className="rounded-xl bg-muted/40 p-3 space-y-1">
                  <span className="font-bold text-foreground block">Mathematical Summary</span>
                  <p className="text-muted-foreground">{m.summaryText}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">Version: {m.calculationVersion}</p>
                </div>
              </div>

              {/* Included Records */}
              {m.includedRecordIds.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 block">
                    Records Included in Calculation ({m.includedRecordIds.length})
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {m.includedRecordIds.map((id) => {
                      const evt = events.find((e) => e.id === id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onInspectEvent(id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-900 dark:text-emerald-200 hover:bg-emerald-100 transition-colors"
                        >
                          <span className="font-mono font-bold">{id}</span>
                          {evt && <span className="text-[11px] opacity-80">({evt.eventType})</span>}
                          <Eye className="size-3 ml-1 opacity-70" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Excluded Records with Reasons */}
              {m.exclusionReasons.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 block">
                    Excluded Records & Statutory Justifications ({m.exclusionReasons.length})
                  </span>
                  <div className="space-y-2">
                    {m.exclusionReasons.map((ex, i) => (
                      <div
                        key={i}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-50/30 dark:bg-amber-950/20 p-3 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onInspectEvent(ex.recordId)}
                            className="font-mono font-bold text-amber-900 dark:text-amber-300 hover:underline"
                          >
                            {ex.recordId}
                          </button>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-foreground">{ex.reason}</span>
                        </div>
                        <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[9px] font-bold text-amber-800 dark:text-amber-300 shrink-0">
                          0 pt Penalty Applied
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 5. FACTUAL PERFORMANCE PATTERNS & CORRELATIONS */}
      {snapshot.patterns && snapshot.patterns.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h4 className="text-sm font-bold text-foreground">
              Objective Operational Patterns & Environmental Correlations
            </h4>
          </div>
          <p className="text-xs text-muted-foreground">
            Correlations identified across locations, weather conditions, and inspection histories. Formulated in neutral, factual language without blame.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {snapshot.patterns.map((pat) => (
              <div
                key={pat.id}
                className="rounded-xl border border-border bg-background/60 p-4 text-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground">{pat.title}</span>
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                    {pat.category}
                  </span>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  {pat.factualObservation}
                </p>
                <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground font-mono">
                  <span>
                    Supported by {pat.supportingRecordCount} of {pat.totalRelevantRecordCount} records
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. FLEET COHORT BENCHMARK TABLE */}
      {fleetRankings && fleetRankings.rankResult.entries.length > 0 && (
        <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
          <div className="bg-muted/20 px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Fleet Cohort Comparison ({fleetRankings.rankResult.cohortDescription})
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Anonymous benchmark comparisons for {fleetRankings.rankResult.periodLabel} window
              </p>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">
              {fleetRankings.rankResult.entries.length} Drivers Evaluated
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5">Rank</th>
                  <th className="px-5 py-2.5">Driver / Record</th>
                  <th className="px-5 py-2.5">Region</th>
                  <th className="px-5 py-2.5">Performance Score</th>
                  <th className="px-5 py-2.5">Data Coverage</th>
                  <th className="px-5 py-2.5">Trend</th>
                  <th className="px-5 py-2.5">Clean Inspections</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fleetRankings.rankResult.entries.map((entry, idx) => {
                  const isCurrent = entry.driverMasterId === snapshot.driverMasterId;
                  return (
                    <tr
                      key={entry.driverMasterId}
                      className={isCurrent ? "bg-primary/5 font-bold" : "hover:bg-muted/20"}
                    >
                      <td className="px-5 py-2.5 font-mono">
                        <span className={isCurrent ? "text-primary font-extrabold" : "text-muted-foreground"}>
                          #{idx + 1}
                        </span>
                      </td>
                      <td className="px-5 py-2.5">
                        <span className="text-foreground block">{entry.driverName}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{entry.companyDriverRecordId}</span>
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{entry.operatingRegion}</td>
                      <td className="px-5 py-2.5 font-mono font-bold text-foreground">
                        {entry.overallScore}/100
                      </td>
                      <td className="px-5 py-2.5">
                        <span className="font-mono text-muted-foreground">{entry.coveragePercentage}%</span>
                      </td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`text-[10px] font-bold ${
                            entry.trendDirection === "Improving"
                              ? "text-emerald-600"
                              : entry.trendDirection === "Declining"
                              ? "text-rose-600"
                              : "text-muted-foreground"
                          }`}
                        >
                          {entry.trendDirection}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 font-mono text-emerald-700 dark:text-emerald-300">
                        {entry.cleanInspectionsInWindow} Passed
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
