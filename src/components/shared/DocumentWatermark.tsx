"use client";

import React, { useMemo, useId } from "react";
import { formatEasternTimestamp, generateViewRef } from "@/lib/audit-logger";

export interface WatermarkContextInfo {
  viewerName?: string;
  viewerRole?: string;
  designation?: string;
  companyName?: string;
  companyId?: string;
  timestamp?: string | Date | number;
  sessionRef?: string;
  viewRef?: string;
  auditEventId?: string;
  deviceIpRef?: string;
  userEmail?: string;
  variant?: "document" | "canvas";
}

/**
 * Resolve Company Name from context, props, localStorage, or current route.
 * Returns only factual company identity without inventing arbitrary defaults.
 */
function resolveCompanyName(
  explicitCompanyName?: string,
  explicitCompanyId?: string
): string {
  if (explicitCompanyName?.trim()) {
    return explicitCompanyName.trim();
  }

  if (typeof window !== "undefined") {
    try {
      const targetId =
        explicitCompanyId ||
        window.location.pathname.match(/\/companies\/([^/]+)/)?.[1];

      if (targetId) {
        const raw = localStorage.getItem("tes_companies");
        if (raw) {
          const companies = JSON.parse(raw);
          if (Array.isArray(companies)) {
            const found = companies.find((c: any) => c.id === targetId);
            if (found && found.name?.trim()) {
              return found.name.trim();
            }
          }
        }
      }
    } catch {
      // Ignore lookup errors
    }
  }

  return "";
}

/**
 * Resolve Viewer Designation from actual context.
 * If genuinely unavailable, returns "Identity unavailable" for presentation only.
 * Never invents fabricated roles like "Compliance Officer".
 */
function resolveDesignation(
  explicitDesignation?: string,
  explicitRole?: string,
  explicitViewerName?: string
): string {
  if (explicitDesignation?.trim()) return explicitDesignation.trim();
  if (explicitRole?.trim()) return explicitRole.trim();

  if (explicitViewerName?.trim()) {
    const match = explicitViewerName.match(/\(([^)]+)\)/);
    if (match && match[1]?.trim()) return match[1].trim();
    return explicitViewerName.trim();
  }

  return "Identity unavailable";
}

/**
 * DocumentWatermark
 *
 * Forensic watermark overlay engineered for confidential regulatory documents.
 * Renders an uncroppable repeated diagonal matrix containing:
 *   CONFIDENTIAL • TES AUDITED VIEW
 *   {Designation} — {Company Name}
 *   {Eastern Time (EST/EDT/ET)} • VIEW REF: {View Reference}
 */
export function DocumentWatermark({
  viewerName,
  viewerRole,
  designation: propDesignation,
  companyName: propCompanyName,
  companyId,
  timestamp,
  sessionRef,
  viewRef: propViewRef,
  variant = "document",
}: WatermarkContextInfo) {
  const patternId = useId();

  // 1. Resolve Factual Designation and Company Name
  const designation = useMemo(
    () => resolveDesignation(propDesignation, viewerRole, viewerName),
    [propDesignation, viewerRole, viewerName]
  );

  const companyName = useMemo(
    () => resolveCompanyName(propCompanyName, companyId),
    [propCompanyName, companyId]
  );

  const watermarkIdentityString = useMemo(() => {
    const hasDesignation = Boolean(designation && designation !== "Identity unavailable");
    const hasCompany = Boolean(companyName && companyName.trim());

    if (hasDesignation && hasCompany) {
      return `${designation} — ${companyName}`;
    }
    if (!hasDesignation && hasCompany) {
      return `Identity unavailable — ${companyName}`;
    }
    if (hasDesignation && !hasCompany) {
      return designation;
    }
    return "Identity unavailable";
  }, [designation, companyName]);

  // 2. Resolve View Reference (traceable to VIEW_DOCUMENT audit event)
  const viewRef = useMemo(() => {
    if (propViewRef) return propViewRef;
    if (sessionRef && sessionRef.startsWith("VW-")) return sessionRef;
    return generateViewRef();
  }, [propViewRef, sessionRef]);

  // 3. Format Eastern Time (America/New_York) with automatic EST/EDT daylight saving indicator
  const easternTimestamp = useMemo(() => {
    return formatEasternTimestamp(timestamp);
  }, [timestamp]);

  const isDocumentVariant = variant === "document";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 select-none overflow-hidden"
      style={{
        zIndex: isDocumentVariant ? 25 : 10,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* High-Resolution Vector Repeating Pattern (Survives partial crops, photos & resizing) */}
      <svg
        className={`h-full w-full ${
          isDocumentVariant
            ? "opacity-45 dark:opacity-50"
            : "opacity-15 dark:opacity-20"
        }`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id={`forensic-wm-${patternId}`}
            width="380"
            height="180"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-26)"
          >
            {/* Cell 1: Top-Left */}
            <g transform="translate(190, 45)">
              <text
                x="0"
                y="0"
                textAnchor="middle"
                className="fill-slate-900 font-mono text-[11px] font-bold tracking-widest uppercase dark:fill-slate-100"
                style={{
                  filter: isDocumentVariant
                    ? "drop-shadow(0px 1px 1px rgba(255,255,255,0.75)) dark:drop-shadow(0px 1px 1px rgba(0,0,0,0.85))"
                    : "none",
                }}
              >
                CONFIDENTIAL • TES AUDITED VIEW
              </text>
              <text
                x="0"
                y="18"
                textAnchor="middle"
                className="fill-slate-950 font-mono text-[10.5px] font-bold tracking-wide dark:fill-slate-50"
                style={{
                  filter: isDocumentVariant
                    ? "drop-shadow(0px 1px 1px rgba(255,255,255,0.75)) dark:drop-shadow(0px 1px 1px rgba(0,0,0,0.85))"
                    : "none",
                }}
              >
                {watermarkIdentityString}
              </text>
              <text
                x="0"
                y="35"
                textAnchor="middle"
                className="fill-slate-900 font-mono text-[9.5px] font-semibold tracking-normal dark:fill-slate-200"
                style={{
                  filter: isDocumentVariant
                    ? "drop-shadow(0px 1px 1px rgba(255,255,255,0.75)) dark:drop-shadow(0px 1px 1px rgba(0,0,0,0.85))"
                    : "none",
                }}
              >
                {easternTimestamp} • VIEW REF: {viewRef}
              </text>
            </g>
          </pattern>
        </defs>

        <rect
          width="100%"
          height="100%"
          fill={`url(#forensic-wm-${patternId})`}
        />
      </svg>
    </div>
  );
}
