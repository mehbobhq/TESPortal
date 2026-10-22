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

export type LicenceRow={id:string;person_id:string;country:string;region:string;normalized:string}

/**
 * Current licences that could be the same licence as number or that the person already holds. The caller compares the CANONICAL
 * jurisdiction, so "Canada"/"CA" and "Ontario"/"ON" are the same licence whatever spelling an older row was stored in.
 */
export async function findCurrentLicenceCandidates(client: Queryable,number:string,personId:string) {
  const r=await client.query<LicenceRow>(
    `SELECT id,person_id,jurisdiction_country AS country,jurisdiction_region AS region,licence_number_normalized AS normalized
       FROM public.driver_licences
      WHERE record_status='active' AND effective_to IS NULL AND (licence_number_normalized=$1 OR person_id=$2)`,[number,personId])
  return r.rows
}

export type OpenAssignmentRow={id:string;organization_id:string;status:string;effective_from:string;relationship_type:string}

/** The person's open assignments (any company), locked. Callers hold the person lock first, so concurrent writers for one person serialize. */
export async function lockOpenAssignments(client: Queryable,personId:string) {
  const r=await client.query<OpenAssignmentRow>(
    `SELECT id,organization_id,status,relationship_type,to_char(effective_from,'YYYY-MM-DD') AS effective_from
       FROM public.organization_driver_relationships
      WHERE person_id=$1 AND record_status='active' AND effective_to IS NULL ORDER BY id FOR UPDATE`,[personId])
  return r.rows
}

/** True when an unresolved PERSON entity-resolution case names this person as a candidate: the identity is pending or ambiguous. */
export async function hasUnresolvedIdentityCase(client: Queryable,personId:string) {
  const r=await client.query(
    `SELECT 1 FROM public.entity_resolution_candidates c JOIN public.entity_resolution_cases k ON k.id=c.resolution_case_id
      WHERE c.candidate_person_id=$1 AND k.entity_type='PERSON' AND k.resolution_state IN ('PENDING','REVIEW_REQUIRED') LIMIT 1`,[personId])
  return (r.rowCount??0)>0
}

export async function hasDriverProfile(client: Queryable,personId:string) {
  const r=await client.query("SELECT 1 FROM public.driver_profiles WHERE person_id=$1",[personId])
  return (r.rowCount??0)>0
}

export async function hasOrganizationDriverHistory(client: Queryable,organizationId:string,personId:string) {
  const r=await client.query("SELECT 1 FROM public.organization_driver_relationships WHERE organization_id=$1 AND person_id=$2 AND record_status='active' LIMIT 1",[organizationId,personId])
  return (r.rowCount??0)>0
}

export async function dbClock(client: Queryable) {
  // ts is returned as TEXT with microseconds so the very same instant can be written to two rows (a JS Date would truncate to milliseconds).
  const r=await client.query<{ts:string;today:string}>("SELECT to_char(t.ts AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS ts,to_char(t.ts AT TIME ZONE 'UTC','YYYY-MM-DD') AS today FROM (SELECT clock_timestamp() AS ts) t")
  return r.rows[0]
}

/** The current verification state is the LATEST event of the append-only verification log. */
export async function latestIdentityVerification(client: Queryable,personId:string) {
  const r=await client.query<{id:string;verification_status:"VERIFIED"|"REVOKED";method:string|null;recorded_at:Date}>(
    "SELECT id,verification_status,method,recorded_at FROM public.driver_identity_verifications WHERE person_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1",[personId])
  return r.rows[0]
}

