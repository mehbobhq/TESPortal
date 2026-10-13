# Evidence payload lifecycle (migration 0032)

Closes the GCS document/evidence payload block on top of the 0030 evidence metadata and the 0031 contracts foundation.
Nothing here edits migrations 0001–0031; 0032 is additive. **Payloads live in GCS only.** PostgreSQL stores metadata (tenant-scoped
object names, generations, SHA-256, state), never bytes. The browser never sees a bucket, an object name or a URL.

## Lifecycle

```
 browser ──bytes──▶ server (validate, hash, authorize) ──create-only──▶ quarantine/{org}/{batch}/{file}/source        state: quarantined
                                                                              │  (Eventarc)
                                                       document-security-scanner (isolated Cloud Run service)
                                                          │ CLEARED only: copy exact scanned generation
                                                          ▼
                                                    intake/{org}/{batch}/{file}/source        (written ONLY by the scanner)
   finalize: stat intake → read pinned generation → re-hash == hash declared at upload ?     state: cleared   (else blocked)
                                                          │ create-only copy (ifGenerationMatch: 0), re-hash
                                                          ▼
                                                    evidence/{org}/{document}/source                                      state: stored
   stored → superseded (a replacement was stored) | archived        blocked → archived        (nothing is ever deleted)
```

| State | Meaning | Viewable |
| --- | --- | --- |
| `quarantined` | accepted, untrusted, unscanned | no |
| `cleared` | the scanner promoted it; the portal re-hashed the intake bytes and they match the upload hash | no |
| `stored` | copied create-only into the evidence bucket and re-hashed; `verified_sha256` recorded | yes |
| `blocked` | terminal safety state: hash mismatch at intake or evidence, or an operator block | no |
| `superseded` / `archived` | retained history | yes (evidence object still exists) |

Transitions are forward-only and enforced by `guard_evidence_payload_update` (and mirrored in `lib/evidence-payload/definitions.ts`).

## Object naming (`lib/evidence-payload/object-keys.ts`)

| Prefix | Shape | Writer |
| --- | --- | --- |
| `quarantine/` | `quarantine/{org}/{batch}/{sourceFile}/source` | portal, create-only (shape fixed by the scanner contract) |
| `intake/` | `intake/{org}/{batch}/{sourceFile}/source` | **scanner only** |
| `evidence/` | `evidence/{org}/{document}/source` | portal, create-only, after hash re-verification |
| `processed/` | `processed/{org}/{document}/{artifact}` (closed list: `ocr-text.json`, `ocr-layout.json`, `preview.png`) | reserved for derived artifacts; nothing writes it yet |

Every segment is a canonical lower-case UUID derived server-side — never from a filename or client input. The original filename is
display metadata only. The database re-derives the same names in CHECK constraints (`evidence_payloads_*_name_valid`), so a row
can only ever point at a name containing its own organization (and, for evidence, its own document id).

## Security model

- **Authorization:** every entry point is `withAuthorizedSystem` with `EVIDENCE_READ` (list, view, audit) or `EVIDENCE_MANAGE`
  (upload, finalize, review, link, block, archive). No new capability. There is no CUSTOMER-scope path.
- **Order of operations on upload:** validate bytes (size ≤ 25 MB, MIME allow-list, magic bytes) → hash → authorize and check the
  organization exists → create-only quarantine write → record document + payload + Master Register event in one transaction.
  An unauthorized or invalid caller never causes a storage write. A crash after the write leaves an unreferenced quarantine
  object that the audit reports and nothing serves.
- **Tenant isolation:** every lookup is `organization_id AND id`; another tenant's document is "not found" (no register event, no
  storage call). Object names are tenant-scoped by construction and by CHECK. The audit can be limited to one tenant's prefix.
  *Scope note:* SYSTEM capabilities are global to TES staff, so isolation here means a request for organization A can never reach
  organization B's document, and a customer-scope caller reaches nothing (the policies are SYSTEM-only).
- **No raw paths or URLs:** the client view (`EvidenceItemView`) carries state, type, size and status only. There is no signed URL,
  public URL, ACL or redirect anywhere. Bytes are proxied by the server.
