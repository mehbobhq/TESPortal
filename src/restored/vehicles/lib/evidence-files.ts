/**
 * Vehicle evidence files in the restored workspace.
 *
 * The original stored file bytes in this browser (IndexedDB). That is not permitted for the TES records view, and the approved
 * evidence lifecycle (lib/evidence-payload, /api/companies/[id]/evidence) has no vehicle target: it accepts onboarding and contract
 * documents only. So attaching a file refuses, naming that exact gap, and nothing is ever claimed as saved.
 */
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"

export const VEHICLE_EVIDENCE_GAP =
  "the approved evidence lifecycle has no vehicle document target yet, and file bytes are never kept in the browser"

export async function saveEvidenceFile(_key: string, _file: Blob, _fileName: string, _mimeType: string): Promise<string> {
  throw new CanonicalOperationUnavailableError("Attaching a document", VEHICLE_EVIDENCE_GAP)
}

/** There is no stored vehicle evidence to open. */
export async function resolveEvidenceFile(_reference: string): Promise<{ url: string; revoke: boolean }> {
  throw new CanonicalOperationUnavailableError("Opening a stored document", VEHICLE_EVIDENCE_GAP)
}

/** Nothing to migrate: the restored workspace has no browser-held evidence. */
export async function migrateInlineEvidenceFiles<T>(store: T): Promise<{ store: T; migrated: number }> {
  return { store, migrated: 0 }
}
