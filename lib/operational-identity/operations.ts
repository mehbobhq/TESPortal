import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType } from "@/lib/master-register/types"
import { enterSystemCapability } from "@/lib/company-directory/capability-context"
import { hasAdditionalSystemCapability, requireAdditionalSystemCapability, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { listEvidence } from "@/lib/evidence-payload/operations"
import { VEHICLE_HELD_ELSEWHERE_MESSAGE, VEHICLE_HELD_HERE_MESSAGE, VEHICLE_OVERLAP_MESSAGE, VehicleIdentityConflictError, VehicleIdentityNotFoundError, DRIVER_ASSIGNMENT_ELSEWHERE_MESSAGE, DRIVER_ASSIGNMENT_HERE_MESSAGE, DRIVER_LICENCE_CONFLICT_MESSAGE, DriverIdentityConflictError, DriverIdentityNotFoundError, DriverIdentityStateError, DriverIdentityValidationError } from "./errors"
import { canonicalLicenceKey, isCanonicalCountry, isValidJurisdiction, sameCanonicalLicence } from "./jurisdiction"
import { normalizeSourceKey, normalizeUnitNumber, normalizeVin, isStructurallyValidVin } from "./normalization"
import { migration0037Message, migration0037State } from "./schema-state"
import * as repo from "./repository"
import type { DriverIdentityRevocationInput, DriverIdentityStatus, DriverIdentityVerificationInput, DriverLicenceInput, DriverProfileCreateInput, EndOrganizationDriverInput, EntityResolutionInput, OrganizationDriverRelationshipInput, OrganizationVehicleRelationshipInput, TransferOrganizationDriverInput, VehicleCreateInput } from "./types"

export type IdentityContext={client:PoolClient;actor:{id:string;actorType:ActorType};masterRegister:MasterRegisterRepository}
const ref=(table:string,id:string)=>({kind:"REFERENCE" as const,reference:`${table}:${id}`})
async function mr(ctx:IdentityContext,eventType:string,operation:string,resourceType:string,resourceId:string,subjects:string[]) {
 await recordEvent(ctx.masterRegister,{eventType,actor:{actorType:ctx.actor.actorType,actorId:ctx.actor.id},
  action:{operation},target:{resourceType,resourceId,subjectReferences:subjects},
  source:{sourceType:"APPLICATION",component:"operational-identity",workflow:operation},
  classification:{materiality:"MATERIAL"},change:{changedFields:["record"],fieldChanges:[{field:"record",after:ref(resourceType,resourceId)}]},
  outcome:{result:"SUCCESS"}})
}
const required=(v:string,n:string)=>{const x=v.trim();if(!x)throw new Error(`${n} is required.`);return x}
const activeOrg=async(ctx:IdentityContext,id:string)=>{const o=await repo.lockOrganization(ctx.client,id);if(!o)throw new Error("Organization not found.");if(o.status!=="active")throw new Error("Organization must be active.")}
const activePerson=async(ctx:IdentityContext,id:string)=>{const p=await repo.lockPerson(ctx.client,id);if(!p)throw new Error("Person not found.");if(p.record_status!=="active")throw new Error("Person must be active.")}

class VinRace extends Error {}

export async function createVehicle(ctx:IdentityContext,input:VehicleCreateInput){
 const vin=input.vin?normalizeVin(input.vin):null
 if(vin&&!isStructurallyValidVin(vin))throw new Error("VIN is structurally invalid.")
 if(vin){const existing=await repo.findVehicleByVin(ctx.client,vin);if(existing) return {kind:"EXISTING" as const,vehicleId:existing.id}}
 const id=randomUUID()
 try{
  // Two simultaneous creates of one VIN: the unique index decides; the loser re-reads the winner instead of failing with a raw error.
  await guarded(ctx,()=>repo.insertVehicle(ctx.client,{id,vehicleTypeCode:input.vehicleTypeCode,vinDisplay:input.vin?.trim()||null,vinNormalized:vin,
   modelYear:input.modelYear??null,make:input.make?.trim()||null,model:input.model?.trim()||null}),()=>new VinRace())
 }catch(error){
  if(error instanceof VinRace&&vin){const winner=await repo.findVehicleByVin(ctx.client,vin);if(winner)return {kind:"EXISTING" as const,vehicleId:winner.id}}
  throw error
 }
 await mr(ctx,"RECORD_CREATED","VEHICLE_CREATE","vehicles",id,[`vehicle:${id}`])
 return {kind:"CREATED" as const,vehicleId:id}
}

/**
 * Records a company's relationship to a vehicle. A vehicle has ONE current owner and ONE current operator across TES (LEASES is not exclusive).
 * The vehicle row is locked FIRST (then the organization), so two companies racing for one vehicle serialize here; the partial unique indexes of
 * migration 0038 also decide any race that bypasses this function. The refusal never says which company holds the vehicle, and nothing held by
 * another company is ended, reassigned or overwritten: ending a relationship is its own explicit act.
 */
export async function establishOrganizationVehicle(ctx:IdentityContext,input:OrganizationVehicleRelationshipInput){
 const vehicle=await repo.lockVehicle(ctx.client,input.vehicleId)
 await activeOrg(ctx,input.organizationId)
 if(!vehicle)throw new VehicleIdentityNotFoundError("Vehicle not found.")
 const open=await repo.lockOpenVehicleRelationships(ctx.client,input.vehicleId)
 if(open.some((r)=>r.organization_id===input.organizationId&&r.relationship_type===input.relationshipType))throw new VehicleIdentityConflictError(VEHICLE_HELD_HERE_MESSAGE)
 const exclusive=input.relationshipType==="OWNS"||input.relationshipType==="OPERATES"
 if(exclusive&&open.some((r)=>r.organization_id!==input.organizationId&&r.relationship_type===input.relationshipType))throw new VehicleIdentityConflictError(VEHICLE_HELD_ELSEWHERE_MESSAGE)
 const id=randomUUID(),unit=input.unitNumber?.trim()||null
 await guarded(ctx,()=>repo.insertOrganizationVehicleRelationship(ctx.client,{id,organizationId:input.organizationId,vehicleId:input.vehicleId,
  relationshipType:input.relationshipType,unitDisplay:unit,unitNormalized:unit?normalizeUnitNumber(unit):null,effectiveFrom:required(input.effectiveFrom,"effectiveFrom")}),
  (constraint)=>new VehicleIdentityConflictError(constraint==="organization_vehicle_current_relationship_uq"||constraint==="organization_vehicle_current_unit_uq"?VEHICLE_HELD_HERE_MESSAGE:constraint?.startsWith("organization_vehicle_open_")?VEHICLE_HELD_ELSEWHERE_MESSAGE:VEHICLE_OVERLAP_MESSAGE))
 await mr(ctx,"RECORD_LINK_ESTABLISHED","ORGANIZATION_VEHICLE_ESTABLISH","organization_vehicle_relationships",id,[`organization:${input.organizationId}`,`vehicle:${input.vehicleId}`])
 return {relationshipId:id}
}

/**
 * Reusing an EXISTING vehicle (found by VIN) for a new company is allowed only when no OTHER company currently has any open relationship with it:
 * a vehicle in use elsewhere is never silently shared. History of ended relationships is untouched.
 */
export async function assertVehicleNotInUseElsewhere(ctx:IdentityContext,vehicleId:string,organizationId:string){
 if(!(await repo.lockVehicle(ctx.client,vehicleId)))throw new VehicleIdentityNotFoundError("Vehicle not found.")
 const open=await repo.lockOpenVehicleRelationships(ctx.client,vehicleId)
 if(open.some((r)=>r.organization_id!==organizationId))throw new VehicleIdentityConflictError(VEHICLE_HELD_ELSEWHERE_MESSAGE)
}

export async function createDriverProfile(ctx:IdentityContext,input:DriverProfileCreateInput){
 await activePerson(ctx,input.personId)
 await repo.insertDriverProfile(ctx.client,input.personId)
 await mr(ctx,"RECORD_CREATED","DRIVER_PROFILE_CREATE","driver_profiles",input.personId,[`person:${input.personId}`])
 return {personId:input.personId}
}

const PENDING_IDENTITY_MESSAGE="This driver identity is pending review because it may match another record. It cannot be assigned, transferred or verified until TES resolves it. Nothing was saved."
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid=(v:unknown,f:string)=>{if(typeof v!=="string"||!UUID.test(v.trim()))throw new DriverIdentityValidationError(f,`${f} must be a UUID.`);return v.trim()}
const day=(v:string|undefined,f:string)=>{if(v===undefined)return undefined;if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(`${v}T00:00:00Z`))||new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)!==v)throw new DriverIdentityValidationError(f,`${f} must be a calendar date (YYYY-MM-DD).`);return v}

