import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"
import type { ApplicationPlan, PlanConsent, PlanField } from "../plan"
import type { ApplicationSnapshot } from "../snapshot"

/**
 * Deterministic application PDF.
 *
 * The same snapshot, plan and consent records always produce the same bytes: no clock, no random ids, fixed metadata dates (the submission time), standard fonts,
 * no object streams. The PDF reproduces the APPLICANT-DECLARED snapshot; it never states that anything was verified, masks sensitive identifiers, and gives each
 * authorization its own page with the exact text, its SHA-256, the signature and the legal status.
 */

export const PDF_GENERATOR_VERSION = "tes-driver-application-pdf/1"

export interface PdfConsentRecord {
  key: string
  version: string
  textSha256: string
  acceptedAt: string
  signatureName: string
  legalStatus: string
  jurisdiction: string | null
  purpose: string
}

export interface PdfInput {
  companyName: string
  applicantName: string
  receiptId: string
  submittedAt: string
  plan: ApplicationPlan
  planSha256: string
  snapshot: ApplicationSnapshot
  snapshotSha256: string
  consents: PdfConsentRecord[]
  /** The TES logo (PNG bytes) when available; the PDF is identical for identical inputs including this one. */
  logoPng?: Uint8Array | null
}

const LETTER: [number, number] = [612, 792]
const M = 54
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.35, 0.4, 0.47)
const NAVY = rgb(0.043, 0.122, 0.267)
const AMBER = rgb(0.47, 0.21, 0.06)

const REPLACEMENTS: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " ", "•": "-", "→": "->" }
/** Standard fonts encode WinAnsi only: anything else is shown as "?" (the exact characters are in the stored snapshot). */
export function pdfSafe(text: string): string {
  let out = ""
  for (const ch of text.normalize("NFC")) {
    if (ch === "\n") out += "\n"
    else if (REPLACEMENTS[ch]) out += REPLACEMENTS[ch]
    else {
      const code = ch.codePointAt(0)!
      out += code >= 0x20 && code <= 0x7e ? ch : code >= 0xa0 && code <= 0xff ? ch : "?"
    }
  }
  return out
}

