# Recovery Batch 3: canonical Vehicles and Drivers

Local only (`recovery/batch3-vehicles-drivers`, based on Batch 2 `bfe4c24`). Not pushed, merged or deployed. No migration, RLS, IAM, WIF, GCS, Clerk,
environment or dependency change.

Source: `claude/ui-recovery`, cherry-picked with `-x`: `bc7fdf9` (vehicle lifecycle operations and routes), `3e5b599` (driver operations and routes),
`cef5beb` (restored Vehicles), `6785b79` (restored Drivers), `4f12c6b` (Drivers matrix). One conflict: two appended blocks in
`lib/operational-identity/service.ts`, both kept. Driver-application endpoints and invitations are untouched.

## Vehicle-create HTTP 500
A genuine defect, exposed (not caused) by a repeated test unit number. `createVehicleForOrganization` calls operations that throw plain `Error`s
and lets PostgreSQL constraint violations escape, so every refusal (invalid VIN, unknown type, duplicate unit number, duplicate VIN for the company,
unknown or archived company) was a generic 500. `lib/operational-identity/vehicle-create-failure.ts` now classifies them (400 / 404 / 409) by PostgreSQL
code and constraint and by the operations' fixed messages; unrecognised errors are rethrown unchanged (authorization stays 403).
Test: `test/lib/ui-recovery/vehicle-create-errors.db.test.ts`.

## Completion matrices
VO = verified operational (browser + database), DT = domain-tested only, UP = UI placeholder (control kept, refuses), MD = missing canonical domain, D = defect.

| Vehicles | Class |
|---|---|
| List, open, canonical read; company isolation | VO |
| Create (equipment number, type, VIN, year, make, model) | VO |
| Validation, duplicate unit / VIN refusal | VO (defect fixed: was 500) |
| Unit number correction; archive; restore; shared vehicle cannot be archived | VO (restore by API in the browser run) |
| Registration period add; duplicate plate refused; shown on the Registration tab | VO |
| Registration change / correct / void; unit change; relationship end | DT |
| Type / VIN / year / make / model edit | MD (no approved correction semantics) |
| Colour, region, axles, dates, tare weight, fuel, length, GPS | MD |
| Ownership, permits, inspections, maintenance, repair bills, per-unit settings | MD (UP) |
| Activity (Master Register read by vehicle) | MD (events are written, no read) |
| Evidence / OCR | MD (no vehicle evidence target) |

| Drivers | Class |
|---|---|
| Register, canonical read, isolation, detail page | VO |
| Create (person + name + profile + channels + licence + relationship, one transaction) | VO |
| Licence conflict, existing-driver check, atomic rollback | VO |
| Profile name correction, unsupported field refusal; licence add / replace / coexist | VO (licence by API) |
| Relationship end; change / correct relationship; medical periods; licence correct / void | VO (end) / DT (others) |
| Middle / preferred name, date of birth, address, operating region, On Leave / Inactive | MD (refused, never dropped) |
| Hiring applications, Send Application, Invite Applicant | MD / UP (refused; nothing sent; containment unchanged) |
| Evaluation, screening results, training, performance events, HOS, company actions, citations | MD / UP |
| Driver documents / licence evidence | MD (no driver evidence target) |