/** Runs `work` in a savepoint so a unique / exclusion violation can be classified and reported without aborting the whole transaction. */
async function guarded<T>(ctx:IdentityContext,work:()=>Promise<T>,onViolation:(constraint:string|undefined)=>Error):Promise<T>{
 await ctx.client.query("SAVEPOINT driver_identity_write")
 try{const r=await work();await ctx.client.query("RELEASE SAVEPOINT driver_identity_write");return r}
 catch(e){
  await ctx.client.query("ROLLBACK TO SAVEPOINT driver_identity_write")
  await ctx.client.query("RELEASE SAVEPOINT driver_identity_write")
  const code=(e as {code?:string}).code
  if(code==="23505"||code==="23P01")throw onViolation((e as {constraint?:string}).constraint)
  if(code==="23514"&&/pending review/.test((e as Error).message))throw new DriverIdentityStateError(PENDING_IDENTITY_MESSAGE)
  throw e
 }
}

async function requireMigration0037(ctx:IdentityContext,what:string){
 const state=await migration0037State(ctx.client)
 if(state!=="COMPLETE")throw new DriverIdentityStateError(migration0037Message(state,what))
}

export async function addDriverLicence(ctx:IdentityContext,input:DriverLicenceInput){
 await activePerson(ctx,input.personId)
 const country=required(input.jurisdictionCountry,"jurisdictionCountry"),region=required(input.jurisdictionRegion,"jurisdictionRegion")
 const key=canonicalLicenceKey(country,region,input.licenceNumber)
 if(!key.number)throw new DriverIdentityValidationError("licenceNumber","licenceNumber is required.")
 if(!isCanonicalCountry(key.country))throw new DriverIdentityValidationError("jurisdictionCountry","jurisdictionCountry must be Canada, the United States or Mexico (or CA, US, MX).")
 if(!isValidJurisdiction(key.country,key.region))throw new DriverIdentityValidationError("jurisdictionRegion","jurisdictionRegion must be a province, state or territory of the licence country.")
 const classify=async():Promise<Error|{existing:string}|null>=>{
  const rows=await repo.findCurrentLicenceCandidates(ctx.client,key.number,input.personId)
  const same=rows.filter((r)=>sameCanonicalLicence(canonicalLicenceKey(r.country,r.region,r.normalized),key))
  if(same.some((r)=>r.person_id!==input.personId))return new DriverIdentityConflictError(DRIVER_LICENCE_CONFLICT_MESSAGE)
  if(same[0])return {existing:same[0].id}
  const sameJurisdiction=rows.some((r)=>r.person_id===input.personId&&canonicalLicenceKey(r.country,r.region,r.normalized).country===key.country&&canonicalLicenceKey(r.country,r.region,r.normalized).region===key.region)
  if(sameJurisdiction)return new DriverIdentityStateError("This person already has a current licence from that jurisdiction. Renew or correct it instead of adding another. Nothing was saved.")
  return null
 }
 const before=await classify()
 if(before instanceof Error)throw before
 if(before)return {kind:"EXISTING" as const,licenceId:before.existing}
 const id=randomUUID()
 await guarded(ctx,()=>repo.insertDriverLicence(ctx.client,{id,personId:input.personId,country:key.country,region:key.region,
  display:input.licenceNumber.trim(),normalized:key.number,licenceClass:input.licenceClass?.trim()||null,issueDate:input.issueDate??null,expiryDate:input.expiryDate??null,effectiveFrom:input.effectiveFrom}),
  ()=>new DriverIdentityConflictError(DRIVER_LICENCE_CONFLICT_MESSAGE))
 await mr(ctx,"RECORD_CREATED","DRIVER_LICENCE_CREATE","driver_licences",id,[`person:${input.personId}`])
 return {kind:"CREATED" as const,licenceId:id}
}

