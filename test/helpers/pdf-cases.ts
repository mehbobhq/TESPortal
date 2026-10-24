import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PdfInput } from "@/lib/driver-application/pdf/render";
import { planSha256, resolvePlan, type ApplicationPlan } from "@/lib/driver-application/plan";
import { sha256Text } from "@/lib/driver-application/canonical";
import { buildSnapshot, snapshotSha256 } from "@/lib/driver-application/snapshot";
import { evaluateScope, validateScopeInput, type ScopeInput } from "@/lib/driver-prospects/operating-scope";
import { validAnswers } from "./driver-application-fill";

const CDL = { cmvOperation: "YES", cdlRequired: "YES" } as const;
export type CaseName = "A-short" | "B-long-history" | "C-cross-border" | "D-complex-declarations" | "E-international";

function planFor(input: ScopeInput, carrier: "US" | "CA", hr: Record<string, { enabled: boolean; acknowledgedRestriction?: boolean }> = {}): ApplicationPlan {
  const v = validateScopeInput(input);
  if (!v.ok) throw new Error(v.errors.join("; "));
  const e = evaluateScope(v.value);
  return resolvePlan({ scope: v.value, profile: e.profile!, carrierCountry: carrier, hrSelections: hr, gates: { vaultReady: false, approvedSensitiveFields: [] } });
}

const iso = (y: number, m: number, d = 15) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const thisYear = new Date().getUTCFullYear();

export function employers(count: number, yearsBack: number, names?: string[]): Array<Record<string, unknown>> {
  const span = yearsBack / count;
  return Array.from({ length: count }, (_, i) => {
    const start = thisYear - yearsBack + Math.floor(i * span);
    const end = i === count - 1 ? undefined : thisYear - yearsBack + Math.floor((i + 1) * span);
    return {
      employer: names?.[i] ?? `Synthetic Freight Carrier ${i + 1} Incorporated`, city: ["Toronto", "Columbus", "Calgary", "Dallas", "Winnipeg", "Reno"][i % 6], region: ["ON", "OH", "AB", "TX", "MB", "NV"][i % 6],
      phone: `416-555-01${String(i).padStart(2, "0")}`, email: `hr${i + 1}@carrier${i + 1}.example.com`, position: i % 2 ? "Tractor-trailer driver, long haul" : "Local pickup and delivery driver",
      from: iso(start, 1 + (i % 11)), ...(end ? { to: iso(end, 1 + (i % 11), 10) } : {}), reason_for_leaving: end ? "Seeking a role with more regular home time" : "", commercial_driving: "yes", subject_to_fmcsr: "yes", safety_sensitive_dot: "yes", may_contact: "yes",
    };
  });
}
export function addresses(count: number, yearsBack: number): Array<Record<string, unknown>> {
  const span = yearsBack / count;
  return Array.from({ length: count }, (_, i) => {
    const start = thisYear - yearsBack + Math.floor(i * span);
    const end = i === count - 1 ? undefined : thisYear - yearsBack + Math.floor((i + 1) * span);
    return { street: `${100 + i * 17} Maple Ridge Road, Unit ${i + 2}`, city: ["Mississauga", "Dayton", "Edmonton", "Plano"][i % 4], country: i % 2 ? "US" : "CA", region: i % 2 ? "OH" : "ON", postal: i % 2 ? "45402" : "L5B 2C9", from: iso(start, 2), ...(end ? { to: iso(end, 1, 28) } : {}) };
  });
}

