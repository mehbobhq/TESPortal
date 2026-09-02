import {
  DriverMaster,
  DriverMasterStore,
  CompanyDriverStore,
  CompanyDriverRelationship,
  DriverInput,
  LicenceRecord,
  AddressRecord,
  DriverApplicationRecord,
  HiringPackageRecord,
  DriverTaxDocRecord,
  ScreeningRecord,
  TrainingRecord,
  TrainingStatus,
  PerformanceEventRecord,
  EventChronologyItem,
  DriverEvidenceItem,
  CanonicalCompany,
  RecordType,
  OperatingRegion,
  DriverRole,
  DriverStatus,
  EmploymentStatus,
  EventType,
  EventSeverity,
  EventStatus,
  HOSReview,
  CompanyDetermination,
  CompanyActionRecord,
} from "../types";
import {
  normalizeLicence,
  normalizeName,
  normalizePhone,
  normalizeEmail,
} from "./identifier-normalization";
import { resolveCountryForJurisdiction, getJurisdictionLabel } from "./jurisdictions";
import { compareExactIdentifier, comparePersonIdentity, DuplicateFinding } from "./duplicate-detection";
import { recordAuditEvent, loadAuditEvents, ComplianceAuditEvent } from "./audit-logger";

export const DRIVER_MASTER_STORAGE_KEY = "tes_driver_masters_v1";
export const companyDriverStorageKey = (companyId: string) => `tes_company_drivers_${companyId}`;

export type DriverMatch =
  | { kind: "CLEAR"; driver: DriverMaster; finding: DuplicateFinding }
  | { kind: "AMBIGUOUS"; drivers: DriverMaster[]; findings: DuplicateFinding[] }
  | { kind: "NONE" };

