"use client"

import { use, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Plus, Search, Upload, UserPlus, Users, X } from "lucide-react"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import { recordAuditEvent } from "@/lib/audit-logger"
import { driverDateInputValue } from "@/lib/driver-date"
import { calculateAge, createDriver, currentLicence, displayCompanyDriverRecordId, companyDriverStorageKey, fullLegalName, getCompany, loadCompanyDriverStore, loadDriverMasterStore, readCompanies, type CompanyDriverRelationship, type Country, type DriverInput, type DriverMaster, type DriverStatus, type OperatingRegion, type RecordType } from "@/lib/driver-data"

import { existingDriverCheckKey, findExistingDriverCandidates, hasMandatoryIdentityFields, type ExistingDriverCheckResult } from "@/lib/driver-existing-check"

const RECORD_TYPES:RecordType[]=["Not Established","Employee","Owner-Operator","Contractor","Temporary Driver"]
const REGIONS:OperatingRegion[]=["Not Established","Canada","United States","Cross-Border"]
const STATUSES:DriverStatus[]=["Not Established","Active","On Leave","Suspended","Inactive","Terminated"]
const COUNTRIES:Country[]=["Canada","United States"]
const empty=():DriverInput=>({legalFirstName:"",legalMiddleName:"",legalLastName:"",preferredName:"",dateOfBirth:"",phone:"",email:"",recordType:"Not Established",operatingRegion:"Not Established",driverStatus:"Not Established",relationshipStartDate:"",relationshipEndDate:"",addressLine1:"",addressLine2:"",city:"",stateProvince:"",postalZip:"",country:"Canada",addressEffectiveFrom:"",licenceNumber:"",licenceJurisdiction:"",licenceCountry:"Canada",licenceClass:"",licenceEffectiveFrom:""})
const tone=(s:DriverStatus)=>s==="Active"?"ok":s==="On Leave"?"warn":s==="Suspended"||s==="Terminated"?"danger":"neutral"

