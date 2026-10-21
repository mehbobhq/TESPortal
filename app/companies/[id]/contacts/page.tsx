"use client"

import { useParams } from "next/navigation"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyContactsPage from "./legacy-contacts"

// One user-facing Contacts interface: the original detailed workspace. The canonical workspace stays in ./canonical-contacts.tsx (not rendered).
export default function ContactsPage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      single
      companyId={companyId}
      title="Contacts"
      description="The original Contacts workspace saves only in this browser; it is not synchronized with the TES production database."
    >
      <LegacyContactsPage />
    </LegacyWorkspaceGate>
  )
}