export async function insertIdentityVerification(client: Queryable,v:{
 id:string;personId:string;status:"VERIFIED"|"REVOKED";method:string|null;organizationId:string|null;evidenceDocumentId:string|null;licenceId:string|null;reason:string|null;actorId:string;eventId:string
}) {
 await client.query(`INSERT INTO public.driver_identity_verifications
 (id,person_id,verification_status,method,organization_id,evidence_document_id,licence_id,reason,verified_by_actor_id,master_register_event_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[v.id,v.personId,v.status,v.method,v.organizationId,v.evidenceDocumentId,v.licenceId,v.reason,v.actorId,v.eventId])
}

export async function closeAssignment(client: Queryable,v:{id:string;effectiveTo:string;closedAt:string;endReason:"ENDED"|"TRANSFERRED";transferId:string|null}) {
 const r=await client.query(
  `UPDATE public.organization_driver_relationships SET status='ENDED',effective_to=$2::date,closed_at=$3::timestamptz,end_reason=$4,transfer_id=$5,updated_at=clock_timestamp()
    WHERE id=$1 AND record_status='active' AND effective_to IS NULL`,[v.id,v.effectiveTo,v.closedAt,v.endReason,v.transferId])
 if(r.rowCount!==1)throw new Error("The assignment could not be closed.")
}

export async function lockVehicle(client: Queryable, id: string) {
  const r=await client.query<{id:string;record_status:string}>("SELECT id,record_status FROM public.vehicles WHERE id=$1 FOR UPDATE",[id])
  return r.rows[0]
}

export type OpenVehicleRelationshipRow={id:string;organization_id:string;relationship_type:string}

/** The vehicle's open relationships with ANY company, locked. Callers hold the vehicle lock first, so concurrent writers for one vehicle serialize. */
export async function lockOpenVehicleRelationships(client: Queryable,vehicleId:string) {
  const r=await client.query<OpenVehicleRelationshipRow>(
    `SELECT id,organization_id,relationship_type FROM public.organization_vehicle_relationships
      WHERE vehicle_id=$1 AND record_status='active' AND effective_to IS NULL ORDER BY id FOR UPDATE`,[vehicleId])
  return r.rows
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
 activatedAt?:string|null;transferId?:string|null
}) {
 // activated_at / transfer_id exist only from migration 0037; they are written only when supplied (the 0037 operations).
 const extra=v.activatedAt||v.transferId
 await client.query(`INSERT INTO public.organization_driver_relationships
 (id,organization_id,person_id,relationship_type,driver_number_display,driver_number_normalized,status,effective_from${extra?",activated_at,transfer_id":""})
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::date${extra?",$9::timestamptz,$10":""})`,
 [v.id,v.organizationId,v.personId,v.relationshipType,v.driverDisplay,v.driverNormalized,v.status,v.effectiveFrom,...(extra?[v.activatedAt??null,v.transferId??null]:[])])
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

export type TimelineRow={id:string;organization_id:string;status:string;relationship_type:string;effective_from:string;effective_to:string|null;
 activated_at:string|null;closed_at:string|null;end_reason:string|null;transfer_id:string|null}

/**
 * The driver's assignment timeline, oldest first by the instant TES opened each row (created_at for rows recorded before 0037), with both time
 * dimensions: business dates and recording instants. Optional filters: rows that touch a business DAY (a same-day [D,D] period counts), or the
 * row that held the driver at an INSTANT. Needs migration 0037 (the instant columns).
 */
export async function listAssignmentTimeline(client: Queryable,personId:string,filter:{onDate?:string;atInstant?:string}={}) {
 const start="COALESCE(activated_at,created_at)"
 const end="CASE WHEN effective_to IS NULL THEN 'infinity'::timestamptz ELSE COALESCE(closed_at,(effective_to::timestamp AT TIME ZONE 'UTC')) END"
 const params:unknown[]=[personId]
 let where=""
 if(filter.onDate){params.push(filter.onDate);where+=` AND effective_from<=$${params.length}::date AND (effective_to IS NULL OR effective_to>=$${params.length}::date)`}
 if(filter.atInstant){params.push(filter.atInstant);where+=` AND ${start}<=$${params.length}::timestamptz AND ${end}>$${params.length}::timestamptz`}
 const r=await client.query<TimelineRow>(
  `SELECT id,organization_id,status,relationship_type,to_char(effective_from,'YYYY-MM-DD') AS effective_from,to_char(effective_to,'YYYY-MM-DD') AS effective_to,
          to_char(activated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS activated_at,to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closed_at,end_reason,transfer_id
     FROM public.organization_driver_relationships WHERE person_id=$1 AND record_status='active'${where} ORDER BY ${start},id`,params)
 return r.rows
}
