// lib/asset-validation.ts

/**
 * Validates that a Vehicle (VIN or Plate) is not active in another company.
 */
export function validateVehicleUniqueness(newVin: string, newPlate: string, allVehicles: any[]) {
  const activeConflict = allVehicles.find(v => 
    (v.vin === newVin || v.plate === newPlate) && 
    v.status === 'Active'
  );

  if (activeConflict) {
    const conflictType = activeConflict.vin === newVin ? `VIN ${newVin}` : `Plate ${newPlate}`;
    return {
      isValid: false,
      message: `CRITICAL ERROR: ${conflictType} is currently 'Active' under unit ${activeConflict.unitNumber}. A vehicle cannot be active in two separate profiles simultaneously.`
    };
  }

  return { isValid: true, message: "Vehicle is clear to be activated." };
}

/**
 * Validates that a Driver's License is not active in another company.
 */
export function validateDriverUniqueness(newLicenseNumber: string, allDrivers: any[]) {
  const activeConflict = allDrivers.find(d => 
    d.licenseNumber === newLicenseNumber && 
    d.status === 'Active'
  );

  if (activeConflict) {
    return {
      isValid: false,
      message: `CRITICAL ERROR: Driver License '${newLicenseNumber}' is currently 'Active' under driver ${activeConflict.name}. A driver cannot be active in two separate companies simultaneously.`
    };
  }

  return { isValid: true, message: "Driver is clear to be activated." };
}
