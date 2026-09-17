import React, { useState } from "react"
import { Check } from "lucide-react"

import {
  isoNow,
  todayISO,
  createId,
  formatFrequency,
} from "@/src/components/tax-filing/tax-helpers"

import type {
  TaxDefinition,
  FrequencyAssignment,
  FilingFrequency,
  AssignmentType,
  VerificationSource,
} from "@/src/components/tax-filing/types"

function FrequencyAssignmentForm({
  definition,
  onSave,
  onCancel,
}: {
  definition: TaxDefinition
  onSave: (assignment: FrequencyAssignment) => void
  onCancel: () => void
}) {
  const [frequency, setFrequency] = useState<FilingFrequency>(definition.defaultFrequency)
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO())
  const [assignmentType, setAssignmentType] = useState<AssignmentType>("Authority Assigned")
  const [source, setSource] = useState<VerificationSource>("")
  const [sourceReference, setSourceReference] = useState("")
  const [notes, setNotes] = useState("")

  const save = () => {
    if (!effectiveFrom) return

    onSave({
      id: createId("FREQ"),
      frequency,
      effectiveFrom,
      assignmentType,
      source,
      sourceReference,
      notes,
      verifiedDate: source ? todayISO() : undefined,
      createdAt: isoNow(),
    })
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">Add Filing Frequency Assignment</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Frequency changes are effective-dated. Prior reporting periods and historical obligations remain immutable.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Filing Frequency *</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as FilingFrequency)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            {definition.frequencyOptions.map((item) => (
              <option key={item} value={item}>
                {formatFrequency(item)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Effective From *</label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Assignment Type</label>
          <select
            value={assignmentType}
            onChange={(e) => setAssignmentType(e.target.value as AssignmentType)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="Regulatory Default">Regulatory Default</option>
            <option value="Authority Assigned">Authority Assigned</option>
            <option value="Company Elected">Company Elected</option>
            <option value="Manual Override">Manual Override</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Verification Source</label>
          <select
            value={source || ""}
            onChange={(e) => setSource(e.target.value as VerificationSource)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="">Select source</option>
            <option value="Government Portal">Government Portal</option>
            <option value="Official Notice">Official Notice</option>
            <option value="Permit / Registration">Permit / Registration</option>
            <option value="Filed Return">Filed Return</option>
            <option value="Client Instruction">Client Instruction</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Source Reference</label>
          <input
            type="text"
            value={sourceReference}
            placeholder="Notice ID / Docket Number"
            onChange={(event) => setSourceReference(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Notes</label>
          <input
            type="text"
            value={notes}
            placeholder="Assignment rationale"
            onChange={(event) => setNotes(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
        >
          <Check className="size-3.5" /> Save Frequency
        </button>
      </div>
    </div>
  )
}

export { FrequencyAssignmentForm }
