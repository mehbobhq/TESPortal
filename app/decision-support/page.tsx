import { ArrowRight, CheckCircle2, Lightbulb, ShieldAlert, TrendingUp } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

// Added type for Recommendations
type Recommendation = {
  title: string;
  impact: string;
  tone: "danger" | "warn" | "info" | "ok" | "neutral" | "default";
  body: string;
  cta: string;
}

// Added type for Scenarios
type Scenario = {
  name: string;
  capex: string;
  payback: string;
  margin: string;
  risk: string;
  tone: "danger" | "warn" | "info" | "ok" | "neutral" | "default";
}

// Emptied the sample data arrays
const recommendations: Recommendation[] = []
const scenarios: Scenario[] = []

export default function DecisionSupportPage() {
  return (
    <>
      <PageHeader
        title="Decision Support"
        description="Recommended actions and scenario modeling to reduce compliance risk and improve margin."
      />

      {/* Added a fallback for when the recommendations array is empty */}
      {recommendations.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No recommendations available at this time.
        </div>
      ) : (
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
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="text-muted-foreground size-4" />
            Scenario modeling
          </CardTitle>
          <CardDescription>Projected outcomes for strategic options, based on current operating data.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Added a fallback for when the scenarios array is empty */}
          {scenarios.length === 0 ? (
             <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
               No scenarios available for modeling.
             </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
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
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