export interface DriverCreationOptions {
  confirmedDriverMasterId?: string;
}

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Failed to write to localStorage key "${key}":`, err);
  }
}

export function createId(prefix: string) {
  const rand = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8).toUpperCase()
    : Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export function readCompanies(): CanonicalCompany[] {
  const list = readStorage<any[]>("tes_companies", []);
  if (Array.isArray(list) && list.length > 0) {
    return list.map((c) => ({
      id: String(c.id),
      name: String(c.name || c.companyName || "Carrier"),
      kind: c.kind || "Customer",
      status: c.status || "Active",
      region: c.region || "Cross-Border",
      regCorpState: c.regCorpState || "ON",
      regCorpCountry: c.regCorpCountry || "Canada",
    }));
  }
  return [];
}

export function getCompany(id: string): CanonicalCompany | null {
  return readCompanies().find((c) => c.id === id) || null;
}

export function allocateDriverMasterId(drivers: DriverMaster[]): string {
  const usedNumbers = new Set(
    drivers
      .map((d) => d.id.match(/^DRV-(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number)
  );

  let num = 1;
  while (usedNumbers.has(num)) num++;
  return `DRV-${String(num).padStart(6, "0")}`;
}

export function allocateCompanyDriverRecordId(company: CanonicalCompany, relationships: CompanyDriverRelationship[]): string {
  // Generate prefix from company initials or ID
  const cleanName = company.name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  const words = cleanName.split(/\s+/).filter(Boolean);
  let prefix = "YK";
  if (words.length >= 2) {
    prefix = (words[0][0] + words[1][0]).toUpperCase();
  } else if (words.length === 1 && words[0].length >= 2) {
    prefix = words[0].slice(0, 2).toUpperCase();
  }

  const existingCount = relationships.length + 1;
  const randNum = 100 + existingCount;
  return `${prefix}-DRV-${String(randNum).padStart(6, "0")}`;
}

export function fullLegalName(driver: DriverMaster): string {
  return [
    driver.identity.legalFirstName,
    driver.identity.legalMiddleName,
    driver.identity.legalLastName,
  ]
    .filter(Boolean)
    .join(" ");
}

export function currentLicence(driver: DriverMaster): LicenceRecord | undefined {
  return [...driver.licenceHistory]
    .filter((l) => !l.effectiveTo)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function currentAddress(driver: DriverMaster): AddressRecord | undefined {
  return [...driver.addressHistory]
    .filter((a) => !a.effectiveTo)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function calculateAge(dob?: string, today = new Date()): number | null {
  if (!dob) return null;
  const date = new Date(`${dob}T00:00:00`);
  if (isNaN(date.getTime())) return null;

  let age = today.getFullYear() - date.getFullYear();
  const month = today.getMonth() - date.getMonth();
  if (month < 0 || (month === 0 && today.getDate() < date.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}

// --- HYDRATION & REPOSITORY ACCESS ---
export function loadDriverMasterStore(): DriverMasterStore {
  const store = readStorage<DriverMasterStore>(DRIVER_MASTER_STORAGE_KEY, { version: 1, drivers: [] });
  if (!store || !Array.isArray(store.drivers)) {
    return { version: 1, drivers: [] };
  }
  return store;
}

export function saveDriverMasterStore(store: DriverMasterStore) {
  writeStorage(DRIVER_MASTER_STORAGE_KEY, store);
}

export function loadCompanyDriverStore(companyId: string): CompanyDriverStore {
  const key = companyDriverStorageKey(companyId);
  const store = readStorage<CompanyDriverStore>(key, {
    version: 1,
    companyId,
    relationships: [],
    applications: [],
    hiringPackages: [],
    taxDocs: [],
    screenings: [],
    trainingRecords: [],
    performanceEvents: [],
    evidence: [],
    hosDutyEvents: [],
    hosRuleProfiles: [],
    hosPotentialViolations: [],
    hosReviews: [],
    eldEditRequests: [],
    unassignedDriving: [],
    eldDiagnostics: [],
    companyDeterminations: [],
    companyActions: [],
  });

  if (!store || !Array.isArray(store.relationships)) {
    return {
      version: 1,
      companyId,
      relationships: [],
      applications: [],
      hiringPackages: [],
      taxDocs: [],
      screenings: [],
      trainingRecords: [],
      performanceEvents: [],
      evidence: [],
      hosDutyEvents: [],
      hosRuleProfiles: [],
      hosPotentialViolations: [],
      hosReviews: [],
      eldEditRequests: [],
      unassignedDriving: [],
      eldDiagnostics: [],
      companyDeterminations: [],
      companyActions: [],
    };
  }

  // Ensure additive arrays exist on older versions (backward compatibility)
  return {
    version: 1,
    companyId,
    relationships: store.relationships || [],
    applications: store.applications || [],
    hiringPackages: store.hiringPackages || [],
    taxDocs: store.taxDocs || [],
    screenings: store.screenings || [],
    trainingRecords: store.trainingRecords || [],
    performanceEvents: store.performanceEvents || [],
    evidence: store.evidence || [],
    hosDutyEvents: store.hosDutyEvents || [],
    hosRuleProfiles: store.hosRuleProfiles || [],
    hosPotentialViolations: store.hosPotentialViolations || [],
    hosReviews: store.hosReviews || [],
    eldEditRequests: store.eldEditRequests || [],
    unassignedDriving: store.unassignedDriving || [],
    eldDiagnostics: store.eldDiagnostics || [],
    companyDeterminations: store.companyDeterminations || [],
    companyActions: store.companyActions || [],
  };
}

export function saveCompanyDriverStore(store: CompanyDriverStore) {
  writeStorage(companyDriverStorageKey(store.companyId), store);
}

// --- DUPLICATE & IDENTITY RESOLUTION ---
export function findDriverDuplicate(input: DriverInput, drivers: DriverMaster[]): DriverMatch {
  const targetLicenceNorm = normalizeLicence(input.licenceNumber);
  const targetName = [input.legalFirstName, input.legalMiddleName, input.legalLastName]
    .filter(Boolean)
    .join(" ");

  const clearMatches: Array<{ driver: DriverMaster; finding: DuplicateFinding }> = [];
  const possibleMatches: Array<{ driver: DriverMaster; finding: DuplicateFinding }> = [];

  for (const driver of drivers) {
    // 1. Exact Driver Licence Number Match (Active or Historical)
    const licenceMatch = driver.licenceHistory.some(
      (l) =>
        normalizeLicence(l.licenceNumber) === targetLicenceNorm &&
        l.jurisdiction.toUpperCase() === input.licenceJurisdiction.toUpperCase()
    );

    if (licenceMatch && targetLicenceNorm) {
      const finding: DuplicateFinding = {
        classification: "ExactIdentifierConflict",
        matchedField: "Driver Licence Number",
        matchedValue: input.licenceNumber,
        conflictEntityId: driver.id,
        conflictEntityLabel: fullLegalName(driver),
        confidenceScore: 100,
        notes: `Exact licence number collision in ${input.licenceJurisdiction}. Existing Driver Master identified.`,
      };
      clearMatches.push({ driver, finding });
      continue;
    }

    // 2. Person Identity Check (Name + DOB, Name + Contact, etc.)
    const finding = comparePersonIdentity(
      {
        name: targetName,
        dob: input.dateOfBirth,
        phone: input.phone,
        email: input.email,
        licenseNumber: input.licenceNumber,
      },
      {
        id: driver.id,
        label: fullLegalName(driver),
        name: fullLegalName(driver),
        dob: driver.identity.dateOfBirth,
        phone: driver.identity.phone,
        email: driver.identity.email,
        licenseNumber: currentLicence(driver)?.licenceNumber,
      }
    );

    if (finding) {
      if (finding.classification === "StrongIdentityMatch") {
        clearMatches.push({ driver, finding });
      } else if (finding.classification === "PossibleMatch") {
        possibleMatches.push({ driver, finding });
      }
    }
  }

  if (clearMatches.length === 1) {
    return { kind: "CLEAR", driver: clearMatches[0].driver, finding: clearMatches[0].finding };
  }

  if (clearMatches.length > 1) {
    return {
      kind: "AMBIGUOUS",
      drivers: clearMatches.map((m) => m.driver),
      findings: clearMatches.map((m) => m.finding),
    };
  }

  if (possibleMatches.length > 0) {
    return {
      kind: "AMBIGUOUS",
      drivers: possibleMatches.map((m) => m.driver),
      findings: possibleMatches.map((m) => m.finding),
    };
  }

  return { kind: "NONE" };
}

// --- DRIVER CREATION TRANSACTION ---
export function createDriver(
  companyId: string,
  input: DriverInput,
  options: DriverCreationOptions = {}
): {
  master: DriverMaster;
  relationship: CompanyDriverRelationship;
  matchedExisting: boolean;
} {
  const company = getCompany(companyId);
  if (!company) throw new Error(`Company ${companyId} not found.`);

  const masterStore = loadDriverMasterStore();
  const companyStore = loadCompanyDriverStore(companyId);
  const duplicateResult = findDriverDuplicate(input, masterStore.drivers);

  if (duplicateResult.kind === "AMBIGUOUS") {
    throw new Error(
      `Multiple potential Driver Master matches detected (${duplicateResult.drivers
        .map((d) => `${fullLegalName(d)} [${d.id}]`)
        .join(", ")}). Human operator review is required.`
    );
  }

  if (duplicateResult.kind === "CLEAR" && options.confirmedDriverMasterId !== duplicateResult.driver.id) {
    throw new Error(
      `Existing Driver Master ${duplicateResult.driver.id} detected. Please confirm linking to the existing person record.`
    );
  }

  const now = new Date().toISOString();
  let master: DriverMaster;
  let matchedExisting = false;

  if (duplicateResult.kind === "CLEAR") {
    master = duplicateResult.driver;
    matchedExisting = true;
  } else {
    // Generate new Driver Master
    const newMasterId = allocateDriverMasterId(masterStore.drivers);
    master = {
      id: newMasterId,
      createdAt: now,
      updatedAt: now,
      identity: {
        legalFirstName: normalizeName(input.legalFirstName),
        legalMiddleName: normalizeName(input.legalMiddleName) || undefined,
        legalLastName: normalizeName(input.legalLastName),
        preferredName: normalizeName(input.preferredName) || undefined,
        dateOfBirth: input.dateOfBirth,
        phone: input.phone || undefined,
        email: input.email || undefined,
      },
      identityReferences: [
        {
          id: createId("IDR"),
          type: "DRIVER_LICENCE",
          value: normalizeLicence(input.licenceNumber),
          jurisdiction: input.licenceJurisdiction,
          country: input.licenceCountry,
          createdAt: now,
          source: "Driver Profile Onboarding",
        },
      ],
      licenceHistory: [
        {
          id: createId("LIC"),
          licenceNumber: normalizeLicence(input.licenceNumber),
          licenceNumberRaw: input.licenceNumber,
          jurisdiction: input.licenceJurisdiction,
          country: input.licenceCountry,
          class: input.licenceClass || "",
          endorsements: input.endorsements || [],
          airBrakeQualified: input.airBrakeQualified ?? false,
          effectiveFrom: input.licenceEffectiveFrom || now.slice(0, 10),
          effectiveTo: null,
          status: "Current",
          source: "Driver Onboarding Form",
          verificationState: input.verificationState || "Unverified",
          createdAt: now,
        },
      ],
      addressHistory: [
        {
          id: createId("ADR"),
          addressLine1: normalizeName(input.addressLine1),
          addressLine2: normalizeName(input.addressLine2) || undefined,
          city: normalizeName(input.city),
          stateProvince: input.stateProvince.trim().toUpperCase(),
          postalZip: input.postalZip.trim().toUpperCase(),
          country: input.country,
          effectiveFrom: input.addressEffectiveFrom || now.slice(0, 10),
          effectiveTo: null,
          status: "Current",
          source: "Driver Onboarding Form",
          createdAt: now,
        },
      ],
      identityResolution: {
        status: input.stateProvince.trim().toUpperCase() === input.licenceJurisdiction.trim().toUpperCase() ? "CLEAR" : "REVIEW",
      },
      jurisdictionReviews:
        input.stateProvince.trim().toUpperCase() !== input.licenceJurisdiction.trim().toUpperCase()
          ? [
              {
                id: createId("JUR"),
                status: "OPEN",
                reason: input.jurisdictionReview?.reason || "Recently Relocated",
                explanation: input.jurisdictionReview?.explanation || "Driver recently relocated. Licence exchange in progress.",
                expectedResolutionDate: input.jurisdictionReview?.expectedResolutionDate || undefined,
                createdAt: now,
              },
            ]
          : [],
      identitySourceReviews: [],
      archive: { isArchived: false },
    };
  }

  // Check if active relationship already exists
  if (companyStore.relationships.some((r) => r.driverMasterId === master.id && !r.archive.isArchived)) {
    throw new Error(`Driver ${master.id} is already actively registered with ${company.name}.`);
  }

  // Allocate company-specific record ID
  const recordId = allocateCompanyDriverRecordId(company, companyStore.relationships);
  const relationship: CompanyDriverRelationship = {
    id: recordId,
    companyId,
    driverMasterId: master.id,
    recordType: input.recordType,
    operatingRegion: input.operatingRegion,
    currentRole: input.currentRole,
    driverStatus: input.driverStatus,
    employmentStatus: input.employmentStatus,
    startDate: input.relationshipStartDate,
    endDate: input.relationshipEndDate || undefined,
    roleHistory: input.currentRole
      ? [
          {
            id: createId("ROLE"),
            role: input.currentRole,
            effectiveFrom: input.relationshipStartDate,
            effectiveTo: null,
            status: "Current",
            source: "Initial Relationship Agreement",
            createdAt: now,
          },
        ]
      : [],
    statusHistory: [
      {
        id: createId("STA"),
        statusValue: input.driverStatus,
        effectiveFrom: input.relationshipStartDate,
        effectiveTo: null,
        status: "Current",
        reason: "Initial Onboarding",
        source: "Relationship Setup",
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
    archive: { isArchived: false },
  };

  // Commit Stores Atomically
  if (!matchedExisting) {
    masterStore.drivers.unshift(master);
    saveDriverMasterStore(masterStore);
  }

  companyStore.relationships.unshift(relationship);
  saveCompanyDriverStore(companyStore);

  return { master, relationship, matchedExisting };
}

// --- PROFILE & IDENTITY MUTATIONS ---
export function updateMaster(driverId: string, patch: Partial<DriverMaster["identity"]>) {
  const store = loadDriverMasterStore();
  const driver = store.drivers.find((d) => d.id === driverId);
  if (!driver) throw new Error(`Driver Master ${driverId} not found.`);

  const now = new Date().toISOString();
  const updated: DriverMaster = {
    ...driver,
    identity: {
      ...driver.identity,
      ...patch,
      legalFirstName: normalizeName(patch.legalFirstName ?? driver.identity.legalFirstName),
      legalMiddleName: normalizeName(patch.legalMiddleName ?? driver.identity.legalMiddleName ?? "") || undefined,
      legalLastName: normalizeName(patch.legalLastName ?? driver.identity.legalLastName),
      preferredName: normalizeName(patch.preferredName ?? driver.identity.preferredName ?? "") || undefined,
    },
    updatedAt: now,
  };

  store.drivers = store.drivers.map((d) => (d.id === driverId ? updated : d));
  saveDriverMasterStore(store);
  return updated;
}

export function updateRelationship(
  companyId: string,
  driverId: string,
  patch: Partial<Pick<CompanyDriverRelationship, "recordType" | "operatingRegion" | "currentRole" | "driverStatus" | "employmentStatus" | "startDate" | "endDate">>,
  reason?: string
) {
  const store = loadCompanyDriverStore(companyId);
  const relationship = store.relationships.find((r) => r.driverMasterId === driverId && !r.archive.isArchived);
  if (!relationship) throw new Error(`Active relationship not found for Driver ${driverId}.`);

  const now = new Date().toISOString();
  const updated: CompanyDriverRelationship = {
    ...relationship,
    ...patch,
    updatedAt: now,
  };

  if (patch.driverStatus && patch.driverStatus !== relationship.driverStatus) {
    // Close old status history and append new
    updated.statusHistory = [
      ...relationship.statusHistory.map((s) => (!s.effectiveTo ? { ...s, effectiveTo: now.slice(0, 10), status: "Historical" as const } : s)),
      {
        id: createId("STA"),
        statusValue: patch.driverStatus,
        effectiveFrom: now.slice(0, 10),
        effectiveTo: null,
        status: "Current",
        reason: reason || undefined,
        source: "Driver Workspace",
        createdAt: now,
      },
    ];
  }

  store.relationships = store.relationships.map((r) => (r.id === relationship.id ? updated : r));
  saveCompanyDriverStore(store);
  return updated;
}

export function updateAddress(
  driverId: string,
  input: Omit<AddressRecord, "id" | "createdAt" | "effectiveTo" | "status" | "source">
) {
  const store = loadDriverMasterStore();
  const driver = store.drivers.find((d) => d.id === driverId);
  if (!driver) throw new Error(`Driver Master ${driverId} not found.`);

  const now = new Date().toISOString();
  const newAddress: AddressRecord = {
    ...input,
    id: createId("ADR"),
    addressLine1: normalizeName(input.addressLine1),
    addressLine2: normalizeName(input.addressLine2 || "") || undefined,
    city: normalizeName(input.city),
    stateProvince: input.stateProvince.trim().toUpperCase(),
    postalZip: input.postalZip.trim().toUpperCase(),
    effectiveTo: null,
    status: "Current",
    source: "Driver Workspace Edit",
    createdAt: now,
  };

  // Close previous open address
  const updatedHistory: AddressRecord[] = driver.addressHistory.map((a) =>
    !a.effectiveTo ? { ...a, effectiveTo: input.effectiveFrom || now.slice(0, 10), status: "Historical" as const } : a
  );
  updatedHistory.unshift(newAddress);

  driver.addressHistory = updatedHistory;
  driver.updatedAt = now;
  saveDriverMasterStore(store);
  return newAddress;
}

export function syncJurisdictionReviewForAddress(
  driverId: string,
  addressState: string,
  licenceJurisdiction?: string,
  reviewInput?: { reason: string; explanation: string; expectedResolutionDate: string }
) {
  const store = loadDriverMasterStore();
  const driver = store.drivers.find((d) => d.id === driverId);
  if (!driver) return;

  const now = new Date().toISOString();
  const addrStateNorm = addressState.trim().toUpperCase();
  const licStateNorm = (licenceJurisdiction || "").trim().toUpperCase();
  const hasMismatch = Boolean(addrStateNorm && licStateNorm && addrStateNorm !== licStateNorm);

  if (hasMismatch) {
    const openReview = driver.jurisdictionReviews.find((r) => r.status === "OPEN");
    if (openReview) {
      if (reviewInput) {
        openReview.reason = reviewInput.reason || openReview.reason;
        openReview.explanation = reviewInput.explanation || openReview.explanation;
        openReview.expectedResolutionDate = reviewInput.expectedResolutionDate || openReview.expectedResolutionDate;
      }
    } else {
      driver.jurisdictionReviews.unshift({
        id: createId("JUR"),
        status: "OPEN",
        reason: reviewInput?.reason || "Recently Relocated",
        explanation: reviewInput?.explanation || "Residential address jurisdiction differs from issued commercial driver licence.",
        expectedResolutionDate: reviewInput?.expectedResolutionDate || undefined,
        createdAt: now,
      });
    }
    driver.identityResolution.status = "REVIEW";
  } else {
    // Resolve all open jurisdiction reviews
    driver.jurisdictionReviews.forEach((r) => {
      if (r.status === "OPEN") {
        r.status = "RESOLVED";
        r.resolvedAt = now;
      }
    });
    driver.identityResolution.status = "CLEAR";
  }

  driver.updatedAt = now;
  saveDriverMasterStore(store);
}

// --- LICENSING MUTATIONS ---
export function addLicenceRecord(
  driverId: string,
  licence: Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo">
): LicenceRecord {
  const store = loadDriverMasterStore();
  const driver = store.drivers.find((d) => d.id === driverId);
  if (!driver) throw new Error(`Driver ${driverId} not found.`);

  const now = new Date().toISOString();
  const record: LicenceRecord = {
    ...licence,
    id: createId("LIC"),
    licenceNumber: normalizeLicence(licence.licenceNumber),
    licenceNumberRaw: licence.licenceNumber,
    effectiveTo: null,
    status: "Current",
    createdAt: now,
  };

  // Close previous current licence
  driver.licenceHistory = driver.licenceHistory.map((l) =>
    !l.effectiveTo ? { ...l, effectiveTo: licence.effectiveFrom || now.slice(0, 10), status: "Historical" as const } : l
  );
  driver.licenceHistory.unshift(record);
  driver.updatedAt = now;

  saveDriverMasterStore(store);
  return record;
}

// --- DOCUMENTS: APPLICATION, HIRING PACKAGE, TAX DOCS ---
export function createDriverApplication(
  companyId: string,
  driverMasterId: string,
  data: Partial<DriverApplicationRecord>
): DriverApplicationRecord {
  const store = loadCompanyDriverStore(companyId);
  const now = new Date().toISOString();
  const record: DriverApplicationRecord = {
    id: createId("APP"),
    companyId,
    driverMasterId,
    applicationType: data.applicationType || "Full Driver Employment",
    status: data.status || "Submitted",
    operatingRegion: data.operatingRegion || "Cross-Border",
    createdDate: data.createdDate || now.slice(0, 10),
    submittedDate: data.submittedDate || now.slice(0, 10),
    experienceYears: data.experienceYears,
    trafficConvictionsLast3Yrs: data.trafficConvictionsLast3Yrs,
    accidentsLast3Yrs: data.accidentsLast3Yrs,
    evidenceIds: data.evidenceIds || [],
    createdAt: now,
    updatedAt: now,
    ...data,
  };

  store.applications = store.applications || [];
  store.applications.unshift(record);
  saveCompanyDriverStore(store);
  return record;
}

export function updateDriverApplicationDetermination(
  companyId: string,
  appId: string,
  determination: "Approved" | "Rejected" | "Withdrawn",
  reviewer: string,
  notes?: string
) {
  const store = loadCompanyDriverStore(companyId);
  const app = store.applications?.find((a) => a.id === appId);
  if (!app) throw new Error(`Application ${appId} not found.`);

  const now = new Date().toISOString();
  app.companyDetermination = determination;
  app.status = determination === "Approved" ? "Approved" : determination === "Rejected" ? "Rejected" : "Withdrawn";
  app.reviewedDate = now.slice(0, 10);
  app.reviewedBy = reviewer;
  app.determinationDate = now.slice(0, 10);
  app.determinationNotes = notes || undefined;
  app.updatedAt = now;

  saveCompanyDriverStore(store);
  return app;
}

export function updateHiringPackageItem(
  companyId: string,
  pkgId: string,
  itemId: string,
  signed: boolean,
  signerName?: string
) {
  const store = loadCompanyDriverStore(companyId);
  const pkg = store.hiringPackages?.find((p) => p.id === pkgId);
  if (!pkg) throw new Error(`Hiring package ${pkgId} not found.`);

  const item = pkg.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`Item ${itemId} not found.`);

  const now = new Date().toISOString();
  item.signed = signed;
  item.signedDate = signed ? now.slice(0, 10) : undefined;
  item.signedBy = signed ? signerName : undefined;
  pkg.updatedAt = now;

  // Check if all required items are signed
  const allRequiredSigned = pkg.items.filter((i) => i.required).every((i) => i.signed);
  if (allRequiredSigned) {
    pkg.status = "Completed";
    pkg.completedDate = now.slice(0, 10);
  } else {
    pkg.status = "Issued / In Progress";
  }

  saveCompanyDriverStore(store);
  return pkg;
}

// --- SCREENING & MEDICAL ---
export function createScreeningRecord(
  companyId: string,
  driverMasterId: string,
  data: Omit<ScreeningRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">
): ScreeningRecord {
  const store = loadCompanyDriverStore(companyId);
  const now = new Date().toISOString();
  const record: ScreeningRecord = {
    ...data,
    id: createId("SCR"),
    companyId,
    driverMasterId,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  store.screenings = store.screenings || [];
  store.screenings.unshift(record);
  saveCompanyDriverStore(store);
  return record;
}

export function archiveScreeningRecord(companyId: string, screeningId: string) {
  const store = loadCompanyDriverStore(companyId);
  const screening = store.screenings?.find((s) => s.id === screeningId);
  if (!screening) return;

  screening.isArchived = true;
  screening.updatedAt = new Date().toISOString();
  saveCompanyDriverStore(store);
}

// --- TRAINING LEDGER ---
export function createTrainingRecord(
  companyId: string,
  driverMasterId: string,
  data: Omit<TrainingRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">
): TrainingRecord {
  const store = loadCompanyDriverStore(companyId);
  const now = new Date().toISOString();
  const record: TrainingRecord = {
    ...data,
    id: createId("TRN"),
    companyId,
    driverMasterId,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  store.trainingRecords = store.trainingRecords || [];
  store.trainingRecords.unshift(record);
  saveCompanyDriverStore(store);
  return record;
}

export function updateTrainingStatus(
  companyId: string,
  trainingId: string,
  status: TrainingStatus,
  completionDate?: string,
  scoreOrResult?: string,
  waiveReason?: string,
  waivedBy?: string
) {
  const store = loadCompanyDriverStore(companyId);
  const record = store.trainingRecords?.find((t) => t.id === trainingId);
  if (!record) throw new Error(`Training record ${trainingId} not found.`);

  const now = new Date().toISOString();
  record.status = status;
  if (status === "Completed") {
    record.completionDate = completionDate || undefined;
    record.scoreOrResult = scoreOrResult || undefined;
  } else if (status === "Waived" || status === "Not Applicable") {
    record.waiveReason = waiveReason || undefined;
    record.waivedBy = waivedBy || undefined;
  }
  record.updatedAt = now;

  saveCompanyDriverStore(store);
  return record;
}

// --- PERFORMANCE & EVENTS SUBSYSTEM ---
export function createPerformanceEvent(
  companyId: string,
  driverMasterId: string,
  data: Omit<PerformanceEventRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "chronology" | "isArchived">,
  actor?: string
): PerformanceEventRecord {
  const store = loadCompanyDriverStore(companyId);
  const now = new Date().toISOString();

  const initialChronology: EventChronologyItem[] = [
    {
      id: createId("LOG"),
      timestamp: now,
      action: "EVENT_CREATED",
      actor: actor || null,
      details: `Created ${data.eventType} record with severity "${data.severity}".`,
    },
  ];

  const record: PerformanceEventRecord = {
    ...data,
    id: createId("EVT"),
    companyId,
    driverMasterId,
    chronology: initialChronology,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  store.performanceEvents = store.performanceEvents || [];
  store.performanceEvents.unshift(record);
  saveCompanyDriverStore(store);
  return record;
}

export function updatePerformanceEvent(
  companyId: string,
  eventId: string,
  patch: Partial<PerformanceEventRecord>,
  logDetails?: string,
  actor?: string
) {
  const store = loadCompanyDriverStore(companyId);
  const event = store.performanceEvents?.find((e) => e.id === eventId);
  if (!event) throw new Error(`Event ${eventId} not found.`);

  const now = new Date().toISOString();
  Object.assign(event, patch);
  event.updatedAt = now;

  if (logDetails) {
    event.chronology.unshift({
      id: createId("LOG"),
      timestamp: now,
      action: "RECORD_UPDATED",
      actor: actor || null,
      details: logDetails,
    });
  }

  saveCompanyDriverStore(store);
  return event;
}

export function recordCollisionPreventability(
  companyId: string,
  eventId: string,
  preventability: "Preventable" | "Non-Preventable" | "Undetermined",
  determinedBy: string,
  source: string,
  notes?: string
) {
  const store = loadCompanyDriverStore(companyId);
  const event = store.performanceEvents?.find((e) => e.id === eventId);
  if (!event || !event.collisionDetails) throw new Error(`Collision event ${eventId} not found.`);

  const now = new Date().toISOString();
  event.collisionDetails.preventability = preventability;
  event.collisionDetails.preventabilityDeterminedBy = determinedBy;
  event.collisionDetails.preventabilityDeterminationDate = now.slice(0, 10);
  event.collisionDetails.preventabilitySource = source;
  event.collisionDetails.preventabilityNotes = notes || undefined;
  event.updatedAt = now;

  event.chronology.unshift({
    id: createId("LOG"),
    timestamp: now,
    action: "PREVENTABILITY_DETERMINED",
    actor: determinedBy,
    details: `Preventability determination recorded as "${preventability}" based on ${source}.`,
  });

  saveCompanyDriverStore(store);
  return event;
}

export function closeEventFollowUp(
  companyId: string,
  eventId: string,
  closedBy: string,
  closureNotes: string
) {
  const store = loadCompanyDriverStore(companyId);
  const event = store.performanceEvents?.find((e) => e.id === eventId);
  if (!event) throw new Error(`Event ${eventId} not found.`);

  const now = new Date().toISOString();
  event.status = "Closed";
  event.updatedAt = now;

  event.chronology.unshift({
    id: createId("LOG"),
    timestamp: now,
    action: "EVENT_CLOSED",
    actor: closedBy,
    details: `Event follow-up closed: ${closureNotes}`,
  });

  saveCompanyDriverStore(store);
  return event;
}

export function archivePerformanceEvent(companyId: string, eventId: string) {
  const store = loadCompanyDriverStore(companyId);
  const event = store.performanceEvents?.find((e) => e.id === eventId);
  if (!event) return;

  event.isArchived = true;
  event.updatedAt = new Date().toISOString();
  saveCompanyDriverStore(store);
}

// --- HOS REVIEWS ---
export function addHOSReview(
  companyId: string,
  reviewInput: Omit<HOSReview, "id" | "createdAt" | "updatedAt">
): HOSReview {
  const store = loadCompanyDriverStore(companyId);
  const now = new Date().toISOString();
  const id = createId("HOSR");

  const record: HOSReview = {
    ...reviewInput,
    id,
    createdAt: now,
    updatedAt: now,
  };

  if (!store.hosReviews) store.hosReviews = [];
  store.hosReviews.push(record);

  // If linked to performance event, update the event review status
  if (record.performanceEventId) {
    const evt = store.performanceEvents?.find((e) => e.id === record.performanceEventId);
    if (evt && evt.hosDetails) {
      if (record.initialReviewFinding === "Confirmed Violation") {
        evt.hosDetails.reviewStatus = "Confirmed";
      } else if (record.initialReviewFinding === "False Positive" || record.initialReviewFinding === "Exempt Operation") {
        evt.hosDetails.reviewStatus = "Disputed";
      }
      evt.hosDetails.reviewNotes = record.evidenceSummary;
      evt.updatedAt = now;
      evt.chronology.unshift({
        id: createId("LOG"),
        timestamp: now,
        action: "HOS_AUDITED",
        actor: record.auditorName,
        details: `HOS compliance audit recorded: ${record.initialReviewFinding} (${record.carrierResolution}).`,
      });
    }
  }

  saveCompanyDriverStore(store);
  return record;
}

// --- COMPANY DETERMINATIONS ---
export function addCompanyDetermination(
  companyId: string,
  detInput: Omit<CompanyDetermination, "id" | "createdAt" | "updatedAt" | "isArchived">
): CompanyDetermination {
  const store = loadCompanyDriverStore(companyId);
  const now = new Date().toISOString();
  const id = createId("DET");

  const record: CompanyDetermination = {
    ...detInput,
    id,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  if (!store.companyDeterminations) store.companyDeterminations = [];
  store.companyDeterminations.push(record);

  saveCompanyDriverStore(store);
  return record;
}

// --- COMPANY ACTIONS ---
export function addCompanyAction(
  companyId: string,
  actionInput: Omit<CompanyActionRecord, "id" | "createdAt" | "updatedAt" | "isArchived">
): CompanyActionRecord {
  const store = loadCompanyDriverStore(companyId);
  const now = new Date().toISOString();
  const id = createId("CACT");

  const record: CompanyActionRecord = {
    ...actionInput,
    id,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  if (!store.companyActions) store.companyActions = [];
  store.companyActions.push(record);

  saveCompanyDriverStore(store);
  return record;
}

export function updateCompanyAction(
  companyId: string,
  actionId: string,
  patch: Partial<CompanyActionRecord>
): CompanyActionRecord {
  const store = loadCompanyDriverStore(companyId);
  const act = store.companyActions?.find((a) => a.id === actionId);
  if (!act) throw new Error(`Company action ${actionId} not found.`);

  Object.assign(act, patch, { updatedAt: new Date().toISOString() });
  saveCompanyDriverStore(store);
  return act;
}

// --- PERFORMANCE INDICATOR CALCULATIONS ---
export function calculatePerformanceIndicators(
  events: PerformanceEventRecord[],
  timeWindow: "30D" | "90D" | "12M" | "YTD" | "ALL" = "12M"
) {
  const now = new Date();
  let cutoff = new Date(0);

  if (timeWindow === "30D") {
    cutoff = new Date(now.getTime() - 30 * 86400000);
  } else if (timeWindow === "90D") {
    cutoff = new Date(now.getTime() - 90 * 86400000);
  } else if (timeWindow === "12M") {
    cutoff = new Date(now.getTime() - 365 * 86400000);
  } else if (timeWindow === "YTD") {
    cutoff = new Date(now.getFullYear(), 0, 1);
  }

  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const filtered = events.filter((e) => !e.isArchived && e.eventDate >= cutoffStr);

  const collisions = filtered.filter((e) => e.eventType === "Collision");
  const preventableCollisions = collisions.filter((e) => e.collisionDetails?.preventability === "Preventable");
  const nonPreventableCollisions = collisions.filter((e) => e.collisionDetails?.preventability === "Non-Preventable");
  const undeterminedCollisions = collisions.filter((e) => !e.collisionDetails?.preventability || e.collisionDetails.preventability === "Undetermined");

  const inspections = filtered.filter((e) => e.eventType === "Roadside Inspection");
  const passedInspections = inspections.filter((e) => e.inspectionDetails?.result === "Passed");
  const violationInspections = inspections.filter((e) => e.inspectionDetails?.result === "Violation(s) Found");
  const oosInspections = inspections.filter((e) => e.inspectionDetails?.result === "Out of Service" || e.inspectionDetails?.driverOOS || e.inspectionDetails?.vehicleOOS);

  const hosViolations = filtered.filter((e) => e.eventType === "HOS Violation");
  const trafficCitations = filtered.filter((e) => e.eventType === "Traffic Citation");
  const cargoIncidents = filtered.filter((e) => e.eventType === "Cargo Damage" || e.eventType === "Cargo Theft" || e.eventType === "Spill or Release");

  const complaints = filtered.filter((e) => e.eventType === "Customer Complaint");
  const substantiatedComplaints = complaints.filter((e) => e.complaintDetails?.substantiationStatus === "Substantiated");
  const commendations = filtered.filter((e) => e.eventType === "Customer Commendation" || e.eventType === "Positive Safety Observation");

  const coachingSessions = filtered.filter((e) => e.eventType === "Coaching Session");
  const disciplinaryActions = filtered.filter((e) => e.eventType === "Disciplinary Action");
  const capPlans = filtered.filter((e) => e.eventType === "Corrective Action Plan");

  // Most recent occurrences
  const latestCollision = collisions.sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];
  const latestInspection = inspections.sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];
  const latestCoaching = coachingSessions.sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];
  const latestCommendation = commendations.sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];

  return {
    totalEvents: filtered.length,
    collisionsCount: collisions.length,
    preventableCollisionsCount: preventableCollisions.length,
    nonPreventableCollisionsCount: nonPreventableCollisions.length,
    undeterminedCollisionsCount: undeterminedCollisions.length,
    inspectionsCount: inspections.length,
    passedInspectionsCount: passedInspections.length,
    violationInspectionsCount: violationInspections.length,
    oosInspectionsCount: oosInspections.length,
    hosViolationsCount: hosViolations.length,
    trafficCitationsCount: trafficCitations.length,
    cargoIncidentsCount: cargoIncidents.length,
    complaintsCount: complaints.length,
    substantiatedComplaintsCount: substantiatedComplaints.length,
    commendationsCount: commendations.length,
    coachingSessionsCount: coachingSessions.length,
    disciplinaryActionsCount: disciplinaryActions.length,
    capPlansCount: capPlans.length,
    latestCollisionDate: latestCollision?.eventDate,
    latestInspectionDate: latestInspection?.eventDate,
    latestCoachingDate: latestCoaching?.eventDate,
    latestCommendationDate: latestCommendation?.eventDate,
  };
}

// --- SNAPSHOT & ROLLBACK ---
export function captureDriverStoreSnapshot(companyId: string) {
  return {
    master: loadDriverMasterStore(),
    company: loadCompanyDriverStore(companyId),
  };
}

export function restoreDriverStoreSnapshot(snapshot: ReturnType<typeof captureDriverStoreSnapshot>) {
  saveDriverMasterStore(snapshot.master);
  saveCompanyDriverStore(snapshot.company);
}

// =========================================================================
// REALISTIC CANONICAL SEED DATA (SAFE, RESPECTFUL & TRUTHFUL)
// =========================================================================
function getInitialSeedMasterStore(): DriverMasterStore {
  const now = new Date().toISOString();
  return {
    version: 1,
    drivers: [
      {
        id: "DRV-000001",
        createdAt: "2024-03-12T10:00:00Z",
        updatedAt: now,
        identity: {
          legalFirstName: "Muhammad",
          legalMiddleName: "Tariq",
          legalLastName: "Khan",
          preferredName: "Tariq",
          dateOfBirth: "1984-06-18",
          phone: "(905) 555-0184",
          email: "tariq.khan@powerwaylogistics.com",
        },
        identityReferences: [
          {
            id: "IDR-001",
            type: "DRIVER_LICENCE",
            value: "K2918491829104",
            jurisdiction: "ON",
            country: "Canada",
            createdAt: "2024-03-12T10:00:00Z",
            source: "Ontario DL Ingestion",
          },
        ],
        licenceHistory: [
          {
            id: "LIC-001",
            licenceNumber: "K2918491829104",
            licenceNumberRaw: "K2918-49182-9104",
            jurisdiction: "ON",
            country: "Canada",
            class: "Class A / AZ",
            endorsements: ["Air Brake (Z)", "Dangerous Goods Certified"],
            restrictions: ["Corrective Lenses (01)"],
            airBrakeQualified: true,
            issueDate: "2022-06-18",
            expiryDate: "2027-06-18",
            effectiveFrom: "2022-06-18",
            effectiveTo: null,
            status: "Current",
            verificationState: "MVR Confirmed",
            source: "MTO Verified",
            createdAt: "2024-03-12T10:00:00Z",
          },
        ],
        addressHistory: [
          {
            id: "ADR-001",
            addressLine1: "4820 Dixie Road, Unit 14",
            city: "Mississauga",
            stateProvince: "ON",
            postalZip: "L4W 2A9",
            country: "Canada",
            effectiveFrom: "2023-01-10",
            effectiveTo: null,
            status: "Current",
            source: "Driver Onboarding",
            createdAt: "2024-03-12T10:00:00Z",
          },
        ],
        identityResolution: { status: "CLEAR" },
        jurisdictionReviews: [],
        archive: { isArchived: false },
      },
      {
        id: "DRV-000002",
        createdAt: "2024-05-20T14:30:00Z",
        updatedAt: now,
        identity: {
          legalFirstName: "Gurpreet",
          legalMiddleName: "Singh",
          legalLastName: "Dhillon",
          preferredName: "Gary",
          dateOfBirth: "1990-11-24",
          phone: "(403) 555-8912",
          email: "gary.dhillon@northernstar.ca",
        },
        identityReferences: [
          {
            id: "IDR-002",
            type: "DRIVER_LICENCE",
            value: "91820491",
            jurisdiction: "AB",
            country: "Canada",
            createdAt: "2024-05-20T14:30:00Z",
            source: "Alberta Operator Ingestion",
          },
        ],
        licenceHistory: [
          {
            id: "LIC-002",
            licenceNumber: "91820491",
            licenceNumberRaw: "9182049-1",
            jurisdiction: "AB",
            country: "Canada",
            class: "Class 1 Commercial",
            endorsements: ["Air Brake (Q)", "Long Combination Vehicle (LCV)"],
            restrictions: ["None"],
            airBrakeQualified: true,
            issueDate: "2021-11-20",
            expiryDate: "2026-11-20",
            effectiveFrom: "2021-11-20",
            effectiveTo: null,
            status: "Current",
            verificationState: "MVR Confirmed",
            source: "Alberta Registry",
            createdAt: "2024-05-20T14:30:00Z",
          },
        ],
        addressHistory: [
          {
            id: "ADR-002",
            addressLine1: "1924 36 Street NE",
            city: "Calgary",
            stateProvince: "AB",
            postalZip: "T1Y 5H8",
            country: "Canada",
            effectiveFrom: "2022-04-01",
            effectiveTo: null,
            status: "Current",
            source: "Driver Onboarding",
            createdAt: "2024-05-20T14:30:00Z",
          },
        ],
        identityResolution: { status: "CLEAR" },
        jurisdictionReviews: [],
        archive: { isArchived: false },
      },
      {
        id: "DRV-000003",
        createdAt: "2024-08-10T09:15:00Z",
        updatedAt: now,
        identity: {
          legalFirstName: "David",
          legalMiddleName: "Robert",
          legalLastName: "Smith",
          preferredName: "Dave",
          dateOfBirth: "1978-02-14",
          phone: "(312) 555-4910",
          email: "dave.smith@midwestfreight.us",
        },
        identityReferences: [
          {
            id: "IDR-003",
            type: "DRIVER_LICENCE",
            value: "S53091823901",
            jurisdiction: "IL",
            country: "United States",
            createdAt: "2024-08-10T09:15:00Z",
            source: "Illinois Secretary of State",
          },
        ],
        licenceHistory: [
          {
            id: "LIC-003",
            licenceNumber: "S53091823901",
            licenceNumberRaw: "S530-9182-3901",
            jurisdiction: "IL",
            country: "United States",
            class: "Class A CDL",
            endorsements: ["Air Brake", "Tanker (N)", "Doubles/Triples (T)"],
            restrictions: ["None"],
            airBrakeQualified: true,
            issueDate: "2023-02-10",
            expiryDate: "2027-02-10",
            effectiveFrom: "2023-02-10",
            effectiveTo: null,
            status: "Current",
            verificationState: "Document Verified",
            source: "Driver Copy",
            createdAt: "2024-08-10T09:15:00Z",
          },
        ],
        addressHistory: [
          {
            id: "ADR-003",
            addressLine1: "820 N Michigan Avenue",
            city: "Chicago",
            stateProvince: "IL",
            postalZip: "60611",
            country: "United States",
            effectiveFrom: "2023-05-15",
            effectiveTo: null,
            status: "Current",
            source: "Driver Onboarding",
            createdAt: "2024-08-10T09:15:00Z",
          },
        ],
        identityResolution: { status: "CLEAR" },
        jurisdictionReviews: [],
        archive: { isArchived: false },
      },
    ],
  };
}

function getInitialSeedCompanyStore(companyId: string): CompanyDriverStore {
  // Requirement 29: Real empty company starts strictly empty. Demo records are isolated to demo carrier CMP-10492.
  if (companyId !== "CMP-10492") {
    return {
      version: 1,
      companyId,
      relationships: [],
      applications: [],
      hiringPackages: [],
      taxDocs: [],
      screenings: [],
      trainingRecords: [],
      performanceEvents: [],
      evidence: [],
      hosDutyEvents: [],
      hosRuleProfiles: [],
      hosPotentialViolations: [],
      hosReviews: [],
      eldEditRequests: [],
      unassignedDriving: [],
      eldDiagnostics: [],
      companyDeterminations: [],
      companyActions: [],
    };
  }

  const now = new Date().toISOString();
  return {
    version: 1,
    companyId,
    relationships: [
      {
        id: "PW-DRV-000184",
        companyId,
        driverMasterId: "DRV-000001",
        recordType: "Employee",
        operatingRegion: "Cross-Border",
        currentRole: "Driver",
        driverStatus: "Active",
        employmentStatus: "Employed",
        startDate: "2024-03-15",
        roleHistory: [
          {
            id: "ROLE-001",
            role: "Driver",
            effectiveFrom: "2024-03-15",
            effectiveTo: null,
            status: "Current",
            source: "Driver Agreement",
            createdAt: "2024-03-15T08:00:00Z",
          },
        ],
        statusHistory: [
          {
            id: "STA-001",
            statusValue: "Active",
            effectiveFrom: "2024-03-15",
            effectiveTo: null,
            status: "Current",
            reason: "Hired for Cross-Border Midwest Corridor",
            source: "Onboarding Decision",
            createdAt: "2024-03-15T08:00:00Z",
          },
        ],
        createdAt: "2024-03-15T08:00:00Z",
        updatedAt: now,
        archive: { isArchived: false },
      },
      {
        id: "PW-DRV-000185",
        companyId,
        driverMasterId: "DRV-000002",
        recordType: "Owner-Operator",
        operatingRegion: "Cross-Border",
        currentRole: "Driver",
        driverStatus: "Active",
        employmentStatus: "Contractor",
        startDate: "2024-05-22",
        roleHistory: [
          {
            id: "ROLE-002",
            role: "Driver",
            effectiveFrom: "2024-05-22",
            effectiveTo: null,
            status: "Current",
            source: "Owner-Operator Lease",
            createdAt: "2024-05-22T09:00:00Z",
          },
        ],
        statusHistory: [
          {
            id: "STA-002",
            statusValue: "Active",
            effectiveFrom: "2024-05-22",
            effectiveTo: null,
            status: "Current",
            reason: "Lease Contract Executed",
            source: "Safety Department",
            createdAt: "2024-05-22T09:00:00Z",
          },
        ],
        createdAt: "2024-05-22T09:00:00Z",
        updatedAt: now,
        archive: { isArchived: false },
      },
      {
        id: "PW-DRV-000186",
        companyId,
        driverMasterId: "DRV-000003",
        recordType: "Contractor",
        operatingRegion: "United States",
        currentRole: "Driver",
        driverStatus: "On Leave",
        employmentStatus: "On Leave",
        startDate: "2024-08-12",
        roleHistory: [
          {
            id: "ROLE-003",
            role: "Driver",
            effectiveFrom: "2024-08-12",
            effectiveTo: null,
            status: "Current",
            source: "Contract Agreement",
            createdAt: "2024-08-12T10:00:00Z",
          },
        ],
        statusHistory: [
          {
            id: "STA-003",
            statusValue: "On Leave",
            effectiveFrom: "2025-01-05",
            effectiveTo: null,
            status: "Current",
            reason: "Personal leave of absence",
            source: "HR Request",
            createdAt: "2025-01-05T09:00:00Z",
          },
        ],
        createdAt: "2024-08-12T10:00:00Z",
        updatedAt: now,
        archive: { isArchived: false },
      },
    ],
    applications: [
      {
        id: "APP-000102",
        companyId,
        driverMasterId: "DRV-000001",
        applicationType: "Full Driver Employment",
        status: "Approved",
        operatingRegion: "Cross-Border",
        createdDate: "2024-03-01",
        submittedDate: "2024-03-04",
        reviewedDate: "2024-03-10",
        reviewedBy: "Safety Director - J. Tremblay",
        companyDetermination: "Approved",
        determinationDate: "2024-03-10",
        determinationNotes: "Verified 8 years cross-border reefer experience. Clean MVR abstract.",
        personalInfoSummary: {
          legalName: "Muhammad Tariq Khan",
          phone: "(905) 555-0184",
          email: "tariq.khan@powerwaylogistics.com",
          workAuthorized: true,
        },
        experienceYears: 8,
        equipmentExperience: ["Tractor-Trailer (53ft Reefer)", "Tractor-Trailer (Dry Van)"],
        trafficConvictionsLast3Yrs: 0,
        accidentsLast3Yrs: 0,
        evidenceIds: [],
        createdAt: "2024-03-01T09:00:00Z",
        updatedAt: now,
      },
    ],
    hiringPackages: [
      {
        id: "HPK-000084",
        companyId,
        driverMasterId: "DRV-000001",
        packageVersion: "2024.1 Universal Compliance Package",
        issuedDate: "2024-03-10",
        completedDate: "2024-03-14",
        status: "Completed",
        items: [
          {
            id: "HPK-ITM-01",
            title: "Commercial Driver Employment Agreement",
            category: "Agreement",
            required: true,
            signed: true,
            signedDate: "2024-03-12",
            signedBy: "Muhammad T. Khan",
          },
          {
            id: "HPK-ITM-02",
            title: "Substance Testing Policy & Consent Form",
            category: "Consent",
            required: true,
            signed: true,
            signedDate: "2024-03-12",
            signedBy: "Muhammad T. Khan",
          },
          {
            id: "HPK-ITM-03",
            title: "MVR / Driver Abstract Release Authorization",
            category: "Consent",
            required: true,
            signed: true,
            signedDate: "2024-03-12",
            signedBy: "Muhammad T. Khan",
          },
          {
            id: "HPK-ITM-04",
            title: "Fleet Safety & Distracted Driving Acknowledgement",
            category: "Policy",
            required: true,
            signed: true,
            signedDate: "2024-03-14",
            signedBy: "Muhammad T. Khan",
          },
        ],
        evidenceIds: [],
        notes: "All hiring checklist items fully completed and archived.",
        createdAt: "2024-03-10T09:00:00Z",
        updatedAt: now,
      },
    ],
    screenings: [
      {
        id: "SCR-000109",
        companyId,
        driverMasterId: "DRV-000001",
        category: "Driver Abstract / MVR Review",
        recordDate: "2024-03-05",
        expiryDate: "2025-03-05",
        status: "Qualified",
        resultSummary: "Clean 3-Year Abstract — 0 Demerit Points, 0 Violations",
        providerOrAuthority: "Ontario Ministry of Transportation (MTO)",
        evidenceIds: [],
        isArchived: false,
        createdAt: "2024-03-05T10:00:00Z",
        updatedAt: now,
      },
      {
        id: "SCR-000110",
        companyId,
        driverMasterId: "DRV-000001",
        category: "Medical Card / DOT Physical",
        recordDate: "2023-09-15",
        expiryDate: "2025-09-15",
        status: "Qualified",
        resultSummary: "2-Year Medical Certificate Issued — Certified Fit",
        providerOrAuthority: "Dr. Angela Foster, MD (FMCSA CME #7109284)",
        medicalCardDetails: {
          nationalRegistryNumber: "CME-7109284",
          examinerName: "Dr. Angela Foster, MD",
          varianceRestrictions: ["Corrective Lenses Required"],
        },
        evidenceIds: [],
        isArchived: false,
        createdAt: "2023-09-15T11:00:00Z",
        updatedAt: now,
      },
      {
        id: "SCR-000111",
        companyId,
        driverMasterId: "DRV-000001",
        category: "Pre-Employment Drug Test",
        recordDate: "2024-03-08",
        status: "Passed",
        resultSummary: "Negative (DOT 5-Panel Verified by MRO)",
        providerOrAuthority: "Dynacare Occupational Health / MRO Dr. R. Patel",
        evidenceIds: [],
        isArchived: false,
        createdAt: "2024-03-08T15:00:00Z",
        updatedAt: now,
      },
      {
        id: "SCR-000112",
        companyId,
        driverMasterId: "DRV-000001",
        category: "FMCSA Clearinghouse Query",
        recordDate: "2024-03-06",
        status: "Qualified",
        resultSummary: "Driver is NOT PROHIBITED — No Open Violations",
        providerOrAuthority: "FMCSA National Drug & Alcohol Clearinghouse",
        evidenceIds: [],
        isArchived: false,
        createdAt: "2024-03-06T12:00:00Z",
        updatedAt: now,
      },
    ],
    trainingRecords: [
      {
        id: "TRN-000047",
        companyId,
        driverMasterId: "DRV-000001",
        courseTitle: "Commercial Vehicle Pre-Trip & Air Brake Inspection (CVIP Standard)",
        trainingType: "Initial Onboarding",
        provider: "Internal Safety Department",
        assignedDate: "2024-03-11",
        startDate: "2024-03-12",
        completionDate: "2024-03-12",
        expiryDate: "2026-03-12",
        status: "Completed",
        scoreOrResult: "100% Practical & Written",
        certificateNumber: "CERT-PW-2024-0941",
        evidenceIds: [],
        notes: "Completed yard walk-around and air leakage timing demonstration.",
        isArchived: false,
        createdAt: "2024-03-11T09:00:00Z",
        updatedAt: now,
      },
      {
        id: "TRN-000048",
        companyId,
        driverMasterId: "DRV-000001",
        courseTitle: "Hours of Service & ELD Regulations (FMCSA Part 395 & NSC Standard 9)",
        trainingType: "Initial Onboarding",
        provider: "Pro-Tread Safety Training",
        assignedDate: "2024-03-11",
        startDate: "2024-03-13",
        completionDate: "2024-03-13",
        expiryDate: "2025-03-13",
        status: "Completed",
        scoreOrResult: "98%",
        certificateNumber: "PT-HOS-918204",
        evidenceIds: [],
        isArchived: false,
        createdAt: "2024-03-11T09:00:00Z",
        updatedAt: now,
      },
      {
        id: "TRN-000049",
        companyId,
        driverMasterId: "DRV-000001",
        courseTitle: "Winter Driving & Mountain Grade Space Management",
        trainingType: "Specialized Cargo",
        provider: "Internal Safety Department",
        assignedDate: "2024-10-15",
        startDate: "2024-10-20",
        completionDate: "2024-10-20",
        expiryDate: "2025-10-20",
        status: "Completed",
        scoreOrResult: "Passed",
        certificateNumber: "CERT-PW-WIN-048",
        evidenceIds: [],
        isArchived: false,
        createdAt: "2024-10-15T10:00:00Z",
        updatedAt: now,
      },
    ],
    performanceEvents: [
      {
        id: "EVT-YK-000419",
        companyId,
        driverMasterId: "DRV-000001",
        eventType: "Collision",
        eventDate: "2024-11-04",
        eventTime: "06:45",
        reportedDate: "2024-11-04",
        location: "I-90 Eastbound Milepost 184 near Erie, PA",
        city: "Erie",
        stateProvince: "PA",
        country: "United States",
        severity: "Moderate",
        status: "Closed",
        summary: "Low-speed backing contact with stationary dock post in wet conditions.",
        description: "While executing a 90-degree backing manoeuvre into a wet customer loading bay at dawn, the right rear ICC bumper bracket brushed against a concrete protective bollard. No structural trailer frame deformation.",
        collisionDetails: {
          collisionType: "Backing",
          weather: "Rain",
          roadCondition: "Wet",
          lightCondition: "Dawn / Dusk",
          towRequired: false,
          policeAttended: false,
          injuriesCount: 0,
          fatalitiesCount: 0,
          dotReportable: false,
          preventability: "Preventable",
          preventabilityDeterminedBy: "Safety Director - J. Tremblay",
          preventabilityDeterminationDate: "2024-11-08",
          preventabilitySource: "Internal Investigation INV-PW-0041",
          preventabilityNotes: "Driver did not execute Get Out And Look (G.O.A.L.) before final 10ft adjustment in dark/wet conditions.",
          estimatedCost: "$650.00",
        },
        linkedRecords: [
          {
            entityType: "Vehicle",
            id: "Unit-101",
            label: "Unit 101",
            secondaryText: "Freightliner Cascadia 126",
          },
          {
            entityType: "Training",
            id: "TRN-000047",
            label: "Pre-Trip & Air Brake Inspection",
          },
        ],
        evidenceIds: [],
        chronology: [
          {
            id: "LOG-01",
            timestamp: "2024-11-04T07:15:00Z",
            action: "EVENT_REPORTED",
            actor: "Muhammad T. Khan (Driver)",
            details: "Driver called dispatch immediately following low-speed dock contact.",
          },
          {
            id: "LOG-02",
            timestamp: "2024-11-04T10:00:00Z",
            action: "INVESTIGATION_OPENED",
            actor: "Safety Director - J. Tremblay",
            details: "Opened internal safety review INV-PW-0041.",
          },
          {
            id: "LOG-03",
            timestamp: "2024-11-08T14:30:00Z",
            action: "PREVENTABILITY_DETERMINED",
            actor: "Safety Director - J. Tremblay",
            details: "Recorded human determination as Preventable (lack of G.O.A.L.). Assigned low-speed manoeuvring coaching session.",
          },
          {
            id: "LOG-04",
            timestamp: "2024-11-12T16:00:00Z",
            action: "COACHING_COMPLETED",
            actor: "Safety Lead - M. Henderson",
            details: "Completed 1-on-1 backing and mirror-reference coaching session with driver.",
          },
          {
            id: "LOG-05",
            timestamp: "2024-11-14T09:00:00Z",
            action: "EVENT_CLOSED",
            actor: "Safety Director - J. Tremblay",
            details: "All follow-up coaching and bumper inspection completed. Event closed.",
          },
        ],
        isArchived: false,
        createdAt: "2024-11-04T07:15:00Z",
        updatedAt: "2024-11-14T09:00:00Z",
      },
      {
        id: "EVT-YK-000420",
        companyId,
        driverMasterId: "DRV-000001",
        eventType: "Roadside Inspection",
        eventDate: "2024-12-18",
        eventTime: "11:20",
        reportedDate: "2024-12-18",
        location: "Michigan State Police Scale #42, I-94 WB",
        city: "New Buffalo",
        stateProvince: "MI",
        country: "United States",
        severity: "Low",
        status: "Closed",
        summary: "Clean Level II Walk-Around Inspection — 0 Violations.",
        description: "Standard random commercial vehicle inspection by Michigan State Police. No driver, vehicle, or logbook violations found.",
        inspectionDetails: {
          inspectionLevel: "Level II - Walk-Around",
          reportNumber: "MI-2024-091823",
          agency: "Michigan State Police / Commercial Vehicle Enforcement",
          result: "Passed",
          driverViolationsCount: 0,
          vehicleViolationsCount: 0,
          hosViolationsCount: 0,
          driverOOS: false,
          vehicleOOS: false,
          repairStatus: "Not Required",
        },
        linkedRecords: [
          {
            entityType: "Vehicle",
            id: "Unit-101",
            label: "Unit 101",
            secondaryText: "Freightliner Cascadia",
          },
        ],
        evidenceIds: [],
        chronology: [
          {
            id: "LOG-10",
            timestamp: "2024-12-18T13:00:00Z",
            action: "RECORD_CREATED",
            actor: "Safety Administrator",
            details: "Uploaded clean roadside inspection report MI-2024-091823.",
          },
          {
            id: "LOG-11",
            timestamp: "2024-12-18T14:00:00Z",
            action: "EVENT_CLOSED",
            actor: "Safety Administrator",
            details: "Zero violations recorded. Clean inspection bonus credited to driver.",
          },
        ],
        isArchived: false,
        createdAt: "2024-12-18T13:00:00Z",
        updatedAt: now,
      },
      {
        id: "EVT-YK-000421",
        companyId,
        driverMasterId: "DRV-000001",
        eventType: "Customer Commendation",
        eventDate: "2025-01-14",
        reportedDate: "2025-01-15",
        location: "Sysco Distribution Center, Detroit, MI",
        city: "Detroit",
        stateProvince: "MI",
        country: "United States",
        severity: "Low",
        status: "Closed",
        summary: "Receiver praised driver for courteous dock communication and exact on-time delivery during snowstorm.",
        description: "Sysco inbound receiving manager sent written commendation recognizing Driver Muhammad Khan for professional temperature verification and spotless reefer trailer presentation during severe blizzard delay.",
        commendationDetails: {
          category: "Customer Commendation",
          customerName: "Sysco Foods USA",
          recognizedBy: "Receiving Manager - T. Kowalski",
        },
        linkedRecords: [],
        evidenceIds: [],
        chronology: [
          {
            id: "LOG-20",
            timestamp: "2025-01-15T09:30:00Z",
            action: "COMMENDATION_LOGGED",
            actor: "Operations Manager",
            details: "Commendation letter logged and shared with driver.",
          },
        ],
        isArchived: false,
        createdAt: "2025-01-15T09:30:00Z",
        updatedAt: now,
      },
      {
        id: "EVT-YK-000422",
        companyId,
        driverMasterId: "DRV-000001",
        eventType: "Coaching Session",
        eventDate: "2025-01-28",
        reportedDate: "2025-01-28",
        location: "Mississauga Safety Office",
        city: "Mississauga",
        stateProvince: "ON",
        country: "Canada",
        severity: "Low",
        status: "Closed",
        summary: "Quarterly safety check-in & review of adverse winter weather speed management.",
        description: "Safety coach reviewed electronic logging data and winter weather route advisory adherence. Driver acknowledged optimal following distance protocol.",
        coachingDetails: {
          topic: "Winter Weather Space & Speed Management",
          coachName: "Safety Lead - M. Henderson",
          discussionSummary: "Reviewed speed reduction on snowy bridges and anti-lock brake activation response.",
          actionItems: "Continue 7-8 second following interval in wet snow conditions.",
          driverAcknowledged: true,
          acknowledgementDate: "2025-01-28",
        },
        linkedRecords: [],
        evidenceIds: [],
        chronology: [
          {
            id: "LOG-30",
            timestamp: "2025-01-28T14:00:00Z",
            action: "COACHING_COMPLETED",
            actor: "Safety Lead - M. Henderson",
            details: "1-on-1 safety discussion completed and signed off.",
          },
        ],
        isArchived: false,
        createdAt: "2025-01-28T14:00:00Z",
        updatedAt: now,
      },
    ],
    evidence: [],
  };
}

// Re-exports and ergonomic aliases
export const getAuditLogs = loadAuditEvents;

export function loadFullDriverStore() {
  const masterStore = loadDriverMasterStore();
  const companies = readCompanies();
  const allRelationships: CompanyDriverRelationship[] = [];
  const allApplications: DriverApplicationRecord[] = [];
  const allHiringPackages: HiringPackageRecord[] = [];
  const allTaxDocs: DriverTaxDocRecord[] = [];
  const allScreenings: ScreeningRecord[] = [];
  const allTrainings: TrainingRecord[] = [];
  const allEvents: PerformanceEventRecord[] = [];
  const allEvidence: DriverEvidenceItem[] = [];
  const allHOSReviews: HOSReview[] = [];
  const allCompanyActions: CompanyActionRecord[] = [];
  const allCompanyDeterminations: CompanyDetermination[] = [];

  companies.forEach((c) => {
    const compStore = loadCompanyDriverStore(c.id);
    allRelationships.push(...compStore.relationships);
    allApplications.push(...(compStore.applications || []));
    allHiringPackages.push(...(compStore.hiringPackages || []));
    allTaxDocs.push(...(compStore.taxDocs || []));
    allScreenings.push(...(compStore.screenings || []));
    allTrainings.push(...(compStore.trainingRecords || []));
    allEvents.push(...(compStore.performanceEvents || []));
    allEvidence.push(...(compStore.evidence || []));
    allHOSReviews.push(...(compStore.hosReviews || []));
    allCompanyActions.push(...(compStore.companyActions || []));
    allCompanyDeterminations.push(...(compStore.companyDeterminations || []));
  });

  return {
    companies,
    masters: masterStore.drivers,
    relationships: allRelationships,
    applications: allApplications,
    hiringPackages: allHiringPackages,
    taxDocs: allTaxDocs,
    screenings: allScreenings,
    trainings: allTrainings,
    events: allEvents,
    evidence: allEvidence,
    hosReviews: allHOSReviews,
    companyActions: allCompanyActions,
    companyDeterminations: allCompanyDeterminations,
  };
}

export function seedCanonicalDriverRecords() {
  if (typeof window === "undefined") return;
  try {
    const defaultCompanies: CanonicalCompany[] = [
      {
        id: "CMP-10492",
        name: "Power Way Logistics Inc.",
        kind: "Customer",
        region: "Cross-Border",
        regCorpState: "ON",
        regCorpCountry: "Canada",
        status: "Active",
      },
      {
        id: "CMP-20831",
        name: "Northern Star Freight Systems",
        kind: "Customer",
        region: "Canada Only",
        regCorpState: "AB",
        regCorpCountry: "Canada",
        status: "Active",
      },
    ];
    writeStorage("tes_companies", defaultCompanies);
    const seededMaster = getInitialSeedMasterStore();
    writeStorage(DRIVER_MASTER_STORAGE_KEY, seededMaster);
    defaultCompanies.forEach((c) => {
      const seededCompany = getInitialSeedCompanyStore(c.id);
      writeStorage(companyDriverStorageKey(c.id), seededCompany);
    });
  } catch (err) {
    console.error("Error seeding driver records:", err);
  }
}

// Ergonomic Aliases
export const updateDriverMasterIdentity = updateMaster;
export const updateCompanyDriverRelationship = updateRelationship;
export const addDriverAddress = updateAddress;
export const addDriverLicence = addLicenceRecord;
export const addScreeningRecord = createScreeningRecord;
export const addTrainingRecord = createTrainingRecord;
export function waiveTrainingRecord(companyId: string, trainingId: string, reason: string) {
  return updateTrainingStatus(companyId, trainingId, "Waived", undefined, undefined, reason);
}
export const addPerformanceEvent = createPerformanceEvent;

