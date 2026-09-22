import type { ComponentProps } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * TES underline tab presentation, built entirely on the existing shadcn/
 * base-ui Tabs primitives (components/ui/tabs.tsx) — no accessibility or
 * state logic is reimplemented here, only the TES visual language.
 *
 * `TabsList`'s existing `variant="line"` already removes the filled pill
 * background and enables the underline pseudo-element; this wrapper fixes
 * the underline/active-text color to TES primary and tightens spacing to
 * match the locked "~2px underline, blue active text" rule. Controlled
 * `value`/`onValueChange` (or `defaultValue`) behave exactly as the
 * underlying Tabs primitive already defines — nothing about that contract
 * changes here, so existing activeTab/onTabChange-style state wiring will
 * carry over unchanged when a page migrates onto this component.
 */

function TESTabs(props: ComponentProps<typeof Tabs>) {
  return <Tabs {...props} />
}

function TESTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      variant="line"
      className={cn("h-auto w-full justify-start gap-5 rounded-none border-b border-border bg-muted/20 p-0 px-4 pt-1", className)}
      {...props}
    />
  )
}

function TESTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "h-auto shrink-0 rounded-none border-0 bg-transparent px-0.5 pb-2.5 text-[13px] font-medium text-muted-foreground shadow-none transition-colors",
        "hover:text-foreground",
        "data-active:bg-transparent data-active:text-primary data-active:font-semibold data-active:shadow-none",
        "after:bg-primary after:h-0.5",
        className
      )}
      {...props}
    />
  )
}

function TESTabsContent(props: ComponentProps<typeof TabsContent>) {
  return <TabsContent {...props} />
}

export { TESTabs, TESTabsList, TESTabsTrigger, TESTabsContent }
