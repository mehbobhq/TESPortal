import { isoNow, formatFrequency } from "@/src/components/tax-filing/tax-helpers"
import type { TaxProfile, TaxDefinition, TaxProfileStatus, VerificationSource } from "@/src/components/tax-filing/types"

function TaxProfileForm({
  profile,
  definition,
  onChange,
}: {
  profile: TaxProfile
  definition: TaxDefinition
  onChange: (profile: TaxProfile) => void
}) {
  const patch = (value: Partial<TaxProfile>) => {
    onChange({ ...profile, ...value, updatedAt: isoNow() })
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Tax Program</label>
        <input
          type="text"
          value={definition.name}
          readOnly
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-muted/30 font-medium text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Jurisdiction</label>
        <input
          type="text"
          value={definition.jurisdiction}
          readOnly
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-muted/30 text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">
          {definition.accountLabel}{definition.accountRequired ? " *" : ""}
        </label>
        <input
          type="text"
          value={profile.accountNumber || ""}
          placeholder="Enter account / permit number"
          onChange={(event) => patch({ accountNumber: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Account Status *</label>
        <select
          value={profile.accountStatus}
          onChange={(e) => patch({ accountStatus: e.target.value as TaxProfileStatus })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        >
          <option value="Active">Active</option>
          <option value="Pending">Pending</option>
          <option value="Suspended">Suspended</option>
          <option value="Inactive">Inactive</option>
          <option value="Closed">Closed</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Current Filing Frequency</label>
        <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 px-3 text-xs font-medium text-foreground">
          {formatFrequency(profile.filingFrequency)}
        </div>
        <p className="text-[10px] leading-4 text-muted-foreground">
          Filing frequency is effective-dated. To change frequency, add an entry under Frequency History so prior periods remain immutable.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Effective Date</label>
        <input
          type="date"
          value={profile.effectiveDate || ""}
          onChange={(event) => patch({ effectiveDate: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Closure Date</label>
        <input
          type="date"
          value={profile.closureDate || ""}
          onChange={(event) => patch({ closureDate: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Verification Source</label>
        <select
          value={profile.verificationSource || ""}
          onChange={(e) => patch({ verificationSource: e.target.value as VerificationSource })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        >
          <option value="">Select verification source</option>
          <option value="Government Portal">Government Portal</option>
          <option value="Official Notice">Official Notice</option>
          <option value="Permit / Registration">Permit / Registration</option>
          <option value="Filed Return">Filed Return</option>
          <option value="Client Instruction">Client Instruction</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Verification Reference</label>
        <input
          type="text"
          value={profile.verificationReference || ""}
          placeholder="Confirmation / Letter ID"
          onChange={(event) => patch({ verificationReference: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Last Verified Date</label>
        <input
          type="date"
          value={profile.lastVerifiedDate || ""}
          onChange={(event) => patch({ lastVerifiedDate: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground">Last Verified By</label>
        <input
          type="text"
          value={profile.lastVerifiedBy || ""}
          placeholder="Verifier name / officer"
          onChange={(event) => patch({ lastVerifiedBy: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <label className="text-xs font-semibold text-foreground">Notes</label>
        <input
          type="text"
          value={profile.notes || ""}
          placeholder="Additional operational or jurisdiction notes"
          onChange={(event) => patch({ notes: event.target.value })}
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        />
      </div>
    </div>
  )
}

export { TaxProfileForm }
