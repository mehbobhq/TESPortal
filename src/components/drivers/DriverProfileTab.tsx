import React, { useState } from "react";
import {
  User,
  Building2,
  MapPin,
  History,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { DriverMaster, CompanyDriverRelationship, CanonicalCompany, RecordType, OperatingRegion, DriverStatus } from "@/types/drivers";
import { ReadOnlyField } from "../shared/ReadOnlyField";
import { fullLegalName, currentAddress, calculateAge } from "@/lib/driver-data";
import { JURISDICTIONS, getJurisdictionLabel } from "@/lib/jurisdictions";

export interface DriverProfileTabProps {
  master: DriverMaster;
  relationship: CompanyDriverRelationship;
  company: CanonicalCompany;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveMaster: (patch: Partial<DriverMaster["identity"]>) => void;
  onSaveRelationship: (patch: Partial<CompanyDriverRelationship>) => void;
  onSaveAddress: (address: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    stateProvince: string;
    postalZip: string;
    country: "Canada" | "United States";
    effectiveFrom: string;
  }) => void;
}

const RECORD_TYPES: RecordType[] = [
  "Employee",
  "Owner-Operator",
  "Contractor",
  "Temporary Driver",
];

const OPERATING_REGIONS: OperatingRegion[] = ["Canada", "United States", "Cross-Border"];

const DRIVER_STATUSES: DriverStatus[] = [
  "Active",
  "On Leave",
  "Suspended",
  "Inactive",
  "Terminated",
];

