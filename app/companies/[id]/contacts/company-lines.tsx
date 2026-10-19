"use client"

import React, { useState } from "react"
import { Mail, Phone, Plus } from "lucide-react"

import type { CanonicalChannel } from "@/src/components/contacts/canonical-adapter"

const USAGES = ["GENERAL", "DISPATCH", "OFFICE", "ACCOUNTING", "SAFETY"] as const

/**
 * The company's OWN phone and email lines (organization channels, each with a usage), from the canonical contacts domain. They belong
 * to the company, not to any person: a company phone is never assigned to a contact, and the billing (ACCOUNTING) line stays a
 * separate billing channel. An ended line stays in history; nothing is deleted.
 */
export function CompanyLines({
  channels,
  busy,
  onAdd,
  onEnd,
}: {
  channels: CanonicalChannel[]
  busy: boolean
  onAdd: (channel: { type: "PHONE" | "EMAIL"; usage: string; value: string }) => void
  onEnd: (channelId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const lines = channels.filter((channel) => channel.channelType !== "WEBSITE")
  return (
    <section className="rounded-xl border border-border bg-card shadow-2xs" aria-label="Company phone and email">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-2.5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Company phone &amp; email</h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
        >
          <Plus className="size-3" /> {open ? "Close" : "Add line"}
        </button>
      </div>
      <div className="divide-y divide-border">
        {lines.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">No company phone or email has been recorded.</p>}
        {lines.map((channel) => (
          <div key={channel.id} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              {channel.channelType === "PHONE" ? <Phone className="size-3.5 shrink-0 text-muted-foreground" /> : <Mail className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className="truncate font-medium">{channel.valueDisplay}</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{channel.usage === "ACCOUNTING" ? "Billing" : channel.usage ?? "General"}</span>
            </span>
            <button type="button" disabled={busy} onClick={() => onEnd(channel.id)} className="text-[11px] font-semibold text-muted-foreground underline hover:text-foreground disabled:opacity-50">
              End
            </button>
          </div>
        ))}
      </div>
      {open && (
        <form
          className="grid gap-2 border-t border-border p-3 sm:grid-cols-[8rem_9rem_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const value = String(form.get("value") ?? "").trim()
            if (!value) return
            onAdd({ type: String(form.get("type")) === "EMAIL" ? "EMAIL" : "PHONE", usage: String(form.get("usage")), value })
            event.currentTarget.reset()
          }}
        >
          <select name="type" aria-label="Line type" className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
            <option value="PHONE">Phone</option>
            <option value="EMAIL">Email</option>
          </select>
          <select name="usage" aria-label="Usage" className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
            {USAGES.map((usage) => (
              <option key={usage} value={usage}>
                {usage === "ACCOUNTING" ? "Billing" : usage.charAt(0) + usage.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <input name="value" required placeholder="Number or address" className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs" />
          <button type="submit" disabled={busy} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Add
          </button>
        </form>
      )}
    </section>
  )
}
