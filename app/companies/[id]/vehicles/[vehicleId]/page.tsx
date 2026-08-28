"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { 
  ArrowLeft, 
  Camera, 
  FileText, 
  Settings2, 
  Wrench, 
  ScrollText, 
  FileBadge 
} from "lucide-react"

// --- ENUMS & CONSTANTS ---
const EQUIPMENT_TYPES = ['Tractor', 'Trailer', 'Converter Dolly']
const OPERATING_REGIONS = ['Canada', 'US', 'Cross Border']
const OWNERSHIP_TYPES = ['Owned', 'Financed', 'Leased', 'Owner Operator']
const PERMIT_TYPES = [
  'New Mexico - Permit', 'Arber', 'Clean Truck Check', 'Crossing Fee - Annual Transponder',
  'Crossing Fee - Single', 'Fuel Permit', 'Idaho DG Registration', 'Kentucky',
  'New York - HUT', 'Oregon', 'Oregon Temp Pass', 'Trip Permit', 'Axle Lift'
]

export default function VehicleDetailsPage() {
  const router = useRouter()
  const params = useParams()
  
  // Extract route parameters for API calls or routing
  const companyId = params.id
  const vehicleId = params.vehicleId

  const [activeTab, setActiveTab] = useState('Profile')

  const tabs = [
    { name: 'Profile', icon: <FileText className="w-4 h-4 mr-2" /> },
    { name: 'Documents', icon: <ScrollText className="w-4 h-4 mr-2" /> },
    { name: 'Registration', icon: <FileBadge className="w-4 h-4 mr-2" /> },
    { name: 'Permits', icon: <FileBadge className="w-4 h-4 mr-2" /> },
    { name: 'Maintenance', icon: <Wrench className="w-4 h-4 mr-2" /> },
    { name: 'Settings', icon: <Settings2 className="w-4 h-4 mr-2" /> }
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      {/* Header & Back Navigation */}
      <div className="mb-6 flex items-center space-x-4">
        <button 
          onClick={() => router.push(`/companies/${companyId}/vehicles`)}
          className="p-2 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-100 transition"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Vehicle Profile: {vehicleId}</h1>
          <p className="text-sm text-gray-500">Manage compliance, logs, and configurations</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 mb-6 bg-white rounded-t-lg px-2 pt-2">
        <nav className="-mb-px flex space-x-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.name}
              onClick={() => setActiveTab(tab.name)}
              className={`flex items-center whitespace-nowrap py-4 px-3 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.name
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.icon}
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content Rendering */}
      <div className="bg-white p-6 shadow-sm rounded-b-lg border border-gray-200">
        {activeTab === 'Profile' && <ProfileTab />}
        {activeTab === 'Documents' && <DocumentsTab />}
        {activeTab === 'Registration' && <RegistrationTab />}
        {activeTab === 'Permits' && <PermitsTab />}
        {activeTab === 'Maintenance' && <div className="p-4 text-gray-500">Maintenance module loading...</div>}
        {activeTab === 'Settings' && <div className="p-4 text-gray-500">Settings module loading...</div>}
      </div>
    </div>
  )
}

// --- TAB COMPONENTS ---

function ProfileTab() {
  const [equipmentType, setEquipmentType] = useState('Tractor')

  return (
    <div className="space-y-6 flex flex-col">
      <div className="flex justify-end">
        <button className="flex items-center bg-purple-600 text-white px-4 py-2 rounded-md shadow hover:bg-purple-700 transition">
          <Camera className="w-4 h-4 mr-2" /> Upload Registration (OCR)
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <InputField label="Record ID" disabled />
        <SelectField label="Record Type" options={EQUIPMENT_TYPES} value={equipmentType} onChange={(e) => setEquipmentType(e.target.value)} />
        <SelectField label="Status" options={['Active', 'Inactive']} />
        <InputField label="Equipment Number" />
        <InputField label="VIN" />
        <InputField label="Year" type="number" />
        <InputField label="Make" />
        <InputField label="Model" />
        <InputField label="Color" />
        <SelectField label="Operating Region" options={OPERATING_REGIONS} />
        <InputField label="Equipment Axle" type="number" />
        <InputField label="License Plate" />
      </div>

      <hr className="my-6 border-gray-200" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <InputField label="Start Date" type="date" />
        <InputField label="End Date" type="date" />
        <InputField label="Tare Weight (kgs)" type="number" />
        <SelectField label="Fuel Type" options={['Diesel', 'Electric', 'Gasoline', 'None']} />
        <InputField label="Equipment Length" />
        <InputField label="GPS Provider" />
        {equipmentType === 'Tractor' && (
          <InputField label="Transponder No" />
        )}
      </div>
    </div>
  )
}

function DocumentsTab() {
  const [ownership, setOwnership] = useState('Owned')

  return (
    <div className="space-y-6 flex flex-col">
      <div className="flex justify-end">
        <button className="flex items-center bg-purple-600 text-white px-4 py-2 rounded-md shadow hover:bg-purple-700 transition">
          <Camera className="w-4 h-4 mr-2" /> Upload Document (OCR)
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <InputField label="Record ID" disabled />
        <SelectField label="Owner" options={OWNERSHIP_TYPES} value={ownership} onChange={(e) => setOwnership(e.target.value)} />
        
        {(ownership === 'Leased' || ownership === 'Owner Operator') && (
          <InputField label="Company" />
        )}
        
        <InputField label="Purchase Date" type="date" />
        <InputField label="Purchase Price" type="number" />
        
        {ownership === 'Leased' && (
          <>
            <InputField label="Lease Term (months)" type="number" />
            <InputField label="End Date (Auto-calculated)" type="date" disabled />
          </>
        )}
      </div>

      <hr className="my-6 border-gray-200" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
        <InputField label="Owner Company" />
        <button className="bg-gray-100 text-gray-800 border border-gray-300 px-4 py-2 rounded-md shadow-sm hover:bg-gray-200 transition w-max">
          + Add Owner
        </button>
      </div>
    </div>
  )
}

function RegistrationTab() {
  const [isTrailer, setIsTrailer] = useState(false)

  return (
    <div className="space-y-6 flex flex-col">
      <div className="flex justify-end">
        <button className="flex items-center bg-purple-600 text-white px-4 py-2 rounded-md shadow hover:bg-purple-700 transition">
          <Camera className="w-4 h-4 mr-2" /> Upload Registration {isTrailer ? '' : '& Cab Card'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <InputField label="Record ID" disabled />
        <SelectField label="Registration Type" options={['Base Plate', 'IRP']} />
        <InputField label="State / Province" />
        <InputField label="Start Date" type="date" />
        
        {isTrailer ? (
          <InputField label="Expiry Date" value="Continuous" disabled />
        ) : (
          <InputField label="Expiry Date" type="date" />
        )}
        
        <InputField label="Plate" />
      </div>
    </div>
  )
}

function PermitsTab() {
  return (
    <div className="space-y-6 flex flex-col">
      <div className="flex justify-end">
        <button className="flex items-center bg-purple-600 text-white px-4 py-2 rounded-md shadow hover:bg-purple-700 transition">
          <Camera className="w-4 h-4 mr-2" /> Upload Permit (OCR)
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <InputField label="Record ID" disabled />
        <InputField label="Permit ID" />
        <SelectField label="Type" options={PERMIT_TYPES} />
        <InputField label="State / Province" />
        <InputField label="Start Date" type="date" />
        <InputField label="Expiry Date" type="date" />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea className="w-full border border-gray-300 rounded-md p-2 focus:ring-purple-500 focus:border-purple-500" rows={4}></textarea>
      </div>
    </div>
  )
}

// --- REUSABLE UI HELPERS ---

function InputField({ label, type = 'text', disabled = false, value, onChange }: any) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        disabled={disabled}
        value={value}
        onChange={onChange}
        className={`w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-purple-500 ${disabled ? 'bg-gray-100 cursor-not-allowed text-gray-500' : 'bg-white'}`}
      />
    </div>
  )
}

function SelectField({ label, options, value, onChange }: any) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select 
        value={value} 
        onChange={onChange}
        className="w-full border border-gray-300 rounded-md p-2 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
      >
        {options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  )
}
