import { Download, MapPin, Plus, Route } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"

// Added type for Trips to ensure TypeScript stays happy with an empty array
type Trip = {
  id: string;
  driver: string;
  unit: string;
  route: string;
  miles: number;
  border: string;
  status: string;
  tone: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
}

// Emptied the sample data array
const trips: Trip[] = []

export default function TripCompliancePage() {
  return (
    <>
      <PageHeader
        title="Trip Compliance"
        description="Cross-border trips, jurisdiction mileage, and IFTA-ready trip logs."
        actions={
          <>
            <Button variant="outline">
              <Download data-icon="inline-start" />
              Export logs
            </Button>
            <Button>
              <Plus data-icon="inline-start" />
              Log trip
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Reset hardcoded stat values and removed trends */}
        <StatCard label="Trips this quarter" value="0" icon={Route} hint="across 0 jurisdictions" />
        <StatCard label="Total miles" value="0" icon={MapPin} hint="IFTA reportable" />
        <StatCard label="Border crossings" value="0" icon={MapPin} hint="US ↔ CA" />
        <StatCard label="Flagged trips" value="0" icon={Route} hint="need review" />
      </div>

      <Card>
        <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Trip log</CardTitle>
            <CardDescription>Most recent trips with jurisdiction and compliance status.</CardDescription>
          </div>
          <Input placeholder="Search trips…" className="h-9 sm:w-56" aria-label="Search trips" />
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Trip ID</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Miles</TableHead>
                <TableHead>Border</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Added a fallback for when the trips array is empty */}
              {trips.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No trip logs found.
                  </TableCell>
                </TableRow>
              ) : (
                trips.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="pl-6 font-mono text-xs font-medium">{t.id}</TableCell>
                    <TableCell>{t.driver}</TableCell>
                    <TableCell className="font-mono text-xs">{t.unit}</TableCell>
                    <TableCell className="text-muted-foreground">{t.route}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{t.miles}</TableCell>
                    <TableCell className="text-muted-foreground">{t.border}</TableCell>
                    <TableCell className="pr-6">
                      <StatusBadge tone={t.tone}>{t.status}</StatusBadge>
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
