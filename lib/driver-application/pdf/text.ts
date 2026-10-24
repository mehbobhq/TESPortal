import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { PDFFont, PDFPage, RGB } from "pdf-lib"

/**
 * Text engine for the application PDF.
 *
 * Latin, Latin-extended, Greek, Cyrillic and Vietnamese text is set in the embedded Inter fonts (selectable and extractable). Every other script that the
 * document must carry (Gurmukhi, Devanagari, Gujarati, Bengali, Tamil, Arabic, Hebrew, Thai, Chinese, Japanese kana, Korean) is shaped with HarfBuzz from
 * an Apache/OFL Noto font and drawn as vector outlines, because the PDF font pipeline cannot shape those scripts correctly. A character that no font
 * covers is drawn as the replacement mark and counted; callers report it. Text is never silently dropped or transliterated.
 */

export type Weight = "r" | "s" | "b" | "m"

interface HbGlyphInfo {
  codepoint: number
  cluster: number
}
interface HbGlyphPosition {
  xAdvance: number
  xOffset: number
  yOffset: number
}
interface HbFont {
  glyphToPath(gid: number): string
}
interface HbFace {
  upem: number
  collectUnicodes(): Uint32Array
}
interface HbBuffer {
  addText(text: string): void
  guessSegmentProperties(): void
  getGlyphInfos(): HbGlyphInfo[]
  getGlyphPositions(): HbGlyphPosition[]
  destroy?(): void
}
interface HbModule {
  Blob: new (data: Uint8Array) => unknown
  Face: new (blob: unknown) => HbFace
  Font: new (face: HbFace) => HbFont
  Buffer: new () => HbBuffer
  shape(font: HbFont, buffer: HbBuffer): void
}

interface ScriptSpec {
  id: string
  file: string
  boldFile?: string
  ranges: Array<[number, number]>
}

export const SCRIPTS: ScriptSpec[] = [
  { id: "gurmukhi", file: "NotoGurmukhi-Regular.ttf", boldFile: "NotoGurmukhi-Bold.ttf", ranges: [[0x0a00, 0x0a7f]] },
  { id: "devanagari", file: "NotoDevanagari-Regular.ttf", boldFile: "NotoDevanagari-Bold.ttf", ranges: [[0x0900, 0x097f], [0xa8e0, 0xa8ff]] },
  { id: "gujarati", file: "NotoGujarati-Regular.ttf", boldFile: "NotoGujarati-Bold.ttf", ranges: [[0x0a80, 0x0aff]] },
  { id: "bengali", file: "NotoBengali-Regular.ttf", boldFile: "NotoBengali-Bold.ttf", ranges: [[0x0980, 0x09ff]] },
  { id: "tamil", file: "NotoTamil-Regular.ttf", boldFile: "NotoTamil-Bold.ttf", ranges: [[0x0b80, 0x0bff]] },
  { id: "arabic", file: "NotoArabic-Regular.ttf", boldFile: "NotoArabic-Bold.ttf", ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]] },
  { id: "hebrew", file: "NotoHebrew-Regular.ttf", boldFile: "NotoHebrew-Bold.ttf", ranges: [[0x0590, 0x05ff], [0xfb1d, 0xfb4f]] },
  { id: "thai", file: "NotoThai-Regular.ttf", boldFile: "NotoThai-Bold.ttf", ranges: [[0x0e00, 0x0e7f]] },
  { id: "sc", file: "NotoSC-Regular.ttf", ranges: [[0x3000, 0x303f], [0x3040, 0x30ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xff00, 0xffef]] },
  { id: "kr", file: "NotoKR-Regular.ttf", ranges: [[0xac00, 0xd7a3], [0x1100, 0x11ff], [0x3130, 0x318f]] },
]

const scriptOf = (cp: number): ScriptSpec | null => {
  for (const s of SCRIPTS) for (const [a, b] of s.ranges) if (cp >= a && cp <= b) return s
  return null
}

