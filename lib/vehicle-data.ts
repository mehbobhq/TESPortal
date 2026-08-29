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
