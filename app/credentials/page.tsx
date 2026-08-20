import { IdCard, Plus, RefreshCw } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// Added a type to ensure TypeScript stays happy with an empty array
type Credential = {
  name: string;
  type: string;
  jurisdiction: string;
  number: string;
  expiry: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

// Emptied the sample data
const credentials: Credential[] = []

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
        {/* Reset hardcoded stat values and removed trends */}
        <StatCard label="Total credentials" value="0" icon={IdCard} hint="fleet-wide" />
        <StatCard label="Active" value="0" icon={IdCard} hint="in good standing" />
        <StatCard label="Expiring < 30d" value="0" icon={IdCard} hint="need renewal" />
        <StatCard label="Critical" value="0" icon={IdCard} hint="expires within a week" />
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
              {/* Added a fallback for when the array is empty */}
              {credentials.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No credentials found.
                  </TableCell>
                </TableRow>
              ) : (
                credentials.map((c) => (
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
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