export class DriverProspectPendingStateError extends Error{}

/**
 * Records a driver's assignment to a company. ONE driver identity holds ONE open assignment across TES (ONBOARDING, ACTIVE, SUSPENDED and
 * ON_LEAVE all count). The person row is locked FIRST (then the organization), so two companies racing for one driver serialize here, before
 * migration 0037 and after it; from 0037 the unique index and exclusion constraint also decide any race that bypasses this function. The refusal
 * never says which company holds the driver. Moving a driver from one company to another is an explicit transfer, never a side effect.
 */

/**
 * A driver under an active mandatory safety restriction (a roadside driver out-of-service order, a stand-down) cannot be activated as a company driver, or transferred to another company, while it stands.
 * The lookup is a boolean only (tes_security.driver_event_person_restricted, migration 0043): it names no event.
 * FAIL CLOSED: where Driver Events exists (migration 0042 applied) the lookup MUST answer. A missing function, a database error, or an answer that is not exactly true/false
 * (NULL means the caller was not authorized to ask) refuses the operation; nothing is ever assumed "not restricted". Only a database with no Driver Events store at all
 * (neither the tables nor the function) has nothing to consult.
 */
export const SAFETY_LOOKUP_UNAVAILABLE_MESSAGE="The driver's safety-restriction status could not be confirmed, so the driver cannot be activated or transferred. Nothing was changed. Apply the Driver Events migrations or contact an administrator."
async function assertDriverNotSafetyRestricted(ctx:IdentityContext,organizationId:string,personId:string,status:string|undefined){
 if(status!=="ACTIVE")return
 const state=(await ctx.client.query<{store:boolean;fn:boolean}>(`SELECT (to_regclass('public.driver_event_restrictions') IS NOT NULL OR to_regclass('public.driver_events') IS NOT NULL) AS store, to_regprocedure('tes_security.driver_event_person_restricted(uuid,uuid)') IS NOT NULL AS fn`)).rows[0]
 if(!state?.store&&!state?.fn)return
 if(!state.fn)throw new DriverIdentityStateError(SAFETY_LOOKUP_UNAVAILABLE_MESSAGE)
 const r=await ctx.client.query<{restricted:boolean|null}>("SELECT tes_security.driver_event_person_restricted($1,$2) AS restricted",[organizationId,personId])
 const restricted=r.rows[0]?.restricted
 if(restricted===true)throw new DriverIdentityStateError("This driver is under an active safety restriction (for example an out-of-service order). Release the restriction on the event that issued it, with its documented correction, before activating or transferring the driver. Nothing was changed.")
 if(restricted!==false)throw new DriverIdentityStateError(SAFETY_LOOKUP_UNAVAILABLE_MESSAGE)
}

