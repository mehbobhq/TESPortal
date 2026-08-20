import { ArrowRight, CheckCircle2, Lightbulb, ShieldAlert, TrendingUp } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

const recommendations = [
  {
    title: "Renew Unit 4471 cab card now",
    impact: "High",
    tone: "danger" as const,
    body: "Expires in 4 days. A lapse blocks cross-border operation and risks a $2,500 penalty. Auto-file via IRP Clearinghouse.",
    cta: "Start renewal",
  },
  {
    title: "Consolidate IFTA fuel receipts",
    impact: "Medium",
    tone: "warn" as const,
    body: "37 receipts are unmatched to trips. Reconciling now improves your Q1 filing accuracy and reduces audit exposure.",
    cta: "Reconcile",
  },
  {
    title: "Reallocate 4 idle tractors to Quebec",
    impact: "Medium",
    tone: "info" as const,
    body: "Quebec demand is up 18% while 4 ON units sit idle >48h. Estimated +$11k monthly revenue.",
    cta: "Model scenario",
  },
]

const scenarios = [
  { name: "Add 5 tractors", capex: "$1.2M", payback: "26 mo", margin: "+3.1%", risk: "Medium", tone: "warn" as const },
  { name: "Enroll fleet in FAST", capex: "$18k", payback: "4 mo", margin: "+1.4%", risk: "Low", tone: "ok" as const },
  { name: "Shift to I-90 corridor", capex: "$0", payback: "Immediate", margin: "+0.8%", risk: "Low", tone: "ok" as const },
]

export default function DecisionSupportPage() {
  return (
    <>
      <PageHeader
        title="Decision Support"
        description="Recommended actions and scenario modeling to reduce compliance risk and improve margin."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {recommendations.map((r) => (
          <Card key={r.title} className="flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-md">
                  {r.tone === "danger" ? <ShieldAlert className="size-4" /> : <Lightbulb className="size-4" />}
                </span>
                <StatusBadge tone={r.tone}>{r.impact} impact</StatusBadge>
              </div>
              <CardTitle className="mt-2 text-base text-balance">{r.title}</CardTitle>
              <CardDescription className="leading-relaxed">{r.body}</CardDescription>
            </CardHeader>
            <CardFooter className="mt-auto">
              <Button variant="outline" size="sm" className="w-full">
                {r.cta}
                <ArrowRight data-icon="inline-end" />
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="text-muted-foreground size-4" />
            Scenario modeling
          </CardTitle>
          <CardDescription>Projected outcomes for strategic options, based on current operating data.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {scenarios.map((s) => (
            <div key={s.name} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.name}</span>
                <StatusBadge tone={s.tone}>{s.risk} risk</StatusBadge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Capex</span>
                  <span className="font-mono text-sm font-medium tabular-nums">{s.capex}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Payback</span>
                  <span className="font-mono text-sm font-medium tabular-nums">{s.payback}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Margin</span>
                  <span className="text-chart-3 font-mono text-sm font-medium tabular-nums">{s.margin}</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="w-full">
                <CheckCircle2 data-icon="inline-start" />
                Run scenario
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  )
}
