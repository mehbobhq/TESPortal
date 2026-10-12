import "server-only"

import { getCompanyProfile as getCompanyDirectoryProfile } from "@/lib/company-directory/service"
import {
  addScope,
  assumeResponsibility,
  establishCustomerRelationship,
  getCustomerRelationship,
} from "@/lib/customer-relationship/service"
import type { ProductLevel } from "@/lib/customer-relationship/definitions"
import { getCompanyProfile, setDriverRequirements, setOperatingScope } from "@/lib/company-profile/service"
import type { OperatingScope } from "@/lib/company-profile/definitions"
import { getOrganizationAuthorities } from "@/lib/operating-authorities/service"
import { getOrganizationCredentials } from "@/lib/company-credentials/service"
import { getOrganizationInsurance } from "@/lib/insurance/service"
import { getOrganizationRegistrations } from "@/lib/tax-registrations/service"
import { listOrganizationDrivers, listOrganizationVehicles } from "@/lib/operational-identity/reads"

type StepStatus = "complete" | "available" | "blocked"

export type OnboardingStep = {
  key: string
  label: string
  status: StepStatus
  detail: string
  href?: string
}

export type OnboardingReadiness = {
  status: "ready" | "in_progress" | "blocked"
  completed: number
  total: number
  blockers: string[]
}

export type CustomerOnboardingView = {
  company: {
    id: string
    name: string
    kind: string
    status: string
    region: string
  }
  relationship: Awaited<ReturnType<typeof getCustomerRelationship>>
  operatingProfile: Awaited<ReturnType<typeof getCompanyProfile>>
  counts: {
    authorities: number
    credentials: number
    drivers: number
    insurancePolicies: number
    taxRegistrations: number
    vehicles: number
  }
  steps: OnboardingStep[]
  readiness: OnboardingReadiness
}

function countRows<T>(rows: T[] | undefined): number {
  return rows?.length ?? 0
}

function readinessFrom(steps: OnboardingStep[]): OnboardingReadiness {
  const scored = steps.filter((step) => step.status !== "blocked" || step.key === "documents")
  const completed = scored.filter((step) => step.status === "complete").length
  const blockers = steps.filter((step) => step.status === "blocked").map((step) => step.label)
  return {
    status: blockers.length > 0 ? "blocked" : completed === scored.length ? "ready" : "in_progress",
    completed,
    total: scored.length,
    blockers,
  }
}

