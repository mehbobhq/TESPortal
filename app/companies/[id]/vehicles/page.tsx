"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Truck,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  CalendarClock,
  Wrench,
  AlertOctagon,
  ShieldCheck,
  Building2,
  Copy,
  Check,
  Pencil,
  Trash2,
  History,
  Archive,
  RefreshCcw,
  Sparkles,
  X,
  Eye,
  SlidersHorizontal,
  ExternalLink,
  ChevronRight,
  Maximize2,
  Layers,
  MapPin,
  FileBadge,
  ShieldAlert,
  Camera,
  Upload,
} from "lucide-react";

function ScanDocumentIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0">
        <span className="absolute left-0 top-0 h-[35%] w-[35%] rounded-tl-[2px] border-l-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute right-0 top-0 h-[35%] w-[35%] rounded-tr-[2px] border-r-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute bottom-0 left-0 h-[35%] w-[35%] rounded-bl-[2px] border-b-[1.5px] border-l-[1.5px] border-current" />
        <span className="absolute bottom-0 right-0 h-[35%] w-[35%] rounded-br-[2px] border-b-[1.5px] border-r-[1.5px] border-current" />
      </span>
      <FileText
        style={{
          width: size * 0.58,
          height: size * 0.58,
          strokeWidth: 1.8,
        }}
      />
    </span>
  );
}

import {
  Company,
  DeadlineRules,
  DeadlineStatus,
  EquipmentType,
  InspectionType,
  OwnershipType,
  PermitType,
  RegistrationType,
  VehicleDraft,
  VehicleEvidence,
  VehicleInspection,
  VehiclePermit,
  VehicleRecord,
  VehicleStatus,
  OCRSession,
} from "../types";

import {
  DEFAULT_DEADLINE_RULES,
  JURISDICTIONS,
  createId,
  emptyVehicleDraft,
  getDefaultSeedVehicles,
  getDeadlineStatus,
  getDaysRemaining,
  isoNow,
  loadCompanies,
  loadDeadlineRules,
  statusClasses,
  todayISO,
  validateVehicleUniqueness,
} from "../lib/vehicle-data";

import { DocumentViewer } from "./DocumentViewer";
import { CameraCapture } from "./CameraCapture";

type VehiclesPageProps = {
  initialCompanyId?: string;
  onNavigateCompany?: (companyId: string) => void;
};

