# Company Profile and Company Edit

The Company Profile (`/companies/{id}/profile`) and Company Edit (`/companies/{id}/edit`) read and write the canonical PostgreSQL records only. Nothing is stored in the browser. The page logic is in `app/companies/[id]/profile|edit/page.tsx`; the field rules shared by the page and the tests are in `lib/company-directory/edit-validation.ts`, and the field inventory below is `lib/company-directory/field-inventory.ts` (a test fails if the profile returns a value that has no entry).

## Field inventory
Modes: **Editable** (saved through Company Edit, validated on the server, authorized per domain capability, recorded in the change ledger and the Master Register); **Gated procedure** (verification and approval required, never through Save Changes); **Derived** (computed from another authoritative record on every read); **Managed elsewhere** (owned by another workspace, shown read-only with a link); **Read-only** (recorded once or lifecycle-controlled).

| Field (profile key) | Label | Mode | Canonical source | Edit path / why not editable |
|---|---|---|---|---|
| `id` | Company record id | Read-only | organizations.id | System identifier. |
| `name` | Company name | Derived | organizations.display_name / legal_name | The trade name when recorded, otherwise the registered legal name. |
| `legalName` | Registered legal name | Gated procedure | organizations.legal_name | Changes only through the legal-name procedure: a government document, a written request from a company representative with recorded authority (Service Decision Authority / Contract Signatory, or a Director with a verified document), and an authorized Onboarding Team member or the founder-level account. Workspace: `edit`. |
| `kind` | Company record type | Derived | organization_classifications / customers | Derived from the primary classification and from whether the company is a Customer. |
| `region` | Registered in | Read-only | organizations.country_code / region_code | The jurisdiction of formation is set when the company is registered; changing it is a legal-identity change that is not available here. |
| `regCorpState` | Registered province/state | Read-only | organizations.region_code | Part of the jurisdiction of formation (see Registered in). |
| `regCorpCountry` | Registered country | Read-only | organizations.country_code | Part of the jurisdiction of formation (see Registered in). |
| `status` | Record status | Read-only | organizations.status | Archiving or merging a company record is a separate administrative lifecycle action. |
| `createdAt` | Record created | Read-only | organizations.created_at | System timestamp. |
| `dba` | DBA / trade name | Editable | organization_aliases (TRADE_NAME) | The previous trade name is kept in history; a confirmation basis can be recorded. |
| `incorpNo` | Incorporation / charter number | Editable | organization_identifiers (INCORPORATION) | Needs the recorded formation jurisdiction; the previous value is kept in history. |
| `businessNo` | CRA Business Number (BN) | Editable | organization_identifiers (CRA_BN) | Nine-digit root; the previous value is kept in history. |
| `ein` | IRS Employer ID (EIN) | Editable | organization_identifiers (IRS_EIN) | Nine digits; the previous value is kept in history. |
| `opRegion` | Operating region | Editable | company_operating_scope_periods | Recorded as an assertion; it decides which jurisdiction-specific sections apply. |
| `contact` | Primary Contact | Managed elsewhere | contact_purpose_assignments (PRIMARY) | A person is designated in Contacts, never typed here. Workspace: `contacts`. |
| `contactPersonId` | Primary Contact person | Managed elsewhere | people |  Workspace: `contacts`. |
| `phone` | Company phone | Editable | organization_channels (PHONE / GENERAL) | A first value is recorded directly; replacing an established value waits for confirmation through an established channel. |
| `email` | Account email | Editable | organization_channels (EMAIL / GENERAL) | A first value is recorded directly; replacing an established value waits for confirmation through an established channel. |
| `billingEmail` | Billing email | Editable | organization_channels (EMAIL / ACCOUNTING) | A first value is recorded directly; replacing an established value waits for confirmation through an established channel. |
| `website` | Website | Editable | organization_channels (WEBSITE) | A first value is recorded directly; replacing an established value waits for confirmation through an established channel. |
| `cargoTypes` | Cargo information | Editable | company_cargo_category_periods | A Customer needs at least one category; earlier categories are kept in history. |
| `eldProvider` | ELD / HOS provider | Editable | company_fleet_provider_periods (ELD_HOS) | Earlier providers are kept in history. |
| `gpsProvider` | Truck GPS provider | Editable | company_fleet_provider_periods (GPS_TELEMATICS) | Earlier providers are kept in history. |
| `fuelProvider` | Fuel provider | Editable | company_fleet_provider_periods (FUEL_SERVICES) | Earlier providers are kept in history. |
| `payMethod` | Preferred payment method | Editable | customer_billing_preference_periods | A billing preference only (never contract terms); no payment credentials are stored. The previous preference is kept in history. |
| `payMethodCode` | Preferred payment method code | Derived | customer_billing_preference_periods | The catalogue code of the preferred payment method. |
| `paymentMethodHistory` | Payment-method history | Derived | customer_billing_preference_periods | Previous preferences with the dates they applied. |
| `serviceType` | Contracted service | Derived | contracts (signed) -> contract lines -> package | Comes from the signed contract; a profile edit can never change or override it. Workspace: `onboarding`. |
| `serviceStage` | Service status | Derived | customer_engagement_stages | The stage of the current engagement. Workspace: `onboarding`. |
| `startDate` | Service start date | Read-only | customer_engagements.started_at | Fixed once recorded; a verified correction with a reason is a separate authorized workflow. |
| `endDate` | Service end date | Derived | customer_engagements.ended_at | Recorded only by ending the service (End Service), with a reason; an ended service is never reopened or deleted. |
| `engagements` | Service engagements | Derived | customer_engagements | Every stay, oldest first. |
| `assessment` | Documentation assessment | Derived | (none yet) | No assessment engine records one yet, so nothing is displayed for it. |
| `customerDetails` | Customer authorities and contracts | Derived | customer_authority_assignments / contracts | Exactly one active Service Decision Authority and one active Contract Signatory (they may be the same person); managed in the contract process, never here. Workspace: `onboarding`. |
| `gstHst` | GST/HST account | Editable | registrations (program GST_HST) | Must begin with the company's Business Number; a different account archives the earlier one. |
| `gstHstRegistrationId` | GST/HST registration id | Derived | registrations | The record id behind the GST/HST account. |
| `usdot` | US DOT # | Managed elsewhere | operating_authorities (kind USDOT) |  Workspace: `authorities`. |
| `mc` | MC # | Managed elsewhere | operating_authorities (kind MC) |  Workspace: `authorities`. |
| `nsc` | NSC / CVOR # | Managed elsewhere | operating_authorities (kind SAFETY_FITNESS / CVOR) |  Workspace: `authorities`. |
| `mvid` | MVID / RIN # | Managed elsewhere | operating_authorities (kind MVID / RIN) |  Workspace: `authorities`. |
| `accIrp` | IRP account # | Managed elsewhere | operating_authorities (kind IRP) |  Workspace: `authorities`. |
| `scac` | SCAC | Managed elsewhere | registrations (program SCAC) |  Workspace: `tax-filing`. |
| `carrierCode` | Carrier code | Managed elsewhere | registrations (program CA_CARRIER_CODE) |  Workspace: `tax-filing`. |
| `accIfta` | IFTA account # | Managed elsewhere | registrations (program IFTA) |  Workspace: `tax-filing`. |
| `accNyhut` | NY HUT account # | Managed elsewhere | registrations (program NY_HUT) |  Workspace: `tax-filing`. |
| `accNm` | NM WDT account # | Managed elsewhere | registrations (program NM_WDT) |  Workspace: `tax-filing`. |
| `accKyu` | Kentucky KYU # | Managed elsewhere | registrations (program KYU) |  Workspace: `tax-filing`. |
| `accOr` | Oregon account # | Managed elsewhere | registrations (program OR_WMT) |  Workspace: `tax-filing`. |
| `accCt` | CT DRS account # | Managed elsewhere | registrations (program CT_HUF) |  Workspace: `tax-filing`. |
| `addressHistory` | Address history | Derived | organization_location_assignments / location_addresses | Previous addresses with the dates they applied. |
| `editAccess` | Edit permissions | Derived | capability checks | What the viewer may change; the server re-proves each capability when a change is saved. |
| `channelsEverRecorded` | Channels ever recorded | Derived | organization_channels | Decides whether a new phone, email or website is a first value (direct) or a replacement (confirmed). |
| `changeTracking` | Change tracking | Derived | database schema state (migration 0036) | Whether the change ledger, the legal-name procedure and confirmed channel replacements are available on this database. |
| `sections` | Section permissions | Derived | capability checks | Which sections the viewer may read. |
| `notRecordedYet` | Not recorded yet | Derived | (none) | Fields the canonical system does not record yet; empty. |
| `reg_*` | Registered address (street, city, province/state, postal, country) | Editable | organization_location_assignments / location_addresses | A changed address keeps the previous one as history; an address is replaced as a whole and cannot be blanked. |
| `mail_*` | Mailing address (street, city, province/state, postal, country) | Editable | organization_location_assignments / location_addresses | Customer records only. A changed address keeps the previous one as history; an address is replaced as a whole and cannot be blanked. |
| `yard_*` | Yard / home terminal address (street, city, province/state, postal, country) | Editable | organization_location_assignments / location_addresses | Customer records only. A changed address keeps the previous one as history; an address is replaced as a whole and cannot be blanked. |

