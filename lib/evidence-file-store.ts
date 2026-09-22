const DB_NAME = "tes-evidence-files"
const DB_VERSION = 1
const STORE_NAME = "files"
const REFERENCE_PREFIX = "indexeddb://tes-evidence-files/"

type StoredEvidenceFile = {
  key: string
  blob: Blob
  fileName: string
  mimeType: string
  savedAt: string
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Browser file storage is unavailable."))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Could not open browser file storage."))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Browser file storage request failed."))
  })
}

export function evidenceFileReference(key: string): string {
  return `${REFERENCE_PREFIX}${encodeURIComponent(key)}`
}

export function isEvidenceFileReference(value?: string | null): boolean {
  return Boolean(value?.startsWith(REFERENCE_PREFIX))
}

function referenceKey(reference: string): string {
  return decodeURIComponent(reference.slice(REFERENCE_PREFIX.length))
}

export async function saveEvidenceFile(key: string, file: Blob, fileName: string, mimeType: string): Promise<string> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const record: StoredEvidenceFile = {
      key,
      blob: file,
      fileName,
      mimeType: mimeType || file.type || "application/octet-stream",
      savedAt: new Date().toISOString(),
    }
    await requestResult(transaction.objectStore(STORE_NAME).put(record))
    return evidenceFileReference(key)
  } finally {
    database.close()
  }
}

export async function resolveEvidenceFile(reference: string): Promise<{ url: string; revoke: boolean }> {
  if (!isEvidenceFileReference(reference)) return { url: reference, revoke: false }

  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, "readonly")
    const stored = await requestResult<StoredEvidenceFile | undefined>(
      transaction.objectStore(STORE_NAME).get(referenceKey(reference))
    )
    if (!stored?.blob) throw new Error("The attached file could not be found in browser file storage.")
    return { url: URL.createObjectURL(stored.blob), revoke: true }
  } finally {
    database.close()
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const separator = dataUrl.indexOf(",")
  if (separator < 0) throw new Error("Invalid inline evidence file.")
  const header = dataUrl.slice(0, separator)
  const payload = dataUrl.slice(separator + 1)
  const mimeType = /data:([^;,]+)/.exec(header)?.[1] || "application/octet-stream"
  const bytes = header.includes(";base64") ? atob(payload) : decodeURIComponent(payload)
  const values = new Uint8Array(bytes.length)
  for (let index = 0; index < bytes.length; index += 1) values[index] = bytes.charCodeAt(index)
  return new Blob([values], { type: mimeType })
}

export async function migrateInlineEvidenceFiles<T extends { evidence: Array<{ id: string; fileName: string; mimeType: string; fileReference?: string }> }>(store: T): Promise<{ store: T; migrated: number }> {
  let migrated = 0
  const evidence = [...store.evidence]

  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index]
    if (!item.fileReference?.startsWith("data:")) continue
    const blob = dataUrlToBlob(item.fileReference)
    const reference = await saveEvidenceFile(item.id, blob, item.fileName, item.mimeType)
    evidence[index] = { ...item, fileReference: reference }
    migrated += 1
  }

  return migrated ? { store: { ...store, evidence } as T, migrated } : { store, migrated: 0 }
}
