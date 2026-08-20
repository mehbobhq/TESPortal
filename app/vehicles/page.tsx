import { Truck, Wrench, CircleAlert, Plus, Search } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { vehicles } from "@/lib/data"

export default function VehiclesPage() {
  const active = vehicles.filter((v) => v.status === "Active").length
  const maintenance = vehicles.filter((v) => v.status === "Maintenance").length
  const oos = vehicles.filter((v) => v.status === "Out of service").length

  return (
    <>
      <PageHeader
        title="Vehicles"
        description="Fleet units, IRP registration, plates, and operating status across jurisdictions."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            Add vehicle
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total units" value={String(vehicles.length)} icon={Truck} hint="tractors + trailers" />
        <StatCard label="Active" value={String(active)} icon={Truck} hint="in service" />
        <StatCard label="In maintenance" value={String(maintenance)} icon={Wrench} hint="scheduled work" />
        <StatCard label="Out of service" value={String(oos)} icon={CircleAlert} hint="needs attention" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fleet</CardTitle>
          <CardDescription>All registered units with plate, VIN, and IRP jurisdiction.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="px-6">
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search unit, plate, or VIN..." />
            </InputGroup>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Unit</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Make / Model</TableHead>
                <TableHead>Plate</TableHead>
                <TableHead>VIN</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.map((v) => (
                <TableRow key={v.unit}>
                  <TableCell className="pl-6 font-mono text-xs font-medium">{v.unit}</TableCell>
                  <TableCell className="text-muted-foreground">{v.type}</TableCell>
                  <TableCell className="font-medium">{v.make}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{v.plate}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{v.vin}</TableCell>
                  <TableCell className="text-muted-foreground">{v.jurisdiction}</TableCell>
                  <TableCell className="pr-6">
                    <StatusBadge tone={v.tone}>{v.status}</StatusBadge>
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
