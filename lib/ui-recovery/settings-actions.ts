import "server-only"

import {
  clearRuleApplicability,
  CompanyProfileNotFoundError,
  correctDriverRequirements,
  correctOperatingScope,
  correctRuleApplicability,
  getCompanyProfile,
  setDriverRequirements,
  setOperatingScope,
  setRuleApplicability,
} from "@/lib/company-profile/service"
import type { CompanyProfileView } from "@/lib/company-profile/types"

export type SettingsActionResult = { status: number; body: unknown }

export class UnsupportedSettingsActionError extends Error {
  constructor() {
    super("Unsupported action.")
    this.name = "UnsupportedSettingsActionError"
  }
}

type PeriodKind = "scope" | "driver" | "rule"

/**
 * The correction operations are addressed by period id alone (the id carries its own company). The route's company comes from the
 * URL, so before a correction is performed the period must be one of THAT company's recorded periods; anything else is reported
 * exactly like a period that does not exist, and nothing is changed.
 */
async function assertPeriodBelongs(organizationId: string, kind: PeriodKind, periodId: unknown): Promise<void> {
  const profile: CompanyProfileView = await getCompanyProfile(organizationId)
  const known =
    kind === "scope"
      ? profile.operatingScope.history.map((period) => period.id)
      : kind === "driver"
        ? profile.driverRequirements.history.map((period) => period.id)
        : profile.rules.flatMap((entry) => entry.history.map((period) => period.id))
  if (typeof periodId !== "string" || !known.includes(periodId)) throw new CompanyProfileNotFoundError("Recorded period")
}

/**
 * Every Settings action the company Settings workspace can request. Each is an existing company-profile operation (own
 * validation, own Master Register event, own transaction): set / clear are REAL-WORLD changes, correct* flags a wrongly recorded
 * period. The company id is always the one from the URL.
 */
export async function performSettingsAction({ organizationId, body }: { organizationId: string; body: Record<string, unknown> }): Promise<SettingsActionResult> {
  const ok = (value: unknown): SettingsActionResult => ({ status: 200, body: value })
  switch (body.action) {
    case "setOperatingScope":
      return ok(await setOperatingScope({ organizationId, operatingScope: body.operatingScope }))
    case "correctOperatingScope":
      await assertPeriodBelongs(organizationId, "scope", body.periodId)
      return ok(await correctOperatingScope({ periodId: body.periodId, operatingScope: body.operatingScope }))
    case "setRuleApplicability":
      return ok(await setRuleApplicability({ organizationId, ruleCode: body.ruleCode, applicability: body.applicability }))
    case "clearRuleApplicability":
      return ok(await clearRuleApplicability({ organizationId, ruleCode: body.ruleCode }))
    case "correctRuleApplicability":
      await assertPeriodBelongs(organizationId, "rule", body.periodId)
      return ok(await correctRuleApplicability({ periodId: body.periodId, applicability: body.applicability }))
    case "setDriverRequirements":
      return ok(await setDriverRequirements({ organizationId, minimumDriverAgeYears: body.minimumDriverAgeYears, minimumDriverExperienceMonths: body.minimumDriverExperienceMonths }))
    case "correctDriverRequirements":
      await assertPeriodBelongs(organizationId, "driver", body.periodId)
      return ok(await correctDriverRequirements({ periodId: body.periodId, minimumDriverAgeYears: body.minimumDriverAgeYears, minimumDriverExperienceMonths: body.minimumDriverExperienceMonths }))
    default:
      throw new UnsupportedSettingsActionError()
  }
}