export async function establishOrganizationDriver(ctx:IdentityContext,input:OrganizationDriverRelationshipInput,decision:SystemAuthorizationDecision){
 const person=await repo.lockPerson(ctx.client,input.personId)
 await activeOrg(ctx,input.organizationId)
 if(!person)throw new Error("Person not found.")
 if(person.record_status!=="active")throw new Error("Person must be active.")
 // A prospect is not a company driver: while this company's prospect is still in progress, assignment must go through approval and conversion.
 if((await ctx.client.query(`SELECT to_regclass('public.driver_prospects') IS NOT NULL AS present`)).rows[0]?.present){
  const live=await ctx.client.query(`SELECT 1 FROM public.driver_prospects WHERE organization_id=$1 AND person_id=$2 AND status IN ('PROSPECT','INVITED','APPLICATION_SUBMITTED','UNDER_REVIEW') LIMIT 1`,[input.organizationId,input.personId])
  if((live.rowCount??0)>0)throw new DriverProspectPendingStateError("This person is a driver prospect whose application is still in progress. Approve the prospect and onboard them as a company driver instead. Nothing was changed.")
 }
 if(input.status==="ON_LEAVE"){
  const state=await migration0037State(ctx.client)
  if(state!=="COMPLETE")throw new DriverIdentityStateError(migration0037Message(state,"The ON_LEAVE status"))
 }
 if(await identityIsAmbiguous(ctx,decision,input.personId))throw new DriverIdentityStateError(PENDING_IDENTITY_MESSAGE)
 await assertDriverNotSafetyRestricted(ctx,input.organizationId,input.personId,input.status)
 const open=await repo.lockOpenAssignments(ctx.client,input.personId)
 if(open.some((r)=>r.organization_id===input.organizationId))throw new DriverIdentityConflictError(DRIVER_ASSIGNMENT_HERE_MESSAGE)
 if(open.length>0)throw new DriverIdentityConflictError(DRIVER_ASSIGNMENT_ELSEWHERE_MESSAGE)
 const id=randomUUID(),n=input.driverNumber?.trim()||null,complete=(await migration0037State(ctx.client))==="COMPLETE"
 await guarded(ctx,async()=>repo.insertOrganizationDriverRelationship(ctx.client,{id,organizationId:input.organizationId,personId:input.personId,
  relationshipType:input.relationshipType,driverDisplay:n,driverNormalized:n?normalizeUnitNumber(n):null,status:input.status,effectiveFrom:input.effectiveFrom,
  // From 0037 every new assignment records the instant TES opened it; the instants of one driver never overlap (the timeline of same-day changes).
  activatedAt:complete?(await repo.dbClock(ctx.client)).ts:null}),
  (constraint)=>new DriverIdentityConflictError(constraint==="organization_driver_current_uq"?DRIVER_ASSIGNMENT_HERE_MESSAGE:DRIVER_ASSIGNMENT_ELSEWHERE_MESSAGE))
 await mr(ctx,"RECORD_LINK_ESTABLISHED","ORGANIZATION_DRIVER_ESTABLISH","organization_driver_relationships",id,[`organization:${input.organizationId}`,`person:${input.personId}`])
 return {relationshipId:id}
}