- **Secure view:** `GET /api/companies/{id}/evidence/{documentId}` authorizes, writes the Master Register `DOCUMENT_VIEWED` event
  and an `evidence_payload_access_events` row in a **committed transaction before any byte is read**, then reads the verified
  generation and re-hashes it against `verified_sha256`; a mismatch is refused and recorded as a failed validation. Response is
  `inline`, `private, no-store`, `nosniff`, sandboxed CSP, same-origin only. No download or print endpoint exists. A browser can
  still save what it renders: this is an audit and policy control, not DRM. **No watermark** is applied (the viewer has no
  rendering pipeline for it); that is an explicit non-goal for this block.
- **No deletes:** no `DELETE`/`TRUNCATE` grants or successful triggers on any new table; the storage port has no delete or
  overwrite; copies are create-only; old versions are archived/superseded. The pre-existing `moveIntakeObjectToEvidence` (which
  deletes from intake) is not used by this lifecycle.
- **Database guards on the 0030 tables (triggers only):** the application role cannot insert an evidence document in any status but
  `received`; a document can reach `classified`/`verified` only with a `stored`, hash-verified payload; its hash, size, MIME and
  organization are immutable and its storage location can only move to its own verified evidence object; a requirement can be
  `received`/`verified` only through a stored payload of the required type (`verified` also needs a verified, unexpired document).

## Master Register

| Action | Event type |
| --- | --- |
| Upload accepted into quarantine (with the SHA-256 as a HASH value) | `DOCUMENT_INGESTED` |
| cleared / stored / blocked | `RECORD_STATUS_CHANGED` |
| Replacement stored | `DOCUMENT_SUPERSEDED` (on the replaced document) |
| **Every view** | `DOCUMENT_VIEWED` (+ `evidence_payload_access_events.master_register_event_id`, NOT NULL FK) |
| Integrity failure on read | `VALIDATION_COMPLETED` with outcome FAILURE |
| Review (classified / verified / rejected) | `VALIDATION_COMPLETED` |
| Requirement linked | `EVIDENCE_ASSOCIATED` |
| Archive | `DOCUMENT_ARCHIVED` |

Events carry references and controlled literals only — no object name, URL or content.

## Evidence requirements and readiness

`satisfyRequirement` derives the requirement from the document type (`CUSTOMER_AUTHORITY_NOTICE`, `CUSTOMER_ONBOARDING_PACKAGE`,
`SERVICE_SCOPE_CONFIRMATION`, `RESPONSIBILITY_START_CONFIRMATION`, `REQUIRED_SETTINGS_CONFIRMATION`). A stored but unreviewed
document makes the requirement `received`; only a **verified**, payload-backed document makes it `verified`. Onboarding readiness
now counts only `verified`, `waived` or `not_applicable` — `received` no longer satisfies a requirement. The 0031 contract gates
(`contract_evidence_document_acceptable`) already require a `verified` document, which now implies a stored, hash-verified payload.
Archiving or superseding a document removes it from those gates until a replacement is verified and linked.

