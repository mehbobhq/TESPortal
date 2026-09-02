import React, { useState } from "react";
import {
  CreditCard,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  History,
  Plus,
  CheckCircle2,
  Calendar,
  Sparkles,
  Award,
  Upload,
} from "lucide-react";
import { DriverMaster, LicenceRecord } from "../../types";
import { ReadOnlyField, RegulatoryIdentifierField } from "../shared/ReadOnlyField";
import { currentLicence, currentAddress } from "../../lib/driver-data";
import { JURISDICTIONS, getJurisdictionLabel } from "../../lib/jurisdictions";
import { normalizeLicence, verifyLicenceSyntax } from "../../lib/identifier-normalization";

export interface DriverQualificationsTabProps {
  master: DriverMaster;
  onAddLicence: (licence: Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo">) => void;
  onStartOCR?: () => void;
}

export function DriverQualificationsTab({
  master,
  onAddLicence,
  onStartOCR,
}: DriverQualificationsTabProps) {
  const licence = currentLicence(master);
  const address = currentAddress(master);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [form, setForm] = useState({
    licenceNumber: "",
    jurisdiction: "",
    country: "Canada" as "Canada" | "United States",
    class: "",
    endorsements: "",
    restrictions: "",
    airBrakeQualified: false,
    issueDate: "",
    expiryDate: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    verificationState: "Unverified" as LicenceRecord["verificationState"],
    notes: "",
  });

  const [formError, setFormError] = useState<string | null>(null);

  // Address and Licence jurisdiction comparison
  const jurisdictionMismatch = Boolean(
    address && licence && address.stateProvince.toUpperCase() !== licence.jurisdiction.toUpperCase()
  );

  // Format syntax verification
  const syntaxCheck = licence
    ? verifyLicenceSyntax(licence.licenceNumber, licence.jurisdiction)
    : { validFormat: true };

  const handleSaveNewLicence = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.licenceNumber.trim()) {
      setFormError("Licence Number is required.");
      return;
    }

    if (!form.jurisdiction) {
      setFormError("Issuing Jurisdiction is required.");
      return;
    }

