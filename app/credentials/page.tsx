import { IdCard, Plus, RefreshCw } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const credentials = [
  { name: "IRP Cab Card — Unit 4471", type: "Registration", jurisdiction: "Ontario", number: "IRP-ON-4471", expiry: "in 4 days", status: "Critical", tone: "danger" as const },
  { name: "IFTA License 2026", type: "Fuel Tax", jurisdiction: "Quebec", number: "IFTA-QC-2026", expiry: "in 21 days", status: "Expiring", tone: "warn" as const },
  { name: "Oversize/Overweight Permit", type: "Permit", jurisdiction: "New York", number: "OS-NY-8841", expiry: "Jun 30, 2026", status: "Active", tone: "ok" as const },
  { name: "Trip Permit — Michigan", type: "Permit", jurisdiction: "Michigan", number: "TP-MI-2210", expiry: "Apr 12, 2026", status: "Active", tone: "ok" as const },
  { name: "Fuel Permit — Ohio", type: "Permit", jurisdiction: "Ohio", number: "FP-OH-7712", expiry: "May 30, 2026", status: "Active", tone: "ok" as const },
  { name: "IRP Cab Card — Unit 4472", type: "Registration", jurisdiction: "Ontario", number: "IRP-ON-4472", expiry: "Nov 30, 2026", status: "Active", tone: "ok" as const },
]

export default function CredentialsPage() {
  return (
    <>
      <PageHeader
        title="Credentials"
        description="Permits, licenses, and registrations across all jurisdictions, with renewal tracking."
        actions={
          <>
            <Button variant="outline">
              <RefreshCw data-icon="inline-start" />
              Sync jurisdictions
            </Button>
            <Button>
              <Plus data-icon="inline-start" />
              Add credential
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total credentials" value="147" icon={IdCard} hint="fleet-wide" />
        <StatCard label="Active" value="135" icon={IdCard} hint="in good standing" />
        <StatCard label="Expiring < 30d" value="8" icon={IdCard} hint="need renewal" trend={{ value: "3", direction: "up", positive: false }} />
        <StatCard label="Critical" value="1" icon={IdCard} hint="expires within a week" trend={{ value: "1", direction: "up", positive: false }} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Credentials</CardTitle>
          <CardDescription>Permits, registrations, and licenses ordered by urgency.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Credential</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((c) => (
                <TableRow key={c.number}>
                  <TableCell className="pl-6 font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.type}</TableCell>
                  <TableCell className="text-muted-foreground">{c.jurisdiction}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{c.number}</TableCell>
                  <TableCell className="text-muted-foreground font-mono tabular-nums">{c.expiry}</TableCell>
                  <TableCell className="pr-6">
                    <StatusBadge tone={c.tone}>{c.status}</StatusBadge>
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
