import { readFile } from "node:fs/promises"
import { join } from "node:path"
import fontkit from "@pdf-lib/fontkit"
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib"
import type { ApplicationPlan, PlanConsent, PlanField } from "../plan"
import type { ApplicationSnapshot } from "../snapshot"
import { SCOPE_LABEL } from "@/lib/driver-prospects/operating-scope"

/**
 * Deterministic application PDF ("modern card layout").
 *
 * The same snapshot, plan and consent records always produce the same bytes: no clock, no random ids, fixed metadata dates (the submission time), embedded
 * (subset) Inter fonts with a fixed name, no object streams. The PDF reproduces the APPLICANT-DECLARED snapshot; it never states that anything was verified,
 * masks sensitive identifiers, and gives each authorization its own page(s) with the exact text, its SHA-256, the signature and the legal status.
 * Pagination is dynamic: sections, cards and tables break across pages with repeating headers and a "Page n of N" footer, and headings are never orphaned.
 */

export const PDF_GENERATOR_VERSION = "tes-driver-application-pdf/2"

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
  applicationId?: string
  plan: ApplicationPlan
  planSha256: string
  snapshot: ApplicationSnapshot
  snapshotSha256: string
  consents: PdfConsentRecord[]
  /** The TES logo (PNG bytes). The PDF is identical for identical inputs including this one. */
  logoPng?: Uint8Array | null
}

export interface PdfRender {
  bytes: Uint8Array
  pageCount: number
  /** Every logical string drawn, per page, after font sanitising (not wrapped). Used to prove the PDF carries the whole snapshot. */
  pages: string[][]
  /** Characters the embedded font cannot draw (shown as the replacement mark); the stored snapshot keeps the exact text. */
  unsupportedCharacters: number
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------------------------------------------------------------------

const FONT_DIR = join(process.cwd(), "lib", "driver-application", "pdf", "fonts")
let fontBytes: Promise<{ regular: Buffer; semibold: Buffer; bold: Buffer }> | null = null
const loadFontBytes = () =>
  (fontBytes ??= Promise.all([readFile(join(FONT_DIR, "Inter-Regular.ttf")), readFile(join(FONT_DIR, "Inter-SemiBold.ttf")), readFile(join(FONT_DIR, "Inter-Bold.ttf"))]).then(([regular, semibold, bold]) => ({ regular, semibold, bold })))

// ---------------------------------------------------------------------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------------------------------------------------------------------

const W = 612
const H = 792
const MX = 48
const CW = W - 2 * MX
const TOP = 70
const BOTTOM = 58

const NAVY = rgb(0.043, 0.122, 0.267)
const BLUE = rgb(0.114, 0.306, 0.847)
const BLUE_SOFT = rgb(0.918, 0.945, 0.992)
const BLUE_LINE = rgb(0.80, 0.86, 0.95)
const INK = rgb(0.059, 0.09, 0.165)
const MUTED = rgb(0.337, 0.4, 0.49)
const ROW_A = rgb(0.972, 0.982, 0.997)
const WHITE = rgb(1, 1, 1)
const AMBER_BG = rgb(1, 0.969, 0.878)
const AMBER_LINE = rgb(0.91, 0.72, 0.32)
const AMBER = rgb(0.47, 0.21, 0.06)

type Tone = "info" | "warn"

interface Fonts {
  r: PDFFont
  s: PDFFont
  b: PDFFont
  m: PDFFont
  supported: Set<number>
}

const REPLACEMENT = "�"

class Sanitizer {
  unsupported = 0
  readonly supported: Set<number>
  constructor(supported: Set<number>) {
    this.supported = supported
  }
  clean(text: string): string {
    let out = ""
    for (const ch of String(text ?? "").normalize("NFC")) {
      if (ch === "\n") out += "\n"
      else if (ch === "\t") out += "  "
      else {
        const code = ch.codePointAt(0)!
        if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0) || code === 0xfeff || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e)) continue
        if (this.supported.has(code)) out += ch
        else {
          this.unsupported += 1
          out += this.supported.has(0xfffd) ? REPLACEMENT : "?"
        }
      }
    }
    return out
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Layout engine
// ---------------------------------------------------------------------------------------------------------------------------------------

class Layout {
  doc!: PDFDocument
  f!: Fonts
  san!: Sanitizer
  logo: PDFImage | null = null
  page!: PDFPage
  pages: PDFPage[] = []
  manifest: string[][] = []
  y = 0
  contents: Array<{ title: string; page: number }> = []

  async init(meta: { title: string; subject: string; date: Date; logo?: Uint8Array | null }) {
    this.doc = await PDFDocument.create({ updateMetadata: false })
    this.doc.registerFontkit(fontkit)
    this.doc.setTitle(meta.title)
    this.doc.setSubject(meta.subject)
    this.doc.setAuthor("TES Driver Application")
    this.doc.setCreator(PDF_GENERATOR_VERSION)
    this.doc.setProducer(PDF_GENERATOR_VERSION)
    this.doc.setKeywords(["applicant-declared", "unverified"])
    this.doc.setCreationDate(meta.date)
    this.doc.setModificationDate(meta.date)
    const bytes = await loadFontBytes()
    const r = await this.doc.embedFont(bytes.regular, { subset: false, customName: "TESInter-Regular" })
    const s = await this.doc.embedFont(bytes.semibold, { subset: false, customName: "TESInter-SemiBold" })
    const b = await this.doc.embedFont(bytes.bold, { subset: false, customName: "TESInter-Bold" })
    const m = await this.doc.embedFont(StandardFonts.Courier)
    const supported = new Set<number>(r.getCharacterSet())
    this.f = { r, s, b, m, supported }
    this.san = new Sanitizer(supported)
    if (meta.logo) this.logo = await this.doc.embedPng(meta.logo).catch(() => null)
  }

