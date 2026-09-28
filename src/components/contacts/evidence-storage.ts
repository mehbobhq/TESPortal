import type { Contact, Evidence } from "./types";

// =========================================================================
// CONTACT EVIDENCE PAYLOAD STORE
// =========================================================================
// tes_contacts_v5 remains the canonical contact-record store.
// Large evidence payloads are stored separately in IndexedDB so a photo/PDF
// cannot exhaust the browser's localStorage quota.
const CONTACT_EVIDENCE_DB = "tes_evidence_store";
const CONTACT_EVIDENCE_DB_VERSION = 1;
const CONTACT_EVIDENCE_OBJECT_STORE = "contact_evidence";
const CONTACT_EVIDENCE_MANIFEST_PREFIX = "contact-manifest:";

function openContactEvidenceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONTACT_EVIDENCE_DB, CONTACT_EVIDENCE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONTACT_EVIDENCE_OBJECT_STORE)) {
        db.createObjectStore(CONTACT_EVIDENCE_OBJECT_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeContactEvidenceDataUrl(
  evidenceId: string,
  dataUrl?: string
): Promise<void> {
  if (!evidenceId || !dataUrl || typeof indexedDB === "undefined") return;

  const db = await openContactEvidenceDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CONTACT_EVIDENCE_OBJECT_STORE, "readwrite");
    tx.objectStore(CONTACT_EVIDENCE_OBJECT_STORE).put(dataUrl, evidenceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function storeContactEvidenceManifest(
  contactId: string,
  evidence: Evidence[]
): Promise<void> {
  if (!contactId || typeof indexedDB === "undefined") return;

  const metadata = (evidence || []).map(({ dataUrl: _dataUrl, ...item }) => item);
  const db = await openContactEvidenceDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CONTACT_EVIDENCE_OBJECT_STORE, "readwrite");
    tx.objectStore(CONTACT_EVIDENCE_OBJECT_STORE).put(
      metadata,
      `${CONTACT_EVIDENCE_MANIFEST_PREFIX}${contactId}`
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function readContactEvidenceManifest(
  contactId: string
): Promise<Evidence[]> {
  if (!contactId || typeof indexedDB === "undefined") return [];

  const db = await openContactEvidenceDb();
  const evidence = await new Promise<Evidence[]>((resolve, reject) => {
    const tx = db.transaction(CONTACT_EVIDENCE_OBJECT_STORE, "readonly");
    const request = tx.objectStore(CONTACT_EVIDENCE_OBJECT_STORE).get(
      `${CONTACT_EVIDENCE_MANIFEST_PREFIX}${contactId}`
    );
    request.onsuccess = () => resolve((request.result as Evidence[] | undefined) || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return evidence;
}

export async function readContactEvidenceDataUrl(
  evidenceId: string
): Promise<string | undefined> {
  if (!evidenceId || typeof indexedDB === "undefined") return undefined;

  const db = await openContactEvidenceDb();
  const dataUrl = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(CONTACT_EVIDENCE_OBJECT_STORE, "readonly");
    const request = tx.objectStore(CONTACT_EVIDENCE_OBJECT_STORE).get(evidenceId);
    request.onsuccess = () => resolve(request.result as string | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return dataUrl;
}

export function contactsWithoutEmbeddedEvidenceData(
  contacts: Contact[]
): Contact[] {
  return contacts.map((contact) => ({
    ...contact,
    evidence: (contact.evidence || []).map(
      ({ dataUrl: _dataUrl, ...metadata }) => metadata
    ),
  }));
}
