import { AlertTriangle, Download, FileCheck2, Plus, Route, ShieldCheck, Truck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { ComplianceChart } from "@/components/compliance-chart"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { expiringItems, jurisdictionMileage, recentActivity, upcomingFilings } from "@/lib/data"

export default function DashboardPage() {
  const maxMiles = Math.max(...jurisdictionMileage.map((j) => j.miles))

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Fleet compliance at a glance — expiring credentials, open filings, and cross-border risk signals across all jurisdictions."
        actions={
          <>
            <Button variant="outline">
              <Download data-icon="inline-start" />
              Export
            </Button>
            <Button>
              <Plus data-icon="inline-start" />
              New trip
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Compliance score" value="96%" icon={ShieldCheck} hint="6-month rolling average" trend={{ value: "1.2%", direction: "up", positive: true }} />
        <StatCard label="Active vehicles" value="128" icon={Truck} hint="of 134 in fleet" trend={{ value: "3", direction: "up", positive: true }} />
        <StatCard label="Open filings" value="4" icon={FileCheck2} hint="2 due within 30 days" />
        <StatCard label="Items expiring" value="12" icon={AlertTriangle} hint="credentials & policies" trend={{ value: "5", direction: "up", positive: false }} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Compliance trend</CardTitle>
            <CardDescription>Fleet-wide compliance score over the last 6 months.</CardDescription>
          </CardHeader>
          <CardContent>
            <ComplianceChart />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mileage by jurisdiction</CardTitle>
            <CardDescription>Current IFTA quarter, top 5.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {jurisdictionMileage.map((j) => (
              <div key={j.name} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{j.name}</span>
                  <span className="text-muted-foreground font-mono tabular-nums">{j.miles.toLocaleString()} mi</span>
                </div>
                <div className="bg-secondary h-2 overflow-hidden rounded-full">
                  <div className="bg-chart-1 h-full rounded-full" style={{ width: `${(j.miles / maxMiles) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="text-chart-4 size-4" />
                Expiring soon
              </CardTitle>
              <CardDescription>Credentials, policies, and driver documents nearing expiry.</CardDescription>
            </div>
            <Button variant="ghost" size="sm">View all</Button>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead className="pr-6 text-right">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiringItems.map((row) => (
                  <TableRow key={row.item}>
                    <TableCell className="pl-6 font-medium">{row.item}</TableCell>
                    <TableCell className="text-muted-foreground">{row.type}</TableCell>
                    <TableCell className="text-muted-foreground">{row.jurisdiction}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <StatusBadge tone={row.tone}>{row.due}</StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Route className="text-muted-foreground size-4" />
              Recent activity
            </CardTitle>
            <CardDescription>Latest actions across your fleet.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {recentActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="bg-primary/10 text-primary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                  {a.who === "System" ? "SY" : a.who.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                </span>
                <div className="flex flex-col">
                  <span className="leading-snug">
                    <span className="font-medium">{a.who}</span> {a.action}{" "}
                    <span className="text-muted-foreground">{a.target}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">{a.when}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming filings</CardTitle>
          <CardDescription>Tax and registration filings across all jurisdictions.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Filing</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-center">Jurisdictions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcomingFilings.map((f) => (
                <TableRow key={f.name}>
                  <TableCell className="pl-6 font-medium">{f.name}</TableCell>
                  <TableCell className="text-muted-foreground">{f.period}</TableCell>
                  <TableCell className="text-center font-mono tabular-nums">{f.jurisdictions}</TableCell>
                  <TableCell>
                    <StatusBadge tone={f.tone}>{f.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="pr-6 text-right font-mono tabular-nums">{f.due}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