  get index() {
    return this.pages.length - 1
  }
  newPage(): PDFPage {
    this.page = this.doc.addPage([W, H])
    this.pages.push(this.page)
    this.manifest.push([])
    this.y = H - TOP
    return this.page
  }
  need(h: number) {
    if (this.y - h < BOTTOM) this.newPage()
  }
  note(text: string) {
    this.manifest[this.index].push(text)
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = []
    for (const paragraph of text.split("\n")) {
      if (paragraph.trim() === "") {
        lines.push("")
        continue
      }
      let line = ""
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
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

  /** Draws pre-wrapped lines at a fixed position (no page logic). */
  drawLines(lines: string[], x: number, yTop: number, font: PDFFont, size: number, color = INK, lh = size * 1.4) {
    let y = yTop
    for (const line of lines) {
      if (line) this.page.drawText(line, { x, y: y - size, size, font, color })
      y -= lh
    }
  }

  measure(text: string, font: PDFFont, size: number, width: number, lh = size * 1.4) {
    const lines = this.wrap(this.san.clean(text), font, size, width)
    return { lines, height: Math.max(1, lines.length) * lh }
  }

  /** A paragraph that may flow across pages. */
  paragraph(text: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number; lh?: number } = {}) {
    const size = o.size ?? 9.5
    const lh = o.lh ?? size * 1.45
    const clean = this.san.clean(text)
    const lines = this.wrap(clean, o.font ?? this.f.r, size, o.width ?? CW)
    // Short paragraphs stay whole; longer ones never leave a single line behind (no widows or orphans).
    if (lines.length <= 6) this.need(lines.length * lh)
    else {
      const fit = Math.floor((this.y - BOTTOM) / lh)
      if (fit < 2) this.newPage()
      else if (lines.length - fit === 1) this.need((lines.length - 1) * lh + 1000)
    }
    this.note(clean)
    for (const line of lines) {
      this.need(lh)
      if (line) this.page.drawText(line, { x: o.x ?? MX, y: this.y - size, size, font: o.font ?? this.f.r, color: o.color ?? INK })
      this.y -= lh
    }
    this.y -= o.gap ?? 0
  }

  rect(x: number, yTop: number, w: number, h: number, fill: ReturnType<typeof rgb>, border?: ReturnType<typeof rgb>, opacity = 1) {
    this.page.drawRectangle({ x, y: yTop - h, width: w, height: h, color: fill, borderColor: border, borderWidth: border ? 0.6 : 0, opacity })
  }

  chip(text: string, x: number, yTop: number, tone: Tone | "navy" | "blue") {
    const size = 7.5
    const clean = this.san.clean(text)
    const tw = this.f.s.widthOfTextAtSize(clean, size)
    const w = tw + 14
    const bg = tone === "warn" ? AMBER_BG : tone === "navy" ? NAVY : tone === "blue" ? BLUE : BLUE_SOFT
    const fg = tone === "warn" ? AMBER : tone === "navy" || tone === "blue" ? WHITE : NAVY
    this.page.drawRectangle({ x, y: yTop - 16, width: w, height: 16, color: bg, borderColor: tone === "warn" ? AMBER_LINE : BLUE_LINE, borderWidth: tone === "navy" || tone === "blue" ? 0 : 0.6 })
    this.page.drawText(clean, { x: x + 7, y: yTop - 11.5, size, font: this.f.s, color: fg })
    this.note(clean)
    return w
  }

  /** A sub-heading that must stay with the block after it. */
  subheading(text: string, follow = 120) {
    this.need(26 + follow)
    this.paragraph(text, { font: this.f.s, size: 10.5, color: NAVY, gap: 4 })
  }

  /** A section heading is never left alone at the bottom of a page: room for the heading plus `follow` points of content is required. */
  sectionHeader(title: string, o: { number?: number; follow?: number; intro?: string } = {}) {
    this.need(34 + (o.follow ?? 96))
    const clean = this.san.clean(title)
    this.contents.push({ title: clean, page: this.index + 1 })
    this.note(clean)
    const top = this.y
    if (o.number !== undefined) {
      this.page.drawRectangle({ x: MX, y: top - 20, width: 20, height: 20, color: BLUE })
      const n = String(o.number)
      this.page.drawText(n, { x: MX + 10 - this.f.b.widthOfTextAtSize(n, 10) / 2, y: top - 14, size: 10, font: this.f.b, color: WHITE })
    }
    this.page.drawText(clean, { x: MX + (o.number !== undefined ? 30 : 0), y: top - 15, size: 14, font: this.f.b, color: NAVY })
    this.page.drawLine({ start: { x: MX, y: top - 26 }, end: { x: W - MX, y: top - 26 }, thickness: 1.2, color: BLUE })
    this.y = top - 36
    if (o.intro) this.paragraph(o.intro, { size: 8.5, color: MUTED, gap: 4 })
  }

  /** Label/value rows in one card. Rows never split; the card continues on the next page. */
  kvCard(rows: Array<{ label: string; value: string; mono?: boolean }>, o: { labelWidth?: number } = {}) {
    const lw = o.labelWidth ?? 176
    const vw = CW - lw - 24
    let alt = false
    for (const row of rows) {
      const label = this.measure(row.label, this.f.s, 8.5, lw - 8)
      const value = this.measure(row.value === "" ? "—" : row.value, row.mono ? this.f.m : this.f.r, row.mono ? 8 : 9.5, vw, row.mono ? 11 : 13.5)
      const h = Math.max(label.height, value.height) + 11
      this.need(h)
      this.rect(MX, this.y, CW, h, alt ? ROW_A : WHITE)
      this.page.drawLine({ start: { x: MX, y: this.y - h }, end: { x: W - MX, y: this.y - h }, thickness: 0.5, color: BLUE_LINE })
      this.page.drawLine({ start: { x: MX, y: this.y }, end: { x: MX, y: this.y - h }, thickness: 2, color: BLUE_LINE })
      this.drawLines(label.lines, MX + 10, this.y - 5.5, this.f.s, 8.5, MUTED, 12)
      this.drawLines(value.lines, MX + lw + 12, this.y - 5.5, row.mono ? this.f.m : this.f.r, row.mono ? 8 : 9.5, INK, row.mono ? 11 : 13.5)
      this.note(this.san.clean(row.label))
      this.note(this.san.clean(row.value === "" ? "—" : row.value))
      this.y -= h
      alt = !alt
    }
    this.y -= 12
  }

  /** A titled group of fields on a two-column grid (long values take the full width). Kept together on one page when it fits. */
  entryCard(title: string, subtitle: string, fields: Array<{ label: string; value: string }>) {
    const pad = 12
    const colW = (CW - 2 * pad - 14) / 2
    type Cell = { label: string; value: string; full: boolean }
    const cells: Cell[] = fields.map((f) => ({ ...f, full: this.san.clean(f.value).length > 44 || this.san.clean(f.value).includes("\n") }))
    const rows: Cell[][] = []
    let pending: Cell | null = null
    for (const c of cells) {
      if (c.full) {
        if (pending) rows.push([pending]), (pending = null)
        rows.push([c])
      } else if (pending) {
        rows.push([pending, c])
        pending = null
      } else pending = c
    }
    if (pending) rows.push([pending])
    const measureRow = (row: Cell[]) => {
      const heights = row.map((c) => {
        const width = c.full ? CW - 2 * pad : colW
        return 4 + this.measure(c.label, this.f.s, 7, width, 9).height + this.measure(c.value === "" ? "—" : c.value, this.f.r, 9.5, width, 13).height
      })
      return Math.max(...heights) + 3
    }
    const rowHeights = rows.map(measureRow)
    const headerH = 27
    const total = headerH + rowHeights.reduce((a, b) => a + b, 0) + 6
    const fits = total <= H - TOP - BOTTOM
    if (fits) this.need(total)
    const drawHeader = (cont: boolean) => {
      this.rect(MX, this.y, CW, headerH, BLUE_SOFT, BLUE_LINE)
      this.page.drawRectangle({ x: MX, y: this.y - headerH, width: 4, height: headerH, color: BLUE })
      const t = this.san.clean(title) + (cont ? " (continued)" : "")
      this.page.drawText(t, { x: MX + 14, y: this.y - 12, size: 10.5, font: this.f.b, color: NAVY })
      if (subtitle) this.page.drawText(this.san.clean(subtitle), { x: MX + 14, y: this.y - 23, size: 8, font: this.f.r, color: MUTED })
      this.note(this.san.clean(title))
      if (subtitle) this.note(this.san.clean(subtitle))
      this.y -= headerH
    }
    this.need(headerH + (rowHeights[0] ?? 0) + 6)
    drawHeader(false)
    rows.forEach((row, i) => {
      const h = rowHeights[i]
      if (this.y - h < BOTTOM) {
        this.newPage()
        drawHeader(true)
      }
      this.page.drawLine({ start: { x: MX, y: this.y }, end: { x: MX, y: this.y - h }, thickness: 0.6, color: BLUE_LINE })
      this.page.drawLine({ start: { x: W - MX, y: this.y }, end: { x: W - MX, y: this.y - h }, thickness: 0.6, color: BLUE_LINE })
      row.forEach((c, k) => {
        const x = MX + pad + (c.full ? 0 : k * (colW + 14))
        const width = c.full ? CW - 2 * pad : colW
        const label = this.san.clean(c.label)
        const lab = this.measure(c.label, this.f.s, 7, width, 9)
        this.drawLines(lab.lines, x, this.y - 5, this.f.s, 7, MUTED, 9)
        const v = this.measure(c.value === "" ? "—" : c.value, this.f.r, 9.5, width, 13)
        this.drawLines(v.lines, x, this.y - 7 - lab.height, this.f.r, 9.5, INK, 13)
        this.note(label)
        this.note(this.san.clean(c.value === "" ? "—" : c.value))
      })
      this.y -= h
    })
    this.page.drawLine({ start: { x: MX, y: this.y - 2 }, end: { x: W - MX, y: this.y - 2 }, thickness: 0.6, color: BLUE_LINE })
    this.y -= 11
  }

  /** A table with a repeating header row. */
  table(columns: Array<{ title: string; width: number }>, rows: string[][]) {
    const widths = columns.map((c) => c.width * CW)
    const drawHead = () => {
      this.need(24 + 24)
      this.rect(MX, this.y, CW, 20, NAVY)
      let x = MX
      columns.forEach((c, i) => {
        this.page.drawText(this.san.clean(c.title), { x: x + 8, y: this.y - 13.5, size: 8, font: this.f.s, color: WHITE })
        this.note(this.san.clean(c.title))
        x += widths[i]
      })
      this.y -= 20
    }
    drawHead()
    rows.forEach((row, ri) => {
      const cells = row.map((v, i) => this.measure(v === "" ? "—" : v, this.f.r, 9, widths[i] - 16, 12.5))
      const h = Math.max(...cells.map((c) => c.height)) + 10
      if (this.y - h < BOTTOM) {
        this.newPage()
        drawHead()
      }
      this.rect(MX, this.y, CW, h, ri % 2 ? ROW_A : WHITE)
      this.page.drawLine({ start: { x: MX, y: this.y - h }, end: { x: W - MX, y: this.y - h }, thickness: 0.5, color: BLUE_LINE })
      let x = MX
      cells.forEach((c, i) => {
        this.drawLines(c.lines, x + 8, this.y - 5, this.f.r, 9, INK, 12.5)
        this.note(this.san.clean(row[i] === "" ? "—" : row[i]))
        x += widths[i]
      })
      this.y -= h
    })
    this.y -= 12
  }

  banner(text: string, tone: Tone) {
    const size = 9
    const m = this.measure(text, this.f.s, size, CW - 24, size * 1.4)
    const h = m.height + 14
    this.need(h + 6)
    this.rect(MX, this.y, CW, h, tone === "warn" ? AMBER_BG : BLUE_SOFT, tone === "warn" ? AMBER_LINE : BLUE_LINE)
    this.page.drawRectangle({ x: MX, y: this.y - h, width: 4, height: h, color: tone === "warn" ? AMBER_LINE : BLUE })
    this.drawLines(m.lines, MX + 16, this.y - 7, this.f.s, size, tone === "warn" ? AMBER : NAVY, size * 1.4)
    this.note(this.san.clean(text))
    this.y -= h + 10
  }

  /** Long text (legal wording) in a panel that continues across pages without losing a line. */
  textPanel(text: string, o: { size?: number; title?: string } = {}) {
    const size = o.size ?? 9.5
    const lh = size * 1.5
    const clean = this.san.clean(text)
    const lines = this.wrap(clean, this.f.r, size, CW - 32)
    let i = 0
    while (i < lines.length) {
      this.need(lh * 3 + 16)
      const fit = Math.max(3, Math.floor((this.y - BOTTOM - 16) / lh))
      const chunk = lines.slice(i, i + fit)
      const h = chunk.length * lh + 16
      this.rect(MX, this.y, CW, h, WHITE, BLUE_LINE)
      this.page.drawRectangle({ x: MX, y: this.y - h, width: 4, height: h, color: BLUE })
      this.drawLines(chunk, MX + 18, this.y - 8, this.f.r, size, INK, lh)
      this.note(chunk.filter(Boolean).join(" "))
      this.y -= h
      i += chunk.length
      if (i < lines.length) this.newPage()
    }
    this.y -= 12
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------------------------------------------------------------------

const optionLabel = (options: Array<{ value: string; label: string }> | undefined, v: unknown) => options?.find((o) => o.value === v)?.label ?? String(v)

function displayValue(field: PlanField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(not provided)"
  if (field.type === "yesno") return value === "yes" ? "Yes" : value === "no" ? "No" : String(value)
  if (field.type === "multiselect" && Array.isArray(value)) return value.map((v) => optionLabel(field.options, v)).join(", ")
  if (field.type === "select") return optionLabel(field.options, value)
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

function masked(field: PlanField, text: string): string {
  const mode = field.pdf.mask ?? (field.sensitivity === "RESTRICTED" ? "EXCLUDE" : "NONE")
  if (mode === "EXCLUDE") return "(not shown in this document)"
  if (mode === "LAST4") return text.length <= 4 ? "****" : `${"*".repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`
  return text
}

function itemDisplay(item: NonNullable<PlanField["itemFields"]>[number], raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return ""
  if (item.type === "yesno") return raw === "yes" ? "Yes" : raw === "no" ? "No" : String(raw)
  return item.options?.find((o) => o.value === raw)?.label ?? String(raw)
}

const stageLabel = (s: string) => (s === "PRE_OFFER" ? "Initial application" : s === "CONDITIONAL_OFFER" ? "Conditional-offer supplement" : "Post-offer supplement")
const scopeLabel = (c: ApplicationPlan["context"]) => {
  const label = (SCOPE_LABEL as Record<string, string>)[c.scopeKind] ?? c.scopeKind.replace(/_/g, " ").toLowerCase()
  return `${label}${c.involvesUS && c.involvesCA ? " — United States and Canada" : c.involvesUS ? " — United States" : c.involvesCA ? " — Canada" : ""}`
}
const fmtUtc = (iso: string) => {
  const d = new Date(iso)
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------------------------------------------------

async function build(input: PdfInput, contentsPages: Map<string, number> | null): Promise<{ L: Layout; render: PdfRender }> {
  const submitted = new Date(input.submittedAt)
  const L = new Layout()
  await L.init({ title: `Driver application ${input.receiptId}`, subject: `${input.companyName} - ${input.applicantName}`, date: submitted, logo: input.logoPng })
  const { plan, snapshot } = input
  const fieldById = new Map(plan.fields.map((f) => [f.id, f]))
  const company = L.san.clean(input.companyName)
  const applicant = L.san.clean(input.applicantName)

  // ---- Cover -------------------------------------------------------------------------------------------------------------------------------
  L.newPage()
  const cover = L.page
  const bandH = 262
  cover.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: NAVY })
  cover.drawRectangle({ x: 0, y: H - bandH, width: W, height: 5, color: BLUE })
  // A restrained, geography-neutral road in perspective (vector only).
  const vx = W * 0.72
  const vy = H - 135
  const road = (x1: number, x2: number, o: number) => {
    cover.drawSvgPath(`M ${vx - 4} ${H - vy} L ${vx + 4} ${H - vy} L ${x2} ${H - (H - bandH + 5)} L ${x1} ${H - (H - bandH + 5)} Z`, { x: 0, y: H, color: WHITE, opacity: o, borderWidth: 0 })
  }
  road(W * 0.30, W * 0.98, 0.07)
  for (const [a, o] of [[W * 0.46, 0.18], [W * 0.64, 0.18]] as const) cover.drawLine({ start: { x: vx, y: vy }, end: { x: a + 90, y: H - bandH + 5 }, thickness: 1, color: WHITE, opacity: o })
  for (let i = 0; i < 6; i += 1) {
    const t0 = 0.12 + i * 0.16
    const t1 = t0 + 0.07
    const px = (t: number) => vx + (W * 0.55 + 90 - vx) * t
    const py = (t: number) => vy + (H - bandH + 5 - vy) * t
    cover.drawLine({ start: { x: px(t0), y: py(t0) }, end: { x: px(t1), y: py(t1) }, thickness: 1 + i * 0.6, color: WHITE, opacity: 0.5 })
  }
  if (L.logo) {
    const lh = 40
    const lw = (L.logo.width / L.logo.height) * lh
    cover.drawRectangle({ x: MX, y: H - 40 - lh - 16, width: lw + 28, height: lh + 20, color: WHITE })
    cover.drawImage(L.logo, { x: MX + 14, y: H - 40 - lh - 6, width: lw, height: lh })
  } else {
    cover.drawText("TES", { x: MX, y: H - 70, size: 26, font: L.f.b, color: WHITE })
  }
  cover.drawText("DRIVER APPLICATION", { x: MX, y: H - 150, size: 11, font: L.f.s, color: rgb(0.65, 0.78, 1) })
  const title = L.measure(company, L.f.b, 25, 330, 29)
  L.drawLines(title.lines, MX, H - 160, L.f.b, 25, WHITE, 29)
  L.note("DRIVER APPLICATION")
  L.note(company)
  const sub = L.measure(applicant, L.f.r, 13, 330, 18)
  L.drawLines(sub.lines, MX, H - 160 - title.height - 8, L.f.r, 13, rgb(0.85, 0.91, 1), 18)
  L.note(applicant)
  L.y = H - bandH - 20
  // Status
  L.chip("APPLICANT-DECLARED", MX, L.y, "navy")
  L.chip("NOT YET VERIFIED", MX + 120, L.y, "warn")
  L.y -= 26
  L.kvCard([
    { label: "Applicant", value: applicant },
    { label: "Hiring carrier", value: company },
    { label: "Receipt number", value: input.receiptId },
    { label: "Received", value: fmtUtc(input.submittedAt) },
    { label: "Application", value: stageLabel(snapshot.collectionStage) },
    { label: "Operating scope", value: scopeLabel(plan.context) },
  ])
  L.paragraph("This document records what the applicant declared and signed. Nothing in it has been verified by the carrier or by TES, and receipt of an application is not a hiring decision. Verification and qualification are performed and recorded separately by the carrier.", { size: 9, color: MUTED, gap: 8 })
  // Contents (page numbers come from the first pass)
  L.y -= 4
  L.page.drawText("CONTENTS", { x: MX, y: L.y - 9, size: 8.5, font: L.f.b, color: BLUE })
  L.y -= 20

  const sections = plan.sections.slice().sort((a, b) => a.order - b.order)
  const present = sections.filter((s) => snapshot.fields.some((f) => f.section === s.id) || snapshot.uploads.some((u) => fieldById.get(u.fieldId)?.section === s.id) || [...snapshot.sensitive, ...snapshot.sensitiveNotCollected].some((x) => fieldById.get(x.fieldId)?.section === s.id))
  const tocTitles = ["Verification status", ...present.map((s) => s.title), ...(input.consents.length ? ["Authorizations and signatures"] : []), "Open review items and limitations", "Evidence and integrity"]
  for (const t of tocTitles) {
    const clean = L.san.clean(t)
    const pg = contentsPages?.get(clean)
    L.page.drawText(clean, { x: MX + 8, y: L.y - 9, size: 9.5, font: L.f.r, color: INK })
    if (pg) {
      const label = String(pg)
      L.page.drawText(label, { x: W - MX - L.f.s.widthOfTextAtSize(label, 9.5), y: L.y - 9, size: 9.5, font: L.f.s, color: NAVY })
    }
    L.page.drawLine({ start: { x: MX + 8, y: L.y - 13 }, end: { x: W - MX, y: L.y - 13 }, thickness: 0.4, color: BLUE_LINE })
    L.note(clean)
    L.y -= 15.5
  }

  // ---- Verification status ------------------------------------------------------------------------------------------------------------------
  L.newPage()
  let n = 1
  L.sectionHeader("Verification status", { number: n++, follow: 120 })
  L.paragraph("Every requirement below is open. Each will be marked verified only when the carrier records it as verified, with supporting evidence.", { size: 9, color: MUTED, gap: 4 })
  L.table(
    [{ title: "Requirement", width: 0.62 }, { title: "Status", width: 0.2 }, { title: "Required", width: 0.18 }],
    plan.requirements.map((r) => [r.title, "Pending", r.requiredForQualification ? "Yes" : "No"]),
  )

  // ---- Answer sections ----------------------------------------------------------------------------------------------------------------------
  for (const section of present) {
    const rows = snapshot.fields.filter((f) => f.section === section.id)
    const uploads = snapshot.uploads.filter((u) => fieldById.get(u.fieldId)?.section === section.id && u.fieldId !== "system.application_pdf")
    const sens = [...snapshot.sensitive.map((x) => ({ ...x, kind: "collected" as const })), ...snapshot.sensitiveNotCollected.map((x) => ({ fieldId: x.fieldId, collected: false, kind: "off" as const }))].filter((x) => fieldById.get(x.fieldId)?.section === section.id)
    L.sectionHeader(section.title, { number: n++, intro: section.intro, follow: 175 })
    const simple: Array<{ label: string; value: string }> = []
    const flush = () => {
      if (simple.length) L.kvCard(simple.splice(0))
    }
    for (const row of rows) {
      const field = fieldById.get(row.id)
      if (!field) continue
      if (field.type === "repeatable") {
        flush()
        const label = L.san.clean(field.pdf.label ?? field.label)
        L.subheading(label, field.id === "address.history" ? 120 : 240)
        const entries = Array.isArray(row.value) ? (row.value as Array<Record<string, unknown>>) : []
        if (entries.length === 0) L.paragraph("None entered.", { size: 9, color: MUTED, gap: 6 })
        const items = field.itemFields ?? []
        if (field.id === "address.history") {
          L.table(
            [{ title: "Address", width: 0.58 }, { title: "From", width: 0.21 }, { title: "Until", width: 0.21 }],
            entries.map((e) => {
              const get = (id: string) => itemDisplay(items.find((i) => i.id === id)!, e[id])
              const addr = [get("street"), [get("city"), get("region")].filter(Boolean).join(", "), get("postal"), get("country")].filter(Boolean).join("\n")
              return [addr, get("from"), get("to") || "Present"]
            }),
          )
        } else {
          entries.forEach((e, i) => {
            const titleKey = items.find((it) => ["employer", "course", "school", "name"].includes(it.id)) ?? items[0]
            const heading = `${label.replace(/s$/i, "")} ${i + 1}${titleKey && e[titleKey.id] ? ` — ${itemDisplay(titleKey, e[titleKey.id])}` : ""}`
            const from = items.find((it) => it.id === "from")
            const to = items.find((it) => it.id === "to")
            const dates = from && e.from ? `${itemDisplay(from, e.from)} to ${to && e.to ? itemDisplay(to, e.to) : "present"}` : ""
            const fields = items.filter((it) => it !== titleKey && it.id !== "from" && it.id !== "to").map((it) => ({ label: it.label, value: itemDisplay(it, e[it.id]) })).filter((f) => f.value !== "")
            L.entryCard(heading, dates, fields)
          })
        }
        continue
      }
      if (field.pdf.mask === "EXCLUDE") {
        simple.push({ label: field.pdf.label ?? field.label, value: "(not shown in this document)" })
        continue
      }
      simple.push({ label: field.pdf.label ?? field.label, value: masked(field, displayValue(field, row.value)) })
    }
    flush()
    if (uploads.length || sens.length) {
      L.subheading("Supporting documents and restricted information", 70)
      L.kvCard([
        ...uploads.map((u) => ({ label: fieldById.get(u.fieldId)?.label ?? u.fieldId, value: `${u.filename} (${u.byteSize} bytes)\nEvidence document ${u.documentId}` })),
        ...sens.map((s) => ({ label: fieldById.get(s.fieldId)?.label ?? s.fieldId, value: s.kind === "collected" ? (s.collected ? "Collected securely (value not shown)" : "Not provided") : "Not collected on this application" })),
      ])
    }
  }
  if (snapshot.retainedNotApplicable.length) {
    L.paragraph(`${snapshot.retainedNotApplicable.length} earlier answer(s) were kept in the record but did not apply after later answers; they are not current statements of the applicant.`, { size: 8.5, color: MUTED, gap: 6 })
  }

  // ---- Authorizations: each on its own page(s) ------------------------------------------------------------------------------------------------
  const byKey = new Map<string, PlanConsent>(plan.consents.map((c) => [c.key, c]))
  const accepted = input.consents.slice().sort((a, b) => a.key.localeCompare(b.key))
  let firstAuth = true
  for (const c of accepted) {
    const def = byKey.get(c.key)
    if (!def) continue
    // Each authorization is its own block, kept whole on a page when it fits; a long one starts on a fresh page and flows.
    const textLines = L.measure(def.text, L.f.r, 9.5, CW - 32, 14.25).lines.length
    const estimate = 40 + (c.legalStatus !== "APPROVED" ? 52 : 0) + 150 + textLines * 14.25 + 24 + 100
    const room = L.y - BOTTOM
    if (firstAuth) {
      if (estimate + 70 > room) L.newPage()
      L.sectionHeader("Authorizations and signatures", { number: n++, follow: 200 })
      L.paragraph("Each authorization is separate, has its own stated purpose, and was read in full before it was signed.", { size: 9, color: MUTED, gap: 8 })
      firstAuth = false
    } else if (estimate > room) L.newPage()
    else L.y -= 6
    L.paragraph(def.title, { font: L.f.b, size: 13, color: NAVY, gap: 6 })
    if (c.legalStatus !== "APPROVED") L.banner("PENDING LEGAL REVIEW — this wording has not been approved by counsel. It is recorded as presented and signed, and must not be relied on until approved.", "warn")
    L.kvCard([
      { label: "Authorization", value: `${def.key} · version ${c.version}` },
      { label: "Purpose", value: c.purpose },
      { label: "Authorized parties", value: def.authorizedParties.join(", ") },
      { label: "Scope", value: Object.entries(def.scope).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("; ") },
      { label: "Jurisdiction", value: c.jurisdiction ?? "—" },
      { label: "Wording SHA-256", value: c.textSha256, mono: true },
    ])
    L.paragraph("Text presented to the applicant", { font: L.f.s, size: 10, color: NAVY, gap: 4 })
    L.textPanel(def.text)
    // Signature block is kept whole.
    L.need(112)
    L.paragraph("Signature", { font: L.f.s, size: 10, color: NAVY, gap: 4 })
    L.need(84)
    L.rect(MX, L.y, CW, 84, BLUE_SOFT, BLUE_LINE)
    const sig = L.san.clean(c.signatureName)
    L.page.drawText(sig, { x: MX + 16, y: L.y - 34, size: 19, font: L.f.b, color: NAVY })
    L.note(sig)
    L.page.drawLine({ start: { x: MX + 16, y: L.y - 42 }, end: { x: MX + 330, y: L.y - 42 }, thickness: 0.8, color: NAVY })
    L.page.drawText("Typed signature of the applicant", { x: MX + 16, y: L.y - 54, size: 7.5, font: L.f.r, color: MUTED })
    L.page.drawText(`Signed ${fmtUtc(c.acceptedAt)}`, { x: MX + 16, y: L.y - 68, size: 9, font: L.f.s, color: INK })
    L.page.drawText("Affirmative acceptance: checkbox with typed signature", { x: MX + 16, y: L.y - 79, size: 8, font: L.f.r, color: MUTED })
    L.note(`Signed ${fmtUtc(c.acceptedAt)}`)
    L.note("Affirmative acceptance: checkbox with typed signature")
    L.y -= 96
  }

  const externals = snapshot.externalProcesses.map((e) => byKey.get(e.key)).filter((c): c is PlanConsent => Boolean(c))
  if (externals.length) {
    L.sectionHeader("Authorizations completed outside this application", { follow: 100 })
    for (const c of externals) {
      L.paragraph(c.title, { font: L.f.s, size: 10.5, color: NAVY, gap: 2 })
      L.paragraph("This is completed through a separate, official or standalone process. This application does not capture or replace it.", { size: 9, color: MUTED, gap: 8 })
    }
  }

  // ---- Review items and limitations ---------------------------------------------------------------------------------------------------------
  L.newPage()
  L.sectionHeader("Open review items and limitations", { number: n++, follow: 120 })
  if (plan.regulatoryReviewRequirements.length === 0) L.paragraph("None recorded.", { gap: 6 })
  for (const r of plan.regulatoryReviewRequirements) L.paragraph(`•  ${r.text}`, { x: MX + 6, width: CW - 6, gap: 3 })
  L.y -= 6
  L.subheading("Limitations", 70)
  for (const l of plan.limitations) L.paragraph(`•  ${l}`, { x: MX + 6, width: CW - 6, gap: 3 })
  L.y -= 6
  L.subheading("Legal sources referenced (none verified by counsel)", 70)
  for (const [key, s] of Object.entries(plan.legalSources).sort(([a], [b]) => a.localeCompare(b))) L.paragraph(`•  ${s.citation} [${key}] — ${s.verification}`, { x: MX + 6, width: CW - 6, size: 8.5, gap: 2 })

  // ---- Evidence and integrity ---------------------------------------------------------------------------------------------------------------
  L.newPage()
  L.sectionHeader("Evidence and integrity", { number: n++, follow: 160 })
  L.paragraph("Technical provenance for record-keeping and audit. The application SHA-256 is the SHA-256 of the canonical JSON (keys sorted, no whitespace) of the stored application snapshot and can be recomputed independently.", { size: 9, color: MUTED, gap: 6 })
  L.kvCard([
    { label: "Receipt number", value: input.receiptId, mono: true },
    ...(input.applicationId ? [{ label: "Application id", value: input.applicationId, mono: true }] : []),
    { label: "Catalogue version", value: plan.catalogueVersion },
    { label: "Rules / scope-rules version", value: `${plan.rulesVersion} / ${plan.scopeRulesVersion}` },
    { label: "Plan SHA-256", value: input.planSha256, mono: true },
    { label: "Application SHA-256", value: input.snapshotSha256, mono: true },
    { label: "Received (UTC)", value: fmtUtc(input.submittedAt) },
    { label: "Document generator", value: PDF_GENERATOR_VERSION },
  ])
  if (accepted.length) {
    L.subheading("Signed authorizations", 80)
    L.table(
      [{ title: "Authorization", width: 0.3 }, { title: "Status", width: 0.22 }, { title: "Wording SHA-256", width: 0.48 }],
      accepted.map((c) => [`${c.key} v${c.version}`, c.legalStatus === "APPROVED" ? "Approved" : "Pending legal review", c.textSha256]),
    )
  }
  const docs = snapshot.uploads.filter((u) => u.fieldId !== "system.application_pdf")
  if (docs.length) {
    L.subheading("Supporting documents (evidence references)", 80)
    L.table(
      [{ title: "Document", width: 0.36 }, { title: "File", width: 0.24 }, { title: "Evidence document id", width: 0.4 }],
      docs.map((u) => [fieldById.get(u.fieldId)?.label ?? u.fieldId, `${u.filename}\n${u.byteSize} bytes`, u.documentId]),
    )
  }
  L.subheading("Verification limitations", 70)
  L.paragraph("Every item in this document is applicant-declared. No identity, licence, medical, employment, driving-record, background or eligibility check has been performed by this document. Authorization wording marked pending legal review has not been approved and must not be relied on.", { size: 9, gap: 6 })
  if (L.san.unsupported > 0) L.paragraph(`${L.san.unsupported} character(s) could not be drawn with the document font and appear as the replacement mark (${REPLACEMENT}). The stored application snapshot holds the exact text as submitted.`, { size: 8.5, color: MUTED, gap: 4 })

  // ---- Running header and footer ------------------------------------------------------------------------------------------------------------
  const total = L.pages.length
  L.pages.forEach((page, i) => {
    if (i > 0) {
      if (L.logo) {
        const lh = 20
        page.drawImage(L.logo, { x: MX, y: H - 44, width: (L.logo.width / L.logo.height) * lh, height: lh })
      }
      const head = L.san.clean(`${input.companyName}  ·  Driver application  ·  ${input.applicantName}`)
      const shown = head.length > 80 ? `${head.slice(0, 79)}…` : head
      page.drawText(shown, { x: W - MX - L.f.r.widthOfTextAtSize(shown, 8), y: H - 38, size: 8, font: L.f.r, color: MUTED })
      page.drawLine({ start: { x: MX, y: H - 52 }, end: { x: W - MX, y: H - 52 }, thickness: 0.8, color: BLUE })
    }
    page.drawLine({ start: { x: MX, y: 44 }, end: { x: W - MX, y: 44 }, thickness: 0.5, color: BLUE_LINE })
    const left = L.san.clean(`Receipt ${input.receiptId}  ·  Applicant-declared, not verified`)
    page.drawText(left, { x: MX, y: 30, size: 7.5, font: L.f.r, color: MUTED })
    const right = `Page ${i + 1} of ${total}`
    page.drawText(right, { x: W - MX - L.f.s.widthOfTextAtSize(right, 8), y: 30, size: 8, font: L.f.s, color: NAVY })
    L.manifest[i].push(right)
  })

  const bytes = await L.doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
  return { L, render: { bytes, pageCount: total, pages: L.manifest, unsupportedCharacters: L.san.unsupported } }
}

export async function renderApplicationPdfDetailed(input: PdfInput): Promise<PdfRender> {
  // Pass 1 finds which page each section lands on (the contents list is on the cover); pass 2 prints it. Both passes lay out identically.
  const first = await build(input, null)
  const map = new Map<string, number>(first.L.contents.map((c) => [c.title, c.page]))
  const second = await build(input, map)
  return second.render
}

export async function renderApplicationPdf(input: PdfInput): Promise<Uint8Array> {
  return (await renderApplicationPdfDetailed(input)).bytes
}

/** Kept for callers that only need the text a given font set can draw. */
export function pdfSafe(text: string, supported?: Set<number>): string {
  const set = supported ?? new Set(Array.from({ length: 0x250 }, (_, i) => i))
  return new Sanitizer(set).clean(text)
}