export async function getCustomerOnboarding(organizationId: string): Promise<CustomerOnboardingView> {
  const company = await getCompanyDirectoryProfile(organizationId)
  if (!company) throw new Error("Company not found.")

  const [relationship, operatingProfile, authorities, credentials, insurance, tax, vehicles, drivers] = await Promise.all([
    getCustomerRelationship(organizationId),
    getCompanyProfile(organizationId),
    getOrganizationAuthorities(organizationId),
    getOrganizationCredentials(organizationId),
    getOrganizationInsurance(organizationId),
    getOrganizationRegistrations(organizationId),
    listOrganizationVehicles(organizationId),
    listOrganizationDrivers(organizationId),
  ])

  const open = relationship.openEngagement
  const currentScopes = open?.current.scopes ?? []
  const currentResponsibilities = open?.current.responsibilities ?? []
  const scopeIdsWithResponsibility = new Set(currentResponsibilities.map((row) => row.scopeId))
  const settingsComplete = operatingProfile.operatingScope.assertion !== null && operatingProfile.driverRequirements.assertion !== null
  const moduleCounts = {
    authorities: countRows(authorities.authorities),
    credentials: countRows(credentials.credentials),
    drivers: drivers.length,
    insurancePolicies: countRows(insurance.policies),
    taxRegistrations: countRows(tax.registrations),
    vehicles: vehicles.length,
  }

  const steps: OnboardingStep[] = [
    {
      key: "organization",
      label: "Organization",
      status: "complete",
      detail: `${company.name} is a canonical Organization.`,
      href: `/companies/${organizationId}/profile`,
    },
    {
      key: "customer_relationship",
      label: "Customer relationship",
      status: open ? "complete" : "available",
      detail: open ? `Open ${open.engagement.engagementType.toLowerCase()} engagement in ${open.current.stage?.stage ?? "unknown"} stage.` : "No open Customer engagement yet.",
    },
    {
      key: "service_scope",
      label: "Service scope",
      status: currentScopes.length > 0 ? "complete" : open ? "available" : "blocked",
      detail: currentScopes.length > 0 ? `${currentScopes.length} current product scope${currentScopes.length === 1 ? "" : "s"} selected.` : "Choose the TES product layer covered by this engagement.",
    },
    {
      key: "responsibility",
      label: "Responsibility",
      status: currentScopes.length > 0 && currentScopes.every((scope) => scopeIdsWithResponsibility.has(scope.id)) ? "complete" : currentScopes.length > 0 ? "available" : "blocked",
      detail:
        currentScopes.length > 0
          ? `${currentResponsibilities.length} of ${currentScopes.length} current scope${currentScopes.length === 1 ? "" : "s"} have TES responsibility assumed.`
          : "Responsibility starts after scope is selected.",
    },
    {
      key: "settings",
      label: "Required settings",
      status: settingsComplete ? "complete" : "available",
      detail: settingsComplete ? "Operating scope and driver minimums are configured." : "Operating scope and driver minimums still need canonical settings.",
      href: `/companies/${organizationId}/settings`,
    },
    {
      key: "documents",
      label: "Documents/evidence",
      status: "blocked",
      detail: "Canonical GCS evidence storage is not built yet; evidence remains blocked.",
      href: `/companies/${organizationId}/business`,
    },
  ]

  return {
    company: {
      id: company.id,
      name: company.name,
      kind: company.kind,
      status: company.status,
      region: company.region,
    },
    relationship,
    operatingProfile,
    counts: moduleCounts,
    steps,
    readiness: readinessFrom(steps),
  }
}

const now = () => new Date().toISOString()

export async function applyCustomerOnboardingAction(organizationId: string, input: Record<string, unknown>): Promise<CustomerOnboardingView> {
  switch (input.action) {
    case "establish": {
      await establishCustomerRelationship({
        organizationId,
        engagementType: input.engagementType ?? "RECURRING",
        stage: input.stage ?? "ONBOARDING",
        plannedEndAt: input.plannedEndAt ?? null,
        startedAt: typeof input.startedAt === "string" && input.startedAt ? input.startedAt : now(),
      })
      break
    }
    case "addScope": {
      await addScope({
        engagementId: input.engagementId,
        productLevel: input.productLevel,
        service: null,
        agreementId: null,
        effectiveFrom: typeof input.effectiveFrom === "string" && input.effectiveFrom ? input.effectiveFrom : now(),
      })
      break
    }
    case "assumeResponsibility": {
      await assumeResponsibility({
        scopeId: input.scopeId,
        effectiveFrom: typeof input.effectiveFrom === "string" && input.effectiveFrom ? input.effectiveFrom : now(),
      })
      break
    }
    case "setOperatingScope": {
      await setOperatingScope({
        organizationId,
        operatingScope: input.operatingScope as OperatingScope,
        effectiveFrom: typeof input.effectiveFrom === "string" && input.effectiveFrom ? input.effectiveFrom : now(),
      })
      break
    }
    case "setDriverRequirements": {
      await setDriverRequirements({
        organizationId,
        minimumDriverAgeYears: Number(input.minimumDriverAgeYears),
        minimumDriverExperienceMonths: Number(input.minimumDriverExperienceMonths),
        effectiveFrom: typeof input.effectiveFrom === "string" && input.effectiveFrom ? input.effectiveFrom : now(),
      })
      break
    }
    default:
      throw new Error("Unsupported onboarding action.")
  }
  return getCustomerOnboarding(organizationId)
}

export const ONBOARDING_PRODUCT_LEVELS: ProductLevel[] = ["COMPLIANCE", "BUSINESS_INTELLIGENCE", "DECISION_SUPPORT"]
