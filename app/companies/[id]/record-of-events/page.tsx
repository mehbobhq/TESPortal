"use client"

import { useParams } from "next/navigation"

import { DeferredWorkspace } from "@/src/components/shared/LegacyWorkspaceGate"

export default function recordofeventsPage() {
  const params = useParams()
  return (
    <DeferredWorkspace
      companyId={params.id as string}
      title="Record of Events"
      description="Roadside inspection, collision, near-miss and customer-event records have no canonical (PostgreSQL) implementation yet, so there is nothing to show or save here. This workspace is intentionally deferred, not empty."
    />
  )
}
