"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Camera, FileText, Settings2, Wrench, ScrollText, FileBadge } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card } from "@/components/ui/card"

const EQUIPMENT_TYPES = ['Tractor', 'Trailer', 'Converter Dolly']
const OPERATING_REGIONS = ['Canada', 'US', 'Cross Border']
const OWNERSHIP_TYPES = ['Owned', 'Financed', 'Leased', 'Owner Operator']
const PERMIT_TYPES = ['New Mexico - Permit', 'Clean Truck Check', 'Fuel Permit', 'Trip Permit', 'Over-Dimensional Permit']

export default function VehicleDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const companyId = params.id as string
  const vehicleId = params.vehicleId as string

  return (
    <div className="p-6 max-w-7xl mx-auto bg-background min-h-screen">
      {/* Header & Back Navigation */}
      <div className="mb-6 flex items-center space-x-4">
        <Button 
          variant="outline" 
          size="icon"
          onClick={() => router.push(`/companies/${companyId}/vehicles`)}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vehicle Profile: {vehicleId}</h1>
          <p className="text-sm text-muted-foreground">Manage cross-border compliance, fuel entries, and logs</p>
        </div>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-6 h-auto p-1 bg-muted/50 rounded-lg mb-6">
          <TabsTrigger value="profile" className="py-2.5"><FileText className="w-4 h-4 mr-2" />Profile</TabsTrigger>
          <TabsTrigger value="documents" className="py-2.5"><ScrollText className="w-4 h-4 mr-2" />Documents</TabsTrigger>
          <TabsTrigger value="registration" className="py-2.5"><FileBadge className="w-4 h-4 mr-2" />Registration</TabsTrigger>
          <TabsTrigger value="permits" className="py-2.5"><FileBadge className="w-4 h-4 mr-2" />Permits</TabsTrigger>
          <TabsTrigger value="maintenance" className="py-2.5"><Wrench className="w-4 h-4 mr-2" />Maintenance</TabsTrigger>
          <TabsTrigger value="settings" className="py-2.5"><Settings2 className="w-4 h-4 mr-2" />Settings</TabsTrigger>
        </TabsList>

        <Card className="p-6 shadow-sm border-border">
          <TabsContent value="profile" className="mt-0 outline-none"><ProfileTab /></TabsContent>
          <TabsContent value="documents" className="mt-0 outline-none"><DocumentsTab /></TabsContent>
          <TabsContent value="registration" className="mt-0 outline-none"><RegistrationTab /></TabsContent>
          <TabsContent value="permits" className="mt-0 outline-none"><PermitsTab /></TabsContent>
          <TabsContent value="maintenance" className="mt-0 outline-none"><p className="text-muted-foreground text-sm">Maintenance module loading...</p></TabsContent>
          <TabsContent value="settings" className="mt-0 outline-none"><p className="text-muted-foreground text-sm">Settings module loading...</p></TabsContent>
        </Card>
      </Tabs>
    </div>
  )
}

// --- TAB COMPONENTS ---

function ProfileTab() {
  const [equipmentType, setEquipmentType] = useState('Tractor')

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button className="shadow-sm">
          <Camera className="w-4 h-4 mr-2" /> Upload Registration (OCR)
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <FieldGroup label="Record ID"><Input disabled value="AUTO-GEN-123" /></FieldGroup>
        <FieldGroup label="Record Type">
          <SelectWrapper options={EQUIPMENT_TYPES} value={equipmentType} onChange={setEquipmentType} />
        </FieldGroup>
        <FieldGroup label="Status">
          <SelectWrapper options={['Active', 'Inactive']} value="Active" onChange={()=>{}} />
        </FieldGroup>
        <FieldGroup label="Equipment Number"><Input placeholder="e.g. Unit 101" /></FieldGroup>
        <FieldGroup label="VIN"><Input placeholder="17-character VIN" /></FieldGroup>
        <FieldGroup label="Year"><Input type="number" placeholder="2024" /></FieldGroup>
        <FieldGroup label="Make"><Input placeholder="e.g. Freightliner" /></FieldGroup>
        <FieldGroup label="Model"><Input placeholder="e.g. Cascadia" /></FieldGroup>
        <FieldGroup label="Color"><Input placeholder="White" /></FieldGroup>
        <FieldGroup label="Operating Region">
          <SelectWrapper options={OPERATING_REGIONS} value="Cross Border" onChange={()=>{}} />
        </FieldGroup>
        <FieldGroup label="Equipment Axle"><Input type="number" /></FieldGroup>
        <FieldGroup label="License Plate"><Input /></FieldGroup>
      </div>

      <hr className="my-6 border-border" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <FieldGroup label="Start Date"><Input type="date" /></FieldGroup>
        <FieldGroup label="End Date"><Input type="date" /></FieldGroup>
        <FieldGroup label="Tare Weight (kgs)"><Input type="number" /></FieldGroup>
        <FieldGroup label="Fuel Type">
          <SelectWrapper options={['Diesel', 'Electric', 'Gasoline', 'None']} value="Diesel" onChange={()=>{}} />
        </FieldGroup>
        <FieldGroup label="Equipment Length"><Input /></FieldGroup>
        <FieldGroup label="GPS Provider"><Input /></FieldGroup>
        {equipmentType === 'Tractor' && <FieldGroup label="Transponder No"><Input /></FieldGroup>}
      </div>
    </div>
  )
}

