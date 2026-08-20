import { FileText, PackageCheck, Plus, ShieldCheck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// Added type for Manifests
type Manifest = {
  id: string;
  type: string;
  carrier: string;
  crossing: string;
  eta: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

// Added type for Bonds
type Bond = {
  name: string;
  number: string;
  coverage: string;
  expiry: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

// Emptied the sample data arrays
const manifests: Manifest[] = []
const bonds: Bond[] = []

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
        {/* Reset hardcoded stat values and removed trends */}
        <StatCard label="Active manifests" value="0" icon={PackageCheck} hint="next 72 hours" />
        <StatCard label="Accepted rate" value="0%" icon={ShieldCheck} hint="last 30 days" />
        <StatCard label="Pending review" value="0" icon={FileText} hint="awaiting CBP/CBSA" />
        <StatCard label="Bonds active" value="0" icon={ShieldCheck} hint="all current" />
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
              {/* Added a fallback for when the manifests array is empty */}
              {manifests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No manifests found.
                  </TableCell>
                </TableRow>
              ) : (
                manifests.map((m) => (
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
                ))
              )}
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
              {/* Added a fallback for when the bonds array is empty */}
              {bonds.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No bonds found.
                  </TableCell>
                </TableRow>
              ) : (
                bonds.map((b) => (
                  <TableRow key={b.number}>
                    <TableCell className="pl-6 font-medium">{b.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{b.number}</TableCell>
                    <TableCell className="font-mono tabular-nums">{b.coverage}</TableCell>
                    <TableCell className="text-muted-foreground font-mono tabular-nums">{b.expiry}</TableCell>
                    <TableCell className="pr-6">
                      <StatusBadge tone={b.tone}>{b.status}</StatusBadge>
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
