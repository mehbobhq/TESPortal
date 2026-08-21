"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, File, FileText, Save, Upload, X } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"

const COMPANY_TYPES = [
  "Customer",
  "Insurance Broker",
  "Insurance Company",
  "Government Agency",
  "Employer Reference",
  "Service Provider",
  "Owner Operator",
  "Sub Contractor",
  "Workers Insurance",
  "Finance/Leasing Company",
  "Company (Prospect/Lead)",
  "Other"
]

export default function AddCompanyPage() {
  const router = useRouter()
  
  const [selectedType, setSelectedType] = useState<string>("")
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [recordId, setRecordId] = useState("CMP-00001") 
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])

  // Auto-increment the Record ID based on saved local storage records
  useEffect(() => {
    const existing = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const nextNum = existing.length + 1
    setRecordId(`CMP-${String(nextNum).padStart(5, '0')}`)
  }, [])

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value.toLowerCase() === "progressive") {
      setDuplicateWarning("A similar company exists: Progressive Inc. Are you sure you want to proceed?")
    } else {
      setDuplicateWarning(null)
    }
  }

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setUploadedFiles(prev => [...prev, ...Array.from(e.target.files!)])
    }
  }

  // Remove a selected file
  const removeFile = (indexToRemove: number) => {
    setUploadedFiles(prev => prev.filter((_, index) => index !== indexToRemove))
  }

  // Handle saving the record to Local Storage for testing persistence
  const handleCreateCompany = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault() 
    
    if (!selectedType) {
      alert("Please select a Company Type before saving.")
      return
    }

    const formData = new FormData(e.currentTarget)
    
    // Create the record object
    const newCompany = {
      id: recordId,
      name: formData.get("companyName") as string,
      kind: selectedType,
      contact: (formData.get("contactPerson") as string) || "N/A",
      region: (formData.get("opRegion") as string) || "N/A",
      status: (formData.get("status") as string) || "Active",
      tone: "ok", 
      createdAt: new Date().toISOString()
    }

    // 1. Save to Master Companies List
    const existingCompanies = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    localStorage.setItem("tes_companies", JSON.stringify([newCompany, ...existingCompanies]))
    
    // 2. If it's a Customer, ALSO save to the Customers List
    if (selectedType === "Customer") {
      const existingCustomers = JSON.parse(localStorage.getItem("tes_customers") || "[]")
      localStorage.setItem("tes_customers", JSON.stringify([newCompany, ...existingCustomers]))
    }
    
    // Force a hard reload so the directory reads the fresh Local Storage data
    window.location.href = "/companies" 
  }

  // Reusable Address Block to keep code clean and manage mandatory flags + special styling
  const renderAddressCard = (title: string, prefix: string, description?: string, isMandatory: boolean = false, isSpecial: boolean = false) => (
    <Card className={isSpecial ? "border-primary/50 bg-primary/5" : ""}>
      <CardHeader>
        <CardTitle className={isSpecial ? "text-primary" : ""}>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${prefix}-street`} required={isMandatory}>Street Address</FieldLabel>
            <Input id={`${prefix}-street`} name={`${prefix}_street`} placeholder="123 Main St" required={isMandatory} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${prefix}-city`} required={isMandatory}>City</FieldLabel>
              <Input id={`${prefix}-city`} name={`${prefix}_city`} placeholder="City" required={isMandatory} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${prefix}-state`} required={isMandatory}>State / Province</FieldLabel>
              <Input id={`${prefix}-state`} name={`${prefix}_state`} placeholder="State or Province" required={isMandatory} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${prefix}-zip`} required={isMandatory}>Postal / ZIP Code</FieldLabel>
              <Input id={`${prefix}-zip`} name={`${prefix}_zip`} placeholder="Postal Code" required={isMandatory} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${prefix}-country`} required={isMandatory}>Country</FieldLabel>
              <Select name={`${prefix}_country`} required={isMandatory}>
                <SelectTrigger id={`${prefix}-country`}>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CA">Canada</SelectItem>
                  <SelectItem value="US">United States</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  )

  return (
    <form onSubmit={handleCreateCompany} className="pb-10">
      <PageHeader
        title="Add Company"
        description="Create a new entity record in the master directory."
        actions={
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {duplicateWarning && (
            <Alert variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">
              <AlertCircle className="size-4" />
              <AlertTitle>Potential Duplicate Detected</AlertTitle>
              <AlertDescription>{duplicateWarning}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Core Information</CardTitle>
              <CardDescription>Mandatory details and entity classification.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="recordId">Record ID</FieldLabel>
                    <Input id="recordId" value={recordId} disabled className="bg-muted font-mono" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="dateAdded">Date Added</FieldLabel>
                    <Input id="dateAdded" value={new Date().toISOString().split('T')[0]} disabled className="bg-muted" />
                  </Field>
                </div>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="companyName" required>Company Name</FieldLabel>
                    <Input id="companyName" name="companyName" placeholder="Legal entity name" onChange={handleNameChange} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="dba">DBA (Doing Business As)</FieldLabel>
                    <Input id="dba" name="dba" placeholder="Optional DBA name" />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="companyType" required>Company Type</FieldLabel>
                    <Select onValueChange={setSelectedType} name="companyType" required>
                      <SelectTrigger id="companyType">
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {COMPANY_TYPES.map(type => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="status" required>Status</FieldLabel>
                    <Select defaultValue="Active" name="status" required>
                      <SelectTrigger id="status">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          {/* Conditional Type-Specific Fields */}
          {selectedType && (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-primary">{selectedType} Details</CardTitle>
                <CardDescription>Specific requirements and data points for this entity type.</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  {/* --- CUSTOMER FIELDS --- */}
                  {selectedType === "Customer" && (
                    <div className="flex flex-col">
                      
                      {/* Mandatory Customer Fields grouped in rows */}
                      <div className="grid gap-4 sm:grid-cols-2 mb-4">
                        <Field>
                          <FieldLabel htmlFor="opRegion" required>Operating Region</FieldLabel>
                          <Select name="opRegion" required>
                            <SelectTrigger id="opRegion"><SelectValue placeholder="Select region" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="US Only">US Only</SelectItem>
                              <SelectItem value="Canada Only">Canada Only</SelectItem>
                              <SelectItem value="Cross-Border">Cross-Border</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="svcType" required>Service Type</FieldLabel>
                          <Select defaultValue="Basic" name="svcType" required>
                            <SelectTrigger id="svcType"><SelectValue placeholder="Select service type" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Basic">Basic</SelectItem>
                              <SelectItem value="Per Service">Per Service</SelectItem>
                              <SelectItem value="Premium">Premium</SelectItem>
                              <SelectItem value="Standard">Standard</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2 mb-4">
                        <Field>
                          <FieldLabel htmlFor="payMethod" required>Payment Method</FieldLabel>
                          <Select name="payMethod" required>
                            <SelectTrigger id="payMethod"><SelectValue placeholder="Select payment method" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Credit Card">Credit Card</SelectItem>
                              <SelectItem value="Digital Wallets">Digital Wallets</SelectItem>
                              <SelectItem value="E-Transfer">E-Transfer</SelectItem>
                              <SelectItem value="ACH/Wire Transfer">ACH/Wire Transfer</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="cargoInfo">Cargo Information</FieldLabel>
                          <Select name="cargoInfo">
                            <SelectTrigger id="cargoInfo"><SelectValue placeholder="Select cargo type" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="General Freight">General Freight</SelectItem>
                              <SelectItem value="Specialized Equipment">Specialized Equipment</SelectItem>
                              <SelectItem value="Household Goods">Household Goods</SelectItem>
                              <SelectItem value="Temperature-Controlled & Food">Temperature-Controlled & Food</SelectItem>
                              <SelectItem value="Hazardous Materials">Hazardous Materials</SelectItem>
                              <SelectItem value="Bulk & Other">Bulk & Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="startDate" required>Start Date</FieldLabel>
                          <Input id="startDate" name="startDate" type="date" required />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="endDate">End Date</FieldLabel>
                          <Input id="endDate" name="endDate" type="date" />
                        </Field>
                      </div>

                      <Separator className="my-8 bg-primary/20" />

                      {/* Business Information Section */}
                      <div>
                        <h4 className="text-sm font-semibold text-primary mb-3">Business Information</h4>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <Field><FieldLabel>Incorporation No.</FieldLabel><Input name="incorpNo" placeholder="Number" /></Field>
                          <Field><FieldLabel>Business No.</FieldLabel><Input name="businessNo" placeholder="Number" /></Field>
                          <Field><FieldLabel>EIN</FieldLabel><Input name="ein" placeholder="EIN" /></Field>
                          <Field><FieldLabel>GST/HST</FieldLabel><Input name="gstHst" placeholder="Tax ID" /></Field>
                        </div>
                      </div>

                      <Separator className="my-8 bg-primary/20" />

                      {/* Carrier Information Section */}
                      <div>
                        <h4 className="text-sm font-semibold text-primary mb-3">Carrier Information</h4>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <Field><FieldLabel>USDOT</FieldLabel><Input name="usdot" placeholder="USDOT" /></Field>
                          <Field><FieldLabel>MC</FieldLabel><Input name="mc" placeholder="MC Number" /></Field>
                          <Field><FieldLabel>MVID/RIN</FieldLabel><Input name="mvid" placeholder="MVID/RIN" /></Field>
                          <Field><FieldLabel>NSC/CVOR</FieldLabel><Input name="nsc" placeholder="NSC/CVOR" /></Field>
                        </div>
                      </div>

                      <Separator className="my-8 bg-primary/20" />

                      {/* Accounts Section */}
                      <div>
                        <h4 className="text-sm font-semibold text-primary mb-3">Accounts</h4>
                        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
                          <Field><FieldLabel>IRP</FieldLabel><Input name="accIrp" placeholder="Account #" /></Field>
                          <Field><FieldLabel>IFTA</FieldLabel><Input name="accIfta" placeholder="Account #" /></Field>
                          <Field><FieldLabel>NY HUT</FieldLabel><Input name="accNyhut" placeholder="Account #" /></Field>
                          <Field><FieldLabel>NM WDT</FieldLabel><Input name="accNm" placeholder="Account #" /></Field>
                          <Field><FieldLabel>KYU</FieldLabel><Input name="accKyu" placeholder="Account #" /></Field>
                          <Field><FieldLabel>OR</FieldLabel><Input name="accOr" placeholder="Account #" /></Field>
                          <Field><FieldLabel>CT DRS</FieldLabel><Input name="accCt" placeholder="Account #" /></Field>
                        </div>
                      </div>

                      <Separator className="my-8 bg-primary/20" />

                      {/* Customs Information Section */}
                      <div>
                        <h4 className="text-sm font-semibold text-primary mb-3">Customs Information</h4>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field><FieldLabel>SCAC</FieldLabel><Input name="scac" placeholder="SCAC Code" /></Field>
                          <Field><FieldLabel>Carrier Code</FieldLabel><Input name="carrierCode" placeholder="Carrier Code" /></Field>
                        </div>
                      </div>

                      <Separator className="my-8 bg-primary/20" />

                      {/* Fleet Information Section */}
                      <div>
                        <h4 className="text-sm font-semibold text-primary mb-3">Fleet Information</h4>
                        <div className="grid gap-4 sm:grid-cols-3">
                          <Field><FieldLabel>GPS/ELD Provider</FieldLabel><Input name="gpsProvider" placeholder="Provider" /></Field>
                          <Field><FieldLabel>Fuel Provider</FieldLabel><Input name="fuelProvider" placeholder="Provider" /></Field>
                          <Field><FieldLabel>Assessment Date</FieldLabel><Input name="assessmentDate" type="date" /></Field>
                        </div>
                      </div>

                    </div>
                  )}

                  {/* --- OTHER ENTITY TYPES (Retained Original Structure) --- */}
                  {selectedType === "Insurance Broker" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field><FieldLabel htmlFor="brokerLicense">Broker License Number</FieldLabel><Input id="brokerLicense" placeholder="License #" /></Field>
                      <Field><FieldLabel htmlFor="regulator">Regulator</FieldLabel><Input id="regulator" placeholder="e.g., FSRA" /></Field>
                    </div>
                  )}
                  {selectedType === "Insurance Company" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field><FieldLabel htmlFor="underwriterLicense">Underwriter License Number</FieldLabel><Input id="underwriterLicense" placeholder="License #" /></Field>
                      <Field><FieldLabel htmlFor="financialRating">Financial Rating</FieldLabel><Input id="financialRating" placeholder="e.g., A.M. Best A+" /></Field>
                    </div>
                  )}
                  {selectedType === "Government Agency" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field><FieldLabel htmlFor="jurisdiction">Jurisdiction</FieldLabel><Input id="jurisdiction" placeholder="e.g., Ontario, Federal US" /></Field>
                      <Field><FieldLabel htmlFor="agencyCode">Agency Code</FieldLabel><Input id="agencyCode" placeholder="e.g., FMCSA, CBP" /></Field>
                    </div>
                  )}
                  {selectedType === "Employer Reference" && (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field><FieldLabel htmlFor="prevCompany">Previous Company</FieldLabel><Input id="prevCompany" placeholder="Name" /></Field>
                      <Field><FieldLabel htmlFor="refContact">Contact Person</FieldLabel><Input id="refContact" placeholder="Name" /></Field>
                      <Field><FieldLabel htmlFor="yearsEmployed">Years Employed</FieldLabel><Input id="yearsEmployed" type="number" placeholder="e.g., 3" /></Field>
                    </div>
                  )}
                  {selectedType === "Service Provider" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field><FieldLabel htmlFor="spType">Service Type</FieldLabel><Input id="spType" placeholder="e.g., DOT Clinic, Repair Shop" /></Field>
                      <Field><FieldLabel htmlFor="spSpecialization">Specialization</FieldLabel><Input id="spSpecialization" placeholder="Area of expertise" /></Field>
                    </div>
                  )}
                  {selectedType === "Owner Operator" && (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field><FieldLabel htmlFor="ownerName">Owner Name</FieldLabel><Input id="ownerName" placeholder="Full name" /></Field>
                      <Field><FieldLabel htmlFor="vehicleCount">Vehicle Count</FieldLabel><Input id="vehicleCount" type="number" placeholder="0" /></Field>
                      <Field><FieldLabel htmlFor="leaseAgreement">Lease Agreement</FieldLabel><Input id="leaseAgreement" placeholder="Agreement ID" /></Field>
                    </div>
                  )}
                  {selectedType === "Sub Contractor" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field><FieldLabel htmlFor="contractStart">Contract Start Date</FieldLabel><Input id="contractStart" type="date" /></Field>
                      <Field><FieldLabel htmlFor="contractEnd">Contract End Date</FieldLabel><Input id="contractEnd" type="date" /></Field>
                      <Field className="sm:col-span-2"><FieldLabel htmlFor="scopeWork">Scope of Work</FieldLabel><Textarea id="scopeWork" placeholder="Brief description of duties..." /></Field>
                    </div>
                  )}
                  {selectedType === "Workers Insurance" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field><FieldLabel htmlFor="policyNum">Policy Number</FieldLabel><Input id="policyNum" placeholder="Policy #" /></Field>
                      <Field><FieldLabel htmlFor="stateFund">State Fund (if applicable)</FieldLabel><Input id="stateFund" placeholder="Fund name" /></Field>
                      <Field className="sm:col-span-2"><FieldLabel htmlFor="coverageDetails">Coverage Details</FieldLabel><Textarea id="coverageDetails" placeholder="Limits and specifics..." /></Field>
                    </div>
                  )}
                  {selectedType === "Finance/Leasing Company" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field><FieldLabel htmlFor="accNum">Account Number</FieldLabel><Input id="accNum" placeholder="Account #" /></Field>
                      <Field><FieldLabel htmlFor="leaseTerms">Lease Terms</FieldLabel><Input id="leaseTerms" placeholder="e.g., 48 months" /></Field>
                    </div>
                  )}
                  {selectedType === "Company (Prospect/Lead)" && (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field><FieldLabel htmlFor="leadSource">Lead Source</FieldLabel><Input id="leadSource" placeholder="e.g., Trade Show" /></Field>
                      <Field><FieldLabel htmlFor="followUp">Follow-Up Date</FieldLabel><Input id="followUp" type="date" /></Field>
                      <Field>
                        <FieldLabel htmlFor="priority">Priority</FieldLabel>
                        <Select>
                          <SelectTrigger id="priority"><SelectValue placeholder="Select..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="High">High</SelectItem>
                            <SelectItem value="Medium">Medium</SelectItem>
                            <SelectItem value="Low">Low</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  )}
                </FieldGroup>
              </CardContent>
            </Card>
          )}

          {/* Addresses */}
          {renderAddressCard("Registered Address", "reg", "Primary legal address.", true, false)}

          {selectedType === "Customer" && (
            <>
              {renderAddressCard("Mailing Address", "mail", "Where physical mail should be sent (if different).", false, true)}
              {renderAddressCard("Yard Address", "yard", "Physical location of fleet/equipment.", false, true)}
            </>
          )}

        </div>

        {/* Sidebar Column */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact Details</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="contactPerson">Primary Contact Person</FieldLabel>
                  <Input id="contactPerson" name="contactPerson" placeholder="Full name" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input id="email" name="email" type="email" placeholder="company@example.com" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="billingEmail">Billing Email</FieldLabel>
                  <Input id="billingEmail" name="billingEmail" type="email" placeholder="billing@example.com" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="phone">Phone</FieldLabel>
                  <Input id="phone" name="phone" type="tel" placeholder="+1 (555) 000-0000" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="website">Website</FieldLabel>
                  <Input id="website" name="website" type="url" placeholder="https://www.example.com" />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>Upload contracts, certificates, or agreements.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              
              {/* Working Upload Area */}
              <label htmlFor="file-upload" className="flex items-center justify-center rounded-lg border border-dashed p-6 hover:bg-muted/50 transition-colors cursor-pointer group">
                <input 
                  id="file-upload" 
                  type="file" 
                  multiple 
                  className="hidden" 
                  onChange={handleFileChange}
                />
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full group-hover:scale-110 transition-transform">
                    <Upload className="size-5" />
                  </span>
                  <div className="text-sm">
                    <span className="text-primary font-medium group-hover:underline">Click to upload</span>
                    <span className="text-muted-foreground"> or drag and drop</span>
                  </div>
                  <p className="text-muted-foreground text-xs">PDF, DOCX up to 10MB</p>
                </div>
              </label>

              {/* Uploaded Files State */}
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Recent Uploads</p>
                
                {uploadedFiles.length === 0 ? (
                  // Empty State
                  <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm text-muted-foreground bg-muted/50">
                    <FileText className="size-4 opacity-50" />
                    <span>No documents uploaded yet.</span>
                  </div>
                ) : (
                  // File List State
                  <div className="flex flex-col gap-2">
                    {uploadedFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm bg-background">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <File className="size-4 text-primary shrink-0" />
                          <span className="truncate font-medium">{file.name}</span>
                        </div>
                        <button 
                          type="button" 
                          onClick={() => removeFile(idx)}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Internal Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea name="notes" placeholder="Add any operational notes, payment quirks, or general information here..." className="min-h-[120px]" />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="bg-background/80 supports-[backdrop-filter]:bg-background/60 border-t sticky bottom-0 z-10 -mx-6 mt-6 flex items-center justify-end gap-4 px-6 py-4 backdrop-blur">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit">
          <Save data-icon="inline-start" className="mr-2 size-4" />
          Create Company
        </Button>
      </div>
    </form>
  )
}
