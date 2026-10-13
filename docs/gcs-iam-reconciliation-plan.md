# Production GCS IAM reconciliation plan (review only; nothing here has been applied)

Project `tes-production-510007`. Existing: Cloud Run `document-security-scanner` (us-central1), Eventarc trigger `tes-quarantine-document-scanner`
(location `us`), identities: backend `tes-backend`, scanner `tes-security-scanner`, trigger `tes-eventarc-scanner-trigger`, AI processor
`tes-ai-doc-processor` (all `@tes-production-510007.iam.gserviceaccount.com`). Nothing below creates a service account, bucket or key, deletes or disables a key,
redeploys the scanner, touches the trigger, or grants a project-level role.

## 1. Storage operations in the repository, and the permission each needs

| Identity | Code | Operation | Permission |
| --- | --- | --- | --- |
| Backend (Vercel via WIF, impersonating `tes-backend`) | `lib/google/storage.ts` `uploadQuarantineObject` → `create-only-write.ts` | non-resumable create-only save (`ifGenerationMatch: 0`) into quarantine | `storage.objects.create` |
| Backend | `statStorageObject`, `readStorageObject` (generation-pinned), `intakeObjectExists`, `evidence…Exists/Metadata/download` | `exists()`, `getMetadata()`, `download()` on intake and evidence | `storage.objects.get` |
| Backend | `copyIntakeToEvidenceCreateOnly` | server-side copy intake (pinned generation) → evidence, `ifGenerationMatch: 0` | `get` on intake, `create` on evidence |
| Backend | `listStorageObjects` (used only by `auditEvidencePayloads`, which has **no caller**) | list | `storage.objects.list`; **not granted to the backend**, belongs to an operator identity |
| Backend | `moveIntakeObjectToEvidence` (copy then `delete()` from intake) | **no caller anywhere** (dead code) | would need `delete`; not needed, not granted |
| Backend | `scripts/check-google-integration.ts` | `exists()` on each bucket (diagnostic, run by a person) | `get`; quarantine already reports forbidden by design |
| Scanner (`services/document-security-scanner/src/storage.ts`) | `getQuarantineObjectMetadata`, `downloadQuarantineObject` (generation-pinned) | metadata + bytes of the scanned generation | `get` on quarantine |
| Scanner | `promoteQuarantineObjectToIntake` / `copyCreateOnly` | copy pinned quarantine generation → intake, `ifGenerationMatch: 0`; 412 = already exists | `get` on quarantine, `create` on intake |
| Scanner | `downloadIntakeObject` | read-back and SHA-256 compare after the copy, and on the 412 path | **`get` on intake** |
| Scanner | quarantine delete / overwrite, evidence anything | none (source "is never deleted") | none |
| AI processor | **no reference anywhere in the repository** | Document AI `:process` calls are made with the backend's WIF token (`lib/google-document-ai-provider.ts`, `lib/google/auth.ts`); `batchProcess` (which needs buckets) appears only in comments | **none established** |

Predefined roles are broader than these: `objectAdmin` adds `delete`, `update`, `list`, IAM edits; `objectCreator` has `create` only (so the scanner cannot read back).

## 2. Current versus target (per bucket)

| Bucket | Identity | Current | Target | Grants |
| --- | --- | --- | --- | --- |
| quarantine | backend | Object Creator | **unchanged** | `create` |
| quarantine | scanner | Object Admin | custom `tesScannerQuarantineReader` | `get` |
| quarantine | AI processor | Object Admin | none | |
| intake | backend | Object Admin | custom `tesPortalObjectReader` | `get` |
| intake | scanner | Object Creator | custom `tesScannerIntakeWriter` | `create`, `get` |
| intake | AI processor | Object Admin | none | |
| evidence | backend | Object Admin | custom `tesPortalEvidenceWriter` | `create`, `get` |
| evidence | scanner | none | none | |
| evidence | AI processor | Object Admin | none | |
| all three | trigger identity | (unknown) | none | |
| service / project | trigger identity | (unknown) | `roles/run.invoker` on the service; `roles/eventarc.eventReceiver` on the project | |
| project | Cloud Storage service agent | (unknown) | `roles/pubsub.publisher` | |

