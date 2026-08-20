import { CalendarClock, Download, FileText, Filter, Plus } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// Added type for Reports to ensure TypeScript stays happy with an empty array
type Report = {
  name: string;
  category: string;
  format: string;
  schedule: string;
  last: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

// Emptied the sample user report data
const reports: Report[] = []

// Kept templates as these act as static application features/options
const templates = [
  { title: "Regulatory filing pack", desc: "Bundle IFTA, IRP, and HVUT summaries for a period." },
  { title: "Customer trip statement", desc: "Per-customer trip and mileage breakdown for billing." },
  { title: "Fleet safety scorecard", desc: "HOS, inspections, and incident rollup by driver." },
]

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Generate, schedule, and export operational and regulatory reports across your fleet."
        actions={
          <>
            <Button variant="outline">
              <Filter data-icon="inline-start" />
              Filter
            </Button>
            <Button>
              <Plus data-icon="inline-start" />
              New report
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {templates.map((t) => (
          <Card key={t.title} className="hover:border-primary/40 transition-colors">
            <CardHeader>
              <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-md">
                <FileText className="size-4" />
              </span>
              <CardTitle className="mt-2 text-base">{t.title}</CardTitle>
              <CardDescription>{t.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full">
                Use template
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Saved reports</CardTitle>
            <CardDescription>Scheduled and on-demand reports available to your team.</CardDescription>
          </div>
          <Button variant="ghost" size="sm">
            <CalendarClock data-icon="inline-start" />
            Manage schedules
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Report</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Added a fallback for when the reports array is empty */}
              {reports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No saved reports found.
                  </TableCell>
                </TableRow>
              ) : (
                reports.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="pl-6 font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.category}</TableCell>
                    <TableCell className="font-mono text-xs">{r.format}</TableCell>
                    <TableCell className="text-muted-foreground">{r.schedule}</TableCell>
                    <TableCell className="text-muted-foreground font-mono tabular-nums">{r.last}</TableCell>
                    <TableCell>
                      <StatusBadge tone={r.tone}>{r.status}</StatusBadge>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button variant="ghost" size="icon" aria-label={`Download ${r.name}`}>
                        <Download />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
