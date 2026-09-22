"use client"

import { useState } from "react"
import { FileText, Filter, MoreHorizontal, Plus, Search, Upload } from "lucide-react"

import { DataTableShell } from "@/components/data-table-shell"
import { EntityHeader } from "@/components/entity-header"
import { FilterPills } from "@/components/filter-pills"
import { TESPagination } from "@/components/pagination"
import { TESStatusIndicator, TESStatusRing } from "@/components/tes-status"
import { VehicleIllustration } from "@/components/vehicle-illustration"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const records = [
  ["Aug 14, 2025", "Inspection", "Annual inspection", "456,780 km", "$350", "attention", "Due in 40 days"],
  ["Jun 10, 2025", "Repair", "Brake service (rear)", "482,350 km", "$2,450", "current", "Completed"],
  ["Apr 02, 2025", "Preventive", "Oil change", "470,120 km", "$620", "current", "Completed"],
  ["Jan 15, 2025", "Repair", "Tires (drive axle)", "440,560 km", "$3,200", "current", "Completed"],
  ["Oct 03, 2024", "Preventive", "PM service", "415,230 km", "$780", "current", "Completed"],
] as const

const filters = [
  { value: "all", label: "All", count: 8 },
  { value: "preventive", label: "Preventive", count: 4 },
  { value: "repairs", label: "Repairs", count: 2 },
  { value: "inspections", label: "Inspections", count: 2 },
]

export default function TESDesignSystemPage() {
  const [filter, setFilter] = useState("all")
  const [page, setPage] = useState(1)

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4">
      <div className="text-xs font-medium text-muted-foreground">Vehicles&nbsp;&nbsp;/&nbsp;&nbsp;Unit 101</div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <EntityHeader
            title="Unit 101"
            statusLabel="Active"
            statusTone="current"
            media={<VehicleIllustration color="red" illustrationKey="generic-sleeper-tractor-v1" />}
            description={
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>2024 Freightliner Cascadia</span><span>•</span><span>Tractor</span><span>•</span><span>VIN 1FUJA6DR5RL123456</span><span>•</span><span>Plate ABC123 (ON)</span>
              </div>
            }
            metadata={<div className="flex flex-wrap gap-x-5 gap-y-2"><span>Red</span><span>Diesel</span><span>6 × 4</span><span>Tare 8,165 kg</span><span>Operating: US / Canada</span></div>}
            actions={<><Button variant="outline">Actions</Button><Button><Plus data-icon="inline-start" />Add Record</Button></>}
            insight={
              <Card className="min-w-52 gap-1 p-3 py-3">
                <span className="text-xs text-muted-foreground">Compliance Progress</span>
                <div className="flex items-center gap-2"><span className="text-xl font-bold text-status-current">↑ +12%</span><span className="text-xs text-muted-foreground">vs last week</span></div>
              </Card>
            }
          />

          <Card className="grid gap-0 py-0 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Registration", "Current", "Expires Dec 31, 2026", "current"],
              ["Permits", "4 Active", "1 expiring soon", "attention"],
              ["Insurance", "Active", "Mar 15, 2026", "current"],
              ["Maintenance", "1 Due Soon", "Inspection in 40 days", "attention"],
            ].map(([label, value, detail, tone], index) => (
              <div key={label} className={`flex gap-3 p-4 ${index ? "border-t sm:border-l sm:border-t-0" : ""}`}>
                <TESStatusRing tone={tone as "current" | "attention"} size="md" />
                <div><div className="text-xs font-semibold">{label}</div><div className={`mt-1 text-xs font-semibold ${tone === "attention" ? "text-status-attention" : "text-status-current"}`}>{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div>
              </div>
            ))}
          </Card>

          <Tabs defaultValue="maintenance">
            <TabsList variant="line">
              {['Profile', 'Ownership', 'Registration', 'Permits', 'IFTA', 'Insurance', 'Maintenance', 'Documents', 'Settings'].map((tab) => (
                <TabsTrigger key={tab} value={tab.toLowerCase()}>{tab}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <DataTableShell
            title="Maintenance Records"
            description="All service, repair and inspection records for this vehicle."
            actions={<><Button><Plus data-icon="inline-start" />Add Maintenance Record</Button><Button variant="outline" size="icon"><MoreHorizontal /></Button></>}
            toolbar={<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><FilterPills items={filters} value={filter} onValueChange={setFilter} /><Button variant="outline" size="icon"><Filter /></Button></div>}
            footer={<><span className="text-xs text-muted-foreground">Showing 1 to 5 of 8 records</span><TESPagination page={page} pageCount={2} onPageChange={setPage} /></>}
          >
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead>Odometer</TableHead><TableHead>Cost (CAD)</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {records.map((record, index) => (
                  <TableRow key={record[0]}><TableCell>{index + 1}</TableCell><TableCell>{record[0]}</TableCell><TableCell>{record[1]}</TableCell><TableCell className="font-medium">{record[2]}</TableCell><TableCell>{record[3]}</TableCell><TableCell>{record[4]}</TableCell><TableCell><TESStatusIndicator tone={record[5]}>{record[6]}</TESStatusIndicator></TableCell><TableCell className="text-right"><Button variant="outline" size="sm">View</Button></TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableShell>
        </div>

        <Card className="h-fit gap-0 py-0 xl:sticky xl:top-[72px]">
          <div className="border-b p-4"><h2 className="text-lg font-bold">Evidence</h2></div>
          <Tabs defaultValue="documents" className="gap-0">
            <TabsList variant="line" className="px-4"><TabsTrigger value="documents">Documents (4)</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
          </Tabs>
          <div className="space-y-3 p-4">
            <button className="flex w-full flex-col items-center rounded-lg border border-dashed border-primary/25 bg-primary/[0.02] p-6 text-center"><span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-accent text-primary"><Upload /></span><span className="text-sm font-semibold">Upload Document</span><span className="mt-1 text-xs text-muted-foreground">Drag & drop or click to upload</span></button>
            <div className="relative"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search documents…" /></div>
            {['Annual Inspection Report', 'Repair Invoice - Brakes', 'PM Service Invoice', 'Tire Invoice'].map((name, index) => (
              <div key={name} className="flex items-center gap-3 border-b py-3 last:border-0"><span className="flex size-9 items-center justify-center rounded-lg bg-red-50 text-red-600"><FileText className="size-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{name}</div><div className="mt-1 text-xs text-muted-foreground">{index + 1} document</div></div>{index ? <TESStatusIndicator tone="current">Verified</TESStatusIndicator> : <Badge className="bg-amber-50 text-status-attention">Due soon</Badge>}</div>
            ))}
            <div className="rounded-lg bg-emerald-50 p-4"><div className="flex items-center justify-between"><TESStatusIndicator tone="current" size="md">Evidence Complete</TESStatusIndicator><span className="text-xs font-bold text-status-current">4 / 4</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-emerald-100"><div className="h-full w-full rounded-full bg-status-current" /></div></div>
          </div>
        </Card>
      </div>
    </div>
  )
}
