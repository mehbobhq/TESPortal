export type DeadlineStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "No Deadline";

export type DeadlineRules = {
  healthyMinDays: number;
  watchMinDays: number;
  urgentMinDays: number;
  criticalMinDays: number;
  criticalMaxDays: number;
};

export type Company = {
  id: string;
  name: string;
  kind?: string;
  contact?: string;
  region?: string;
  regCorpState?: string;
  regCorpCountry?: string;
  status?: string;
  tone?: "ok" | "warn" | "danger" | "default" | "info" | "neutral";
  [key: string]: any;
};

export type EquipmentType =
  | "Tractor"
  | "Trailer - Dry Van"
  | "Trailer - Reefer"
  | "Trailer - Flatbed"
  | "Trailer - Step Deck / Lowboy"
  | "Trailer - Intermodal Chassis"
  | "Converter Dolly"
  | "Straight Truck"
  | "Service Vehicle"
  | "Other Equipment";

export type VehicleStatus =
  | "Active"
  | "Maintenance"
  | "Out of Service"
  | "Inactive"
  | "Archived";

export type OwnershipType =
  | "Owned"
  | "Financed"
  | "Leased"
  | "Owner Operator";

export type RegistrationType =
  | "IRP (Apportioned)"
  | "Base Plate"
  | "Temporary Trip Registration";

export type PermitType =
  | "New Mexico Weight-Distance Permit"
  | "Oregon Weight-Mile Account / Permit"
  | "Kentucky KYU Authority"
  | "New York HUT Decal / Certificate"
  | "Clean Truck Check / CARB TRU"
  | "IFTA Decal / License"
  | "Over-Dimensional / Heavy Haul"
  | "Annual Safety Permit"
  | "Other State/Provincial Permit";

export type InspectionType =
  | "Annual Periodic Inspection (CVIP / DOT 396.17)"
  | "Semi-Annual Inspection"
  | "90-Day Periodic Inspection"
  | "Preventive Maintenance A"
  | "Preventive Maintenance B"
  | "Pre-Trip / Post-Trip Sign-off";

export type DocumentSource = "camera" | "device";

export type VehicleEvidence = {
  id: string;
  recordId?: string;
  documentType:
    | "Vehicle Registration / Cab Card"
    | "Annual CVIP Inspection Certificate"
    | "Bill of Sale / Title"
    | "Lease Agreement"
    | "Permit / Decal Notice"
    | "Maintenance Work Order"
    | "Other Document";
  fileName: string;
  mimeType: string;
  dataUrl: string;
  documentDate: string;
  uploadedAt: string;
  source: DocumentSource;
  ocrConfidence?: number;
};

export type VehicleRegistration = {
  recordId: string;
  registrationType: RegistrationType;
  plateNumber: string;
  jurisdiction: string;
  jurisdictionLabel: string;
  country: "Canada" | "United States";
  startDate: string;
  expiryDate: string;
  isContinuous?: boolean;
  maxGrossWeightKg?: number;
  cabCardNumber?: string;
};

export type VehiclePermit = {
  id: string;
  permitType: PermitType;
  permitNumber: string;
  jurisdictionCode: string;
  jurisdictionLabel: string;
  startDate: string;
  expiryDate?: string;
  isContinuous?: boolean;
  status: "Active" | "Pending" | "Expired" | "Suspended";
  notes?: string;
};

export type VehicleInspection = {
  id: string;
  inspectionType: InspectionType;
  inspectionDate: string;
  expiryDate: string;
  stationName?: string;
  inspectorName?: string;
  inspectorNumber?: string;
  passed: boolean;
  outOfServiceDefects: boolean;
  notes?: string;
};

export type VehicleRecord = {
  id: string;
  unitNumber: string;
  equipmentType: EquipmentType;
  status: VehicleStatus;
  vin: string;
  year: string;
  make: string;
  model: string;
  color: string;
  operatingRegion: "Canada Only" | "US Only" | "Cross-Border";
  axles: number;
  lengthFeet?: string;
  tareWeightKgs?: number;
  fuelType: "Diesel" | "Electric" | "Gasoline" | "CNG/LNG" | "None / Unpowered";
  gpsProvider?: string;
  transponderNumber?: string;

  // Ownership Details
  ownershipType: OwnershipType;
  ownerCompanyName?: string;
  purchaseDate?: string;
  purchasePrice?: string;
  leaseTermMonths?: number;
  leaseEndDate?: string;

  // Compliance Modules
  registration?: VehicleRegistration;
  permits: VehiclePermit[];
  inspections: VehicleInspection[];

  // Evidence & Audit
  evidenceIds: string[];
  source: "OCR" | "Manual";
  createdAt: string;
  updatedAt: string;
  notes?: string;
};

export type VehicleDraft = {
  unitNumber: string;
  equipmentType: EquipmentType;
  status: VehicleStatus;
  vin: string;
  year: string;
  make: string;
  model: string;
  color: string;
  operatingRegion: "Canada Only" | "US Only" | "Cross-Border";
  axles: number;
  lengthFeet: string;
  tareWeightKgs: string;
  fuelType: "Diesel" | "Electric" | "Gasoline" | "CNG/LNG" | "None / Unpowered";
  gpsProvider: string;
  transponderNumber: string;

  // Ownership
  ownershipType: OwnershipType;
  ownerCompanyName: string;
  purchaseDate: string;
  purchasePrice: string;
  leaseTermMonths: string;
  leaseEndDate: string;

  // Registration
  regType: RegistrationType;
  plateNumber: string;
  regJurisdiction: string;
  regStartDate: string;
  regExpiryDate: string;
  isContinuousPlate: boolean;
  maxGrossWeightKg: string;
  cabCardNumber: string;

  // Initial Inspection
  hasInitialInspection: boolean;
  inspectionType: InspectionType;
  inspectionDate: string;
  inspectionExpiry: string;
  inspectorName: string;
  inspectionStation: string;
  inspectionPassed: boolean;
  inspectionOOS: boolean;

  // Permits list
  permits: VehiclePermit[];

  notes: string;
};

export type OCRSession = {
  file: File;
  dataUrl: string;
  source: DocumentSource;
  documentType: VehicleEvidence["documentType"];
  processing: boolean;
  extractionComplete: boolean;
  confidence?: number;
  documentDate: string;
  draft: VehicleDraft;
};

// Re-export canonical generic shared contracts
export * from "./types/entity-references";
export * from "./types/ocr";
export * from "./types/evidence";
export * from "./types/applicability";
export * from "./types/permissions";

