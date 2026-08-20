import { Landmark, Plus, ShieldCheck } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// Added a type to ensure TypeScript stays happy with an empty array
type Authority = {
  name: string;
  number: string;
  type: string;
  jurisdiction: string;
  issued: string;
  status: string;
  tone: "ok" | "warn" | "error" | "default";
}

// Emptied the sample data
const authorities: Authority[] = []

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
        {/* Reset hardcoded stat values */}
        <StatCard label="Active authorities" value="0" icon={Landmark} hint="across US & Canada" />
        <StatCard label="Safety rating" value="N/A" icon={ShieldCheck} hint="FMCSA current" />
        <StatCard label="Reviews due" value="0" icon={Landmark} hint="CVOR within 60 days" />
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
              {/* Added a fallback for when the array is empty */}
              {authorities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No authorities found.
                  </TableCell>
                </TableRow>
              ) : (
                authorities.map((a) => (
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
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
