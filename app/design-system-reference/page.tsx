"use client"

/**
 * TES DESIGN SYSTEM — INTERNAL REFERENCE (Phase A)
 *
 * Development-only visual reference for the shared TES primitives. This
 * page is intentionally NOT linked from any sidebar, nav, or menu — no
 * navigation file references this route. It exists solely so the shared
 * primitives can be inspected together before any product page migrates
 * onto them.
 *
 * All data on this page is static/illustrative. Nothing here reads from
 * or writes to any TES store, and no business/domain logic is exercised.
 */

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState, ErrorAlert } from "@/src/components/shared/StateDisplays"
import { EvidencePanel } from "@/src/components/shared/EvidencePanel"
import type { EvidenceRecord } from "@/types/evidence"

import { TESStatusRing, type TESStatusTone } from "@/src/components/design-system/TESStatusRing"
import { TESChangeIndicator } from "@/src/components/design-system/TESChangeIndicator"
import {
  TESTabs,
  TESTabsList,
  TESTabsTrigger,
  TESTabsContent,
} from "@/src/components/design-system/TESTabs"
import { TESStatusSummaryStrip } from "@/src/components/design-system/TESStatusSummaryStrip"
import { TESStatusSummaryItem } from "@/src/components/design-system/TESStatusSummaryItem"
import { TESEvidenceLayout } from "@/src/components/design-system/TESEvidenceLayout"

const STATUS_TONES: { tone: TESStatusTone; label: string }[] = [
  { tone: "current", label: "Current" },
  { tone: "attention", label: "Attention" },
  { tone: "critical", label: "Critical" },
  { tone: "neutral", label: "Neutral" },
]

const MOCK_EVIDENCE: EvidenceRecord[] = [
  {
    id: "EVD-DEMO-1",
    companyId: "DEMO",
    entityType: "Vehicle",
    entityId: "DEMO-UNIT-101",
    documentType: "Registration Document",
    fileName: "unit-101-registration.pdf",
    mimeType: "application/pdf",
    fileReference: "",
    documentDate: "2026-01-04",
    uploadedAt: "2026-01-04T12:00:00.000Z",
    uploadedBy: "demo",
    source: "upload",
    verificationState: "verified",
  },
  {
    id: "EVD-DEMO-2",
    companyId: "DEMO",
    entityType: "Vehicle",
    entityId: "DEMO-UNIT-101",
    documentType: "Cab Card",
    fileName: "unit-101-cab-card.jpg",
    mimeType: "image/jpeg",
    fileReference: "",
    documentDate: "2026-02-11",
    uploadedAt: "2026-02-11T09:30:00.000Z",
    uploadedBy: "demo",
    source: "camera",
    verificationState: "pending_review",
  },
]

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="rounded-xl border border-border bg-card p-5">{children}</div>
    </section>
  )
}