export default function DriversPage({params}:{params:Promise<{id:string}>}){
 const {id:companyId}=use(params),router=useRouter()
 const [company,setCompany]=useState<ReturnType<typeof getCompany>>(null)
 const [hydrated,setHydrated]=useState(false)
 const [rows,setRows]=useState<Array<{master:DriverMaster;relationship:CompanyDriverRelationship}>>([]),[q,setQ]=useState(""),[status,setStatus]=useState("All"),[region,setRegion]=useState("All"),[type,setType]=useState("All"),[open,setOpen]=useState(false),[form,setForm]=useState(empty()),[error,setError]=useState(""),[loadError,setLoadError]=useState(""),[saving,setSaving]=useState(false),[licenceFile,setLicenceFile]=useState<File|null>(null),[check,setCheck]=useState<ExistingDriverCheckResult|null>(null),[resolution,setResolution]=useState<{kind:"NEW"}|{kind:"REUSE";masterId:string}|null>(null)
 const hydrate=()=>{try{const masters=loadDriverMasterStore().drivers||[],rels=(loadCompanyDriverStore(companyId).relationships||[]).filter(r=>!r.archive?.isArchived);setRows(rels.map(r=>{const m=masters.find(x=>x.id===r.driverMasterId);return m?{master:m,relationship:r}:null}).filter(Boolean) as Array<{master:DriverMaster;relationship:CompanyDriverRelationship}>);setLoadError("")}catch(e){console.error("Driver register hydration failed:",e);setRows([]);setLoadError(e instanceof Error?e.message:"Unable to load Driver records.")}}
 useEffect(()=>{try{setCompany(getCompany(companyId))}catch(e){console.error("Driver company hydration failed:",e);setCompany(null);setLoadError(e instanceof Error?e.message:"Unable to load company.")}hydrate();setHydrated(true)},[companyId])
 const filtered=useMemo(()=>rows.filter(({master,relationship})=>{const l=currentLicence(master)?.licenceNumberRaw||"",hay=`${fullLegalName(master)} ${master.id} ${displayCompanyDriverRecordId(companyId,relationship)} ${l}`.toLowerCase();return hay.includes(q.toLowerCase())&&(status==="All"||relationship.driverStatus===status)&&(region==="All"||relationship.operatingRegion===region)&&(type==="All"||relationship.recordType===type)}),[rows,q,status,region,type,companyId])
 const update=(k:keyof DriverInput,v:any)=>{const next={...form,[k]:v};if(k==="country"){next.stateProvince=""}if(k==="licenceCountry"){next.licenceJurisdiction=""}setForm(next);if(k==="legalFirstName"||k==="legalLastName"||k==="email"||k==="phone"){setCheck(null);setResolution(null)}}
 const jurisdictions=(country:Country)=>JURISDICTIONS.filter((j:any)=>String(j.country||j.countryName||"").toLowerCase().includes(country==="Canada"?"canada":"united")||String(j.countryCode||"").toUpperCase()===(country==="Canada"?"CA":"US"))
 const idInput={legalFirstName:form.legalFirstName,legalLastName:form.legalLastName,email:form.email||"",phone:form.phone||""}
 const fieldsComplete=hasMandatoryIdentityFields(idInput),checkFresh=Boolean(check)&&check!.key===existingDriverCheckKey(idInput)
 const relationshipsFor=(id:string)=>{const raw=window.localStorage.getItem(companyDriverStorageKey(id));if(!raw)return [] as CompanyDriverRelationship[];const parsed=JSON.parse(raw);if(!parsed||Array.isArray(parsed)||!Array.isArray(parsed.relationships))throw new Error("Unrecognized Driver store.");return parsed.relationships as CompanyDriverRelationship[]}
 const runCheck=()=>{setError("");if(!hasMandatoryIdentityFields(idInput)){setError("Enter First Name, Last Name, Email and Phone before checking for an existing Driver.");return}try{setCheck(findExistingDriverCandidates(idInput,{currentCompanyId:companyId,drivers:loadDriverMasterStore().drivers||[],companies:readCompanies(),relationshipsFor}));setResolution(null)}catch(e){setCheck(null);setResolution(null);setError(e instanceof Error?e.message:"Existing Driver check could not be completed.")}}
 const submit=()=>{setError("")
  if(!check||!checkFresh){setError("Run “Check for Existing Driver” for the current First Name, Last Name, Email and Phone before saving.");return}
  if(check.candidates.length>0&&!resolution){setError("An existing Driver may match. Select the matching Driver, or confirm this is a different person, before saving.");return}
  if(resolution?.kind==="REUSE"){const picked=check.candidates.find(c=>c.master.id===resolution.masterId);if(!picked||picked.activeAtCurrentCompany){setError("The selected Driver cannot be added to this company.");return}}
  setSaving(true);try{const result=createDriver(companyId,form,resolution?.kind==="REUSE"?{reuseDriverMasterId:resolution.masterId}:{acknowledgeDistinctPerson:true});recordAuditEvent({companyId,entityType:"Driver",entityId:result.master.id,action:"CREATE",details:`Created company Driver record ${displayCompanyDriverRecordId(companyId,result.relationship)}.`});setOpen(false);setForm(empty());setLicenceFile(null);setCheck(null);setResolution(null);hydrate();router.push(`/companies/${companyId}/drivers/${result.master.id}`)}catch(e){setError(e instanceof Error?e.message:"Unable to save Driver.")}finally{setSaving(false)}}
 if(!hydrated)return <Card><CardContent className="p-8">Loading Driver records...</CardContent></Card>
 if(loadError)return <Card><CardContent className="p-8"><div className="font-semibold">Driver records could not be loaded.</div><div className="mt-2 text-sm text-muted-foreground">{loadError}</div></CardContent></Card>
 if(!company)return <Card><CardContent className="p-8">Company not found.</CardContent></Card>
 return <div className="space-y-6">
  {company ? (
    <CompanyWorkspaceHeader
      company={{
        id: company.id,
        name: company.name,
        kind: (company as any).kind ?? "Customer",
        status: company.status ?? "Active",
      }}
      section="Drivers"
      description="Driver compliance records"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={()=>alert("Secure applicant invitation is intentionally not activated until the authenticated external application workflow is connected.")}><UserPlus className="mr-2 size-4"/>Invite Applicant</Button>
          <Button onClick={()=>{setCheck(null);setResolution(null);setOpen(true)}}><Plus className="mr-2 size-4"/>Add Driver</Button>
        </div>
      }
    />
  ) : null}
  <div className="grid gap-4 md:grid-cols-4">
  <StatCard
    label="Driver Records"
    value={String(rows.length)}
    icon={Users}
  />
  <StatCard
    label="Active"
    value={String(rows.filter(x => x.relationship.driverStatus === "Active").length)}
    icon={Users}
  />
  <StatCard
    label="Cross-Border"
    value={String(rows.filter(x => x.relationship.operatingRegion === "Cross-Border").length)}
    icon={Users}
  />
  <StatCard
    label="Needs Identity Review"
    value={String(rows.filter(x => x.master.identityResolution?.status === "REVIEW").length)}
    icon={Users}
  />
