"use client";

import React, { useState } from "react";
import { Copy, Check, ExternalLink, ShieldCheck } from "lucide-react";

export interface ReadOnlyFieldProps {
  label: string;
  value?: string | number | null;
  copyable?: boolean;
  mono?: boolean;
  subtext?: string;
  badge?: React.ReactNode;
}

export function ReadOnlyField({
  label,
  value,
  copyable = false,
  mono = false,
  subtext,
  badge,
}: ReadOnlyFieldProps) {
  const [copied, setCopied] = useState(false);

  const displayVal = value !== undefined && value !== null && String(value).trim() !== "" ? String(value) : "—";

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(String(value));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {badge}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/30 px-3 py-2">
        <span
          className={`text-xs font-semibold text-foreground truncate select-text ${
            mono ? "font-mono tracking-tight" : ""
          }`}
        >
          {displayVal}
        </span>

        {copyable && displayVal !== "—" && (
          <button
            type="button"
            onClick={handleCopy}
            className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </div>

      {subtext && <p className="text-[10px] text-muted-foreground">{subtext}</p>}
    </div>
  );
}

export interface RegulatoryIdentifierFieldProps {
  label: string;
  value: string;
  type?: "VIN" | "USDOT" | "MC" | "Plate" | "IFTA" | "Permit" | "Transponder";
  onViewMaster?: () => void;
  isValid?: boolean;
}

export function RegulatoryIdentifierField({
  label,
  value,
  type,
  onViewMaster,
  isValid = true,
}: RegulatoryIdentifierFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {type && (
          <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[9px] font-bold text-primary">
            {type}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-bold tracking-wider text-foreground uppercase truncate select-text">
            {value || "—"}
          </span>
          {isValid && value && (
            <ShieldCheck className="size-3.5 text-emerald-500 shrink-0" title="Checksum & syntax verified" />
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <button
              type="button"
              onClick={handleCopy}
              className="flex size-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Copy"
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            </button>
          )}

          {onViewMaster && (
            <button
              type="button"
              onClick={onViewMaster}
              className="flex size-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="View in Master Register"
            >
              <ExternalLink className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
