import { Users, ShieldCheck, CircleAlert, Plus, Search } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { drivers } from "@/lib/data"

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
}

export default function DriversPage() {
  const compliant = drivers.filter((d) => d.hos === "Compliant").length
  const violations = drivers.filter((d) => d.hos === "Violation").length

  return (
    <>
      <PageHeader
        title="Drivers"
        description="CDL status, medical certifications, and hours-of-service compliance across the roster."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Add driver
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total drivers" value={String(drivers.length)} icon={Users} hint="active roster" />
        <StatCard label="HOS compliant" value={String(compliant)} icon={ShieldCheck} hint="within limits" />
        <StatCard label="HOS violations" value={String(violations)} icon={CircleAlert} hint="needs review" />
        <StatCard label="Medical expiring" value="1" icon={CircleAlert} hint="within 30 days" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
          <CardDescription>Driver qualifications, medical cards, and current HOS status.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="px-6">
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search drivers..." />
            </InputGroup>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Driver</TableHead>
                <TableHead>CDL</TableHead>
                <TableHead>Medical card</TableHead>
                <TableHead>Trips (YTD)</TableHead>
                <TableHead className="pr-6">HOS status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.map((d) => (
                <TableRow key={d.name}>
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">{initials(d.name)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{d.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{d.cdl}</TableCell>
                  <TableCell className="text-muted-foreground">{d.medical}</TableCell>
                  <TableCell className="font-mono tabular-nums">{d.trips}</TableCell>
                  <TableCell className="pr-6">
                    <StatusBadge tone={d.tone}>{d.hos}</StatusBadge>
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
