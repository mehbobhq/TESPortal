"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, FileSignature, Loader2, ShieldAlert, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Gate =
  | "CUSTOMER_RELATIONSHIP"
  | "CONTRACT_REFERENCE"
  | "SERVICE_SCOPE"
  | "RESPONSIBILITY_MATRIX"
  | "REQUIRED_SETTINGS"
  | "PRICING_PACKAGE"
  | "SERVICE_DECISION_AUTHORITY"
  | "CONTRACT_SIGNATORY"
  | "EVIDENCE_REQUIREMENTS"
  | "MASTER_REGISTER_ACCOUNTABILITY"

const GATES: Array<{ code: Gate; label: string }> = [
  { code: "CUSTOMER_RELATIONSHIP", label: "Organization / customer relationship" },
  { code: "CONTRACT_REFERENCE", label: "Contract reference" },
  { code: "SERVICE_SCOPE", label: "Service scope" },
  { code: "RESPONSIBILITY_MATRIX", label: "Responsibility matrix" },
  { code: "REQUIRED_SETTINGS", label: "Required settings" },
  { code: "PRICING_PACKAGE", label: "Pricing / package definition" },
  { code: "SERVICE_DECISION_AUTHORITY", label: "Service Decision Authority" },
  { code: "CONTRACT_SIGNATORY", label: "Contract Signatory" },
  { code: "EVIDENCE_REQUIREMENTS", label: "Evidence requirements" },
  { code: "MASTER_REGISTER_ACCOUNTABILITY", label: "Master Register accountability path" },
]

type Status = "draft" | "ready_for_signature" | "signed" | "superseded" | "archived"
type Authority = {
  id: string
  personId: string
  authorityType: "SERVICE_DECISION_AUTHORITY" | "CONTRACT_SIGNATORY"
  assignmentStatus: "active" | "superseded" | "voided"
  effectiveFrom: string
  effectiveTo: string | null
}
type Line = {
  id: string
  scopeId: string
  lineStatus: string
  responsibilityBoundary: string
  pricing: { pricingBasis: string; packageCode: string | null; feeMinorUnits: number | null; feeCurrency: string | null } | null
  responsibilities: Array<{ id: string; responsibilityArea: string; responsibleParty: string; effectiveResponsibilityDate: string; historyTreatment: string }>
}
type Contract = {
  id: string
  contractStatus: Status
  contractReference: string | null
  lines: Line[]
  evidenceRequirements: Array<{ ruleCode: string; ruleLabel: string; requiredDocumentType: string; requiredBeforeStatus: string; requirementStatus: "missing" | "verified"; evidenceDocumentId: string | null }>
  statusHistory: Array<{ id: string; fromStatus: Status | null; toStatus: Status; createdAt: string }>
  readiness: { target: Status | null; failures: Gate[]; ready: boolean }
}
type Workspace = {
  customerId: string | null
  packages: Array<{ packageCode: string; packageName: string; pricingBasis: string; packageStatus: string }>
  authorities: {
    serviceDecisionAuthority: Authority | null
    contractSignatory: Authority | null
    samePerson: boolean | null
    assignments: Authority[]
  }
  contracts: Contract[]
  evidenceDocuments: Array<{ id: string; documentType: string; documentTitle: string; documentStatus: string; expiresAt: string | null }>
  people: Array<{ personId: string; displayName: string }>
  openEngagement: { id: string; scopes: Array<{ id: string; productLevel: string; serviceCode: string | null; responsibilityStartsAt: string | null }> } | null
}

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm"

function EvidenceSelect({
  docs,
  value,
  onChange,
  type,
  label,
}: {
  docs: Workspace["evidenceDocuments"]
  value: string
  onChange: (value: string) => void
  type?: string
  label: string
}) {
  const options = docs.filter((doc) => doc.documentStatus === "verified" && (!type || doc.documentType === type))
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <select className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{options.length === 0 ? "No verified evidence available" : "Choose verified evidence"}</option>
        {options.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.documentTitle} ({doc.documentType})
          </option>
        ))}
      </select>
    </div>
  )
}

