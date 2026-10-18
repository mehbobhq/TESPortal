"use client"

import { useParams } from "next/navigation"

import { DeferredWorkspace } from "@/src/components/shared/LegacyWorkspaceGate"

export default function programsPage() {
  const params = useParams()
  return (
    <DeferredWorkspace
      companyId={params.id as string}
      title="Programs"
      description="Compliance programs (CTPAT, FAST, SmartWay and others) have no canonical (PostgreSQL) implementation yet, so there is nothing to show or save here. This workspace is intentionally deferred, not empty."
    />
  )
}
