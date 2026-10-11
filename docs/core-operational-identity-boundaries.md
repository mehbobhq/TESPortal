# Core Operational Identity Graph boundaries

This program makes PostgreSQL the canonical destination for operational identity. Persons from migration 0014 remain the only canonical human identity. A driver profile is a role of a Person. A Vehicle is a durable physical identity independent of a carrier. Organization relationships, licences, medical qualification facts and vehicle registrations preserve business time instead of being mutable identity fields.

## Deterministic identity

A structurally valid normalized VIN is a global vehicle identity signal. Driver licence identity is country + jurisdiction + normalized licence number. Unit number is scoped to the operating Organization. Plate identity is jurisdiction-scoped and time-aware. Names, email and phone remain advisory Person signals and are not unique identity constraints. Ambiguous matches are resolution cases; they are never silently merged.

Source-system + source-record-key + entity-type is the import idempotency key. Resolution provenance stores references or hashes rather than copying sensitive source values.

## Cross-domain boundaries

Carrier IRP authority remains in 0013. Vehicle registration periods represent the physical vehicle's registration/cab-card fact and do not recreate carrier authority. Documents are not stored in PostgreSQL. Stable Person, Vehicle, relationship, licence and registration IDs are the attachment targets for the Evidence/GCS program. OCR/intake must call canonical services and entity resolution; it must not write canonical tables directly.

Vehicle-driver assignment is not canonicalized here because current TES facts are event/trip/performance oriented and do not establish a permanent assignment invariant. Those systems reference stable Vehicle and Person IDs.

The browser stores remain legacy input only. The legacy adapter is the deterministic mapping boundary; it does not create a second source of truth or automatically import data.

## RLS boundary

These global registries are SYSTEM-scope foundations. The existing authorization design intentionally has no tenant context for SYSTEM operations, so tenant-keyed RLS cannot be correctly added table-by-table. Runtime ACLs are least privilege, PUBLIC is revoked, and all application mutations pass through SYSTEM capability authorization. Coordinated RLS closure remains the system-wide RLS program; this program introduces no dependency that prevents that closure.

## Downstream boundaries

Legitimate downstream boundaries only: physical GCS evidence storage/link records; OCR/document processing; Rules/DQF compliance interpretation; trip/dispatch-specific vehicle-driver assignment; system-wide RLS closure; one-time execution of the browser-to-PostgreSQL import job. None of those systems owns or redefines canonical Vehicle/Person/Driver identity.
