import { DollarSign, Fuel, Gauge, TrendingUp } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { RevenueChart, SpendChart } from "@/components/bi-charts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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
        <StatCard label="Revenue (MTD)" value="$226k" icon={DollarSign} hint="vs $239k last month" trend={{ value: "5.4%", direction: "down", positive: false }} />
        <StatCard label="Cost per mile" value="$1.64" icon={Gauge} hint="fleet average" trend={{ value: "2.1%", direction: "down", positive: true }} />
        <StatCard label="Fuel spend" value="$84.9k" icon={Fuel} hint="this month" trend={{ value: "3.8%", direction: "down", positive: true }} />
        <StatCard label="Utilization" value="87%" icon={TrendingUp} hint="active vs idle units" trend={{ value: "1.5%", direction: "up", positive: true }} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Operating spend</CardTitle>
            <CardDescription>Fuel, tolls, and permits by month.</CardDescription>
          </CardHeader>
          <CardContent>
            <SpendChart />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue trend</CardTitle>
            <CardDescription>Monthly billed revenue across all customers.</CardDescription>
          </CardHeader>
          <CardContent>
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
        <CardContent className="grid gap-4 md:grid-cols-3">
          {[
            { k: "Fuel efficiency up", v: "Cost per mile dropped 2.1% after route optimization on the ON–NY lane." },
            { k: "Permit spend spike", v: "January permits rose 33% due to 3 new oversize-load moves." },
            { k: "Idle units", v: "13% of tractors idle >48h — consider reallocating to Quebec demand." },
          ].map((i) => (
            <div key={i.k} className="bg-secondary/50 flex flex-col gap-1 rounded-lg border p-4">
              <span className="text-sm font-semibold">{i.k}</span>
              <span className="text-muted-foreground text-sm leading-relaxed">{i.v}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  )
}