/**
 * A pending or ambiguous identity is one an unresolved PERSON entity-resolution case names as a candidate. EVERY assignment, transfer and
 * verification enforces it, whatever capability the caller holds, and none of them gains identity-resolution visibility:
 *  - with migration 0037 the check is tes_security.driver_identity_unresolved(), a narrow SECURITY DEFINER boolean for ONE person that refuses
 *    runtime callers not authorized for driver management/verification (a database trigger repeats it on every new open assignment);
 *  - without 0037 there is no such function, so the check is made directly only for a caller who already holds IDENTITY_RESOLUTION_READ, and
 *    FAILS CLOSED (the operation is refused) for everyone else, and on a partly applied migration.
 */
async function identityIsAmbiguous(ctx:IdentityContext,decision:SystemAuthorizationDecision,personId:string){
 const state=await migration0037State(ctx.client)
 if(state==="COMPLETE"){
  const r=await ctx.client.query<{unresolved:boolean}>("SELECT tes_security.driver_identity_unresolved($1) AS unresolved",[personId])
  return r.rows[0]?.unresolved===true
 }
 if(state==="ABSENT"&&await hasAdditionalSystemCapability(ctx.client,decision,"IDENTITY_RESOLUTION_READ")){
  await enterSystemCapability(ctx.client,"IDENTITY_RESOLUTION_READ")
  try{return await repo.hasUnresolvedIdentityCase(ctx.client,personId)}finally{await enterSystemCapability(ctx.client,"DRIVER_MANAGE")}
 }
 throw new DriverIdentityStateError(migration0037Message(state,"Checking that the driver identity is not pending review"))
}

export async function readIdentityVerification(ctx:IdentityContext,personId:string):Promise<{status:DriverIdentityStatus;method:string|null;recordedAt:Date|null}>{
 if((await migration0037State(ctx.client))!=="COMPLETE")return {status:"UNVERIFIED",method:null,recordedAt:null}
 const latest=await repo.latestIdentityVerification(ctx.client,personId)
 return latest?{status:latest.verification_status,method:latest.method,recordedAt:latest.recorded_at}:{status:"UNVERIFIED",method:null,recordedAt:null}
}

/**
 * Ends ONE company's open assignment of a driver (status ENDED, effective_to = the end day, closed_at/end_reason recorded). History is kept: the
 * row is closed, never deleted. A same-day end is allowed. Only the named company's own open assignment can be ended here.
 */
export async function endOrganizationDriver(ctx:IdentityContext,input:EndOrganizationDriverInput){
 await requireMigration0037(ctx,"Ending a driver assignment")
 const organizationId=uuid(input.organizationId,"organizationId"),personId=uuid(input.personId,"personId")
 const requestedDay=day(input.effectiveTo,"effectiveTo")
 const person=await repo.lockPerson(ctx.client,personId)
 if(!person)throw new DriverIdentityNotFoundError("Person not found.")
 const org=await repo.lockOrganization(ctx.client,organizationId)
 if(!org)throw new DriverIdentityNotFoundError("Organization not found.")
 const open=(await repo.lockOpenAssignments(ctx.client,personId)).find((r)=>r.organization_id===organizationId)
 if(!open)throw new DriverIdentityNotFoundError("This driver has no open assignment with this company.")
 const clock=await repo.dbClock(ctx.client),effectiveTo=requestedDay??clock.today
 if(effectiveTo>clock.today)throw new DriverIdentityValidationError("effectiveTo","An assignment cannot be ended on a future date.")
 if(effectiveTo<open.effective_from)throw new DriverIdentityValidationError("effectiveTo","An assignment cannot end before it started.")
 await repo.closeAssignment(ctx.client,{id:open.id,effectiveTo,closedAt:clock.ts,endReason:"ENDED",transferId:null})
 await mrRelationshipChange(ctx,"RECORD_LINK_REMOVED","ORGANIZATION_DRIVER_END",open.id,organizationId,personId,open.status,"ENDED")
 return {relationshipId:open.id,effectiveTo}
}

