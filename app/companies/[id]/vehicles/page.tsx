"use client"

import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Filter, 
  Plus, 
  MoreHorizontal,
  Truck
} from "lucide-react"

// Mock Data
const MOCK_FLEET_DATA = [
  { id: 'R5338', type: 'Trailer - Reefer', year: '2025', make: 'Stoughton', vin: '1DW1R5329SE...', gps: '', status: 'Active', reg: 'ok', permit: 'ok', maint: null },
  { id: 'R5322', type: 'Trailer - Reefer', year: '2022', make: 'UTILITY', vin: '1UYVS2538PE...', gps: '', status: 'Active', reg: 'ok', permit: 'ok', maint: 'alert' },
  { id: 'missing', type: 'Tractor', year: '2009', make: 'Freightliner', vin: '1FUJGLD...', gps: '', status: 'Inactive', reg: 'alert', permit: 'alert', maint: null },
  { id: 'S123', type: 'Tractor', year: '2022', make: 'Peterbilt', vin: '1XPBDPRX9...', gps: '', status: 'Active', reg: 'ok', permit: 'ok', maint: 'ok' },
]

export default function FleetListPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id

  const renderStatusIcon = (status: string | null) => {
    if (status === 'ok') return <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />
    if (status === 'alert') return <AlertCircle className="w-5 h-5 text-destructive mx-auto" />
    return <span className="text-muted-foreground/50 mx-auto">-</span>
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto bg-background min-h-screen text-foreground">
      
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
            {MOCK_FLEET_DATA.length} items • Sorted by Equipment Number • Updated a few seconds ago
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search equipment..." 
              className="pl-9 pr-4 py-2 border border-input rounded-md text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-ring w-[250px]"
            />
          </div>
          <button className="flex items-center px-3 py-2 border border-input rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors shadow-sm">
            <Filter className="w-4 h-4 mr-2" /> Filter
          </button>
          <button className="flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors shadow-sm">
            <Plus className="w-4 h-4 mr-2" /> New Equipment
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground font-medium">
              <tr>
                <th className="px-4 py-3 w-12 text-center">
                  <input type="checkbox" className="rounded border-input text-primary focus:ring-ring" />
                </th>
                <th className="px-4 py-3 font-medium">Equipment Number</th>
                <th className="px-4 py-3 font-medium">Record Type</th>
                <th className="px-4 py-3 font-medium">Equipment Year</th>
                <th className="px-4 py-3 font-medium">Equipment Make</th>
                <th className="px-4 py-3 font-medium">Equipment VIN</th>
                <th className="px-4 py-3 font-medium">GPS Provider</th>
                <th className="px-4 py-3 font-medium">Equipment Status</th>
                <th className="px-4 py-3 font-medium text-center">Registration</th>
                <th className="px-4 py-3 font-medium text-center">Permits</th>
                <th className="px-4 py-3 font-medium text-center">Maintenance</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {MOCK_FLEET_DATA.map((vehicle, index) => (
                <tr 
                  key={index} 
                  className="hover:bg-muted/50 transition-colors group cursor-pointer"
                  onClick={() => router.push(`/companies/${companyId}/vehicles/${vehicle.id}`)}
                >
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="rounded border-input text-primary focus:ring-ring" />
                  </td>
                  <td className="px-4 py-3 font-medium text-primary hover:underline">
                    {vehicle.id}
                  </td>
                  <td className="px-4 py-3">{vehicle.type}</td>
                  <td className="px-4 py-3">{vehicle.year}</td>
                  <td className="px-4 py-3">{vehicle.make}</td>
                  <td className="px-4 py-3 text-muted-foreground">{vehicle.vin}</td>
                  <td className="px-4 py-3 text-muted-foreground">{vehicle.gps || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      vehicle.status === 'Active' 
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' 
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {vehicle.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">{renderStatusIcon(vehicle.reg)}</td>
                  <td className="px-4 py-3 text-center">{renderStatusIcon(vehicle.permit)}</td>
                  <td className="px-4 py-3 text-center">{renderStatusIcon(vehicle.maint)}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
    </div>
  )
}
