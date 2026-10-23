import { inflateSync } from "node:zlib";

/** Extracts the text drawn by pdf-lib (hex or literal strings in Tj operators) so tests can assert on what a PDF actually says. */
export function pdfText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const latin = buffer.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    let content = buffer.subarray(start, end);
    try {
      content = inflateSync(content);
    } catch {
      /* not compressed */
    }
    const text = content.toString("latin1");
    for (const t of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
    for (const t of text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(t[1].replace(/\\(.)/g, "$1"));
    out.push("\n");
  }
  return out.join("\n");
}
