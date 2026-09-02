import React from "react";
import {
  User,
  Building2,
  ShieldCheck,
  ShieldAlert,
  ArrowLeft,
  Pencil,
  Plus,
  FileText,
  AlertTriangle,
  Upload,
  Calendar,
  Sparkles,
} from "lucide-react";
import { DriverMaster, CompanyDriverRelationship, CanonicalCompany } from "../../types";
import { fullLegalName, currentLicence, currentAddress, calculateAge } from "../../lib/driver-data";

export interface DriverHeaderProps {
  master: DriverMaster;
  relationship: CompanyDriverRelationship;
  company: CanonicalCompany;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onBack: () => void;
  onEditProfile: () => void;
  onAddEvent: () => void;
  onAddScreening: () => void;
  onAddTraining: () => void;
  onAddDocument: () => void;
  openReviewsCount?: number;
}

export interface DriverTabItem {
  id: string;
  label: string;
  isFlagship?: boolean;
}

export const DRIVER_TABS: DriverTabItem[] = [
  { id: "profile", label: "Profile" },
  { id: "qualifications", label: "Qualifications & Licensing" },
  { id: "documents", label: "Documents" },
  { id: "screening", label: "Screening & Medical" },
  { id: "training", label: "Training" },
  { id: "performance", label: "Performance & Events", isFlagship: true },
];

export function DriverHeader({
  master,
  relationship,
  company,
  activeTab,
  onTabChange,
  onBack,
  onEditProfile,
  onAddEvent,
  onAddScreening,
  onAddTraining,
  onAddDocument,
  openReviewsCount = 0,
}: DriverHeaderProps) {
  const licence = currentLicence(master);
  const address = currentAddress(master);
  const age = calculateAge(master.identity.dateOfBirth);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Active":
        return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
      case "On Leave":
        return "bg-amber-500/10 text-amber-700 border-amber-500/20";
      case "Suspended":
      case "Terminated":
        return "bg-red-500/10 text-red-700 border-red-500/20";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Breadcrumb & Quick Nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Driver Roster</span>
        </button>

        <div className="flex items-center gap-2">
          {activeTab === "profile" && (
            <button
              type="button"
              onClick={onEditProfile}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors shadow-2xs"
            >
              <Pencil className="size-3.5" />
              <span>Edit Profile</span>
            </button>
          )}

          {activeTab === "performance" && (
            <button
              type="button"
              onClick={onAddEvent}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <Plus className="size-3.5" />
              <span>Log Performance Event</span>
            </button>
          )}

          {activeTab === "screening" && (
            <button
              type="button"
              onClick={onAddScreening}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <Plus className="size-3.5" />
              <span>Add Screening / Medical</span>
            </button>
          )}

          {activeTab === "training" && (
            <button
              type="button"
              onClick={onAddTraining}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <Plus className="size-3.5" />
              <span>Assign / Log Training</span>
            </button>
          )}

          {activeTab === "documents" && (
            <button
              type="button"
              onClick={onAddDocument}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              <Upload className="size-3.5" />
              <span>Attach Document</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Executive Driver Header Card */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 text-lg font-bold">
              {master.identity.legalFirstName[0]}
              {master.identity.legalLastName[0]}
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  {master.identity.preferredName
                    ? `${master.identity.preferredName} (${master.identity.legalFirstName} ${master.identity.legalLastName})`
                    : fullLegalName(master)}
                </h1>

                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${getStatusBadge(
                    relationship.driverStatus
                  )}`}
                >
                  <span className="size-1.5 rounded-full bg-current" />
                  {relationship.driverStatus}
                </span>

                {openReviewsCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    <AlertTriangle className="size-3" />
                    {openReviewsCount} Review{openReviewsCount > 1 ? "s" : ""} Open
                  </span>
                )}
              </div>

              {/* Identity & Company Relationship Context Bar */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <Building2 className="size-3.5 text-primary" />
                  {company.name}
                </span>
                <span>•</span>
                <span>{relationship.recordType}</span>
                <span>•</span>
                <span>{relationship.operatingRegion}</span>
                <span>•</span>
                <span>Since {relationship.startDate}</span>
                {age !== null && (
                  <>
                    <span>•</span>
                    <span>Age {age}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Canonical ID Badges Grid */}
          <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end">
            <div className="flex items-center gap-1.5 rounded-xl bg-muted/50 border border-border px-3 py-1.5 text-xs font-mono">
              <span className="text-[10px] uppercase font-bold text-muted-foreground">MASTER ID:</span>
              <span className="font-bold text-foreground">{master.id}</span>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl bg-primary/5 border border-primary/20 px-3 py-1.5 text-xs font-mono">
              <span className="text-[10px] uppercase font-bold text-primary">RECORD ID:</span>
              <span className="font-bold text-primary">{relationship.id}</span>
            </div>
          </div>
        </div>

        {/* Quick Facts Sub-bar */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-4 border-t border-border text-xs">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Driver Licence</p>
            <p className="font-mono font-semibold text-foreground mt-0.5 truncate">
              {licence ? `${licence.licenceNumber} (${licence.jurisdiction})` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Licence Class</p>
            <p className="font-semibold text-foreground mt-0.5 truncate">{licence?.class || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Residential Base</p>
            <p className="font-semibold text-foreground mt-0.5 truncate">
              {address ? `${address.city}, ${address.stateProvince} (${address.country})` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Direct Contact</p>
            <p className="font-semibold text-foreground mt-0.5 truncate">{master.identity.phone || master.identity.email || "—"}</p>
          </div>
        </div>
      </div>

      {/* Primary 6 Navigation Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-2xs">
        {DRIVER_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.isFlagship && <Sparkles className="size-3.5 text-amber-300" />}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
