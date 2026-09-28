"use client";

import { History } from "lucide-react";
import { CompanyBusinessStore } from "@/src/types/business";

type Props = {
  businessStore: CompanyBusinessStore;
};

export function BusinessHistory({ businessStore }: Props) {
  return (
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="size-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Business Audit & Change Ledger</h3>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            {businessStore.eventHistory?.length || 0} events recorded
          </span>
        </div>
        <div className="p-4 max-h-60 overflow-y-auto divide-y divide-border/60 text-xs">
          {(businessStore.eventHistory || []).length === 0 ? (
            <p className="p-4 text-center text-muted-foreground">No events recorded yet.</p>
          ) : (
            businessStore.eventHistory.map((evt) => (
              <div key={evt.id} className="py-2.5 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{evt.action}</span>
                    <span className="text-[10px] text-muted-foreground">• {evt.actor}</span>
                  </div>
                  <p className="text-muted-foreground text-[11px] mt-0.5">{evt.description}</p>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {new Date(evt.timestamp).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

  );
}
