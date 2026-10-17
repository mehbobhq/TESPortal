import "server-only"
import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as operations from "./operations"
import * as lifecycle from "./vehicle-lifecycle"
import { classifyVehicleCreateFailure } from "./vehicle-create-failure"
import type { DriverLicenceInput, DriverProfileCreateInput, EntityResolutionInput, OrganizationDriverRelationshipInput, OrganizationVehicleRelationshipInput, VehicleCreateInput } from "./types"
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
 try{
  const created=await operations.createVehicle(ctx,vehicle)
  const established=await operations.establishOrganizationVehicle(ctx,{...relationship,vehicleId:created.vehicleId} as OrganizationVehicleRelationshipInput)
  return {vehicle:created,relationship:established}
 }catch(error){throw classifyVehicleCreateFailure(error)}
})
export const createDriverProfile=(input:DriverProfileCreateInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.createDriverProfile(context(c,d),input))
export const addDriverLicence=(input:DriverLicenceInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.addDriverLicence(context(c,d),input))
export const establishOrganizationDriver=(input:OrganizationDriverRelationshipInput)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>operations.establishOrganizationDriver(context(c,d),input))
export const beginEntityResolution=(input:EntityResolutionInput)=>withAuthorizedSystem("IDENTITY_RESOLUTION_MANAGE",(c,d)=>operations.beginResolution(context(c,d),input))

// --- vehicle lifecycle (registration periods, archive / restore, relationship end, unit number) --------------------
// Operations live in vehicle-lifecycle.ts; every one is organization-scoped and writes its Master Register event in the same transaction.
export * from "./vehicle-errors"
export type { AddRegistrationInput, ChangeRegistrationInput, CorrectRegistrationInput, VoidRegistrationInput, VehicleLifecycleInput, EndRelationshipInput, UnitNumberInput } from "./vehicle-lifecycle"
export const addVehicleRegistration=(input:lifecycle.AddRegistrationInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.addVehicleRegistration(context(c,d),input))
export const changeVehicleRegistration=(input:lifecycle.ChangeRegistrationInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.changeVehicleRegistration(context(c,d),input))
export const correctVehicleRegistration=(input:lifecycle.CorrectRegistrationInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.correctVehicleRegistration(context(c,d),input))
export const voidVehicleRegistration=(input:lifecycle.VoidRegistrationInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.voidVehicleRegistration(context(c,d),input))
export const archiveVehicle=(input:lifecycle.VehicleLifecycleInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.archiveVehicle(context(c,d),input))
export const restoreVehicle=(input:lifecycle.VehicleLifecycleInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.restoreVehicle(context(c,d),input))
export const endVehicleRelationship=(input:lifecycle.EndRelationshipInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.endVehicleRelationship(context(c,d),input))
export const changeVehicleUnitNumber=(input:lifecycle.UnitNumberInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.changeVehicleUnitNumber(context(c,d),input))
export const correctVehicleUnitNumber=(input:lifecycle.UnitNumberInput)=>withAuthorizedSystem("VEHICLE_MANAGE",(c,d)=>lifecycle.correctVehicleUnitNumber(context(c,d),input))

// --- Driver operations (UI recovery): see driver-operations.ts. Appended block; vehicle-* operations are wired separately. ---
import * as driverOperations from "./driver-operations"
export { DriverConflictError, DriverNotFoundError, DriverStateError, DriverValidationError } from "./driver-errors"
export type { CreateDriverResult, ExistingDriverMatch } from "./driver-operations"
export const checkExistingDriver=(organizationId:string,input:unknown)=>withAuthorizedSystem("DRIVER_READ",(c)=>driverOperations.checkExistingDriver(c,organizationId,input))
export const createDriver=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.createDriver(context(c,d),input))
export const addExistingDriver=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.addExistingDriver(context(c,d),input))
export const changeDriverName=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.changeDriverName(context(c,d),input))
export const correctDriverName=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.correctDriverName(context(c,d),input))
export const setDriverChannel=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.setDriverChannel(context(c,d),input))
export const changeDriverRelationship=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.changeDriverRelationship(context(c,d),input))
export const correctDriverRelationship=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.correctDriverRelationship(context(c,d),input))
export const endDriverRelationship=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.endDriverRelationship(context(c,d),input))
export const recordDriverLicence=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.recordDriverLicence(context(c,d),input))
export const correctDriverLicence=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.correctDriverLicence(context(c,d),input))
export const voidDriverLicence=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.voidDriverLicence(context(c,d),input))
export const addMedicalPeriod=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.addMedicalPeriod(context(c,d),input))
export const changeMedicalPeriod=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.changeMedicalPeriod(context(c,d),input))
export const correctMedicalPeriod=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.correctMedicalPeriod(context(c,d),input))
export const voidMedicalPeriod=(input:unknown)=>withAuthorizedSystem("DRIVER_MANAGE",(c,d)=>driverOperations.voidMedicalPeriod(context(c,d),input))
