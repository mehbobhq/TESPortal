# Bulk document ingestion — deferred pre-launch architecture

Status: **not built yet, deliberately deferred to pre-launch.** During
development (now), large documents are handled by the local PDF-chunking
workaround in `app/api/document-ai/route.ts` (see the comment block above
`SYNC_PAGE_LIMIT` in that file). This document describes what actually needs
to be built before onboarding real carriers at volume (the stated target:
multiple companies uploading thousands of documents concurrently), so the
research doesn't have to happen twice.

## Why the current (dev-phase) approach won't hold up

`app/api/document-ai/route.ts` calls Document AI's **synchronous** `process`
endpoint. That endpoint hard-caps at **15 pages per request** (30 with
`imageless_mode`, which this processor doesn't have confirmed as enabled),
and **40 MB** per file. The local chunking workaround splits a large PDF into
≤15-page pieces and calls that same endpoint once per chunk — which unblocks
one-person, one-document-at-a-time testing, but does not scale to "10
companies uploading 5,000 documents at the same second": that's potentially
hundreds of thousands of individual synchronous API calls competing for
Document AI's per-minute quota, run from a single Next.js server process,
with no queue, no retry/backoff, and no durability if the server restarts
mid-batch.

It also does not solve **document-type segregation** — a bundle containing a
mix of your 130+ document types (CDL copies, MVRs, medical certs, roadside
reports, etc. all scanned into one file) will run entirely through whichever
single extractor processor handles the call; pages that don't match that
processor's schema come back with few or no mapped fields, not an error.

## What replaces it

Three separable pieces. They don't have to ship together, but each depends
on the one before it existing (batch processing depends on GCS; splitting
depends on batch processing).

### 1. A plain Cloud Storage bucket (mechanical prerequisite, not "security")

Document AI's asynchronous **`batchProcess`** API is the only way to process
documents past the 15-page sync limit at real volume — it reads input from a
GCS URI and writes results to a GCS URI. There is no way to call it without
object storage; this is unrelated to malware scanning. Roughly:

- One input bucket (`tes-docai-input` or similar), one output bucket
  (`tes-docai-output`).
- A service account with `roles/documentai.apiUser` and
  `roles/storage.objectAdmin` scoped to those two buckets (the Document AI
  service agent also needs read on input / write on output — Google's docs
  cover the exact IAM binding for `batchProcessDocuments`).
- Batch limits (current, per Document AI docs): up to **5,000 files** or
  **1 GB** per batch request; per-processor page ceiling for async requests
  is processor-dependent (roughly 100–1,000 pages).

### 2. A Splitter/Classifier processor (the actual "segregate by type" step)

This is the Document AI processor type that does what was described as the
real goal: take one long scan and both cut it at document boundaries *and*
tag each resulting piece with a document type. Two processor types are
relevant:

- **Custom Document Splitter** — cuts at boundaries only (up to ~1,000 pages
  in async mode).
- **Custom Document Classifier** — splits *and* classifies against a defined
  label set (~200 pages in async mode). This is the one that matches "CDL
  copy vs. MVR vs. medical cert vs. roadside report," but it needs to be
  trained: labeled example documents for each of (a meaningful subset of)
  the 130+ document types in the taxonomy already defined in
  `lib/driver-taxonomy.ts` and the ingestion architecture notes. Training
  data volume and label count is the actual lead-time item here, not the
  GCP plumbing.

The output of this stage is a set of classified sub-documents, each of which
then gets routed to the *existing*, already-correct per-type extraction +
`resolveRoadsideCanonicalFacts`-style resolution + confidence-gated
auto-save/review-queue pipeline (`lib/auto-save-roadside.ts` and siblings) —
none of that downstream logic needs to change.

### 3. Malware/security scanning (quarantine bucket) — last, before real external uploads

Google's published reference architecture for this
(<https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage>):

- **Three buckets**: unscanned (upload target) → clean → quarantined.
- **Cloud Run** service running ClamAV, triggered by **Eventarc** on new
  objects landing in the unscanned bucket.
- Clean files are moved to the clean bucket (this becomes the input to step
  1's batch pipeline); infected files move to quarantined and never reach
  Document AI or the app.
- **Cloud Scheduler** refreshes the ClamAV virus database on a timer
  (Google's reference uses every 2 hours).
- Cloud Logging/Monitoring for scan results and alerting.

Google also publishes a deployment guide with the exact Terraform/gcloud
steps: <https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage/deployment>.

## Suggested build order, when this gets picked back up

1. Input/output GCS buckets + service account IAM (small, mechanical, no
   design decisions).
2. Swap `app/api/document-ai/route.ts`'s large-file path from local chunking
   to real `batchProcess` calls against those buckets (keeps the same
   response shape the rest of the app already consumes).
3. Stand up the Splitter/Classifier processor and start collecting/labeling
   training examples per document type — this has the longest lead time, so
   it's worth starting the labeling effort early even before buckets 1–2 are
   wired up.
4. Quarantine/ClamAV/Eventarc layer in front of the unscanned bucket, once
   external (non-founder) uploads are actually happening.

## Sources consulted

- [Document AI limits](https://docs.cloud.google.com/document-ai/limits) — sync (15pg/40MB) vs. async (5,000 files/batch, 1GB/file, processor-dependent page ceilings) limits, Splitter/Classifier page ceilings.
- [Automate malware scanning for files uploaded to Cloud Storage](https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage) — reference architecture (buckets, Cloud Run + ClamAV, Eventarc, Cloud Scheduler).
- [Deployment guide for the above](https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage/deployment).
- [Send a batch process documents request](https://docs.cloud.google.com/document-ai/docs/samples/documentai-batch-process-document) — `batchProcessDocuments` API shape.
