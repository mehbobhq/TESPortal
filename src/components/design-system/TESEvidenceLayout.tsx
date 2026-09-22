"use client"

import { useState, type ReactNode } from "react"
import { FileStack } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export interface TESEvidenceLayoutProps {
  /** The thing being examined — the record/workspace content. */
  record: ReactNode
  /** The proof supporting it — typically an <EvidencePanel /> or equivalent. */
  evidence: ReactNode
  /** Label used on the mobile/tablet "view evidence" trigger and the drawer title. */
  evidenceLabel?: string
  className?: string
}

/**
 * TESEvidenceLayout — layout only.
 *
 * It does not load, calculate, or alter evidence. It renders whatever
 * `record` and `evidence` content it is given, in the locked TES spatial
 * relationship: record on the left (~74%), evidence permanently addressed
 * on the right (~26%) on desktop. The evidence rail carries its own
 * restrained neutral surface, a hairline left boundary, and a header area
 * so it reads as a permanent secondary workspace rather than a continuation
 * of the record's own surface — never a colorful banner or a floating card.
 * Below the `xl` breakpoint, evidence collapses into a Sheet (drawer)
 * reached via a trigger button, reusing the existing shared Sheet primitive
 * rather than a bespoke overlay.
 */
export function TESEvidenceLayout({
  record,
  evidence,
  evidenceLabel = "Evidence",
  className,
}: TESEvidenceLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className={cn("grid grid-cols-1 xl:grid-cols-[3fr_1fr]", className)}>
      <div className="min-w-0 xl:pr-6">{record}</div>

      {/* Desktop: evidence has a permanent, visually distinct spatial address on the right. */}
      <div className="hidden min-w-0 flex-col border-l border-border bg-muted/25 xl:flex">
        <div className="shrink-0 border-b border-border/60 px-5 py-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {evidenceLabel}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{evidence}</div>
      </div>

      {/* Below xl: evidence collapses into a drawer rather than disappearing. */}
      <div className="mt-6 xl:mt-0 xl:hidden">
        <Button type="button" variant="outline" onClick={() => setDrawerOpen(true)} className="w-full sm:w-auto">
          <FileStack className="size-4" />
          View {evidenceLabel}
        </Button>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
            <SheetHeader className="border-b border-border">
              <SheetTitle>{evidenceLabel}</SheetTitle>
            </SheetHeader>
            <div className="min-w-0 flex-1 overflow-y-auto p-4">{evidence}</div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
