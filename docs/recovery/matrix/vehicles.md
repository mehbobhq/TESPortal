# Vehicles workspace: UI recovery matrix

Original interface: `git show '0e8e8c3^:app/companies/[id]/vehicles/page.tsx'` (1061 lines) plus `src/components/vehicles/**`.
Restored interface: `src/restored/vehicles/**`, mounted by `app/companies/[id]/vehicles/page.tsx` as the "Vehicles (TES records)" tab of
`LegacyWorkspaceGate`. The legacy browser-local Vehicles workspace is NOT mounted (it imports the evidence file store, which the approved
importer ratchet forbids); the gate's second tab and its non-canonical-company fallback show an explanatory notice instead.

Legend: **read** = existing canonical read; **new op** = approved schema, operation was missing and is implemented here;
**refuses** = control kept, `CanonicalOperationUnavailableError` (or an inline `CanonicalUnavailable` note) names the gap;
**gap: operation** = schema exists, no approved operation, not invented; **gap: domain** = no canonical domain, needs a decision.

## 1. What the canonical domain provides (verified)

| Migration | Provides | Operations before this work |
| --- | --- | --- |
| 0020 `vehicle_types` | TRUCK_TRACTOR, STRAIGHT_TRUCK, TRAILER, OTHER (no sub-types) | read only |
| 0020 `vehicles` | VIN, year, make, model, type, `record_status` active/archived/merged, `archived_at`; global (SYSTEM scope) | create (+ VIN dedupe) |
| 0020 `organization_vehicle_relationships` | OPERATES / OWNS / LEASES, unit number, `effective_from/to`, active/corrected/voided | establish only |
| 0020 `vehicle_registration_periods` | BASE / APPORTIONED, plate, registration number, jurisdiction (country+region), effective dates, active/corrected/voided, unique indexes, no-overlap (0023) | **none** |
| 0025 | insurance scheduled vehicles (`lib/insurance`) | not used by this workspace |
| 0026 | vehicle merges (`lib/vehicle-merges`) | not exposed in the UI (no original control) |
| Master Register | every operation writes its event in the same transaction; there is **no read by vehicle** | n/a |

## 2. New operations (rule 4: schema already defines the behaviour)

All in new files `lib/operational-identity/vehicle-lifecycle*.ts`, `vehicle-errors.ts`, `vehicle-workspace-reads.ts`; wired by an append-only
block in `service.ts` (plus one import line). All run in `withAuthorizedSystem("VEHICLE_MANAGE")` (reads: `VEHICLE_READ`), take the
organization from the route URL and answer another company's record as not found.

| Operation | Semantics | Master Register |
| --- | --- | --- |
| `addVehicleRegistration` | new period (kind, plate and/or number, jurisdiction, dates); one current period per kind and a current plate per jurisdiction (DB indexes) | RECORD_CREATED |
| `changeVehicleRegistration` | real-world change: current period ends on the new start date, a new period starts (history kept) | RECORD_UPDATED + RECORD_CREATED |
| `correctVehicleRegistration` | mistaken value: old row `corrected` + `superseded_by_id`, replacement with the same business start | RECORD_CORRECTED + RECORD_CREATED |
| `voidVehicleRegistration` | recorded by mistake: row `voided`, kept | RECORD_CORRECTED |
| `archiveVehicle` / `restoreVehicle` | `record_status`/`archived_at`; refused while another company has the vehicle on its current record; merged vehicles refused | RECORD_ARCHIVED / RECORD_RESTORED |
| `endVehicleRelationship` | sets `effective_to`; row kept | RECORD_UPDATED |
| `changeVehicleUnitNumber` | renumbering: current row ends, new row starts now (history kept) | RECORD_UPDATED + RECORD_CREATED |
| `correctVehicleUnitNumber` | mistyped number: supersession as for registrations | RECORD_CORRECTED + RECORD_CREATED |
| `getOrganizationVehicleWorkspace` (read) | company's current vehicles incl. archived, with its registration periods and relationship history | none |

Routes (thin, `canonicalFailure`): `GET /api/companies/[id]/vehicles/workspace`, `PATCH .../vehicles/[vehicleId]` (archive|restore),
`POST .../vehicles/[vehicleId]/registrations`, `PATCH .../vehicles/registrations/[registrationId]` (change|correct|void),
`PATCH .../vehicles/relationships/[relationshipId]` (end|change-unit|correct-unit). Existing `GET/POST .../vehicles` unchanged (profile counts rely on it).

Not implemented, on purpose: **editing a physical vehicle's type / VIN / year / make / model.** The row is global, shared by companies, has no
version table, and no correction semantics are approved for it (gap: operation + decision). The UI refuses that edit, naming this.

## 3. Control by control