Notes: the scanner is missing `get` on intake today, so its read-back cannot work (the README says it holds Object Viewer there; the observed state says Creator).
Whether `get` alone is enough for a missing-object `exists()` to return false rather than 403 is standard GCS behavior but should be confirmed with the
add-phase test below; the fallback is `roles/storage.objectViewer` (adds `list`) for the backend on intake/evidence, an owner decision.

## 3. Deployment script reconciled with the real names
`deploy/deploy.sh` defaults now match production: trigger `tes-quarantine-document-scanner`, trigger identity `tes-eventarc-scanner-trigger`, service `document-security-scanner`,
Cloud Run region `us-central1`, and an Eventarc location derived from the quarantine bucket (expected `us`, a multi-region). Before, its defaults would have planned a **second** trigger and a new
service account. It still refuses (blocker) while the IAM drift exists, so run IAM reconciliation first. The IAM work uses the new `deploy/reconcile-iam.sh`, not `deploy.sh`.
Both are exercised by offline fake-gcloud tests (`deploy/test/*.test.sh`, in CI).

## 4. The AI processor
No workflow in the repository references it. Its only probable consumer is the legacy `GOOGLE_APPLICATION_CREDENTIALS_JSON` variable (audit finding F-036: the code never reads it) or
tooling outside the repository. Its key is a standing bypass of the keyless design. Evidence that it is unused must come from the owner (section 7). Until then: do not touch it.

## 5. Phased, dry-run-first commands (`deploy/reconcile-iam.sh`)
Preconditions for **every** phase: an operator identity (not any of the four accounts) with `roles/storage.admin` on the three buckets and `roles/iam.roleAdmin` for the custom roles; the checks in section 7 done; `main` checked out.
```
cd services/document-security-scanner/deploy
./reconcile-iam.sh                                   # PLAN: read-only. Resolve every blocker by hand (unlisted binding, conditional binding, public principal, wrong custom role).
./reconcile-iam.sh --phase add --confirm tes-production-510007:add          # roles + TARGET bindings. Adds only; removes nothing.
./reconcile-iam.sh --phase verify                    # Policy Troubleshooter must GRANT every required permission (includes inherited roles)
# test in production-safe ways (see 6), then one identity at a time, each re-verifying first:
./reconcile-iam.sh --phase remove --only backend --confirm tes-production-510007:remove:backend
./reconcile-iam.sh --phase remove --only scanner --confirm tes-production-510007:remove:scanner
./reconcile-iam.sh --phase remove --only ai      --confirm tes-production-510007:remove:ai     # only after section 7 shows no use
./reconcile-iam.sh --phase verify --final            # proves delete/update/setIamPolicy are denied for backend, scanner and ai on all three buckets
```
Idempotent: a present binding or role is skipped; an absent excess binding is skipped. It refuses on any binding it does not recognize, and never edits a custom role that differs.
**Rollback (per identity, immediate):** `./reconcile-iam.sh --phase rollback --only <backend|scanner|ai> --confirm tes-production-510007:rollback:<who>` re-adds exactly that identity's original (recorded) bindings.

