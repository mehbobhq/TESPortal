import type { TESMachineDocumentResult } from "./machine-acquisition"

// Module-level draft store - survives React remounts
let _pendingDraft: import("./roadside-machine-schema").RoadsideMachineSourceRecord | null = null

export function setPendingRoadsideDraft(
  draft: import("./roadside-machine-schema").RoadsideMachineSourceRecord | null
): void {
  _pendingDraft = draft
}

export function consumePendingRoadsideDraft(): import("./roadside-machine-schema").RoadsideMachineSourceRecord | null {
  const draft = _pendingDraft
  _pendingDraft = null
  return draft
}

export function peekPendingRoadsideDraft(): import("./roadside-machine-schema").RoadsideMachineSourceRecord | null {
  return _pendingDraft
}

export async function processDocumentWithAI(file: File): Promise<TESMachineDocumentResult> {
  const formData = new FormData()
  formData.append("file", file)

  const response = await fetch("/api/document-ai", {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error?.error === "string" ? error.error : "Document AI request failed"
    throw new Error(detail)
  }

  const data = await response.json()
  return data.result as TESMachineDocumentResult
}
