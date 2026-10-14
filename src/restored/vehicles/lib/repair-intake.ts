import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import type { registerRepairSourceFile as OriginalRegisterRepairSourceFile } from "@/lib/repair-document-intake"

/** Registering a repair-invoice source file used browser-side hashing and storage; there is no canonical intake for it yet. */
export const registerRepairSourceFile: typeof OriginalRegisterRepairSourceFile = async () => {
  throw new CanonicalOperationUnavailableError(
    "Processing a repair-invoice document",
    "repair invoices and their source documents have no canonical record or evidence target yet",
  )
}
