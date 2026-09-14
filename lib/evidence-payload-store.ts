export interface EvidencePayloadRecord {
  evidenceId: string;
  dataUrl: string;
  mimeType: string;
  updatedAt: string;
}

const DB_NAME = "tes_evidence_payloads";
const DB_VERSION = 1;
const STORE_NAME = "payloads";

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable in this browser context."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "evidenceId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open TES evidence payload storage."));
  });

export async function putEvidencePayload(evidenceId: string, dataUrl: string, mimeType: string): Promise<void> {
  if (!evidenceId || !dataUrl) throw new Error("Evidence ID and document payload are required.");

  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        evidenceId,
        dataUrl,
        mimeType,
        updatedAt: new Date().toISOString(),
      } satisfies EvidencePayloadRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Unable to store the evidence payload."));
      transaction.onabort = () => reject(transaction.error || new Error("Evidence payload storage was aborted."));
    });
  } finally {
    db.close();
  }
}

export async function getEvidencePayload(evidenceId: string): Promise<EvidencePayloadRecord | null> {
  if (!evidenceId) return null;

  const db = await openDatabase();
  try {
    return await new Promise<EvidencePayloadRecord | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(evidenceId);
      request.onsuccess = () => resolve((request.result as EvidencePayloadRecord | undefined) || null);
      request.onerror = () => reject(request.error || new Error("Unable to read the evidence payload."));
    });
  } finally {
    db.close();
  }
}

export async function getEvidencePayloads(evidenceIds: string[]): Promise<Record<string, EvidencePayloadRecord>> {
  const uniqueIds = [...new Set(evidenceIds.filter(Boolean))];
  const entries = await Promise.all(uniqueIds.map(async (id) => [id, await getEvidencePayload(id)] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, EvidencePayloadRecord] => Boolean(entry[1])));
}

/**
 * One-time compatibility migration for the development store.
 * Existing base64 payloads are copied to IndexedDB first. Only after every
 * payload has been stored successfully are those large strings removed from
 * the company Driver localStorage JSON.
 */
export async function migrateLegacyDriverEvidencePayloads(
  companyId: string,
  evidence: Array<{ id: string; dataUrl?: string; mimeType?: string }>,
): Promise<void> {
  if (typeof window === "undefined") return;

  const legacy = evidence.filter((item) => Boolean(item.id && item.dataUrl));
  if (!legacy.length) return;

  for (const item of legacy) {
    await putEvidencePayload(item.id, item.dataUrl!, item.mimeType || "application/octet-stream");
  }

  const storageKey = `tes_company_drivers_${companyId}`;
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;

  const parsed = JSON.parse(raw) as { evidence?: Array<Record<string, unknown>> };
  if (!Array.isArray(parsed.evidence)) return;

  const migratedIds = new Set(legacy.map((item) => item.id));
  parsed.evidence = parsed.evidence.map((item) => {
    const id = typeof item.id === "string" ? item.id : "";
    if (!migratedIds.has(id)) return item;
    return { ...item, dataUrl: "" };
  });

  localStorage.setItem(storageKey, JSON.stringify(parsed));
}
