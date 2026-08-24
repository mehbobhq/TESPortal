"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Save, ShieldCheck, Briefcase, Truck, Globe, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

// Reusable Setting Row Component for clean consistency
const SettingToggle = ({ id, label, description, defaultChecked = false }: { id: string, label: string, description: string, defaultChecked?: boolean }) => (
  <div className="flex items-center justify-between py-3">
    <div className="space-y-0.5 pr-6">
      <Label htmlFor={id} className="text-sm font-medium cursor-pointer">{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
    <Switch id={id} defaultChecked={defaultChecked} />
  </div>
)

export default function SettingsPage() {
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

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <div className="p-10 text-center">Company Not Found</div>

  const handleSaveSettings = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Logic to save settings would go here
    alert("Settings successfully updated.")
  }

  return (
    <div className="flex flex-col gap-6 pb-10 max-w-[1200px]">
      
      {/* HEADER */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/companies/${company.id}/profile`)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Configuration & Settings</h1>
            <p className="text-muted-foreground text-sm">{company.name} ({company.id})</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveSettings}>
        <Tabs defaultValue="cargo" className="w-full">
          
          <TabsList className="grid grid-cols-5 w-full max-w-4xl h-auto p-1 bg-muted/50">
            <TabsTrigger value="company" className="py-2 text-xs"><Settings2 className="size-3.5 mr-1.5"/> Company</TabsTrigger>
            <TabsTrigger value="regional" className="py-2 text-xs"><Globe className="size-3.5 mr-1.5"/> Regional</TabsTrigger>
            <TabsTrigger value="cargo" className="py-2 text-xs"><Truck className="size-3.5 mr-1.5"/> Cargo</TabsTrigger>
            <TabsTrigger value="certifications" className="py-2 text-xs"><ShieldCheck className="size-3.5 mr-1.5"/> Certifications</TabsTrigger>
            <TabsTrigger value="staff" className="py-2 text-xs"><Briefcase className="size-3.5 mr-1.5"/> Staff</TabsTrigger>
          </TabsList>

          <div className="mt-6">
            
            {/* ========================================== */}
            {/* CARGO SETTINGS TAB                         */}
            {/* ========================================== */}
            <TabsContent value="cargo" className="space-y-6 m-0">
              <div className="grid md:grid-cols-2 gap-6">
                
                {/* DG / Hazmat Rules */}
                <Card>
                  <CardHeader className="bg-muted/30 py-4 border-b">
                    <CardTitle className="text-sm">Dangerous Goods (Hazmat)</CardTitle>
                    <CardDescription className="text-xs">Define operational permissions for hazardous materials.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2 divide-y">
                    <SettingToggle id="dg_ca" label="Dangerous Goods - Canada" description="Permit transport of DG within Canadian borders." defaultChecked={true} />
                    <SettingToggle id="dg_us" label="Dangerous Goods - America" description="Permit transport of DG within US borders." defaultChecked={true} />
                    <SettingToggle id="dg_wv_nv" label="Transport DG in West Virginia or Nevada" description="Enable specific routing for WV/NV DG protocols." />
                    <SettingToggle id="dg_co" label="Transport DG in Colorado" description="Enable routing for Colorado DG protocols." />
                    <SettingToggle id="dg_id" label="Transport DG in Idaho" description="Enable routing for Idaho DG protocols." />
                  </CardContent>
                </Card>

                {/* Controlled Substances & Alcohol */}
                <div className="space-y-6">
                  <Card>
                    <CardHeader className="bg-muted/30 py-4 border-b">
                      <CardTitle className="text-sm">Controlled Cargo & Tobacco</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-2 divide-y">
                      <SettingToggle id="tobacco_on" label="Transport Tobacco in Ontario" description="Enable compliance checks for Ontario tobacco permits." />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="bg-muted/30 py-4 border-b">
                      <CardTitle className="text-sm">Alcohol Transport Regulations</CardTitle>
                      <CardDescription className="text-xs">Manage state-specific alcohol transport permissions.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-2 divide-y h-[250px] overflow-y-auto pr-2">
                      <SettingToggle id="alc_us" label="Transport Alcohol in America (General)" description="Master switch for US alcohol transport." />
                      <SettingToggle id="alc_nj" label="New Jersey Alcohol Transport" description="Permit deliveries within NJ." />
                      <SettingToggle id="alc_tx" label="Texas Alcohol Transport" description="Permit deliveries within TX." />
                      <SettingToggle id="alc_ky" label="Kentucky Alcohol Transport" description="Permit deliveries within KY." />
                      <SettingToggle id="alc_in" label="Indiana Alcohol Transport" description="Permit deliveries within IN." />
                      <SettingToggle id="alc_oh" label="Ohio Alcohol Transport" description="Permit deliveries to OH facilities." />
                      <SettingToggle id="alc_ny" label="New York Alcohol Transport" description="Permit deliveries within NY." />
                    </CardContent>
                  </Card>
                </div>

              </div>
            </TabsContent>

            {/* ========================================== */}
            {/* STAFF SETTINGS TAB                         */}
            {/* ========================================== */}
            <TabsContent value="staff" className="space-y-6 m-0">
              
              {/* Hiring Thresholds (Numeric Inputs) */}
              <Card>
                <CardHeader className="bg-muted/30 py-4 border-b">
                  <CardTitle className="text-sm">Hiring Thresholds</CardTitle>
                  <CardDescription className="text-xs">Minimum requirements for onboarding operational staff.</CardDescription>
                </CardHeader>
                <CardContent className="pt-6 grid sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="minAge">Minimum Age For Drivers *</Label>
                    <Input id="minAge" type="number" defaultValue="21" className="max-w-[200px]" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="minExp">Minimum Experience For Drivers (Months) *</Label>
                    <Input id="minExp" type="number" defaultValue="24" className="max-w-[200px]" />
                  </div>
                </CardContent>
              </Card>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Vetting & Safety */}
                <Card>
                  <CardHeader className="bg-muted/30 py-4 border-b">
                    <CardTitle className="text-sm">Safety & Vetting Requirements</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-2 divide-y">
                    <SettingToggle id="req_bg" label="Background Check Required" description="Mandate criminal background checks before dispatch." defaultChecked={true} />
                    <SettingToggle id="req_road" label="Perform Annual Road Test" description="Flag drivers missing annual road test evaluations." defaultChecked={true} />
                    <SettingToggle id="req_pre_road" label="Collect Pre-Employment Road Test" description="Require test documentation during onboarding." defaultChecked={true} />
                    <SettingToggle id="req_psp" label="PSP Required" description="Mandate Pre-Employment Screening Program checks." />
                    <SettingToggle id="req_da_ca" label="Drug & Alcohol Test (Canadian Drivers)" description="Require cross-border D&A testing compliance." defaultChecked={true} />
                  </CardContent>
                </Card>

                {/* Document Collection */}
                <Card>
                  <CardHeader className="bg-muted/30 py-4 border-b">
                    <CardTitle className="text-sm">Document Collection Mandates</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-2 divide-y">
                    <SettingToggle id="doc_tax" label="Tax Documents Required" description="Block dispatch if tax/payroll docs are missing." defaultChecked={true} />
                    <SettingToggle id="doc_wp" label="Collect Staff Work Permit" description="Track work permit expirations." />
                    <SettingToggle id="doc_pr" label="Collect Permanent Resident Card" description="Track PR card status for border crossing." />
                    <SettingToggle id="doc_inc" label="Collect Staff Incorporation Documents" description="Required for Owner Operators / Subcontractors." />
                    <SettingToggle id="doc_pass" label="Collect Passports for US Drivers" description="Mandatory for cross-border dispatches." defaultChecked={true} />
                    <SettingToggle id="doc_visa" label="Collect VISA for US Drivers" description="Track VISA expiry for international personnel." />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ========================================== */}
            {/* CERTIFICATIONS TAB                         */}
            {/* ========================================== */}
            <TabsContent value="certifications" className="space-y-6 m-0">
              <Card>
                <CardHeader className="bg-muted/30 py-4 border-b">
                  <CardTitle className="text-sm">Program Memberships & Certifications</CardTitle>
                  <CardDescription className="text-xs">Select the security and environmental programs this entity is enrolled in.</CardDescription>
                </CardHeader>
                <CardContent className="pt-2 grid md:grid-cols-2 gap-x-12 gap-y-0 divide-y md:divide-y-0">
                  <div className="divide-y">
                    <SettingToggle id="cert_ctpat" label="Member of CTPAT?" description="Customs-Trade Partnership Against Terrorism." />
                    <SettingToggle id="cert_fast" label="Member of FAST?" description="Free and Secure Trade for Commercial Vehicles." />
                    <SettingToggle id="cert_pip" label="Member of PIP?" description="Partners in Protection (Canada)." />
                    <SettingToggle id="cert_csa" label="Member of CSA?" description="Customs Self Assessment program." />
                  </div>
                  <div className="divide-y">
                    <SettingToggle id="cert_smartway" label="Member of SmartWay?" description="EPA environmental tracking program." />
                    <SettingToggle id="cert_cor" label="Member of COR?" description="Certificate of Recognition (Safety)." />
                    <SettingToggle id="cert_pic" label="Member of PIC Program?" description="Partners in Compliance." />
                    <SettingToggle id="cert_weight" label="Member of Weight to Go?" description="Weight enforcement bypass program." />
                    <SettingToggle id="cert_premium" label="Premium Carrier?" description="Internal designation for priority status." />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ========================================== */}
            {/* REGIONAL SETTINGS TAB                      */}
            {/* ========================================== */}
            <TabsContent value="regional" className="space-y-6 m-0">
              <Card>
                <CardHeader className="bg-muted/30 py-4 border-b">
                  <CardTitle className="text-sm">Regional Operations Constraints</CardTitle>
                  <CardDescription className="text-xs">Enable specific routing and equipment rules based on geography.</CardDescription>
                </CardHeader>
                <CardContent className="pt-2 divide-y max-w-3xl">
                  <SettingToggle id="reg_or" label="Do You Travel In Oregon?" description="Requires Oregon Weight Receipt & Tax identifier." defaultChecked={true} />
                  <SettingToggle id="reg_ny" label="Do You Travel In NY?" description="Requires NY HUT decal and routing permissions." defaultChecked={true} />
                  <SettingToggle id="reg_nm" label="Do You Travel In New Mexico?" description="Requires NM Weight Distance tax routing." />
                  <SettingToggle id="reg_ky" label="Do You Travel In Kentucky?" description="Requires KYU number for dispatch." />
                  <Separator className="my-2" />
                  <SettingToggle id="reg_ca_reefer" label="Operate Reefer In California?" description="Mandates CARB compliance checks for refrigerated units." />
                  <SettingToggle id="reg_id_dg" label="Transport DG In Idaho?" description="Cross-referenced with Cargo Settings." />
                  <SettingToggle id="reg_co_dg" label="Transport DG in Colorado?" description="Cross-referenced with Cargo Settings." />
                </CardContent>
              </Card>
            </TabsContent>

            {/* PLACEHOLDER FOR COMPANY TAB */}
            <TabsContent value="company" className="space-y-6 m-0">
               <Card>
                <CardHeader className="bg-muted/30 py-4 border-b">
                  <CardTitle className="text-sm">General Company Preferences</CardTitle>
                </CardHeader>
                <CardContent className="p-10 text-center text-muted-foreground text-sm">
                  System defaults, timezone, and general configurations will be placed here.
                </CardContent>
               </Card>
            </TabsContent>

          </div>
        </Tabs>

        {/* STICKY SAVE FOOTER */}
        <div className="flex justify-end gap-4 mt-8 sticky bottom-4 bg-background/80 p-4 border rounded-lg backdrop-blur shadow-sm z-10">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Discard Changes
          </Button>
          <Button type="submit">
            <Save className="mr-2 size-4" />
            Save Settings
          </Button>
        </div>
      </form>
    </div>
  )
}