export function VehiclesPage({ initialCompanyId, onNavigateCompany }: VehiclesPageProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string>("");
  const [company, setCompany] = useState<Company | null>(null);

  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [evidenceList, setEvidenceList] = useState<VehicleEvidence[]>([]);
  const [rules, setRules] = useState<DeadlineRules>(DEFAULT_DEADLINE_RULES);
  const [loading, setLoading] = useState(true);

  // Filters & State
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [ownershipFilter, setOwnershipFilter] = useState<string>("ALL");
  const [showOlderHistory, setShowOlderHistory] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  // Modals & Panels
  const [isAddingOrEditing, setIsAddingOrEditing] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [vehicleDraft, setVehicleDraft] = useState<VehicleDraft | null>(null);
  const [activeTabForm, setActiveTabForm] = useState<"profile" | "registration" | "ownership" | "inspection" | "permits">("profile");

  // Document & OCR State
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [ocrSession, setOcrSession] = useState<OCRSession | null>(null);
  const [previewEvidence, setPreviewEvidence] = useState<VehicleEvidence | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Quick Action Modal for Logging Inspection or Permit
  const [quickActionModal, setQuickActionModal] = useState<{
    type: "inspection" | "permit";
    vehicleId: string;
  } | null>(null);
  const [quickInspectionDraft, setQuickInspectionDraft] = useState<{
    inspectionType: InspectionType;
    inspectionDate: string;
    expiryDate: string;
    stationName: string;
    inspectorName: string;
    passed: boolean;
    outOfServiceDefects: boolean;
    notes: string;
  }>({
    inspectionType: "Annual Periodic Inspection (CVIP / DOT 396.17)",
    inspectionDate: todayISO(),
    expiryDate: todayISO(),
    stationName: "",
    inspectorName: "",
    passed: true,
    outOfServiceDefects: false,
    notes: "",
  });
  const [quickPermitDraft, setQuickPermitDraft] = useState<{
    permitType: PermitType;
    permitNumber: string;
    jurisdictionCode: string;
    startDate: string;
    expiryDate: string;
    notes: string;
  }>({
    permitType: "Clean Truck Check / CARB TRU",
    permitNumber: "",
    jurisdictionCode: "CA",
    startDate: todayISO(),
    expiryDate: todayISO(),
    notes: "",
  });

  // 1. Initial Load of Companies & Central Settings
  useEffect(() => {
    const loadedCompanies = loadCompanies();
    setCompanies(loadedCompanies);

    const initialId = initialCompanyId || (loadedCompanies.length > 0 ? loadedCompanies[0].id : "CMP-10492");
    setActiveCompanyId(initialId);

    const currentComp = loadedCompanies.find((c) => c.id === initialId) || loadedCompanies[0] || null;
    setCompany(currentComp);

    setRules(loadDeadlineRules());
  }, [initialCompanyId]);

  // 2. Load Vehicles for Active Company
  useEffect(() => {
    if (!activeCompanyId) return;

    setLoading(true);
    const storageKey = `tes_company_vehicles_${activeCompanyId}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setVehicles(Array.isArray(parsed.vehicles) ? parsed.vehicles : []);
        setEvidenceList(Array.isArray(parsed.evidence) ? parsed.evidence : []);
      } else {
        // Seed default starter fleet for initial demonstration
        const seedData = company ? getDefaultSeedVehicles(company) : [];
        setVehicles(seedData);
        setEvidenceList([]);
        localStorage.setItem(storageKey, JSON.stringify({ vehicles: seedData, evidence: [] }));
      }
    } catch (err) {
      console.error("Error loading vehicles:", err);
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, company]);

  // 3. Persist Changes to Storage
  const persistVehicles = (newVehicles: VehicleRecord[], newEvidence: VehicleEvidence[] = evidenceList) => {
    if (!activeCompanyId) return;
    setVehicles(newVehicles);
    setEvidenceList(newEvidence);
    localStorage.setItem(
      `tes_company_vehicles_${activeCompanyId}`,
      JSON.stringify({ vehicles: newVehicles, evidence: newEvidence })
    );
  };

  // Company Switcher handler
  const handleSwitchCompany = (newId: string) => {
    setActiveCompanyId(newId);
    const found = companies.find((c) => c.id === newId) || null;
    setCompany(found);
    setSelectedVehicleId(null);
    if (onNavigateCompany) onNavigateCompany(newId);
  };

  // 3-Year History cutoff calculation
  const threeYearsAgo = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 3);
    return d.toISOString().slice(0, 10);
  }, []);

  // Filtered List
  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      const isArchived = v.status === "Archived";
      if (!showOlderHistory && isArchived) return false;

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        v.unitNumber.toLowerCase().includes(q) ||
        v.vin.toLowerCase().includes(q) ||
        (v.registration?.plateNumber || "").toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        (v.transponderNumber || "").toLowerCase().includes(q);

      const matchesType = typeFilter === "ALL" || v.equipmentType.toLowerCase().includes(typeFilter.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || v.status === statusFilter;
      const matchesOwnership = ownershipFilter === "ALL" || v.ownershipType === ownershipFilter;

      return matchesSearch && matchesType && matchesStatus && matchesOwnership;
    });
  }, [vehicles, searchQuery, typeFilter, statusFilter, ownershipFilter, showOlderHistory]);

  // Calculate Metrics & Deadlines
  const stats = useMemo(() => {
    let healthy = 0;
    let watch = 0;
    let urgent = 0;
    let critical = 0;
    let expired = 0;
    let active = 0;
    let maintenance = 0;
    let outOfService = 0;

    vehicles.forEach((v) => {
      if (v.status === "Archived") return;
      if (v.status === "Active") active++;
      if (v.status === "Maintenance") maintenance++;
      if (v.status === "Out of Service") outOfService++;

      // Evaluate vehicle registration deadline
      const regStatus = v.registration?.isContinuous
        ? "Healthy"
        : getDeadlineStatus(v.registration?.expiryDate, rules);

      // Evaluate latest inspection deadline
      const latestInsp = v.inspections[0];
      const inspStatus = getDeadlineStatus(latestInsp?.expiryDate, rules);

      // Worst case drives the vehicle priority
      const statuses = [regStatus, inspStatus];
      if (statuses.includes("Expired")) expired++;
      else if (statuses.includes("Critical")) critical++;
      else if (statuses.includes("Urgent")) urgent++;
      else if (statuses.includes("Watch")) watch++;
      else healthy++;
    });

    return { healthy, watch, urgent, critical, expired, active, maintenance, outOfService, total: vehicles.length };
  }, [vehicles, rules]);

  // Currently Selected Vehicle Inspector
  const selectedVehicle = useMemo(() => {
    return vehicles.find((v) => v.id === selectedVehicleId) || null;
  }, [vehicles, selectedVehicleId]);

  // ----------------------------------------------------
  // CRUD Actions
  // ----------------------------------------------------
  const handleOpenAddModal = () => {
    if (!company) return;
    setEditTargetId(null);
    setVehicleDraft(emptyVehicleDraft(company));
    setActiveTabForm("profile");
    setIsAddingOrEditing(true);
  };

  const handleOpenEditModal = (veh: VehicleRecord) => {
    setEditTargetId(veh.id);
    setVehicleDraft({
      unitNumber: veh.unitNumber,
      equipmentType: veh.equipmentType,
      status: veh.status,
      vin: veh.vin,
      year: veh.year,
      make: veh.make,
      model: veh.model,
      color: veh.color,
      operatingRegion: veh.operatingRegion,
      axles: veh.axles,
      lengthFeet: veh.lengthFeet || "53",
      tareWeightKgs: veh.tareWeightKgs ? String(veh.tareWeightKgs) : "",
      fuelType: veh.fuelType,
      gpsProvider: veh.gpsProvider || "",
      transponderNumber: veh.transponderNumber || "",

      ownershipType: veh.ownershipType,
      ownerCompanyName: veh.ownerCompanyName || "",
      purchaseDate: veh.purchaseDate || "",
      purchasePrice: veh.purchasePrice || "",
      leaseTermMonths: veh.leaseTermMonths ? String(veh.leaseTermMonths) : "",
      leaseEndDate: veh.leaseEndDate || "",

      regType: veh.registration?.registrationType || "IRP (Apportioned)",
      plateNumber: veh.registration?.plateNumber || "",
      regJurisdiction: veh.registration?.jurisdiction || "ON",
      regStartDate: veh.registration?.startDate || "",
      regExpiryDate: veh.registration?.expiryDate || "",
      isContinuousPlate: Boolean(veh.registration?.isContinuous),
      maxGrossWeightKg: veh.registration?.maxGrossWeightKg ? String(veh.registration?.maxGrossWeightKg) : "",
      cabCardNumber: veh.registration?.cabCardNumber || "",

      hasInitialInspection: veh.inspections.length > 0,
      inspectionType: veh.inspections[0]?.inspectionType || "Annual Periodic Inspection (CVIP / DOT 396.17)",
      inspectionDate: veh.inspections[0]?.inspectionDate || "",
      inspectionExpiry: veh.inspections[0]?.expiryDate || "",
      inspectorName: veh.inspections[0]?.inspectorName || "",
      inspectionStation: veh.inspections[0]?.stationName || "",
      inspectionPassed: veh.inspections[0]?.passed ?? true,
      inspectionOOS: veh.inspections[0]?.outOfServiceDefects ?? false,

      permits: veh.permits || [],
      notes: veh.notes || "",
    });
    setActiveTabForm("profile");
    setIsAddingOrEditing(true);
  };

  const handleSaveVehicle = (draft: VehicleDraft, source: "OCR" | "Manual" = "Manual", evidence?: VehicleEvidence) => {
    // 1. Validation & Uniqueness Check
    if (!draft.unitNumber.trim()) {
      alert("Error: Equipment Unit Number is required.");
      return;
    }
    if (!draft.vin.trim()) {
      alert("Error: 17-character VIN is required for equipment compliance.");
      return;
    }

    const collision = validateVehicleUniqueness(
      activeCompanyId,
      draft.vin,
      draft.plateNumber,
      editTargetId || undefined
    );

    if (!collision.isValid) {
      alert(collision.message);
      return;
    }

    const now = isoNow();
    const juris = JURISDICTIONS.find((j) => j.code === draft.regJurisdiction) || {
      code: "ON",
      label: "Ontario",
      country: "Canada" as const,
    };

    if (editTargetId) {
      // Update existing record
      const updatedList = vehicles.map((v) => {
        if (v.id !== editTargetId) return v;
        return {
          ...v,
          unitNumber: draft.unitNumber.trim(),
          equipmentType: draft.equipmentType,
          status: draft.status,
          vin: draft.vin.trim().toUpperCase(),
          year: draft.year,
          make: draft.make.trim(),
          model: draft.model.trim(),
          color: draft.color.trim(),
          operatingRegion: draft.operatingRegion,
          axles: Number(draft.axles) || 2,
          lengthFeet: draft.lengthFeet,
          tareWeightKgs: Number(draft.tareWeightKgs) || undefined,
          fuelType: draft.fuelType,
          gpsProvider: draft.gpsProvider.trim() || undefined,
          transponderNumber: draft.transponderNumber.trim() || undefined,

          ownershipType: draft.ownershipType,
          ownerCompanyName: draft.ownerCompanyName.trim() || undefined,
          purchaseDate: draft.purchaseDate || undefined,
          purchasePrice: draft.purchasePrice || undefined,
          leaseTermMonths: Number(draft.leaseTermMonths) || undefined,
          leaseEndDate: draft.leaseEndDate || undefined,

          registration: draft.plateNumber
            ? {
                recordId: v.registration?.recordId || createId("REG"),
                registrationType: draft.regType,
                plateNumber: draft.plateNumber.trim().toUpperCase(),
                jurisdiction: juris.code,
                jurisdictionLabel: juris.label,
                country: juris.country,
                startDate: draft.regStartDate || todayISO(),
                expiryDate: draft.isContinuousPlate ? "Continuous" : draft.regExpiryDate || todayISO(),
                isContinuous: draft.isContinuousPlate,
                maxGrossWeightKg: Number(draft.maxGrossWeightKg) || undefined,
                cabCardNumber: draft.cabCardNumber.trim() || undefined,
              }
            : undefined,

          inspections: draft.hasInitialInspection
            ? [
                {
                  id: v.inspections[0]?.id || createId("INSP"),
                  inspectionType: draft.inspectionType,
                  inspectionDate: draft.inspectionDate || todayISO(),
                  expiryDate: draft.inspectionExpiry || todayISO(),
                  inspectorName: draft.inspectorName || undefined,
                  stationName: draft.inspectionStation || undefined,
                  passed: draft.inspectionPassed,
                  outOfServiceDefects: draft.inspectionOOS,
                },
                ...v.inspections.slice(1),
              ]
            : v.inspections,

          permits: draft.permits,
          notes: draft.notes.trim() || undefined,
          evidenceIds: evidence ? Array.from(new Set([...v.evidenceIds, evidence.id])) : v.evidenceIds,
          updatedAt: now,
        };
      });

      const updatedEvidence = evidence ? [evidence, ...evidenceList] : evidenceList;
      persistVehicles(updatedList, updatedEvidence);
    } else {
      // Create new record
      const newId = createId("VEH");
      const newVeh: VehicleRecord = {
        id: newId,
        unitNumber: draft.unitNumber.trim(),
        equipmentType: draft.equipmentType,
        status: draft.status,
        vin: draft.vin.trim().toUpperCase(),
        year: draft.year,
        make: draft.make.trim(),
        model: draft.model.trim(),
        color: draft.color.trim(),
        operatingRegion: draft.operatingRegion,
        axles: Number(draft.axles) || 2,
        lengthFeet: draft.lengthFeet,
        tareWeightKgs: Number(draft.tareWeightKgs) || undefined,
        fuelType: draft.fuelType,
        gpsProvider: draft.gpsProvider.trim() || undefined,
        transponderNumber: draft.transponderNumber.trim() || undefined,

        ownershipType: draft.ownershipType,
        ownerCompanyName: draft.ownerCompanyName.trim() || undefined,
        purchaseDate: draft.purchaseDate || undefined,
        purchasePrice: draft.purchasePrice || undefined,
        leaseTermMonths: Number(draft.leaseTermMonths) || undefined,
        leaseEndDate: draft.leaseEndDate || undefined,

        registration: draft.plateNumber
          ? {
              recordId: createId("REG"),
              registrationType: draft.regType,
              plateNumber: draft.plateNumber.trim().toUpperCase(),
              jurisdiction: juris.code,
              jurisdictionLabel: juris.label,
              country: juris.country,
              startDate: draft.regStartDate || todayISO(),
              expiryDate: draft.isContinuousPlate ? "Continuous" : draft.regExpiryDate || todayISO(),
              isContinuous: draft.isContinuousPlate,
              maxGrossWeightKg: Number(draft.maxGrossWeightKg) || undefined,
              cabCardNumber: draft.cabCardNumber.trim() || undefined,
            }
          : undefined,

        inspections: draft.hasInitialInspection
          ? [
              {
                id: createId("INSP"),
                inspectionType: draft.inspectionType,
                inspectionDate: draft.inspectionDate || todayISO(),
                expiryDate: draft.inspectionExpiry || todayISO(),
                inspectorName: draft.inspectorName || undefined,
                stationName: draft.inspectionStation || undefined,
                passed: draft.inspectionPassed,
                outOfServiceDefects: draft.inspectionOOS,
              },
            ]
          : [],

        permits: draft.permits,
        evidenceIds: evidence ? [evidence.id] : [],
        source,
        createdAt: now,
        updatedAt: now,
        notes: draft.notes.trim() || undefined,
      };

      const updatedEvidence = evidence ? [evidence, ...evidenceList] : evidenceList;
      persistVehicles([newVeh, ...vehicles], updatedEvidence);
      setSelectedVehicleId(newVeh.id);
    }

    setIsAddingOrEditing(false);
    setVehicleDraft(null);
    setEditTargetId(null);
    setOcrSession(null);
  };

  const handleArchiveVehicle = (vehId: string) => {
    if (!confirm("Are you sure you want to archive this vehicle? Historical inspections and registration logs will be retained.")) return;
    const updated = vehicles.map((v) => (v.id === vehId ? { ...v, status: "Archived" as VehicleStatus, updatedAt: isoNow() } : v));
    persistVehicles(updated);
  };

  const handleDeleteVehicle = (vehId: string) => {
    if (!confirm("DEV ONLY: Permanently remove this vehicle record?")) return;
    const updated = vehicles.filter((v) => v.id !== vehId);
    persistVehicles(updated);
    if (selectedVehicleId === vehId) setSelectedVehicleId(null);
  };

  // ----------------------------------------------------
  // OCR Ingestion Pipeline
  // ----------------------------------------------------
  const startOCRWithFile = async (file: File, source: "camera" | "device") => {
    if (!company) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const draft = emptyVehicleDraft(company);

      // Simulated Intelligent OCR Data Extraction from Registration / Cab Card
      const randomUnit = String(Math.floor(105 + Math.random() * 890));
      draft.unitNumber = randomUnit;
      draft.vin = `1FUJGLDR${Math.floor(100000000 + Math.random() * 900000000)}`;
      draft.year = "2024";
      draft.make = "Freightliner";
      draft.model = "Cascadia 126";
      draft.plateNumber = `PA-${Math.floor(10000 + Math.random() * 90000)}`;
      draft.regType = "IRP (Apportioned)";
      draft.cabCardNumber = `CAB-IRP-${Math.floor(100000 + Math.random() * 900000)}`;
      draft.maxGrossWeightKg = "36287";

      setOcrSession({
        file,
        dataUrl,
        source,
        documentType: "Vehicle Registration / Cab Card",
        processing: false,
        extractionComplete: true,
        confidence: 96,
        documentDate: todayISO(),
        draft,
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex max-w-[1600px] flex-col gap-6 pb-12 mx-auto">
      {/* ---------------------------------------------------------
          1. HEADER & FLEET CONTEXT BANNER
      --------------------------------------------------------- */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm mt-0.5">
              <Truck className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">Vehicles & Equipment</h1>
                <span className="font-mono text-xs rounded border px-1.5 py-0.5 bg-muted/40 font-semibold text-muted-foreground">
                  {activeCompanyId}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Power Units, Trailers, IRP Registration, Periodic Inspections (CVIP) & State Permits
              </p>
            </div>
          </div>

          {/* Company Selector Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Building2 className="size-3.5" /> Fleet Entity:
            </span>
            <select
              value={activeCompanyId}
              onChange={(e) => handleSwitchCompany(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Overview Information Banner */}
        <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Registered Origin</p>
                <p className="mt-0.5 text-sm font-semibold flex items-center gap-1">
                  <MapPin className="size-3.5 text-primary" />
                  {company?.regCorpState || "ON"}, {company?.regCorpCountry || "Canada"}
                </p>
              </div>

              <div className="hidden h-7 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Operating Scope</p>
                <p className="mt-0.5 text-sm font-semibold flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  {company?.region || "Cross-Border"}
                </p>
              </div>

              <div className="hidden h-7 w-px bg-border sm:block" />

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Fleet</p>
                <p className="mt-0.5 text-sm font-semibold">{stats.total} Units ({stats.active} Active)</p>
              </div>

              {stats.outOfService > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">OOS Grounded</p>
                  <p className="mt-0.5 text-sm font-bold text-destructive flex items-center gap-1">
                    <AlertOctagon className="size-3.5" />
                    {stats.outOfService} Unit(s)
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setRules(loadDeadlineRules())}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <RefreshCcw className="size-3" />
              Sync Central Renewal Rules
            </button>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------
          2. 5-TIER RENEWAL & COMPLIANCE MATRIX
      --------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm border-l-4 border-l-emerald-500">
          <p className="text-xs text-muted-foreground font-medium">Healthy (61+ Days)</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold">{stats.healthy}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full font-medium">
              <CheckCircle2 className="size-3" /> Good
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm border-l-4 border-l-amber-400">
          <p className="text-xs text-muted-foreground font-medium">Watch (31–60 Days)</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold">{stats.watch}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full font-medium">
              <CalendarClock className="size-3" /> Upcoming
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm border-l-4 border-l-orange-500">
          <p className="text-xs text-muted-foreground font-medium">Urgent (11–30 Days)</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold">{stats.urgent}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-orange-700 bg-orange-50 dark:bg-orange-950/40 px-2 py-0.5 rounded-full font-medium">
              <AlertTriangle className="size-3" /> Action Due
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm border-l-4 border-l-red-600">
          <p className="text-xs text-muted-foreground font-medium">Critical (0–10 Days)</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-red-600">{stats.critical}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-red-800 bg-red-100 dark:bg-red-950/60 px-2 py-0.5 rounded-full font-bold animate-pulse">
              <AlertOctagon className="size-3" /> Immediate
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm border-l-4 border-l-red-950">
          <p className="text-xs text-muted-foreground font-medium">Expired / OOS</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-red-950 dark:text-red-400">{stats.expired}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-white bg-red-950 px-2 py-0.5 rounded-full font-bold">
              <XCircle className="size-3" /> Non-Compliant
            </span>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------
          3. SEARCH, FILTERS & ACTION BAR
      --------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2 max-w-2xl">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="size-4 absolute left-3 top-2.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search unit #, VIN, plate, make/model, transponder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary shadow-sm font-medium"
          >
            <option value="ALL">All Types</option>
            <option value="Tractor">Tractors / Power Units</option>
            <option value="Reefer">Reefer Trailers</option>
            <option value="Dry Van">Dry Van Trailers</option>
            <option value="Flatbed">Flatbed / Step Deck</option>
            <option value="Chassis">Intermodal Chassis</option>
            <option value="Straight Truck">Straight Trucks</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary shadow-sm font-medium"
          >
            <option value="ALL">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Maintenance">In Maintenance</option>
            <option value="Out of Service">Out of Service</option>
            <option value="Archived">Archived Records</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowOlderHistory((p) => !p)}
            className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted shadow-sm"
          >
            <History className="size-3.5 text-muted-foreground" />
            {showOlderHistory ? "Standard 3-Yr View" : "Show Retained Units"}
          </button>

          <button
            type="button"
            onClick={() => setShowSourcePicker(true)}
            className="h-9 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-sm transition-colors"
          >
            <ScanDocumentIcon size={14} />
            Scan Cab Card (OCR)
          </button>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted shadow-sm"
          >
            <Plus className="size-3.5" />
            Add Vehicle
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------
          4. MAIN EQUIPMENT REGISTER & RIGHT-HAND INSPECTOR
      --------------------------------------------------------- */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* Main Equipment Register Table */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="border-b bg-muted/20 px-4 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Registered Fleet Equipment</h2>
              <p className="text-[11px] text-muted-foreground">
                Click any equipment row to inspect IRP plates, CVIP records, permits, and attached documents.
              </p>
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              Showing {filteredVehicles.length} of {vehicles.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/10 text-muted-foreground font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Unit / Record</th>
                  <th className="py-3 px-3">Type & Year</th>
                  <th className="py-3 px-3">Make / Model</th>
                  <th className="py-3 px-3">Plate / IRP</th>
                  <th className="py-3 px-3">Annual CVIP</th>
                  <th className="py-3 px-3">Permits</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Renewal Alert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      <Truck className="size-8 mx-auto opacity-30 mb-2" />
                      <p className="font-medium text-sm">No vehicles match current filters.</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Add an equipment record manually or scan a cab card registration.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredVehicles.map((veh) => {
                    const isSelected = selectedVehicleId === veh.id;
                    const regDeadline = veh.registration?.isContinuous ? undefined : veh.registration?.expiryDate;
                    const inspDeadline = veh.inspections[0]?.expiryDate;
                    
                    const worstStatus = [
                      getDeadlineStatus(regDeadline, rules),
                      getDeadlineStatus(inspDeadline, rules),
                    ].reduce((acc, curr) => {
                      const priority = { "Expired": 5, "Critical": 4, "Urgent": 3, "Watch": 2, "Healthy": 1, "No Deadline": 0 };
                      return priority[curr] > priority[acc] ? curr : acc;
                    }, "Healthy" as DeadlineStatus);

                    const style = statusClasses(worstStatus);

                    return (
                      <tr
                        key={veh.id}
                        onClick={() => setSelectedVehicleId(veh.id)}
                        className={`cursor-pointer transition-colors border-l-4 ${style.left} ${
                          isSelected ? "bg-primary/[0.045]" : "hover:bg-muted/30"
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                            <span>{veh.unitNumber}</span>
                            {veh.status === "Out of Service" && (
                              <span className="text-[9px] bg-red-100 text-red-800 dark:bg-red-950 font-bold px-1 rounded">
                                OOS
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-[10px] text-muted-foreground">{veh.vin.slice(0, 10)}...</p>
                        </td>

                        <td className="py-3 px-3">
                          <p className="font-medium">{veh.equipmentType}</p>
                          <p className="text-muted-foreground text-[10px]">{veh.year} · {veh.axles} Axles</p>
                        </td>

                        <td className="py-3 px-3">
                          <p className="font-medium">{veh.make}</p>
                          <p className="text-muted-foreground text-[10px] truncate max-w-[120px]">{veh.model}</p>
                        </td>

                        <td className="py-3 px-3">
                          <p className="font-mono font-medium">{veh.registration?.plateNumber || "—"}</p>
                          <p className="text-muted-foreground text-[10px]">
                            {veh.registration?.jurisdiction || "—"} · {veh.registration?.registrationType || "Base Plate"}
                          </p>
                        </td>

                        <td className="py-3 px-3">
                          {veh.inspections.length > 0 ? (
                            <div>
                              <p className="font-medium flex items-center gap-1">
                                {veh.inspections[0].passed ? (
                                  <CheckCircle2 className="size-3 text-emerald-600" />
                                ) : (
                                  <AlertTriangle className="size-3 text-destructive" />
                                )}
                                {veh.inspections[0].expiryDate}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate max-w-[110px]">
                                {veh.inspections[0].stationName || "Inspection Station"}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60 italic text-[11px]">No CVIP Logged</span>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px] font-semibold">
                            <FileBadge className="size-3 text-primary" />
                            {veh.permits.length}
                          </span>
                        </td>

                        <td className="py-3 px-3">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              veh.status === "Active"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                                : veh.status === "Maintenance"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40"
                                : veh.status === "Out of Service"
                                ? "bg-red-100 text-red-800 dark:bg-red-950/60 font-bold"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800"
                            }`}
                          >
                            {veh.status}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${style.badge}`}>
                            {worstStatus}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* -----------------------------------------------------
            Right-Hand Vehicle Detail Inspector Panel
        ----------------------------------------------------- */}
        <div className="xl:sticky xl:top-6">
          {!selectedVehicle ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center flex flex-col items-center justify-center min-h-[500px]">
              <Truck className="size-10 text-muted-foreground/30 mb-3" />
              <p className="font-semibold text-sm">Select a vehicle to inspect</p>
              <p className="text-xs text-muted-foreground max-w-[260px] mt-1">
                View cab card validation, annual CVIP inspection logs, state permits, and ownership evidence.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
              {/* Inspector Header */}
              <div className="border-b bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold">Unit {selectedVehicle.unitNumber}</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {selectedVehicle.equipmentType}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model} ({selectedVehicle.color})
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedVehicleId(null)}
                    className="size-7 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Inspector Body Details */}
              <div className="p-4 space-y-5 overflow-y-auto max-h-[75vh] text-xs">
                {/* 1. Identification Section */}
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">
                    Equipment Identity & Specs
                  </p>
                  <div className="grid grid-cols-2 gap-2 bg-muted/20 p-3 rounded-lg border">
                    <div>
                      <p className="text-[10px] text-muted-foreground">VIN (17-Digits)</p>
                      <p className="font-mono font-semibold text-xs select-text">{selectedVehicle.vin}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Operating Region</p>
                      <p className="font-semibold text-xs">{selectedVehicle.operatingRegion}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Fuel Type / Axles</p>
                      <p className="font-semibold text-xs">{selectedVehicle.fuelType} · {selectedVehicle.axles} Axles</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Tare Weight</p>
                      <p className="font-semibold text-xs">{selectedVehicle.tareWeightKgs ? `${selectedVehicle.tareWeightKgs.toLocaleString()} kg` : "—"}</p>
                    </div>
                    {selectedVehicle.gpsProvider && (
                      <div className="col-span-2">
                        <p className="text-[10px] text-muted-foreground">ELD / Telematics Provider</p>
                        <p className="font-semibold text-xs">{selectedVehicle.gpsProvider} {selectedVehicle.transponderNumber && `(Transponder: ${selectedVehicle.transponderNumber})`}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Registration & Cab Card */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                      Registration & Plates
                    </p>
                    {selectedVehicle.registration && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        statusClasses(selectedVehicle.registration.isContinuous ? "Healthy" : getDeadlineStatus(selectedVehicle.registration.expiryDate, rules)).badge
                      }`}>
                        {selectedVehicle.registration.isContinuous ? "Continuous" : `Expires ${selectedVehicle.registration.expiryDate}`}
                      </span>
                    )}
                  </div>

                  {selectedVehicle.registration ? (
                    <div className="bg-muted/20 p-3 rounded-lg border space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] text-muted-foreground">License Plate</p>
                          <p className="font-mono font-bold text-sm select-text text-primary">
                            {selectedVehicle.registration.plateNumber}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Base Jurisdiction</p>
                          <p className="font-semibold text-xs">
                            {selectedVehicle.registration.jurisdictionLabel} ({selectedVehicle.registration.jurisdiction})
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Registration Class</p>
                          <p className="font-medium text-xs">{selectedVehicle.registration.registrationType}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Cab Card / Decal Ref</p>
                          <p className="font-mono text-xs select-text">{selectedVehicle.registration.cabCardNumber || "—"}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-dashed p-3 rounded-lg text-center text-muted-foreground">
                      No active plate registration recorded.
                    </div>
                  )}
                </div>

                {/* 3. CVIP Periodic Inspection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                      Periodic Safety Inspection (CVIP)
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickInspectionDraft({
                          inspectionType: "Annual Periodic Inspection (CVIP / DOT 396.17)",
                          inspectionDate: todayISO(),
                          expiryDate: todayISO(),
                          stationName: "",
                          inspectorName: "",
                          passed: true,
                          outOfServiceDefects: false,
                          notes: "",
                        });
                        setQuickActionModal({ type: "inspection", vehicleId: selectedVehicle.id });
                      }}
                      className="text-primary font-semibold hover:underline flex items-center gap-1 text-[11px]"
                    >
                      <Plus className="size-3" /> Log Inspection
                    </button>
                  </div>

                  {selectedVehicle.inspections.length > 0 ? (
                    <div className="space-y-2">
                      {selectedVehicle.inspections.map((insp) => {
                        const st = getDeadlineStatus(insp.expiryDate, rules);
                        const cl = statusClasses(st);
                        return (
                          <div key={insp.id} className={`p-3 rounded-lg border bg-muted/20 border-l-4 ${cl.left}`}>
                            <div className="flex justify-between items-start">
                              <p className="font-semibold text-xs">{insp.inspectionType}</p>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cl.badge}`}>{st}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                              <div>
                                <p className="text-[10px] text-muted-foreground">Inspection Date</p>
                                <p className="font-medium">{insp.inspectionDate}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-muted-foreground">Valid Expiry</p>
                                <p className="font-medium">{insp.expiryDate}</p>
                              </div>
                              <div className="col-span-2">
                                <p className="text-[10px] text-muted-foreground">Certified Station & Inspector</p>
                                <p className="font-medium truncate">{insp.stationName || "Certified Facility"} {insp.inspectorName && `· ${insp.inspectorName}`}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="border border-dashed p-3 rounded-lg text-center text-muted-foreground">
                      No CVIP / Periodic inspection recorded.
                    </div>
                  )}
                </div>

                {/* 4. State & Provincial Permits */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                      Active Permits & Decals ({selectedVehicle.permits.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickPermitDraft({
                          permitType: "Clean Truck Check / CARB TRU",
                          permitNumber: "",
                          jurisdictionCode: "CA",
                          startDate: todayISO(),
                          expiryDate: todayISO(),
                          notes: "",
                        });
                        setQuickActionModal({ type: "permit", vehicleId: selectedVehicle.id });
                      }}
                      className="text-primary font-semibold hover:underline flex items-center gap-1 text-[11px]"
                    >
                      <Plus className="size-3" /> Add Permit
                    </button>
                  </div>

                  {selectedVehicle.permits.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedVehicle.permits.map((p) => (
                        <div key={p.id} className="p-2.5 rounded-lg border bg-muted/20 flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-xs">{p.permitType}</p>
                            <p className="font-mono text-[10px] text-muted-foreground select-text">{p.permitNumber} · {p.jurisdictionLabel}</p>
                          </div>
                          <span className="text-[10px] font-medium bg-muted px-2 py-0.5 rounded">
                            {p.expiryDate ? `Exp: ${p.expiryDate}` : "Continuous"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-dashed p-3 rounded-lg text-center text-muted-foreground">
                      No state permits attached to this unit.
                    </div>
                  )}
                </div>

                {/* 5. Ownership & Title */}
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">
                    Ownership & Title
                  </p>
                  <div className="bg-muted/20 p-3 rounded-lg border grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Ownership Structure</p>
                      <p className="font-semibold">{selectedVehicle.ownershipType}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Owner / Lessor</p>
                      <p className="font-semibold truncate">{selectedVehicle.ownerCompanyName || "On Record"}</p>
                    </div>
                    {selectedVehicle.purchaseDate && (
                      <div>
                        <p className="text-[10px] text-muted-foreground">Acquisition Date</p>
                        <p className="font-semibold">{selectedVehicle.purchaseDate} {selectedVehicle.purchasePrice && `(${selectedVehicle.purchasePrice})`}</p>
                      </div>
                    )}
                    {selectedVehicle.leaseEndDate && (
                      <div>
                        <p className="text-[10px] text-muted-foreground">Lease Maturity</p>
                        <p className="font-semibold text-primary">{selectedVehicle.leaseEndDate}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 6. Attached Evidence */}
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">
                    Document Intelligence & Source Evidence
                  </p>
                  <div className="space-y-1.5">
                    {evidenceList.filter((e) => selectedVehicle.evidenceIds.includes(e.id)).length > 0 ? (
                      evidenceList
                        .filter((e) => selectedVehicle.evidenceIds.includes(e.id))
                        .map((ev) => (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => setPreviewEvidence(ev)}
                            className="w-full text-left p-2.5 rounded-lg border bg-muted/10 hover:bg-muted/30 flex items-center justify-between gap-2 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="size-4 text-primary shrink-0" />
                              <div className="truncate">
                                <p className="font-medium truncate">{ev.fileName}</p>
                                <p className="text-[10px] text-muted-foreground">{ev.documentType}</p>
                              </div>
                            </div>
                            <span className="text-[10px] text-primary font-semibold shrink-0">View PDF</span>
                          </button>
                        ))
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setShowSourcePicker(true);
                        }}
                        className="w-full border border-dashed p-3 rounded-lg text-center hover:bg-muted/30 text-muted-foreground flex items-center justify-center gap-1.5"
                      >
                        <ScanDocumentIcon size={14} />
                        Attach Registration Document (OCR)
                      </button>
                    )}
                  </div>
                </div>

                {/* 7. Action Bar */}
                <div className="pt-4 border-t flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(selectedVehicle)}
                    className="flex-1 h-8 rounded-lg border border-border bg-background hover:bg-muted font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Pencil className="size-3.5" /> Edit Unit
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const newStatus: VehicleStatus = selectedVehicle.status === "Maintenance" ? "Active" : "Maintenance";
                      const updated = vehicles.map((v) => (v.id === selectedVehicle.id ? { ...v, status: newStatus, updatedAt: isoNow() } : v));
                      persistVehicles(updated);
                    }}
                    className="h-8 px-3 rounded-lg border border-border bg-background hover:bg-muted font-medium flex items-center gap-1"
                  >
                    <Wrench className="size-3.5" /> {selectedVehicle.status === "Maintenance" ? "Clear Shop" : "Shop"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleArchiveVehicle(selectedVehicle.id)}
                    className="h-8 px-3 rounded-lg border border-border bg-background hover:bg-muted font-medium text-muted-foreground hover:text-foreground"
                    title="Archive vehicle"
                  >
                    <Archive className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteVehicle(selectedVehicle.id)}
                    className="h-8 px-3 rounded-lg border border-border bg-background hover:bg-destructive/10 text-destructive font-medium"
                    title="Delete permanently"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------
          5. ADD / EDIT VEHICLE MODAL
      --------------------------------------------------------- */}
      {isAddingOrEditing && vehicleDraft && (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/50 p-4 backdrop-blur-sm flex items-center justify-center">
          <div className="w-full max-w-5xl my-6 rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="border-b bg-muted/20 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  {editTargetId ? `Edit Equipment: Unit ${vehicleDraft.unitNumber}` : "Add Equipment to Fleet Master"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Complete specifications, cab card registration, and initial periodic inspection certificate.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddingOrEditing(false);
                  setVehicleDraft(null);
                }}
                className="size-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b bg-muted/10 px-6 gap-6 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTabForm("profile")}
                className={`py-3 border-b-2 transition-colors ${
                  activeTabForm === "profile" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                1. Unit Identity & Specs
              </button>
              <button
                type="button"
                onClick={() => setActiveTabForm("registration")}
                className={`py-3 border-b-2 transition-colors ${
                  activeTabForm === "registration" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                2. Cab Card / IRP Plate
              </button>
              <button
                type="button"
                onClick={() => setActiveTabForm("ownership")}
                className={`py-3 border-b-2 transition-colors ${
                  activeTabForm === "ownership" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                3. Ownership & Lease
              </button>
              <button
                type="button"
                onClick={() => setActiveTabForm("inspection")}
                className={`py-3 border-b-2 transition-colors ${
                  activeTabForm === "inspection" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                4. Safety Inspection (CVIP)
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">
              {/* Tab 1: Profile & Specs */}
              {activeTabForm === "profile" && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="font-semibold">Unit Number *</label>
                    <input
                      type="text"
                      placeholder="e.g. 101 or R5301"
                      value={vehicleDraft.unitNumber}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, unitNumber: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-semibold focus:ring-1 focus:ring-primary"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Equipment Type *</label>
                    <select
                      value={vehicleDraft.equipmentType}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, equipmentType: e.target.value as EquipmentType })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary font-medium"
                    >
                      <option value="Tractor">Tractor / Power Unit</option>
                      <option value="Trailer - Dry Van">Trailer - Dry Van</option>
                      <option value="Trailer - Reefer">Trailer - Reefer</option>
                      <option value="Trailer - Flatbed">Trailer - Flatbed</option>
                      <option value="Trailer - Step Deck / Lowboy">Trailer - Step Deck</option>
                      <option value="Trailer - Intermodal Chassis">Trailer - Chassis</option>
                      <option value="Converter Dolly">Converter Dolly</option>
                      <option value="Straight Truck">Straight Truck</option>
                      <option value="Other Equipment">Other Equipment</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Operating Status</label>
                    <select
                      value={vehicleDraft.status}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, status: e.target.value as VehicleStatus })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary font-medium"
                    >
                      <option value="Active">Active</option>
                      <option value="Maintenance">In Maintenance</option>
                      <option value="Out of Service">Out of Service</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="font-semibold">17-Character VIN *</label>
                    <input
                      type="text"
                      placeholder="17-Digit Vehicle Identification Number"
                      value={vehicleDraft.vin}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, vin: e.target.value.toUpperCase() })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-mono font-bold uppercase focus:ring-1 focus:ring-primary"
                      maxLength={17}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Model Year *</label>
                    <input
                      type="number"
                      placeholder="2024"
                      value={vehicleDraft.year}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, year: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Make / Manufacturer</label>
                    <input
                      type="text"
                      placeholder="e.g. Freightliner, Utility, Stoughton"
                      value={vehicleDraft.make}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, make: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Model</label>
                    <input
                      type="text"
                      placeholder="e.g. Cascadia 126, 3000R"
                      value={vehicleDraft.model}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, model: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Exterior Color</label>
                    <input
                      type="text"
                      placeholder="e.g. White"
                      value={vehicleDraft.color}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, color: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Operating Region</label>
                    <select
                      value={vehicleDraft.operatingRegion}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, operatingRegion: e.target.value as any })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    >
                      <option value="Cross-Border">Cross-Border (US & Canada)</option>
                      <option value="Canada Only">Canada Only</option>
                      <option value="US Only">US Only</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Axles Count</label>
                    <input
                      type="number"
                      value={vehicleDraft.axles}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, axles: Number(e.target.value) })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Tare / Unladen Weight (kg)</label>
                    <input
                      type="number"
                      placeholder="e.g. 8850"
                      value={vehicleDraft.tareWeightKgs}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, tareWeightKgs: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Fuel / Power Source</label>
                    <select
                      value={vehicleDraft.fuelType}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, fuelType: e.target.value as any })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    >
                      <option value="Diesel">Diesel</option>
                      <option value="Electric">Electric (Zero-Emission)</option>
                      <option value="Gasoline">Gasoline</option>
                      <option value="CNG/LNG">CNG / LNG</option>
                      <option value="None / Unpowered">None / Unpowered Trailer</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">ELD / GPS Provider</label>
                    <input
                      type="text"
                      placeholder="e.g. Samsara, Geotab, KeepTruckin"
                      value={vehicleDraft.gpsProvider}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, gpsProvider: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Toll Transponder ID</label>
                    <input
                      type="text"
                      placeholder="e.g. PrePass / Bestpass / 407"
                      value={vehicleDraft.transponderNumber}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, transponderNumber: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {/* Tab 2: Registration & Plate */}
              {activeTabForm === "registration" && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="font-semibold">Registration Type</label>
                    <select
                      value={vehicleDraft.regType}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, regType: e.target.value as RegistrationType })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    >
                      <option value="IRP (Apportioned)">IRP (Apportioned Cab Card)</option>
                      <option value="Base Plate">Base Plate (Intrastate/Provincial)</option>
                      <option value="Temporary Trip Registration">Temporary Trip Registration</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">License Plate Number</label>
                    <input
                      type="text"
                      placeholder="e.g. PA-92810"
                      value={vehicleDraft.plateNumber}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, plateNumber: e.target.value.toUpperCase() })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-mono font-bold uppercase focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Base Jurisdiction</label>
                    <select
                      value={vehicleDraft.regJurisdiction}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, regJurisdiction: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    >
                      {JURISDICTIONS.map((j) => (
                        <option key={j.code} value={j.code}>
                          {j.label} ({j.code}) · {j.country}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Registration Effective Date</label>
                    <input
                      type="date"
                      value={vehicleDraft.regStartDate}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, regStartDate: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-semibold">Expiration Date</label>
                      <label className="flex items-center gap-1 text-[10px] cursor-pointer text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={vehicleDraft.isContinuousPlate}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, isContinuousPlate: e.target.checked })}
                          className="size-3.5 rounded"
                        />
                        Continuous Plate (Trailers)
                      </label>
                    </div>
                    <input
                      type="date"
                      disabled={vehicleDraft.isContinuousPlate}
                      value={vehicleDraft.isContinuousPlate ? "" : vehicleDraft.regExpiryDate}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, regExpiryDate: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary disabled:opacity-40"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Apportioned Cab Card Ref #</label>
                    <input
                      type="text"
                      placeholder="e.g. IRP-ON-2025-019"
                      value={vehicleDraft.cabCardNumber}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, cabCardNumber: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Max Gross Weight Declared (kg)</label>
                    <input
                      type="number"
                      placeholder="e.g. 36287 (80,000 lbs)"
                      value={vehicleDraft.maxGrossWeightKg}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, maxGrossWeightKg: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {/* Tab 3: Ownership */}
              {activeTabForm === "ownership" && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="font-semibold">Ownership Type</label>
                    <select
                      value={vehicleDraft.ownershipType}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, ownershipType: e.target.value as OwnershipType })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    >
                      <option value="Owned">Owned (Direct Title)</option>
                      <option value="Financed">Financed (Lienholder on Title)</option>
                      <option value="Leased">Leased (Operating Lease)</option>
                      <option value="Owner Operator">Owner Operator (Under Agreement)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="font-semibold">Owner Company / Financing Institution / Lessor</label>
                    <input
                      type="text"
                      placeholder="e.g. PACCAR Financial, Premier Trailer Leasing, or Fleet LLC"
                      value={vehicleDraft.ownerCompanyName}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, ownerCompanyName: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Purchase / Acquisition Date</label>
                    <input
                      type="date"
                      value={vehicleDraft.purchaseDate}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, purchaseDate: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold">Purchase Value ($)</label>
                    <input
                      type="text"
                      placeholder="$160,000"
                      value={vehicleDraft.purchasePrice}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, purchasePrice: e.target.value })}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {vehicleDraft.ownershipType === "Leased" && (
                    <>
                      <div className="space-y-1.5">
                        <label className="font-semibold">Lease Term (Months)</label>
                        <input
                          type="number"
                          placeholder="e.g. 48"
                          value={vehicleDraft.leaseTermMonths}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, leaseTermMonths: e.target.value })}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-semibold">Lease Maturity / End Date</label>
                        <input
                          type="date"
                          value={vehicleDraft.leaseEndDate}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, leaseEndDate: e.target.value })}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Tab 4: Inspection (CVIP) */}
              {activeTabForm === "inspection" && (
                <div className="space-y-4 text-xs">
                  <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-lg border">
                    <input
                      type="checkbox"
                      id="hasInitInsp"
                      checked={vehicleDraft.hasInitialInspection}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, hasInitialInspection: e.target.checked })}
                      className="size-4 rounded"
                    />
                    <label htmlFor="hasInitInsp" className="font-semibold cursor-pointer">
                      Log Active Annual Periodic Safety Inspection (CVIP Certificate / DOT 396.17)
                    </label>
                  </div>

                  {vehicleDraft.hasInitialInspection && (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="font-semibold">Inspection Type</label>
                        <select
                          value={vehicleDraft.inspectionType}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, inspectionType: e.target.value as InspectionType })}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                        >
                          <option value="Annual Periodic Inspection (CVIP / DOT 396.17)">Annual CVIP / DOT 396.17</option>
                          <option value="Semi-Annual Inspection">Semi-Annual Inspection</option>
                          <option value="90-Day Periodic Inspection">90-Day Periodic Inspection</option>
                          <option value="Preventive Maintenance A">Preventive Maintenance A</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-semibold">Inspection Date</label>
                        <input
                          type="date"
                          value={vehicleDraft.inspectionDate}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, inspectionDate: e.target.value })}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-semibold">Inspection Expiry Date *</label>
                        <input
                          type="date"
                          value={vehicleDraft.inspectionExpiry}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, inspectionExpiry: e.target.value })}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-semibold">Inspector Name & Tech #</label>
                        <input
                          type="text"
                          placeholder="e.g. D. Miller (Cert #49102)"
                          value={vehicleDraft.inspectorName}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, inspectorName: e.target.value })}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                        />
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="font-semibold">Inspection Station & License #</label>
                        <input
                          type="text"
                          placeholder="e.g. Certified Heavy Truck & Trailer Services (Sta #8921)"
                          value={vehicleDraft.inspectionStation}
                          onChange={(e) => setVehicleDraft({ ...vehicleDraft, inspectionStation: e.target.value })}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t bg-muted/10 px-6 py-4 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground font-mono">
                {editTargetId ? `Target: ${editTargetId}` : "New Equipment Master Registration"}
              </span>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingOrEditing(false);
                    setVehicleDraft(null);
                  }}
                  className="h-9 px-4 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveVehicle(vehicleDraft, "Manual")}
                  className="h-9 px-5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm flex items-center gap-1.5"
                >
                  <Check className="size-4" /> Save Equipment Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------
          6. OCR REVIEW & EXTRACTION SPLIT WORKSPACE
      --------------------------------------------------------- */}
      {ocrSession && (
        <div className="fixed inset-0 z-[130] flex flex-col bg-background">
          <div className="flex min-h-16 items-center justify-between border-b px-5 bg-card">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ScanDocumentIcon size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold flex items-center gap-2">
                  Vehicle Document Intelligence OCR <span className="text-[10px] rounded bg-emerald-100 text-emerald-800 px-2 py-0.5 font-bold">96% Confidence</span>
                </p>
                <p className="text-[10px] text-muted-foreground">{ocrSession.file.name}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOcrSession(null)}
              className="size-8 flex items-center justify-center rounded-lg hover:bg-muted"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 xl:grid-cols-2">
            {/* Left: Document View */}
            <div className="border-r p-4 bg-muted/10 overflow-hidden">
              <DocumentViewer
                fileName={ocrSession.file.name}
                mimeType={ocrSession.file.type}
                dataUrl={ocrSession.dataUrl}
                onReplace={() => {
                  setOcrSession(null);
                  setShowSourcePicker(true);
                }}
              />
            </div>

            {/* Right: Extracted Form Values */}
            <div className="p-6 overflow-y-auto space-y-5 bg-card">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2 text-emerald-800 dark:text-emerald-300 text-xs">
                <Sparkles className="size-4 shrink-0 text-emerald-600" />
                <span>Extracted Unit Number, VIN, License Plate, and IRP Cab Card details from the registration.</span>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold">Extracted Unit #</label>
                  <input
                    type="text"
                    value={ocrSession.draft.unitNumber}
                    onChange={(e) =>
                      setOcrSession({
                        ...ocrSession,
                        draft: { ...ocrSession.draft, unitNumber: e.target.value },
                      })
                    }
                    className="h-9 w-full rounded border px-3 bg-background font-bold text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold">Extracted Plate Number</label>
                  <input
                    type="text"
                    value={ocrSession.draft.plateNumber}
                    onChange={(e) =>
                      setOcrSession({
                        ...ocrSession,
                        draft: { ...ocrSession.draft, plateNumber: e.target.value.toUpperCase() },
                      })
                    }
                    className="h-9 w-full rounded border px-3 bg-background font-mono font-bold text-xs"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="font-semibold">Extracted 17-Digit VIN</label>
                  <input
                    type="text"
                    value={ocrSession.draft.vin}
                    onChange={(e) =>
                      setOcrSession({
                        ...ocrSession,
                        draft: { ...ocrSession.draft, vin: e.target.value.toUpperCase() },
                      })
                    }
                    className="h-9 w-full rounded border px-3 bg-background font-mono font-bold text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold">Make</label>
                  <input
                    type="text"
                    value={ocrSession.draft.make}
                    onChange={(e) =>
                      setOcrSession({
                        ...ocrSession,
                        draft: { ...ocrSession.draft, make: e.target.value },
                      })
                    }
                    className="h-9 w-full rounded border px-3 bg-background text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold">Model Year</label>
                  <input
                    type="text"
                    value={ocrSession.draft.year}
                    onChange={(e) =>
                      setOcrSession({
                        ...ocrSession,
                        draft: { ...ocrSession.draft, year: e.target.value },
                      })
                    }
                    className="h-9 w-full rounded border px-3 bg-background text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold">Cab Card Number</label>
                  <input
                    type="text"
                    value={ocrSession.draft.cabCardNumber}
                    onChange={(e) =>
                      setOcrSession({
                        ...ocrSession,
                        draft: { ...ocrSession.draft, cabCardNumber: e.target.value },
                      })
                    }
                    className="h-9 w-full rounded border px-3 bg-background text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold">Registration Expiry Date</label>
                  <input
                    type="date"
                    value={ocrSession.draft.regExpiryDate}
                    onChange={(e) =>
                      setOcrSession({
                        ...ocrSession,
                        draft: { ...ocrSession.draft, regExpiryDate: e.target.value },
                      })
                    }
                    className="h-9 w-full rounded border px-3 bg-background text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setOcrSession(null)}
                  className="h-9 px-4 rounded border bg-background hover:bg-muted text-xs font-semibold"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ev: VehicleEvidence = {
                      id: createId("DOC"),
                      fileName: ocrSession.file.name,
                      mimeType: ocrSession.file.type,
                      dataUrl: ocrSession.dataUrl,
                      documentType: ocrSession.documentType,
                      documentDate: ocrSession.documentDate,
                      uploadedAt: isoNow(),
                      source: ocrSession.source,
                      ocrConfidence: ocrSession.confidence,
                    };
                    handleSaveVehicle(ocrSession.draft, "OCR", ev);
                  }}
                  className="h-9 px-5 rounded bg-primary text-primary-foreground font-semibold text-xs flex items-center gap-1.5 shadow-sm hover:bg-primary/90"
                >
                  <Check className="size-4" /> Accept & Create Equipment Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------
          7. DOCUMENT SOURCE PICKER MODAL
      --------------------------------------------------------- */}
      {showSourcePicker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2">
                  <ScanDocumentIcon size={18} />
                  Scan Vehicle Document (OCR)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Extract VIN, cab card number, plate, and expiration dates directly from the document.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSourcePicker(false)}
                className="size-7 flex items-center justify-center rounded hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowSourcePicker(false);
                  setShowCamera(true);
                }}
                className="p-5 rounded-xl border border-border bg-background hover:bg-muted/40 text-left transition-colors flex flex-col items-start"
              >
                <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                  <Camera className="size-5" />
                </div>
                <p className="font-semibold text-sm">Take Photo</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Capture registration via camera stream.</p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowSourcePicker(false);
                  fileInputRef.current?.click();
                }}
                className="p-5 rounded-xl border border-border bg-background hover:bg-muted/40 text-left transition-colors flex flex-col items-start"
              >
                <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                  <Upload className="size-5" />
                </div>
                <p className="font-semibold text-sm">Upload from Device</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Select existing PDF or scanned image.</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------
          8. LIVE CAMERA CAPTURE
      --------------------------------------------------------- */}
      {showCamera && (
        <CameraCapture
          onClose={() => setShowCamera(false)}
          onCapture={(file) => {
            setShowCamera(false);
            startOCRWithFile(file, "camera");
          }}
        />
      )}

      {/* ---------------------------------------------------------
          9. EVIDENCE PREVIEW MODAL
      --------------------------------------------------------- */}
      {previewEvidence && (
        <div className="fixed inset-0 z-[150] bg-background">
          <DocumentViewer
            fileName={previewEvidence.fileName}
            mimeType={previewEvidence.mimeType}
            dataUrl={previewEvidence.dataUrl}
            onClose={() => setPreviewEvidence(null)}
          />
        </div>
      )}

      {/* ---------------------------------------------------------
          10. QUICK ACTION MODAL (LOG INSPECTION / PERMIT)
      --------------------------------------------------------- */}
      {quickActionModal && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base">
                  {quickActionModal.type === "inspection" ? "Log Periodic Safety Inspection (CVIP)" : "Add State/Provincial Permit"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Record compliance renewal details.</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickActionModal(null)}
                className="size-7 flex items-center justify-center rounded hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            {quickActionModal.type === "inspection" ? (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-semibold block mb-1">Inspection Type</label>
                  <select
                    value={quickInspectionDraft.inspectionType}
                    onChange={(e) => setQuickInspectionDraft({ ...quickInspectionDraft, inspectionType: e.target.value as InspectionType })}
                    className="w-full h-9 rounded border px-3 bg-background"
                  >
                    <option value="Annual Periodic Inspection (CVIP / DOT 396.17)">Annual CVIP / DOT 396.17</option>
                    <option value="Semi-Annual Inspection">Semi-Annual Inspection</option>
                    <option value="Preventive Maintenance A">PM Schedule A</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold block mb-1">Inspection Date</label>
                    <input
                      type="date"
                      value={quickInspectionDraft.inspectionDate}
                      onChange={(e) => setQuickInspectionDraft({ ...quickInspectionDraft, inspectionDate: e.target.value })}
                      className="w-full h-9 rounded border px-3 bg-background"
                    />
                  </div>
                  <div>
                    <label className="font-semibold block mb-1">Expiry Date *</label>
                    <input
                      type="date"
                      value={quickInspectionDraft.expiryDate}
                      onChange={(e) => setQuickInspectionDraft({ ...quickInspectionDraft, expiryDate: e.target.value })}
                      className="w-full h-9 rounded border px-3 bg-background font-semibold"
                    />
                  </div>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Station Name / Cert #</label>
                  <input
                    type="text"
                    placeholder="e.g. Certified Heavy Truck Services"
                    value={quickInspectionDraft.stationName}
                    onChange={(e) => setQuickInspectionDraft({ ...quickInspectionDraft, stationName: e.target.value })}
                    className="w-full h-9 rounded border px-3 bg-background"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Inspector Name</label>
                  <input
                    type="text"
                    placeholder="e.g. J. Smith (#4921)"
                    value={quickInspectionDraft.inspectorName}
                    onChange={(e) => setQuickInspectionDraft({ ...quickInspectionDraft, inspectorName: e.target.value })}
                    className="w-full h-9 rounded border px-3 bg-background"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button
                    type="button"
                    onClick={() => setQuickActionModal(null)}
                    className="h-8 px-3 rounded border text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newInsp: VehicleInspection = {
                        id: createId("INSP"),
                        ...quickInspectionDraft,
                      };
                      const updated = vehicles.map((v) =>
                        v.id === quickActionModal.vehicleId
                          ? { ...v, inspections: [newInsp, ...v.inspections], updatedAt: isoNow() }
                          : v
                      );
                      persistVehicles(updated);
                      setQuickActionModal(null);
                    }}
                    className="h-8 px-4 rounded bg-primary text-primary-foreground font-semibold text-xs"
                  >
                    Save Inspection Log
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-semibold block mb-1">Permit Authority / Decal Type</label>
                  <select
                    value={quickPermitDraft.permitType}
                    onChange={(e) => setQuickPermitDraft({ ...quickPermitDraft, permitType: e.target.value as PermitType })}
                    className="w-full h-9 rounded border px-3 bg-background"
                  >
                    <option value="Clean Truck Check / CARB TRU">Clean Truck Check / CARB TRU</option>
                    <option value="New Mexico Weight-Distance Permit">New Mexico Weight-Distance</option>
                    <option value="Oregon Weight-Mile Account / Permit">Oregon Weight-Mile</option>
                    <option value="Kentucky KYU Authority">Kentucky KYU</option>
                    <option value="New York HUT Decal / Certificate">New York HUT</option>
                    <option value="IFTA Decal / License">IFTA Decal</option>
                    <option value="Other State/Provincial Permit">Other Permit</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Permit / Decal #</label>
                  <input
                    type="text"
                    placeholder="e.g. CTC-CA-92019"
                    value={quickPermitDraft.permitNumber}
                    onChange={(e) => setQuickPermitDraft({ ...quickPermitDraft, permitNumber: e.target.value })}
                    className="w-full h-9 rounded border px-3 bg-background font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold block mb-1">Jurisdiction</label>
                    <select
                      value={quickPermitDraft.jurisdictionCode}
                      onChange={(e) => setQuickPermitDraft({ ...quickPermitDraft, jurisdictionCode: e.target.value })}
                      className="w-full h-9 rounded border px-3 bg-background"
                    >
                      {JURISDICTIONS.map((j) => (
                        <option key={j.code} value={j.code}>
                          {j.code} - {j.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold block mb-1">Expiry Date</label>
                    <input
                      type="date"
                      value={quickPermitDraft.expiryDate}
                      onChange={(e) => setQuickPermitDraft({ ...quickPermitDraft, expiryDate: e.target.value })}
                      className="w-full h-9 rounded border px-3 bg-background"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t">
                  <button
                    type="button"
                    onClick={() => setQuickActionModal(null)}
                    className="h-8 px-3 rounded border text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const juris = JURISDICTIONS.find((j) => j.code === quickPermitDraft.jurisdictionCode);
                      const newPmt: VehiclePermit = {
                        id: createId("PMT"),
                        permitType: quickPermitDraft.permitType,
                        permitNumber: quickPermitDraft.permitNumber,
                        jurisdictionCode: quickPermitDraft.jurisdictionCode,
                        jurisdictionLabel: juris ? juris.label : "State",
                        startDate: quickPermitDraft.startDate,
                        expiryDate: quickPermitDraft.expiryDate,
                        status: "Active",
                        notes: quickPermitDraft.notes,
                      };
                      const updated = vehicles.map((v) =>
                        v.id === quickActionModal.vehicleId
                          ? { ...v, permits: [newPmt, ...v.permits], updatedAt: isoNow() }
                          : v
                      );
                      persistVehicles(updated);
                      setQuickActionModal(null);
                    }}
                    className="h-8 px-4 rounded bg-primary text-primary-foreground font-semibold text-xs"
                  >
                    Save Permit Record
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden File Input for Device Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) startOCRWithFile(f, "device");
        }}
      />
    </div>
  );
}
