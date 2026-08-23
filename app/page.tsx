import { AlertTriangle, Download, FileCheck2, Plus, Route, ShieldCheck, Truck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { ComplianceChart } from "@/components/compliance-chart"
import { DiscoveryFeed } from "@/components/discovery-feed" // <-- NEW COMPONENT IMPORTED
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

      {/* TOP STATS: Kept exactly as you built them */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Compliance score" value="96%" icon={ShieldCheck} hint="6-month rolling average" trend={{ value: "1.2%", direction: "up", positive: true }} />
        <StatCard label="Active vehicles" value="128" icon={Truck} hint="of 134 in fleet" trend={{ value: "3", direction: "up", positive: true }} />
        <StatCard label="Open filings" value="4" icon={FileCheck2} hint="2 due within 30 days" />
        <StatCard label="Items expiring" value="12" icon={AlertTriangle} hint="credentials & policies" trend={{ value: "5", direction: "up", positive: false }} />
      </div>

      {/* THE NEW DISCOVERY LOOP: Inserted right below the high-level stats */}
      <div className="mt-8 mb-8">
        <DiscoveryFeed />
      </div>

      {/* DEEP DIVE DATA: Kept your existing charts and mileage tables below the fold */}
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

      {/* THE REST OF YOUR TABLES: Expiring Items, Recent Activity, Upcoming Filings... */}
      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        {/* ... (Keep the rest of your page.tsx code exactly the same here) ... */}
