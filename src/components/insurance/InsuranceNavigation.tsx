import { ShieldCheck, Briefcase, Award, Layers, Search } from "lucide-react";

interface InsuranceNavigationProps {
  activeTab: "transportation" | "workers" | "bonds" | "all";
  transportationCount: number;
  workersCount: number;
  bondCount: number;
  searchQuery: string;
  showArchived: boolean;
  onTabChange: (tab: "transportation" | "workers" | "bonds" | "all") => void;
  onSearchChange: (value: string) => void;
  onShowArchivedChange: (value: boolean) => void;
}

export function InsuranceNavigation({
  activeTab,
  transportationCount,
  workersCount,
  bondCount,
  searchQuery,
  showArchived,
  onTabChange,
  onSearchChange,
  onShowArchivedChange,
}: InsuranceNavigationProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          <button
            type="button"
            onClick={() => onTabChange("transportation")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              activeTab === "transportation"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <ShieldCheck className="size-3.5" />
            <span>Transportation Policies ({transportationCount})</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("workers")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              activeTab === "workers"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Briefcase className="size-3.5" />
            <span>Workers Comp / WCB ({workersCount})</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("bonds")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              activeTab === "bonds"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Award className="size-3.5" />
            <span>Surety Bonds ({bondCount})</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("all")}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              activeTab === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Layers className="size-3.5" />
            <span>All Records</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search policy #, insurer, broker..."
              className="h-8 w-60 rounded-xl border border-border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => onShowArchivedChange(e.target.checked)}
              className="size-3.5 rounded border-border text-primary focus:ring-primary"
            />
            <span>Show Historical / Archived</span>
          </label>
        </div>
      </div>
  );
}
