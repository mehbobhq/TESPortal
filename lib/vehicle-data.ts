import {
  DeadlineRules,
  DeadlineStatus,
  VehicleDraft,
  VehicleRecord,
  Company,
  EquipmentType,
  RegistrationType,
} from "../types";

// Re-export shared mechanics for backward compatibility
export {
  DEFAULT_DEADLINE_RULES,
  getDaysRemaining,
  getDeadlineStatus,
  getDeadlineClasses as statusClasses,
} from "./deadline-engine";

export {
  JURISDICTIONS,
  resolveCountryForJurisdiction,
  getJurisdictionLabel,
} from "./jurisdictions";

export {
  normalizeVIN,
  normalizePlate,
  normalizeUSDOT,
  normalizeMC,
  normalizePhone,
  normalizeEmail,
  normalizeTaxId,
  is17CharVIN,
} from "./identifier-normalization";

export {
  recordAuditEvent,
  loadAuditEvents,
} from "./audit-logger";

import {
  DEFAULT_DEADLINE_RULES,
} from "./deadline-engine";

import {
  normalizeVIN,
  normalizePlate,
} from "./identifier-normalization";

export const SYSTEM_SETTINGS_KEY = "tes_system_settings";
export const COMPANIES_STORAGE_KEY = "tes_companies";

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days: number, fromDate: string = todayISO()): string {
  const d = new Date(`${fromDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function loadDeadlineRules(): DeadlineRules {
  try {
    const raw = localStorage.getItem(SYSTEM_SETTINGS_KEY);
    if (!raw) return DEFAULT_DEADLINE_RULES;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DEADLINE_RULES,
      ...(parsed.deadlineRules || parsed.expiryRules || {}),
    };
  } catch {
    return DEFAULT_DEADLINE_RULES;
  }
}

export function loadCompanies(): Company[] {
  try {
    const raw = localStorage.getItem(COMPANIES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  
  // Default fallback seed company
  const defaultCompanies: Company[] = [
    {
      id: "CMP-10492",
      name: "Power Way Logistics Inc.",
      kind: "Customer",
      region: "Cross-Border",
      regCorpState: "ON",
      regCorpCountry: "Canada",
      status: "Active",
      tone: "ok",
      contact: "Harpreet Singh",
      phone: "(905) 555-0192",
      email: "dispatch@powerwaylogistics.com",
    },
    {
      id: "CMP-20831",
      name: "Northern Star Freight Systems",
      kind: "Customer",
      region: "Canada Only",
      regCorpState: "AB",
      regCorpCountry: "Canada",
      status: "Active",
      tone: "ok",
      contact: "David Miller",
      phone: "(403) 555-4829",
      email: "safety@northernstar.ca",
    },
  ];
  localStorage.setItem(COMPANIES_STORAGE_KEY, JSON.stringify(defaultCompanies));
  return defaultCompanies;
}

/**
 * Validate VIN / Plate Uniqueness across the global company registry
 */
export function validateVehicleUniqueness(
  currentCompanyId: string,
  newVin: string,
  newPlate: string,
  currentVehicleId?: string
): { isValid: boolean; message?: string } {
  const normVin = newVin.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normPlate = newPlate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!normVin && !normPlate) return { isValid: true };

  const companies = loadCompanies();

  for (const comp of companies) {
    try {
      const rawVehicles = localStorage.getItem(`tes_company_vehicles_${comp.id}`);
      if (!rawVehicles) continue;
      const parsed = JSON.parse(rawVehicles);
      const list: VehicleRecord[] = Array.isArray(parsed?.vehicles) ? parsed.vehicles : [];

      for (const veh of list) {
        if (veh.id === currentVehicleId) continue;
        if (veh.status === "Archived" || veh.status === "Inactive") continue;

        const vVin = (veh.vin || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        const vPlate = (veh.registration?.plateNumber || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

        if (normVin && vVin && normVin === vVin) {
          const isSameCompany = comp.id === currentCompanyId;
          return {
            isValid: false,
            message: isSameCompany
              ? `VIN "${newVin}" is already assigned to active Unit ${veh.unitNumber} in this fleet.`
              : `COLLISION ERROR: VIN "${newVin}" is currently registered to active Unit ${veh.unitNumber} under ${comp.name} (${comp.id}). A vehicle cannot be active in two separate entities simultaneously.`,
          };
        }

        if (normPlate && vPlate && normPlate === vPlate) {
          const isSameCompany = comp.id === currentCompanyId;
          return {
            isValid: false,
            message: isSameCompany
              ? `License Plate "${newPlate}" is already assigned to Unit ${veh.unitNumber} in this fleet.`
              : `COLLISION ERROR: License Plate "${newPlate}" is currently active under ${comp.name} (${comp.id}) Unit ${veh.unitNumber}. Duplicate plates in multiple active fleets are prohibited.`,
          };
        }
      }
    } catch {}
  }

  return { isValid: true };
}

export type VehicleIdentifierResolutionMethod = "VIN_GLOBAL" | "PLATE_JURISDICTION" | "UNIT_COMPANY_SCOPED" | "MULTI_IDENTIFIER_AGREEMENT";
export type VehicleIdentifierResolutionState = "PENDING_SOURCE_DATA" | "AUTO_RESOLVED" | "UNRESOLVED" | "REVIEW_REQUIRED";

export interface VehicleIdentifierResolutionInput {
  vin?: string;
  plate?: string;
  plateJurisdiction?: string;
  unitNumber?: string;
}

export interface CanonicalVehicleResolution {
  state: VehicleIdentifierResolutionState;
  method?: VehicleIdentifierResolutionMethod;
  reason: string;
  canonicalVehicle?: VehicleRecord;
  canonicalCompanyId?: string;
  canonicalCompanyName?: string;
  canonicalPlateJurisdiction?: string;
  conflicts: string[];
  identifierDiscrepancies: string[];
  candidateVehicleIds: string[];
  evaluatedAt: string;
}

function normalizeIdentifier(value: string | undefined): string {
  return value ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

function registrationEffectiveOn(record: VehicleRegistrationRecord, asOfDate: string): boolean {
  if (record.archived || record.status === "Cancelled" || record.status === "Replaced") return false;
  if (record.registrationDate && record.registrationDate.slice(0, 10) > asOfDate) return false;
  if (record.expiryDate && record.expiryDate !== "Continuous" && record.expiryDate.slice(0, 10) < asOfDate) return false;
  return record.status === "Active" || record.status === "Draft";
}

function loadAllCompanyVehicleRecords(): Array<{ companyId: string; companyName?: string; vehicle: VehicleRecord; store: VehicleStore }> {
  const results: Array<{ companyId: string; companyName?: string; vehicle: VehicleRecord; store: VehicleStore }> = [];
  if (typeof window === "undefined") return results;
  const companies = loadCompanies();
  for (const company of companies) {
    try {
      const store = loadVehicleStore(company.id);
      for (const vehicle of store.vehicles) {
        if (vehicle.status === "Archived" || vehicle.status === "Inactive") continue;
        results.push({ companyId: company.id, companyName: company.name, vehicle, store });
      }
    } catch {}
  }
  return results;
}

function vehiclePlateMatches(entry: { vehicle: VehicleRecord; store: VehicleStore }, plate: string, jurisdiction: string, asOfDate: string): boolean {
  const normalizedPlate = normalizeIdentifier(plate);
  const normalizedJurisdiction = normalizeIdentifier(jurisdiction);
  if (!normalizedPlate || !normalizedJurisdiction) return false;
  const historical = entry.store.registrationRecords.some((record) =>
    record.vehicleId === entry.vehicle.id &&
    normalizeIdentifier(record.plate) === normalizedPlate &&
    normalizeIdentifier(record.stateProvince) === normalizedJurisdiction &&
    registrationEffectiveOn(record, asOfDate)
  );
  if (historical) return true;
  const embedded = entry.vehicle.registration;
  return Boolean(
    embedded &&
    normalizeIdentifier(embedded.plateNumber) === normalizedPlate &&
    normalizeIdentifier(embedded.jurisdiction) === normalizedJurisdiction
  );
}

/**
 * Platform-capable Vehicle identity resolution used by Performance and future modules.
 * VIN is global, Plate+jurisdiction is global/temporal, Unit is company-scoped only.
 * This function resolves identity only; it never establishes ownership, custody, responsibility, or attribution.
 */
export function resolveCanonicalVehicleByIdentifiers(
  operatingCompanyId: string,
  identifiers: VehicleIdentifierResolutionInput,
  asOfDate: string = todayISO(),
): CanonicalVehicleResolution {
  const evaluatedAt = isoNow();
  const vin = normalizeIdentifier(identifiers.vin);
  const plate = normalizeIdentifier(identifiers.plate);
  const jurisdiction = normalizeIdentifier(identifiers.plateJurisdiction);
  const unit = normalizeIdentifier(identifiers.unitNumber);
  if (!vin && !plate && !unit) {
    return { state: "PENDING_SOURCE_DATA", reason: "No source vehicle identifier is available yet.", conflicts: [], identifierDiscrepancies: [], candidateVehicleIds: [], evaluatedAt };
  }

  const all = loadAllCompanyVehicleRecords();
  const byId = new Map<string, { companyId: string; companyName?: string; vehicle: VehicleRecord; store: VehicleStore }>();
  for (const entry of all) byId.set(`${entry.companyId}:${entry.vehicle.id}`, entry);

  const vinMatches = vin ? all.filter((entry) => normalizeIdentifier(entry.vehicle.vin) === vin) : [];
  const plateMatches = plate && jurisdiction ? all.filter((entry) => vehiclePlateMatches(entry, plate, jurisdiction, asOfDate)) : [];
  const unitMatches = unit ? all.filter((entry) => entry.companyId === operatingCompanyId && normalizeIdentifier(entry.vehicle.unitNumber) === unit) : [];

  const candidateSets: Array<{ source: "VIN" | "PLATE" | "UNIT"; entries: typeof all }> = [];
  if (vin) candidateSets.push({ source: "VIN", entries: vinMatches });
  if (plate && jurisdiction) candidateSets.push({ source: "PLATE", entries: plateMatches });
  if (unit) candidateSets.push({ source: "UNIT", entries: unitMatches });

  const distinct = (entries: typeof all) => [...new Map(entries.map((entry) => [`${entry.companyId}:${entry.vehicle.id}`, entry])).values()];
  const union = distinct(candidateSets.flatMap((set) => set.entries));
  const availableSets = candidateSets.filter((set) => set.entries.length > 0);
  const intersections = availableSets.length > 1
    ? distinct(availableSets[0].entries.filter((entry) => availableSets.every((set) => set.entries.some((candidate) => candidate.companyId === entry.companyId && candidate.vehicle.id === entry.vehicle.id))))
    : availableSets[0]?.entries || [];

  // Authoritative identity is a two-question calculation. VIN and Plate +
  // Jurisdiction alone determine whether the authoritative identifiers agree
  // or conflict. Unit is intentionally excluded from this calculation.
  const authoritativeVinPlateAgreement = Boolean(
    vinMatches.length === 1 &&
    plateMatches.length === 1 &&
    vinMatches[0].companyId === plateMatches[0].companyId &&
    vinMatches[0].vehicle.id === plateMatches[0].vehicle.id
  );

  const conflicts: string[] = [];
  if (vinMatches.length > 1) conflicts.push("VIN identifies multiple active canonical Vehicle records.");
  if (plateMatches.length > 1) conflicts.push("Plate + issuing jurisdiction identify multiple active/effective canonical Vehicle records.");
  const authoritativeConflict = Boolean(
    vinMatches.length &&
    plateMatches.length &&
    !authoritativeVinPlateAgreement
  );
  if (authoritativeConflict) conflicts.push("Source VIN and Plate + Jurisdiction resolve to different canonical Vehicles.");

  // Unit is an operational/company-scoped identifier. It can contribute to a
  // resolution when authoritative identifiers are absent, but it can never
  // veto a deterministic VIN or Plate resolution. Preserve any mismatch as a
  // non-blocking discrepancy instead of classifying it as an identity conflict.
  const identifierDiscrepancies: string[] = [];
  if (vinMatches.length && unit && !vinMatches.some((entry) => unitMatches.some((u) => u.companyId === entry.companyId && u.vehicle.id === entry.vehicle.id))) {
    identifierDiscrepancies.push("Source Unit Number differs from the canonical Vehicle identified by VIN.");
  }
  if (plateMatches.length && unit && !plateMatches.some((entry) => unitMatches.some((u) => u.companyId === entry.companyId && u.vehicle.id === entry.vehicle.id)) && !identifierDiscrepancies.length) {
    identifierDiscrepancies.push("Source Unit Number differs from the canonical Vehicle identified by Plate + Jurisdiction.");
  }
  if (authoritativeConflict || vinMatches.length > 1 || plateMatches.length > 1) {
    return { state: "REVIEW_REQUIRED", method: undefined, reason: "IDENTITY / REGISTRATION CONFLICT", conflicts, identifierDiscrepancies, candidateVehicleIds: union.map((entry) => entry.vehicle.id), evaluatedAt };
  }

  // Authoritative identifiers determine physical identity before the weaker
  // Unit identifier is considered for agreement. A Unit mismatch therefore
  // cannot make an otherwise deterministic VIN/Plate resolution disappear.
  const authoritativeMatches = vinMatches.length === 1 ? vinMatches : plateMatches.length === 1 ? plateMatches : [];
  const authoritativeWinner = authoritativeMatches.length === 1 ? authoritativeMatches[0] : undefined;
  const winner = authoritativeWinner || (intersections.length === 1 ? intersections[0] : availableSets.length === 1 && availableSets[0].entries.length === 1 ? availableSets[0].entries[0] : undefined);
  if (winner) {
    const authoritativeMethod: VehicleIdentifierResolutionMethod | undefined = authoritativeVinPlateAgreement ? "MULTI_IDENTIFIER_AGREEMENT" : vinMatches.length === 1 ? "VIN_GLOBAL" : plateMatches.length === 1 ? "PLATE_JURISDICTION" : undefined;
    const method: VehicleIdentifierResolutionMethod = authoritativeMethod || (availableSets.length > 1 ? "MULTI_IDENTIFIER_AGREEMENT" : availableSets[0].source === "UNIT" ? "UNIT_COMPANY_SCOPED" : availableSets[0].source === "VIN" ? "VIN_GLOBAL" : "PLATE_JURISDICTION");
    const matchedPlate = winner.store.registrationRecords.find((record) => normalizeIdentifier(record.plate) === plate && normalizeIdentifier(record.stateProvince) === jurisdiction && registrationEffectiveOn(record, asOfDate));
    return {
      state: "AUTO_RESOLVED",
      method,
      reason: method === "VIN_GLOBAL" ? "Resolved by global VIN match." : method === "PLATE_JURISDICTION" ? "Resolved by Plate + issuing jurisdiction and effective registration." : method === "UNIT_COMPANY_SCOPED" ? "Resolved by Unit / Equipment Number within the operating-company context only." : "Multiple supplied identifiers agree on one canonical Vehicle.",
      canonicalVehicle: winner.vehicle,
      canonicalCompanyId: winner.companyId,
      canonicalCompanyName: winner.companyName,
      canonicalPlateJurisdiction: matchedPlate?.stateProvince || winner.vehicle.registration?.jurisdiction,
      conflicts: [],
      identifierDiscrepancies,
      candidateVehicleIds: [winner.vehicle.id],
      evaluatedAt,
    };
  }

  if (candidateSets.length === 1 && candidateSets[0].source === "UNIT" && unit) {
    return { state: "UNRESOLVED", method: "UNIT_COMPANY_SCOPED", reason: "No deterministic company-scoped Unit match; TES did not search other companies by Unit Number.", conflicts: [], identifierDiscrepancies: [], candidateVehicleIds: [], evaluatedAt };
  }
  if (vin && !vinMatches.length && plate && jurisdiction && !plateMatches.length) {
    return { state: "UNRESOLVED", reason: "No canonical Vehicle matched the supplied VIN or Plate + Jurisdiction; equipment may be external, borrowed, rented, or otherwise outside the current TES Vehicle registry.", conflicts: [], identifierDiscrepancies: [], candidateVehicleIds: [], evaluatedAt };
  }
  return { state: "UNRESOLVED", reason: "No deterministic canonical Vehicle match is currently available; source-observed equipment may remain unresolved.", conflicts: [], identifierDiscrepancies: [], candidateVehicleIds: union.map((entry) => entry.vehicle.id), evaluatedAt };
}

export function emptyVehicleDraft(company: Company): VehicleDraft {
  const isCanada = (company.regCorpCountry || "").toLowerCase().includes("canada");
  const isCross = (company.region || "").toLowerCase().includes("cross");
  
  return {
    unitNumber: "",
    equipmentType: "Tractor",
    status: "Active",
    vin: "",
    year: String(new Date().getFullYear()),
    make: "Freightliner",
    model: "Cascadia",
    color: "White",
    operatingRegion: isCross ? "Cross-Border" : isCanada ? "Canada Only" : "US Only",
    axles: 3,
    lengthFeet: "53",
    tareWeightKgs: "8900",
    fuelType: "Diesel",
    gpsProvider: "Samsara ELD",
    transponderNumber: "",

    ownershipType: "Owned",
    ownerCompanyName: company.name || "",
    purchaseDate: addDaysISO(-365),
    purchasePrice: "$165,000",
    leaseTermMonths: "48",
    leaseEndDate: "",

    regType: "IRP (Apportioned)",
    plateNumber: "",
    regJurisdiction: company.regCorpState || "ON",
    regStartDate: addDaysISO(-180),
    regExpiryDate: addDaysISO(185),
    isContinuousPlate: false,
    maxGrossWeightKg: "36287",
    cabCardNumber: `CAB-${Math.floor(100000 + Math.random() * 900000)}`,

    hasInitialInspection: true,
    inspectionType: "Annual Periodic Inspection (CVIP / DOT 396.17)",
    inspectionDate: addDaysISO(-60),
    inspectionExpiry: addDaysISO(305),
    inspectorName: "David K. - Safety Cert #8129",
    inspectionStation: "FleetCare Heavy Repair Ltd. (Sta #9401)",
    inspectionPassed: true,
    inspectionOOS: false,

    permits: [
      {
        id: createId("PMT"),
        permitType: "Clean Truck Check / CARB TRU",
        permitNumber: `CTC-${Math.floor(10000 + Math.random() * 90000)}`,
        jurisdictionCode: "CA",
        jurisdictionLabel: "California",
        startDate: addDaysISO(-90),
        expiryDate: addDaysISO(275),
        status: "Active",
        notes: "Verified compliance with California Clean Truck Check portal.",
      },
    ],

    notes: "",
  };
}

export function getDefaultSeedVehicles(company: Company): VehicleRecord[] {
  const isCanada = (company.regCorpCountry || "").toLowerCase().includes("canada");
  const defaultState = company.regCorpState || (isCanada ? "ON" : "IL");

  return [
    {
      id: "VEH-101",
      unitNumber: "101",
      equipmentType: "Tractor",
      status: "Active",
      vin: "1FUJGLDR9NL847291",
      year: "2024",
      make: "Freightliner",
      model: "Cascadia 126",
      color: "White",
      operatingRegion: "Cross-Border",
      axles: 3,
      tareWeightKgs: 8850,
      fuelType: "Diesel",
      gpsProvider: "Samsara ELD",
      transponderNumber: "TRP-892401",
      ownershipType: "Owned",
      ownerCompanyName: company.name,
      purchaseDate: "2023-11-15",
      purchasePrice: "$182,000",
      registration: {
        recordId: "REG-101",
        registrationType: "IRP (Apportioned)",
        plateNumber: "PA-92810",
        jurisdiction: defaultState,
        jurisdictionLabel: defaultState === "ON" ? "Ontario" : "Illinois",
        country: isCanada ? "Canada" : "United States",
        startDate: "2025-01-01",
        expiryDate: addDaysISO(120),
        isContinuous: false,
        maxGrossWeightKg: 36287,
        cabCardNumber: "IRP-ON-2025-09182",
      },
      permits: [
        {
          id: "PMT-101-1",
          permitType: "New Mexico Weight-Distance Permit",
          permitNumber: "NM-WDT-94821",
          jurisdictionCode: "NM",
          jurisdictionLabel: "New Mexico",
          startDate: "2025-01-01",
          expiryDate: addDaysISO(240),
          status: "Active",
        },
        {
          id: "PMT-101-2",
          permitType: "Clean Truck Check / CARB TRU",
          permitNumber: "CARB-2025-1029",
          jurisdictionCode: "CA",
          jurisdictionLabel: "California",
          startDate: "2025-01-01",
          expiryDate: addDaysISO(45), // Watch status
          status: "Active",
        },
      ],
      inspections: [
        {
          id: "INSP-101",
          inspectionType: "Annual Periodic Inspection (CVIP / DOT 396.17)",
          inspectionDate: addDaysISO(-240),
          expiryDate: addDaysISO(125),
          stationName: "FleetPro Maintenance Center #9102",
          inspectorName: "M. Henderson (License #49281)",
          passed: true,
          outOfServiceDefects: false,
          notes: "All brake drums, steering linkages, and air systems within tolerance.",
        },
      ],
      evidenceIds: [],
      source: "OCR",
      createdAt: isoNow(),
      updatedAt: isoNow(),
      notes: "Assigned to dedicated Midwest corridor cross-border team driver.",
    },
    {
      id: "VEH-102",
      unitNumber: "102",
      equipmentType: "Tractor",
      status: "Active",
      vin: "1XPBDPRX9PD829104",
      year: "2023",
      make: "Peterbilt",
      model: "579 Ultraloft",
      color: "Midnight Blue",
      operatingRegion: "Cross-Border",
      axles: 3,
      tareWeightKgs: 9100,
      fuelType: "Diesel",
      gpsProvider: "Geotab",
      transponderNumber: "TRP-892402",
      ownershipType: "Financed",
      ownerCompanyName: "PACCAR Financial",
      purchaseDate: "2023-04-10",
      purchasePrice: "$195,000",
      registration: {
        recordId: "REG-102",
        registrationType: "IRP (Apportioned)",
        plateNumber: "PA-92811",
        jurisdiction: defaultState,
        jurisdictionLabel: defaultState === "ON" ? "Ontario" : "Illinois",
        country: isCanada ? "Canada" : "United States",
        startDate: "2024-09-01",
        expiryDate: addDaysISO(8), // Critical status
        isContinuous: false,
        maxGrossWeightKg: 36287,
        cabCardNumber: "IRP-ON-2024-88129",
      },
      permits: [
        {
          id: "PMT-102-1",
          permitType: "Kentucky KYU Authority",
          permitNumber: "KYU-920194",
          jurisdictionCode: "KY",
          jurisdictionLabel: "Kentucky",
          startDate: "2024-01-01",
          expiryDate: addDaysISO(180),
          status: "Active",
        },
      ],
      inspections: [
        {
          id: "INSP-102",
          inspectionType: "Annual Periodic Inspection (CVIP / DOT 396.17)",
          inspectionDate: addDaysISO(-340),
          expiryDate: addDaysISO(25), // Urgent status
          stationName: "Apex Heavy Truck Repair #3301",
          inspectorName: "J. Tremblay (License #11029)",
          passed: true,
          outOfServiceDefects: false,
          notes: "Brake slack adjusters measured and adjusted.",
        },
      ],
      evidenceIds: [],
      source: "Manual",
      createdAt: isoNow(),
      updatedAt: isoNow(),
    },
    {
      id: "VEH-R5301",
      unitNumber: "R5301",
      equipmentType: "Trailer - Reefer",
      status: "Active",
      vin: "1UYVS2538PE918231",
      year: "2025",
      make: "Utility Trailer",
      model: "3000R Multi-Temp",
      color: "White",
      operatingRegion: "Cross-Border",
      axles: 2,
      lengthFeet: "53",
      tareWeightKgs: 6400,
      fuelType: "Diesel",
      gpsProvider: "Carrier Transicold e-Solutions",
      ownershipType: "Leased",
      ownerCompanyName: "Premier Trailer Leasing",
      leaseTermMonths: 60,
      leaseEndDate: addDaysISO(1200),
      registration: {
        recordId: "REG-R5301",
        registrationType: "Base Plate",
        plateNumber: "TR-53019",
        jurisdiction: defaultState,
        jurisdictionLabel: defaultState === "ON" ? "Ontario" : "Illinois",
        country: isCanada ? "Canada" : "United States",
        startDate: "2024-06-01",
        expiryDate: "Continuous",
        isContinuous: true,
        maxGrossWeightKg: 30000,
      },
      permits: [
        {
          id: "PMT-R5301-1",
          permitType: "Clean Truck Check / CARB TRU",
          permitNumber: "TRU-CA-2025-9481",
          jurisdictionCode: "CA",
          jurisdictionLabel: "California",
          startDate: "2024-06-01",
          expiryDate: addDaysISO(300),
          status: "Active",
          notes: "Ultra-Low-Emission CARB certified reefer unit.",
        },
      ],
      inspections: [
        {
          id: "INSP-R5301",
          inspectionType: "Annual Periodic Inspection (CVIP / DOT 396.17)",
          inspectionDate: addDaysISO(-180),
          expiryDate: addDaysISO(185),
          stationName: "Utility Trailer Service Center",
          inspectorName: "R. Sterling",
          passed: true,
          outOfServiceDefects: false,
        },
      ],
      evidenceIds: [],
      source: "OCR",
      createdAt: isoNow(),
      updatedAt: isoNow(),
    },
    {
      id: "VEH-V5308",
      unitNumber: "V5308",
      equipmentType: "Trailer - Dry Van",
      status: "Maintenance",
      vin: "1DW1R5329SE849201",
      year: "2022",
      make: "Stoughton",
      model: "Platinum Series Dry Van",
      color: "White",
      operatingRegion: "Canada Only",
      axles: 2,
      lengthFeet: "53",
      tareWeightKgs: 5900,
      fuelType: "None / Unpowered",
      ownershipType: "Owned",
      ownerCompanyName: company.name,
      registration: {
        recordId: "REG-V5308",
        registrationType: "Base Plate",
        plateNumber: "TR-53088",
        jurisdiction: defaultState,
        jurisdictionLabel: defaultState === "ON" ? "Ontario" : "Illinois",
        country: isCanada ? "Canada" : "United States",
        startDate: "2022-04-01",
        expiryDate: "Continuous",
        isContinuous: true,
      },
      permits: [],
      inspections: [
        {
          id: "INSP-V5308",
          inspectionType: "Annual Periodic Inspection (CVIP / DOT 396.17)",
          inspectionDate: addDaysISO(-380),
          expiryDate: addDaysISO(-15), // Expired status
          stationName: "Central Fleet Depot",
          inspectorName: "T. Vance",
          passed: false,
          outOfServiceDefects: true,
          notes: "Cracked landing gear cross-brace. Unit tagged Out of Service for welding repair.",
        },
      ],
      evidenceIds: [],
      source: "Manual",
      createdAt: isoNow(),
      updatedAt: isoNow(),
      notes: "Currently in shop for landing gear structural repair.",
    },
  ];
}

export interface VehicleOwnershipRecord {
  id: string;
  vehicleId: string;
  relationship: "Company-Owned" | "Leased" | "Owner-Operator" | "Third-Party / Rented";
  purchaseDate: string;
  purchasePrice: string;
  ownershipStartDate: string;
  ownershipEndDate: string;
  legalOwners: string[];
  financingStatus?: "No Financing" | "Financed" | "Paid Off";
  leasingStatus?: "Yes" | "No";
  leasingCompanyId?: string;
  leasingCompanyNameSnapshot?: string;
  leaseTermMonths?: string;
  leaseEndDate?: string;
  evidenceIds: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleRegistrationRecord {
  id: string;
  vehicleId: string;
  registrationType: string;
  stateProvince: string;
  registrationDate: string;
  expiryDate: string;
  plate: string;
  price: string;
  status: "Draft" | "Active" | "Expired" | "Replaced" | "Cancelled";
  registrationDocumentEvidenceId?: string;
  cabCardEvidenceId?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VehiclePermitRecord {
  id: string;
  vehicleId: string;
  permitType: string;
  customPermitType: string;
  permitNumber: string;
  jurisdiction: string;
  startDate: string;
  expiryDate: string;
  status: "Cancelled" | "Active";
  evidenceIds: string[];
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleInspectionRecord {
  id: string;
  vehicleId: string;
  inspectionType: string;
  inspectionSource: "Internal" | "Third-Party Shop" | "Roadside Enforcement";
  inspectionStatus: "Pass" | "Pass with Defects" | "Fail" | "Out of Service";
  inspectionDate: string;
  expiryDate: string;
  nextDueDate: string;
  inspectorShopName: string;
  odometer: string;
  engineHours: string;
  defectsFound: "Yes" | "No";
  serviceFacility: string;
  evidenceIds: string[];
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleMaintenanceRecord {
  id: string;
  vehicleId: string;
  maintenanceType: string;
  maintenanceStatus: "Scheduled" | "In Progress" | "Completed" | "Cancelled";
  serviceDate: string;
  odometer: string;
  engineHours: string;
  vendor: string;
  workOrderInvoiceNumber: string;
  partsCost: string;
  totalCost: string;
  nextServiceDueDate: string;
  evidenceIds: string[];
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Legacy fields retained only for read compatibility. */
  workOrderNumber?: string;
  invoiceNumber?: string;
  labourCost?: string;
  nextServiceDueOdometer?: string;
}

export interface VehicleStore {
  version: number;
  vehicles: VehicleRecord[];
  ownershipRecords: VehicleOwnershipRecord[];
  registrationRecords: VehicleRegistrationRecord[];
  permitRecords: VehiclePermitRecord[];
  inspectionRecords: VehicleInspectionRecord[];
  maintenanceRecords: VehicleMaintenanceRecord[];
  evidence: import("../types/evidence").EvidenceRecord[];
}

export const vehicleStorageKey = (companyId: string) => `tes_company_vehicles_${companyId}`;

const EMPTY_VEHICLE_STORE = (): VehicleStore => ({
  version: 2,
  vehicles: [],
  ownershipRecords: [],
  registrationRecords: [],
  permitRecords: [],
  inspectionRecords: [],
  maintenanceRecords: [],
  evidence: [],
});

function normalizeLegacyOwnership(record: Record<string, unknown>, vehicleId: string): VehicleOwnershipRecord {
  const legacyOwner = typeof record.legalOwner === "string" ? record.legalOwner.trim() : "";
  const owners = Array.isArray(record.legalOwners)
    ? record.legalOwners.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
    : legacyOwner
      ? [legacyOwner]
      : [];

  const relationship = record.relationship === "Leased" || record.relationship === "Owner-Operator" || record.relationship === "Third-Party / Rented"
    ? record.relationship
    : "Company-Owned";

  const financingStatus = record.financingStatus === "Financed" || record.financingStatus === "Paid Off"
    ? record.financingStatus
    : record.financingStatus === "No Financing"
      ? "No Financing"
      : undefined;

  const leasingStatus = record.leasingStatus === "Yes" || record.leasingStatus === "No" ? record.leasingStatus : undefined;
  const evidenceIds = Array.isArray(record.evidenceIds)
    ? record.evidenceIds.filter((value): value is string => typeof value === "string")
    : Array.isArray(record.documents)
      ? []
      : [];

  return {
    id: typeof record.id === "string" ? record.id : createId("OWN"),
    vehicleId,
    relationship,
    purchaseDate: typeof record.purchaseDate === "string" ? record.purchaseDate : "",
    purchasePrice: typeof record.purchasePrice === "string" ? record.purchasePrice : "",
    ownershipStartDate: typeof record.ownershipStartDate === "string" ? record.ownershipStartDate : "",
    ownershipEndDate: typeof record.ownershipEndDate === "string" ? record.ownershipEndDate : "",
    legalOwners: owners,
    financingStatus,
    leasingStatus,
    leasingCompanyId: typeof record.leasingCompanyId === "string" ? record.leasingCompanyId : undefined,
    leasingCompanyNameSnapshot: typeof record.leasingCompanyNameSnapshot === "string"
      ? record.leasingCompanyNameSnapshot
      : typeof record.leasingCompany === "string"
        ? record.leasingCompany
        : undefined,
    leaseTermMonths: typeof record.leaseTermMonths === "string" ? record.leaseTermMonths : typeof record.leaseTermMonths === "number" ? String(record.leaseTermMonths) : undefined,
    leaseEndDate: typeof record.leaseEndDate === "string" ? record.leaseEndDate : undefined,
    evidenceIds,
    archived: record.archived === true || record.isArchived === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : isoNow(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : typeof record.createdAt === "string" ? record.createdAt : isoNow(),
  };
}

function normalizeLegacyRegistration(record: Record<string, unknown>, vehicleId: string): VehicleRegistrationRecord {
  return {
    id: typeof record.id === "string" ? record.id : typeof record.recordId === "string" ? record.recordId : createId("REG"),
    vehicleId,
    registrationType: typeof record.registrationType === "string" ? record.registrationType : "",
    stateProvince: typeof record.stateProvince === "string" ? record.stateProvince : typeof record.jurisdiction === "string" ? record.jurisdiction : "",
    registrationDate: typeof record.registrationDate === "string" ? record.registrationDate : typeof record.startDate === "string" ? record.startDate : "",
    expiryDate: typeof record.expiryDate === "string" ? record.expiryDate : "",
    plate: typeof record.plate === "string" ? record.plate : typeof record.plateNumber === "string" ? record.plateNumber : "",
    price: typeof record.price === "string" ? record.price : "",
    status: record.status === "Draft" || record.status === "Expired" || record.status === "Replaced" || record.status === "Cancelled" ? record.status : "Active",
    registrationDocumentEvidenceId: typeof record.registrationDocumentEvidenceId === "string" ? record.registrationDocumentEvidenceId : undefined,
    cabCardEvidenceId: typeof record.cabCardEvidenceId === "string" ? record.cabCardEvidenceId : undefined,
    archived: record.archived === true || record.isArchived === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : isoNow(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : typeof record.createdAt === "string" ? record.createdAt : isoNow(),
  };
}

function normalizeLegacyPermit(record: Record<string, unknown>, vehicleId: string): VehiclePermitRecord {
  const evidenceIds = Array.isArray(record.evidenceIds)
    ? record.evidenceIds.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id: typeof record.id === "string" ? record.id : createId("PMT"),
    vehicleId,
    permitType: typeof record.permitType === "string" ? record.permitType : "",
    customPermitType: typeof record.customPermitType === "string" ? record.customPermitType : "",
    permitNumber: typeof record.permitNumber === "string" ? record.permitNumber : "",
    jurisdiction: typeof record.jurisdiction === "string" ? record.jurisdiction : "",
    startDate: typeof record.startDate === "string" ? record.startDate : "",
    expiryDate: typeof record.expiryDate === "string" ? record.expiryDate : "",
    status: record.status === "Cancelled" ? "Cancelled" : "Active",
    evidenceIds,
    notes: typeof record.notes === "string" ? record.notes : "",
    archived: record.archived === true || record.isArchived === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : isoNow(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : typeof record.createdAt === "string" ? record.createdAt : isoNow(),
  };
}

function normalizeLegacyInspection(record: Record<string, unknown>, vehicleId: string): VehicleInspectionRecord {
  return {
    id: typeof record.id === "string" ? record.id : createId("INSP"),
    vehicleId,
    inspectionType: typeof record.inspectionType === "string" ? record.inspectionType : "",
    inspectionSource: record.inspectionSource === "Third-Party Shop" || record.inspectionSource === "Roadside Enforcement" ? record.inspectionSource : "Internal",
    inspectionStatus: record.inspectionStatus === "Pass with Defects" || record.inspectionStatus === "Fail" || record.inspectionStatus === "Out of Service" ? record.inspectionStatus : record.passed === false ? "Fail" : "Pass",
    inspectionDate: typeof record.inspectionDate === "string" ? record.inspectionDate : "",
    expiryDate: typeof record.expiryDate === "string" ? record.expiryDate : "",
    nextDueDate: typeof record.nextDueDate === "string" ? record.nextDueDate : "",
    inspectorShopName: typeof record.inspectorShopName === "string" ? record.inspectorShopName : typeof record.stationName === "string" ? record.stationName : "",
    odometer: typeof record.odometer === "string" ? record.odometer : "",
    engineHours: typeof record.engineHours === "string" ? record.engineHours : "",
    defectsFound: record.defectsFound === "Yes" || record.defectsFound === "No" ? record.defectsFound : record.outOfServiceDefects === true ? "Yes" : "No",
    serviceFacility: typeof record.serviceFacility === "string" ? record.serviceFacility : "",
    evidenceIds: Array.isArray(record.evidenceIds) ? record.evidenceIds.filter((value): value is string => typeof value === "string") : [],
    notes: typeof record.notes === "string" ? record.notes : "",
    archived: record.archived === true || record.isArchived === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : isoNow(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : typeof record.createdAt === "string" ? record.createdAt : isoNow(),
  };
}

function normalizeLegacyMaintenance(record: Record<string, unknown>, vehicleId: string): VehicleMaintenanceRecord {
  const workOrder = typeof record.workOrderNumber === "string" ? record.workOrderNumber : "";
  const invoice = typeof record.invoiceNumber === "string" ? record.invoiceNumber : "";
  return {
    id: typeof record.id === "string" ? record.id : createId("MNT"),
    vehicleId,
    maintenanceType: typeof record.maintenanceType === "string" ? record.maintenanceType : "",
    maintenanceStatus: record.maintenanceStatus === "Scheduled" || record.maintenanceStatus === "In Progress" || record.maintenanceStatus === "Cancelled" ? record.maintenanceStatus : "Completed",
    serviceDate: typeof record.serviceDate === "string" ? record.serviceDate : "",
    odometer: typeof record.odometer === "string" ? record.odometer : "",
    engineHours: typeof record.engineHours === "string" ? record.engineHours : "",
    vendor: typeof record.vendor === "string" ? record.vendor : "",
    workOrderInvoiceNumber: typeof record.workOrderInvoiceNumber === "string" ? record.workOrderInvoiceNumber : workOrder || invoice,
    partsCost: typeof record.partsCost === "string" ? record.partsCost : "",
    totalCost: typeof record.totalCost === "string" ? record.totalCost : "",
    nextServiceDueDate: typeof record.nextServiceDueDate === "string" ? record.nextServiceDueDate : "",
    evidenceIds: Array.isArray(record.evidenceIds) ? record.evidenceIds.filter((value): value is string => typeof value === "string") : [],
    notes: typeof record.notes === "string" ? record.notes : "",
    archived: record.archived === true || record.isArchived === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : isoNow(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : typeof record.createdAt === "string" ? record.createdAt : isoNow(),
    workOrderNumber: workOrder || undefined,
    invoiceNumber: invoice || undefined,
    labourCost: typeof record.labourCost === "string" ? record.labourCost : undefined,
    nextServiceDueOdometer: typeof record.nextServiceDueOdometer === "string" ? record.nextServiceDueOdometer : undefined,
  };
}

export function loadVehicleStore(companyId: string): VehicleStore {
  if (typeof window === "undefined" || !companyId) return EMPTY_VEHICLE_STORE();
  try {
    const raw = localStorage.getItem(vehicleStorageKey(companyId));
    if (!raw) return EMPTY_VEHICLE_STORE();
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      const vehicles = parsed.filter((item): item is VehicleRecord => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"));
      return { ...EMPTY_VEHICLE_STORE(), vehicles };
    }

    if (!parsed || typeof parsed !== "object") return EMPTY_VEHICLE_STORE();
    const value = parsed as Record<string, unknown>;
    const vehicles = Array.isArray(value.vehicles)
      ? value.vehicles.filter((item): item is VehicleRecord => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"))
      : [];

    const store = EMPTY_VEHICLE_STORE();
    store.version = typeof value.version === "number" ? value.version : 1;
    store.vehicles = vehicles;

    const ownership = Array.isArray(value.ownershipRecords) ? value.ownershipRecords : [];
    store.ownershipRecords = ownership.flatMap((item) => item && typeof item === "object" ? [normalizeLegacyOwnership(item as Record<string, unknown>, typeof (item as Record<string, unknown>).vehicleId === "string" ? String((item as Record<string, unknown>).vehicleId) : "")] : []);

    const registrations = Array.isArray(value.registrationRecords) ? value.registrationRecords : [];
    store.registrationRecords = registrations.flatMap((item) => item && typeof item === "object" ? [normalizeLegacyRegistration(item as Record<string, unknown>, typeof (item as Record<string, unknown>).vehicleId === "string" ? String((item as Record<string, unknown>).vehicleId) : "")] : []);

    const permits = Array.isArray(value.permitRecords) ? value.permitRecords : [];
    store.permitRecords = permits.flatMap((item) => item && typeof item === "object" ? [normalizeLegacyPermit(item as Record<string, unknown>, typeof (item as Record<string, unknown>).vehicleId === "string" ? String((item as Record<string, unknown>).vehicleId) : "")] : []);

    const inspections = Array.isArray(value.inspectionRecords) ? value.inspectionRecords : [];
    store.inspectionRecords = inspections.flatMap((item) => item && typeof item === "object" ? [normalizeLegacyInspection(item as Record<string, unknown>, typeof (item as Record<string, unknown>).vehicleId === "string" ? String((item as Record<string, unknown>).vehicleId) : "")] : []);

    const maintenance = Array.isArray(value.maintenanceRecords) ? value.maintenanceRecords : [];
    store.maintenanceRecords = maintenance.flatMap((item) => item && typeof item === "object" ? [normalizeLegacyMaintenance(item as Record<string, unknown>, typeof (item as Record<string, unknown>).vehicleId === "string" ? String((item as Record<string, unknown>).vehicleId) : "")] : []);

    store.evidence = Array.isArray(value.evidence)
      ? value.evidence.filter((item): item is import("../types/evidence").EvidenceRecord => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"))
      : [];

    // Legacy VehicleRecord embeds registration/permits/inspections directly. Normalize those into historical child collections in memory.
    for (const vehicle of vehicles) {
      const vehicleRecord = vehicle as VehicleRecord & Record<string, unknown>;
      const vehicleId = vehicle.id;
      if (vehicleRecord.registration && typeof vehicleRecord.registration === "object" && !store.registrationRecords.some((record) => record.vehicleId === vehicleId)) {
        store.registrationRecords.push(normalizeLegacyRegistration(vehicleRecord.registration as Record<string, unknown>, vehicleId));
      }
      if (Array.isArray(vehicleRecord.permits) && !store.permitRecords.some((record) => record.vehicleId === vehicleId)) {
        store.permitRecords.push(...vehicleRecord.permits.flatMap((item: unknown) => item && typeof item === "object" ? [normalizeLegacyPermit(item as Record<string, unknown>, vehicleId)] : []));
      }
      if (Array.isArray(vehicleRecord.inspections) && !store.inspectionRecords.some((record) => record.vehicleId === vehicleId)) {
        store.inspectionRecords.push(...vehicleRecord.inspections.flatMap((item: unknown) => item && typeof item === "object" ? [normalizeLegacyInspection(item as Record<string, unknown>, vehicleId)] : []));
      }
      if (!store.ownershipRecords.some((record) => record.vehicleId === vehicleId) && (vehicleRecord.ownershipType || vehicleRecord.ownerCompanyName)) {
        const relationship = vehicleRecord.ownershipType === "Leased" ? "Leased" : vehicleRecord.ownershipType === "Owner Operator" ? "Owner-Operator" : "Company-Owned";
        store.ownershipRecords.push(normalizeLegacyOwnership({
          id: createId("OWN"),
          vehicleId,
          relationship,
          legalOwner: vehicleRecord.ownerCompanyName,
          purchaseDate: vehicleRecord.purchaseDate,
          purchasePrice: vehicleRecord.purchasePrice,
          leaseTermMonths: vehicleRecord.leaseTermMonths,
          leaseEndDate: vehicleRecord.leaseEndDate,
          documents: [],
          archived: false,
          createdAt: vehicle.createdAt,
        }, vehicleId));
      }
    }

    return store;
  } catch {
    return EMPTY_VEHICLE_STORE();
  }
}

export function saveVehicleStore(companyId: string, store: VehicleStore): void {
  if (typeof window === "undefined" || !companyId) throw new Error("Vehicle company context is unavailable.");
  localStorage.setItem(vehicleStorageKey(companyId), JSON.stringify({ ...store, version: Math.max(2, store.version || 0) }));
}

export function persistVehicleStore(companyId: string, updater: (current: VehicleStore) => VehicleStore): VehicleStore {
  const current = loadVehicleStore(companyId);
  const next = updater(current);
  saveVehicleStore(companyId, next);
  return next;
}
