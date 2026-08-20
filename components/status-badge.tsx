import { cn } from "@/lib/utils"

type Tone = "ok" | "warn" | "danger" | "neutral" | "info"

const toneClass: Record<Tone, string> = {
  ok: "bg-chart-3/15 text-chart-3",
  warn: "bg-chart-4/20 text-chart-4",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-muted-foreground",
  info: "bg-primary/10 text-primary",
}

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClass[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}
