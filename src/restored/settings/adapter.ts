// Canonical adapter for the restored Settings (compliance profile) UI.
//
// The original keeps a draft in memory and writes the whole profile to browser storage with "Save profile". The canonical
// company-profile domain records PER-FACT, effective-dated operations instead, so "Save profile" here is a BATCH of canonical
// operations: one per changed fact (operating scope, driver minimums, each changed rule), each in its own transaction with its
// own Master Register event. Every item gets its own result; a failed or refused item is reported and stays in the draft, and
// nothing is reported as saved unless its operation succeeded.
//
//   original                          canonical
//   --------------------------------  ------------------------------------------------------------------------------
//   rule: Applies / Doesn't apply     setRuleApplicability (first assertion, or a real-world change)
//   rule: Not configured              clearRuleApplicability (ends the assertion; history kept). No assertion = not configured.
//   jurisdiction (derived from the    operating scope (CANADA | UNITED_STATES | CANADA_AND_UNITED_STATES), recorded only when
//   company region, never saved)      the user records it; never guessed from the company region
//   minimum driver age / experience   setDriverRequirements (both together). The old defaults 21 / 24 are NOT canonical: "Not recorded"
//   (default 21 / 24)
//   (none)                            correctOperatingScope / correctRuleApplicability / correctDriverRequirements: the recorded
//                                     value was WRONG (kept and flagged). Chosen with "Record as a correction" at save time.

import { DRIVER_AGE_YEARS, DRIVER_EXPERIENCE_MONTHS, type OperatingScope } from "@/lib/company-profile/definitions";
import type { CompanyProfileView } from "@/lib/company-profile/types";
import { RULES, type RuleValue } from "./rules";

export type SettingsTransport = {
  read(): Promise<CompanyProfileView>;
  act(payload: Record<string, unknown>): Promise<unknown>;
};

export class SettingsRequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SettingsRequestError";
    this.status = status;
  }
}

