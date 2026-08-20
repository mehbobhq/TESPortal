import { Landmark, Plus, ShieldCheck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const authorities = [
  { name: "FMCSA Operating Authority", number: "MC-884210", type: "Common Carrier", jurisdiction: "US Federal", issued: "Mar 2019", status: "Active", tone: "ok" as const },
  { name: "USDOT Registration", number: "DOT-2291847", type: "Interstate", jurisdiction: "US Federal", issued: "Mar 2019", status: "Active", tone: "ok" as const },
  { name: "NSC Safety Fitness", number: "NSC-ON-77120", type: "Carrier Profile", jurisdiction: "Ontario", issued: "Jan 2020", status: "Active", tone: "ok" as const },
  { name: "CVOR Certificate", number: "CVOR-118-4420", type: "Commercial Vehicle", jurisdiction: "Ontario", issued: "Jan 2020", status: "Review due", tone: "warn" as const },
  { name: "SAAQ Registration", number: "SAAQ-QC-3318", type: "Carrier", jurisdiction: "Quebec", issued: "Feb 2021", status: "Active", tone: "ok" as const },
]

export default function AuthoritiesPage() {
  return (
    <>
      <PageHeader
        title="Authorities"
        description="Operating authorities, DOT/MC numbers, and regulator registrations across jurisdictions."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Add authority
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active authorities" value="5" icon={Landmark} hint="across US & Canada" />
        <StatCard label="Safety rating" value="Satisfactory" icon={ShieldCheck} hint="FMCSA current" />
        <StatCard label="Reviews due" value="1" icon={Landmark} hint="CVOR within 60 days" trend={{ value: "1", direction: "up", positive: false }} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registered authorities</CardTitle>
          <CardDescription>Federal and provincial/state operating authorities and safety registrations.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Authority</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {authorities.map((a) => (
                <TableRow key={a.number}>
                  <TableCell className="pl-6 font-medium">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{a.number}</TableCell>
                  <TableCell className="text-muted-foreground">{a.type}</TableCell>
                  <TableCell className="text-muted-foreground">{a.jurisdiction}</TableCell>
                  <TableCell className="text-muted-foreground font-mono tabular-nums">{a.issued}</TableCell>
                  <TableCell className="pr-6">
                    <StatusBadge tone={a.tone}>{a.status}</StatusBadge>
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
