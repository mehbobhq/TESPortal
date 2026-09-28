import test from "node:test"
import assert from "node:assert/strict"

import {
  createInvoiceBusinessFingerprint,
  createLineFingerprint,
  scoreDuplicateCandidate,
  sha256Hex,
} from "../lib/repair-document-intake.ts"
import {
  decideRepairInvoiceIngestion,
  UnconfiguredRepairInvoiceOCRAdapter,
} from "../lib/repair-invoice-ocr.ts"
import { normalizeSuffix, validateCompany } from "../lib/company-validation.ts"

test("identical source hashes are exact duplicates", () => {
  const result = scoreDuplicateCandidate({ sourceHash: "same", companyId: "C1" }, { invoiceId: "I1", sourceHash: "same", companyId: "C1" })
  assert.equal(result.decision, "EXACT_DUPLICATE")
  assert.equal(result.score, 1)
})

test("same invoice identifiers produce a probable duplicate", () => {
  const common = { companyId: "C1", providerId: "P1", invoiceNumber: "INV-17", invoiceDate: "2026-09-20", serviceCompletionDate: "2026-09-20", vehicleId: "V1", currency: "CAD", totalDue: 500, lineFingerprint: "brake:2:100:200" }
  const result = scoreDuplicateCandidate(common, { ...common, invoiceId: "I1" })
  assert.equal(result.decision, "PROBABLE_DUPLICATE")
})

test("the same invoice number from a different provider is not automatically exact", () => {
  const result = scoreDuplicateCandidate({ companyId: "C1", providerId: "P1", invoiceNumber: "100", vehicleId: "V1", totalDue: 50 }, { invoiceId: "I1", companyId: "C1", providerId: "P2", invoiceNumber: "100", vehicleId: "V1", totalDue: 50 })
  assert.notEqual(result.decision, "EXACT_DUPLICATE")
  assert.notEqual(result.decision, "PROBABLE_DUPLICATE")
})

test("line fingerprint is stable regardless of row order", () => {
  const a = [
    { description: "Brake Pad", quantity: 2, unitPrice: 50, lineTotal: 100 },
    { description: "Labour", quantity: 1, unitPrice: 90, lineTotal: 90 },
  ]
  assert.equal(createLineFingerprint(a), createLineFingerprint([...a].reverse()))
})

test("business fingerprint normalizes invoice punctuation", () => {
  const base = { companyId: "C1", providerId: "P1", invoiceDate: "2026-09-20", vehicleId: "V1", currency: "CAD", totalDue: 100 }
  assert.equal(createInvoiceBusinessFingerprint({ ...base, invoiceNumber: "AB-100" }), createInvoiceBusinessFingerprint({ ...base, invoiceNumber: "ab 100" }))
})

test("SHA-256 is deterministic", async () => {
  assert.equal(await sha256Hex("invoice"), await sha256Hex("invoice"))
  assert.notEqual(await sha256Hex("invoice"), await sha256Hex("invoice-2"))
})

test("company or vehicle conflicts block auto acceptance", () => {
  const confidence = { documentClassification: 1, segmentation: 1, companyOwnership: 1, vehicleIdentity: 1, providerMatch: 1, invoiceHeader: 1, invoiceLines: 1, financialReconciliation: 1, duplicateConfidence: 1 }
  assert.equal(decideRepairInvoiceIngestion({ confidence, companyConflict: true, reconciled: true, evidenceStored: true }).decision, "OWNERSHIP_MISMATCH")
  assert.equal(decideRepairInvoiceIngestion({ confidence, vehicleConflict: true, reconciled: true, evidenceStored: true }).decision, "VEHICLE_MISMATCH")
})

test("only a fully supported, evidenced, reconciled high-confidence record auto-accepts", () => {
  const confidence = { documentClassification: 1, segmentation: 1, companyOwnership: 1, vehicleIdentity: 1, providerMatch: 1, invoiceHeader: 1, invoiceLines: 1, financialReconciliation: 1, duplicateConfidence: 1 }
  assert.equal(decideRepairInvoiceIngestion({ confidence, reconciled: true, evidenceStored: true, supportedDocument: true }).decision, "AUTO_ACCEPT")
  assert.equal(decideRepairInvoiceIngestion({ confidence: { ...confidence, invoiceLines: 0.7 }, reconciled: true, evidenceStored: true }).decision, "HUMAN_REVIEW_REQUIRED")
  assert.equal(decideRepairInvoiceIngestion({ confidence, reconciled: false, evidenceStored: true }).decision, "UNRECONCILED")
})

test("unconfigured OCR adapter fails safely without creating a record", async () => {
  const adapter = new UnconfiguredRepairInvoiceOCRAdapter()
  assert.equal(adapter.isConfigured(), false)
  await assert.rejects(() => adapter.analyze({ sourceDocumentId: "D1", fileName: "invoice.pdf", mimeType: "application/pdf" }), /not configured/i)
})

test("company suffix and punctuation normalization prevents duplicate organizations", () => {
  assert.equal(normalizeSuffix("ABC Transport Incorporated"), normalizeSuffix("ABC Transport Inc."))
  const result = validateCompany({ name: "ABC Transport Inc." }, [{ id: "C1", name: "ABC Transport Incorporated" }])
  assert.equal(result.warning, true)
  assert.equal(result.possibleMatchId, "C1")
})
