"use client";

import React, { useMemo } from "react";

export interface WatermarkContextInfo {
  viewerName?: string;
  viewerRole?: string;
  companyName?: string;
  timestamp?: string;
  sessionRef?: string;
  deviceIpRef?: string;
}

export function DocumentWatermark({
  viewerName = "MB (Safety Director)",
  viewerRole = "Compliance Admin",
  companyName = "TES Portal Workspace",
  timestamp,
  sessionRef = "SEC-AUTH-2026",
  deviceIpRef,
}: WatermarkContextInfo) {
  const displayTime = useMemo(() => {
    if (timestamp) return timestamp;
    return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }, [timestamp]);

  const watermarkString = `TES PORTAL • ${companyName} • ${viewerName} (${viewerRole}) • ${displayTime} • ${sessionRef}${
    deviceIpRef ? ` • ${deviceIpRef}` : ""
  }`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 select-none overflow-hidden"
      style={{
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div
        className="absolute -inset-[100%] flex flex-wrap items-center justify-around gap-16 opacity-[0.14] dark:opacity-[0.18]"
        style={{
          transform: "rotate(-28deg)",
          transformOrigin: "center center",
        }}
      >
        {Array.from({ length: 48 }).map((_, idx) => (
          <div
            key={idx}
            className="flex flex-col items-center justify-center font-mono text-[10px] tracking-wider text-foreground whitespace-nowrap"
          >
            <span className="font-bold uppercase tracking-widest text-primary/80">
              CONFIDENTIAL & AUDITED • TES COMPLIANCE
            </span>
            <span className="text-[9px] text-muted-foreground">{watermarkString}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