| Original component / file | Current (canonical) page | Restored implementation | Restored controls | Canonical operation connected | Missing (exact gap) | Verified by |
| --- | --- | --- | --- | --- | --- | --- |
| `page.tsx` list (hero header, search, status/type filters, table, empty state) | list of rows + add form | `src/restored/vehicles/RestoredVehicles.tsx` | search (equipment/VIN), Filters, status filter (+ "Archived" so Restore is reachable), type filter, table, row open, `?vehicle=` deep link | read: `/vehicles/workspace` | Operating Region column shows "Not recorded" | tsc; `vehicles-restored.test.ts` (mapping) |
| Add Vehicle dialog (`VehicleCreateDialog`, `VehicleProfileForm`) | inline form | same dialog | all original fields incl. make combobox (`lib/vehicle-manufacturers`) | create: `POST /vehicles` (`createVehicleForOrganization`, one transaction) saves equipment number, type, VIN, year, make, model | colour, region, axles, fleet dates, tare, fuel, length, GPS provider, status other than Active: **gap: domain** (refuse); a trailer sub-type / Converter Dolly / Service Vehicle: no exact canonical type (refuse; "Trailer" option added) | `vehicles.db.test.ts` (existing create), adapter test (type mapping) |
| Vehicle workspace hero | n/a | `VehicleWorkspaceHero` (restored copy) | back, Archive/Restore, Document/OCR | archive/restore: `PATCH /vehicles/[id]` | none for archive; Document/OCR: see Evidence | `vehicles.db.test.ts` (archive/restore) |
| Compliance strip | n/a | strip with real registration state | Registration derived from canonical dates; Permits/Inspection/Maintenance show **Not recorded** (never "Current") | read | permits/inspections/maintenance: gap: domain | by inspection |
| `ProfileTab` | n/a | restored copy, "Not recorded" for fields without a home | read view, Edit, Document/OCR | equipment number: `correct-unit` (mistake fix; history kept) | type/VIN/year/make/model edit: **gap: operation + decision**; other fields: gap: domain | adapter test; `vehicles.db.test.ts` (unit correction) |
| `OwnershipTab` | n/a | restored copy; OWNS/LEASES relationships shown read-only as Company-Owned / Leased | Add, Edit, Archive, document attach, leasing-company picker, create company | read of the relationship only | ownership records (legal owners, purchase, financing, lease terms, documents): **gap: domain**; creating a company from here refuses | adapter test (mapping) |
| `RegistrationTab` | n/a | restored copy; types are the canonical kinds Base / Apportioned | list, Show History, Add, Edit, detail overlay, Archive dialog, **Void (recorded by mistake)**, document cards | add / change / correct / void | document + Cab Card, price, status select: **gap: domain** (document cards stay, price/status read-only). The original "Registration Document is mandatory" block is shown as a note instead of a hard stop, because no document can be attached; Archive-with-request-evidence dialog refuses (no canonical archive request; use change/correct/void). Original five registration types have no canonical home (gap: decision) | `vehicles.db.test.ts` (registration cases), adapter test |
| `PermitTab` | n/a | restored copy | all | none | permits: **gap: domain** (refuses, banner) | `saveVehicleStore` refusal test |
| `MaintenanceTab`, `VehicleInspectionsWorkspace`, inspection forms, `AnnualInspectionRecord` | n/a | restored copies | inspections, maintenance, findings, items, repair bills | none | inspections / maintenance / findings / repair bills / service providers / roadside link: **gap: domain** (refuse, banner; reads show none) | refusal test |
| `RepairBills` | n/a | restored copy over shims (`lib/repair-invoice-data.ts`, `lib/service-provider-data.ts`, `lib/repair-component-catalog.ts`) | bill list, form, provider quick-create | none | repair invoices and providers: gap: domain; component catalog is the built-in vocabulary only | refusal test |
| `VehicleActivitySection` | n/a | restored copy | Activity tab | none | Master Register events are written, but there is **no read by vehicle**: gap: operation. Tab shows an explicit note | by inspection |
| `SettingsTab` | n/a | restored copy | permit-program toggles, ELD, GPS, notes | read: hazmat row uses the canonical company profile (`DG_CANADA` / `DG_US` effective APPLIES) | saving per-unit settings: **gap: domain** (refuses, banner, nothing kept in the browser) | by inspection |
| Evidence / OCR (`DocumentSourcePicker`, `OCRReview`, `SecureDocumentViewer`, `CameraCapture`, attach flow) | n/a | restored copies of the viewer/OCR review (no storage, no audit-log import); attach/save goes through `lib/evidence-files.ts` | picker, camera, OCR review, attachment review, secure viewer | none | `lib/evidence-payload` accepts onboarding/contract targets only; no vehicle target: **gap: domain**. Attach refuses naming that; profile OCR values still prefill the form; nothing is stored in the browser | `restored-ui-boundaries.test.ts` |

## 4. Compliance with the brief

- No browser persistence in `src/restored/vehicles/**` or anything it imports at runtime (`restored-ui-boundaries.test.ts`, green). Copies were needed for
  `SecureDocumentViewer`, `DocumentWatermark`, `OCRReview` (legacy audit imports / storage lookup), `scheduled-maintenance-data` (one type literal reworded so it no
  longer looks like a storage key), `INSPECTION_TYPES` (src/types.ts re-exports a model that cannot be reached at runtime; a static test keeps the list identical).
- Evidence ratchet untouched; no importer added; no migration, policy or grant touched.
- Master Register events carry references and controlled words only (no plate, VIN, unit number, dates).
- TypeScript regression gate: zero new diagnostics versus the baseline.
- Behaviour-neutral type fixes in the restored copies of original code: `setSelectedRecordEvidence((current) => current && ...)`, `OCRContext` profile variant gains
  `recordId?: undefined`, `MaintenanceTab` declares the `inputClass` and `FindingRow` it already used (the original referenced both without defining them).

## 5. Decisions the coordinator may want to revisit

1. Editing equipment number is saved as a **correction**; `change-unit` (real renumbering) exists in the API but has no control in the original UI.
2. Adding a registration while a current one of the same type exists is treated as a **change** from the new start date (the original "Replaced" status).
3. The mandatory "Registration Document" rule is relaxed to a visible note (no document can be attached).
4. Trailer sub-types are refused; "Trailer" was added as a type option.
5. Archived vehicles are reachable from the list only through the new "Archived" status filter (the original hid them with no list route to Restore).

## 6. Tests

- `test/lib/ui-recovery/vehicles.db.test.ts` (8 tests, real authorization, runtime role, RLS, Master Register, rollback, company isolation, history preserved).
- `test/lib/ui-recovery/vehicles-restored.test.ts` (11 tests: static boundaries of the new operations/routes, adapter mapping, store refusal, page contract).