/**
 * Transfers a driver from one company to another in ONE transaction: the person and both organizations are locked (person first, organizations
 * in id order), the previous assignment is closed (end_reason TRANSFERRED) and the new one is opened on the SAME instant and day, so the driver is
 * never in two companies and never in none. Requires a VERIFIED identity, no unresolved identity case and an explicit source company: another
 * company's relationship is never ended implicitly. Both rows record the same transfer_id; two Master Register events record who did it.
 */
export async function transferOrganizationDriver(ctx:IdentityContext,decision:SystemAuthorizationDecision,input:TransferOrganizationDriverInput){
 await requireMigration0037(ctx,"Transferring a driver")
 const from=uuid(input.fromOrganizationId,"fromOrganizationId"),to=uuid(input.toOrganizationId,"toOrganizationId"),personId=uuid(input.personId,"personId")
 if(from===to)throw new DriverIdentityValidationError("toOrganizationId","A driver cannot be transferred to the company that already holds the assignment.")
 const requestedDay=day(input.effectiveDate,"effectiveDate")
 const person=await repo.lockPerson(ctx.client,personId)
 if(!person)throw new DriverIdentityNotFoundError("Person not found.")
 if(person.record_status!=="active")throw new DriverIdentityStateError("Person must be active.")
 for(const id of [from,to].sort()){const o=await repo.lockOrganization(ctx.client,id);if(!o)throw new DriverIdentityNotFoundError("Organization not found.");if(id===to&&o.status!=="active")throw new DriverIdentityStateError("Organization must be active.")}
 if(await identityIsAmbiguous(ctx,decision,personId))throw new DriverIdentityStateError(PENDING_IDENTITY_MESSAGE)
 // the restriction belongs to the driver: moving the driver to another company must not shed it (checked in the company that holds it)
 await assertDriverNotSafetyRestricted(ctx,from,personId,"ACTIVE")
 const verification=await repo.latestIdentityVerification(ctx.client,personId)
 if(verification?.verification_status!=="VERIFIED")throw new DriverIdentityStateError("A driver can be transferred only when the identity is verified against evidence. A matching name, date of birth or licence number is not verification. Nothing was changed.")
 const open=await repo.lockOpenAssignments(ctx.client,personId)
 const source=open.find((r)=>r.organization_id===from)
 if(!source)throw new DriverIdentityNotFoundError("This driver has no open assignment with the company the transfer starts from.")
 const clock=await repo.dbClock(ctx.client),effectiveDate=requestedDay??clock.today
 if(effectiveDate>clock.today)throw new DriverIdentityValidationError("effectiveDate","A transfer cannot be dated in the future.")
 if(effectiveDate<source.effective_from)throw new DriverIdentityValidationError("effectiveDate","A transfer cannot start before the assignment it ends.")
 const transferId=randomUUID(),newId=randomUUID(),n=input.driverNumber?.trim()||null
 await guarded(ctx,async()=>{
  await repo.closeAssignment(ctx.client,{id:source.id,effectiveTo:effectiveDate,closedAt:clock.ts,endReason:"TRANSFERRED",transferId})
  await repo.insertOrganizationDriverRelationship(ctx.client,{id:newId,organizationId:to,personId,relationshipType:input.relationshipType,driverDisplay:n,driverNormalized:n?normalizeUnitNumber(n):null,
   status:input.status??"ONBOARDING",effectiveFrom:effectiveDate,activatedAt:clock.ts,transferId})
 },()=>new DriverIdentityConflictError(DRIVER_ASSIGNMENT_ELSEWHERE_MESSAGE))
 await mrRelationshipChange(ctx,"RECORD_LINK_REMOVED","ORGANIZATION_DRIVER_TRANSFER_OUT",source.id,from,personId,source.status,"ENDED")
 await mr(ctx,"RECORD_LINK_ESTABLISHED","ORGANIZATION_DRIVER_TRANSFER_IN","organization_driver_relationships",newId,[`organization:${to}`,`person:${personId}`,`organization:${from}`])
 return {transferId,endedRelationshipId:source.id,relationshipId:newId,effectiveDate}
}

