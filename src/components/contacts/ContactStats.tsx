"use client";
import React from "react";
import type { Contact } from "./types";

interface ContactStatsProps {
  contacts: Contact[];
  companyId: string | undefined;
}

export function ContactStats({ contacts, companyId }: ContactStatsProps) {
  return (
    <>
      {/* 1. DIRECTORY STATS BAR */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-muted/40 p-3 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Personnel</p>
            <p className="text-lg font-bold text-foreground mt-0.5">
              {contacts.filter((c) => c.relationships?.some((r) => r.companyId === companyId && r.status === "active") && !c.isArchived).length}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Primary Contact</p>
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-1 truncate">
              {contacts.find((c) => c.relationships?.some((r) => r.companyId === companyId && r.isPrimary))?.firstName || "None Assigned"}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Verified Credentials</p>
            <p className="text-lg font-bold text-primary mt-0.5">
              {contacts.filter((c) => c.relationships?.some((r) => r.companyId === companyId) && c.evidence?.length > 0).length}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Store Schema</p>
            <p className="text-xs font-mono font-medium text-muted-foreground mt-1">tes_contacts_v5 (Locked)</p>
          </div>
        </div>
      </div>
    </>
  );
}