</div>
  <Card><CardHeader><CardTitle>Driver Register</CardTitle></CardHeader><CardContent><div className="mb-4 grid gap-3 md:grid-cols-4"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground"/><Input className="pl-9" placeholder="Search name, Master ID, Record ID, licence" value={q} onChange={e=>setQ(e.target.value)}/></div><Select value={status} onChange={setStatus} options={["All",...STATUSES]}/><Select value={region} onChange={setRegion} options={["All",...REGIONS]}/><Select value={type} onChange={setType} options={["All",...RECORD_TYPES]}/></div>
  <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><Th>Driver</Th><Th>Company Record ID</Th><Th>Master ID</Th><Th>Record Type</Th><Th>Operating Region</Th><Th>Licence</Th><Th>Status</Th></tr></thead><tbody>{filtered.map(({master,relationship})=><tr key={relationship.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={()=>router.push(`/companies/${companyId}/drivers/${master.id}`)}><Td><div className="font-semibold">{fullLegalName(master)}</div><div className="text-xs text-muted-foreground">Age {calculateAge(master.identity.dateOfBirth)??"—"}</div></Td><Td>{displayCompanyDriverRecordId(companyId,relationship)}</Td><Td className="font-mono text-xs">{master.id}</Td><Td>{relationship.recordType}</Td><Td>{relationship.operatingRegion}</Td><Td>{currentLicence(master)?`${currentLicence(master)!.jurisdiction} · ${currentLicence(master)!.class||"Class —"}`:"—"}</Td><Td><StatusBadge tone={tone(relationship.driverStatus)}>{relationship.driverStatus}</StatusBadge></Td></tr>)}{!filtered.length&&<tr><td colSpan={7} className="p-10 text-center text-muted-foreground">No Driver records match the current filters.</td></tr>}</tbody></table></div></CardContent></Card>
  {open&&<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 md:p-8"><div className="w-full max-w-5xl rounded-xl bg-background shadow-2xl"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-xl font-semibold">Add Driver</h2><p className="text-sm text-muted-foreground">Driver Licence first · identity review before creation</p></div><Button variant="ghost" size="icon" onClick={()=>setOpen(false)}><X className="size-4"/></Button></div><div className="space-y-6 p-5">
   <section className="rounded-lg border bg-muted/20 p-4"><div className="flex items-center gap-2 font-semibold"><Upload className="size-4"/>Start with Driver Licence</div><p className="mt-1 text-sm text-muted-foreground">Upload the licence as source evidence. OCR/barcode extraction must use the shared TES OCR adapter when connected; this page never treats a filename as extracted data.</p><Input className="mt-3" type="file" accept="image/*,.pdf" onChange={e=>setLicenceFile(e.target.files?.[0]||null)}/>{licenceFile&&<p className="mt-2 text-xs">Selected: {licenceFile.name}</p>}</section>
   <Section title="Identity"><Grid><Field label="First Name *" value={form.legalFirstName} onChange={v=>update("legalFirstName",v)}/><Field label="Middle Name" value={form.legalMiddleName} onChange={v=>update("legalMiddleName",v)}/><Field label="Last Name *" value={form.legalLastName} onChange={v=>update("legalLastName",v)}/><Field label="Preferred Name" value={form.preferredName} onChange={v=>update("preferredName",v)}/><Field label="Date of Birth" type="date" value={form.dateOfBirth} onChange={v=>update("dateOfBirth",v)}/><Field label="Phone *" value={form.phone||""} onChange={v=>update("phone",v)}/><Field label="Email *" type="email" value={form.email||""} onChange={v=>update("email",v)}/></Grid></Section>
   <Section title="Company Driver Relationship"><Grid><SelectField label="Record Type" value={form.recordType} onChange={v=>update("recordType",v)} options={RECORD_TYPES}/><SelectField label="Operating Region" value={form.operatingRegion} onChange={v=>update("operatingRegion",v)} options={REGIONS}/><SelectField label="Driver Status" value={form.driverStatus} onChange={v=>update("driverStatus",v)} options={STATUSES}/><Field label="Relationship Start" type="date" value={form.relationshipStartDate} onChange={v=>update("relationshipStartDate",v)}/><Field label="Relationship End" type="date" value={form.relationshipEndDate} onChange={v=>update("relationshipEndDate",v)}/></Grid></Section>
   <Section title="Current Address"><Grid><Field label="Address *" value={form.addressLine1} onChange={v=>update("addressLine1",v)}/><Field label="Address Line 2" value={form.addressLine2} onChange={v=>update("addressLine2",v)}/><Field label="City" value={form.city} onChange={v=>update("city",v)}/><SelectField label="Country *" value={form.country} onChange={v=>update("country",v as Country)} options={COUNTRIES}/><SelectField label="State / Province" value={form.stateProvince} onChange={v=>update("stateProvince",v)} options={jurisdictions(form.country).map((j:any)=>j.code||j.value||j.name)}/><Field label="Postal / ZIP" value={form.postalZip} onChange={v=>update("postalZip",v)}/><Field label="Address Effective From" type="date" value={form.addressEffectiveFrom} onChange={v=>update("addressEffectiveFrom",v)}/></Grid></Section>
   <Section title="Current Driver Licence"><Grid><SelectField label="Issuing Country" value={form.licenceCountry} onChange={v=>update("licenceCountry",v as Country)} options={COUNTRIES}/><SelectField label="Issuing Jurisdiction" value={form.licenceJurisdiction} onChange={v=>update("licenceJurisdiction",v)} options={jurisdictions(form.licenceCountry).map((j:any)=>j.code||j.value||j.name)}/><Field label="Licence Number" value={form.licenceNumber} onChange={v=>update("licenceNumber",v)}/><Field label="Class" value={form.licenceClass} onChange={v=>update("licenceClass",v)}/><Field label="Licence Effective From" type="date" value={form.licenceEffectiveFrom} onChange={v=>update("licenceEffectiveFrom",v)}/></Grid><p className="mt-3 text-xs text-muted-foreground">Unexpected jurisdiction format should be reviewed, not treated as proof of invalidity. Authoritative verification remains separate.</p></Section>
   {check&&checkFresh&&<div className="rounded-md border p-4 text-sm" role="status">{check.candidates.length===0?<div className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 shrink-0 text-emerald-600"/>No existing driver found — proceeding will create a new driver record.</div>:<div className="space-y-3"><div className="font-semibold">{check.candidates.length===1?"An existing Driver matches":"Existing Drivers match"} on name and contact details. Confirm whether this is the same person.</div>{check.candidates.map(c=>{const selected=resolution?.kind==="REUSE"&&resolution.masterId===c.master.id;return <div key={c.master.id} className={`rounded-md border p-3 ${selected?"border-primary bg-primary/5":""}`}><div className="font-medium">{fullLegalName(c.master)} · <span className="font-mono text-xs">{c.master.id}</span></div><div className="text-xs text-muted-foreground">Matched on {c.matchedOn.map(m=>m==="EMAIL"?"email":"phone").join(" and ")}</div><div className="mt-1 text-xs">{c.affiliations.length?c.affiliations.map(a=>`${a.companyName||a.companyId} — ${a.driverStatus}`).join("; "):"No active company affiliation"}</div>{c.activeAtCurrentCompany?<div className="mt-2 text-xs font-medium text-amber-700">Already an active Driver at this company — cannot be added again.</div>:<Button className="mt-2" size="sm" variant={selected?"default":"outline"} onClick={()=>setResolution({kind:"REUSE",masterId:c.master.id})}>{selected?"Selected — same person":"This is the same person"}</Button>}</div>})}<div><Button size="sm" variant={resolution?.kind==="NEW"?"default":"outline"} onClick={()=>setResolution({kind:"NEW"})}>{resolution?.kind==="NEW"?"Confirmed — different person, create new":"This is a different person — create new"}</Button></div>{resolution?.kind==="REUSE"&&<div className="text-xs text-muted-foreground">Saving adds this company as a new relationship for the existing Driver. Identity details already on the Driver record are kept; values typed above are not written over them, and relationships at other companies are not changed.</div>}</div>}{check.unreadableCompanyIds.length>0&&<div className="mt-2 text-xs text-amber-700">Affiliations could not be read for {check.unreadableCompanyIds.length} company record(s); they are unknown, not absent.</div>}</div>}
   {error&&<div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
  </div>
  <div className="sticky bottom-0 z-10 flex items-center justify-between gap-4 rounded-b-[inherit] border-t border-border bg-card px-6 py-4 shadow-sm"><div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 shrink-0 text-emerald-600"/>Record is ready when required information is complete.</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={!fieldsComplete||saving} onClick={runCheck}>Check for Existing Driver</Button><Button disabled={saving||!checkFresh} onClick={submit}>{saving?"Saving…":"Save Driver"}</Button></div></div>
  </div></div>}
 </div>
}
function Th({children}:{children:React.ReactNode}){return <th className="px-4 py-3 font-medium">{children}</th>}function Td({children,className=""}:{children:React.ReactNode;className?:string}){return <td className={`px-4 py-3 ${className}`}>{children}</td>}
function Select({value,onChange,options}:{value:string;onChange:(v:string)=>void;options:string[]}){return <select className="h-10 rounded-md border bg-background px-3 text-sm" value={value} onChange={e=>onChange(e.target.value)}>{options.map(x=><option key={x}>{x}</option>)}</select>}
function Section({title,children}:{title:string;children:React.ReactNode}){return <section><h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</section>}function Grid({children}:{children:React.ReactNode}){return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{children}</div>}
function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(v:string)=>void;type?:string}){const safeValue=type==="date"?driverDateInputValue(value):value;return <div className="space-y-1.5"><Label>{label}</Label><Input type={type} value={safeValue} placeholder={type==="date"?"YYYY-MM-DD":undefined} onChange={e=>onChange(e.target.value)}/></div>}
function SelectField({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:readonly string[]}){return <div className="space-y-1.5"><Label>{label}</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={value} onChange={e=>onChange(e.target.value)}><option value="">Select…</option>{options.map(x=><option key={x} value={x}>{x}</option>)}</select></div>}