async function mrRelationshipChange(ctx:IdentityContext,eventType:string,operation:string,relationshipId:string,organizationId:string,personId:string,beforeStatus:string,afterStatus:string){
 await recordEvent(ctx.masterRegister,{eventType,actor:{actorType:ctx.actor.actorType,actorId:ctx.actor.id},
  action:{operation},target:{resourceType:"organization_driver_relationships",resourceId:relationshipId,subjectReferences:[`organization:${organizationId}`,`person:${personId}`]},
  source:{sourceType:"APPLICATION",component:"operational-identity",workflow:operation},
  classification:{materiality:"MATERIAL"},
  change:{changedFields:["status"],fieldChanges:[{field:"status",before:{kind:"LITERAL",value:beforeStatus},after:{kind:"LITERAL",value:afterStatus}}]},
  outcome:{result:"SUCCESS"}} as never)
}

export async function readAssignmentTimeline(ctx:IdentityContext,personId:string,filter:{onDate?:string;atInstant?:string}={}){
 await requireMigration0037(ctx,"The assignment timeline")
 if(filter.atInstant!==undefined&&Number.isNaN(Date.parse(filter.atInstant)))throw new DriverIdentityValidationError("atInstant","atInstant must be a timestamp.")
 return repo.listAssignmentTimeline(ctx.client,uuid(personId,"personId"),{onDate:day(filter.onDate,"onDate"),atInstant:filter.atInstant})
}

export const DRIVER_IDENTITY_DOCUMENT_TYPE="DRIVER_IDENTITY_DOCUMENT"

/**
 * Records that a driver identity was VERIFIED against evidence: a document of type DRIVER_IDENTITY_DOCUMENT that belongs to a company the driver
 * has an assignment record with, was verified by a reviewer, is stored with checked integrity and has not verified anything else. Nothing else
 * verifies an identity: a matching name, date of birth or licence number never does. The event is appended (the log is append-only) with a
 * Master Register event naming the evidence. An unresolved identity case blocks verification until TES resolves it.
 */
export async function verifyDriverIdentity(ctx:IdentityContext,decision:SystemAuthorizationDecision,input:DriverIdentityVerificationInput){
 await requireMigration0037(ctx,"Driver identity verification")
 await requireAdditionalSystemCapability(ctx.client,decision,"DRIVER_IDENTITY_VERIFY")
 const personId=uuid(input.personId,"personId"),organizationId=uuid(input.organizationId,"organizationId"),documentId=uuid(input.evidenceDocumentId,"evidenceDocumentId")
 if(!["LICENCE_DOCUMENT_REVIEW","GOVERNMENT_ID_REVIEW","REGISTRY_CONFIRMATION"].includes(input.method))throw new DriverIdentityValidationError("method","method must be LICENCE_DOCUMENT_REVIEW, GOVERNMENT_ID_REVIEW or REGISTRY_CONFIRMATION.")
 const licenceId=input.licenceId===undefined?null:uuid(input.licenceId,"licenceId")
 await activePerson(ctx,personId)
 if(!(await repo.hasDriverProfile(ctx.client,personId)))throw new DriverIdentityNotFoundError("Driver profile not found.")
 if(await identityIsAmbiguous(ctx,decision,personId))throw new DriverIdentityStateError(PENDING_IDENTITY_MESSAGE)
 if(!(await repo.hasOrganizationDriverHistory(ctx.client,organizationId,personId)))throw new DriverIdentityStateError("The evidence must come from a company the driver is recorded with. Nothing was saved.")
 await requireAdditionalSystemCapability(ctx.client,decision,"EVIDENCE_READ")
 await enterSystemCapability(ctx.client,"EVIDENCE_READ")
 const item=(await listEvidence(ctx.client,organizationId)).find((e)=>e.documentId===documentId)
 await enterSystemCapability(ctx.client,"DRIVER_MANAGE")
 const problems:string[]=[]
 if(!item)problems.push("The evidence document could not be found for that company.")
 else{
  if(item.documentType!==DRIVER_IDENTITY_DOCUMENT_TYPE)problems.push(`The evidence must be a ${DRIVER_IDENTITY_DOCUMENT_TYPE} document.`)
  if(item.documentStatus!=="verified")problems.push("The evidence has not been verified by a reviewer.")
  if(item.payload.state!=="stored"||!item.payload.integrityVerified)problems.push("The evidence is not securely stored with verified integrity.")
 }
 if(problems.length>0)throw new DriverIdentityStateError(`The identity cannot be verified yet: ${problems.join(" ")} Nothing was saved.`)
 const id=randomUUID()
 const event=await recordEvent(ctx.masterRegister,{eventType:"RECORD_CREATED",actor:{actorType:ctx.actor.actorType,actorId:ctx.actor.id},
  action:{operation:"DRIVER_IDENTITY_VERIFY"},target:{resourceType:"driver_identity_verifications",resourceId:id,companyId:organizationId,subjectReferences:[`person:${personId}`,`organization:${organizationId}`]},
  source:{sourceType:"APPLICATION",component:"operational-identity",workflow:"DRIVER_IDENTITY_VERIFY"},classification:{materiality:"MATERIAL"},
  change:{changedFields:["identityVerification"],fieldChanges:[{field:"identityVerification",after:ref("driver_identity_verifications",id)}]},
  evidence:{evidenceReferences:[`evidence_documents:${documentId}`]},outcome:{result:"SUCCESS"}} as never) as {eventId:string}
 await enterSystemCapability(ctx.client,"DRIVER_IDENTITY_VERIFY")
 await guarded(ctx,()=>repo.insertIdentityVerification(ctx.client,{id,personId,status:"VERIFIED",method:input.method,organizationId,evidenceDocumentId:documentId,licenceId,reason:null,actorId:ctx.actor.id,eventId:event.eventId}),
  ()=>new DriverIdentityConflictError("This evidence document already supports a different driver identity, so it cannot verify this one. Nothing was saved."))
 await enterSystemCapability(ctx.client,"DRIVER_MANAGE")
 return {verificationId:id}
}

