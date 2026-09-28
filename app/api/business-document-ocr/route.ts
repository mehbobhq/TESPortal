import { NextRequest, NextResponse } from "next/server";
import { getGoogleAccessToken } from "@/lib/google/auth";
import { businessDocumentAiProcessorId, documentAiLocation, googleProjectId } from "@/lib/google/config";

export const runtime = "nodejs";

type Entity = { type?: string; mentionText?: string; confidence?: number; normalizedValue?: { text?: string } };
type DocumentResult = { document?: { text?: string; entities?: Entity[]; pages?: Array<{ tokens?: Array<{ layout?: { confidence?: number } }> }> } };

const first = (text: string, patterns: RegExp[]) => patterns.map((pattern) => text.match(pattern)?.[1]?.trim()).find(Boolean) || "";
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({ error: "A supported PDF or image is required." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Maximum OCR file size is 20 MB." }, { status: 413 });
    let project: string, processor: string, location: string;
    try {
      project = googleProjectId();
      processor = businessDocumentAiProcessorId();
      location = documentAiLocation();
    } catch {
      return NextResponse.json({ error: "Corporate OCR processor is not configured. The evidence is saved and can still be reviewed manually." }, { status: 503 });
    }
    const token = await getGoogleAccessToken();
    const content = Buffer.from(await file.arrayBuffer()).toString("base64");
    const response = await fetch(`https://${location}-documentai.googleapis.com/v1/projects/${project}/locations/${location}/processors/${processor}:process`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ rawDocument: { content, mimeType: file.type } }),
    });
    if (!response.ok) throw new Error(`Document AI returned ${response.status}.`);
    const result = await response.json() as DocumentResult;
    const doc = result.document;
    const text = (doc?.text || "").slice(0, 50000);
    const entities = doc?.entities || [];
    const findEntity = (names: string[]) => entities.find((entity) => names.some((name) => entity.type?.toLowerCase().includes(name)))?.normalizedValue?.text || entities.find((entity) => names.some((name) => entity.type?.toLowerCase().includes(name)))?.mentionText || "";
    const tokenConfidences = (doc?.pages || []).flatMap((page) => (page.tokens || []).map((token) => token.layout?.confidence).filter((value): value is number => typeof value === "number"));
    const confidence = tokenConfidences.length ? tokenConfidences.reduce((sum, value) => sum + value, 0) / tokenConfidences.length : null;
    return NextResponse.json({
      text, confidence,
      fields: {
        legalName: findEntity(["organization", "company_name", "legal_name"]) || first(text, [/\b(?:corporation|company|legal)\s+name\s*[:\-]\s*([^\n]{3,120})/i]),
        corporateNumber: findEntity(["corporation_number", "corporate_number", "registration_number"]) || first(text, [/\b(?:corporation|corporate|registration)\s+(?:number|no\.?|#)\s*[:\-]?\s*([A-Z0-9-]{4,30})/i]),
        incorporationDate: findEntity(["incorporation_date", "date_of_incorporation"]) || first(text, [/\b(?:date of incorporation|incorporated on)\s*[:\-]?\s*([^\n]{6,35})/i]),
      },
    });
  } catch (error) {
    console.error("Corporate OCR failed:", error);
    return NextResponse.json({ error: "Corporate OCR failed. The evidence remains available for manual review." }, { status: 502 });
  }
}