const SCRIPT_DIR = join(process.cwd(), "lib", "driver-application", "pdf", "fonts", "scripts")

let hbModule: Promise<HbModule> | null = null
const loadHb = () => (hbModule ??= import("harfbuzzjs").then((m) => m as unknown as HbModule))

interface LoadedScript {
  spec: ScriptSpec
  font: HbFont
  face: HbFace
  unicodes: Set<number>
}
const scriptCache = new Map<string, Promise<LoadedScript>>()
function loadScript(hb: HbModule, spec: ScriptSpec, bold: boolean): Promise<LoadedScript> {
  const file = bold && spec.boldFile ? spec.boldFile : spec.file
  let p = scriptCache.get(file)
  if (!p) {
    p = readFile(join(SCRIPT_DIR, file)).then((bytes) => {
      const face = new hb.Face(new hb.Blob(new Uint8Array(bytes)))
      return { spec, face, font: new hb.Font(face), unicodes: new Set<number>(face.collectUnicodes()) }
    })
    scriptCache.set(file, p)
  }
  return p
}

/** Code points that appear in `text` and need a script font (so the fonts can be loaded before the synchronous layout starts). */
export function scriptsNeeded(text: string): ScriptSpec[] {
  const found = new Map<string, ScriptSpec>()
  for (const ch of text) {
    const s = scriptOf(ch.codePointAt(0)!)
    if (s) found.set(s.id, s)
  }
  return [...found.values()]
}

interface Run {
  /** "inter" runs are drawn as text; script runs as vector outlines. */
  script: string | null
  text: string
}

interface Shaped {
  advances: number[]
  paths: string[]
  offsets: Array<[number, number]>
  upem: number
  width: number
}

const isCombining = (cp: number) =>
  (cp >= 0x0300 && cp <= 0x036f) || cp === 0x200c || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x0e31 && cp <= 0x0e3a && cp !== 0x0e32 && cp !== 0x0e33) || (cp >= 0x0e47 && cp <= 0x0e4e)

const STRIP = (cp: number) => cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0) || cp === 0xfeff || cp === 0x200b || cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e)

const REPLACEMENT = "�"

export class TextEngine {
  unsupported = 0
  vectorRuns = 0
  private inter: Record<"r" | "s" | "b", PDFFont>
  private interSet: Set<number>
  private hb: HbModule | null = null
  private loaded = new Map<string, LoadedScript>()
  private shapeCache = new Map<string, Shaped>()
  private widthCache = new Map<string, number>()
  private mono: PDFFont

  constructor(inter: Record<"r" | "s" | "b", PDFFont>, mono: PDFFont) {
    this.inter = inter
    this.mono = mono
    this.interSet = new Set<number>(inter.r.getCharacterSet())
  }

  /** Loads the script fonts the given text needs. Must be awaited before drawing or measuring that text. */
  async prepare(text: string) {
    const needed = scriptsNeeded(text)
    if (needed.length === 0) return
    const hb = (this.hb ??= await loadHb())
    for (const spec of needed) {
      for (const bold of [false, true]) {
        const l = await loadScript(hb, spec, bold)
        this.loaded.set(`${spec.id}:${bold && spec.boldFile ? "b" : "r"}`, l)
      }
    }
  }

  private script(spec: ScriptSpec, bold: boolean): LoadedScript | null {
    return this.loaded.get(`${spec.id}:${bold && spec.boldFile ? "b" : "r"}`) ?? null
  }

  /** Normalises (NFC), removes control and bidi-format characters, and counts what no font can draw. */
  clean(text: string, count = true): string {
    let out = ""
    for (const ch of String(text ?? "").normalize("NFC")) {
      if (ch === "\n") out += "\n"
      else if (ch === "\t") out += "  "
      else {
        const cp = ch.codePointAt(0)!
        if (STRIP(cp) && cp !== 0x200c && cp !== 0x200d) continue
        if (this.canDraw(cp)) out += ch
        else {
          if (count) this.unsupported += 1
          out += REPLACEMENT
        }
      }
    }
    return out
  }

