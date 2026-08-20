import { FileText, Plus, ShieldCheck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const policies = [
  { name: "Auto Liability", number: "INS-2290", carrier: "Aurora Underwriting Co.", broker: "NorthBridge", coverage: "$1,000,000", expiry: "in 9 days", status: "Expiring", tone: "warn" as const },
  { name: "Cargo", number: "INS-2291", carrier: "Aurora Underwriting Co.", broker: "NorthBridge", coverage: "$250,000", expiry: "Sep 30, 2026", status: "Active", tone: "ok" as const },
  { name: "Physical Damage", number: "INS-2292", carrier: "Aurora Underwriting Co.", broker: "NorthBridge", coverage: "$2,400,000", expiry: "Sep 30, 2026", status: "Active", tone: "ok" as const },
  { name: "General Liability", number: "INS-2293", carrier: "Meridian Mutual", broker: "NorthBridge", coverage: "$1,000,000", expiry: "Dec 15, 2026", status: "Active", tone: "ok" as const },
  { name: "Cross-Border (US)", number: "INS-2294", carrier: "Aurora Underwriting Co.", broker: "NorthBridge", coverage: "$1,000,000", expiry: "Sep 30, 2026", status: "Active", tone: "ok" as const },
]

export default function InsurancePage() {
  return (
    <>
      <PageHeader
        title="Insurance"
        description="Policies, certificates of insurance, and coverage expirations across your brokers and carriers."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Add policy
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active policies" value="5" icon={ShieldCheck} hint="1 expiring soon" />
        <StatCard label="Total coverage" value="$5.65M" icon={ShieldCheck} hint="aggregate limits" />
        <StatCard label="COIs on file" value="24" icon={FileText} hint="certificates of insurance" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Policies</CardTitle>
          <CardDescription>Coverage, carriers, brokers, and renewal dates.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Policy</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Broker</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((p) => (
                <TableRow key={p.number}>
                  <TableCell className="pl-6 font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{p.number}</TableCell>
                  <TableCell className="text-muted-foreground">{p.carrier}</TableCell>
                  <TableCell className="text-muted-foreground">{p.broker}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{p.coverage}</TableCell>
                  <TableCell className="text-muted-foreground font-mono tabular-nums">{p.expiry}</TableCell>
                  <TableCell className="pr-6">
                    <StatusBadge tone={p.tone}>{p.status}</StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
