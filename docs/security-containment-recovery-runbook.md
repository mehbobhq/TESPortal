# Security containment release: recovery runbook

Status: **written, not executed.** Nothing in this document has been run, and no step in it may be run without the explicit,
recorded approval of the founder. It describes what to do, in what order, and when to stop. It does not authorize anything.

## 1. Facts this runbook relies on

| Item | Value |
|---|---|
| Production baseline (**vulnerable**, see section 2) | `11e2fcdc7b6118866432a79810b225226eeffab4` |
| Minimum containment baseline | `4e22d02d6aea4dda0cc2617b479a180026df808c` |
| Canonical classification repair | `4c979bcd15a2b00bfdeda59f9684ac0347e24d15` |
| Final classification repair | `1069f7fc4c99645930a98939397adc2fa6718c21` |
| Release branch | `release/security-containment-rc-20261016` |

History is linear: `11e2fcd` → `85ef44d` → `d0f96c2` → `4e22d02` → `4c979bc` → `1069f7f`. The containment is
`85ef44d`, `d0f96c2` and `4e22d02`. `4c979bc` and `1069f7f` only change how errors are mapped to HTTP statuses.

## 2. Why `11e2fcd` must never be restored automatically

At `11e2fcd` the driver-application endpoints are open:

- `GET /api/driver-applications/submissions`: any signed-in user can read applicant submissions by listing application ids. There is
  no ownership or capability check.
- `POST /api/driver-applications/submissions`: writes applicant data to a local JSON file that is not durable on serverless hosting
  and not scoped to a customer.
- `POST /api/driver-applications/send-invitation`: any signed-in user can send a TES-branded invitation email and obtain a signed
  invitation token, using a company name, driver and recipient taken from the request body.

Any rollback that returns Production to `11e2fcd` reopens all three. A previous Production deployment still exists in the Vercel
history and one click ("Instant Rollback", or promoting it) would restore it. **That is prohibited by this runbook.**

## 3. Standing prohibitions

1. No rollback or promotion of any deployment built from `11e2fcd`, and no `git revert` of `85ef44d`, `d0f96c2` or `4e22d02`.
2. No force-push, history rewrite or direct commit to `main`.
3. No promotion of a Preview deployment to Production. Environment values are bound when a deployment is built, so a promoted
   Preview would run with Preview configuration. Production is only ever built from `main`.
4. No change to environment variables, Vercel deployment protection, Clerk settings, database configuration or migrations as part
   of recovery.
5. No connection of Preview to Production PostgreSQL, and no weakening of authentication to make a check pass.
6. No Production action of any kind without the founder's explicit approval, recorded as in section 9.

## 4. `4e22d02` is a minimum baseline, not an approved deployment

`4e22d02` is the smallest commit that contains the full containment. It is the floor below which recovery must never go. It is
**not** a pre-approved target:

- It has the known classification defect: in a production build, a denied request returns HTTP 500 instead of 403, because the
  error mapping reads `constructor.name`, which a production build minifies. It still fails closed: nothing is released and nothing
  is sent.
- It has never been deployed to Production, and a deployment of it needs its own build, its own verification (section 7) and the
  founder's approval, exactly like any other release.
- Using it means deliberately choosing "contained, with wrong statuses on denial" over the repaired candidate.

## 5. Before the release (preparation only)

Record these in the decision log (section 9) before the founder approves a Production release:

1. The current Production deployment ID and its source commit (expected `11e2fcd`), and that `origin/main` is `11e2fcd`.
2. The Preview deployment of the release candidate: its URL, ID, source commit (must be the approved SHA), Ready status, and that
   Vercel Authentication is on.
3. The location of an off-session copy of the release history (a Git bundle of `main`, the release branch and the candidate), with
   its SHA-256, so that the candidate cannot be lost with a build machine.
4. The names of the people who can approve and who can act on Vercel and GitHub.
5. Agreement that the recovery order in section 8 applies.

## 6. Releasing (for reference; each step needs founder approval)

1. Re-check `origin/main`. If it is not `11e2fcd`, stop and re-run the readiness assessment.
2. Merge the approved release branch into `main` with a normal merge (no force). Merging `main` is expected to trigger the
   Production deployment; confirm the project is configured that way rather than assuming.
3. Do not trigger any other Production deployment manually.

## 7. Verifying the Production deployment

### 7.1 Deployment identity (Vercel dashboard and Git; no secrets involved)

- The newest Production deployment is **Ready** and its source commit equals the approved SHA, exactly.
- Its build log shows a successful build and **no** migration step.
- `origin/main` equals the approved SHA, and no other Production deployment was created.
- Deployment protection and environment variables show no change in the project's audit log since the release started.
- Record the deployment ID.

### 7.2 Containment behavior, with no customer data (Windows PowerShell)

Public requests only; synthetic content; nothing read from or written to any customer record. Replace the placeholder host with
the Production host.