export async function buildCase(name: CaseName): Promise<{ input: PdfInput; answers: Record<string, unknown> }> {
  let plan: ApplicationPlan;
  let overrides: Record<string, unknown> = {};
  let company = "Prairie Freight Ltd";
  let applicant = "Pat Synthetic";
  let tweak: (p: ApplicationPlan) => void = () => {};
  switch (name) {
    case "A-short":
      plan = planFor({ kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] }, "CA");
      overrides = { "identity.legal_first_name": "Pat", "identity.legal_last_name": "Synthetic" };
      break;
    case "B-long-history":
      plan = planFor({ kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: CDL }, "US");
      company = "Heartland Interstate Carriers, LLC";
      applicant = "Morgan Longhaul";
      overrides = { "identity.legal_first_name": "Morgan", "identity.legal_last_name": "Longhaul", "address.history": addresses(6, 10), "employment.history": employers(12, 10) };
      break;
    case "C-cross-border":
      plan = planFor({ kind: "CROSS_BORDER", usJurisdictions: ["MI"], caJurisdictions: ["ON"], characteristics: { ...CDL, pspIntended: true } }, "CA", { professional_references: { enabled: true }, work_availability: { enabled: true } });
      company = "Great Lakes Cross-Border Transport Inc.";
      applicant = "Jordan Borderline";
      overrides = { "identity.legal_first_name": "Jordan", "identity.legal_last_name": "Borderline", "address.history": addresses(3, 10), "employment.history": employers(4, 10) };
      break;
    case "D-complex-declarations": {
      plan = planFor({ kind: "US_INTRASTATE", usJurisdictions: ["TX"], characteristics: CDL }, "US");
      company = "Lone Star Carriers LLC";
      applicant = "Casey Disclosure";
      const long = "On a wet night near the junction the trailer began to slide while I was reducing speed for a stalled vehicle; I steered into the shoulder, struck a guardrail, and the unit came to rest facing the wrong way. No other vehicle was involved. The responding officer completed a report and I was later retrained by the carrier. ".repeat(3).slice(0, 790);
      overrides = {
        "identity.legal_first_name": "Casey", "identity.legal_last_name": "Disclosure", "employment.history": employers(5, 10), "licence.has_commercial_licence": "yes", "licence.number": "D12345678",
        "licence.denied_suspended_revoked": "yes", "licence.denied_suspended_revoked_details": "My licence was suspended for 30 days in 2019 after an unpaid fine was misrecorded by the court. The court corrected the record and the licence was reinstated the same month. ".repeat(6).slice(0, 950),
        "experience.has_accidents_3y": "yes", "experience.accidents": Array.from({ length: 4 }, (_, i) => ({ date: iso(thisYear - 1, 2 + i * 2, 11), location: ["Waco, Texas", "Amarillo, Texas", "Laredo, Texas", "Tyler, Texas"][i], fatalities: 0, injuries: i === 3 ? 1 : 0, hazmat_spill: "no", description: long })),
        "experience.has_violations_3y": "yes", "experience.violations": Array.from({ length: 3 }, (_, i) => ({ date: iso(thisYear - 1, 3 + i, 20), offence: ["Speeding 8 mph over", "Improper lane change", "Failure to display a current inspection sticker"][i], location: "Municipal court, Travis County, Texas", commercial_vehicle: i === 1 ? "yes" : "no" })),
        "employment.gap_explanation": "I left the industry for six weeks to care for a family member and returned to full-time driving once care arrangements were in place. ".repeat(10).slice(0, 1400),
      };
      tweak = (p) => {
        const c = p.consents[0];
        c.text = Array.from({ length: 14 }, (_, i) => `${i + 1}. I authorize the hiring carrier and its designated agents to obtain, review and retain the records described in this disclosure for the stated purpose, including records held by licensing authorities, previous employers and testing programs, and I understand that I may ask what information was obtained about me and may request a correction where information is inaccurate. This authorization is limited to the purpose and parties named above and does not extend to any other use.`).join("\n\n");
        c.textSha256 = sha256Text(c.text);
      };
      break;
    }
    case "E-international":
      plan = planFor({ kind: "CROSS_BORDER", usJurisdictions: ["NY"], caJurisdictions: ["QC"], characteristics: CDL }, "US");
      company = "Nordic–Atlantic Fleet Services, S.A.";
      applicant = "Đặng Thị Ngọc-Hạnh Żołądź-Ömer Ünal Vasíliev";
      overrides = {
        "identity.legal_first_name": "Đặng Thị Ngọc-Hạnh", "identity.legal_last_name": "Żołądź-Ömer Ünal Vasíliev", "identity.legal_middle_name": "Алексей Ελένη",
        "address.history": [
          { street: "ул. Ленина, д. 12, кв. 45", city: "Москва (Moscow)", country: "OTHER", postal: "101000", from: iso(thisYear - 10, 1), to: iso(thisYear - 6, 6) },
          { street: "Rue Saint-Édouard 1250, appartement 3", city: "Montréal", country: "CA", region: "QC", postal: "H2S 1T4", from: iso(thisYear - 6, 7), to: iso(thisYear - 2, 3) },
          { street: "Λεωφόρος Αλεξάνδρας 77", city: "Brooklyn", country: "US", region: "NY", postal: "11201", from: iso(thisYear - 2, 4) },
        ],
        "employment.history": employers(3, 10, ["Fuhrpark Müller & Söhne GmbH", "Transportes Peña y Hermanos S.L.", "Przewozy Łódzkie Sp. z o.o."]),
      };
      break;
  }
  tweak(plan);
  const answers = validAnswers(plan, overrides);
  const consents = plan.consents.filter((c) => !c.external).map((c, i) => ({ key: c.key, version: c.version, textSha256: c.textSha256, acceptedAt: `2026-03-0${1 + (i % 8)}T15:0${i % 6}:05.000Z`, signatureName: applicant, legalStatus: c.legalStatus, jurisdiction: plan.context.involvesUS && plan.context.involvesCA ? "US+CA" : plan.context.involvesUS ? "US" : "CA", purpose: c.purpose }));
  const uploads = plan.fields.filter((f) => f.type === "upload").slice(0, 3).map((f, i) => ({ fieldId: f.id, slot: "", documentId: `00000000-0000-4000-8000-00000000000${i + 1}`, documentClass: f.evidence!.documentClass, filename: `scan-${i + 1}.pdf`, byteSize: 120000 + i, state: "stored" }));
  const snapshot = buildSnapshot({ plan, planSha256: planSha256(plan), answers, consents: consents.map(({ key, version, textSha256, acceptedAt, signatureName }) => ({ key, version, textSha256, acceptedAt, signatureName })), presentations: [], uploads, sensitiveCollected: [] });
  const logoPng = await readFile(join(process.cwd(), "public", "branding", "TES-Logo.png")).then((b) => new Uint8Array(b));
  return {
    answers,
    input: { companyName: company, applicantName: applicant, receiptId: `TES-261024-${name.slice(0, 1)}0FIXTURE1`, submittedAt: "2026-10-24T14:05:09.000Z", applicationId: "11111111-2222-4333-8444-555555555555", plan, planSha256: planSha256(plan), snapshot, snapshotSha256: snapshotSha256(snapshot), consents, logoPng },
  };
}
