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
import { getOnboardingFoundation, upsertEvidenceRequirement, type EvidenceRequirementRecord } from "@/lib/onboarding-foundation/service"
import { reviewEvidence, satisfyEvidenceRequirement } from "@/lib/evidence-payload/service"
import { applyContractsAction } from "@/lib/contracts/service"

type StepStatus = "complete" | "available" | "blocked" | "missing"

export type OnboardingStep = {
  key: string
  label: string
  status: StepStatus
  detail: string
  href?: string
}

export type OnboardingReadiness = {
  status: "ready" | "in_progress" | "blocked" | "missing_evidence" | "settings_required" | "ready_for_contract" | "ready_for_service_start"
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
    contracts: number
    credentials: number
    evidenceDocuments: number
    evidenceRequirements: number
    drivers: number
    insurancePolicies: number
    taxRegistrations: number
    vehicles: number
  }
  evidenceRequirements: EvidenceRequirementRecord[]
  authorityRoles: {
    serviceDecisionAuthority: boolean
    contractSignatory: boolean
  }
  steps: OnboardingStep[]
  readiness: OnboardingReadiness
}

function countRows<T>(rows: T[] | undefined): number {
  return rows?.length ?? 0
}

function readinessFrom(steps: OnboardingStep[], status: OnboardingReadiness["status"]): OnboardingReadiness {
  const scored = steps
  const completed = scored.filter((step) => step.status === "complete").length
  const blockers = steps.filter((step) => step.status === "blocked" || step.status === "missing").map((step) => step.label)
  return {
    status,
    completed,
    total: scored.length,
    blockers,
  }
}

type ComputedRequirement = {
  code: string
  label: string
  requiredFor: string
  documentType: string
}

function hasSatisfiedRequirement(requirements: EvidenceRequirementRecord[], code: string): boolean {
  // 'received' (a stored payload that nobody has verified yet) does NOT satisfy a requirement: readiness moves only on verified
  // payload-backed evidence, or on an explicit waiver / not-applicable decision.
  return requirements.some((item) => item.requirementCode === code && ["verified", "waived", "not_applicable"].includes(item.requirementStatus))
}

function computedRequirements(input: {
  hasOpenEngagement: boolean
  hasScopes: boolean
  hasResponsibilities: boolean
  settingsComplete: boolean
  needsAuthorityRoles: boolean
}): ComputedRequirement[] {
  const requirements: ComputedRequirement[] = [
    {
      code: "CUSTOMER_AUTHORITY_NOTICE",
      label: "Written company notice naming Service Decision Authority and Contract Signatory",
      requiredFor: "authority_roles",
      documentType: "CUSTOMER_AUTHORITY_NOTICE",
    },
  ]
  if (input.hasOpenEngagement) {
    requirements.push({
      code: "CUSTOMER_ONBOARDING_PACKAGE",
      label: "Customer onboarding package or engagement instruction",
      requiredFor: "organization",
      documentType: "CUSTOMER_ONBOARDING_PACKAGE",
    })
  }
  if (input.hasScopes) {
    requirements.push({
      code: "SERVICE_SCOPE_CONFIRMATION",
      label: "Customer confirmation of selected TES service scope",
      requiredFor: "service_scope",
      documentType: "SERVICE_SCOPE_CONFIRMATION",
    })
  }
  if (input.hasResponsibilities) {
    requirements.push({
      code: "RESPONSIBILITY_START_CONFIRMATION",
      label: "Evidence of TES responsibility start boundary",
      requiredFor: "responsibility",
      documentType: "RESPONSIBILITY_START_CONFIRMATION",
    })
  }
  if (input.settingsComplete) {
    requirements.push({
      code: "REQUIRED_SETTINGS_CONFIRMATION",
      label: "Evidence supporting required onboarding settings",
      requiredFor: "settings",
      documentType: "REQUIRED_SETTINGS_CONFIRMATION",
    })
  }
  return requirements
}

function readinessStatus(input: {
  open: boolean
  scopes: boolean
  responsibilities: boolean
  settingsComplete: boolean
  evidenceComplete: boolean
  authorityComplete: boolean
  contractReady: boolean
}): OnboardingReadiness["status"] {
  if (!input.open || !input.scopes || !input.responsibilities) return "blocked"
  if (!input.settingsComplete) return "settings_required"
  if (!input.evidenceComplete || !input.authorityComplete) return "missing_evidence"
  if (!input.contractReady) return "ready_for_contract"
  return "ready_for_service_start"
}