```powershell
$Prod = "https://<production-host>"
$Body = Join-Path $env:TEMP "tes-empty.json"; [IO.File]::WriteAllText($Body, "{}")
curl.exe -sS -o NUL -w "A1 POST submissions, no token      -> %{http_code} %{content_type}`n" -X POST -H "Content-Type: application/json" --data-binary "@$Body" "$Prod/api/driver-applications/submissions"
curl.exe -sS -o NUL -w "A2 POST submissions, fake bearer   -> %{http_code} %{content_type}`n" -X POST -H "Content-Type: application/json" -H "Authorization: Bearer not-a-real-token" --data-binary "@$Body" "$Prod/api/driver-applications/submissions"
curl.exe -sS -o NUL -w "B1 GET  submissions, no session    -> %{http_code} %{content_type}`n" "$Prod/api/driver-applications/submissions"
curl.exe -sS -o NUL -w "C1 POST send-invitation, no session-> %{http_code} %{content_type}`n" -X POST -H "Content-Type: application/json" --data-binary "@$Body" "$Prod/api/driver-applications/send-invitation"
```

Expected:

| Probe | Expected |
|---|---|
| A1, A2 | `401` JSON |
| B1 | `401` JSON |
| C1 | Rejected by Clerk (`404`, `401`, or a `307` to Clerk), never `400`, `503` or `2xx` |

**Optional, only with separate founder approval:** one authenticated check from the founder's own signed-in browser session,
reading the status line only (no bodies pasted, no Network-tab exports):

```js
for (const [m,p,b] of [["GET","/api/driver-applications/submissions"],["POST","/api/driver-applications/send-invitation","{}"]]) {
  const r = await fetch(p,{method:m,headers:b?{"Content-Type":"application/json"}:{},body:b,cache:"no-store"});
  console.log(m,p,r.status);
}
```

Expected for an account without driver authority: `403` on both. For an account holding `DRIVER_READ`: `503` on GET. For an account
holding `DRIVER_MANAGE`: `400` on POST `{}` (nothing is sent). This touches only the account's own identity record.

### 7.3 What counts as unexpected

Any `2xx` from `send-invitation`; any `2xx` from either `submissions` method with a body containing `submissions`, application ids
or personal fields; a `401` replaced by a `200`; a `503` for an unauthenticated caller; a stack trace, database text or host name
in any body; a Vercel login page in front of a production endpoint. Treat any of these as a stop condition (section 10).

## 8. Recovery decision tree

Always compare against section 7 first; decide from the observed behavior, not from the symptom's first report.

### A. The containment holds, but the classification repairs misbehave
(Examples: widespread unexpected `4xx`/`5xx` on OCR, contracts or company routes; a contracts workspace that no longer loads.)

Roll **forward**, never to `11e2fcd`:

1. On a new branch from `main`, revert `1069f7f` first, then `4c979bc` (newest first, because `1069f7f` builds on `4c979bc`;
   reverting `4c979bc` alone conflicts). Reverting those two exactly, on top of `1069f7f`, yields a tree identical to `4e22d02`
   (checked locally). If a later commit also edited `test/lib/api/canonical-response.test.ts`, reverting `4c979bc` conflicts on
   that file; resolve by deleting it, which is what the revert intends.
2. Run the disposable-database harness and the production build. The failing set must equal the documented 41-failure baseline.
3. Verify on a Preview (section 5, item 2), obtain founder approval, then merge and verify (section 7).
4. Outcome: contained; denials return `500` instead of `403`; fail closed.

### B. A containment endpoint misbehaves
Fix forward with a new commit on a new branch, tested as in A. If the endpoint must be shut immediately while the fix is prepared,
the interim measure is an **edge block** of `/api/driver-applications/submissions` and `/api/driver-applications/send-invitation`
(for example a temporary Vercel firewall rule returning `503`). That is an infrastructure change and needs the founder's explicit
approval each time it is applied and removed.

### C. The release deployment fails (build or platform failure)
Production stays on `11e2fcd`, which is the vulnerable state. This is the status quo from before the release, not a recovery.

1. Do not "fix" it by redeploying `11e2fcd`.
2. With the founder's approval, apply the edge block from B as the interim protection.
3. Diagnose the failure, fix forward, verify on Preview, and release again.

### D. Unexpected database, authorization or data behavior
Stop. Do not roll back as a reflex: a rollback can change which code reads which data. Capture the evidence (deployment ID,
times, request ids, log excerpts without personal data) and treat it as an incident under section 10.

### E. Last resort: removing the containment itself
Only if the containment is shown to be causing harm that exceeds the exposure in section 2. Before anything else: the founder
records, in writing, that the exposure is accepted; the edge block from B is applied for the endpoints; only then may a revert
of `85ef44d..4e22d02` be prepared, and it still goes through Preview and founder approval like any release.

## 9. Approval and decision log

Every Production action is a row. An action without an approval is not performed.

| When (UTC) | Action | Exact SHA / deployment ID | Approved by (founder) | How recorded | Result |
|---|---|---|---|---|---|
| | Merge release to `main` | | | | |
| | Production deployment verified (7.1) | | | | |
| | Behavior probes (7.2) | | | | |
| | Optional authenticated check (7.2) | | | | |
| | Any edge block applied / removed | | | | |
| | Any recovery step (section 8) | | | | |

Actions that require approval each time: merging to `main`; any Production deployment; any rollback or promotion; any edge block;
any change to environment variables, deployment protection, Clerk or database configuration; the optional authenticated check.

## 10. Stop conditions

Stop all work, change nothing further, and report to the founder if any of these occurs:

- `origin/main` is not the expected SHA, or moves unexpectedly during the release.
- A Production deployment exists whose source commit is not the approved SHA, or more than one appears.
- A migration, dependency change, environment-variable change or protection-setting change appears in the project's activity.
- Any behavior listed in 7.3.
- Database errors, new authentication failures, or Master Register events that nobody initiated.
- A failing set in the disposable-database harness that differs from the 41-failure baseline.
- Anyone proposes restoring `11e2fcd` or promoting a Preview build.

## 11. Known limits of this runbook

- It was written without access to Vercel or Production. Dashboard locations and the exact behavior of Vercel features (instant
  rollback, promotion, firewall rules) must be confirmed against the live project before relying on them.
- Invitation sending and applicant submission are intentionally unavailable until canonical application records and an invitation
  outbox exist. This runbook preserves that closure; it does not restore the features.
- The "delivery unconfirmed" protection in the driver workspace is browser-local until the outbox exists.
