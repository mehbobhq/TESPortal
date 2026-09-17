import React, { useState } from "react"
import { Check } from "lucide-react"

import {
  isoNow,
  todayISO,
  createId,
} from "@/src/components/tax-filing/tax-helpers"

import type {
  FilingObligation,
  FilingSubmission,
  ReturnType,
  FilingMethod,
  PaymentStatus,
} from "@/src/components/tax-filing/types"

function FilingRecordForm({
  obligation,
  existingSubmission,
  onSave,
  onCancel,
}: {
  obligation: FilingObligation
  existingSubmission?: FilingSubmission
  onSave: (submission: FilingSubmission) => void
  onCancel: () => void
}) {
  const [returnType, setReturnType] = useState<ReturnType>(
    existingSubmission?.returnType || "Activity Return"
  )

  const [filingMethod, setFilingMethod] = useState<FilingMethod>(
    existingSubmission?.filingMethod || "Online"
  )

  const [filingDate, setFilingDate] = useState(
    existingSubmission?.filingDate || todayISO()
  )

  const [amountDue, setAmountDue] = useState(
    existingSubmission?.amountDue || ""
  )

  const [amountPaid, setAmountPaid] = useState(
    existingSubmission?.amountPaid || ""
  )

  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    existingSubmission?.paymentStatus || "Paid"
  )

  const [confirmationNumber, setConfirmationNumber] = useState(
    existingSubmission?.confirmationNumber || ""
  )

  const [notes, setNotes] = useState(
    existingSubmission?.notes || ""
  )

  const save = () => {
    const now = isoNow()

    onSave({
      id: existingSubmission?.id || createId("SUB"),
      obligationId: obligation.id,
      returnType,
      filingMethod,
      filingDate,
      amountDue,
      amountPaid,
      paymentStatus,
      confirmationNumber,
      notes,
      createdAt: existingSubmission?.createdAt || now,
      updatedAt: now,
    })
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">
          {existingSubmission ? "Edit Filing Submission" : "Record Filing Submission"}
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {obligation.reportingPeriodLabel} · Due {obligation.dueDate}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Return Type *
          </label>

          <select
            value={returnType}
            onChange={(e) => setReturnType(e.target.value as ReturnType)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="Activity Return">Activity Return</option>
            <option value="Zero Return">Zero Return</option>
            <option value="Final Return">Final Return</option>
            <option value="Amended / Corrective Return">
              Amended / Corrective Return
            </option>
            <option value="No Return Required">
              No Return Required
            </option>
            <option value="Not Determined">
              Not Determined
            </option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Filing Method
          </label>

          <select
            value={filingMethod}
            onChange={(e) => setFilingMethod(e.target.value as FilingMethod)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="Online">Online</option>
            <option value="Paper">Paper</option>
            <option value="Amended / Corrective Filing">
              Amended / Corrective Filing
            </option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Filing Date
          </label>

          <input
            type="date"
            value={filingDate}
            onChange={(event) => setFilingDate(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Confirmation / Reference Number
          </label>

          <input
            type="text"
            value={confirmationNumber}
            placeholder="e.g. TX-2026-89412"
            onChange={(event) => setConfirmationNumber(event.target.value)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Amount Due
          </label>

          <input
            type="text"
            value={amountDue}
            onChange={(event) => setAmountDue(event.target.value)}
            placeholder="$0.00"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Amount Paid
          </label>

          <input
            type="text"
            value={amountPaid}
            onChange={(event) => setAmountPaid(event.target.value)}
            placeholder="$0.00"
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Payment Status
          </label>

          <select
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
            className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="Not Applicable">Not Applicable</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Partially Paid">Partially Paid</option>
            <option value="Paid">Paid</option>
            <option value="Refund">Refund</option>
            <option value="Pending">Pending</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Notes
          </label>

          <input
            type="text"
            value={notes}
            placeholder="Filing notes, payment checks, confirmation remarks"
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
          <Check className="size-3.5" /> Save Filing Record
        </button>
      </div>
    </div>
  )
}

export { FilingRecordForm }