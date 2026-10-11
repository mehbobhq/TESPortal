import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType } from "@/lib/master-register/types"
import { normalizeDriverLicenceNumber, normalizeSourceKey, normalizeUnitNumber, normalizeVin, isStructurallyValidVin } from "./normalization"
import * as repo from "./repository"
import type { DriverLicenceInput, DriverProfileCreateInput, EntityResolutionInput, OrganizationDriverRelationshipInput, OrganizationVehicleRelationshipInput, VehicleCreateInput } from "./types"

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

export async function createVehicle(ctx:IdentityContext,input:VehicleCreateInput){
 const vin=input.vin?normalizeVin(input.vin):null
 if(vin&&!isStructurallyValidVin(vin))throw new Error("VIN is structurally invalid.")
 if(vin){const existing=await repo.findVehicleByVin(ctx.client,vin);if(existing) return {kind:"EXISTING" as const,vehicleId:existing.id}}
 const id=randomUUID()
 await repo.insertVehicle(ctx.client,{id,vehicleTypeCode:input.vehicleTypeCode,vinDisplay:input.vin?.trim()||null,vinNormalized:vin,
  modelYear:input.modelYear??null,make:input.make?.trim()||null,model:input.model?.trim()||null})
 await mr(ctx,"RECORD_CREATED","VEHICLE_CREATE","vehicles",id,[`vehicle:${id}`])
 return {kind:"CREATED" as const,vehicleId:id}
}

export async function establishOrganizationVehicle(ctx:IdentityContext,input:OrganizationVehicleRelationshipInput){
 await activeOrg(ctx,input.organizationId)
 const id=randomUUID(),unit=input.unitNumber?.trim()||null
 await repo.insertOrganizationVehicleRelationship(ctx.client,{id,organizationId:input.organizationId,vehicleId:input.vehicleId,
  relationshipType:input.relationshipType,unitDisplay:unit,unitNormalized:unit?normalizeUnitNumber(unit):null,effectiveFrom:required(input.effectiveFrom,"effectiveFrom")})
 await mr(ctx,"RECORD_LINK_ESTABLISHED","ORGANIZATION_VEHICLE_ESTABLISH","organization_vehicle_relationships",id,[`organization:${input.organizationId}`,`vehicle:${input.vehicleId}`])
 return {relationshipId:id}
}

export async function createDriverProfile(ctx:IdentityContext,input:DriverProfileCreateInput){
 await activePerson(ctx,input.personId)
 await repo.insertDriverProfile(ctx.client,input.personId)
 await mr(ctx,"RECORD_CREATED","DRIVER_PROFILE_CREATE","driver_profiles",input.personId,[`person:${input.personId}`])
 return {personId:input.personId}
}

export async function addDriverLicence(ctx:IdentityContext,input:DriverLicenceInput){
 await activePerson(ctx,input.personId)
 const number=normalizeDriverLicenceNumber(input.licenceNumber)
 if(!number)throw new Error("licenceNumber is required.")
 const existing=await repo.findDriverByLicence(ctx.client,required(input.jurisdictionCountry,"jurisdictionCountry"),required(input.jurisdictionRegion,"jurisdictionRegion"),number)
 if(existing&&existing.person_id!==input.personId)return {kind:"CONFLICT" as const,personId:existing.person_id}
 const id=randomUUID()
 await repo.insertDriverLicence(ctx.client,{id,personId:input.personId,country:input.jurisdictionCountry.trim(),region:input.jurisdictionRegion.trim(),
  display:input.licenceNumber.trim(),normalized:number,licenceClass:input.licenceClass?.trim()||null,issueDate:input.issueDate??null,expiryDate:input.expiryDate??null,effectiveFrom:input.effectiveFrom})
 await mr(ctx,"RECORD_CREATED","DRIVER_LICENCE_CREATE","driver_licences",id,[`person:${input.personId}`])
 return {kind:"CREATED" as const,licenceId:id}
}

export async function establishOrganizationDriver(ctx:IdentityContext,input:OrganizationDriverRelationshipInput){
 await activeOrg(ctx,input.organizationId);await activePerson(ctx,input.personId)
 const id=randomUUID(),n=input.driverNumber?.trim()||null
 await repo.insertOrganizationDriverRelationship(ctx.client,{id,organizationId:input.organizationId,personId:input.personId,
  relationshipType:input.relationshipType,driverDisplay:n,driverNormalized:n?normalizeUnitNumber(n):null,status:input.status,effectiveFrom:input.effectiveFrom})
 await mr(ctx,"RECORD_LINK_ESTABLISHED","ORGANIZATION_DRIVER_ESTABLISH","organization_driver_relationships",id,[`organization:${input.organizationId}`,`person:${input.personId}`])
 return {relationshipId:id}
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
