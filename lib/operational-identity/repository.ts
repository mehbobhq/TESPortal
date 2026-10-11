import type { PoolClient } from "pg"

export type Queryable = Pick<PoolClient, "query">

export async function lockOrganization(client: Queryable, id: string) {
  const r = await client.query<{ id: string; status: string }>("SELECT id,status FROM public.organizations WHERE id=$1 FOR UPDATE",[id])
  return r.rows[0]
}

export async function lockPerson(client: Queryable, id: string) {
  const r = await client.query<{ id: string; record_status: string }>("SELECT id,record_status FROM public.persons WHERE id=$1 FOR UPDATE",[id])
  return r.rows[0]
}

export async function findVehicleByVin(client: Queryable, vin: string) {
  const r=await client.query<{id:string;record_status:string}>(
    "SELECT id,record_status FROM public.vehicles WHERE vin_normalized=$1 AND record_status<>'merged' LIMIT 1",[vin])
  return r.rows[0]
}

export async function findDriverByLicence(client: Queryable,country:string,region:string,number:string) {
  const r=await client.query<{person_id:string}>(
    `SELECT person_id FROM public.driver_licences
      WHERE jurisdiction_country=$1 AND jurisdiction_region=$2 AND licence_number_normalized=$3
        AND record_status='active' AND effective_to IS NULL LIMIT 1`,[country,region,number])
  return r.rows[0]
}

export async function insertVehicle(client: Queryable, v: {
 id:string; vehicleTypeCode:string; vinDisplay:string|null; vinNormalized:string|null; modelYear:number|null; make:string|null; model:string|null
}) {
 await client.query(`INSERT INTO public.vehicles(id,vehicle_type_code,vin_display,vin_normalized,model_year,make,model)
 VALUES($1,$2,$3,$4,$5,$6,$7)`,[v.id,v.vehicleTypeCode,v.vinDisplay,v.vinNormalized,v.modelYear,v.make,v.model])
}

export async function insertDriverProfile(client: Queryable, personId:string) {
 await client.query("INSERT INTO public.driver_profiles(person_id) VALUES($1)",[personId])
}

export async function insertDriverLicence(client: Queryable,v:{
 id:string;personId:string;country:string;region:string;display:string;normalized:string;licenceClass:string|null;issueDate:string|null;expiryDate:string|null;effectiveFrom:string
}) {
 await client.query(`INSERT INTO public.driver_licences
 (id,person_id,jurisdiction_country,jurisdiction_region,licence_number_display,licence_number_normalized,licence_class,issue_date,expiry_date,effective_from)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::date)`,
 [v.id,v.personId,v.country,v.region,v.display,v.normalized,v.licenceClass,v.issueDate,v.expiryDate,v.effectiveFrom])
}

export async function insertOrganizationVehicleRelationship(client: Queryable,v:{
 id:string;organizationId:string;vehicleId:string;relationshipType:string;unitDisplay:string|null;unitNormalized:string|null;effectiveFrom:string
}) {
 await client.query(`INSERT INTO public.organization_vehicle_relationships
 (id,organization_id,vehicle_id,relationship_type,unit_number_display,unit_number_normalized,effective_from)
 VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz)`,
 [v.id,v.organizationId,v.vehicleId,v.relationshipType,v.unitDisplay,v.unitNormalized,v.effectiveFrom])
}

export async function insertOrganizationDriverRelationship(client: Queryable,v:{
 id:string;organizationId:string;personId:string;relationshipType:string;driverDisplay:string|null;driverNormalized:string|null;status:string;effectiveFrom:string
}) {
 await client.query(`INSERT INTO public.organization_driver_relationships
 (id,organization_id,person_id,relationship_type,driver_number_display,driver_number_normalized,status,effective_from)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::date)`,
 [v.id,v.organizationId,v.personId,v.relationshipType,v.driverDisplay,v.driverNormalized,v.status,v.effectiveFrom])
}

export async function insertResolutionCase(client: Queryable,v:{
 id:string;entityType:string;sourceSystem:string;sourceRecordKey:string;organizationContextId:string|null
}) {
 await client.query(`INSERT INTO public.entity_resolution_cases
 (id,entity_type,source_system,source_record_key,organization_context_id)
 VALUES($1,$2,$3,$4,$5)`,[v.id,v.entityType,v.sourceSystem,v.sourceRecordKey,v.organizationContextId])
}

export async function getResolutionCaseBySource(client: Queryable,sourceSystem:string,sourceRecordKey:string,entityType:string) {
 const r=await client.query<{id:string;resolution_state:string;outcome:string|null}>(
  "SELECT id,resolution_state,outcome FROM public.entity_resolution_cases WHERE source_system=$1 AND source_record_key=$2 AND entity_type=$3",
  [sourceSystem,sourceRecordKey,entityType])
 return r.rows[0]
}
