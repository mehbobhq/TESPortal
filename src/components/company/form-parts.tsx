"use client"

import React from "react"
import Link from "next/link"
import { AlertTriangle, Info, Lock } from "lucide-react"

import { Label } from "@/components/ui/label"

/** The Add Company form's field and section chrome, shared with Company Edit so the two read as one interface. */
export function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  locked,
  className = "",
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  /** Only for a genuinely ambiguous field: shown as a tooltip, never as text under the input. */
  hint?: string
  error?: string | null
  /** Why the value cannot be changed by this viewer here (a lock note is shown instead of silently disabling the control). */
  locked?: string | null
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <Label htmlFor={htmlFor} className="gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive" aria-hidden="true">*</span>}
        {hint && (
          <span tabIndex={0} role="img" title={hint} aria-label={hint} className="inline-flex cursor-help text-muted-foreground">
            <Info className="size-3.5" />
          </span>
        )}
      </Label>
      {children}
      {locked && (
        <p className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
          <Lock className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>{locked}</span>
        </p>
      )}
      {error && (
        <p role="alert" id={htmlFor ? `${htmlFor}-error` : undefined} className="flex items-start gap-1 text-xs text-destructive">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

/**
 * A value shown on Company Edit that this form cannot change: derived from another record, managed in another workspace, or fixed once
 * recorded. It always says why, and links to where it is managed when there is such a place.
 */
export function ReadOnlyRow({ label, value, reason, href, linkLabel, className = "" }: { label: string; value: React.ReactNode; reason?: string; href?: string; linkLabel?: string; className?: string }) {
  const empty = value === null || value === undefined || value === ""
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Lock className="size-3 shrink-0" aria-hidden="true" />
        <span>{label}</span>
        <span className="rounded border border-border px-1 text-[9px] font-semibold uppercase tracking-wide">Read-only</span>
      </div>
      <div className={`min-h-9 break-words rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-[13px] ${empty ? "text-muted-foreground" : "font-medium text-foreground"}`}>{empty ? "Not recorded" : value}</div>
      {(reason || href) && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {reason}
          {href ? (
            <>
              {reason ? " " : ""}
              <Link href={href} className="font-semibold text-primary hover:underline">{linkLabel ?? "Open"}</Link>
            </>
          ) : null}
        </p>
      )}
    </div>
  )
}

/** A tab strip whose panels all stay mounted (the form state is controlled), with a per-tab count of unsaved changes and problems. */
export function EditTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; changes: number; errors: number }>
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div role="tablist" aria-label="Company sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 [contain:inline-size]">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            // Arrow keys / Home / End move between tabs (WAI-ARIA tabs pattern).
            const last = tabs.length - 1
            const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1
            if (next < 0) return
            event.preventDefault()
            onChange(tabs[next].id)
            document.getElementById(`tab-${tabs[next].id}`)?.focus()
          }}
          className={`relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${active === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {tab.label}
          {tab.errors > 0 ? (
            <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white" title={`${tab.errors} problem${tab.errors === 1 ? "" : "s"} to fix`}>{tab.errors}</span>
          ) : tab.changes > 0 ? (
            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary" title={`${tab.changes} unsaved change${tab.changes === 1 ? "" : "s"}`}>{tab.changes}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

export function Section({
  title,
  icon: Icon,
  accent = false,
  grid = true,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  accent?: boolean
  grid?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      {accent && <div className="h-0.5 bg-gradient-to-r from-primary via-primary/60 to-transparent" aria-hidden="true" />}
      <header className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
          <Icon className="size-3.5" />
        </span>
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
      </header>
      <div className={grid ? "grid gap-x-4 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4" : "space-y-5 p-4"}>{children}</div>
    </section>
  )
}
