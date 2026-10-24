import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** True when poppler's pdftotext is installed (the PDFs embed CID fonts, so an independent extractor is needed to read them back). */
export const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Extracts the text of a PDF with an independent tool. Returns "" when none is available (callers must skip their text assertions then). */
export function pdfText(bytes: Uint8Array): string {
  if (!hasPdftotext) return "";
  const file = join(mkdtempSync(join(tmpdir(), "pdftext-")), "doc.pdf");
  writeFileSync(file, bytes);
  return execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", file, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
}