/** Withdraws a verification (the earlier event stays in the log). The reason is required and kept on the event; the Master Register records who did it. */
export async function revokeDriverIdentityVerification(ctx:IdentityContext,decision:SystemAuthorizationDecision,input:DriverIdentityRevocationInput){
 await requireMigration0037(ctx,"Driver identity verification")
 await requireAdditionalSystemCapability(ctx.client,decision,"DRIVER_IDENTITY_VERIFY")
 const personId=uuid(input.personId,"personId"),reason=typeof input.reason==="string"?input.reason.trim():""
 if(reason.length<3||reason.length>500)throw new DriverIdentityValidationError("reason","reason must be 3 to 500 characters.")
 await activePerson(ctx,personId)
 const latest=await repo.latestIdentityVerification(ctx.client,personId)
 if(latest?.verification_status!=="VERIFIED")throw new DriverIdentityStateError("This identity is not currently verified. Nothing was changed.")
 const id=randomUUID()
 const event=await recordEvent(ctx.masterRegister,{eventType:"RECORD_CORRECTED",actor:{actorType:ctx.actor.actorType,actorId:ctx.actor.id},
  action:{operation:"DRIVER_IDENTITY_REVOKE"},target:{resourceType:"driver_identity_verifications",resourceId:id,subjectReferences:[`person:${personId}`]},
  source:{sourceType:"APPLICATION",component:"operational-identity",workflow:"DRIVER_IDENTITY_REVOKE"},classification:{materiality:"MATERIAL"},
  change:{changedFields:["identityVerification"],fieldChanges:[{field:"identityVerification",before:{kind:"LITERAL",value:"VERIFIED"},after:{kind:"LITERAL",value:"REVOKED"}}]},
  outcome:{result:"SUCCESS"}} as never) as {eventId:string}
 await enterSystemCapability(ctx.client,"DRIVER_IDENTITY_VERIFY")
 await repo.insertIdentityVerification(ctx.client,{id,personId,status:"REVOKED",method:null,organizationId:null,evidenceDocumentId:null,licenceId:null,reason,actorId:ctx.actor.id,eventId:event.eventId})
 await enterSystemCapability(ctx.client,"DRIVER_MANAGE")
 return {verificationId:id}
}

export async function beginResolution(ctx:IdentityContext,input:EntityResolutionInput){
 const sourceSystem=required(input.sourceSystem,"sourceSystem"),sourceRecordKey=normalizeSourceKey(required(input.sourceRecordKey,"sourceRecordKey"))
 const existing=await repo.getResolutionCaseBySource(ctx.client,sourceSystem,sourceRecordKey,input.entityType)
 if(existing)return {kind:"EXISTING" as const,caseId:existing.id,state:existing.resolution_state,outcome:existing.outcome}
 if(input.organizationContextId)await activeOrg(ctx,input.organizationContextId)
 const id=randomUUID()
 await repo.insertResolutionCase(ctx.client,{id,entityType:input.entityType,sourceSystem,sourceRecordKey,organizationContextId:input.organizationContextId??null})
 await mr(ctx,"ENTITY_RESOLUTION_COMPLETED","ENTITY_RESOLUTION_CASE_OPEN","entity_resolution_cases",id,input.organizationContextId?[`organization:${input.organizationContextId}`]:[])
 return {kind:"CREATED" as const,caseId:id}
}
