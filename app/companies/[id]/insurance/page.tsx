"use client"

import { useState } from "react"
import { useParams } from "next/navigation" // <-- Add this import
import { FileText, Plus, ShieldCheck, FileKey2, HardHat, Truck } from "lucide-react"
// ... rest of your imports

export default function InsurancePage() {
  const params = useParams()
  const companyId = params.id // This will equal "CMP-33889" based on your screenshot!

  // Empty states for dev environment
  const [transPolicies, setTransPolicies] = useState<TransInsurance[]>([])
  // ... rest of your code
