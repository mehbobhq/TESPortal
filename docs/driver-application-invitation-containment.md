# Driver Application endpoints: containment status and limitations

Status: containment only. This is not the target design.

## What is closed, and why

| Endpoint | Behavior now | Reason |
|---|---|---|
| `GET /api/driver-applications/submissions` | 401 without a session, 403 without a TES actor holding `DRIVER_READ`, otherwise a fixed 503. The store and the requested ids are never read. | The server-side store (`.tes-data`) records no owning customer, so no submission can be released safely. |
| `POST /api/driver-applications/submissions` | Invalid or missing invitation token: 401 (validation unchanged). Valid token: a fixed 503. The body and the repository are never touched. | The only writable store is a local JSON file: not durable on serverless hosting, not tenant-scoped, and no canonical application record exists to verify ownership. |
| `POST /api/driver-applications/send-invitation` | 401 / 403 / 400 as expected; with a valid actor, a fixed 503 while canonical records are unavailable. | Company, driver and application records are not yet in PostgreSQL. |

Existing `.tes-data` submissions are neither read, modified nor deleted by this code. The repository module is retained for the PostgreSQL migration of those records.

## Invitation delivery semantics (when the endpoint is re-enabled)

Sending an email and writing to PostgreSQL cannot be one atomic step.

1. An intent event (`NOTIFICATION_CREATED`, outcome `UNRESOLVED`) is appended before the provider call. If it cannot be appended, nothing is sent.
2. The provider is called once, with a stable `Idempotency-Key` (`driver-application/{applicationId}`). There is no automatic retry.
3. The outcome event (`COMMUNICATION_SENT`) records one of:
   - `SUCCESS`: the provider returned a message id;
   - `FAILURE`: the provider explicitly refused (HTTP 400, 401, 403, 422, 429 with a readable answer): the message was not sent;
   - `UNKNOWN`: anything else (timeout, network error, 5xx, 409 idempotency conflict, unreadable answer): the message may have been delivered. The response says so and tells the operator not to resend until it is checked.
4. If the provider accepted but the outcome event could not be appended, the response is a success with `auditRecorded: false` and an `auditNote`; only the `UNRESOLVED` intent event exists. A server log line `driver-invitation-outcome-not-recorded` carries the intent event id and application id (no recipient, no applicant data) for reconciliation.

## Required follow-up: transactional outbox

The durable design needs a migration and queue infrastructure, so it is outside this patch:

- an invitation row committed in the same transaction as the intent event, holding the verified references and the idempotency key;
- a worker that sends with the same key, records the result, and retries only against that key;
- a provider webhook (delivered, bounced, complained) to resolve `UNKNOWN` outcomes and classify permanent versus transient failures;
- a reconciliation job that resolves intents with no outcome event.

Until then, `UNKNOWN` and `auditRecorded: false` outcomes need manual reconciliation against the provider dashboard.
