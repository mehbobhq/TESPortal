import { FileText, PackageCheck, Plus, ShieldCheck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const manifests = [
  { id: "ACE-88213", type: "e-Manifest (US)", carrier: "SCAC: MERD", crossing: "Peace Bridge", eta: "Feb 18, 14:20", status: "Accepted", tone: "ok" as const },
  { id: "ACI-44120", type: "eManifest (CA)", carrier: "SCAC: MERD", crossing: "Ambassador", eta: "Feb 18, 09:05", status: "Accepted", tone: "ok" as const },
  { id: "ACE-88210", type: "e-Manifest (US)", carrier: "SCAC: MERD", crossing: "Champlain", eta: "Feb 19, 07:40", status: "Pending review", tone: "warn" as const },
  { id: "ACE-88209", type: "e-Manifest (US)", carrier: "SCAC: MERD", crossing: "Peace Bridge", eta: "Feb 17, 22:10", status: "Rejected", tone: "danger" as const },
]

const bonds = [
  { name: "Continuous Import Bond", number: "CBP-BND-77120", coverage: "$500,000", expiry: "Nov 30, 2026", status: "Active", tone: "ok" as const },
  { name: "Carrier Code Bond", number: "CBSA-CC-22118", coverage: "CAD $25,000", expiry: "Jun 15, 2026", status: "Active", tone: "ok" as const },
]

export default function CustomsPage() {
  return (
    <>
      <PageHeader
        title="Customs"
        description="Border crossings, manifests, ACE/ACI e-manifests, and bond status for US–Canada operations."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            New manifest
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active manifests" value="18" icon={PackageCheck} hint="next 72 hours" />
        <StatCard label="Accepted rate" value="94%" icon={ShieldCheck} hint="last 30 days" trend={{ value: "2%", direction: "up", positive: true }} />
        <StatCard label="Pending review" value="3" icon={FileText} hint="awaiting CBP/CBSA" />
        <StatCard label="Bonds active" value="2" icon={ShieldCheck} hint="all current" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent manifests</CardTitle>
          <CardDescription>ACE (US) and ACI (Canada) electronic manifests and their crossing status.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Manifest</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Crossing</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {manifests.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-6 font-mono text-xs font-medium">{m.id}</TableCell>
                  <TableCell className="text-muted-foreground">{m.type}</TableCell>
                  <TableCell className="font-mono text-xs">{m.carrier}</TableCell>
                  <TableCell className="text-muted-foreground">{m.crossing}</TableCell>
                  <TableCell className="text-muted-foreground font-mono tabular-nums">{m.eta}</TableCell>
                  <TableCell className="pr-6">
                    <StatusBadge tone={m.tone}>{m.status}</StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customs bonds</CardTitle>
          <CardDescription>Import and carrier bonds securing your cross-border operations.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Bond</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bonds.map((b) => (
                <TableRow key={b.number}>
                  <TableCell className="pl-6 font-medium">{b.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{b.number}</TableCell>
                  <TableCell className="font-mono tabular-nums">{b.coverage}</TableCell>
                  <TableCell className="text-muted-foreground font-mono tabular-nums">{b.expiry}</TableCell>
                  <TableCell className="pr-6">
                    <StatusBadge tone={b.tone}>{b.status}</StatusBadge>
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
