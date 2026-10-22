import "server-only"
import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as operations from "./operations"
import type { DriverIdentityRevocationInput, DriverIdentityVerificationInput, EndOrganizationDriverInput, TransferOrganizationDriverInput, DriverLicenceInput, DriverProfileCreateInput, EntityResolutionInput, OrganizationDriverRelationshipInput, OrganizationVehicleRelationshipInput, VehicleCreateInput } from "./types"
export type * from "./types"

const context=(client:PoolClient,decision:SystemAuthorizationDecision):operations.IdentityContext=>({
 client,actor:{id:decision.actor.id,actorType:decision.actor.actorType},masterRegister:new PostgresMasterRegisterRepository(client)
})

export const createVehicle=(input:VehicleCreateInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>operations.createVehicle(context(c,d),input))
export const establishOrganizationVehicle=(input:OrganizationVehicleRelationshipInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>operations.establishOrganizationVehicle(context(c,d),input))
/**
 * Creates a vehicle identity AND its relationship to the Organization in ONE transaction: if the relationship cannot be
 * recorded (for example the Organization is archived), no orphan vehicle is left behind.
 */
export const createVehicleForOrganization=(
 vehicle:VehicleCreateInput,
 relationship:Omit<OrganizationVehicleRelationshipInput,"vehicleId">,
)=>withAuthorizedSystem("VEHICLE_MANAGE",async(c,d)=>{
 const ctx=context(c,d)
 const created=await operations.createVehicle(ctx,vehicle)
 if(created.kind==="EXISTING")await operations.assertVehicleNotInUseElsewhere(ctx,created.vehicleId,relationship.organizationId)
 const established=await operations.establishOrganizationVehicle(ctx,{...relationship,vehicleId:created.vehicleId} as OrganizationVehicleRelationshipInput)
 return {vehicle:created,relationship:established}
})
export const createDriverProfile=(input:DriverProfileCreateInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.createDriverProfile(context(c,d),input))
export const addDriverLicence=(input:DriverLicenceInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.addDriverLicence(context(c,d),input))
export const establishOrganizationDriver=(input:OrganizationDriverRelationshipInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.establishOrganizationDriver(context(c,d),input,d))
export const endOrganizationDriver=(input:EndOrganizationDriverInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.endOrganizationDriver(context(c,d),input))
export const transferOrganizationDriver=(input:TransferOrganizationDriverInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.transferOrganizationDriver(context(c,d),d,input))
/** Needs DRIVER_MANAGE (to read the driver) AND DRIVER_IDENTITY_VERIFY, EVIDENCE_READ and IDENTITY_RESOLUTION_READ (checked in the operation, never granted). */
export const verifyDriverIdentity=(input:DriverIdentityVerificationInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.verifyDriverIdentity(context(c,d),d,input))
export const revokeDriverIdentityVerification=(input:DriverIdentityRevocationInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.revokeDriverIdentityVerification(context(c,d),d,input))
export const readDriverAssignmentTimeline=(personId:string,filter?:{onDate?:string;atInstant?:string})=>withAuthorizedSystem("DRIVER_READ",(c,d)=>operations.readAssignmentTimeline(context(c,d),personId,filter))
export const readDriverIdentityVerification=(personId:string)=>withAuthorizedSystem("DRIVER_READ",(c,d)=>operations.readIdentityVerification(context(c,d),personId))
export const beginEntityResolution=(input:EntityResolutionInput)=>withAuthorizedSystem("IDENTITY_RESOLUTION_MANAGE",(c,d)=>operations.beginResolution(context(c,d),input))
