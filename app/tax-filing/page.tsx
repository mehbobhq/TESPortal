import { CalendarClock, FileCheck2, Plus, ReceiptText } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const filings = [
  { name: "IFTA Q1 2026", type: "Fuel Tax", period: "Jan – Mar 2026", amount: "$18,420", due: "Apr 30, 2026", status: "In progress", tone: "warn" as const },
  { name: "IRP Renewal 2026", type: "Registration", period: "Annual", amount: "$42,100", due: "May 15, 2026", status: "Ready to file", tone: "ok" as const },
  { name: "HVUT Form 2290", type: "Heavy Vehicle", period: "2025–2026", amount: "$8,250", due: "Aug 31, 2026", status: "Not started", tone: "neutral" as const },
  { name: "GST/HST Q1 2026", type: "Sales Tax", period: "Jan – Mar 2026", amount: "$11,980", due: "Apr 30, 2026", status: "In progress", tone: "warn" as const },
]

const history = [
  { name: "IFTA Q4 2025", filed: "Jan 28, 2026", amount: "$17,240", confirmation: "IFTA-2025Q4-8841", tone: "ok" as const },
  { name: "GST/HST Q4 2025", filed: "Jan 30, 2026", amount: "$10,760", confirmation: "GST-2025Q4-2290", tone: "ok" as const },
  { name: "IFTA Q3 2025", filed: "Oct 27, 2025", amount: "$19,110", confirmation: "IFTA-2025Q3-7712", tone: "ok" as const },
]

export default function TaxFilingPage() {
  return (
    <>
      <PageHeader
        title="Tax Filing"
        description="IFTA and IRP quarterly filings, fuel tax reconciliation, and deadlines across all jurisdictions."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            New filing
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open filings" value="4" icon={ReceiptText} hint="2 due within 30 days" />
        <StatCard label="Est. liability" value="$80.8k" icon={FileCheck2} hint="current period" />
        <StatCard label="Next deadline" value="Apr 30" icon={CalendarClock} hint="IFTA Q1 + GST/HST" />
        <StatCard label="Filed YTD" value="6" icon={FileCheck2} hint="all on time" trend={{ value: "100%", direction: "up", positive: true }} />
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Open filings</TabsTrigger>
          <TabsTrigger value="history">Filing history</TabsTrigger>
        </TabsList>

        <TabsContent value="open">
          <Card>
            <CardHeader>
              <CardTitle>Open filings</CardTitle>
              <CardDescription>Filings in progress or awaiting submission.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Filing</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="pr-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filings.map((f) => (
                    <TableRow key={f.name}>
                      <TableCell className="pl-6 font-medium">{f.name}</TableCell>
                      <TableCell className="text-muted-foreground">{f.type}</TableCell>
                      <TableCell className="text-muted-foreground">{f.period}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{f.amount}</TableCell>
                      <TableCell className="text-muted-foreground font-mono tabular-nums">{f.due}</TableCell>
                      <TableCell className="pr-6">
                        <StatusBadge tone={f.tone}>{f.status}</StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Filing history</CardTitle>
              <CardDescription>Submitted filings and confirmation numbers.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Filing</TableHead>
                    <TableHead>Filed</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Confirmation</TableHead>
                    <TableHead className="pr-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.name}>
                      <TableCell className="pl-6 font-medium">{h.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono tabular-nums">{h.filed}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{h.amount}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{h.confirmation}</TableCell>
                      <TableCell className="pr-6">
                        <StatusBadge tone={h.tone}>Accepted</StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
