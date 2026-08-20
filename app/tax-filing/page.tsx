import { CalendarClock, FileCheck2, Plus, ReceiptText } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Added type for Open Filings
type Filing = {
  name: string;
  type: string;
  period: string;
  amount: string;
  due: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

// Added type for Filing History
type History = {
  name: string;
  filed: string;
  amount: string;
  confirmation: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

// Emptied the sample data arrays
const filings: Filing[] = []
const history: History[] = []

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
        {/* Reset hardcoded stat values and removed trends */}
        <StatCard label="Open filings" value="0" icon={ReceiptText} hint="0 due within 30 days" />
        <StatCard label="Est. liability" value="$0" icon={FileCheck2} hint="current period" />
        <StatCard label="Next deadline" value="N/A" icon={CalendarClock} hint="No upcoming deadlines" />
        <StatCard label="Filed YTD" value="0" icon={FileCheck2} hint="all on time" />
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
                  {/* Added a fallback for when the filings array is empty */}
                  {filings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        No open filings found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filings.map((f) => (
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
                    ))
                  )}
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
                  {/* Added a fallback for when the history array is empty */}
                  {history.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        No filing history found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((h) => (
                      <TableRow key={h.name}>
                        <TableCell className="pl-6 font-medium">{h.name}</TableCell>
                        <TableCell className="text-muted-foreground font-mono tabular-nums">{h.filed}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{h.amount}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">{h.confirmation}</TableCell>
                        <TableCell className="pr-6">
                          <StatusBadge tone={h.tone}>Accepted</StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
