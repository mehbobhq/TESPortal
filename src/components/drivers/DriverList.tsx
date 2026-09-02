import React, { useState, useMemo } from "react";
import {
  Users,
  Search,
  Plus,
  Filter,
  Building2,
  AlertTriangle,
  Sparkles,
  Mail,
  Phone,
  ChevronRight,
  ShieldCheck,
  CreditCard,
  UserPlus,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  DriverMaster,
  CompanyDriverRelationship,
  CanonicalCompany,
  RecordType,
  OperatingRegion,
  DriverStatus,
  LicenceRecord,
} from "@/types/drivers";
import { fullLegalName, currentLicence, currentAddress, calculateAge, findDriverDuplicate } from "@/lib/driver-data";
import { JURISDICTIONS, getJurisdictionLabel } from "@/lib/jurisdictions";

export interface DriverListProps {
  companies: CanonicalCompany[];
  activeCompany: CanonicalCompany;
  onSelectCompany: (company: CanonicalCompany) => void;
  driverMasters: DriverMaster[];
  relationships: CompanyDriverRelationship[];
  onSelectDriver: (driverMasterId: string) => void;
  onCreateDriver: (
    masterData: {
      identity: DriverMaster["identity"];
      initialLicence: Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo">;
      initialAddress: {
        addressLine1: string;
        addressLine2?: string;
        city: string;
        stateProvince: string;
        postalZip: string;
        country: "Canada" | "United States";
        effectiveFrom: string;
      };
    },
    relationshipData: {
      recordType: RecordType;
      operatingRegion: OperatingRegion;
      driverStatus: DriverStatus;
      startDate: string;
    }
  ) => void;
}