class Writer {
  doc!: PDFDocument
  font!: PDFFont
  bold!: PDFFont
  mono!: PDFFont
  page!: PDFPage
  y = 0
  pages: PDFPage[] = []
  async init(meta: { title: string; subject: string; date: Date }) {
    this.doc = await PDFDocument.create({ updateMetadata: false })
    this.doc.setTitle(pdfSafe(meta.title))
    this.doc.setSubject(pdfSafe(meta.subject))
    this.doc.setAuthor("TES Driver Application")
    this.doc.setCreator(PDF_GENERATOR_VERSION)
    this.doc.setProducer(PDF_GENERATOR_VERSION)
    this.doc.setKeywords(["applicant-declared", "unverified"])
    this.doc.setCreationDate(meta.date)
    this.doc.setModificationDate(meta.date)
    this.font = await this.doc.embedFont(StandardFonts.Helvetica)
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold)
    this.mono = await this.doc.embedFont(StandardFonts.Courier)
  }
  newPage() {
    this.page = this.doc.addPage(LETTER)
    this.pages.push(this.page)
    this.y = LETTER[1] - M
    return this.page
  }
  /** Sections flow one after another; a new page starts only when little room is left. */
  sectionBreak() {
    if (!this.page || this.y < M + 260) this.newPage()
    else this.y -= 14
  }
  ensure(height: number) {
    if (this.y - height < M + 24) this.newPage()
  }
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = []
    for (const paragraph of pdfSafe(text).split("\n")) {
      if (paragraph.trim() === "") {
        lines.push("")
        continue
      }
      let line = ""
      for (const word of paragraph.split(/\s+/)) {
        // Break words longer than a line (hashes, ids).
        let w = word
        while (font.widthOfTextAtSize(w, size) > width) {
          let cut = w.length
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1
          if (line) {
            lines.push(line)
            line = ""
          }
          lines.push(w.slice(0, cut))
          w = w.slice(cut)
        }
        const candidate = line ? `${line} ${w}` : w
        if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate
        else {
          lines.push(line)
          line = w
        }
      }
      lines.push(line)
    }
    return lines
  }
  text(text: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number; width?: number } = {}) {
    const size = o.size ?? 9.5
    const font = o.font ?? this.font
    const width = (o.width ?? LETTER[0] - 2 * M) - (o.indent ?? 0)
    const lineHeight = size * 1.35
    for (const line of this.wrap(text, font, size, width)) {
      this.ensure(lineHeight)
      if (line) this.page.drawText(line, { x: M + (o.indent ?? 0), y: this.y - size, size, font, color: o.color ?? INK })
      this.y -= lineHeight
    }
    this.y -= o.gap ?? 0
  }
  heading(text: string, level: 1 | 2 = 1) {
    this.ensure(level === 1 ? 40 : 28)
    this.text(text, { size: level === 1 ? 16 : 11.5, font: this.bold, color: NAVY, gap: level === 1 ? 6 : 3 })
    if (level === 1) {
      this.page.drawLine({ start: { x: M, y: this.y + 3 }, end: { x: LETTER[0] - M, y: this.y + 3 }, thickness: 0.6, color: rgb(0.8, 0.84, 0.9) })
      this.y -= 6
    }
  }
  kv(label: string, value: string, o: { mono?: boolean } = {}) {
    const labelWidth = 170
    const size = 9.5
    const valueLines = this.wrap(value === "" ? "-" : value, o.mono ? this.mono : this.font, o.mono ? 8 : size, LETTER[0] - 2 * M - labelWidth - 8)
    const labelLines = this.wrap(label, this.bold, size, labelWidth - 6)
    const rows = Math.max(valueLines.length, labelLines.length)
    const lineHeight = size * 1.35
    this.ensure(Math.min(rows, 3) * lineHeight)
    for (let i = 0; i < rows; i += 1) {
      this.ensure(lineHeight)
      if (labelLines[i]) this.page.drawText(labelLines[i], { x: M, y: this.y - size, size, font: this.bold, color: MUTED })
      if (valueLines[i]) this.page.drawText(valueLines[i], { x: M + labelWidth, y: this.y - size, size: o.mono ? 8 : size, font: o.mono ? this.mono : this.font, color: INK })
      this.y -= lineHeight
    }
    this.y -= 2
  }
  banner(text: string, tone: "warn" | "info" = "info") {
    const size = 9.5
    const lines = this.wrap(text, this.bold, size, LETTER[0] - 2 * M - 16)
    const h = lines.length * size * 1.35 + 12
    this.ensure(h + 6)
    this.page.drawRectangle({ x: M, y: this.y - h, width: LETTER[0] - 2 * M, height: h, color: tone === "warn" ? rgb(1, 0.97, 0.88) : rgb(0.93, 0.96, 1), borderColor: tone === "warn" ? rgb(0.9, 0.7, 0.3) : rgb(0.7, 0.8, 0.95), borderWidth: 0.7 })
    let yy = this.y - 6
    for (const line of lines) {
      this.page.drawText(line, { x: M + 8, y: yy - size, size, font: this.bold, color: tone === "warn" ? AMBER : NAVY })
      yy -= size * 1.35
    }
    this.y -= h + 8
  }
}

