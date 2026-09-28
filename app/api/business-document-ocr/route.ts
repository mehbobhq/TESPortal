import { createSign } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type Entity = { type?: string; mentionText?: string; confidence?: number; normalizedValue?: { text?: string } };
type DocumentResult = { document?: { text?: string; entities?: Entity[]; pages?: Array<{ tokens?: Array<{ layout?: { confidence?: number } }> }> } };

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
async function accessToken(credentials: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256"); signer.update(`${header}.${claims}`); signer.end();
  const assertion = `${header}.${claims}.${base64url(signer.sign(credentials.private_key))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  if (!response.ok) throw new Error("Google authentication failed.");
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Google authentication returned no token.");
  return data.access_token;
}

const first = (text: string, patterns: RegExp[]) => patterns.map((pattern) => text.match(pattern)?.[1]?.trim()).find(Boolean) || "";
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({ error: "A supported PDF or image is required." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Maximum OCR file size is 20 MB." }, { status: 413 });
    const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const project = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const processor = process.env.GOOGLE_BUSINESS_DOCUMENT_AI_PROCESSOR_ID;
    const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION || "us";
    if (!json || !project || !processor) return NextResponse.json({ error: "Corporate OCR processor is not configured. The evidence is saved and can still be reviewed manually." }, { status: 503 });
    const token = await accessToken(JSON.parse(json));
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