export function DriverList({
  companies,
  activeCompany,
  onSelectCompany,
  driverMasters,
  relationships,
  onSelectDriver,
  onCreateDriver,
}: DriverListProps) {
  // Search and Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [recordTypeFilter, setRecordTypeFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Driver Form Draft
  const [newDriverDraft, setNewDriverDraft] = useState({
    legalFirstName: "",
    legalMiddleName: "",
    legalLastName: "",
    preferredName: "",
    dateOfBirth: "",
    phone: "",
    email: "",
    recordType: "Employee" as RecordType,
    operatingRegion: "" as OperatingRegion | "",
    driverStatus: "" as DriverStatus | "",
    startDate: new Date().toISOString().slice(0, 10),
    licenceNumber: "",
    licenceJurisdiction: "",
    licenceClass: "",
    licenceExpiryDate: "",
    airBrakeQualified: false,
    addressLine1: "",
    city: "",
    stateProvince: "",
    postalZip: "",
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Filtered Roster for Active Company
  const companyRoster = useMemo(() => {
    const activeRelMap = new Map<string, CompanyDriverRelationship>();
    relationships
      .filter((r) => r.companyId === activeCompany.id && !r.archive?.isArchived)
      .forEach((r) => activeRelMap.set(r.driverMasterId, r));

    return driverMasters
      .filter((m) => activeRelMap.has(m.id))
      .map((m) => ({
        master: m,
        relationship: activeRelMap.get(m.id)!,
      }));
  }, [driverMasters, relationships, activeCompany]);

  const filteredRoster = useMemo(() => {
    return companyRoster.filter(({ master, relationship }) => {
      if (statusFilter !== "all" && relationship.driverStatus !== statusFilter) return false;
      if (recordTypeFilter !== "all" && relationship.recordType !== recordTypeFilter) return false;
      if (regionFilter !== "all" && relationship.operatingRegion !== regionFilter) return false;

      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const fullName = fullLegalName(master).toLowerCase();
        const pref = (master.identity.preferredName || "").toLowerCase();
        const licence = (currentLicence(master)?.licenceNumber || "").toLowerCase();
        const relId = relationship.id.toLowerCase();
        const masterId = master.id.toLowerCase();

        if (
          !fullName.includes(query) &&
          !pref.includes(query) &&
          !licence.includes(query) &&
          !relId.includes(query) &&
          !masterId.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [companyRoster, statusFilter, recordTypeFilter, regionFilter, searchTerm]);

  // Statistics
  const totalCount = companyRoster.length;
  const activeCount = companyRoster.filter((r) => r.relationship.driverStatus === "Active").length;
  const leaveOrInactiveCount = companyRoster.filter(
    (r) => r.relationship.driverStatus !== "Active"
  ).length;
  const openReviewsCount = companyRoster.reduce(
    (acc, curr) => acc + (curr.master.jurisdictionReviews?.filter((j) => j.status === "OPEN").length || 0),
    0
  );

  const handleCheckDuplicate = () => {
    if (!newDriverDraft.legalFirstName || !newDriverDraft.legalLastName || !newDriverDraft.dateOfBirth) return;
    const testInput = {
      legalFirstName: newDriverDraft.legalFirstName,
      legalMiddleName: newDriverDraft.legalMiddleName,
      legalLastName: newDriverDraft.legalLastName,
      preferredName: newDriverDraft.preferredName,
      dateOfBirth: newDriverDraft.dateOfBirth,
      phone: newDriverDraft.phone,
      email: newDriverDraft.email,
      recordType: newDriverDraft.recordType,
      operatingRegion: newDriverDraft.operatingRegion,
      driverStatus: newDriverDraft.driverStatus,
      relationshipStartDate: newDriverDraft.startDate,
      relationshipEndDate: "",
      addressLine1: newDriverDraft.addressLine1,
      addressLine2: "",
      city: newDriverDraft.city,
      stateProvince: newDriverDraft.stateProvince,
      postalZip: newDriverDraft.postalZip,
      country: "Canada" as const,
      addressEffectiveFrom: newDriverDraft.startDate,
      licenceNumber: newDriverDraft.licenceNumber,
      licenceJurisdiction: newDriverDraft.licenceJurisdiction,
      licenceCountry: "Canada" as const,
      licenceClass: newDriverDraft.licenceClass,
      licenceEffectiveFrom: newDriverDraft.startDate,
    };

    const match = findDriverDuplicate(testInput, driverMasters);

    if (match.kind === "CLEAR") {
      setDuplicateWarning(
        `Exact match found with existing Driver Master ${fullLegalName(match.driver)} (${match.driver.id}) [${match.finding.matchedField}: ${match.finding.matchedValue}].`
      );
    } else if (match.kind === "AMBIGUOUS") {
      setDuplicateWarning(
        `Potential match found with ${match.drivers.length} existing Driver Master(s): ${match.drivers.map((d) => fullLegalName(d)).join(", ")}.`
      );
    } else {
      setDuplicateWarning(null);
    }
  };

  const handleCreateNewDriver = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!newDriverDraft.legalFirstName.trim() || !newDriverDraft.legalLastName.trim()) {
      setFormError("Driver legal first and last name are required.");
      return;
    }

    if (!newDriverDraft.dateOfBirth) {
      setFormError("Date of birth is required.");
      return;
    }

    if (!newDriverDraft.driverStatus) {
      setFormError("Please select a driver status.");
      return;
    }

    if (!newDriverDraft.operatingRegion) {
      setFormError("Please select an operating region.");
      return;
    }

    if (!newDriverDraft.licenceNumber.trim() || !newDriverDraft.licenceJurisdiction) {
      setFormError("Driver licence number and issuing jurisdiction are required.");
      return;
    }

    if (!newDriverDraft.addressLine1.trim() || !newDriverDraft.city.trim() || !newDriverDraft.stateProvince) {
      setFormError("Residential address line, city, and state/province are required.");
      return;
    }

    onCreateDriver(
      {
        identity: {
          legalFirstName: newDriverDraft.legalFirstName.trim(),
          legalMiddleName: newDriverDraft.legalMiddleName.trim() || undefined,
          legalLastName: newDriverDraft.legalLastName.trim(),
          preferredName: newDriverDraft.preferredName.trim() || undefined,
          dateOfBirth: newDriverDraft.dateOfBirth,
          phone: newDriverDraft.phone.trim() || undefined,
          email: newDriverDraft.email.trim() || undefined,
        },
        initialLicence: {
          licenceNumber: newDriverDraft.licenceNumber.trim(),
          licenceNumberRaw: newDriverDraft.licenceNumber.trim(),
          jurisdiction: newDriverDraft.licenceJurisdiction,
          country: JURISDICTIONS.find((j) => j.code === newDriverDraft.licenceJurisdiction)?.country || "Canada",
          class: newDriverDraft.licenceClass || "",
          endorsements: newDriverDraft.airBrakeQualified ? ["Air Brake (Z)"] : [],
          restrictions: [],
          airBrakeQualified: newDriverDraft.airBrakeQualified,
          expiryDate: newDriverDraft.licenceExpiryDate || undefined,
          effectiveFrom: newDriverDraft.startDate,
          verificationState: "Unverified",
          source: "Driver Onboarding Flow",
        },
        initialAddress: {
          addressLine1: newDriverDraft.addressLine1.trim(),
          city: newDriverDraft.city.trim(),
          stateProvince: newDriverDraft.stateProvince,
          postalZip: newDriverDraft.postalZip.trim().toUpperCase(),
          country: JURISDICTIONS.find((j) => j.code === newDriverDraft.stateProvince)?.country || "Canada",
          effectiveFrom: newDriverDraft.startDate,
        },
      },
      {
        recordType: newDriverDraft.recordType,
        operatingRegion: newDriverDraft.operatingRegion as OperatingRegion,
        driverStatus: newDriverDraft.driverStatus,
        startDate: newDriverDraft.startDate,
      }
    );

    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* 1. Header with Carrier Context & Primary CTAs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Commercial Driver Compliance Roster
            </h1>
            <span className="rounded-full bg-primary/10 text-primary text-xs font-bold px-2.5 py-0.5">
              DOT & NSC Standard
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <Building2 className="size-3.5 text-primary" />
            <span className="font-semibold text-foreground">{activeCompany.name}</span>
            <span>({activeCompany.id})</span>
            <span>•</span>
            <span>{activeCompany.operatingJurisdiction} Operating Authority</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setDuplicateWarning(null);
              setNewDriverDraft({
                legalFirstName: "",
                legalMiddleName: "",
                legalLastName: "",
                preferredName: "",
                dateOfBirth: "",
                phone: "",
                email: "",
                recordType: "Employee" as RecordType,
                operatingRegion: "" as OperatingRegion | "",
                driverStatus: "Active" as DriverStatus,
                startDate: new Date().toISOString().slice(0, 10),
                licenceNumber: "",
                licenceJurisdiction: "",
                licenceClass: "",
                licenceExpiryDate: "",
                airBrakeQualified: false,
                addressLine1: "",
                city: "",
                stateProvince: "",
                postalZip: "",
              });
              setIsAddModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs"
          >
            <UserPlus className="size-3.5" />
            <span>Onboard New Driver</span>
          </button>
        </div>
      </div>

      {/* 2. Top Executive Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
            Total Carrier Drivers
          </span>
          <span className="text-2xl font-bold text-foreground mt-1 block">{totalCount}</span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
            Active / Operating
          </span>
          <span className="text-2xl font-bold text-emerald-600 mt-1 block">{activeCount}</span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
            On Leave / Suspended
          </span>
          <span className="text-2xl font-bold text-amber-600 mt-1 block">{leaveOrInactiveCount}</span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
            Open Jurisdiction Reviews
          </span>
          <span className="text-2xl font-bold text-foreground mt-1 block">
            {openReviewsCount > 0 ? (
              <span className="text-amber-600">{openReviewsCount}</span>
            ) : (
              <span className="text-emerald-600">0 (Clean)</span>
            )}
          </span>
        </div>
      </div>

      {/* 3. Search and Multi-Parameter Filter Toolbar */}
      <div className="grid gap-3 sm:grid-cols-4 bg-card p-3.5 rounded-2xl border border-border shadow-xs text-xs">
        <div className="relative">
          <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search driver, licence #, record ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-background text-xs focus:outline-hidden"
          />
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-hidden"
          >
            <option value="all">All Driver Statuses</option>
            <option value="Active">Active</option>
            <option value="On Leave">On Leave</option>
            <option value="Suspended">Suspended</option>
            <option value="Inactive">Inactive</option>
            <option value="Terminated">Terminated</option>
          </select>
        </div>

        <div>
          <select
            value={recordTypeFilter}
            onChange={(e) => setRecordTypeFilter(e.target.value)}
            className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-hidden"
          >
            <option value="all">All Record Types</option>
            <option value="Employee">Employee (Company Driver)</option>
            <option value="Owner-Operator">Owner-Operator</option>
            <option value="Contractor">Contractor</option>
            <option value="Temporary Driver">Temporary Driver</option>
          </select>
        </div>

        <div>
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-hidden"
          >
            <option value="all">All Operating Regions</option>
            <option value="Canada">Canada Domestic</option>
            <option value="United States">US Domestic</option>
            <option value="Cross-Border">Cross-Border (Canada/US)</option>
          </select>
        </div>
      </div>

      {/* 4. Main Driver Roster Table */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Driver Name & Record ID</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Record Type</th>
                <th className="px-5 py-3">Commercial Licence</th>
                <th className="px-5 py-3">Operating Region</th>
                <th className="px-5 py-3">Residential Base</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRoster.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-xs text-muted-foreground">
                    No commercial drivers match your search filters.
                  </td>
                </tr>
              ) : (
                filteredRoster.map(({ master, relationship }) => {
                  const licence = currentLicence(master);
                  const address = currentAddress(master);
                  const age = calculateAge(master.identity.dateOfBirth);

                  return (
                    <tr
                      key={master.id}
                      onClick={() => onSelectDriver(master.id)}
                      className="hover:bg-muted/20 transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold">
                            {master.identity.legalFirstName[0]}
                            {master.identity.legalLastName[0]}
                          </div>
                          <div>
                            <span className="font-bold text-foreground block group-hover:text-primary transition-colors">
                              {master.identity.preferredName
                                ? `${master.identity.preferredName} (${master.identity.legalFirstName} ${master.identity.legalLastName})`
                                : fullLegalName(master)}
                            </span>
                            <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                              <span>{relationship.id}</span>
                              <span>•</span>
                              <span>Age {age}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            relationship.driverStatus === "Active"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : relationship.driverStatus === "On Leave"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                              : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                          }`}
                        >
                          <span className="size-1.5 rounded-full bg-current" />
                          {relationship.driverStatus}
                        </span>
                      </td>

                      <td className="px-5 py-3.5 font-medium text-foreground">{relationship.recordType}</td>

                      <td className="px-5 py-3.5">
                        {licence ? (
                          <div>
                            <span className="font-mono font-bold text-foreground block">
                              {licence.licenceNumber}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {licence.class || "—"} • {licence.jurisdiction}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">No licence recorded</span>
                        )}
                      </td>

                      <td className="px-5 py-3.5 font-medium text-foreground">{relationship.operatingRegion}</td>

                      <td className="px-5 py-3.5 text-muted-foreground">
                        {address ? `${address.city}, ${address.stateProvince}` : "—"}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <span className="inline-flex items-center gap-1 font-bold text-primary group-hover:underline">
                          Workspace <ChevronRight className="size-3.5" />
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

      {/* 5. ONBOARD NEW DRIVER MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Onboard Commercial Driver</h3>
                <p className="text-[11px] text-muted-foreground">
                  Creates canonical Driver Master & Company Driver Relationship for {activeCompany.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            {duplicateWarning && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Identity Collision / Duplicate Warning</p>
                  <p className="text-[11px] opacity-90">{duplicateWarning}</p>
                </div>
              </div>
            )}

            {formError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateNewDriver} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {/* Identity */}
                <div className="col-span-2 sm:col-span-3 font-bold text-foreground border-b border-border/60 pb-1">
                  1. Legal Identity
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Legal First Name *
                  </label>
                  <input
                    type="text"
                    value={newDriverDraft.legalFirstName}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, legalFirstName: e.target.value })}
                    onBlur={handleCheckDuplicate}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Middle Name
                  </label>
                  <input
                    type="text"
                    value={newDriverDraft.legalMiddleName}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, legalMiddleName: e.target.value })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Legal Last Name *
                  </label>
                  <input
                    type="text"
                    value={newDriverDraft.legalLastName}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, legalLastName: e.target.value })}
                    onBlur={handleCheckDuplicate}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Date of Birth *
                  </label>
                  <input
                    type="date"
                    value={newDriverDraft.dateOfBirth}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, dateOfBirth: e.target.value })}
                    onBlur={handleCheckDuplicate}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={newDriverDraft.phone}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, phone: e.target.value })}
                    placeholder="(555) 000-0000"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={newDriverDraft.email}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, email: e.target.value })}
                    placeholder="driver@example.com"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                {/* Relationship */}
                <div className="col-span-2 sm:col-span-3 font-bold text-foreground border-b border-border/60 pb-1 pt-2">
                  2. Carrier Relationship
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Record Type *
                  </label>
                  <select
                    value={newDriverDraft.recordType}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, recordType: e.target.value as any })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  >
                    <option value="Employee">Employee (Company Driver)</option>
                    <option value="Owner-Operator">Owner-Operator</option>
                    <option value="Contractor">Contractor</option>
                    <option value="Temporary Driver">Temporary Driver</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Operating Scope *
                  </label>
                  <select
                    value={newDriverDraft.operatingRegion}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, operatingRegion: e.target.value as any })}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  >
                    <option value="">-- Select Operating Scope --</option>
                    <option value="Cross-Border">Cross-Border (Canada / US)</option>
                    <option value="Canada">Canada Domestic</option>
                    <option value="United States">US Domestic</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Driver Status *
                  </label>
                  <select
                    value={newDriverDraft.driverStatus}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, driverStatus: e.target.value as any })}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  >
                    <option value="">-- Select Status --</option>
                    <option value="Active">Active</option>
                    <option value="On Leave">On Leave</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Terminated">Terminated</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    value={newDriverDraft.startDate}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, startDate: e.target.value })}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>

                {/* Licence */}
                <div className="col-span-2 sm:col-span-3 font-bold text-foreground border-b border-border/60 pb-1 pt-2">
                  3. Driver Licence
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Licence Number *
                  </label>
                  <input
                    type="text"
                    value={newDriverDraft.licenceNumber}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, licenceNumber: e.target.value })}
                    onBlur={handleCheckDuplicate}
                    required
                    placeholder="e.g. K1029-48201-92810"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-bold mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Licence Jurisdiction *
                  </label>
                  <select
                    value={newDriverDraft.licenceJurisdiction}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, licenceJurisdiction: e.target.value })}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  >
                    <option value="">-- Select Jurisdiction --</option>
                    {JURISDICTIONS.map((j) => (
                      <option key={j.code} value={j.code}>
                        {j.label} ({j.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Commercial Class
                  </label>
                  <input
                    type="text"
                    value={newDriverDraft.licenceClass}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, licenceClass: e.target.value })}
                    placeholder="e.g. Class A / AZ"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Air Brake Qualified
                  </label>
                  <select
                    value={newDriverDraft.airBrakeQualified ? "yes" : "no"}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, airBrakeQualified: e.target.value === "yes" })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  >
                    <option value="no">No / Not Recorded</option>
                    <option value="yes">Yes (Air Brake Endorsement - Z / Q)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Licence Expiry Date
                  </label>
                  <input
                    type="date"
                    value={newDriverDraft.licenceExpiryDate}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, licenceExpiryDate: e.target.value })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>

                {/* Address */}
                <div className="col-span-2 sm:col-span-3 font-bold text-foreground border-b border-border/60 pb-1 pt-2">
                  4. Current Residential Address
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Street Address *
                  </label>
                  <input
                    type="text"
                    value={newDriverDraft.addressLine1}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, addressLine1: e.target.value })}
                    required
                    placeholder="e.g. 1044 Steeles Ave West"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    City *
                  </label>
                  <input
                    type="text"
                    value={newDriverDraft.city}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, city: e.target.value })}
                    required
                    placeholder="Brampton"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Province / State *
                  </label>
                  <select
                    value={newDriverDraft.stateProvince}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, stateProvince: e.target.value })}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  >
                    <option value="">-- Select Province / State --</option>
                    {JURISDICTIONS.map((j) => (
                      <option key={j.code} value={j.code}>
                        {j.label} ({j.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Postal / Zip Code
                  </label>
                  <input
                    type="text"
                    value={newDriverDraft.postalZip}
                    onChange={(e) => setNewDriverDraft({ ...newDriverDraft, postalZip: e.target.value })}
                    placeholder="e.g. L6T 5T1"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono mt-1"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 font-semibold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
                >
                  Register & Create Driver Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
