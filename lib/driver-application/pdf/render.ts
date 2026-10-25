import { readFile } from "node:fs/promises"
import { join } from "node:path"
import fontkit from "@pdf-lib/fontkit"
import { LineCapStyle, PDFDocument, PDFImage, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib"
import type { ApplicationPlan, PlanConsent, PlanField } from "../plan"
import type { ApplicationSnapshot } from "../snapshot"
import { SCOPE_LABEL } from "@/lib/driver-prospects/operating-scope"
import { ICONS, type IconName } from "./icons"
import { HIRING_STAGES, requirementsAttention, stageOfRequirement, type Attention } from "../hiring-stages"
import { TextEngine, type Weight } from "./text"

/**
 * Deterministic application PDF ("modern card layout", art-directed).
 *
 * The same snapshot, plan, consent and review records always produce the same bytes: no clock, no random ids, fixed metadata dates (the submission time),
 * embedded Inter fonts with a fixed name, no object streams. Two documents come from one canonical record:
 *   - the APPLICANT copy: the applicant's declarations, authorizations and signatures, nothing verified;
 *   - the CARRIER dossier: the same original application, unchanged, followed by a separately identified carrier review (verification results,
 *     qualification decision, evidence references and audit provenance). The review never alters or restates what the applicant declared.
 * Pagination is dynamic: panels, timelines and cards break across pages with repeated headers, headings are never orphaned and nothing is clipped.
 */

export const PDF_GENERATOR_VERSION = "tes-driver-application-pdf/3"

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

/** The carrier's review of a submitted application. Supplied only to callers permitted to see it; restricted items arrive flagged and without detail. */
export interface PdfReview {
  decision: { status: string; decidedAt: string | null; decidedBy: string | null; rationale: string | null } | null
  checks: Array<{
    title: string
    /** Requirement type (IDENTITY, LICENCE, MEDICAL, …); places the check in its hiring-process stage. */
    type: string
    required: boolean
    status: string
    note: string | null
    recordedAt: string | null
    recordedBy: string | null
    evidenceDocumentId: string | null
  }>
  /** Every recorded decision, oldest first (the last is the current one). */
  decisions?: Array<{ status: string; decidedAt: string | null; decidedBy: string | null; rationale: string | null }>
  /** Why the qualification gate is not yet satisfied (empty when every required check is verified). */
  blockers?: string[]
  corrections?: Array<{ fieldId: string; label: string; previous: string; corrected: string; reason: string; recordedAt: string; recordedBy: string }>
  evidence: Array<{ documentId: string; label: string; filename: string | null; byteSize: number | null; sha256: string | null; restricted: boolean; state?: string | null }>
  audit: Array<{ at: string; actor: string; event: string; detail: string | null }>
  preparedAt: string
  preparedBy: string
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
  /** "applicant" (default): the applicant's copy. "carrier": the dossier, which also carries `review`. */
  audience?: "applicant" | "carrier"
  review?: PdfReview | null
}

export interface PdfRender {
  bytes: Uint8Array
  pageCount: number
  /** Every logical string drawn, per page, after font sanitising (not wrapped). Used to prove the PDF carries the whole snapshot. */
  pages: string[][]
  /** Characters that no embedded font can draw (shown as the replacement mark); the stored snapshot keeps the exact text. */
  unsupportedCharacters: number
  /** Number of text runs drawn as vector outlines (complex scripts); those are not selectable or extractable. */
  vectorRuns: number
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Fonts and tokens
// ---------------------------------------------------------------------------------------------------------------------------------------

const FONT_DIR = join(process.cwd(), "lib", "driver-application", "pdf", "fonts")
let fontBytes: Promise<{ regular: Buffer; semibold: Buffer; bold: Buffer }> | null = null
const loadFontBytes = () =>
  (fontBytes ??= Promise.all([readFile(join(FONT_DIR, "Inter-Regular.ttf")), readFile(join(FONT_DIR, "Inter-SemiBold.ttf")), readFile(join(FONT_DIR, "Inter-Bold.ttf"))]).then(([regular, semibold, bold]) => ({ regular, semibold, bold })))

const W = 612
const H = 792
const MX = 48
const CW = W - 2 * MX
const TOP = 80
const BOTTOM = 62
const PAGE_CAP = H - TOP - BOTTOM

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const NAVY = hex("#0B1F44")
const NAVY_2 = hex("#12306A")
const BLUE = hex("#1D4ED8")
const BLUE_SOFT = hex("#EAF2FF")
const BLUE_LINE = hex("#D2DFF3")
const BLUE_MID = hex("#9DB8E8")
const INK = hex("#0F172A")
const MUTED = hex("#56657D")
const PAPER = hex("#F6F9FE")
const WHITE = hex("#FFFFFF")
const AMBER_BG = hex("#FFF6CC")
const AMBER_LINE = hex("#D9B72B")
const AMBER = hex("#5A4400")
const GREEN_BG = hex("#E8F8EF")
const GREEN_LINE = hex("#7BC9A0")
const GREEN = hex("#0B6B3A")
const RED_BG = hex("#FDECEC")
const RED_LINE = hex("#E49A9A")
const RED = hex("#9B1C1C")
const GRAY_BG = hex("#EEF1F6")
const GRAY_LINE = hex("#C5CEDC")

type Tone = "info" | "warn" | "ok" | "bad" | "neutral" | "navy" | "blue"
const TONES: Record<Tone, { bg: RGB; line: RGB | null; fg: RGB }> = {
  info: { bg: BLUE_SOFT, line: BLUE_LINE, fg: NAVY },
  warn: { bg: AMBER_BG, line: AMBER_LINE, fg: AMBER },
  ok: { bg: GREEN_BG, line: GREEN_LINE, fg: GREEN },
  bad: { bg: RED_BG, line: RED_LINE, fg: RED },
  neutral: { bg: GRAY_BG, line: GRAY_LINE, fg: MUTED },
  navy: { bg: NAVY, line: null, fg: WHITE },
  blue: { bg: BLUE, line: null, fg: WHITE },
}

const SECTION_ICON: Record<string, IconName> = {
  identity: "user",
  address: "mapPin",
  licence: "idCard",
  experience: "truck",
  employment: "briefcase",
  eligibility: "clipboard",
  documents: "paperclip",
  authorizations: "penLine",
}
const sectionIcon = (id: string): IconName => SECTION_ICON[id] ?? "fileText"

// ---------------------------------------------------------------------------------------------------------------------------------------
// Layout engine
// ---------------------------------------------------------------------------------------------------------------------------------------

interface Unit {
  h: number
  draw: (x: number, yTop: number, w: number) => void
  /** Must stay on the same page as the unit after it. */
  keep?: boolean
  /** Continues the unit above (long text split into pieces): no divider is drawn between them. */
  cont?: boolean
}

interface PanelSpec {
  kicker?: string
  title?: string
  icon?: IconName
  chip?: { text: string; tone: Tone }
  theme?: "light" | "dark" | "amber" | "plain"
  accent?: RGB
  inset?: number
  /** Allow the panel to start mid-page and flow even when it would fit whole on a fresh page. */
  flow?: boolean
  onChunk?: (c: { top: number; bottom: number; first: boolean; last: boolean }) => void
}

interface Field {
  label: string
  value: string
  yn?: boolean
  mono?: boolean
}

class Layout {
  doc!: PDFDocument
  t!: TextEngine
  logo: PDFImage | null = null
  page!: PDFPage
  pages: PDFPage[] = []
  manifest: string[][] = []
  y = 0
  contents: Array<{ title: string; page: number }> = []
  private cleaned = new Map<string, string>()

  async init(meta: { title: string; subject: string; date: Date; logo?: Uint8Array | null; scanText: string }) {
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
    this.t = new TextEngine({ r, s, b }, m)
    await this.t.prepare(meta.scanText)
    if (meta.logo) this.logo = await this.doc.embedPng(meta.logo).catch(() => null)
  }

  /** Cleans once per distinct string so the unsupported-character count is not inflated by measuring and drawing the same text. */
  clean(text: string): string {
    const key = String(text ?? "")
    let hit = this.cleaned.get(key)
    if (hit === undefined) {
      hit = this.t.clean(key)
      this.cleaned.set(key, hit)
    }
    return hit
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
  atTop() {
    return this.y >= H - TOP - 0.5
  }
  need(h: number) {
    if (this.y - h < BOTTOM && !this.atTop()) this.newPage()
  }
  note(text: string) {
    if (text) this.manifest[this.index].push(text)
  }

  // ---- text ---------------------------------------------------------------------------------------------------------------------------
  lines(text: string, weight: Weight, size: number, width: number): string[] {
    return this.t.wrap(this.clean(text), weight, size, width)
  }
  textHeight(text: string, weight: Weight, size: number, width: number, lh = size * 1.4) {
    return Math.max(1, this.lines(text, weight, size, width).length) * lh
  }
  /** Draws pre-wrapped lines; top of the first line at yTop. */
  drawLines(lines: string[], x: number, yTop: number, weight: Weight, size: number, color: RGB, lh = size * 1.4) {
    let y = yTop
    for (const line of lines) {
      if (line) this.t.draw(this.page, line, x, y - (lh - size) / 2 - size * 0.8, weight, size, color, H)
      y -= lh
    }
  }
  /** Wraps, draws and notes text in one go (the caller has made room). Returns the height used. */
  put(text: string, x: number, yTop: number, width: number, weight: Weight, size: number, color: RGB, lh = size * 1.4, align: "left" | "right" | "center" = "left"): number {
    const lines = this.lines(text, weight, size, width)
    if (align === "left") this.drawLines(lines, x, yTop, weight, size, color, lh)
    else {
      let y = yTop
      for (const line of lines) {
        const w = this.t.width(line, weight, size)
        this.t.draw(this.page, line, align === "right" ? x + width - w : x + (width - w) / 2, y - (lh - size) / 2 - size * 0.8, weight, size, color, H)
        y -= lh
      }
    }
    this.note(lines.filter(Boolean).join(" "))
    return Math.max(1, lines.length) * lh
  }
  /** Single line placed by its left edge, with the text baseline derived from the top of a cap-height box. */
  label(text: string, x: number, yTop: number, weight: Weight, size: number, color: RGB) {
    const clean = this.clean(text)
    this.t.draw(this.page, clean, x, yTop - size * 0.82, weight, size, color, H)
    this.note(clean)
    return this.t.width(clean, weight, size)
  }
  width(text: string, weight: Weight, size: number) {
    return this.t.width(this.clean(text), weight, size)
  }

  // ---- shapes -------------------------------------------------------------------------------------------------------------------------
  svg(d: string, o: { fill?: RGB; stroke?: RGB; sw?: number; opacity?: number }) {
    this.page.drawSvgPath(d, {
      x: 0,
      y: H,
      ...(o.fill ? { color: o.fill, opacity: o.opacity ?? 1 } : {}),
      ...(o.stroke ? { borderColor: o.stroke, borderWidth: o.sw ?? 0.8, borderOpacity: o.opacity ?? 1 } : {}),
      ...(!o.fill && !o.stroke ? { color: WHITE, opacity: 0 } : {}),
    })
  }
  /** Rounded rectangle; top-left at (x, yTop) in page coordinates. */
  rr(x: number, yTop: number, w: number, h: number, r: number, fill?: RGB, stroke?: RGB, sw = 0.8, corners: "all" | "top" = "all", opacity = 1) {
    const t = H - yTop
    const b = t + h
    const rb = corners === "all" ? r : 0
    const d = `M ${x + r} ${t} L ${x + w - r} ${t} A ${r} ${r} 0 0 1 ${x + w} ${t + r} L ${x + w} ${b - rb} ${rb ? `A ${rb} ${rb} 0 0 1 ${x + w - rb} ${b}` : ""} L ${x + rb} ${b} ${rb ? `A ${rb} ${rb} 0 0 1 ${x} ${b - rb}` : ""} L ${x} ${t + r} A ${r} ${r} 0 0 1 ${x + r} ${t} Z`
    this.svg(d, { fill, stroke, sw, opacity })
  }
  rect(x: number, yTop: number, w: number, h: number, fill: RGB, opacity = 1) {
    this.page.drawRectangle({ x, y: yTop - h, width: w, height: h, color: fill, opacity })
  }
  hline(x1: number, x2: number, y: number, color = BLUE_LINE, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color })
  }
  circle(cx: number, cy: number, r: number, fill: RGB, stroke?: RGB, sw = 1) {
    this.page.drawCircle({ x: cx, y: cy, size: r, color: fill, ...(stroke ? { borderColor: stroke, borderWidth: sw } : {}) })
  }
  poly(points: Array<[number, number]>, fill: RGB, opacity = 1) {
    this.svg(`M ${points.map(([px, py]) => `${px} ${H - py}`).join(" L ")} Z`, { fill, opacity })
  }
  icon(name: IconName, x: number, yTop: number, size: number, color: RGB, sw = 2) {
    for (const d of ICONS[name]) {
      this.page.drawSvgPath(d, { x, y: yTop, scale: size / 24, borderColor: color, borderWidth: sw, borderLineCap: LineCapStyle.Round })
    }
  }
  /** Icon on a soft rounded tile. */
  iconTile(name: IconName, x: number, yTop: number, size: number, fg: RGB = BLUE, bg: RGB = BLUE_SOFT) {
    this.rr(x, yTop, size, size, size * 0.28, bg)
    const s = size * 0.58
    this.icon(name, x + (size - s) / 2, yTop - (size - s) / 2, s, fg, 2)
  }

  chipWidth(text: string, withIcon = false) {
    return this.width(text, "s", 7.2) + 14 + (withIcon ? 11 : 0)
  }
  chip(text: string, x: number, yTop: number, tone: Tone, icon?: IconName) {
    const clean = this.clean(text)
    const w = this.chipWidth(clean, Boolean(icon))
    const c = TONES[tone]
    this.rr(x, yTop, w, 16, 8, c.bg, c.line ?? undefined, 0.7)
    let tx = x + 7
    if (icon) {
      this.icon(icon, x + 6, yTop - 3.5, 9, c.fg, 2.4)
      tx += 11
    }
    this.t.draw(this.page, clean, tx, yTop - 11.2, "s", 7.2, c.fg, H)
    this.note(clean)
    return w
  }

  // ---- headings -----------------------------------------------------------------------------------------------------------------------
  /** A section heading is never left alone at the bottom of a page: room for it plus `follow` points of content is required. */
  sectionHeader(title: string, o: { number?: number; icon: IconName; follow?: number; intro?: string; dark?: boolean }) {
    const introH = o.intro ? this.textHeight(o.intro, "r", 9, CW, 13) + 8 : 0
    this.need(58 + introH + (o.follow ?? 110))
    const clean = this.clean(title)
    this.contents.push({ title: clean, page: this.index + 1 })
    const top = this.y
    const titleW = CW - 96
    const lines = this.lines(clean, "b", 19, titleW)
    const th = lines.length * 23
    const bandH = Math.max(40, th + 14)
    if (o.dark) {
      this.rr(MX, top, CW, bandH, 9, NAVY)
      if (o.number !== undefined) {
        this.circle(MX + 26, top - bandH / 2, 13, BLUE)
        const n = String(o.number)
        this.t.draw(this.page, n, MX + 26 - this.t.width(n, "b", 11) / 2, top - bandH / 2 - 4, "b", 11, WHITE, H)
      }
      this.drawLines(lines, MX + 50, top - (bandH - th) / 2, "b", 19, WHITE, 23)
      this.note(clean)
      this.icon(o.icon, MX + CW - 36, top - bandH / 2 + 11, 22, BLUE_MID, 1.8)
      this.y = top - bandH - 12
    } else {
      if (o.number !== undefined) {
        this.circle(MX + 15, top - bandH / 2, 15, BLUE)
        const n = String(o.number)
        this.t.draw(this.page, n, MX + 15 - this.t.width(n, "b", 12) / 2, top - bandH / 2 - 4.2, "b", 12, WHITE, H)
      }
      this.drawLines(lines, MX + 40, top - (bandH - th) / 2, "b", 19, NAVY, 23)
      this.note(clean)
      this.iconTile(o.icon, MX + CW - 34, top - (bandH - 34) / 2, 34)
      this.hline(MX, MX + CW, top - bandH - 4, BLUE_LINE, 1)
      this.hline(MX, MX + 64, top - bandH - 4, BLUE, 2.2)
      this.y = top - bandH - 14
    }
    if (o.intro) this.y -= this.put(o.intro, MX, this.y, CW, "r", 9, MUTED, 13) + 8
  }

  /** A numbered stage heading of the hiring process, with its attention state. */
  stageHeader(number: number, title: string, state: { tone: Tone; label: string }) {
    this.need(40 + 120)
    const top = this.y
    this.rr(MX, top, CW, 30, 8, PAPER, BLUE_LINE, 0.8)
    this.circle(MX + 18, top - 15, 10, BLUE)
    const nn = String(number)
    this.t.draw(this.page, nn, MX + 18 - this.t.width(nn, "b", 9.5) / 2, top - 18.4, "b", 9.5, WHITE, H)
    const cw = this.chipWidth(state.label)
    this.label(title, MX + 36, top - 9.5, "b", 10.5, NAVY)
    this.chip(state.label, MX + CW - cw - 10, top - 7, state.tone)
    this.y -= 40
  }

  /** A sub-heading that must stay with the block after it. */
  subheading(text: string, follow = 120, icon?: IconName) {
    this.need(30 + follow)
    const clean = this.clean(text)
    let x = MX
    if (icon) {
      this.icon(icon, MX, this.y - 1, 15, BLUE, 2)
      x += 22
    }
    this.label(clean, x, this.y - 2, "b", 11.5, NAVY)
    this.y -= 22
  }

  paragraph(text: string, o: { size?: number; weight?: Weight; color?: RGB; x?: number; width?: number; gap?: number; lh?: number } = {}) {
    const size = o.size ?? 9.5
    const lh = o.lh ?? size * 1.45
    const lines = this.lines(text, o.weight ?? "r", size, o.width ?? CW)
    if (lines.length <= 6) this.need(lines.length * lh)
    else {
      const fit = Math.floor((this.y - BOTTOM) / lh)
      if (fit < 2) this.newPage()
      else if (lines.length - fit === 1) this.need((lines.length - 1) * lh + 1000)
    }
    let chunk: string[] = []
    for (const line of lines) {
      if (this.y - lh < BOTTOM) {
        this.note(chunk.filter(Boolean).join(" "))
        chunk = []
        this.newPage()
      }
      if (line) this.t.draw(this.page, line, o.x ?? MX, this.y - (lh - size) / 2 - size * 0.8, o.weight ?? "r", size, o.color ?? INK, H)
      chunk.push(line)
      this.y -= lh
    }
    this.note(chunk.filter(Boolean).join(" "))
    this.y -= o.gap ?? 0
  }

  /** An outlined information box with an icon. */
  infoBox(text: string, tone: "info" | "warn" = "info", title?: string) {
    const w = CW - 52
    const tH = title ? 16 : 0
    const bh = this.textHeight(text, "r", 9, w, 13.2)
    const h = bh + tH + 22
    this.need(h + 8)
    const c = TONES[tone]
    this.rr(MX, this.y, CW, h, 8, tone === "warn" ? AMBER_BG : WHITE, tone === "warn" ? AMBER_LINE : BLUE, 1)
    this.iconTile(tone === "warn" ? "alert" : "info", MX + 12, this.y - 12, 28, tone === "warn" ? AMBER : BLUE, tone === "warn" ? hex("#FBE9A0") : BLUE_SOFT)
    if (title) this.label(title, MX + 48, this.y - 11, "b", 10, c.fg)
    this.put(text, MX + 48, this.y - 11 - tH, w, "r", 9, tone === "warn" ? AMBER : INK, 13.2)
    this.y -= h + 12
  }

  // ---- panels -------------------------------------------------------------------------------------------------------------------------
  private headerHeight(spec: PanelSpec, width: number, cont: boolean): number {
    if (!spec.title && !spec.kicker) return 0
    const iconW = spec.icon ? 40 : 14
    const chipW = spec.chip && !cont ? this.chipWidth(spec.chip.text) + 12 : 0
    const tw = Math.max(80, width - iconW - chipW - 14)
    const title = (spec.title ?? "") + (cont ? " (continued)" : "")
    const lines = this.lines(title, "b", cont ? 9.5 : 11, tw).length
    const kick = spec.kicker && !cont ? 11 : 0
    return Math.max(cont ? 26 : 36, 14 + kick + lines * (cont ? 13 : 14.5))
  }

  private drawHeader(spec: PanelSpec, x: number, yTop: number, width: number, h: number, cont: boolean) {
    const dark = spec.theme === "dark"
    const amber = spec.theme === "amber"
    this.rr(x, yTop, width, h, 8, dark ? NAVY : amber ? AMBER_BG : BLUE_SOFT, undefined, 0, "top")
    const fg = dark ? WHITE : amber ? AMBER : NAVY
    let tx = x + 14
    if (spec.icon) {
      const size = cont ? 20 : 26
      if (dark) {
        this.rr(x + 10, yTop - (h - size) / 2, size, size, size * 0.28, NAVY_2)
        this.icon(spec.icon, x + 10 + size * 0.2, yTop - (h - size) / 2 - size * 0.2, size * 0.6, WHITE, 2)
      } else this.iconTile(spec.icon, x + 10, yTop - (h - size) / 2, size, spec.accent ?? (amber ? AMBER : BLUE), amber ? hex("#FBE9A0") : WHITE)
      tx = x + 10 + size + 10
    }
    const chipW = spec.chip && !cont ? this.chipWidth(spec.chip.text) + 12 : 0
    const tw = Math.max(80, x + width - tx - chipW - 14)
    let ty = yTop - 8
    if (spec.kicker && !cont) {
      this.label(spec.kicker, tx, ty, "s", 7, dark ? BLUE_MID : MUTED)
      ty -= 11
    }
    const title = (spec.title ?? "") + (cont ? " (continued)" : "")
    const hl = this.lines(title, "b", cont ? 9.5 : 11, tw)
    this.drawLines(hl, tx, ty, "b", cont ? 9.5 : 11, fg, cont ? 13 : 14.5)
    if (!cont) this.note(hl.filter(Boolean).join(" "))
    if (spec.chip && !cont) this.chip(spec.chip.text, x + width - chipW - 6 + 6 - 0, yTop - (h - 16) / 2, spec.chip.tone)
  }

  /**
   * A card of stacked units. Whole on one page when it fits there (so cards are never split needlessly); otherwise it flows, repeating a compact header
   * on each page. A unit is never split and a heading is never left without content.
   */
  panel(spec: PanelSpec, units: Unit[]) {
    const inset = spec.inset ?? 0
    const x = MX + inset
    const w = CW - inset
    const hdrFull = this.headerHeight(spec, w, false)
    const hdrCont = this.headerHeight(spec, w, true)
    const total = hdrFull + units.reduce((a, u) => a + u.h, 0) + 2
    if (!spec.flow && total <= PAGE_CAP && this.y - total < BOTTOM) this.newPage()
    // A panel too long for one page still starts on a fresh page when little room is left, so its header is never stranded with a row or two.
    else if (total > PAGE_CAP && this.y - BOTTOM < Math.min(300, hdrFull + (units[0]?.h ?? 0) + (units[1]?.h ?? 0) + 120) && !this.atTop()) this.newPage()
    let i = 0
    let first = true
    while (i < units.length) {
      const hdr = first ? hdrFull : hdrCont
      const avail = this.y - BOTTOM - hdr - 2
      let take = 0
      let used = 0
      while (i + take < units.length && used + units[i + take].h <= avail) {
        used += units[i + take].h
        take += 1
      }
      while (take > 1 && units[i + take - 1].keep && i + take < units.length) {
        take -= 1
        used -= units[i + take].h
      }
      if (take === 0) {
        if (!this.atTop()) {
          this.newPage()
          continue
        }
        take = 1
        used = units[i].h
      }
      const boxH = hdr + used + 2
      const top = this.y
      this.rr(x, top, w, boxH, 8, WHITE, BLUE_LINE, 0.9)
      if (hdr) this.drawHeader(spec, x, top, w, hdr, !first)
      let yy = top - hdr
      for (let k = 0; k < take; k += 1) {
        const u = units[i + k]
        if (k > 0 || hdr === 0) {
          if (k > 0 && !u.cont) this.hline(x + 14, x + w - 14, yy, hex("#E3EBF7"), 0.6)
        }
        u.draw(x, yy, w)
        yy -= u.h
      }
      i += take
      spec.onChunk?.({ top, bottom: top - boxH, first, last: i >= units.length })
      first = false
      this.y = top - boxH - 10
      if (i < units.length) this.newPage()
    }
  }

  // ---- unit builders ------------------------------------------------------------------------------------------------------------------
  private cell(label: string, value: string, x: number, yTop: number, width: number, mono?: boolean) {
    const lab = this.clean(label)
    this.t.draw(this.page, lab, x, yTop - 7.5 * 0.82, "s", 7.5, MUTED, H)
    this.note(lab)
    const lh = mono ? 11 : 13.2
    const size = mono ? 8 : 9.8
    const lines = this.lines(value === "" ? "—" : value, mono ? "m" : "r", size, width)
    this.drawLines(lines, x, yTop - 13, mono ? "m" : "r", size, INK, lh)
    this.note(lines.filter(Boolean).join(" "))
  }
  private cellHeight(label: string, value: string, width: number, mono?: boolean) {
    const lh = mono ? 11 : 13.2
    const size = mono ? 8 : 9.8
    const lines = this.lines(value === "" ? "—" : value, mono ? "m" : "r", size, width).length
    return 13 + lines * lh
  }

  /** Label/value fields as units: short values pair up in two columns, long values and text take the full width, yes/no answers become statement rows. */
  fieldUnits(fields: Field[], width: number): Unit[] {
    const units: Unit[] = []
    const pad = 14
    const inner = width - 2 * pad
    const colW = (inner - 16) / 2
    let pending: Field | null = null
    const flushPending = () => {
      if (!pending) return
      const f = pending
      pending = null
      units.push(this.gridUnit([f], colW, inner))
    }
    for (const f of fields) {
      const shortValue = !f.yn && !f.mono && this.lines(f.value === "" ? "—" : f.value, "r", 9.8, colW).length === 1 && this.lines(f.label, "s", 7.5, colW).length === 1
      if (f.yn) {
        flushPending()
        units.push(this.statementUnit(f, inner))
      } else if (shortValue) {
        if (pending) {
          units.push(this.gridUnit([pending, f], colW, inner))
          pending = null
        } else pending = f
      } else {
        flushPending()
        units.push(...this.longUnits(f, inner))
      }
    }
    flushPending()
    return units
  }

  private gridUnit(cells: Field[], colW: number, inner: number): Unit {
    const widths = cells.length === 1 ? [inner] : [colW, colW]
    const h = Math.max(...cells.map((c, i) => this.cellHeight(c.label, c.value, widths[i], c.mono))) + 14
    return {
      h,
      draw: (x, y, w) => {
        cells.forEach((c, i) => this.cell(c.label, c.value, x + 14 + i * (colW + 16), y - 7, widths[i], c.mono))
        void w
      },
    }
  }

  private statementUnit(f: Field, inner: number): Unit {
    const lw = inner - 70
    const lines = this.lines(f.label, "r", 9.5, lw)
    const h = Math.max(30, lines.length * 13.2 + 16)
    return {
      h,
      draw: (x, y) => {
        this.drawLines(lines, x + 14, y - (h - lines.length * 13.2) / 2, "r", 9.5, INK, 13.2)
        this.note(lines.filter(Boolean).join(" "))
        const yes = f.value.toLowerCase() === "yes"
        const no = f.value.toLowerCase() === "no"
        this.chip(f.value, x + 14 + inner - this.chipWidth(f.value), y - (h - 16) / 2, yes ? "info" : no ? "neutral" : "warn")
      },
    }
  }

  /** Long or multi-line text: label then lines, split into units of at most `maxLines` lines so it can flow over pages. */
  longUnits(f: Field, inner: number, maxLines = 12): Unit[] {
    const mono = Boolean(f.mono)
    const size = mono ? 8 : 9.8
    const lh = mono ? 11 : 13.8
    const all = this.lines(f.value === "" ? "—" : f.value, mono ? "m" : "r", size, inner)
    const out: Unit[] = []
    for (let i = 0; i < all.length; i += maxLines) {
      const chunk = all.slice(i, i + maxLines)
      const first = i === 0
      const labelH = first ? 14 : 4
      const h = labelH + chunk.length * lh + 11
      out.push({
        h,
        cont: !first,
        draw: (x, y) => {
          if (first) {
            const lab = this.clean(f.label)
            this.t.draw(this.page, lab, x + 14, y - 7 - 7.5 * 0.82, "s", 7.5, MUTED, H)
            this.note(lab)
          }
          this.drawLines(chunk, x + 14, y - 7 - labelH + (first ? 0 : 0), mono ? "m" : "r", size, INK, lh)
          this.note(chunk.filter(Boolean).join(" "))
        },
      })
    }
    return out
  }

  /** Free text rows (bullets etc.) as units. */
  textUnits(text: string, width: number, o: { size?: number; color?: RGB; weight?: Weight; bullet?: boolean; maxLines?: number } = {}): Unit[] {
    const size = o.size ?? 9.5
    const lh = size * 1.5
    const indent = o.bullet ? 14 : 0
    const all = this.lines(text, o.weight ?? "r", size, width - 28 - indent)
    const out: Unit[] = []
    const max = o.maxLines ?? 12
    for (let i = 0; i < all.length; i += max) {
      const chunk = all.slice(i, i + max)
      out.push({
        h: chunk.length * lh + (i === 0 ? 12 : 12),
        cont: i > 0,
        draw: (x, y) => {
          if (o.bullet && i === 0) this.circle(x + 17, y - 6 - size * 0.45, 2, BLUE)
          this.drawLines(chunk, x + 14 + indent, y - (i > 0 ? 6 : 6), o.weight ?? "r", size, o.color ?? INK, lh)
          this.note(chunk.filter(Boolean).join(" "))
        },
      })
    }
    return out
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

type ItemField = NonNullable<PlanField["itemFields"]>[number]
function itemDisplay(item: ItemField, raw: unknown): string {
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

const requirementIcon = (title: string): IconName => {
  const t = title.toLowerCase()
  if (/medical|health/.test(t)) return "heartPulse"
  if (/licen[cs]e/.test(t)) return "idCard"
  if (/identity/.test(t)) return "user"
  if (/employ/.test(t)) return "briefcase"
  if (/driving record|record/.test(t)) return "fileText"
  if (/clearinghouse|drug|alcohol/.test(t)) return "listChecks"
  return "clipboard"
}

const statusTone = (status: string): Tone => {
  const s = status.toUpperCase()
  if (s === "VERIFIED" || s === "QUALIFIED") return "ok"
  if (s === "REJECTED" || s === "NOT_QUALIFIED" || s === "FAILED") return "bad"
  if (s === "EXCEPTION" || s === "NEEDS_INFORMATION" || s === "PENDING" || s === "EVIDENCE_RECEIVED" || s === "DECLARED") return "warn"
  return "neutral"
}
const statusLabel = (status: string) => status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()).toLowerCase().replace(/^./, (c) => c.toUpperCase())

const initialsOf = (first: string, last: string, fallback: string) => {
  const g = (s: string) => [...s.trim()][0] ?? ""
  const out = `${g(first)}${g(last)}`.trim() || [...fallback.trim()].slice(0, 2).join("")
  return out.toLocaleUpperCase("en")
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Cover art: a geography-neutral highway scene (vector only)
// ---------------------------------------------------------------------------------------------------------------------------------------

function drawHero(L: Layout, top: number, bottom: number) {
  const h = top - bottom
  const k = h / 230
  const P = (px: number, py: number): [number, number] => [px, bottom + py * k]
  // Sky: stacked bands from deep to pale
  const bands = 26
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1)
    const col = rgb(0.80 + 0.17 * t, 0.88 + 0.10 * t, 0.98 + 0.015 * t)
    const y0 = bottom + h * (0.22 + 0.78 * (1 - (i + 1) / bands))
    const y1 = bottom + h * (0.22 + 0.78 * (1 - i / bands))
    L.rect(0, y1 + 0.4, W, y1 - y0 + 0.8, col)
  }
  L.rect(0, bottom + h * 0.22 + 0.4, W, h * 0.78 * 0 + 0.01, WHITE)
  // Soft, low horizon layers (no recognisable landmark)
  const hill = (base: number, amp: number, phase: number, fill: RGB) => {
    const pts: Array<[number, number]> = [P(0, 0)]
    for (let x = 0; x <= W; x += 12) pts.push(P(x, base + amp * Math.sin(x / 90 + phase) + amp * 0.5 * Math.sin(x / 41 + phase * 2)))
    pts.push(P(W, 0))
    L.poly(pts, fill)
  }
  hill(78, 9, 0.4, hex("#DCE8F9"))
  hill(66, 7, 2.1, hex("#CBDBF3"))
  // Road
  L.rect(0, bottom + 54 * k, W, 54 * k, hex("#16264A"))
  L.rect(0, bottom + 54 * k, W, 1.6, hex("#3A5A9A"))
  L.rect(0, bottom + 4 * k, W, 4 * k, hex("#22386B"))
  for (let x = -20; x < W; x += 54) L.rect(x, bottom + 27 * k + 1.1 * k, 30, 2.2 * k, WHITE, 0.55)
  // Motion lines behind the truck
  for (const [dy, len, x0] of [[88, 70, 70], [74, 110, 40], [102, 54, 96], [62, 80, 62]] as const) L.rect(x0, bottom + dy * k, len, 1.4, WHITE, 0.8)
  // Truck (side view, facing right): ground line at road v=18
  const s = k * 0.72
  const ox = 130
  const oy = bottom + 16 * k
  const T = (tx: number, ty: number): [number, number] => [ox + tx * s, oy + ty * s]
  const rectT = (x0: number, y0: number, x1: number, y1: number, fill: RGB) => {
    const a = T(x0, y1)
    const b = T(x1, y0)
    L.rect(a[0], a[1], b[0] - a[0], a[1] - b[1], fill)
  }
  rectT(0, 16, 262, 28, hex("#0E1A38")) // chassis
  L.rr(ox, oy + 130 * s, 250 * s, 106 * s, 5, WHITE, BLUE_LINE, 0.8) // trailer box
  rectT(0, 28, 250, 46, BLUE)
  rectT(0, 46, 250, 49, NAVY)
  rectT(8, 112, 242, 114, BLUE_SOFT)
  L.poly([T(258, 28), T(258, 114), T(300, 114), T(318, 86), T(352, 80), T(352, 28)], NAVY_2) // cab
  L.poly([T(264, 108), T(294, 108), T(310, 88), T(264, 88)], hex("#BFD6FA")) // window
  rectT(262, 114, 267, 140, hex("#0E1A38")) // stack
  rectT(318, 56, 352, 60, BLUE)
  rectT(348, 44, 354, 52, hex("#FFD27A")) // lamp
  const wheel = (cx: number) => {
    const [px, py] = T(cx, 16)
    L.circle(px, py, 17 * s, hex("#0B1226"))
    L.circle(px, py, 8 * s, hex("#8FA3C8"))
    L.circle(px, py, 3 * s, hex("#0B1226"))
  }
  for (const cx of [38, 76, 292, 330]) wheel(cx)
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------------------------------------------------

async function build(input: PdfInput, contentsPages: Map<string, number> | null): Promise<{ L: Layout; render: PdfRender }> {
  const carrier = input.audience === "carrier"
  const review = carrier ? input.review ?? null : null
  const submitted = new Date(input.submittedAt)
  const L = new Layout()
  await L.init({
    title: `${carrier ? "Driver application dossier" : "Driver application"} ${input.receiptId}`,
    subject: `${input.companyName} - ${input.applicantName}`,
    date: submitted,
    logo: input.logoPng,
    scanText: JSON.stringify({ n: input.companyName, a: input.applicantName, s: input.snapshot, c: input.consents, r: review }),
  })
  const { plan, snapshot } = input
  const fieldById = new Map(plan.fields.map((f) => [f.id, f]))
  const company = L.clean(input.companyName)
  const applicant = L.clean(input.applicantName)

  const sections = plan.sections.slice().sort((a, b) => a.order - b.order)
  const present = sections.filter((s) => snapshot.fields.some((f) => f.section === s.id) || snapshot.uploads.some((u) => fieldById.get(u.fieldId)?.section === s.id) || [...snapshot.sensitive, ...snapshot.sensitiveNotCollected].some((x) => fieldById.get(x.fieldId)?.section === s.id))
  const hasAuth = input.consents.length > 0
  const T = {
    auth: "Authorizations and signatures",
    reviewItems: "Open review items and limitations",
    integrity: "Evidence and integrity",
    process: "Driver hiring process",
  }
  const tocEntries: Array<{ title: string; icon: IconName }> = [
    ...present.map((s) => ({ title: s.title, icon: sectionIcon(s.id) })),
    ...(hasAuth ? [{ title: T.auth, icon: "penLine" as IconName }] : []),
    { title: T.reviewItems, icon: "info" },
    ...(carrier && review ? [{ title: T.process, icon: "clipboard" as IconName }] : []),
    { title: T.integrity, icon: "fileText" },
  ]

  // ---- Cover ---------------------------------------------------------------------------------------------------------------------------
  L.newPage()
  const cover = L.page
  cover.drawRectangle({ x: 0, y: 0, width: 14, height: H, color: BLUE })
  const logoH = 46
  if (L.logo) cover.drawImage(L.logo, { x: MX, y: H - 56 - logoH, width: (L.logo.width / L.logo.height) * logoH, height: logoH })
  else L.label("TES", MX, H - 56, "b", 28, NAVY)
  const heading = carrier ? "Driver Application Dossier" : "Driver Application"
  L.label(heading, MX, H - 150, "b", carrier ? 31 : 40, NAVY)
  L.label(carrier ? "Submitted Application and Hiring Records" : "Submitted Application", MX, H - (carrier ? 192 : 200), "s", 16, BLUE)
  let cx = MX
  cx += L.chip("APPLICANT-DECLARED", cx, H - 232, "navy") + 8
  if (carrier) L.chip(review?.decision ? `DECISION: ${review.decision.status.replace(/_/g, " ")}` : "NO DECISION RECORDED", cx, H - 232, review?.decision ? statusTone(review.decision.status) : "warn")
  else L.chip("SIGNED AND SUBMITTED", cx, H - 232, "info", "check")

  const colW = (CW - 28) / 2
  const cells: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: "user", label: "APPLICANT", value: applicant },
    { icon: "briefcase", label: "CARRIER", value: company },
    { icon: "fileText", label: "RECEIPT NUMBER", value: input.receiptId },
    { icon: "calendar", label: "RECEIVED", value: fmtUtc(input.submittedAt) },
    { icon: "clipboard", label: "APPLICATION", value: stageLabel(snapshot.collectionStage) },
    { icon: "truck", label: "OPERATING SCOPE", value: scopeLabel(plan.context) },
  ]
  const cellH = cells.map((c) => 18 + L.textHeight(c.value, "s", 10.5, colW - 46, 14))
  const rowHs = [0, 1, 2].map((r) => Math.max(cellH[r * 2], cellH[r * 2 + 1]) + 14)
  const panelH = Math.min(520, 70 + rowHs.reduce((a, b) => a + b, 0))
  const heroTop = H - 250
  drawHero(L, heroTop, Math.max(panelH + 2, 0))
  cover.drawRectangle({ x: 14, y: 0, width: W - 14, height: panelH, color: NAVY })
  cover.drawRectangle({ x: 14, y: panelH - 3, width: W - 14, height: 3, color: BLUE })
  L.label(carrier ? "RECORD DETAILS  ·  CARRIER USE" : "APPLICATION DETAILS", MX, panelH - 22, "b", 7.5, BLUE_MID)
  let py = panelH - 40
  cells.forEach((c, i) => {
    const row = Math.floor(i / 2)
    const col = i % 2
    if (col === 0 && row > 0) py -= rowHs[row - 1]
    const x = MX + col * (colW + 28)
    L.circle(x + 14, py - 16, 14, NAVY_2)
    L.icon(c.icon, x + 7, py - 9, 14, WHITE, 2)
    L.label(c.label, x + 38, py - 3, "s", 7, BLUE_MID)
    L.put(c.value, x + 38, py - 15, colW - 46, "s", 10.5, WHITE, 14)
  })
  L.label("Receipt, hashes and generator are recorded on the final page.", MX, 18, "r", 7.5, BLUE_MID)

  // ---- Contents ------------------------------------------------------------------------------------------------------------------------
  L.newPage()
  L.label("Contents", MX, L.y, "b", 26, NAVY)
  L.hline(MX, MX + CW, L.y - 38, BLUE_LINE, 1)
  L.hline(MX, MX + 64, L.y - 38, BLUE, 2.2)
  L.y -= 54
  const rowMin = Math.max(24, Math.min(32, Math.floor((PAGE_CAP - 54 - 6 - 110 - 80) / tocEntries.length) - 4))
  tocEntries.forEach((e, i) => {
    const clean = L.clean(e.title)
    const lines = L.lines(clean, "s", 11, CW - 150)
    const h = Math.max(rowMin, lines.length * 15 + 14)
    L.need(h + 4)
    const top = L.y
    L.circle(MX + 13, top - h / 2, 11.5, BLUE)
    const n = String(i + 1)
    L.t.draw(L.page, n, MX + 13 - L.t.width(n, "b", 9.5) / 2, top - h / 2 - 3.4, "b", 9.5, WHITE, H)
    L.iconTile(e.icon, MX + 36, top - (h - 26) / 2, 26)
    L.drawLines(lines, MX + 76, top - (h - lines.length * 15) / 2, "s", 11, INK, 15)
    L.note(clean)
    const pg = contentsPages?.get(clean)
    if (pg) {
      const label = String(pg)
      const lw = L.t.width(label, "b", 11)
      L.t.draw(L.page, label, MX + CW - lw, top - h / 2 - 4, "b", 11, NAVY, H)
      // dotted leader
      const lastW = L.t.width(lines[lines.length - 1] ?? "", "s", 11)
      const x1 = MX + 76 + lastW + 8
      const x2 = MX + CW - lw - 8
      for (let dx = x1; dx < x2; dx += 5) L.circle(dx, top - h / 2 - 3 + 0.4 - (lines.length - 1) * 7.5 * 0, 0.55, BLUE_MID)
    }
    L.hline(MX + 76, MX + CW, top - h, hex("#E3EBF7"), 0.6)
    L.y -= h + 4
  })
  L.y -= 6
  L.infoBox(
    carrier
      ? "Part 1 reproduces the applicant's application exactly as submitted and signed. Part 2 is the carrier's separate, post-submission hiring process: document intake, verification, qualification and hiring decision. Nothing in Part 2 edits or restates what the applicant declared."
      : "This document is the applicant's submitted application: what the applicant declared, the authorizations they signed and the evidence they referenced. Submitting is not a hiring decision. Anything that happens afterwards is the carrier's separate hiring process and is not part of this document.",
    "info",
    carrier ? "How this dossier is organised" : "About this record",
  )
  L.need(60)
  const keyY = L.y
  let kx = MX
  kx += L.chip("APPLICANT-DECLARED", kx, keyY, "navy") + 6
  L.label("What the applicant stated and signed", kx, keyY - 3, "r", 8.5, MUTED)
  L.y -= 24
  kx = MX
  kx += L.chip("PENDING LEGAL REVIEW", kx, L.y, "warn") + 6
  L.label("Attention: wording not yet approved by counsel; recorded as presented and signed", kx, L.y - 3, "r", 8.5, MUTED)
  L.y -= 24
  if (carrier) {
    kx = MX
    kx += L.chip("Verified", kx, L.y, "ok", "check") + 4
    kx += L.chip("Rejected", kx, L.y, "bad") + 4
    kx += L.chip("Unresolved", kx, L.y, "warn") + 6
    L.label("Part 2 only: green confirmed, red failed, yellow still needs attention", kx, L.y - 3, "r", 8.5, MUTED)
    L.y -= 24
  }

  // ---- Part 1: the application ---------------------------------------------------------------------------------------------------------
  L.newPage()
  let n = 1
  if (carrier) {
    L.rr(MX, L.y, CW, 30, 8, BLUE)
    L.label("PART 1  ·  SUBMITTED APPLICATION (APPLICANT-DECLARED, SIGNED, UNCHANGED)", MX + 14, L.y - 10, "b", 8.5, WHITE)
    L.y -= 44
  }

  // ---- Answer sections ----------------------------------------------------------------------------------------------------------------
  for (const section of present) {
    const rows = snapshot.fields.filter((f) => f.section === section.id)
    const uploads = snapshot.uploads.filter((u) => fieldById.get(u.fieldId)?.section === section.id && u.fieldId !== "system.application_pdf")
    const sens = [...snapshot.sensitive.map((x) => ({ ...x, kind: "collected" as const })), ...snapshot.sensitiveNotCollected.map((x) => ({ fieldId: x.fieldId, collected: false, kind: "off" as const }))].filter((x) => fieldById.get(x.fieldId)?.section === section.id)
    const icon = sectionIcon(section.id)
    L.y -= section === present[0] ? 0 : 8
    L.sectionHeader(section.title, { number: n++, icon, intro: section.intro, follow: 230 })

    const toField = (field: PlanField, row: { value: unknown }): Field => {
      const label = field.pdf.label ?? field.label
      if (field.pdf.mask === "EXCLUDE") return { label, value: "(not shown in this document)" }
      const value = masked(field, displayValue(field, row.value))
      return { label, value, yn: field.type === "yesno" && (value === "Yes" || value === "No") }
    }
    let flushCount = 0
    const flushPanel = (fields: Field[], title: string, panelIcon: IconName) => {
      if (!fields.length) return
      L.panel({ title: flushCount === 0 ? title : "Further answers", icon: panelIcon }, L.fieldUnits(fields, CW))
      flushCount += 1
    }
    const SIMPLE_TITLE: Record<string, string> = { experience: "Driving experience", employment: "Employment overview", eligibility: "Eligibility declarations", documents: "Documents" }

    // -- Identity: profile card
    if (section.id === "identity") {
      const byId = new Map(rows.map((r) => [r.id, r]))
      const get = (id: string) => {
        const r = byId.get(id)
        return r && r.value !== null && r.value !== undefined && r.value !== "" ? String(r.value) : ""
      }
      const first = get("identity.legal_first_name")
      const middle = get("identity.legal_middle_name")
      const last = get("identity.legal_last_name")
      const fullName = [first, middle, last].filter(Boolean).join(" ") || input.applicantName
      const contactIds = ["identity.phone", "identity.email", "identity.date_of_birth"]
      const contactIcon: Record<string, IconName> = { "identity.phone": "phone", "identity.email": "mail", "identity.date_of_birth": "calendar" }
      const contact = rows.filter((r) => contactIds.includes(r.id))
      const nameRows = rows.filter((r) => r.id.startsWith("identity.legal_"))
      const rest = rows.filter((r) => !contactIds.includes(r.id) && !r.id.startsWith("identity.legal_"))
      const nameLines = L.lines(fullName, "b", 17, CW - 150)
      const bandH = Math.max(86, nameLines.length * 21 + 52)
      const units: Unit[] = []
      units.push({
        h: bandH,
        keep: true,
        draw: (x, y) => {
          L.rect(x + 0.5, y, CW - 1, bandH - 0.5, PAPER)
          const r = 28
          L.circle(x + 20 + r, y - bandH / 2, r, NAVY)
          const ini = L.clean(initialsOf(first, last, input.applicantName))
          const iw = L.t.width(ini, "b", 18)
          L.t.draw(L.page, ini, x + 20 + r - iw / 2, y - bandH / 2 - 6.4, "b", 18, WHITE, H)
          L.label("LEGAL NAME OF APPLICANT", x + 96, y - bandH / 2 + (nameLines.length * 21) / 2 + 14, "s", 7, MUTED)
          L.put(fullName, x + 96, y - bandH / 2 + (nameLines.length * 21) / 2, CW - 150, "b", 17, NAVY, 21)
          L.chip("APPLICANT-DECLARED", x + 96, y - bandH / 2 - (nameLines.length * 21) / 2 - 2, "info")
        },
      })
      if (contact.length) {
        const cw = (CW - 28 - 14) / 2
        const items = contact.map((r) => {
          const f = fieldById.get(r.id)!
          return { id: r.id, label: f.pdf.label ?? f.label, value: displayValue(f, r.value) }
        })
        const rowsOf: Array<typeof items> = []
        for (let i = 0; i < items.length; i += 2) rowsOf.push(items.slice(i, i + 2))
        for (const pair of rowsOf) {
          const h = Math.max(...pair.map((p) => 14 + L.textHeight(p.value, "r", 9.8, cw - 40, 13))) + 18
          units.push({
            h,
            draw: (x, y) =>
              pair.forEach((p, i) => {
                const px = x + 14 + i * (cw + 14)
                L.iconTile(contactIcon[p.id], px, y - 9, 28)
                L.label(p.label, px + 38, y - 10, "s", 7.5, MUTED)
                L.put(p.value, px + 38, y - 23, cw - 40, "r", 9.8, INK, 13)
              }),
          })
        }
      }
      const nameFields: Field[] = nameRows.map((r) => toField(fieldById.get(r.id)!, r))
      units.push(...L.fieldUnits(nameFields, CW))
      L.panel({ title: "Applicant profile", icon: "user", flow: false }, units)
      const restFields: Field[] = rest.flatMap((r) => {
        const f = fieldById.get(r.id)
        return f ? [toField(f, r)] : []
      })
      if (restFields.length) L.panel({ title: "Other details", icon: "clipboard" }, L.fieldUnits(restFields, CW))
      flushCount = 99
    }

    // -- Licence: licence card, medical certification, declarations
    else if (section.id === "licence") {
      const fields = rows.flatMap((r) => {
        const f = fieldById.get(r.id)
        return f ? [{ def: f, f: toField(f, r) }] : []
      })
      const isMedical = (id: string) => /medical/.test(id)
      const isDecl = (def: PlanField) => def.type === "yesno" || def.type === "textarea" || /_details$/.test(def.id)
      const card = fields.filter((x) => !isMedical(x.def.id) && !isDecl(x.def))
      const medical = fields.filter((x) => isMedical(x.def.id))
      const decl = fields.filter((x) => !isMedical(x.def.id) && isDecl(x.def))
      if (card.length) L.panel({ kicker: "COMMERCIAL DRIVER'S LICENCE", title: "Licence details", icon: "idCard", theme: "light" }, L.fieldUnits(card.map((x) => x.f), CW))
      if (medical.length) L.panel({ kicker: "MEDICAL CERTIFICATION", title: "Medical certificate", icon: "heartPulse", theme: "light" }, L.fieldUnits(medical.map((x) => x.f), CW))
      if (decl.length) L.panel({ title: "Licence and record declarations", icon: "listChecks", flow: true }, L.fieldUnits(decl.map((x) => x.f), CW))
      flushCount = 99
    } else {
      const simple: Field[] = []
      for (const row of rows) {
        const field = fieldById.get(row.id)
        if (!field) continue
        if (field.type !== "repeatable") {
          simple.push(toField(field, row))
          continue
        }
        flushPanel(simple.splice(0), SIMPLE_TITLE[section.id] ?? "Your answers", icon)
        const entries = Array.isArray(row.value) ? (row.value as Array<Record<string, unknown>>) : []
        const items = field.itemFields ?? []
        const label = field.pdf.label ?? field.label
        const get = (e: Record<string, unknown>, id: string) => {
          const it = items.find((i) => i.id === id)
          return it ? itemDisplay(it, e[id]) : ""
        }
        const restOf = (e: Record<string, unknown>, skip: string[]): Field[] =>
          items.filter((it) => !skip.includes(it.id)).flatMap((it) => {
            const v = itemDisplay(it, e[it.id])
            return v === "" ? [] : [{ label: it.label, value: v, yn: it.type === "yesno" }]
          })
        if (entries.length === 0) {
          L.subheading(label, 60, icon)
          L.paragraph("None entered.", { size: 9, color: MUTED, gap: 8 })
          continue
        }
        L.subheading(label, field.id === "address.history" ? 150 : 300, icon)

        const timeline = (kicker: string, dotIcon: IconName | null, build: (e: Record<string, unknown>, i: number) => { spec: PanelSpec; units: Unit[] }) => {
          entries.forEach((e, i) => {
            const { spec, units } = build(e, i)
            const gx = MX + 11
            L.panel(
              {
                ...spec,
                inset: 34,
                onChunk: ({ top, bottom, first, last }) => {
                  const dotY = top - 20
                  if (!(last && i === entries.length - 1)) L.page.drawLine({ start: { x: gx, y: first ? dotY : top + 8 }, end: { x: gx, y: bottom - 10 }, thickness: 1.6, color: BLUE_LINE })
                  if (first) {
                    L.circle(gx, dotY, 11, BLUE)
                    if (dotIcon) L.icon(dotIcon, gx - 6.5, dotY + 6.5, 13, WHITE, 2.2)
                    else {
                      const num = String(i + 1)
                      L.t.draw(L.page, num, gx - L.t.width(num, "b", 9) / 2, dotY - 3.2, "b", 9, WHITE, H)
                    }
                  }
                },
              },
              units,
            )
          })
          void kicker
        }

        if (field.id === "address.history") {
          timeline("RESIDENCE", null, (e, i) => {
            const addr = [get(e, "street"), [get(e, "city"), get(e, "region"), get(e, "postal")].filter(Boolean).join(", "), get(e, "country")].filter(Boolean).join("\n")
            const from = get(e, "from")
            const to = get(e, "to")
            const current = !to
            const others = restOf(e, ["street", "city", "region", "postal", "country", "from", "to"])
            const units: Unit[] = [
              {
                h: Math.max(36, L.textHeight(addr, "s", 10.5, CW - 34 - 28 - 26, 14.5) + 18),
                draw: (x, y, w) => {
                  L.icon("mapPin", x + 14, y - 11, 14, BLUE, 2)
                  L.put(addr, x + 36, y - 10, w - 50, "s", 10.5, INK, 14.5)
                },
              },
              ...L.fieldUnits(others, CW - 34),
            ]
            return { spec: { kicker: `RESIDENCE ${i + 1}`, title: `${from || "—"}  →  ${to || "Present"}`, icon: "calendar", chip: current ? { text: "CURRENT", tone: "ok" } : undefined }, units }
          })
        } else if (field.id === "employment.history") {
          timeline("EMPLOYER", "truck", (e, i) => {
            const employer = get(e, "employer") || `Employer ${i + 1}`
            const from = get(e, "from")
            const to = get(e, "to")
            const position = get(e, "position")
            const fields: Field[] = restOf(e, ["employer", "from", "to", "position"])
            const loc: Field[] = []
            const all: Field[] = []
            for (const f of fields) (f.yn ? all : loc).push(f)
            const units: Unit[] = []
            if (position) units.push({ h: Math.max(30, L.textHeight(position, "s", 10, CW - 34 - 28 - 26, 14) + 16), draw: (x, y, w) => { L.icon("briefcase", x + 14, y - 9, 13, BLUE, 2); L.put(position, x + 34, y - 9, w - 48, "s", 10, INK, 14) } })
            units.push(...L.fieldUnits([...loc, ...all], CW - 34))
            return { spec: { kicker: `EMPLOYER ${i + 1}`, title: employer, icon: "briefcase", chip: from || to ? { text: `${from || "—"} → ${to || "Present"}`, tone: "info" } : undefined }, units }
          })
        } else if (field.id === "experience.accidents" || field.id === "experience.violations") {
          const accident = field.id === "experience.accidents"
          entries.forEach((e, i) => {
            const date = get(e, "date")
            const titleText = accident ? get(e, "location") || date || `Accident ${i + 1}` : get(e, "offence") || date || `Conviction ${i + 1}`
            const units = L.fieldUnits(restOf(e, accident ? ["date", "location"] : ["date", "offence"]), CW)
            L.panel({ kicker: `${accident ? "ACCIDENT" : "CONVICTION"} ${i + 1}`, title: titleText, icon: "alert", theme: "light", accent: NAVY, chip: date ? { text: date, tone: "info" } : undefined }, units.length ? units : L.textUnits("(no further details entered)", CW, { color: MUTED }))
          })
        } else {
          entries.forEach((e, i) => {
            const titleKey = items.find((it) => ["employer", "course", "school", "name"].includes(it.id)) ?? items[0]
            const title = (titleKey && get(e, titleKey.id)) || `Record ${i + 1}`
            const from = get(e, "from") || get(e, "completed") || get(e, "date")
            const units = L.fieldUnits(restOf(e, [titleKey?.id ?? "", "from", "completed", "date"].filter(Boolean)), CW)
            L.panel({ kicker: `${label.toUpperCase()} · ${i + 1}`, title, icon: sectionIcon(section.id), chip: from ? { text: from, tone: "info" } : undefined }, units.length ? units : L.textUnits("(no further details entered)", CW, { color: MUTED }))
          })
        }
      }
      flushPanel(simple.splice(0), SIMPLE_TITLE[section.id] ?? "Your answers", icon)
    }

    if (uploads.length || sens.length) {
      const fields: Field[] = [
        ...uploads.map((u) => ({ label: fieldById.get(u.fieldId)?.label ?? u.fieldId, value: `${u.filename} (${u.byteSize} bytes)\nEvidence document ${u.documentId}` })),
        ...sens.map((s) => ({ label: fieldById.get(s.fieldId)?.label ?? s.fieldId, value: s.kind === "collected" ? (s.collected ? "Collected securely (value not shown)" : "Not provided") : "Not collected on this application" })),
      ]
      L.panel({ title: "Supporting documents and restricted information", icon: "paperclip" }, L.fieldUnits(fields, CW))
    }
    if (section === present[present.length - 1] && snapshot.retainedNotApplicable.length) {
      L.paragraph(`${snapshot.retainedNotApplicable.length} earlier answer(s) were kept in the record but did not apply after later answers; they are not current statements of the applicant.`, { size: 8.5, color: MUTED, gap: 6 })
    }
  }

  // ---- Authorizations -----------------------------------------------------------------------------------------------------------------
  const byKey = new Map<string, PlanConsent>(plan.consents.map((c) => [c.key, c]))
  const accepted = input.consents.slice().sort((a, b) => a.key.localeCompare(b.key))
  let firstAuth = true
  for (const c of accepted) {
    const def = byKey.get(c.key)
    if (!def) continue
    if (firstAuth) {
      L.newPage()
      L.sectionHeader(T.auth, { number: n++, icon: "penLine", follow: 220, intro: "Each authorization is separate, has its own stated purpose, and was read in full before it was signed." })
      firstAuth = false
    }
    const inner = CW - 28
    const units: Unit[] = []
    if (c.legalStatus !== "APPROVED") {
      const msg = "PENDING LEGAL REVIEW — this wording has not been approved by counsel. It is recorded as presented and signed, and must not be relied on until approved."
      const lines = L.lines(msg, "s", 8.8, inner - 34)
      const h = lines.length * 12.6 + 20
      units.push({
        h,
        keep: true,
        draw: (x, y) => {
          L.rect(x + 0.5, y, CW - 1, h, AMBER_BG)
          L.icon("alert", x + 14, y - 9, 15, AMBER, 2)
          L.drawLines(lines, x + 38, y - 10, "s", 8.8, AMBER, 12.6)
          L.note(lines.filter(Boolean).join(" "))
        },
      })
    }
    units.push(
      ...L.fieldUnits(
        [
          { label: "Authorization", value: `${def.key} · version ${c.version}` },
          { label: "Jurisdiction", value: c.jurisdiction ?? "—" },
          { label: "Purpose", value: c.purpose },
          { label: "Authorized parties", value: def.authorizedParties.join(", ") },
          { label: "Scope", value: Object.entries(def.scope).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("; ") },
        ],
        CW,
      ),
    )
    units.push({
      h: 28,
      keep: true,
      draw: (x, y) => L.label("TEXT PRESENTED TO THE APPLICANT", x + 14, y - 14, "b", 7.5, BLUE),
    })
    units.push(...L.textUnits(def.text, CW, { size: 9.5, maxLines: 8 }))
    const sig = L.clean(c.signatureName)
    const sigLines = L.lines(sig, "b", 19, 300)
    const sigH = 74 + sigLines.length * 24
    units.push({
      h: sigH,
      draw: (x, y, w) => {
        L.rect(x + 0.5, y, w - 1, sigH - 1, PAPER)
        L.label("SIGNATURE (TYPED, WITH AFFIRMATIVE ACCEPTANCE)", x + 14, y - 12, "s", 7, MUTED)
        L.drawLines(sigLines, x + 14, y - 28, "b", 19, NAVY, 24)
        L.note(sig)
        const ly = y - 28 - sigLines.length * 24 - 4
        L.hline(x + 14, x + 14 + 310, ly, NAVY, 0.9)
        L.label("Typed signature of the applicant", x + 14, ly - 6, "r", 7.5, MUTED)
        L.label("DATE SIGNED", x + w - 190, y - 12, "s", 7, MUTED)
        L.label(fmtUtc(c.acceptedAt), x + w - 190, y - 26, "s", 9.5, INK)
        L.label("METHOD", x + w - 190, y - 46, "s", 7, MUTED)
        L.label("Checkbox with typed signature", x + w - 190, y - 60, "r", 8.5, INK)
        L.label("Wording SHA-256", x + 14, ly - 24, "s", 7, MUTED)
        L.label(c.textSha256, x + 14, ly - 35, "m", 7.2, INK)
      },
    })
    L.panel({ kicker: "AUTHORIZATION", title: def.title, icon: "penLine", theme: "dark", chip: c.legalStatus !== "APPROVED" ? { text: "PENDING LEGAL REVIEW", tone: "warn" } : { text: "APPROVED", tone: "ok" } }, units)
  }

  const externals = snapshot.externalProcesses.map((e) => byKey.get(e.key)).filter((c): c is PlanConsent => Boolean(c))
  if (externals.length) {
    L.subheading("Authorizations completed outside this application", 100, "info")
    for (const c of externals) {
      L.panel({ title: c.title, icon: "fileText" }, L.textUnits("This is completed through a separate, official or standalone process. This application does not capture or replace it.", CW, { color: MUTED, size: 9 }))
    }
  }

  // ---- Review items and limitations ---------------------------------------------------------------------------------------------------
  L.newPage()
  L.sectionHeader(T.reviewItems, { number: n++, icon: "info", follow: 150 })
  L.panel({ title: "Open review items", icon: "alert", theme: "amber", flow: true }, plan.regulatoryReviewRequirements.length ? plan.regulatoryReviewRequirements.flatMap((r) => L.textUnits(r.text, CW, { bullet: true })) : L.textUnits("None recorded.", CW, { color: MUTED }))
  L.panel({ title: "Limitations", icon: "info", flow: true }, plan.limitations.length ? plan.limitations.flatMap((l) => L.textUnits(l, CW, { bullet: true })) : L.textUnits("None recorded.", CW, { color: MUTED }))
  L.panel(
    { title: "Legal sources referenced (none verified by counsel)", icon: "fileText", flow: true },
    Object.entries(plan.legalSources).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, s]) => L.textUnits(`${s.citation} [${key}] — ${s.verification}`, CW, { bullet: true, size: 8.6 })),
  )

  // ---- Part 2: the hiring process (dossier only) ------------------------------------------------------------------------------------------
  if (carrier && review) {
    L.newPage()
    L.sectionHeader(T.process, { number: n++, icon: "clipboard", dark: true, follow: 200, intro: `Carrier records prepared ${fmtUtc(review.preparedAt)} by ${review.preparedBy}. Every item below happened after the application was submitted and is recorded separately. The signed application in Part 1 is unchanged by any of it.` })
    const decisions = review.decisions ?? (review.decision ? [review.decision] : [])
    const stageTone = (id: string): { tone: Tone; label: string } => {
      const att = (a: Attention): Tone => (a === "ok" ? "ok" : a === "bad" ? "bad" : a === "attention" ? "warn" : "neutral")
      if (id === "intake") {
        if (review.evidence.length === 0) return { tone: "neutral", label: "No documents" }
        const open = review.evidence.filter((e) => e.state !== undefined && e.state !== null && e.state !== "stored").length
        return open ? { tone: "warn", label: `${open} not yet processed` } : { tone: "ok", label: "Documents processed" }
      }
      if (id === "assessment") return review.blockers && review.blockers.length ? { tone: "warn", label: `${review.blockers.length} unresolved` } : { tone: "ok", label: "Every required check verified" }
      if (id === "decision") {
        const d = decisions[decisions.length - 1]
        return d ? { tone: statusTone(d.status), label: d.status.replace(/_/g, " ").toLowerCase() } : { tone: "warn", label: "No decision recorded" }
      }
      if (id === "handoff") return { tone: "neutral", label: decisions[decisions.length - 1]?.status === "QUALIFIED" ? "Eligible for approval" : "Not started" }
      const t = requirementsAttention(review.checks.filter((c) => stageOfRequirement(c.type) === id).map((c) => ({ required: c.required, status: c.status })))
      return { tone: att(t.tone), label: t.label }
    }
    const fieldTexts = (ch: PdfReview["checks"][number]): Field[] => [
      { label: "Recorded by", value: ch.recordedBy ?? "—" },
      { label: "Recorded at", value: ch.recordedAt ? fmtUtc(ch.recordedAt) : "—" },
      { label: "Evidence or note", value: ch.note ?? "(none)" },
      { label: "Evidence document", value: ch.evidenceDocumentId ?? "(none)", mono: Boolean(ch.evidenceDocumentId) },
    ]
    HIRING_STAGES.forEach((stage, i) => {
      const t = stageTone(stage.id)
      const checks = review.checks.filter((c) => stageOfRequirement(c.type) === stage.id)
      L.stageHeader(i + 1, stage.title, t)
      if (stage.id === "intake") {
        if (review.evidence.length === 0) L.paragraph("No evidence documents are linked to this application.", { size: 9, color: MUTED, gap: 8 })
        for (const e of review.evidence) {
          L.panel(
            { title: e.label, icon: "paperclip", chip: e.restricted ? { text: "RESTRICTED", tone: "warn" } : e.state ? { text: e.state, tone: e.state === "stored" ? "ok" : "warn" } : undefined },
            e.restricted
              ? L.fieldUnits([{ label: "Evidence document id", value: e.documentId, mono: true }, { label: "Access", value: "Restricted. File details are not shown in this document and require the sensitive-information permission." }], CW)
              : L.fieldUnits([{ label: "File", value: `${e.filename ?? "—"}${e.byteSize !== null ? ` (${e.byteSize} bytes)` : ""}` }, { label: "Evidence document id", value: e.documentId, mono: true }, ...(e.sha256 ? [{ label: "SHA-256", value: e.sha256, mono: true }] : [])], CW),
          )
        }
      } else if (stage.id === "assessment") {
        if (review.blockers && review.blockers.length) L.panel({ title: "Why this applicant cannot yet be qualified", icon: "alert", theme: "amber", flow: true }, review.blockers.flatMap((b) => L.textUnits(b, CW, { bullet: true })))
        else L.panel({ title: "Qualification gate", icon: "check" }, L.textUnits("Every required check is verified on a signed, legally approved authorization.", CW))
      } else if (stage.id === "decision") {
        if (decisions.length === 0) L.panel({ title: "Hiring decision", icon: "listChecks", chip: { text: "NO DECISION RECORDED", tone: "warn" } }, L.textUnits("No decision has been recorded for this application.", CW, { color: MUTED }))
        decisions.forEach((d, k) => L.panel({ kicker: k === decisions.length - 1 ? "CURRENT DECISION" : "EARLIER DECISION", title: d.status.replace(/_/g, " "), icon: "listChecks", chip: { text: d.status.replace(/_/g, " "), tone: statusTone(d.status) } }, L.fieldUnits([{ label: "Decided by", value: d.decidedBy ?? "—" }, { label: "Decided at", value: d.decidedAt ? fmtUtc(d.decidedAt) : "—" }, { label: "Rationale", value: d.rationale ?? "(none recorded)" }], CW)))
      } else if (stage.id === "handoff") {
        const q = decisions[decisions.length - 1]?.status === "QUALIFIED"
        L.panel({ title: "Onboarding handoff", icon: "truck", chip: { text: q ? "ELIGIBLE FOR APPROVAL" : "NOT STARTED", tone: q ? "info" : "neutral" } }, L.textUnits(q ? "The applicant has been assessed as qualified. Approval and onboarding are separate authorized actions recorded on the driver record." : "Onboarding starts only after an authorized approval of an applicant assessed as qualified.", CW))
      } else {
        if (checks.length === 0) L.paragraph("No check in this stage applies to this application.", { size: 9, color: MUTED, gap: 8 })
        for (const ch of checks) L.panel({ kicker: ch.required ? "REQUIRED CHECK" : "OPTIONAL CHECK", title: ch.title, icon: requirementIcon(ch.title), chip: { text: statusLabel(ch.status), tone: statusTone(ch.status) } }, L.fieldUnits(fieldTexts(ch), CW))
      }
    })
    if (review.corrections && review.corrections.length) {
      L.subheading("Corrections to the record", 150, "clipboard")
      L.paragraph("The signed application is never edited. Each correction below is a separate carrier record.", { size: 9, color: MUTED, gap: 6 })
      for (const c of review.corrections) L.panel({ kicker: fmtUtc(c.recordedAt), title: c.label, icon: "clipboard" }, L.fieldUnits([{ label: "Declared value", value: c.previous }, { label: "Corrected value", value: c.corrected }, { label: "Reason", value: c.reason }, { label: "Recorded by", value: c.recordedBy }], CW))
    }
    L.subheading("Audit provenance", 150, "clock")
    if (review.audit.length === 0) L.paragraph("No audit events are available to this reader.", { size: 9, color: MUTED, gap: 8 })
    for (const a of review.audit) L.panel({ kicker: fmtUtc(a.at), title: a.event, icon: "clock" }, L.fieldUnits([{ label: "Actor", value: a.actor }, ...(a.detail ? [{ label: "Detail", value: a.detail }] : [])], CW))
  }

  // ---- Evidence and integrity (technical provenance, kept apart from the answers) ---------------------------------------------------------
  L.newPage()
  L.sectionHeader(T.integrity, { number: n++, icon: "fileText", dark: true, follow: 220, intro: "Technical provenance for record-keeping and audit. The application SHA-256 is the SHA-256 of the canonical JSON (keys sorted, no whitespace) of the stored application snapshot and can be recomputed independently." })
  L.panel(
    { title: "Record identifiers", icon: "fileText" },
    L.fieldUnits(
      [
        { label: "Receipt number", value: input.receiptId, mono: true },
        ...(input.applicationId ? [{ label: "Application id", value: input.applicationId, mono: true }] : []),
        { label: "Received (UTC)", value: fmtUtc(input.submittedAt) },
        { label: "Catalogue version", value: plan.catalogueVersion },
        { label: "Rules / scope-rules version", value: `${plan.rulesVersion} / ${plan.scopeRulesVersion}` },
        { label: "Document generator", value: PDF_GENERATOR_VERSION },
        { label: "Plan SHA-256", value: input.planSha256, mono: true },
        { label: "Application SHA-256", value: input.snapshotSha256, mono: true },
      ],
      CW,
    ),
  )
  if (accepted.length) {
    L.panel(
      { title: "Signed authorizations", icon: "penLine", flow: true },
      accepted.flatMap((c) =>
        L.fieldUnits(
          [{ label: `${c.key} v${c.version} — ${c.legalStatus === "APPROVED" ? "Approved" : "Pending legal review"}`, value: c.textSha256, mono: true }],
          CW,
        ),
      ),
    )
  }
  const docs = snapshot.uploads.filter((u) => u.fieldId !== "system.application_pdf")
  if (docs.length) {
    L.panel(
      { title: "Supporting documents (evidence references)", icon: "paperclip", flow: true },
      docs.flatMap((u) => L.fieldUnits([{ label: `${fieldById.get(u.fieldId)?.label ?? u.fieldId} — ${u.filename} (${u.byteSize} bytes)`, value: u.documentId, mono: true }], CW)),
    )
  }
  L.infoBox(carrier ? "Part 1 is applicant-declared. Part 2 records the carrier's later activity and never alters Part 1. Authorization wording marked pending legal review has not been approved and must not be relied on." : "Every item in this document is applicant-declared and was recorded when the application was submitted. Authorization wording marked pending legal review has not been approved and must not be relied on.", "info", "About these records")
  if (L.t.unsupported > 0) L.infoBox(`${L.t.unsupported} character(s) could not be drawn by any embedded font and appear as the replacement mark (${"�"}). The stored application snapshot holds the exact text as submitted.`, "warn", "Characters outside the document fonts")

  // ---- Running header and footer ------------------------------------------------------------------------------------------------------
  const total = L.pages.length
  L.pages.forEach((page, i) => {
    if (i > 0) {
      page.drawRectangle({ x: 0, y: 0, width: 5, height: H, color: BLUE })
      if (L.logo) {
        const lh = 22
        page.drawImage(L.logo, { x: MX, y: H - 50, width: (L.logo.width / L.logo.height) * lh, height: lh })
      }
      let head = L.clean(`${input.companyName}  ·  ${carrier ? "Driver application dossier" : "Driver application"}  ·  ${input.applicantName}`)
      let size = 8
      const maxW = CW - 120
      while (L.t.width(head, "r", size) > maxW && size > 6.5) size -= 0.5
      if (L.t.width(head, "r", size) > maxW) {
        const chars = [...head]
        while (chars.length > 4 && L.t.width(`${chars.join("")}…`, "r", size) > maxW) chars.pop()
        head = `${chars.join("")}…`
      }
      L.t.draw(page, head, W - MX - L.t.width(head, "r", size), H - 40, "r", size, MUTED, H)
      page.drawLine({ start: { x: MX, y: H - 56 }, end: { x: W - MX, y: H - 56 }, thickness: 1, color: BLUE_LINE })
      page.drawLine({ start: { x: MX, y: H - 56 }, end: { x: MX + 64, y: H - 56 }, thickness: 2.2, color: BLUE })
      page.drawLine({ start: { x: MX, y: 46 }, end: { x: W - MX, y: 46 }, thickness: 0.5, color: BLUE_LINE })
      const left = L.clean(carrier ? `Receipt ${input.receiptId}  ·  Carrier dossier — confidential` : `Receipt ${input.receiptId}  ·  Submitted application`)
      L.t.draw(page, left, MX, 30, "r", 7.5, MUTED, H)
      const right = `Page ${i + 1} of ${total}`
      const rw = L.t.width(right, "s", 8)
      page.drawRectangle({ x: W - MX - rw - 16, y: 24, width: rw + 16, height: 17, color: BLUE_SOFT, borderColor: BLUE_LINE, borderWidth: 0.6 })
      L.t.draw(page, right, W - MX - rw - 8, 29.2, "s", 8, NAVY, H)
      L.manifest[i].push(right)
    } else {
      const right = `Page 1 of ${total}`
      L.page = page
      page.drawText(right, { x: W - MX - L.t.width(right, "s", 8), y: 18, size: 8, font: L.t.fontFor("s"), color: BLUE_MID })
      L.manifest[i].push(right)
    }
  })

  const bytes = await L.doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
  return { L, render: { bytes, pageCount: total, pages: L.manifest, unsupportedCharacters: L.t.unsupported, vectorRuns: L.t.vectorRuns } }
}

export async function renderApplicationPdfDetailed(input: PdfInput): Promise<PdfRender> {
  // Pass 1 finds which page each section lands on (the contents list is on page 2); pass 2 prints it. Both passes lay out identically.
  const first = await build(input, null)
  const map = new Map<string, number>(first.L.contents.map((c) => [c.title, c.page]))
  const second = await build(input, map)
  return second.render
}

export async function renderApplicationPdf(input: PdfInput): Promise<Uint8Array> {
  return (await renderApplicationPdfDetailed(input)).bytes
}

/** Kept for callers that only need the text a given set of drawable code points can render. */
export function pdfSafe(text: string, supported?: Set<number>): string {
  const set = supported ?? new Set(Array.from({ length: 0x250 }, (_, i) => i))
  let out = ""
  for (const ch of String(text ?? "").normalize("NFC")) {
    const code = ch.codePointAt(0)!
    if (ch === "\n") out += "\n"
    else if (ch === "\t") out += "  "
    else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0) || code === 0xfeff || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e)) continue
    else out += set.has(code) ? ch : "�"
  }
  return out
}