## 6. Why no production workflow is interrupted
- Add-then-verify-then-remove: a permission is never absent. The remove phase refuses unless the target bindings exist **and** Policy Troubleshooter grants every required permission.
- Backend: quarantine untouched; the only delete-capable function is dead code; intake/evidence reads and the create-only copy are covered by the targets.
- Scanner: the narrower quarantine role still covers metadata, download and the copy source; the intake change **adds** `get`.
- **Scanner removal precondition:** the deployed revision must be built from this repository (an older scanner that *moves* files would need `delete` on quarantine). Compare the revision's image digest and provenance (section 7) before `remove --only scanner`.
- AI processor: nothing in the repository uses it; removal waits for the owner's usage evidence. Document AI calls use the backend token.
- Do the changes at a quiet time and run one portal evidence view and one test upload in a **non-customer** context afterwards (this repo's smoke plan), not before approval.

## 7. Information the repository cannot give, and the read-only commands that answer it
```
P=tes-production-510007; R=us-central1
# a. current bucket policies (confirm the observed drift; save the output)
for b in quarantine intake evidence; do gcloud storage buckets get-iam-policy gs://tes-production-$b --project $P --format=json > before-$b.json; done
# b. inherited and project-level access for the four accounts, and roles that carry storage permissions
gcloud projects get-iam-policy $P --format=json > project-policy.json   # look for these members, and for roles/owner, roles/editor, roles/storage.admin, roles/storage.objectAdmin
gcloud projects get-ancestors $P                                          # then: gcloud resource-manager folders get-iam-policy FOLDER_ID / gcloud organizations get-iam-policy ORG_ID
gcloud projects get-iam-policy $P --format=json | python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin).get('auditConfigs'),indent=1))"   # are Data Access logs on for storage?
# c. effective (incl. inherited and deny) access, per permission
gcloud policy-troubleshoot iam //storage.googleapis.com/projects/_/buckets/tes-production-evidence --principal-email=tes-backend@$P.iam.gserviceaccount.com --permission=storage.objects.delete
gcloud asset analyze-iam-policy --project=$P --full-resource-name=//storage.googleapis.com/projects/_/buckets/tes-production-evidence --identity=serviceAccount:tes-ai-doc-processor@$P.iam.gserviceaccount.com --permissions=storage.objects.delete --expand-groups
# d. the deployed scanner is the repository's scanner, and runs as the scanner account (not the default compute account)
gcloud run services describe document-security-scanner --region $R --project $P --format='value(spec.template.spec.serviceAccountName,spec.template.spec.containers[0].image,status.latestReadyRevisionName)'
gcloud artifacts docker images describe IMAGE_WITH_DIGEST --show-provenance          # compare with the merged commit that built it
gcloud eventarc triggers describe tes-quarantine-document-scanner --location us --project $P --format=json   # filters, destination, serviceAccount
# e. trigger identity and service-agent roles
gcloud run services get-iam-policy document-security-scanner --region $R --project $P
# f. is the AI processor used? (every command is read-only)
gcloud iam service-accounts keys list --iam-account=tes-ai-doc-processor@$P.iam.gserviceaccount.com --managed-by=user --project $P
gcloud policy-intelligence query-activity --activity-type=serviceAccountKeyLastAuthentication --project $P --limit 50
gcloud policy-intelligence query-activity --activity-type=serviceAccountLastAuthentication --project $P --limit 50
gcloud logging read 'protoPayload.authenticationInfo.principalEmail="tes-ai-doc-processor@'$P'.iam.gserviceaccount.com"' --project $P --freshness=30d --limit 20
gcloud run services list --project $P --format='table(metadata.name,spec.template.spec.serviceAccountName)'
gcloud functions list --project $P --format='table(name,serviceAccountEmail)'; gcloud scheduler jobs list --project $P --location $R
# Vercel: Project > Settings > Environment Variables: is GOOGLE_APPLICATION_CREDENTIALS_JSON (or any key) set in Production, Preview or Development? Ask developers about local .env.local.
```
Commands are written for current gcloud releases; if a flag differs in your version, stop and ask rather than guess.

## 8. Classification
**Immediately necessary security corrections (after the section 7 checks):**
1. Remove the AI processor's Object Admin on all three buckets (and, separately, retire its user-managed key).
2. Replace the backend's Object Admin on intake and evidence (overwrite and delete are possible today, contradicting the create-only design).
3. Replace the scanner's Object Admin on quarantine.
4. Give the scanner `get` on intake (functional: its read-back and idempotent re-delivery cannot succeed without it).
5. Confirm no inherited project/folder/org role (Owner, Editor, Storage Admin) still grants delete/update, and that the scanner runs as its own account.

**Key retirement (owner decision, outside this plan's scripts):** after bindings are removed and the activity queries show no recent use, *disable* the key (`gcloud iam service-accounts keys disable KEY_ID --iam-account=…`, reversible), watch for a full business cycle, and only then delete it (irreversible, separate approval).

**Future improvements, not needed now:** Terraform for all IAM; IAM conditions or a retention policy with bucket lock on evidence; Data Access audit logs for storage; a list-only operator identity and scheduled `auditEvidencePayloads`; removing the dead `moveIntakeObjectToEvidence`; cleaning the stale README line about the scanner's intake role; a per-identity Document AI role review.