## Environment variables (server-side only — never `NEXT_PUBLIC_*`)

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLOUD_PROJECT_ID` | project |
| `GOOGLE_GCS_QUARANTINE_BUCKET` | raw untrusted uploads (create-only) |
| `GOOGLE_GCS_INTAKE_BUCKET` | scanner-cleared copies (portal reads, never writes) |
| `GOOGLE_GCS_EVIDENCE_BUCKET` | permanent evidence (portal create-only writes + reads) |
| `GOOGLE_CLOUD_PROJECT_NUMBER`, `GOOGLE_WIF_POOL_ID`, `GOOGLE_WIF_PROVIDER_ID`, `GOOGLE_BACKEND_SERVICE_ACCOUNT`, `GOOGLE_WIF_OIDC_AUDIENCE` | production keyless auth (Vercel OIDC → Workload Identity Federation) |

No key, service-account JSON or database password exists in this design. `scripts/storage/verify-evidence-storage-config.mjs`
fails if any static credential variable is set or if the three buckets are not distinct.

## IAM expectations (the repo cannot prove these; the live verifier checks what it can read)

Bind to the **portal backend service account** (the identity Vercel impersonates through WIF), per bucket:

| Bucket | Roles / permissions needed | Must NOT have |
| --- | --- | --- |
| quarantine | `storage.objects.create` | get, list, update, delete |
| intake | `storage.objects.get` (stat/read) | create, update, delete |
| evidence | `storage.objects.create`, `storage.objects.get` | update, delete, overwrite |

- The **scanner service account** alone holds `storage.objects.create` on intake (and `get` on quarantine).
- The **audit/recovery operator** identity (not the portal) needs `storage.objects.list` on the three buckets.
- Every bucket: uniform bucket-level access **on**, public access prevention **enforced**, no `allUsers`/`allAuthenticatedUsers`.
  Evidence bucket: object **versioning on** and a retention or soft-delete policy (recovery from overwrite/corruption).
- Eventarc trigger on quarantine finalize → scanner (already part of the ingestion spine).

`node scripts/storage/verify-evidence-storage-config.mjs --live` (read-only; exit 0 verified, 1 violated, **2 could not verify —
treated as failure**) checks uniform access, public access prevention, versioning/retention, and public IAM members.

## Recovery and audit

`auditEvidencePayloads({ organizationId?, deepVerify? })` compares database rows with bucket listings and reports (never repairs):
`MISSING_EVIDENCE_OBJECT`, `EVIDENCE_SIZE_MISMATCH`, `EVIDENCE_GENERATION_MISMATCH`, `MISSING_INTAKE_OBJECT`, `SCAN_STALLED`
(quarantined > 24 h with no intake object — scanner outage or an unsafe file), `ORPHAN_QUARANTINE_OBJECT` (upload whose database
record failed), `ORPHAN_INTAKE_OBJECT`, `ORPHAN_EVIDENCE_OBJECT`, `UNRECOGNIZED_OBJECT`, `CROSS_TENANT_OBJECT`. `deepVerify`
re-hashes every stored object.

- **Finalize is idempotent.** If the evidence copy succeeded but the database update did not, the next finalize adopts the existing
  object only if its bytes hash to the declared value; otherwise the payload is `blocked` (`EVIDENCE_HASH_MISMATCH`) and the object
  is left untouched.
- **Retention assumptions:** quarantine and intake objects are never deleted by the application; trim them with bucket lifecycle
  rules once the evidence copy is verified (suggested: intake/quarantine 90 days after `stored`; evidence indefinite under the
  retention policy). Orphans are reviewed by an operator — nothing is auto-deleted.

## Known limits and non-goals

- Legacy browser stores (`lib/evidence-payload-store.ts`, `lib/evidence-file-store.ts`: IndexedDB) are still used by the older
  business/driver/audit UIs. The new lifecycle never touches them, and a boundary test ratchets their importers so the set can only
  shrink. Migrating those screens is a separate block.
- `/api/document-ai` and `/api/business-document-ocr` are **not** part of the payload lifecycle: they take bytes from the browser and
  send them to Document AI without quarantine or malware scanning, and they persist nothing. They are temporarily restricted
  (`lib/legacy-ocr/`): `EVIDENCE_MANAGE` is required (previously any signed-in user), the file must be a PDF/JPEG/PNG/WebP of at most
  25 MB (20 MB for corporate OCR) whose leading bytes match its declared type, and setting `TES_LEGACY_OCR_DISABLED=true` in the
  deployment turns both routes off (503) without a code change. Workflows that depend on them (Corporate Documents OCR in
  `src/components/business/CorporateDocumentsSection.tsx`, roadside/driver OCR through `lib/roadside-machine-client.ts`) keep working
  for staff holding `EVIDENCE_MANAGE`; they must move to OCR-of-cleared-evidence (not implemented; nothing writes `processed/`) before
  these routes can be retired. Neither route is tenant-scoped, so there is no cross-tenant surface to test; they never read stored evidence.
- Uploads are proxied through the Next.js server, so the hosting platform's request-body limit can be lower than the 25 MB product
  limit; large files need a chunked server-side upload (not a direct-to-GCS URL, which this design forbids).
- No watermarking, no download/print policy beyond "inline only", no customer-facing evidence access, no e-signature.
- The scanner decision is inferred from the presence of the cleared intake object plus a matching hash; the scanner does not write
  to PostgreSQL by design.

## Production closure sequence (later, on explicit approval only)

1. Merge the PR (CI green, owner approved).
2. Confirm buckets/IAM/env above exist (`verify-evidence-storage-config.mjs --live` via the verification workflow with `check_storage`).
3. **PRE** — dispatch *Production Evidence Payload Lifecycle Verification* with `phase=pre` (database still at 0031, no 0032 object).
4. Run the guarded *Production Database Migration* workflow (applies exactly 0032; ledger must read 32).
5. **POST** — dispatch the verification workflow with `phase=post` (and `check_storage` once more).
6. Stop on any deviation: `main` moved, PRE sees 0032, the migration applies anything but 0032, or POST differs.