export async function getCustomerOnboarding(organizationId: string): Promise<CustomerOnboardingView> {
  const company = await getCompanyDirectoryProfile(organizationId)
  if (!company) throw new Error("Company not found.")

  const [relationship, operatingProfile, authorities, credentials, insurance, tax, vehicles, drivers, foundation] = await Promise.all([
    getCustomerRelationship(organizationId),
    getCompanyProfile(organizationId),
    getOrganizationAuthorities(organizationId),
    getOrganizationCredentials(organizationId),
    getOrganizationInsurance(organizationId),
    getOrganizationRegistrations(organizationId),
    listOrganizationVehicles(organizationId),
    listOrganizationDrivers(organizationId),
    getOnboardingFoundation(organizationId),
  ])

  const open = relationship.openEngagement
  const currentScopes = open?.current.scopes ?? []
  const currentResponsibilities = open?.current.responsibilities ?? []
  const scopeIdsWithResponsibility = new Set(currentResponsibilities.map((row) => row.scopeId))
  const settingsComplete = operatingProfile.operatingScope.assertion !== null && operatingProfile.driverRequirements.assertion !== null
  const moduleCounts = {
    authorities: countRows(authorities.authorities),
    contracts: foundation.contracts.length,
    credentials: countRows(credentials.credentials),
    evidenceDocuments: foundation.evidenceDocuments.length,
    evidenceRequirements: foundation.evidenceRequirements.length,
    drivers: drivers.length,
    insurancePolicies: countRows(insurance.policies),
    taxRegistrations: countRows(tax.registrations),
    vehicles: vehicles.length,
  }
  const requiredEvidence = computedRequirements({
    hasOpenEngagement: Boolean(open),
    hasScopes: currentScopes.length > 0,
    hasResponsibilities: currentResponsibilities.length > 0,
    settingsComplete,
    needsAuthorityRoles: true,
  })
  const missingEvidence = requiredEvidence.filter((item) => !hasSatisfiedRequirement(foundation.evidenceRequirements, item.code))
  const activeAuthorities = foundation.customerAuthorityAssignments.filter((item) => item.assignmentStatus === "active" && item.effectiveTo === null)
  const authorityRoles = {
    serviceDecisionAuthority: activeAuthorities.some((item) => item.authorityType === "SERVICE_DECISION_AUTHORITY"),
    contractSignatory: activeAuthorities.some((item) => item.authorityType === "CONTRACT_SIGNATORY"),
  }
  const authorityComplete = authorityRoles.serviceDecisionAuthority && authorityRoles.contractSignatory && hasSatisfiedRequirement(foundation.evidenceRequirements, "CUSTOMER_AUTHORITY_NOTICE")
  const contractReady = foundation.contracts.some((contract) => ["draft", "ready_for_signature", "signed"].includes(contract.contractStatus) && contract.lineItems.length >= currentScopes.length)
  const computedReadiness = readinessStatus({
    open: Boolean(open),
    scopes: currentScopes.length > 0,
    responsibilities: currentScopes.length > 0 && currentScopes.every((scope) => scopeIdsWithResponsibility.has(scope.id)),
    settingsComplete,
    evidenceComplete: missingEvidence.length === 0,
    authorityComplete,
    contractReady,
  })

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
      status: missingEvidence.length === 0 ? "complete" : "missing",
      detail: missingEvidence.length === 0 ? "Required evidence is satisfied." : `${missingEvidence.length} evidence requirement${missingEvidence.length === 1 ? "" : "s"} still missing.`,
      href: `/companies/${organizationId}/business`,
    },
    {
      key: "authority_roles",
      label: "Customer authority roles",
      status: authorityComplete ? "complete" : open ? "available" : "blocked",
      detail: authorityComplete ? "Service Decision Authority and Contract Signatory are assigned with evidence." : "Assign exactly one Service Decision Authority and one Contract Signatory.",
    },
    {
      key: "contracts",
      label: "Contracts foundation",
      status: contractReady ? "complete" : authorityComplete && missingEvidence.length === 0 ? "available" : "blocked",
      detail: contractReady ? "Contract shell has line items for current scope." : "Contract shell depends on relationship, scope, responsibility, evidence and authority roles.",
    },
  ]

  const readiness = readinessFrom(steps, computedReadiness)

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
    evidenceRequirements: foundation.evidenceRequirements,
    authorityRoles,
    steps,
    readiness,
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
    case "upsertEvidenceRequirement": {
      await upsertEvidenceRequirement({
        organizationId,
        engagementId: typeof input.engagementId === "string" ? input.engagementId : null,
        scopeId: typeof input.scopeId === "string" ? input.scopeId : null,
        requirementCode: String(input.requirementCode ?? ""),
        requirementLabel: String(input.requirementLabel ?? ""),
        requiredFor: input.requiredFor as Parameters<typeof upsertEvidenceRequirement>[0]["requiredFor"],
        requiredDocumentType: String(input.requiredDocumentType ?? ""),
        requirementStatus: input.requirementStatus as Parameters<typeof upsertEvidenceRequirement>[0]["requirementStatus"],
        satisfiedByEvidenceDocumentId: typeof input.satisfiedByEvidenceDocumentId === "string" ? input.satisfiedByEvidenceDocumentId : null,
      })
      break
    }
    case "reviewEvidenceDocument": {
      await reviewEvidence({ organizationId, documentId: String(input.documentId ?? ""), decision: input.decision })
      break
    }
    case "satisfyEvidenceRequirement": {
      await satisfyEvidenceRequirement({ organizationId, documentId: String(input.documentId ?? "") })
      break
    }
    // Authority changes and contract drafts go through the Contracts service only: it requires a verified written company
    // notice and records the Master Register accountability path. There is no un-evidenced route.
    case "assignCustomerAuthority":
      await applyContractsAction(organizationId, { ...input, action: "assignAuthority" })
      break
    case "createContractFoundation": {
      await applyContractsAction(organizationId, { action: "createDraft", contractReference: input.contractReference })
      break
    }
    default:
      throw new Error("Unsupported onboarding action.")
  }
  return getCustomerOnboarding(organizationId)
}

export const ONBOARDING_PRODUCT_LEVELS: ProductLevel[] = ["COMPLIANCE", "BUSINESS_INTELLIGENCE", "DECISION_SUPPORT"]
