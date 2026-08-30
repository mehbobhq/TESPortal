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
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {badge}
      </div>

      <div className="flex items-center justify-between gap-2 min-h-[1.5rem]">
        <span
          className={`text-sm font-semibold text-foreground break-words select-text ${
            displayVal === "—" ? "text-muted-foreground/70 font-normal" : ""
          } ${mono ? "font-mono tracking-tight" : ""}`}
        >
          {displayVal}
        </span>

        {copyable && displayVal !== "—" && (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Copy to clipboard"
            aria-label={`Copy ${label}`}
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </div>

      {subtext && <p className="text-[10px] text-muted-foreground mt-0.5">{subtext}</p>}
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

  const displayVal = value !== undefined && value !== null && String(value).trim() !== "" ? String(value) : "—";

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {type && (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
            {type}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 min-h-[1.5rem]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`font-mono text-sm font-bold tracking-wider text-foreground uppercase select-text break-words ${
              displayVal === "—" ? "text-muted-foreground/70 font-normal" : ""
            }`}
          >
            {displayVal}
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
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Copy"
              aria-label={`Copy ${label}`}
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            </button>
          )}

          {onViewMaster && (
            <button
              type="button"
              onClick={onViewMaster}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="View in Master Register"
              aria-label={`View ${label} in Master Register`}
            >
              <ExternalLink className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