## Behaviour
- **Save / Cancel.** A sticky bar shows the number of unsaved changes per section, a problem count, Save Changes (enabled only when something changed, one submission at a time) and Cancel (asks before discarding). Only changed fields are validated and sent; an untouched field is never rewritten. After a save the page re-reads the canonical record and reports what was saved; a failed save (server refusal or lost connection) keeps every entered value and names the fields at fault. Leaving with unsaved changes (link, Back button, closing the tab) warns first.
- **Validation.** The page runs the same rule functions as the server (`edit-validation.ts`), so what it accepts the server accepts; the server stays authoritative. An address is replaced as a whole and cannot be blanked (the server would ignore a blank block, so the page refuses it instead of reporting a false success).
- **Permissions.** The profile reports what the viewer may edit (`editAccess`); other fields show a lock with the reason. The server re-proves every capability when a change is saved, and a request that needs a capability the actor lacks is refused as a whole (nothing partly saved).
- **Sensitive changes.** The registered legal name changes only through the legal-name procedure, and only on the request of a customer-authority holder or a Director with a verified document (a Primary Contact designation is not an authority). A first company phone / email / website is recorded directly; replacing or removing an established value, or setting a new one after it was removed, becomes a request that takes effect only after confirmation with verified evidence through an established channel by a different TES user. Details: `docs/release/company-change-accountability.md`.
- **Service.** Contracted service, service status, start date, authorities and contract standing are derived and read-only. Ending a service is a separate, confirmed action with a reason, never part of Save Changes, and is refused while the current engagement has a signed contract (or when the actor cannot read contracts, so the rule cannot be checked). Contracted services are changed or terminated through the signed-agreement process.
- **History.** Previous addresses and previous payment methods come from the canonical period records; the Activity panel lists business changes from the change ledger with the actor (the viewer sees "you"; actors carry no personal name, so others show their type and a stable reference), the recording time and the evidence. Where history does not exist the panel says so.

## Database state compatibility
The application is deployed independently of the migrations. Migration 0036 (change tracking) is optional at run time:

| Database state | Behaviour |
|---|---|
| Ledger at 0034 / 0035 (no 0036 objects) | The profile and edit work. Ordinary edits save and are recorded in the Master Register by their own domains. The change history, the legal-name procedure and confirmed channel replacements report "not available yet: needs migration 0036"; replacing or removing an established phone / email / website is refused (never applied unverified, and removal is blocked as well). |
| 0036 applied | Everything above is available. |
| 0036 partly applied | Reads work; every write that needs the ledger is refused (fail closed); nothing is partly saved. |

The state is read from the catalogue on every call (no cache). Apply 0035 before 0036; grant `COMPANY_LEGAL_NAME_CHANGE` to the staff who may execute legal-name changes after 0036.

## Rollback
No existing object is altered by 0036. The application with this change runs on a database with or without 0036. To roll the application back to a build before this change, the database needs no change (the build before it never reads the 0036 objects). Do not drop the 0036 tables to roll back: they hold recorded history.
