import type { Scalar } from "./validation"

/**
 * Safety restrictions and follow-up that the RECORDED FACTS of an event oblige the system to hold. They are derived from what a person stated (an inspector's
 * out-of-service order, "vehicle not safe to operate"); nothing here decides that an order is lawful, that a deadline has passed or that a carrier is compliant
 * (the regulatory texts could not be verified in the build environment, so no deadline or compliance conclusion is computed).
 *
 * An obligation that exists is created automatically (idempotent) and can only be discharged by the documented release, never by a status change or by
 * correcting the answer that created it.
 */

export type RequiredRestriction = {
  /** stable key: one restriction per key per event */
  key: string
  restrictionKind: "DRIVER_OUT_OF_SERVICE" | "VEHICLE_OUT_OF_SERVICE" | "TRAILER_OUT_OF_SERVICE" | "EQUIPMENT_HOLD" | "CARGO_HOLD" | "DRIVER_STAND_DOWN" | "OTHER_SAFETY"
  authority: "ENFORCEMENT" | "REGULATOR" | "COMPANY" | "OTHER"
  subjectType: "DRIVER" | "VEHICLE" | "TRAILER" | "CARGO" | "OTHER"
  /** the answer that created it, shown with the restriction */
  basis: string
  requiredCorrection: string | null
}

export type RequiredAction = { key: string; actionType: "CORRECTIVE" | "REPAIR" | "REPORT" | "INVESTIGATION" | "NOTIFICATION"; title: string; description: string }

export type Obligations = { restrictions: RequiredRestriction[]; actions: RequiredAction[] }

const yes = (v: Scalar | undefined) => v === "YES"

export function deriveObligations(categoryCode: string, facts: Record<string, Scalar>): Obligations {
  const restrictions: RequiredRestriction[] = []
  const actions: RequiredAction[] = []
  if (categoryCode === "ROADSIDE_INSPECTION") {
    if (yes(facts.driverOOSState)) {
      restrictions.push({ key: "ROADSIDE_DRIVER_OOS", restrictionKind: "DRIVER_OUT_OF_SERVICE", authority: "ENFORCEMENT", subjectType: "DRIVER", basis: "Roadside inspection reports the driver out of service.", requiredCorrection: null })
    }
    if (yes(facts.vehicleOOSState)) {
      restrictions.push({ key: "ROADSIDE_VEHICLE_OOS", restrictionKind: "VEHICLE_OUT_OF_SERVICE", authority: "ENFORCEMENT", subjectType: "VEHICLE", basis: "Roadside inspection reports the vehicle out of service.", requiredCorrection: null })
    }
    if (restrictions.length) {
      actions.push({ key: "ROADSIDE_OOS_CORRECTION", actionType: "REPAIR", title: "Document the correction and the authoritative release", description: "Record the correction made and attach the release evidence before the out-of-service restriction can be released." })
    }
  }
  if (categoryCode === "EQUIPMENT_FAILURE" && facts.vehicleSafeToOperate === "NO") {
    restrictions.push({ key: "EQUIPMENT_NOT_SAFE", restrictionKind: "EQUIPMENT_HOLD", authority: "COMPANY", subjectType: "VEHICLE", basis: "Event states the vehicle is not safe to operate.", requiredCorrection: null })
    actions.push({ key: "EQUIPMENT_REPAIR", actionType: "REPAIR", title: "Repair and certify before return to service", description: "Record the repair (link the repair order) before the equipment hold is released." })
  }
  return { restrictions, actions }
}
