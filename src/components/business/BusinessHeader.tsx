"use client";

import { Building2, CheckCircle2 } from "lucide-react";
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader";

type Props = {
  company: any;
  totalActiveOwnership: number;
};

export function BusinessHeader({ company, totalActiveOwnership }: Props) {
  return (
      <div className="flex flex-col gap-4">
        <CompanyWorkspaceHeader
          company={company}
          section="Business & Corporate Records"
          description="Corporate formation, ownership, and statutory filing records."
        />

        {/* Regulatory Origin & Operating Status Bar */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-0.5">
                Registered Origin
              </span>
              <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                <Building2 className="size-3.5 text-primary shrink-0" />
                {company.regCorpState || "Unknown"}, {company.regCorpCountry || "Unknown"}
              </span>
            </div>
            <div className="h-7 w-px bg-border/60" />
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-0.5">
                Operating Region
              </span>
              <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                {company.region || "Unassigned"}
              </span>
            </div>
            <div className="h-7 w-px bg-border/60" />
            <div>
              <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider block mb-0.5">
                Active Ownership Documented
              </span>
              <span
                className={`font-semibold flex items-center gap-1 text-xs ${
                  totalActiveOwnership > 100
                    ? "text-destructive font-bold"
                    : totalActiveOwnership === 100
                    ? "text-emerald-600 dark:text-emerald-400 font-bold"
                    : "text-foreground"
                }`}
              >
                {totalActiveOwnership.toFixed(1)}% / 100.0%
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Storage: <span className="font-mono text-foreground font-semibold">Layer-1 Synced</span>
            </span>
          </div>
        </div>
      </div>

  );
}
