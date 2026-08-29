"use client";

import React from "react";
import { CanonicalEntityReference } from "../../types/entity-references";
import { ExternalLink } from "lucide-react";

export interface EntityLinkProps {
  reference: CanonicalEntityReference;
  displayLabel?: string;
  href?: string;
  onOpen?: (reference: CanonicalEntityReference) => void;
  disabled?: boolean;
  className?: string;
  showIcon?: boolean;
}

/**
 * Domain-neutral EntityLink component.
 * Renders readable record information with subtle, non-disruptive navigation affordance.
 * Does not turn raw identifiers into navigational traps.
 */
export function EntityLink({
  reference,
  displayLabel,
  href,
  onOpen,
  disabled = false,
  className = "",
  showIcon = true,
}: EntityLinkProps) {
  const label = displayLabel || reference.label || reference.id;

  if (disabled || (!href && !onOpen)) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-semibold text-foreground ${className}`}>
        {label}
        {reference.secondaryText && (
          <span className="text-[11px] font-normal text-muted-foreground">({reference.secondaryText})</span>
        )}
      </span>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    if (onOpen) {
      e.preventDefault();
      onOpen(reference);
    }
  };

  return (
    <a
      href={href || "#"}
      onClick={handleClick}
      className={`group inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 hover:underline transition-colors ${className}`}
      title={`Open ${reference.entityType}: ${label}`}
    >
      <span className="truncate">{label}</span>
      {reference.secondaryText && (
        <span className="text-[11px] font-normal text-muted-foreground group-hover:no-underline">
          ({reference.secondaryText})
        </span>
      )}
      {showIcon && <ExternalLink className="size-3 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />}
    </a>
  );
}