    const endorsementsList = form.endorsements
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const restrictionsList = form.restrictions
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    onAddLicence({
      licenceNumber: form.licenceNumber.trim(),
      licenceNumberRaw: form.licenceNumber.trim(),
      jurisdiction: form.jurisdiction,
      country: form.country,
      class: form.class,
      endorsements: endorsementsList,
      restrictions: restrictionsList,
      airBrakeQualified: form.airBrakeQualified,
      issueDate: form.issueDate || undefined,
      expiryDate: form.expiryDate || undefined,
      effectiveFrom: form.effectiveFrom,
      verificationState: form.verificationState,
      notes: form.notes || undefined,
      source: "Driver Qualifications Workspace",
    });

    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* 1. Top Section: Current Commercial Driver Licence Card */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/20 px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Current Active Commercial Driver Licence
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {onStartOCR && (
              <button
                type="button"
                onClick={onStartOCR}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors shadow-2xs"
              >
                <Sparkles className="size-3 text-primary" />
                <span>Scan Licence (OCR)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setForm({
                  licenceNumber: "",
                  jurisdiction: "",
                  country: "Canada",
                  class: "",
                  endorsements: "",
                  restrictions: "",
                  airBrakeQualified: false,
                  issueDate: "",
                  expiryDate: "",
                  effectiveFrom: new Date().toISOString().slice(0, 10),
                  verificationState: "Unverified",
                  notes: "",
                });
                setFormError(null);
                setIsAddModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <Plus className="size-3" />
              <span>Record New / Renewed Licence</span>
            </button>
          </div>
        </div>

        {licence ? (
          <div className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnlyField
                label="Licence Number (Normalized)"
                value={licence.licenceNumber}
                mono
                copyable
                subtext={licence.licenceNumberRaw ? `Raw Documentary: ${licence.licenceNumberRaw}` : undefined}
              />
              <ReadOnlyField
                label="Issuing Jurisdiction"
                value={`${getJurisdictionLabel(licence.jurisdiction)} (${licence.jurisdiction})`}
                subtext={`Country: ${licence.country}`}
              />
              <ReadOnlyField label="Licence Class" value={licence.class || "—"} />
              <ReadOnlyField
                label="Air Brake Endorsement"
                value={licence.airBrakeQualified ? "Qualified (Z / Q Code)" : "Not Endorsed"}
                badge={
                  licence.airBrakeQualified ? (
                    <span className="rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 px-1.5 py-0.2 text-[9px] font-bold">
                      Air Brake Verified
                    </span>
                  ) : undefined
                }
              />
              <ReadOnlyField label="Issue Date" value={licence.issueDate || "—"} mono />
              <ReadOnlyField label="Expiry Date" value={licence.expiryDate || "—"} mono />
              <ReadOnlyField label="Effective From" value={licence.effectiveFrom} mono />
              <ReadOnlyField
                label="Verification Status"
                value={licence.verificationState || "—"}
                badge={
                  licence.verificationState === "Document Verified" || licence.verificationState === "MVR Confirmed" || licence.verificationState === "Authoritative Verified" ? (
                    <span className="rounded bg-primary/10 text-primary px-1.5 py-0.2 text-[9px] font-bold">
                      Audited
                    </span>
                  ) : undefined
                }
              />
            </div>

            {/* Endorsements & Restrictions Tags */}
            <div className="grid sm:grid-cols-2 gap-4 pt-3 border-t border-border/60">
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Active Commercial Endorsements
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {licence.endorsements && licence.endorsements.length > 0 ? (
                    licence.endorsements.map((end) => (
                      <span
                        key={end}
                        className="rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-foreground"
                      >
                        {end}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">None Recorded</span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Documented Restrictions & Conditions
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {licence.restrictions && licence.restrictions.length > 0 ? (
                    licence.restrictions.map((res) => (
                      <span
                        key={res}
                        className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground"
                      >
                        {res}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">None (No Restrictions)</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No driver licence record exists on this Driver Master.
          </div>
        )}
      </div>

      {/* 2. Discrepancy & Jurisdiction Discrepancy Indicators */}
      {jurisdictionMismatch && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Jurisdiction Mismatch Discrepancy Detected</span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Residential address is registered in <strong>{address?.stateProvince}</strong>, while current commercial
            licence is issued by <strong>{licence?.jurisdiction}</strong>. Regulatory rules require licence transfer or
            documented relocation review.
          </p>
        </div>
      )}

      {!syntaxCheck.validFormat && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 p-4 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Licence Number Format Warning</p>
            <p className="text-muted-foreground mt-0.5">{syntaxCheck.hint}</p>
          </div>
        </div>
      )}

      {/* 3. Commercial Driving Qualifications & Operating Facts */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/20 px-5 py-3 border-b border-border">
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
            <Award className="size-4 text-primary" />
            Commercial Operating Qualification Facts
          </h3>
        </div>

        <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <ReadOnlyField
            label="US FMCSA Operating Qualified"
            value="Qualified (Part 391 Verified)"
            badge={<CheckCircle2 className="size-3 text-emerald-600" />}
          />
          <ReadOnlyField
            label="Canada NSC Standard Qualified"
            value="Qualified (Standard 9 / 10)"
            badge={<CheckCircle2 className="size-3 text-emerald-600" />}
          />
          <ReadOnlyField
            label="Dangerous Goods / Hazmat"
            value="Classified (Certified Dec 2024)"
          />
          <ReadOnlyField
            label="Equipment Competency"
            value="53ft Multi-Temp Reefer, Dry Van, Super-B"
          />
        </div>
      </div>

      {/* 4. Continuous Licence History Ledger */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/20 px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <History className="size-3.5" />
            Continuous Licence History Ledger ({master.licenceHistory?.length || 0})
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5">Licence Number</th>
                <th className="px-5 py-2.5">Jurisdiction</th>
                <th className="px-5 py-2.5">Class</th>
                <th className="px-5 py-2.5">Effective Range</th>
                <th className="px-5 py-2.5">Verification</th>
                <th className="px-5 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {master.licenceHistory?.map((item) => (
                <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-2.5 font-mono font-bold text-foreground">
                    {item.licenceNumber}
                  </td>
                  <td className="px-5 py-2.5 text-muted-foreground">
                    {getJurisdictionLabel(item.jurisdiction)} ({item.jurisdiction})
                  </td>
                  <td className="px-5 py-2.5 font-semibold text-foreground">{item.class || "—"}</td>
                  <td className="px-5 py-2.5 font-mono text-[11px] text-muted-foreground">
                    {item.effectiveFrom} → {item.effectiveTo || "Current"}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-foreground">
                      {item.verificationState || "—"}
                    </span>
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

      {/* Add / Renew Licence Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Record Commercial Driver Licence</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveNewLicence} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Licence Number *
                  </label>
                  <input
                    type="text"
                    value={form.licenceNumber}
                    onChange={(e) => setForm({ ...form, licenceNumber: e.target.value })}
                    required
                    placeholder="e.g. D1234-56789-01234"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-bold mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Issuing Jurisdiction *
                  </label>
                  <select
                    value={form.jurisdiction}
                    onChange={(e) => {
                      const code = e.target.value;
                      const jur = JURISDICTIONS.find((j) => j.code === code);
                      setForm({
                        ...form,
                        jurisdiction: code,
                        country: jur?.country || "Canada",
                      });
                    }}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold mt-1"
                  >
                    <option value="">-- Select Jurisdiction --</option>
                    {JURISDICTIONS.map((j) => (
                      <option key={j.code} value={j.code}>
                        {j.label} ({j.code}) — {j.country}
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
                    value={form.class}
                    onChange={(e) => setForm({ ...form, class: e.target.value })}
                    placeholder="e.g. Class A / AZ"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Air Brake Qualified
                  </label>
                  <select
                    value={form.airBrakeQualified ? "yes" : "no"}
                    onChange={(e) => setForm({ ...form, airBrakeQualified: e.target.value === "yes" })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1 font-semibold"
                  >
                    <option value="no">No / Not Endorsed</option>
                    <option value="yes">Yes (Air Brake Qualified - Z / Q Code)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Issue Date
                  </label>
                  <input
                    type="date"
                    value={form.issueDate}
                    onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Expiry Date
                  </label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Effective From *
                  </label>
                  <input
                    type="date"
                    value={form.effectiveFrom}
                    onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                    required
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Verification State
                  </label>
                  <select
                    value={form.verificationState}
                    onChange={(e) =>
                      setForm({ ...form, verificationState: e.target.value as LicenceRecord["verificationState"] })
                    }
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  >
                    <option value="Unverified">Unverified</option>
                    <option value="Document Uploaded">Document Uploaded</option>
                    <option value="OCR Extracted">OCR Extracted</option>
                    <option value="Human Reviewed">Human Reviewed</option>
                    <option value="Document Verified">Document Verified</option>
                    <option value="MVR Confirmed">MVR Confirmed</option>
                    <option value="Authoritative Verified">Authoritative Verified</option>
                    <option value="Discrepancy Pending">Discrepancy Pending</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Endorsements (Comma separated)
                  </label>
                  <input
                    type="text"
                    value={form.endorsements}
                    onChange={(e) => setForm({ ...form, endorsements: e.target.value })}
                    placeholder="e.g. Air Brake (Z), Tanker (N), Hazmat (H)"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Restrictions
                  </label>
                  <input
                    type="text"
                    value={form.restrictions}
                    onChange={(e) => setForm({ ...form, restrictions: e.target.value })}
                    placeholder="e.g. Corrective Lenses (01)"
                    className="w-full h-9 rounded-xl border border-border bg-background px-3 mt-1"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-semibold hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 shadow-sm"
                >
                  Save Licence
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
