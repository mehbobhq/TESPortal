import {
  VehicleOperationConflictError,
  VehicleOperationNotFoundError,
  VehicleOperationStateError,
  VehicleOperationValidationError,
} from "./vehicle-errors"

/**
 * Gives the failures of vehicle creation (operations.createVehicle / establishOrganizationVehicle, which throw plain Errors and let
 * database constraint violations escape) a meaning the response layer can classify, instead of every one of them becoming a
 * generic 500. It changes the response CLASS only: nothing is retried or relaxed, the transaction still rolls back, and any error
 * not recognised here (authorization, infrastructure, unknown) is rethrown unchanged so it keeps failing closed.
 *
 * Recognition uses what the failure carries explicitly (the PostgreSQL error `code` / `constraint`, and the fixed messages of the
 * two operations), never `constructor.name` (minified in production builds). No VIN, unit number or database text is passed on.
 */
type DatabaseFailure = { code?: unknown; constraint?: unknown }

export function classifyVehicleCreateFailure(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const { code, constraint } = error as Error & DatabaseFailure
  if (code === "23505") {
    if (constraint === "organization_vehicle_current_unit_uq") {
      return new VehicleOperationConflictError("This unit number is already used by another current vehicle of this company.")
    }
    if (constraint === "organization_vehicle_current_relationship_uq") {
      return new VehicleOperationConflictError("This vehicle is already a current vehicle of this company.")
    }
    return new VehicleOperationConflictError("This vehicle conflicts with an existing record.")
  }
  if (code === "23502" || code === "23503" || code === "23514" || code === "22P02" || code === "22007" || code === "22008") {
    return new VehicleOperationValidationError("vehicle", "Some submitted vehicle information is not valid.")
  }
  if (code !== undefined) return error
  if (error.message === "VIN is structurally invalid.") return new VehicleOperationValidationError("vin", error.message)
  if (/^[A-Za-z]+ is required\.$/.test(error.message)) return new VehicleOperationValidationError("vehicle", error.message)
  if (error.message === "Organization not found.") return new VehicleOperationNotFoundError("Company")
  if (error.message === "Organization must be active.") return new VehicleOperationStateError("This company is not active.")
  return error
}