const labelOf = (field: PlanField, value: unknown): string => {
  const options = field.options ?? []
  const one = (v: unknown) => {
    const found = options.find((o) => o.value === v)
    return found ? found.label : String(v)
  }
  if (value === null || value === undefined || value === "") return "(not provided)"
  if (field.type === "yesno") return value === "yes" ? "Yes" : value === "no" ? "No" : String(value)
  if (field.type === "multiselect" && Array.isArray(value)) return value.map(one).join(", ")
  if (field.type === "select") return one(value)
  if (field.type === "date") return String(value)
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

const masked = (field: PlanField, text: string): string => {
  const mode = field.pdf.mask ?? (field.sensitivity === "RESTRICTED" ? "EXCLUDE" : "NONE")
  if (mode === "EXCLUDE") return "(not shown in this document)"
  if (mode === "LAST4") return text.length <= 4 ? "****" : `${"*".repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`
  return text
}

function repeatableLines(field: PlanField, value: unknown): string[] {
  const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
  if (rows.length === 0) return ["(none)"]
  return rows.map((row, i) => {
    const parts = (field.itemFields ?? [])
      .filter((f) => row[f.id] !== undefined && row[f.id] !== null && row[f.id] !== "")
      .map((f) => {
        const raw = row[f.id]
        const opts = f.options ?? []
        const shown = f.type === "yesno" ? (raw === "yes" ? "Yes" : "No") : opts.find((o) => o.value === raw)?.label ?? String(raw)
        return `${f.label}: ${shown}`
      })
    return `${i + 1}. ${parts.join("; ")}`
  })
}

export async function renderApplicationPdf(input: PdfInput): Promise<Uint8Array> {
  const submitted = new Date(input.submittedAt)
  const w = new Writer()
  await w.init({ title: `Driver application ${input.receiptId}`, subject: `${input.companyName} - ${input.applicantName}`, date: submitted })
  const { plan, snapshot } = input
  const fieldById = new Map(plan.fields.map((f) => [f.id, f]))

  // ---- Cover ---------------------------------------------------------------------------------------------------------------------------------
  w.newPage()
  if (input.logoPng) {
    try {
      const logo = await w.doc.embedPng(input.logoPng)
      const height = 46
      const width = (logo.width / logo.height) * height
      w.page.drawImage(logo, { x: M, y: w.y - height, width, height })
      w.y -= height + 10
    } catch {
      w.text("TES - Compliance Simplified", { size: 10, font: w.bold, color: NAVY, gap: 6 })
    }
  } else {
    w.text("TES - Compliance Simplified", { size: 10, font: w.bold, color: NAVY, gap: 6 })
  }
  w.text("DRIVER APPLICATION", { size: 22, font: w.bold, color: NAVY, gap: 4 })
  w.text(input.companyName, { size: 13, font: w.bold, gap: 10 })
  w.banner("APPLICANT-DECLARED INFORMATION. Nothing in this document has been verified by the carrier or by TES. Receipt of an application is not a hiring decision.", "warn")
  w.kv("Applicant", input.applicantName)
  w.kv("Receipt number", input.receiptId, { mono: true })
  w.kv("Received (UTC)", submitted.toISOString())
  w.kv("Application stage", snapshot.collectionStage.replace("_", " ").toLowerCase())
  w.kv("Operating scope", `${plan.context.scopeKind.replace(/_/g, " ").toLowerCase()}${plan.context.involvesUS ? " - U.S." : ""}${plan.context.involvesCA ? " - Canada" : ""}`)
  w.kv("Catalogue / rules version", `${plan.catalogueVersion} / ${plan.rulesVersion} (scope rules ${plan.scopeRulesVersion})`)
  w.kv("Plan SHA-256", input.planSha256, { mono: true })
  w.kv("Application SHA-256", input.snapshotSha256, { mono: true })
  w.y -= 6
  w.heading("Verification status", 2)
  w.text("Every requirement below is open. This document records what the applicant declared and signed; verification is performed and recorded separately by the carrier.", { color: MUTED, gap: 4 })
  for (const r of plan.requirements) w.text(`- ${r.title}: PENDING - not verified${r.requiredForQualification ? " (required for qualification)" : ""}`, { indent: 6 })

  // ---- Answers ---------------------------------------------------------------------------------------------------------------------------------
  const sections = plan.sections.slice().sort((a, b) => a.order - b.order)
  for (const section of sections) {
    const rows = snapshot.fields.filter((f) => f.section === section.id)
    const uploads = snapshot.uploads.filter((u) => fieldById.get(u.fieldId)?.section === section.id)
    const sens = [...snapshot.sensitive, ...snapshot.sensitiveNotCollected].filter((s) => fieldById.get(s.fieldId)?.section === section.id)
    if (!rows.length && !uploads.length && !sens.length) continue
    w.sectionBreak()
    w.heading(section.title)
    for (const row of rows) {
      const field = fieldById.get(row.id)
      if (!field) continue
      if (field.pdf.mask === "EXCLUDE") {
        w.kv(field.pdf.label ?? field.label, "(not shown in this document)")
        continue
      }
      if (field.type === "repeatable") {
        w.kv(field.pdf.label ?? field.label, "")
        for (const line of repeatableLines(field, row.value)) w.text(line, { indent: 14, size: 9 })
        w.y -= 3
        continue
      }
      w.kv(field.pdf.label ?? field.label, masked(field, labelOf(field, row.value)))
    }
    for (const u of uploads) w.kv(fieldById.get(u.fieldId)?.label ?? u.fieldId, `Uploaded: ${u.filename} (${u.byteSize} bytes) - evidence document ${u.documentId}`)
    for (const s of snapshot.sensitive.filter((x) => fieldById.get(x.fieldId)?.section === section.id)) w.kv(fieldById.get(s.fieldId)?.label ?? s.fieldId, s.collected ? "Collected securely (value not shown)" : "Not provided")
    for (const s of snapshot.sensitiveNotCollected.filter((x) => fieldById.get(x.fieldId)?.section === section.id)) w.kv(fieldById.get(s.fieldId)?.label ?? s.fieldId, "Not collected on this application")
  }
  if (snapshot.retainedNotApplicable.length) {
    w.y -= 8
    w.text(`${snapshot.retainedNotApplicable.length} earlier answer(s) were kept in the record but did not apply after later answers; they are not current statements of the applicant.`, { color: MUTED, size: 8.5 })
  }

  // ---- Authorizations: one page each ----------------------------------------------------------------------------------------------------------
  const byKey = new Map<string, PlanConsent>(plan.consents.map((c) => [c.key, c]))
  for (const accepted of input.consents.slice().sort((a, b) => a.key.localeCompare(b.key))) {
    const def = byKey.get(accepted.key)
    if (!def) continue
    w.newPage()
    w.heading(def.title)
    if (accepted.legalStatus !== "APPROVED") w.banner("PENDING LEGAL REVIEW: this wording has not been approved by counsel. It is recorded as presented and signed, and must not be relied on until approved.", "warn")
    w.kv("Authorization", `${def.key} (version ${accepted.version})`)
    w.kv("Purpose", accepted.purpose)
    w.kv("Authorized parties", def.authorizedParties.join(", "))
    w.kv("Scope", Object.entries(def.scope).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("; "))
    w.kv("Jurisdiction", accepted.jurisdiction ?? "-")
    w.kv("Text SHA-256", accepted.textSha256, { mono: true })
    w.y -= 4
    w.heading("Text presented", 2)
    w.text(def.text, { size: 9.5, gap: 8 })
    w.heading("Signature", 2)
    w.kv("Signed by (typed name)", accepted.signatureName)
    w.kv("Signed at (UTC)", new Date(accepted.acceptedAt).toISOString())
    w.kv("Acceptance action", "Affirmative checkbox with typed signature")
  }

  const externals = snapshot.externalProcesses.map((e) => byKey.get(e.key)).filter((c): c is PlanConsent => Boolean(c))
  if (externals.length) {
    w.newPage()
    w.heading("Authorizations completed outside this application")
    for (const c of externals) {
      w.heading(c.title, 2)
      w.text("This is completed through a separate, official or standalone process. This application does not capture or replace it.", { color: MUTED, gap: 4 })
    }
  }

  // ---- Closing page -----------------------------------------------------------------------------------------------------------------------------
  w.newPage()
  w.heading("Open regulatory review items")
  if (plan.regulatoryReviewRequirements.length === 0) w.text("None recorded.")
  for (const r of plan.regulatoryReviewRequirements) w.text(`- ${r.text}`, { indent: 6, gap: 2 })
  w.y -= 6
  w.heading("Limitations", 2)
  for (const l of plan.limitations) w.text(`- ${l}`, { indent: 6, gap: 2 })
  w.y -= 6
  w.heading("Sources cited (none verified by counsel)", 2)
  for (const [key, s] of Object.entries(plan.legalSources).sort(([a], [b]) => a.localeCompare(b))) w.text(`- ${s.citation} [${key}] - ${s.verification}`, { indent: 6, size: 8.5 })
  w.y -= 6
  w.heading("Integrity", 2)
  w.text("The application SHA-256 above is the SHA-256 of the canonical JSON of the stored application snapshot (keys sorted, no whitespace). Characters outside the PDF character set appear as \"?\" here; the stored snapshot holds the exact text.", { color: MUTED, size: 8.5 })
  w.kv("Generator", PDF_GENERATOR_VERSION)

  // ---- Footer on every page ---------------------------------------------------------------------------------------------------------------------
  const total = w.pages.length
  w.pages.forEach((page, i) => {
    const footer = pdfSafe(`${input.companyName} - Receipt ${input.receiptId} - Application SHA-256 ${input.snapshotSha256.slice(0, 16)}... - Applicant-declared, not verified - Page ${i + 1} of ${total}`)
    page.drawText(footer, { x: M, y: M - 18, size: 7, font: w.font, color: MUTED })
  })
  return w.doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
}