/** Transport over the company Settings API (browser). The company id is in the URL; the body never names a company. */
export function fetchSettingsTransport(companyId: string): SettingsTransport {
  const base = `/api/companies/${encodeURIComponent(companyId)}/settings`;
  return {
    async read() {
      let response: Response;
      try {
        response = await fetch(base, { cache: "no-store" });
      } catch {
        throw new SettingsRequestError("Settings could not be loaded. This is a temporary error, not an empty profile.");
      }
      if (response.status === 403) throw new SettingsRequestError("You are not permitted to view this company's operating profile.", 403);
      if (!response.ok) throw new SettingsRequestError("Settings could not be loaded. This is a temporary error, not an empty profile.", response.status);
      return (await response.json()) as CompanyProfileView;
    },
    async act(payload) {
      let response: Response;
      try {
        response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      } catch {
        throw new SettingsRequestError("The setting could not be saved (the request did not complete).");
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new SettingsRequestError(body?.error ?? "The setting could not be saved.", response.status);
      return body;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// canonical -> original draft model
// ---------------------------------------------------------------------------------------------------------------------

export type Jurisdiction = "canada" | "us" | "both";

export type SettingsState = {
  /** null = no operating scope has been recorded. */
  scope: OperatingScope | null;
  /** "" = not recorded (the original pre-filled 21 / 24; those defaults are not canonical). */
  minimumDriverAge: string;
  minimumDriverExperience: string;
  rules: Record<string, RuleValue>;
};

export const ALL_RULE_IDS: string[] = Object.values(RULES)
  .flat()
  .map((rule) => rule.id);

export const ruleCode = (id: string): string => id.toUpperCase();

export function cloneSettings(settings: SettingsState): SettingsState {
  return { scope: settings.scope, minimumDriverAge: settings.minimumDriverAge, minimumDriverExperience: settings.minimumDriverExperience, rules: { ...settings.rules } };
}

/** The recorded answers only: a rule without an assertion is "not-configured" (a catalogue default is never an assertion). */
export function toSettingsState(view: CompanyProfileView): SettingsState {
  const rules: Record<string, RuleValue> = Object.fromEntries(ALL_RULE_IDS.map((id) => [id, "not-configured" as RuleValue]));
  for (const entry of view.rules) {
    const id = entry.rule.code.toLowerCase();
    if (!(id in rules)) continue;
    rules[id] = entry.assertion ? (entry.assertion.applicability === "APPLIES" ? "applies" : "does-not-apply") : "not-configured";
  }
  const drivers = view.driverRequirements.assertion;
  return {
    scope: view.operatingScope.assertion?.operatingScope ?? null,
    minimumDriverAge: drivers ? String(drivers.minimumDriverAgeYears) : "",
    minimumDriverExperience: drivers ? String(drivers.minimumDriverExperienceMonths) : "",
    rules,
  };
}

/** Rules whose region does not match the company's recorded operating scope are disabled; with no scope recorded, none are. */
export function jurisdictionOf(scope: OperatingScope | null): Jurisdiction | null {
  if (scope === "CANADA") return "canada";
  if (scope === "UNITED_STATES") return "us";
  if (scope === "CANADA_AND_UNITED_STATES") return "both";
  return null;
}

export const SCOPE_CHOICES: { value: OperatingScope; label: string; description: string }[] = [
  { value: "CANADA", label: "Canada only", description: "Rules for Canadian operations are relevant." },
  { value: "UNITED_STATES", label: "United States only", description: "Rules for US operations are relevant." },
  { value: "CANADA_AND_UNITED_STATES", label: "Canada and United States (cross-border)", description: "Rules for both countries are relevant." },
];

// ---------------------------------------------------------------------------------------------------------------------
// planning a save
// ---------------------------------------------------------------------------------------------------------------------

export type RecordAs = "change" | "correct";

export type PlanItem =
  | { kind: "step"; key: string; label: string; payload: Record<string, unknown> }
  | { kind: "refused"; key: string; label: string; reason: string };

export type ItemResult = { key: string; label: string; status: "saved" | "failed" | "refused"; message?: string };

const DRIVER_KEY = "driver";
const SCOPE_KEY = "scope";
export const ruleKey = (id: string) => `rule:${id}`;

const wholeNumber = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * The canonical operations that turn the saved profile into the draft. A REAL-WORLD change (default) keeps the earlier value as
 * history; "correct" records that the earlier value was wrong. A correction can only replace a value with another value: it
 * cannot turn a recorded answer back into "Not configured" (no such operation exists), so that item is refused rather than
 * silently recorded as a change.
 */
export function planSave(view: CompanyProfileView, saved: SettingsState, draft: SettingsState, recordAs: RecordAs): PlanItem[] {
  const items: PlanItem[] = [];

  if (draft.scope !== saved.scope && draft.scope !== null) {
    const period = view.operatingScope.assertion;
    items.push(
      period && recordAs === "correct"
        ? { kind: "step", key: SCOPE_KEY, label: "Operating scope (correction)", payload: { action: "correctOperatingScope", periodId: period.id, operatingScope: draft.scope } }
        : { kind: "step", key: SCOPE_KEY, label: "Operating scope", payload: { action: "setOperatingScope", operatingScope: draft.scope } },
    );
  }

  if (draft.minimumDriverAge !== saved.minimumDriverAge || draft.minimumDriverExperience !== saved.minimumDriverExperience) {
    const age = wholeNumber(draft.minimumDriverAge);
    const experience = wholeNumber(draft.minimumDriverExperience);
    const label = "Driver minimums";
    if (draft.minimumDriverAge.trim() === "" && draft.minimumDriverExperience.trim() === "") {
      items.push({ kind: "refused", key: DRIVER_KEY, label, reason: "Recorded driver minimums cannot be cleared: there is no operation that removes them. Enter new values (or discard)." });
    } else if (age === null || experience === null) {
      items.push({ kind: "refused", key: DRIVER_KEY, label, reason: "Enter both the minimum age (years) and the minimum experience (months) as whole numbers; they are recorded together." });
    } else if (age < DRIVER_AGE_YEARS.min || age > DRIVER_AGE_YEARS.max) {
      items.push({ kind: "refused", key: DRIVER_KEY, label, reason: `The minimum driver age must be between ${DRIVER_AGE_YEARS.min} and ${DRIVER_AGE_YEARS.max} years.` });
    } else if (experience < DRIVER_EXPERIENCE_MONTHS.min || experience > DRIVER_EXPERIENCE_MONTHS.max) {
      items.push({ kind: "refused", key: DRIVER_KEY, label, reason: `The minimum experience must be between ${DRIVER_EXPERIENCE_MONTHS.min} and ${DRIVER_EXPERIENCE_MONTHS.max} months.` });
    } else {
      const period = view.driverRequirements.assertion;
      items.push(
        period && recordAs === "correct"
          ? { kind: "step", key: DRIVER_KEY, label: `${label} (correction)`, payload: { action: "correctDriverRequirements", periodId: period.id, minimumDriverAgeYears: age, minimumDriverExperienceMonths: experience } }
          : { kind: "step", key: DRIVER_KEY, label, payload: { action: "setDriverRequirements", minimumDriverAgeYears: age, minimumDriverExperienceMonths: experience } },
      );
    }
  }

  const titles = new Map(Object.values(RULES).flat().map((rule) => [rule.id, rule.title]));
  for (const id of ALL_RULE_IDS) {
    const wanted = draft.rules[id] ?? "not-configured";
    if (wanted === (saved.rules[id] ?? "not-configured")) continue;
    const label = titles.get(id) ?? id;
    const entry = view.rules.find((candidate) => candidate.rule.code === ruleCode(id));
    const period = entry?.assertion ?? null;
    if (wanted === "not-configured") {
      items.push(
        recordAs === "correct"
          ? { kind: "refused", key: ruleKey(id), label, reason: "A correction cannot turn a recorded answer back into Not configured. Save it as a real-world change instead (the earlier answer stays in history)." }
          : { kind: "step", key: ruleKey(id), label, payload: { action: "clearRuleApplicability", ruleCode: ruleCode(id) } },
      );
    } else {
      const applicability = wanted === "applies" ? "APPLIES" : "DOES_NOT_APPLY";
      items.push(
        period && recordAs === "correct"
          ? { kind: "step", key: ruleKey(id), label: `${label} (correction)`, payload: { action: "correctRuleApplicability", periodId: period.id, applicability } }
          : { kind: "step", key: ruleKey(id), label, payload: { action: "setRuleApplicability", ruleCode: ruleCode(id), applicability } },
      );
    }
  }
  return items;
}

/** Does saving this draft correct or change something already recorded (so the change-versus-correction choice matters)? */
export function touchesRecordedFacts(view: CompanyProfileView, saved: SettingsState, draft: SettingsState): boolean {
  if (draft.scope !== saved.scope && saved.scope !== null) return true;
  if ((draft.minimumDriverAge !== saved.minimumDriverAge || draft.minimumDriverExperience !== saved.minimumDriverExperience) && view.driverRequirements.assertion) return true;
  return ALL_RULE_IDS.some((id) => (draft.rules[id] ?? "not-configured") !== (saved.rules[id] ?? "not-configured") && (saved.rules[id] ?? "not-configured") !== "not-configured");
}

/**
 * Runs the plan item by item. A failing item is reported and the rest still run: they are independent facts, so one refusal must
 * not hide or block the others. The items are NOT one transaction (each is its own canonical operation); this is stated to the user.
 */
export async function runPlan(transport: SettingsTransport, plan: PlanItem[]): Promise<ItemResult[]> {
  const results: ItemResult[] = [];
  for (const item of plan) {
    if (item.kind === "refused") {
      results.push({ key: item.key, label: item.label, status: "refused", message: item.reason });
      continue;
    }
    try {
      await transport.act(item.payload);
      results.push({ key: item.key, label: item.label, status: "saved" });
    } catch (error) {
      results.push({ key: item.key, label: item.label, status: "failed", message: error instanceof Error && error.message ? error.message : "The setting could not be saved." });
    }
  }
  return results;
}

/**
 * The draft after a save attempt: every item that was saved now equals the freshly loaded record, and every item that failed or
 * was refused keeps the user's draft value so the unsaved change stays visible (still dirty) instead of silently reverting.
 */
export function reconcileDraft(fresh: SettingsState, draft: SettingsState, results: ItemResult[]): SettingsState {
  const next = cloneSettings(fresh);
  for (const result of results) {
    if (result.status === "saved") continue;
    if (result.key === SCOPE_KEY) next.scope = draft.scope;
    else if (result.key === DRIVER_KEY) {
      next.minimumDriverAge = draft.minimumDriverAge;
      next.minimumDriverExperience = draft.minimumDriverExperience;
    } else if (result.key.startsWith("rule:")) {
      const id = result.key.slice("rule:".length);
      next.rules[id] = draft.rules[id];
    }
  }
  return next;
}

export const settingsDirty = (a: SettingsState, b: SettingsState): boolean => JSON.stringify(a) !== JSON.stringify(b);
