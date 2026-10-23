import type { ItemField } from "@/lib/driver-application/catalogue/types";
import type { ApplicationPlan, PlanField } from "@/lib/driver-application/plan";
import { applicableFields, optionValues, type Answers } from "@/lib/driver-application/validate";

/** A real minimal PNG and PDF so the upload validator (signature + size) accepts them. */
export const PNG_BYTES = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
export const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const yearsAgo = (n: number) => `${new Date().getUTCFullYear() - n}-01-15`;

function sampleItem(field: ItemField): unknown {
  switch (field.type) {
    case "phone": return "416-555-0142";
    case "email": return "employer@example.com";
    case "date": return field.id === "to" ? undefined : yearsAgo(12);
    case "yesno": return "no";
    case "number": return field.validation?.min ?? 1;
    case "select": return field.optionsRef ? "ON" : (optionValues(field.options, field.optionsRef)?.[0] ?? "x");
    default: return field.id === "postal" ? "M5V 2T6" : "Sample";
  }
}

export function sampleValue(field: PlanField): unknown {
  switch (field.type) {
    case "repeatable": {
      const entry: Record<string, unknown> = {};
      for (const f of field.itemFields ?? []) {
        const v = sampleItem(f);
        if (v !== undefined) entry[f.id] = v;
      }
      return Array.from({ length: Math.max(1, field.validation?.minItems ?? 1) }, () => ({ ...entry }));
    }
    case "phone": return "416-555-0142";
    case "email": return "applicant@example.com";
    case "date": return field.id === "identity.date_of_birth" ? "1985-04-12" : field.validation?.notPast ? `${new Date().getUTCFullYear() + 4}-06-01` : "2020-01-15";
    case "number": return field.validation?.min ?? 1;
    case "yesno": return "no";
    case "select": return optionValues(field.options, field.optionsRef)?.[0] ?? "x";
    case "multiselect": return [optionValues(field.options, field.optionsRef)?.[0] ?? "x"];
    case "textarea": return "Sample details for this answer.";
    default: return field.id === "licence.number" ? "D12345678" : "Sample";
  }
}

/** A complete, valid answer set for a plan. Conditional follow-ups stay hidden because every yes/no defaults to "no". */
export function validAnswers(plan: ApplicationPlan, overrides: Answers = {}): Answers {
  const answers: Answers = { ...overrides };
  for (let pass = 0; pass < 4; pass += 1) {
    for (const { field } of applicableFields(plan, answers)) {
      if (field.type === "upload" || field.type === "sensitive") continue;
      if (answers[field.id] === undefined) answers[field.id] = sampleValue(field);
    }
  }
  return answers;
}