export default function DesignSystemReferencePage() {
  const [activeTab, setActiveTab] = useState("profile")

  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Internal / not linked from navigation</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">TES Design System — Reference</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Phase A shared primitives, shown with static illustrative data only. No business logic is exercised on this page.
          </p>
        </div>

        <Section title="Typography hierarchy">
          <div className="space-y-2">
            <p className="text-2xl font-semibold tracking-tight text-foreground">Page / record title — 20–24px / 600</p>
            <p className="text-[15px] font-semibold text-foreground">Section heading — 14–16px / 500–600</p>
            <p className="text-[13px] font-normal text-foreground">Body / data — 13px / 400</p>
            <p className="text-[13px] text-muted-foreground">Secondary metadata — 12–13px</p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Micro label — 10–11px</p>
          </div>
        </Section>

        <Section title="Buttons" description="Existing shadcn Button primitive — no new implementation.">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="default">Primary action</Button>
            <Button variant="outline">Secondary action</Button>
            <Button variant="ghost">Tertiary</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
        </Section>

        <Section title="TESStatusRing" description="Empty outlined ring, transparent center, paired with text.">
          <div className="flex flex-wrap gap-6">
            {STATUS_TONES.map(({ tone, label }) => (
              <TESStatusRing key={tone} tone={tone} label={label} />
            ))}
          </div>
        </Section>

        <Section title="TESChangeIndicator" description="Movement over time — distinct from current condition.">
          <div className="flex flex-wrap gap-10">
            <TESChangeIndicator label="Compliance progress" value={12} direction="up" period="this week" />
            <TESChangeIndicator label="Open exceptions" value={7} direction="down" period="this month" />
            <TESChangeIndicator label="Utilization" value={0} direction="neutral" period="vs last week" />
          </div>
          <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
            <TESStatusRing tone="attention" label="Attention" />
            <span className="text-muted-foreground">+</span>
            <TESChangeIndicator value={15} direction="up" period="this month" />
            <span className="text-[12px] text-muted-foreground">— still requires attention, even while improving</span>
          </div>
        </Section>

        <Section title="Underline tabs" description="Built on the existing shadcn/base-ui Tabs primitive.">
          <TESTabs value={activeTab} onValueChange={(value) => setActiveTab(String(value))}>
            <TESTabsList>
              <TESTabsTrigger value="profile">Tax Profile</TESTabsTrigger>
              <TESTabsTrigger value="calendar">Filing Calendar</TESTabsTrigger>
              <TESTabsTrigger value="records">Filing Records</TESTabsTrigger>
            </TESTabsList>
            <TESTabsContent value="profile" className="pt-4 text-[13px] text-muted-foreground">
              Tax Profile tab content.
            </TESTabsContent>
            <TESTabsContent value="calendar" className="pt-4 text-[13px] text-muted-foreground">
              Filing Calendar tab content.
            </TESTabsContent>
            <TESTabsContent value="records" className="pt-4 text-[13px] text-muted-foreground">
              Filing Records tab content.
            </TESTabsContent>
          </TESTabs>
        </Section>

        <Section title="TESStatusSummaryStrip" description="Replaces large colorful KPI card grids.">
          <TESStatusSummaryStrip>
            <TESStatusSummaryItem label="Registration" tone="current" primaryValue="Current" secondaryValue="Expires Dec 31, 2026" />
            <TESStatusSummaryItem label="Permits" tone="attention" primaryValue="4 Active" secondaryValue="1 Expiring Soon" />
            <TESStatusSummaryItem label="Insurance" tone="current" primaryValue="Active" secondaryValue="Mar 15, 2026" />
            <TESStatusSummaryItem label="Maintenance" tone="attention" primaryValue="Due soon" secondaryValue="2 items" />
          </TESStatusSummaryStrip>
        </Section>

        <Section title="Evidence completeness" description="Absolute current completeness — distinct from movement.">
          <div className="max-w-xs space-y-1">
            <p className="text-[12px] font-medium text-muted-foreground">Evidence Complete</p>
            <p className="text-[15px] font-semibold text-foreground">4 / 4</p>
            <p className="text-[12px] text-muted-foreground">All required documents are on record.</p>
          </div>
        </Section>

        <Section title="TESEvidenceLayout" description="Record ~74% / Evidence ~26% on desktop; collapses to a drawer below xl. Reuses the existing EvidencePanel as the evidence content.">
          <TESEvidenceLayout
            evidenceLabel="Evidence"
            record={
              <div className="space-y-3 rounded-xl border border-dashed border-border p-5">
                <p className="text-[13px] font-semibold text-foreground">Record / workspace content</p>
                <p className="text-[13px] text-muted-foreground">
                  Illustrative placeholder — a real page would render its own record content here (fields, forms, history).
                </p>
              </div>
            }
            evidence={
              <EvidencePanel
                evidenceItems={MOCK_EVIDENCE}
                onOpenDocument={() => {}}
                onAddEvidence={() => {}}
              />
            }
          />
        </Section>

        <Section title="Empty / loading / error states" description="Existing shared StateDisplays — reused, not reimplemented.">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Empty</p>
              <EmptyState title="No records" description="Nothing has been added yet." />
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Loading</p>
              <LoadingState message="Loading…" />
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Error</p>
              <ErrorAlert message="Something needs attention." onRetry={() => {}} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