export function DriverProfileTab({
  master,
  relationship,
  company,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveMaster,
  onSaveRelationship,
  onSaveAddress,
}: DriverProfileTabProps) {
  const address = currentAddress(master);
  const age = calculateAge(master.identity.dateOfBirth);

  // Edit form states
  const [identityDraft, setIdentityDraft] = useState({
    legalFirstName: master.identity.legalFirstName,
    legalMiddleName: master.identity.legalMiddleName || "",
    legalLastName: master.identity.legalLastName,
    preferredName: master.identity.preferredName || "",
    dateOfBirth: master.identity.dateOfBirth,
    phone: master.identity.phone || "",
    email: master.identity.email || "",
  });

  const [relDraft, setRelDraft] = useState({
    recordType: relationship.recordType,
    operatingRegion: relationship.operatingRegion,
    driverStatus: relationship.driverStatus,
    startDate: relationship.startDate,
    endDate: relationship.endDate || "",
  });

  const [addressDraft, setAddressDraft] = useState({
    addressLine1: address?.addressLine1 || "",
    addressLine2: address?.addressLine2 || "",
    city: address?.city || "",
    stateProvince: address?.stateProvince || "ON",
    postalZip: address?.postalZip || "",
    country: address?.country || ("Canada" as "Canada" | "United States"),
    effectiveFrom: address?.effectiveFrom || new Date().toISOString().slice(0, 10),
  });

  const [formError, setFormError] = useState<string | null>(null);

  const handleSaveAll = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!identityDraft.legalFirstName.trim() || !identityDraft.legalLastName.trim()) {
      setFormError("Legal First and Last Name are required.");
      return;
    }

    if (!identityDraft.dateOfBirth) {
      setFormError("Date of Birth is required.");
      return;
    }

    if (!addressDraft.addressLine1.trim() || !addressDraft.city.trim() || !addressDraft.postalZip.trim()) {
      setFormError("Current residential address fields are required.");
      return;
    }

    // Save Master Identity
    onSaveMaster(identityDraft);

    // Save Company Relationship
    onSaveRelationship(relDraft);

    // Save Address
    onSaveAddress(addressDraft);
  };

  return (
    <div className="space-y-6">
      {/* View / Edit Mode Form */}
      {isEditing ? (
        <form onSubmit={handleSaveAll} className="space-y-6">
          {formError && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* 1. Driver Identity Edit Form */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/20 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <User className="size-4 text-primary" />
                Legal Identity
              </h3>
              <span className="text-[10px] font-mono text-muted-foreground">Permanent Master ID: {master.id}</span>
            </div>

            <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Legal First Name *
                </label>
                <input
                  type="text"
                  value={identityDraft.legalFirstName}
                  onChange={(e) => setIdentityDraft({ ...identityDraft, legalFirstName: e.target.value })}
                  required
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Legal Middle Name
                </label>
                <input
                  type="text"
                  value={identityDraft.legalMiddleName}
                  onChange={(e) => setIdentityDraft({ ...identityDraft, legalMiddleName: e.target.value })}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Legal Last Name *
                </label>
                <input
                  type="text"
                  value={identityDraft.legalLastName}
                  onChange={(e) => setIdentityDraft({ ...identityDraft, legalLastName: e.target.value })}
                  required
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Preferred / Known As Name
                </label>
                <input
                  type="text"
                  value={identityDraft.preferredName}
                  onChange={(e) => setIdentityDraft({ ...identityDraft, preferredName: e.target.value })}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Date of Birth (YYYY-MM-DD) *
                </label>
                <input
                  type="date"
                  value={identityDraft.dateOfBirth}
                  onChange={(e) => setIdentityDraft({ ...identityDraft, dateOfBirth: e.target.value })}
                  required
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Contact Phone
                </label>
                <input
                  type="tel"
                  placeholder="(XXX) XXX-XXXX"
                  value={identityDraft.phone}
                  onChange={(e) => setIdentityDraft({ ...identityDraft, phone: e.target.value })}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>
            </div>
          </div>

          {/* 2. Company Driver Relationship Edit Form */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/20 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <Building2 className="size-4 text-primary" />
                Company Relationship ({company.name})
              </h3>
              <span className="text-[10px] font-mono text-primary font-bold">Record ID: {relationship.id}</span>
            </div>

            <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Record Type *
                </label>
                <select
                  value={relDraft.recordType}
                  onChange={(e) => setRelDraft({ ...relDraft, recordType: e.target.value as RecordType })}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold mt-1"
                >
                  {RECORD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Operating Region *
                </label>
                <select
                  value={relDraft.operatingRegion}
                  onChange={(e) => setRelDraft({ ...relDraft, operatingRegion: e.target.value as OperatingRegion })}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold mt-1"
                >
                  {OPERATING_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Driver Status *
                </label>
                <select
                  value={relDraft.driverStatus}
                  onChange={(e) => setRelDraft({ ...relDraft, driverStatus: e.target.value as DriverStatus })}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-bold mt-1"
                >
                  {DRIVER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Relationship Start Date *
                </label>
                <input
                  type="date"
                  value={relDraft.startDate}
                  onChange={(e) => setRelDraft({ ...relDraft, startDate: e.target.value })}
                  required
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Relationship End Date (Optional)
                </label>
                <input
                  type="date"
                  value={relDraft.endDate}
                  onChange={(e) => setRelDraft({ ...relDraft, endDate: e.target.value })}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>
            </div>
          </div>

          {/* 3. Address Edit Form */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/20 px-5 py-3.5 border-b border-border">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <MapPin className="size-4 text-primary" />
                Current Residential Address
              </h3>
            </div>

            <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Address Line 1 *
                </label>
                <input
                  type="text"
                  value={addressDraft.addressLine1}
                  onChange={(e) => setAddressDraft({ ...addressDraft, addressLine1: e.target.value })}
                  required
                  placeholder="Street address or P.O. Box"
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Address Line 2 (Unit / Suite)
                </label>
                <input
                  type="text"
                  value={addressDraft.addressLine2}
                  onChange={(e) => setAddressDraft({ ...addressDraft, addressLine2: e.target.value })}
                  placeholder="Apt, Suite, Unit"
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">City *</label>
                <input
                  type="text"
                  value={addressDraft.city}
                  onChange={(e) => setAddressDraft({ ...addressDraft, city: e.target.value })}
                  required
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Province / State *
                </label>
                <select
                  value={addressDraft.stateProvince}
                  onChange={(e) => {
                    const code = e.target.value;
                    const jur = JURISDICTIONS.find((j) => j.code === code);
                    setAddressDraft({
                      ...addressDraft,
                      stateProvince: code,
                      country: jur?.country || "Canada",
                    });
                  }}
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold mt-1"
                >
                  {JURISDICTIONS.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.label} ({j.code}) — {j.country}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Postal / ZIP Code *
                </label>
                <input
                  type="text"
                  value={addressDraft.postalZip}
                  onChange={(e) => setAddressDraft({ ...addressDraft, postalZip: e.target.value.toUpperCase() })}
                  required
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-mono font-medium mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Country</label>
                <input
                  type="text"
                  value={addressDraft.country}
                  readOnly
                  className="w-full h-9 rounded-xl border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground mt-1 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Effective From *
                </label>
                <input
                  type="date"
                  value={addressDraft.effectiveFrom}
                  onChange={(e) => setAddressDraft({ ...addressDraft, effectiveFrom: e.target.value })}
                  required
                  className="w-full h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium mt-1"
                />
              </div>
            </div>
          </div>

          {/* Form Action Controls */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Check className="size-3.5" />
              Save Profile Changes
            </button>
          </div>
        </form>
      ) : (
        /* ========================================================================= */
        /* VIEW MODE: CLEAN DOCUMENT-STYLE RECORD PRESENTATION (NO DISABLED INPUTS)  */
        /* ========================================================================= */
        <div className="space-y-6">
          {/* 1. Legal Identity Card */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/20 px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <User className="size-4 text-primary" />
                Legal Identity & Master Profile
              </h3>
              <span className="font-mono text-xs font-bold text-muted-foreground">{master.id}</span>
            </div>

            <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ReadOnlyField label="Legal Full Name" value={fullLegalName(master)} />
              <ReadOnlyField label="Preferred Name" value={master.identity.preferredName || "—"} />
              <ReadOnlyField label="Date of Birth" value={master.identity.dateOfBirth} mono />
              <ReadOnlyField label="Current Age" value={age !== null ? `${age} years` : "—"} />
              <ReadOnlyField label="Direct Phone" value={master.identity.phone || "—"} copyable mono />
              <ReadOnlyField label="Email Address" value={master.identity.email || "—"} copyable />
            </div>
          </div>

          {/* 2. Company Driver Relationship Card */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/20 px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <Building2 className="size-4 text-primary" />
                Company Relationship Profile
              </h3>
              <span className="font-mono text-xs font-bold text-primary">{relationship.id}</span>
            </div>

            <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ReadOnlyField label="Employing Carrier" value={company.name} />
              <ReadOnlyField label="Company Record ID" value={relationship.id} mono copyable />
              <ReadOnlyField label="Driver Record Type" value={relationship.recordType} />
              <ReadOnlyField label="Operating Region" value={relationship.operatingRegion} />
              <ReadOnlyField label="Relationship Status" value={relationship.driverStatus} />
              <ReadOnlyField label="Relationship Start Date" value={relationship.startDate} mono />
              <ReadOnlyField label="Relationship End Date" value={relationship.endDate || "Current / Ongoing"} mono />
            </div>
          </div>

          {/* 3. Current Residential Address */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/20 px-5 py-3 border-b border-border">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <MapPin className="size-4 text-primary" />
                Current Residential Address
              </h3>
            </div>

            <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnlyField
                label="Street Address"
                value={address?.addressLine1 || "—"}
                subtext={address?.addressLine2}
              />
              <ReadOnlyField label="City" value={address?.city || "—"} />
              <ReadOnlyField
                label="State / Province"
                value={address ? `${getJurisdictionLabel(address.stateProvince)} (${address.stateProvince})` : "—"}
              />
              <ReadOnlyField label="Postal / ZIP" value={address?.postalZip || "—"} mono />
              <ReadOnlyField label="Country" value={address?.country || "—"} />
              <ReadOnlyField label="Effective From" value={address?.effectiveFrom || "—"} mono />
            </div>
          </div>

          {/* 4. Open Reviews & Jurisdiction Discrepancies */}
          {master.jurisdictionReviews?.filter((r) => r.status === "OPEN").length > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-xs">
                <AlertTriangle className="size-4 shrink-0" />
                <span>Open Jurisdiction Discrepancy Review</span>
              </div>
              {master.jurisdictionReviews
                .filter((r) => r.status === "OPEN")
                .map((r) => (
                  <div key={r.id} className="rounded-xl border border-amber-200 bg-card p-3 text-xs space-y-1">
                    <p className="font-bold text-foreground">{r.reason}</p>
                    <p className="text-muted-foreground">{r.explanation}</p>
                    {r.expectedResolutionDate && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                        Expected Resolution: {r.expectedResolutionDate}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* 5. Historical Address Ledger */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/20 px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <History className="size-3.5" />
                Historical Address Ledger ({master.addressHistory?.length || 0})
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5">Address</th>
                    <th className="px-5 py-2.5">City</th>
                    <th className="px-5 py-2.5">State / Province</th>
                    <th className="px-5 py-2.5">Country</th>
                    <th className="px-5 py-2.5">Effective Range</th>
                    <th className="px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {master.addressHistory?.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-2.5 font-medium text-foreground">
                        {item.addressLine1} {item.addressLine2 ? `(${item.addressLine2})` : ""}
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{item.city}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">
                        {getJurisdictionLabel(item.stateProvince)} ({item.stateProvince})
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{item.country}</td>
                      <td className="px-5 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {item.effectiveFrom} → {item.effectiveTo || "Current"}
                      </td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            item.status === "Current"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 6. Driver Status History */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="bg-muted/20 px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <History className="size-3.5" />
                Status Revision Timeline ({relationship.statusHistory?.length || 0})
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5">Driver Status</th>
                    <th className="px-5 py-2.5">Effective Range</th>
                    <th className="px-5 py-2.5">Recorded Reason</th>
                    <th className="px-5 py-2.5">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {relationship.statusHistory?.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-2.5 font-bold text-foreground">{item.statusValue}</td>
                      <td className="px-5 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {item.effectiveFrom} → {item.effectiveTo || "Current"}
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{item.reason || "Operational Status Update"}</td>
                      <td className="px-5 py-2.5 text-muted-foreground font-mono text-[11px]">{item.source || "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