  private canDraw(cp: number): boolean {
    if (this.interSet.has(cp)) return true
    const s = scriptOf(cp)
    if (s) {
      const l = this.script(s, false)
      return l ? l.unicodes.has(cp) || cp === 0x200c || cp === 0x200d : false
    }
    return cp === 0x200c || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)
  }

  /** Splits clean text into runs. Spaces and punctuation between two characters of the same script stay inside that script's run (word order of right-to-left text). */
  private runs(text: string): Run[] {
    const chars = [...text]
    const kind: Array<string | null | "neutral"> = chars.map((ch) => {
      const cp = ch.codePointAt(0)!
      const s = scriptOf(cp)
      if (s) return s.id
      if (isCombining(cp) && !this.interSet.has(cp)) return "neutral"
      return null
    })
    // A neutral (non-script) character between two characters of one script joins that script when its font has the glyph.
    for (let i = 0; i < chars.length; i += 1) {
      if (kind[i] !== null && kind[i] !== "neutral") continue
      const cp = chars[i].codePointAt(0)!
      const isNeutral = /[\s\p{P}\p{N}]/u.test(chars[i]) || kind[i] === "neutral"
      if (!isNeutral) continue
      let l = i - 1
      while (l >= 0 && (kind[l] === "neutral" || kind[l] === null) && /[\s\p{P}\p{N}]/u.test(chars[l])) l -= 1
      let r = i + 1
      while (r < chars.length && (kind[r] === "neutral" || kind[r] === null) && /[\s\p{P}\p{N}]/u.test(chars[r])) r += 1
      const left = l >= 0 ? kind[l] : null
      const right = r < chars.length ? kind[r] : null
      if (left && right && left === right && left !== "neutral") {
        const spec = SCRIPTS.find((s) => s.id === left)!
        const loaded = this.script(spec, false)
        if (loaded && loaded.unicodes.has(cp)) kind[i] = left
      } else if (kind[i] === "neutral") kind[i] = null
    }
    const runs: Run[] = []
    for (let i = 0; i < chars.length; i += 1) {
      const k = kind[i] === "neutral" ? null : (kind[i] as string | null)
      const last = runs[runs.length - 1]
      if (last && last.script === k) last.text += chars[i]
      else runs.push({ script: k, text: chars[i] })
    }
    return runs
  }

  private shape(spec: ScriptSpec, bold: boolean, text: string): Shaped {
    const key = `${spec.id}:${bold ? "b" : "r"}:${text}`
    const hit = this.shapeCache.get(key)
    if (hit) return hit
    const l = this.script(spec, bold)!
    const hb = this.hb!
    const buf = new hb.Buffer()
    buf.addText(text)
    buf.guessSegmentProperties()
    hb.shape(l.font, buf)
    const infos = buf.getGlyphInfos()
    const pos = buf.getGlyphPositions()
    const advances = pos.map((p) => p.xAdvance)
    const out: Shaped = {
      advances,
      offsets: pos.map((p) => [p.xOffset, p.yOffset]),
      paths: infos.map((g) => l.font.glyphToPath(g.codepoint)),
      upem: l.face.upem,
      width: advances.reduce((a, b) => a + b, 0),
    }
    buf.destroy?.()
    this.shapeCache.set(key, out)
    return out
  }

  fontFor(weight: Weight): PDFFont {
    return weight === "m" ? this.mono : this.inter[weight]
  }

  /** Width of a clean string in points. */
  width(text: string, weight: Weight, size: number): number {
    if (weight === "m") return this.mono.widthOfTextAtSize(this.monoSafe(text), size)
    const key = `${weight}|${size}|${text}`
    const hit = this.widthCache.get(key)
    if (hit !== undefined) return hit
    let w = 0
    for (const run of this.runs(text)) {
      if (run.script === null) w += this.inter[weight].widthOfTextAtSize(run.text, size)
      else w += (this.shape(SCRIPTS.find((s) => s.id === run.script)!, weight === "b", run.text).width / this.shapeUnits(run.script, weight)) * size
    }
    if (this.widthCache.size > 20000) this.widthCache.clear()
    this.widthCache.set(key, w)
    return w
  }

  private shapeUnits(scriptId: string, weight: Weight): number {
    const spec = SCRIPTS.find((s) => s.id === scriptId)!
    return this.script(spec, weight === "b")!.face.upem
  }

  private monoSafe(text: string) {
    return text.replace(/[^\x20-\x7e]/g, "?")
  }

  /** Draws one line of clean text with its baseline at `baseline` (PDF coordinates). Returns the advance. */
  draw(page: PDFPage, text: string, x: number, baseline: number, weight: Weight, size: number, color: RGB, pageHeight: number): number {
    if (!text) return 0
    if (weight === "m") {
      const t = this.monoSafe(text)
      page.drawText(t, { x, y: baseline, size, font: this.mono, color })
      return this.mono.widthOfTextAtSize(t, size)
    }
    let pen = x
    for (const run of this.runs(text)) {
      if (run.script === null) {
        page.drawText(run.text, { x: pen, y: baseline, size, font: this.inter[weight], color })
        pen += this.inter[weight].widthOfTextAtSize(run.text, size)
        continue
      }
      const spec = SCRIPTS.find((s) => s.id === run.script)!
      const shaped = this.shape(spec, weight === "b", run.text)
      const scale = size / shaped.upem
      let d = ""
      let gx = 0
      shaped.paths.forEach((path, i) => {
        if (path) d += transformPath(path, pen + (gx + shaped.offsets[i][0]) * scale, baseline + shaped.offsets[i][1] * scale, scale, pageHeight)
        gx += shaped.advances[i]
      })
      if (d) {
        page.drawSvgPath(d, { x: 0, y: pageHeight, color, borderWidth: 0 })
        this.vectorRuns += 1
      }
      pen += gx * scale
    }
    return pen - x
  }

  /** Greedy word wrap on spaces; words wider than the line are split between characters (never inside a combining sequence). */
  wrap(text: string, weight: Weight, size: number, width: number): string[] {
    const lines: string[] = []
    for (const paragraph of text.split("\n")) {
      if (paragraph.trim() === "") {
        lines.push("")
        continue
      }
      let line = ""
      for (const word of paragraph.split(/[ \t]+/).filter(Boolean)) {
        let w = word
        while (this.width(w, weight, size) > width) {
          const chars = [...w]
          let cut = chars.length
          while (cut > 1 && this.width(chars.slice(0, cut).join(""), weight, size) > width) cut -= 1
          while (cut > 1 && cut < chars.length && isCombining(chars[cut].codePointAt(0)!)) cut -= 1
          if (line) {
            lines.push(line)
            line = ""
          }
          lines.push(chars.slice(0, cut).join(""))
          w = chars.slice(cut).join("")
        }
        const candidate = line ? `${line} ${w}` : w
        if (this.width(candidate, weight, size) <= width) line = candidate
        else {
          lines.push(line)
          line = w
        }
      }
      lines.push(line)
    }
    return lines
  }
}

const NUM = /-?\d*\.?\d+(?:e-?\d+)?/gi

/** Transforms an SVG path in glyph space (y up, font units) to page space for pdf-lib's drawSvgPath at (0, pageHeight) (y flipped). */
function transformPath(path: string, ox: number, oy: number, scale: number, pageHeight: number): string {
  const out: string[] = []
  const re = /([MLQCZ])([^MLQCZ]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path))) {
    const cmd = m[1]
    if (cmd === "Z") {
      out.push("Z")
      continue
    }
    const nums = (m[2].match(NUM) ?? []).map(Number)
    const pts: string[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const px = ox + nums[i] * scale
      const py = pageHeight - (oy + nums[i + 1] * scale)
      pts.push(`${px.toFixed(2)} ${py.toFixed(2)}`)
    }
    out.push(`${cmd} ${pts.join(" ")}`)
  }
  return out.join(" ")
}
