"use client"

/** Browser side of the applicant API. The session is an HttpOnly cookie the page cannot read; only the CSRF token is held here, in sessionStorage (not PII, dies with the tab). */
const CSRF_KEY = "tes-applicant-csrf"

export const getCsrf = (): string | null => {
  try {
    return window.sessionStorage.getItem(CSRF_KEY)
  } catch {
    return csrfMemory
  }
}
let csrfMemory: string | null = null
export const setCsrf = (value: string | null) => {
  csrfMemory = value
  try {
    if (value) window.sessionStorage.setItem(CSRF_KEY, value)
    else window.sessionStorage.removeItem(CSRF_KEY)
  } catch {
    /* storage unavailable: memory only */
  }
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: Record<string, unknown>) {
    super(message)
  }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const csrf = getCsrf()
  if (csrf) headers["x-tes-csrf"] = csrf
  if (init.json !== undefined) headers["content-type"] = "application/json"
  const response = await fetch(path, { method: init.method ?? "GET", headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined), credentials: "same-origin", cache: "no-store" })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new ApiError(response.status, typeof body.error === "string" ? body.error : "Something went wrong. Try again.", body)
  return body as T
}

/** Photos are shrunk before upload (the platform limits request size). PDFs and already-small files pass through. */
export async function prepareFile(file: File, maxBytes = 3_800_000): Promise<File> {
  if (file.size <= maxBytes && !file.type.startsWith("image/")) return file
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    if (file.size > maxBytes) throw new Error("That file is larger than 4 MB. Choose a smaller file or take a photo of the document.")
    return file
  }
  if (file.size <= 1_500_000 && (file.type === "image/jpeg" || file.type === "image/png")) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) {
    if (file.size > maxBytes) throw new Error("That photo is too large and could not be reduced. Try another photo.")
    return file
  }
  const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
    if (blob && blob.size <= maxBytes) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
  }
  throw new Error("That photo is too large and could not be reduced. Try another photo.")
}