function DocumentsTab() {
  const [ownership, setOwnership] = useState('Owned')

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button className="shadow-sm">
          <Camera className="w-4 h-4 mr-2" /> Upload Document (OCR)
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <FieldGroup label="Record ID"><Input disabled value="AUTO-GEN-123" /></FieldGroup>
        <FieldGroup label="Owner">
          <SelectWrapper options={OWNERSHIP_TYPES} value={ownership} onChange={setOwnership} />
        </FieldGroup>
        
        {(ownership === 'Leased' || ownership === 'Owner Operator') && (
          <FieldGroup label="Company"><Input /></FieldGroup>
        )}
        
        <FieldGroup label="Purchase Date"><Input type="date" /></FieldGroup>
        <FieldGroup label="Purchase Price"><Input type="number" /></FieldGroup>
        
        {ownership === 'Leased' && (
          <>
            <FieldGroup label="Lease Term (months)"><Input type="number" /></FieldGroup>
            <FieldGroup label="End Date (Auto-calculated)"><Input type="date" disabled /></FieldGroup>
          </>
        )}
      </div>

      <hr className="my-6 border-border" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
        <FieldGroup label="Owner Company"><Input /></FieldGroup>
        <Button variant="secondary" className="w-max shadow-sm border border-input">+ Add Owner</Button>
      </div>
    </div>
  )
}

function RegistrationTab() {
  const [isTrailer, setIsTrailer] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button className="shadow-sm">
          <Camera className="w-4 h-4 mr-2" /> Upload Registration {isTrailer ? '' : '& Cab Card'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <FieldGroup label="Record ID"><Input disabled value="AUTO-GEN-123" /></FieldGroup>
        <FieldGroup label="Registration Type">
          <SelectWrapper options={['Base Plate', 'IRP']} value="Base Plate" onChange={()=>{}} />
        </FieldGroup>
        <FieldGroup label="State / Province"><Input /></FieldGroup>
        <FieldGroup label="Start Date"><Input type="date" /></FieldGroup>
        <FieldGroup label="Expiry Date">
          <Input type={isTrailer ? "text" : "date"} value={isTrailer ? "Continuous" : undefined} disabled={isTrailer} />
        </FieldGroup>
        <FieldGroup label="Plate"><Input /></FieldGroup>
      </div>
    </div>
  )
}

function PermitsTab() {
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button className="shadow-sm">
          <Camera className="w-4 h-4 mr-2" /> Upload Permit (OCR)
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <FieldGroup label="Record ID"><Input disabled value="AUTO-GEN-123" /></FieldGroup>
        <FieldGroup label="Permit ID"><Input /></FieldGroup>
        <FieldGroup label="Type">
          <SelectWrapper options={PERMIT_TYPES} value={PERMIT_TYPES[0]} onChange={()=>{}} />
        </FieldGroup>
        <FieldGroup label="State / Province"><Input /></FieldGroup>
        <FieldGroup label="Start Date"><Input type="date" /></FieldGroup>
        <FieldGroup label="Expiry Date"><Input type="date" /></FieldGroup>
      </div>
      
      <div>
        <Label className="mb-2 block">Notes</Label>
        <textarea 
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
          rows={4}
        />
      </div>
    </div>
  )
}

// --- REUSABLE UI HELPERS ---

function FieldGroup({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

// Fallback HTML Select styled exactly like Shadcn to avoid specific Radix import clashes
function SelectWrapper({ options, value, onChange }: { options: string[], value: string, onChange: (val: string) => void }) {
  return (
    <select 
      value={value} 
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {options.map((opt) => <option key={opt} value={opt} className="bg-background text-foreground">{opt}</option>)}
    </select>
  )
}
