# Original company workspaces: restoration (Drivers, Tax Filing, Authorities, Insurance, Business, Contacts, Vehicles)

Base: `origin/main` `9e81552`. Restoration only: no migration, no canonical API change, no browser-to-PostgreSQL path.

## What opens first
Each company section now opens the **original browser-local workspace** first (tab 1, selected). The PostgreSQL-backed records are the second tab, "(TES records)". A banner on the original workspace says its records live only in this browser and are testing/prototype data, not canonical Production records. Neither workspace writes to the other's store; the original workspaces never call an API.

The shared change is `LegacyWorkspaceGate`: default tab, tab order, ARIA tab/tabpanel wiring, banner alignment, and a width container (`WorkspaceViewport`) so a wide original table scrolls inside the workspace instead of widening the whole application shell. The workspace markup itself is untouched. No workspace preference is persisted.

## Recovered sources
| Section | Original | Recovered as |
|---|---|---|
| Drivers, Tax Filing, Authorities, Insurance, Business | already kept in `legacy-*.tsx` (commit 34d34c2) | unchanged; now first |
| Vehicles | `app/companies/[id]/vehicles/page.tsx` at `0e8e8c3^` (1,061 lines; the last browser-local page before the canonical cutover) | `legacy-vehicles.tsx` (two type-only adjustments); its components under `src/components/vehicles/*` and `lib/vehicle-data.ts` were never removed |
| Contacts | `app/companies/[id]/contacts/page.tsx` at `eefa530^` (951 lines) with the components it was built on at that commit | `legacy-contacts.tsx` + `src/components/contacts/legacy/*` (the canonical Contacts components were changed for the canonical page and are left as they are) |

The canonical Vehicles register and the canonical Contacts page are unchanged; they moved into `CanonicalVehicles` / `CanonicalContactsPage` in the same files and are the second tab.

## One correction to the original code
`src/components/vehicles/maintenance/MaintenanceTab.tsx` used `inputClass` and `FindingRow` without declaring them (present in the original commits too). That is a `ReferenceError` as soon as a maintenance item or an inspection finding exists. Both are now declared (same shape as the version kept on the integration branch, without its save refusal).

## Boundaries
- Canonical Contacts keeps authority verification, evidence-confirmed channel changes, the change ledger and the Master Register; none of that is reachable from the original Contacts workspace.
- Evidence-payload ratchet: `legacy-vehicles.tsx` imports the browser evidence-file store (original document/evidence storage). The allow-list in `evidence-payload-boundaries.test.ts` now names it. This is the one place the "importers never grow" guard was widened, for the restored prototype module only.
- The original Drivers loader writes an empty default store for a company that has none, and upgrades an older store version in place; it never overwrites a current one. That is existing behaviour.

## Roadside inspection presentation (dependency for Events)
The restored vehicle detail already has a vehicle-side entry, "Roadside / CVSA Register", fed by `getRoadsideEventsForVehicle` from the browser-local driver store. Whether its presentation follows the agreed order (Vehicle → Driver → Consequences) was NOT verified in this restoration and must be checked in the Events cycle. The driver-side view (Driver → Vehicle → Consequences) and a single shared event record do not exist yet: today the two sides read separate browser-local stores. The Events cycle must introduce one canonical roadside event that both perspectives reference; nothing here duplicates or pre-empts it.
