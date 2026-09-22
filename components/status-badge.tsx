import { cn } from "@/lib/utils"

type Tone = "ok" | "warn" | "danger" | "neutral" | "info"

const toneClass: Record<Tone, string> = {
  ok: "bg-emerald-50 text-status-current",
  warn: "bg-amber-50 text-status-attention",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-muted-foreground",
  info: "bg-primary/10 text-primary",
}

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        toneClass[tone],
      )}
    >
      <span aria-hidden="true" className="size-3 shrink-0 rounded-full border-2 border-current bg-transparent" />
      {children}
    </span>
  )
}
