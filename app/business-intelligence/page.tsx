import { DollarSign, Fuel, Gauge, TrendingUp } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { RevenueChart, SpendChart } from "@/components/bi-charts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Added a type to ensure TypeScript stays happy with an empty array
type Insight = {
  k: string;
  v: string;
}

// Emptied the sample data
const insights: Insight[] = []

export default function BusinessIntelligencePage() {
  return (
    <>
      <PageHeader
        title="Business Intelligence"
        description="Trends across mileage, spend, and compliance performance over time."
        actions={
          <Select defaultValue="6m">
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="3m">Last 3 months</SelectItem>
                <SelectItem value="6m">Last 6 months</SelectItem>
                <SelectItem value="12m">Last 12 months</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Reset hardcoded stat values and removed fake trends */}
        <StatCard label="Revenue (MTD)" value="$0" icon={DollarSign} hint="No data available" />
        <StatCard label="Cost per mile" value="$0.00" icon={Gauge} hint="No data available" />
        <StatCard label="Fuel spend" value="$0" icon={Fuel} hint="No data available" />
        <StatCard label="Utilization" value="0%" icon={TrendingUp} hint="No data available" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Operating spend</CardTitle>
            <CardDescription>Fuel, tolls, and permits by month.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Assuming SpendChart handles its own empty state internally */}
            <SpendChart />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue trend</CardTitle>
            <CardDescription>Monthly billed revenue across all customers.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Assuming RevenueChart handles its own empty state internally */}
            <RevenueChart />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Key insights</CardTitle>
            <CardDescription>Automatically surfaced from your operating data.</CardDescription>
          </div>
          <Button variant="ghost" size="sm">Configure</Button>
        </CardHeader>
        <CardContent>
          {/* Added a fallback for when the insights array is empty */}
          {insights.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No insights generated yet.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {insights.map((i) => (
                <div key={i.k} className="bg-secondary/50 flex flex-col gap-1 rounded-lg border p-4">
                  <span className="text-sm font-semibold">{i.k}</span>
                  <span className="text-muted-foreground text-sm leading-relaxed">{i.v}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
