"use client"

import { useParams, useRouter } from "next/navigation"
import { CheckCircle2, AlertCircle, Search, Filter, Plus, MoreHorizontal, Truck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Mock Data representing the structure needed
const MOCK_FLEET_DATA = [
  { id: 'R5338', type: 'Trailer - Reefer', year: '2025', make: 'Stoughton', vin: '1DW1R5329SE...', gps: '', status: 'Active', reg: 'ok', permit: 'ok', maint: null },
  { id: 'R5322', type: 'Trailer - Reefer', year: '2022', make: 'UTILITY', vin: '1UYVS2538PE...', gps: '', status: 'Active', reg: 'ok', permit: 'ok', maint: 'alert' },
  { id: 'missing', type: 'Tractor', year: '2009', make: 'Freightliner', vin: '1FUJGLD...', gps: '', status: 'Inactive', reg: 'alert', permit: 'alert', maint: null },
  { id: 'S123', type: 'Tractor', year: '2022', make: 'Peterbilt', vin: '1XPBDPRX9...', gps: '', status: 'Active', reg: 'ok', permit: 'ok', maint: 'ok' },
]

export default function FleetListPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const renderStatusIcon = (status: string | null) => {
    if (status === 'ok') return <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />
    if (status === 'alert') return <AlertCircle className="w-5 h-5 text-destructive mx-auto" />
    return <span className="text-muted-foreground/50 mx-auto">-</span>
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto bg-background min-h-screen">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4 mb-6">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <div className="bg-primary/10 p-1.5 rounded-md">
              <Truck className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Equipments</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {MOCK_FLEET_DATA.length} items • Sorted by Equipment Number • Updated just now
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative w-[250px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input placeholder="Search equipment..." className="pl-9" />
          </div>
          <Button variant="outline" className="shadow-sm">
            <Filter className="w-4 h-4 mr-2" /> Filter
          </Button>
          <Button className="shadow-sm">
            <Plus className="w-4 h-4 mr-2" /> New Equipment
          </Button>
        </div>
      </div>

      {/* Data Table */}
      <div className="border border-border rounded-lg bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-12 text-center">
                <input type="checkbox" className="rounded border-input text-primary focus:ring-ring" />
              </TableHead>
              <TableHead>Equipment Number</TableHead>
              <TableHead>Record Type</TableHead>
              <TableHead>Equipment Year</TableHead>
              <TableHead>Equipment Make</TableHead>
              <TableHead>Equipment VIN</TableHead>
              <TableHead>GPS Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Registration</TableHead>
              <TableHead className="text-center">Permits</TableHead>
              <TableHead className="text-center">Maintenance</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_FLEET_DATA.map((vehicle, index) => (
              <TableRow 
                key={index} 
                className="cursor-pointer group hover:bg-muted/50"
                onClick={() => router.push(`/companies/${companyId}/vehicles/${vehicle.id}`)}
              >
                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="rounded border-input text-primary focus:ring-ring" />
                </TableCell>
                <TableCell className="font-medium text-primary hover:underline">
                  {vehicle.id}
                </TableCell>
                <TableCell>{vehicle.type}</TableCell>
                <TableCell>{vehicle.year}</TableCell>
                <TableCell>{vehicle.make}</TableCell>
                <TableCell className="text-muted-foreground">{vehicle.vin}</TableCell>
                <TableCell className="text-muted-foreground">{vehicle.gps || '-'}</TableCell>
                <TableCell>
                  <Badge variant={vehicle.status === 'Active' ? 'default' : 'secondary'} className={vehicle.status === 'Active' ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-none' : ''}>
                    {vehicle.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">{renderStatusIcon(vehicle.reg)}</TableCell>
                <TableCell className="text-center">{renderStatusIcon(vehicle.permit)}</TableCell>
                <TableCell className="text-center">{renderStatusIcon(vehicle.maint)}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
