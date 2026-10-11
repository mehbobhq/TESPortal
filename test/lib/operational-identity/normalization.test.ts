import test from "node:test"
import assert from "node:assert/strict"
import { isStructurallyValidVin, normalizeDriverLicenceNumber, normalizePlate, normalizeUnitNumber, normalizeVin } from "../../../lib/operational-identity/normalization"
import { mapLegacyDriver, mapLegacyVehicle } from "../../../lib/operational-identity/legacy"

test("identity normalizers are deterministic",()=>{
 assert.equal(normalizeVin(" 1hg-cm82633a004352 "),"1HGCM82633A004352")
 assert.equal(isStructurallyValidVin("1HGCM82633A004352"),true)
 assert.equal(isStructurallyValidVin("1IOQ"),false)
 assert.equal(normalizePlate(" ab-12 3 "),"AB123")
 assert.equal(normalizeUnitNumber("  truck   01 "),"TRUCK 01")
 assert.equal(normalizeDriverLicenceNumber(" ab-123 45 "),"AB12345")
})

test("legacy vehicle mapping preserves raw display and canonical signals",()=>{
 const x=mapLegacyVehicle({id:"V1",vin:" 1hg-cm82633a004352 ",plate:" AB-123 ",unitNumber:" T  7 ",type:"Trailer"},"O1")
 assert.equal(x.vehicle.vinNormalized,"1HGCM82633A004352")
 assert.equal(x.vehicle.vehicleTypeCode,"TRAILER")
 assert.equal(x.operation.unitNormalized,"T 7")
 assert.equal(x.registration.plateNormalized,"AB123")
})

test("legacy driver mapping never invents a new human identity",()=>{
 const x=mapLegacyDriver({driverMasterId:"D1",identity:{legalFirstName:"A",legalLastName:"B"},licenceHistory:[{licenceNumber:" AB-123 " }]},"O1")
 assert.equal(x.legacyDriverMasterId,"D1")
 assert.equal(x.personIdentity.legalFirstName,"A")
 assert.equal(x.licences[0]?.licenceNumberNormalized,"AB123")
})
