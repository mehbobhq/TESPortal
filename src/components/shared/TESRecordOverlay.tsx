"use client"

import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TESRecordOverlayProps {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  context?: ReactNode
  actions?: ReactNode
  onClose: () => void
  children: ReactNode
  closeOnBackdrop?: boolean
  ariaLabel?: string
  /**
   * "fixed" (default) preserves the original viewport-percentage height
   * regardless of content length. "natural" caps height at the same
   * viewport maximums but lets the overlay shrink to fit shorter content,
   * with the existing scrollable body handling anything that exceeds the cap.
   */
  contentHeight?: "fixed" | "natural"
}

export function TESRecordOverlay({
  open,
  title,
  subtitle,
  context,
  actions,
  onClose,
  children,
  closeOnBackdrop = true,
  ariaLabel = "Opened record",
  contentHeight = "fixed",
}: TESRecordOverlayProps) {
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("keydown", onKeyDown)

    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/55 p-2 sm:p-4 lg:p-6"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          "flex w-[96vw] max-w-[1440px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl sm:w-[92vw] lg:w-[80vw]",
          contentHeight === "natural"
            ? "min-h-[320px] max-h-[94vh] sm:max-h-[90vh] lg:max-h-[80vh]"
            : "h-[94vh] sm:h-[90vh] lg:h-[80vh]"
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex shrink-0 flex-col gap-4 border-b border-primary-foreground/20 bg-primary px-5 py-4 text-primary-foreground sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight sm:text-xl">
              {title}
            </div>

            {subtitle ? (
              <div className="mt-1 text-sm font-medium text-primary-foreground/95">
                {subtitle}
              </div>
            ) : null}

            {context ? (
              <div className="mt-1 text-xs text-primary-foreground/75">
                {context}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}

            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-primary-foreground/55 bg-transparent font-semibold text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              aria-label="Close opened record"
            >
              <X className="mr-1.5 size-4" />
              Close
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background">
          {children}
        </div>
      </section>
    </div>,
    document.body
  )
}