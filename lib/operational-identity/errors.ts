/**
 * Driver identity errors. The class NAME decides the HTTP status (lib/api/canonical-response.ts): ...ValidationError 400, ...NotFoundError 404,
 * ...StateError / ...ConflictError 409. Messages are written for the caller and never contain another company's identifiers, names or
 * person IDs; the conflicting record is deliberately not described beyond the fact of the conflict.
 */
export class DriverIdentityValidationError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.field = field
  }
}

export class DriverIdentityNotFoundError extends Error {}

export class DriverIdentityStateError extends Error {}

/** A verified uniqueness or exclusivity rule was hit. Nothing was saved. */
export class DriverIdentityConflictError extends Error {}

/** Vehicle identity / relationship conflicts. Same naming convention (HTTP 409 / 404); messages never name another company. */
export class VehicleIdentityConflictError extends Error {}
export class VehicleIdentityNotFoundError extends Error {}

export const VEHICLE_HELD_ELSEWHERE_MESSAGE =
  "This vehicle is already recorded and currently in use by another company. A vehicle has one current owner and one current operator, so that relationship must be ended first. Nothing was saved."
export const VEHICLE_OVERLAP_MESSAGE = "This relationship overlaps a period already recorded for this vehicle and company. Nothing was saved."
export const VEHICLE_HELD_HERE_MESSAGE = "This vehicle already has a current relationship of this type with this company. Nothing was saved."

export const DRIVER_LICENCE_CONFLICT_MESSAGE =
  "This licence is already recorded for another driver identity, so it cannot be saved here. Nothing was saved. If this is the same person, TES must review the duplicate."
export const DRIVER_ASSIGNMENT_ELSEWHERE_MESSAGE =
  "This driver already holds an open assignment with a company. TES allows one open assignment per driver, so it must be ended or transferred before another is recorded. Nothing was saved."
export const DRIVER_ASSIGNMENT_HERE_MESSAGE = "This driver already has an open assignment with this company. Nothing was saved."
