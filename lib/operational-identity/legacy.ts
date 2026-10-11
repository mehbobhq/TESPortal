/**
 * Deterministic browser -> PostgreSQL identity mapping boundary.
 * This module performs no persistence. It converts legacy shapes into canonical commands so the later import job does
 * not redefine identity. Unknown/ambiguous facts stay explicit instead of being silently invented.
 */
import { normalizeDriverLicenceNumber, normalizePlate, normalizeUnitNumber, normalizeVin } from "./normalization.ts"

export function mapLegacyVehicle(raw: Record<string, unknown>, organizationId: string) {
 const vinDisplay=String(raw.vin??"").trim()
 const plateDisplay=String(raw.plate??raw.plateNumber??"").trim()
 const unitDisplay=String(raw.unitNumber??raw.unit??"").trim()
 return {
  organizationId,
  vehicle:{
   legacyId:String(raw.id??"").trim()||null,
   vehicleTypeCode:String(raw.vehicleType??raw.type??"OTHER").toUpperCase().includes("TRAILER")?"TRAILER":"TRUCK_TRACTOR",
   vinDisplay:vinDisplay||null,vinNormalized:vinDisplay?normalizeVin(vinDisplay):null,
   modelYear:typeof raw.year==="number"?raw.year:null,make:String(raw.make??"").trim()||null,model:String(raw.model??"").trim()||null,
  },
  operation:{relationshipType:"OPERATES" as const,unitDisplay:unitDisplay||null,unitNormalized:unitDisplay?normalizeUnitNumber(unitDisplay):null},
  registration:{plateDisplay:plateDisplay||null,plateNormalized:plateDisplay?normalizePlate(plateDisplay):null,
   jurisdiction:String(raw.plateJurisdiction??raw.jurisdiction??"").trim()||null},
 }
}

export function mapLegacyDriver(raw: Record<string, unknown>, organizationId: string) {
 const identity=(raw.identity&&typeof raw.identity==="object"?raw.identity:{}) as Record<string,unknown>
 const licences=Array.isArray(raw.licenceHistory)?raw.licenceHistory as Record<string,unknown>[]:[]
 return {
  organizationId,
  legacyDriverMasterId:String(raw.driverMasterId??raw.id??"").trim()||null,
  personIdentity:{
   legalFirstName:String(identity.legalFirstName??"").trim(),legalLastName:String(identity.legalLastName??"").trim(),
   dateOfBirth:String(identity.dateOfBirth??"").trim()||null,
  },
  licences:licences.map(l=>({
   licenceNumberDisplay:String(l.licenceNumber??l.licenceNumberRaw??"").trim(),
   licenceNumberNormalized:normalizeDriverLicenceNumber(String(l.licenceNumberNormalized??l.licenceNumber??l.licenceNumberRaw??"")),
   jurisdictionCountry:String(l.country??l.jurisdictionCountry??"").trim()||null,
   jurisdictionRegion:String(l.jurisdiction??l.jurisdictionRegion??"").trim()||null,
  })),
 }
}
