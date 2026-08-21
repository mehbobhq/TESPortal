"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Save, Building2 } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function EditCompanyPage() {
  const params = useParams()
  const router = useRouter()
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const id = params.id as string
    const savedCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const found = savedCompanies.find((c: any) => c.id === id)
    setCompany(found || null)
    setLoading(false)
  }, [params.id])

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    const formData = new FormData(e.currentTarget)
    const formEntries = Object.fromEntries(formData.entries())
    
    // Merge new form data with the existing company data
    const updatedCompany = {
      ...company,
      ...formEntries,
      name: formEntries.companyName, // Mapping back to our master key
    }

    // 1. Update Master Companies List
    const existingCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const updatedCompaniesList = existingCompanies.map((c: any) => 
      c.id === company.id ? updatedCompany : c
    )
    localStorage.setItem("tes_companies", JSON.stringify(updatedCompaniesList))
    
    // 2. Update Customers List (if applicable)
    if (company.kind === "Customer") {
      const existingCustomers = JSON.parse(localStorage.getItem("tes_customers") || "[]")
      const updatedCustomersList = existingCustomers.map((c: any) => 
        c.id === company.id ? updatedCompany : c
      )
      localStorage.setItem("tes_customers", JSON.stringify(updatedCustomersList))
    }
    
    // Route back to the profile page to see the changes
    router.push(`/companies/${company.id}/profile`)
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company not found.</div>

  return (
    <div className="pb-10 flex flex-col gap-6">
      <PageHeader
        title={`Edit: ${company.name}`}
        description="Update company records and information."
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 size-4" /> Cancel
          </Button>
        }
      />

      <form onSubmit={handleUpdate} className="flex flex-col gap-6 max-w-4xl">
        
        <Card>
          <CardHeader className="bg-muted/30 py-3 border-b">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground"/> 
              Core Information
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
            
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input 
                id="companyName" 
                name="companyName" 
                defaultValue={company.name} 
                required 
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dba">DBA</Label>
              <Input 
                id="dba" 
                name="dba" 
                defaultValue={company.dba} 
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPerson">Primary Contact</Label>
              <Input 
                id="contactPerson" 
                name="contactPerson" 
                defaultValue={company.contact} 
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input 
                id="phone" 
                name="phone" 
                defaultValue={company.phone} 
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Account Email</Label>
              <Input 
                id="email" 
                name="email" 
                type="email"
                defaultValue={company.email} 
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="opRegion">Operating Region</Label>
              <Input 
                id="opRegion" 
                name="opRegion" 
                defaultValue={company.region} 
              />
            </div>

          </CardContent>
        </Card>

        {/* You can add more cards here for Address, Tax, Carrier matching the input names from your 'Add Company' form! */}

        <div className="flex justify-end gap-4 mt-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Discard Changes
          </Button>
          <Button type="submit">
            <Save className="mr-2 size-4" />
            Save Updates
          </Button>
        </div>
      </form>
    </div>
  )
}