export default function ContractsPanel({ companyId }: { companyId: string }) {
  const [data, setData] = useState<Workspace | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const base = `/api/companies/${encodeURIComponent(companyId)}/contracts`

  // form state (nothing here is persisted in the browser; every decision is sent to the server)
  const [reference, setReference] = useState("")
  const [authorityType, setAuthorityType] = useState<"SERVICE_DECISION_AUTHORITY" | "CONTRACT_SIGNATORY">("SERVICE_DECISION_AUTHORITY")
  const [personId, setPersonId] = useState("")
  const [noticeId, setNoticeId] = useState("")
  const [scopeIds, setScopeIds] = useState<string[]>([])
  const [decisionId, setDecisionId] = useState("")
  const [area, setArea] = useState("COMPLIANCE_MONITORING")
  const [party, setParty] = useState("TES")
  const [effectiveDate, setEffectiveDate] = useState("")
  const [historyTreatment, setHistoryTreatment] = useState("excluded")
  const [historyFrom, setHistoryFrom] = useState("")
  const [historyEvidenceId, setHistoryEvidenceId] = useState("")
  const [pricingBasis, setPricingBasis] = useState("monthly_package")
  const [packageCode, setPackageCode] = useState("")
  const [fee, setFee] = useState("")
  const [currency, setCurrency] = useState("CAD")
  const [newPackageCode, setNewPackageCode] = useState("")
  const [newPackageName, setNewPackageName] = useState("")
  const [ruleEvidence, setRuleEvidence] = useState<Record<string, string>>({})
  const [statusEvidenceId, setStatusEvidenceId] = useState("")

  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? "Unable to load contracts.")
    setData(body)
  }, [base])

  useEffect(() => {
    let cancelled = false
    load().catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Unable to load contracts."))
    return () => {
      cancelled = true
    }
  }, [load])

  async function act(name: string, payload: Record<string, unknown>, url = base) {
    setBusy(name)
    setError("")
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? "The change was refused.")
      if (url === base) setData(body)
      else await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "The change was refused.")
    } finally {
      setBusy("")
    }
  }

  const contract = useMemo(() => data?.contracts.find((item) => !["archived", "superseded"].includes(item.contractStatus)) ?? null, [data])
  const personName = (id: string | undefined) => (id ? (data?.people.find((person) => person.personId === id)?.displayName ?? `Person ${id.slice(0, 8)}`) : "—")

  if (error && !data) return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
  if (!data) return <div className="p-6 text-center text-sm text-muted-foreground">Loading contracts...</div>

  const editable = contract?.contractStatus === "draft"
  const attachedScopes = new Set(contract?.lines.filter((line) => line.lineStatus !== "removed").map((line) => line.scopeId) ?? [])
  const availableScopes = (data.openEngagement?.scopes ?? []).filter((scope) => !attachedScopes.has(scope.id))
  const nextStatus = contract?.readiness.target ?? null
  const failures = new Set(contract?.readiness.failures ?? [])
  const unreviewed = data.evidenceDocuments.filter((doc) => doc.documentStatus !== "verified")

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <FileSignature className="size-4" />
        Contracts
        {contract ? <Badge variant="outline">{contract.contractStatus.replaceAll("_", " ")}</Badge> : <Badge variant="outline">No contract yet</Badge>}
      </div>

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4" />
              Contract readiness
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-4">
            {contract ? (
              GATES.map((gate) => (
                <div key={gate.code} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span>{gate.label}</span>
                  {failures.has(gate.code) ? (
                    <Badge variant="destructive" className="gap-1">
                      <ShieldAlert className="size-3" /> Blocked
                    </Badge>
                  ) : (
                    <Badge className="gap-1">
                      <CheckCircle2 className="size-3" /> Met
                    </Badge>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Create a contract draft to evaluate readiness. A contract can only be signed once every gate is met.</p>
            )}
            {contract && nextStatus ? (
              <p className="text-xs text-muted-foreground">
                {contract.readiness.ready ? `All gates for ${nextStatus.replaceAll("_", " ")} are met.` : `${contract.readiness.failures.length} gate(s) block ${nextStatus.replaceAll("_", " ")}.`}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="text-sm">Customer authority</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            {(
              [
                ["Service Decision Authority", data.authorities.serviceDecisionAuthority],
                ["Contract Signatory", data.authorities.contractSignatory],
              ] as const
            ).map(([label, holder]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{holder ? personName(holder.personId) : "Vacant — no active holder"}</div>
                </div>
                {holder ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!noticeId || busy === `revoke-${holder.id}`}
                    title="Revoking needs a verified written company notice (choose below)"
                    onClick={() => act(`revoke-${holder.id}`, { action: "revokeAuthority", assignmentId: holder.id, noticeEvidenceDocumentId: noticeId })}
                  >
                    Revoke
                  </Button>
                ) : (
                  <Badge variant="outline">Missing</Badge>
                )}
              </div>
            ))}
            {data.authorities.samePerson !== null ? (
              <p className="text-xs text-muted-foreground">{data.authorities.samePerson ? "The same person holds both roles." : "Two different people hold the two roles."}</p>
            ) : null}
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Assigning a different holder replaces and ends the current one. It needs a verified written company notice; the history is preserved.
              </p>
              <select className={selectClass} value={authorityType} onChange={(event) => setAuthorityType(event.target.value as typeof authorityType)}>
                <option value="SERVICE_DECISION_AUTHORITY">Service Decision Authority</option>
                <option value="CONTRACT_SIGNATORY">Contract Signatory</option>
              </select>
              <select className={selectClass} value={personId} onChange={(event) => setPersonId(event.target.value)}>
                <option value="">{data.people.length === 0 ? "No contacts available" : "Choose a company contact"}</option>
                {data.people.map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.displayName}
                  </option>
                ))}
              </select>
              <EvidenceSelect docs={data.evidenceDocuments} value={noticeId} onChange={setNoticeId} type="CUSTOMER_AUTHORITY_NOTICE" label="Verified written company notice" />
              <Button
                size="sm"
                disabled={!personId || !noticeId || busy === "assign"}
                onClick={() => act("assign", { action: "assignAuthority", authorityType, personId, noticeEvidenceDocumentId: noticeId })}
              >
                {busy === "assign" ? <Loader2 className="size-4 animate-spin" /> : null}
                Assign / replace holder
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b bg-muted/30 py-3">
          <CardTitle className="text-sm">Evidence documents awaiting review</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {unreviewed.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Every registered evidence document is verified. Only verified, unexpired evidence can back an authority or contract change.</div>
          ) : (
            unreviewed.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                <div>
                  <div className="font-medium">{doc.documentTitle}</div>
                  <div className="text-xs text-muted-foreground">
                    {doc.documentType} · {doc.documentStatus}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === `verify-${doc.id}`}
                  onClick={() =>
                    act(`verify-${doc.id}`, { action: "reviewEvidenceDocument", documentId: doc.id, decision: "verified" }, `/api/companies/${encodeURIComponent(companyId)}/onboarding`)
                  }
                >
                  Mark verified
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b bg-muted/30 py-3">
          <CardTitle className="text-sm">Package definitions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap gap-2 text-xs">
            {data.packages.length === 0 ? <span className="text-muted-foreground">No packages defined yet.</span> : data.packages.map((pkg) => <Badge key={pkg.packageCode} variant="outline">{pkg.packageCode} · {pkg.pricingBasis.replaceAll("_", " ")}</Badge>)}
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Input placeholder="PACKAGE_CODE" value={newPackageCode} onChange={(event) => setNewPackageCode(event.target.value.toUpperCase())} />
            <Input placeholder="Package name" value={newPackageName} onChange={(event) => setNewPackageName(event.target.value)} />
            <select className={selectClass} value={pricingBasis} onChange={(event) => setPricingBasis(event.target.value)}>
              <option value="monthly_package">Monthly package</option>
              <option value="one_time_service">One-time service</option>
              <option value="included_in_package">Included in package</option>
            </select>
            <Button
              size="sm"
              disabled={!newPackageCode || !newPackageName || busy === "package"}
              onClick={() => act("package", { action: "definePackage", packageCode: newPackageCode, packageName: newPackageName, pricingBasis })}
            >
              Define package
            </Button>
          </div>
        </CardContent>
      </Card>

      {!contract ? (
        <Card>
          <CardHeader className="border-b bg-muted/30 py-3">
            <CardTitle className="text-sm">Create contract draft</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2 pt-4">
            <div className="space-y-1">
              <Label className="text-xs">Contract reference</Label>
              <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="e.g. TES-2026-001" />
            </div>
            <Button size="sm" disabled={!data.openEngagement || busy === "draft"} onClick={() => act("draft", { action: "createDraft", contractReference: reference })}>
              Create draft
            </Button>
            {!data.openEngagement ? <span className="text-xs text-muted-foreground">An open customer engagement is required.</span> : null}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="border-b bg-muted/30 py-3">
              <CardTitle className="text-sm">Service scope and responsibility</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {editable ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Contract reference</Label>
                    <Input value={reference || contract.contractReference || ""} onChange={(event) => setReference(event.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" disabled={busy === "reference"} onClick={() => act("reference", { action: "updateDraft", contractId: contract.id, contractReference: reference || contract.contractReference || "", syncAuthorities: true })}>
                    Save reference and sync authorities
                  </Button>
                </div>
              ) : null}
              {editable && availableScopes.length > 0 ? (
                <div className="space-y-2">
                  <Label className="text-xs">Attach current service scopes (decided by the Service Decision Authority)</Label>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {availableScopes.map((scope) => (
                      <label key={scope.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={scopeIds.includes(scope.id)}
                          onChange={(event) => setScopeIds((current) => (event.target.checked ? [...current, scope.id] : current.filter((id) => id !== scope.id)))}
                        />
                        {scope.productLevel.replaceAll("_", " ")}
                        {scope.serviceCode ? ` · ${scope.serviceCode}` : ""}
                      </label>
                    ))}
                  </div>
                  <Button size="sm" disabled={scopeIds.length === 0 || busy === "attach"} onClick={() => act("attach", { action: "attachScopes", contractId: contract.id, scopeIds }).then(() => setScopeIds([]))}>
                    Attach scopes
                  </Button>
                </div>
              ) : null}

              {contract.lines.filter((line) => line.lineStatus !== "removed").map((line) => (
                <div key={line.id} className="space-y-3 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">Scope {line.scopeId.slice(0, 8)}</div>
                    <Badge variant="outline">{line.responsibilityBoundary.replaceAll("_", " ")}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {line.responsibilities.length === 0
                      ? "No responsibility rows yet."
                      : line.responsibilities.map((row) => `${row.responsibilityArea}: ${row.responsibleParty} from ${row.effectiveResponsibilityDate} (${row.historyTreatment.replaceAll("_", " ")})`).join(" · ")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {line.pricing
                      ? `Pricing: ${line.pricing.pricingBasis.replaceAll("_", " ")}${line.pricing.packageCode ? ` · ${line.pricing.packageCode}` : ""}${line.pricing.feeMinorUnits !== null ? ` · ${(line.pricing.feeMinorUnits / 100).toFixed(2)} ${line.pricing.feeCurrency}` : ""}`
                      : "Pricing / package not defined."}
                  </div>
                  {editable ? (
                    <div className="space-y-3 border-t pt-3">
                      <EvidenceSelect docs={data.evidenceDocuments} value={decisionId} onChange={setDecisionId} label="Customer decision evidence (verified)" />
                      <div className="grid gap-2 sm:grid-cols-4">
                        <Input value={area} onChange={(event) => setArea(event.target.value.toUpperCase())} placeholder="AREA_CODE" />
                        <select className={selectClass} value={party} onChange={(event) => setParty(event.target.value)}>
                          <option value="TES">TES</option>
                          <option value="CUSTOMER">Customer</option>
                          <option value="SHARED">Shared</option>
                        </select>
                        <div>
                          <Input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} aria-label="Effective responsibility date" />
                        </div>
                        <select className={selectClass} value={historyTreatment} onChange={(event) => setHistoryTreatment(event.target.value)}>
                          <option value="excluded">Pre-engagement history excluded</option>
                          <option value="customer_retains">Customer retains history</option>
                          <option value="tes_assumes_with_evidence">TES assumes history (with evidence)</option>
                        </select>
                      </div>
                      {historyTreatment === "tes_assumes_with_evidence" ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} aria-label="History assumed from" />
                          <EvidenceSelect docs={data.evidenceDocuments} value={historyEvidenceId} onChange={setHistoryEvidenceId} label="Evidence supporting assumed history" />
                        </div>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!decisionId || !effectiveDate || busy === `resp-${line.id}`}
                        onClick={() =>
                          act(`resp-${line.id}`, {
                            action: "defineResponsibility",
                            lineItemId: line.id,
                            decisionEvidenceDocumentId: decisionId,
                            rows: [
                              {
                                responsibilityArea: area,
                                responsibleParty: party,
                                effectiveResponsibilityDate: effectiveDate,
                                historyTreatment,
                                ...(historyTreatment === "tes_assumes_with_evidence" ? { historyAssumedFrom: historyFrom, historyEvidenceDocumentId: historyEvidenceId } : {}),
                              },
                            ],
                          })
                        }
                      >
                        Define responsibility
                      </Button>
                      <div className="grid gap-2 sm:grid-cols-5">
                        <select className={selectClass} value={pricingBasis} onChange={(event) => setPricingBasis(event.target.value)}>
                          <option value="monthly_package">Monthly package</option>
                          <option value="one_time_service">One-time service</option>
                          <option value="included_in_package">Included in package</option>
                        </select>
                        <select className={selectClass} value={packageCode} onChange={(event) => setPackageCode(event.target.value)}>
                          <option value="">No package</option>
                          {data.packages.filter((pkg) => pkg.packageStatus === "active").map((pkg) => (
                            <option key={pkg.packageCode} value={pkg.packageCode}>
                              {pkg.packageName}
                            </option>
                          ))}
                        </select>
                        <Input value={fee} onChange={(event) => setFee(event.target.value)} inputMode="numeric" placeholder="Fee (minor units)" disabled={pricingBasis === "included_in_package"} />
                        <select className={selectClass} value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={pricingBasis === "included_in_package"}>
                          <option value="CAD">CAD</option>
                          <option value="USD">USD</option>
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!decisionId || busy === `price-${line.id}`}
                          onClick={() =>
                            act(`price-${line.id}`, {
                              action: "assignPricing",
                              lineItemId: line.id,
                              decisionEvidenceDocumentId: decisionId,
                              pricingBasis,
                              packageCode: packageCode || undefined,
                              ...(pricingBasis === "included_in_package" ? {} : { feeMinorUnits: fee === "" ? undefined : Number(fee), feeCurrency: currency }),
                            })
                          }
                        >
                          Set pricing
                        </Button>
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy === `detach-${line.id}`} onClick={() => act(`detach-${line.id}`, { action: "detachScope", lineItemId: line.id })}>
                        Remove scope from draft
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-muted/30 py-3">
              <CardTitle className="text-sm">Contract evidence requirements</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {contract.evidenceRequirements.map((rule) => (
                <div key={rule.ruleCode} className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">{rule.ruleLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {rule.requiredDocumentType} · needed before {rule.requiredBeforeStatus.replaceAll("_", " ")}
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    {["draft", "ready_for_signature"].includes(contract.contractStatus) ? (
                      <>
                        <EvidenceSelect
                          docs={data.evidenceDocuments}
                          type={rule.requiredDocumentType}
                          value={ruleEvidence[rule.ruleCode] ?? ""}
                          onChange={(value) => setRuleEvidence((current) => ({ ...current, [rule.ruleCode]: value }))}
                          label="Evidence"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!ruleEvidence[rule.ruleCode] || busy === `link-${rule.ruleCode}`}
                          onClick={() => act(`link-${rule.ruleCode}`, { action: "linkEvidence", contractId: contract.id, ruleCode: rule.ruleCode, evidenceDocumentId: ruleEvidence[rule.ruleCode] })}
                        >
                          Link
                        </Button>
                      </>
                    ) : null}
                    <Badge variant={rule.requirementStatus === "verified" ? "default" : "outline"}>{rule.requirementStatus}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-muted/30 py-3">
              <CardTitle className="text-sm">Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              <ol className="space-y-1 text-xs text-muted-foreground">
                {contract.statusHistory.map((event) => (
                  <li key={event.id}>
                    {event.createdAt.slice(0, 19).replace("T", " ")} · {(event.fromStatus ?? "start").replaceAll("_", " ")} → {event.toStatus.replaceAll("_", " ")}
                  </li>
                ))}
              </ol>
              {contract.contractStatus !== "archived" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <EvidenceSelect
                    docs={data.evidenceDocuments}
                    value={statusEvidenceId}
                    onChange={setStatusEvidenceId}
                    type={nextStatus === "signed" ? "SIGNED_CONTRACT_DOCUMENT" : undefined}
                    label="Evidence for this status change (verified)"
                  />
                  {nextStatus ? (
                    <Button
                      size="sm"
                      disabled={!contract.readiness.ready || !statusEvidenceId || busy === "advance"}
                      title={contract.readiness.ready ? undefined : "Every readiness gate must be met first"}
                      onClick={() => act("advance", { action: "advanceStatus", contractId: contract.id, toStatus: nextStatus, evidenceDocumentId: statusEvidenceId })}
                    >
                      Advance to {nextStatus.replaceAll("_", " ")}
                    </Button>
                  ) : null}
                  {contract.contractStatus === "ready_for_signature" ? (
                    <Button size="sm" variant="outline" disabled={!statusEvidenceId || busy === "back"} onClick={() => act("back", { action: "advanceStatus", contractId: contract.id, toStatus: "draft", evidenceDocumentId: statusEvidenceId })}>
                      Return to draft
                    </Button>
                  ) : null}
                  {contract.contractStatus === "signed" ? (
                    <Button size="sm" variant="outline" disabled={!statusEvidenceId || busy === "supersede"} onClick={() => act("supersede", { action: "advanceStatus", contractId: contract.id, toStatus: "superseded", evidenceDocumentId: statusEvidenceId })}>
                      Mark superseded
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" disabled={!statusEvidenceId || contract.contractStatus === "ready_for_signature" || busy === "archive"} onClick={() => act("archive", { action: "advanceStatus", contractId: contract.id, toStatus: "archived", evidenceDocumentId: statusEvidenceId })}>
                    Archive
                  </Button>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Every status change needs verified evidence and is recorded in the Master Register. Signing is recorded against the signed document; no external e-signature is performed here.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
