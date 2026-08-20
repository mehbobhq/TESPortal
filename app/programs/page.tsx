import { ArrowRight, BadgeCheck, Plus } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

const programs = [
  { name: "FAST", full: "Free and Secure Trade", authority: "CBP / CBSA", members: "38 drivers", renewal: "Feb 2027", status: "Enrolled", tone: "ok" as const, desc: "Expedited clearance for pre-approved, low-risk cross-border shipments." },
  { name: "CTPAT", full: "Customs Trade Partnership Against Terrorism", authority: "US CBP", members: "Company-wide", renewal: "Revalidation due", status: "Action needed", tone: "warn" as const, desc: "Supply chain security program that reduces inspections and wait times." },
  { name: "PIP", full: "Partners in Protection", authority: "CBSA", members: "Company-wide", renewal: "Aug 2026", status: "Enrolled", tone: "ok" as const, desc: "Canadian counterpart to CTPAT for trusted-trader recognition." },
  { name: "PARS/PAPS", full: "Pre-Arrival Review System", authority: "CBSA / CBP", members: "All units", renewal: "Ongoing", status: "Active", tone: "ok" as const, desc: "Pre-arrival release for faster processing at the border." },
  { name: "ACE Portal", full: "Automated Commercial Environment", authority: "US CBP", members: "Company account", renewal: "Ongoing", status: "Active", tone: "ok" as const, desc: "Primary system for US e-manifest submission and reporting." },
  { name: "CSA", full: "Customs Self-Assessment", authority: "CBSA", members: "Not enrolled", renewal: "—", status: "Eligible", tone: "info" as const, desc: "Streamlined accounting and payment for approved importers/carriers." },
]

export default function ProgramsPage() {
  return (
    <>
      <PageHeader
        title="Programs"
        description="Trusted-trader and safety programs — FAST, CTPAT, PIP, and more."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Enroll in program
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {programs.map((p) => (
          <Card key={p.name} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
                  <BadgeCheck className="size-5" />
                </span>
                <StatusBadge tone={p.tone}>{p.status}</StatusBadge>
              </div>
              <CardTitle className="mt-2 flex items-baseline gap-2">
                {p.name}
                <span className="text-muted-foreground text-xs font-normal">{p.full}</span>
              </CardTitle>
              <CardDescription className="leading-relaxed">{p.desc}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto grid grid-cols-3 gap-2 text-sm">
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs">Authority</span>
                <span className="font-medium">{p.authority}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs">Scope</span>
                <span className="font-medium">{p.members}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs">Renewal</span>
                <span className="font-medium">{p.renewal}</span>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="ghost" size="sm" className="w-full">
                {p.status === "Eligible" ? "Learn more" : "Manage"}
                <ArrowRight data-icon="inline-end" />
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  )
}
