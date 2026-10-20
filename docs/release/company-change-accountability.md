# Company Edit, registered legal-name gate, channel verification and change accountability

## Migration 0036 (`0036_company_change_accountability.sql`)
Forward-only, additive; 0001-0035 untouched. **Requires 0035** (it uses the `evidence_documents(id, organization_id)` unique index 0035 adds) and the existing contract-authority table (0030), on which it adds one unique index `(id, organization_id, person_id)`. **Not applied to Production by this change.**

| Object | Purpose |
|---|---|
| capability `COMPANY_LEGAL_NAME_CHANGE` | executing a registered legal-name change; granted to the Onboarding Team (the founder-level Master Account always satisfies a capability) |
| `company_change_records` + `company_change_record_evidence` | append-only business-operation ledger = Company Activity, with evidence links (same-company foreign keys) |
| `company_legal_name_change_requests` | durable request / approval record; the requester's basis is `CUSTOMER_AUTHORITY` (bound by foreign key to a recorded Service Decision Authority / Contract Signatory assignment of the same person and company) or `VERIFIED_DIRECTOR`; CHECKs make an APPLIED row impossible without the government document, the written request, a Director's evidenced authority, the executing actor and decision time |
| `company_channel_change_requests` | durable pending / confirmed state of a sensitive company phone / email / website REPLACE or REMOVE; an APPLIED request cannot exist without a confirmation through an established channel, a linked evidence document (unique per request) and a confirming TES user who is not the one who recorded the request |

RLS: +4 tables, +4 policies (CI catalogue counts: ledger 36, RLS tables 86, policies 167). Runtime role: no DELETE/TRUNCATE; ledger has no UPDATE.
Rollback: nothing existing is altered; drop the four tables, the two functions and the capability row (only when empty).
After applying: grant `COMPANY_LEGAL_NAME_CHANGE` to the Onboarding Team staff relationships that may execute legal-name changes (nobody has it by default; a job title never grants it).

## Behaviour
- **Registered legal name** changes only through the procedure: request (never changes the name) -> link a verified, stored government document and the company's written request -> execution by a holder of `COMPANY_LEGAL_NAME_CHANGE`. Enforced on the server; the ordinary company edit refuses any different `companyName`.
  - **Who may ask.** A Primary Contact designation is an operational routing choice and authorizes nothing. The requester must hold an ACTIVE customer authority (Service Decision Authority or Contract Signatory, recorded by the contract-authority process with its notice evidence; looked up on the server, never taken from the input) or be a Director whose authority is evidenced by a linked, verified document (a title is never proof). A request from anyone else is refused when it is made. The authority is proven again at execution: an authority that ended, a notice that is no longer verified and stored, or an executor who cannot read the authority records all block the change (each with its own blocker). Authority holders of another company, and non-customer companies without a Director document, cannot use the authority route.
  - **On success** one transaction changes the name, keeps the previous name as a FORMER_NAME alias, writes the ledger row with its evidence links and records the actor / request / evidence references in the Master Register.
  - **Mandatory history is never skipped.** The former-name alias, the ledger row, the Master Register event and the move of the request to APPLIED are all required: if any of them fails (or the request update touches no row) the whole change rolls back and the caller is told (no error is suppressed anywhere in these writes).
- **Company phone / email / website**: a first value is recorded directly. REPLACING an established value, REMOVING it, or setting a new value after it was removed is recorded as a request that changes nothing until it is confirmed:
  - an **established** trusted channel (existed before the request, current, not the requested value, not the sender; the sender is stored, never trusted);
  - **verified evidence** tied to the request: a `CHANNEL_CHANGE_CONFIRMATION` document that the evidence process has verified, that is securely stored, belongs to the company, was created after the request and confirms no other request (a typed reference or "method" proves nothing and is only a note);
  - a **different** TES user from the one who recorded the request (no self-confirmation).
  Without all of it the confirmation is refused with the list of what is missing and the request stays pending. The company's own channels cannot be added or ended through the contacts API (it refuses), and there is no "correction" shortcut. A website change never touches an email; company channels never become person channels.
- **DBA**: recorded with an optional basis (business confirmation or registration evidence + reference / evidence link). The jurisdiction rule for when registration evidence is *required* is a policy decision not yet made, so it is supported but not mandated.
- **Ledger / Company Activity**: every actual change (DBA, website, company email / phone, address, region, payment method, registrations, cargo, fleet providers) appends an accountable row with the previous value automatically; the Profile Activity card shows business operations (including Primary Contact changes) with evidence links and any pending, not-yet-effective requests. The Master Register keeps every technical event.
- **Company Edit** now matches Add Company (sections, sticky Save Changes / Discard bar) without the history-mode questions or the "Managed elsewhere" block.

## Run-time compatibility with a database without 0036
The application does not require 0036 to run: see `docs/release/company-profile-edit.md` ("Database state compatibility"). `lib/company-changes/schema-state.ts` reports ABSENT / COMPLETE / INCONSISTENT on every call; an absent migration disables only the 0036 features, a partly applied one fails closed. Setting a value after the established one was removed follows the same confirmation rule as replacing it, so "remove, then add" cannot bypass the confirmation (a removal is itself a request; without 0036 a replacement or removal is refused).
