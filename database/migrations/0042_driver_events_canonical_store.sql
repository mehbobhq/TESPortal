-- 0042: Driver Events canonical store.
--
-- Until this migration Driver Events lived only in the browser (localStorage / IndexedDB). This is the PostgreSQL home for them. It stores NO browser-local
-- test data: nothing is migrated in.
--
--   driver_events                   one row per event: typed headline columns for canonical links, time, severity, status and BI dimensions, plus the
--                                   complete schema-validated event record (jsonb) that the existing category workflows read and write
--   driver_event_history            append-only, attributed history: every version of the record, every correction, status change, link, restriction
--   driver_event_evidence           links an event to evidence documents that went through the GCS quarantine -> scan -> intake -> evidence lifecycle
--   driver_event_relationships      event <-> event and event <-> downstream record (citation, repair, claim, ...) links, including DUPLICATE_OF
--   driver_event_consequences       operational / financial / safety consequences, each with source, confidence and measurement date; never defaulted to zero
--   driver_event_actions            corrective actions and required follow-up (owner, due, status)
--   driver_event_restrictions       safety restrictions (out-of-service, stand-down, holds). A mandatory restriction cannot be cleared by an ordinary
--                                   status change: only a documented release, by the dedicated capability, with release evidence for enforcement authority
--   driver_event_bi_facts           the versioned analytical fact (contract v1) computed by the service for every record version
--   driver_event_facts_v1           view over the current fact of every non-duplicate event
--
-- ACCESS MODEL: SYSTEM scope only (TES staff). DRIVER_EVENT_READ reads, DRIVER_EVENT_MANAGE writes, DRIVER_EVENT_SAFETY_RELEASE alone may release a
-- safety restriction. There is no customer-context access. Nothing is deleted.
--
-- REGULATORY NOTE: the structure supports regulatory fields (report numbers, agency, response deadlines) but no deadline or compliance conclusion is
-- computed here: the regulatory texts could not be verified in the build environment, so every such value is entered or confirmed by a person.

-- ============================================================
-- 0. Capabilities
-- ============================================================

INSERT INTO public.capabilities(code, display_name, description, is_active, sort_order)
VALUES
    ('DRIVER_EVENT_READ', 'Driver events read', 'Read driver events, their history, evidence links, consequences, actions and restrictions. Intended scope: SYSTEM only.', true, 267),
    ('DRIVER_EVENT_MANAGE', 'Driver events manage', 'Record and correct driver events, link evidence and related records, record consequences and actions, issue restrictions. Intended scope: SYSTEM only.', true, 268),
    ('DRIVER_EVENT_SAFETY_RELEASE', 'Driver events safety release', 'Release a safety restriction (for example an out-of-service order) once the documented correction and release evidence exist. Intended scope: SYSTEM only.', true, 269);

-- ============================================================
-- 1. Events
-- ============================================================

CREATE TABLE public.driver_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,

    category text NOT NULL,
    category_code text NOT NULL,
    subtype text,
    schema_version text NOT NULL,

    title text NOT NULL,
    narrative text,
    record_state text NOT NULL DEFAULT 'DRAFT',
    status text NOT NULL DEFAULT 'Open',

    -- WHEN: an instant plus the IANA zone it was observed in, and the source-local wall clock. A date-only occurrence has NO instant.
    occurrence_precision text NOT NULL DEFAULT 'UNKNOWN',
    occurred_at timestamptz,
    occurred_time_zone text,
    occurred_local_date date,
    occurred_local_time time,
    reported_at timestamptz,
    reported_local_date date,

    -- WHO reported and WHERE the information came from
    reporter_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    reporter_label text,
    source_type text NOT NULL,
    source_reference text,
    ingestion_origin text NOT NULL DEFAULT 'MANUAL_ENTRY',

    -- canonical links (tenant-safe composite keys); free-text references only where no canonical record exists yet
    driver_relationship_id uuid,
    driver_person_id uuid,
    vehicle_relationship_id uuid,
    vehicle_id uuid,
    trailer_relationship_id uuid,
    trailer_vehicle_id uuid,
    trip_reference text,
    load_reference text,
    shipment_reference text,
    customer_reference text,

    -- WHERE
    location_text text,
    city text,
    state_province text,
    country text,
    jurisdiction_code text,
    latitude numeric(9, 6),
    longitude numeric(9, 6),

    observed_severity text NOT NULL DEFAULT 'Not Applicable',
    potential_severity text,
    verification_state text NOT NULL DEFAULT 'UNVERIFIED',
    data_quality jsonb NOT NULL DEFAULT '{}'::jsonb,

    record jsonb NOT NULL,
    current_version integer NOT NULL DEFAULT 1,

    closed_at timestamptz,
    closed_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    closure_reason text,

    created_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT driver_events_id_org_uq UNIQUE (id, organization_id),
    CONSTRAINT driver_events_driver_fk FOREIGN KEY (driver_relationship_id, organization_id, driver_person_id)
        REFERENCES public.organization_driver_relationships (id, organization_id, person_id) ON DELETE RESTRICT,
    CONSTRAINT driver_events_vehicle_fk FOREIGN KEY (vehicle_relationship_id, organization_id, vehicle_id)
        REFERENCES public.organization_vehicle_relationships (id, organization_id, vehicle_id) ON DELETE RESTRICT,
    CONSTRAINT driver_events_trailer_fk FOREIGN KEY (trailer_relationship_id, organization_id, trailer_vehicle_id)
        REFERENCES public.organization_vehicle_relationships (id, organization_id, vehicle_id) ON DELETE RESTRICT,
    CONSTRAINT driver_events_driver_pair CHECK ((driver_relationship_id IS NULL) = (driver_person_id IS NULL)),
    CONSTRAINT driver_events_vehicle_pair CHECK ((vehicle_relationship_id IS NULL) = (vehicle_id IS NULL)),
    CONSTRAINT driver_events_trailer_pair CHECK ((trailer_relationship_id IS NULL) = (trailer_vehicle_id IS NULL)),
    CONSTRAINT driver_events_category_valid CHECK (category ~ '^[A-Za-z][A-Za-z0-9 /&()-]{1,80}$' AND category_code ~ '^[A-Z][A-Z0-9_]{1,60}$'),
    CONSTRAINT driver_events_title_valid CHECK (btrim(title) <> '' AND char_length(title) <= 300),
    CONSTRAINT driver_events_record_state_valid CHECK (record_state IN ('DRAFT', 'RECORDED')),
    CONSTRAINT driver_events_status_valid CHECK (status IN ('Open', 'Under Review', 'Awaiting Information', 'Follow-up Required', 'Closed', 'Not Applicable')),
    CONSTRAINT driver_events_precision_valid CHECK (occurrence_precision IN ('EXACT_DATETIME', 'DATE_ONLY', 'APPROXIMATE', 'UNKNOWN')),
    -- An exact occurrence is an instant with its zone and local wall clock; a date-only occurrence never carries an invented instant.
    CONSTRAINT driver_events_exact_has_instant CHECK (occurrence_precision <> 'EXACT_DATETIME' OR (occurred_at IS NOT NULL AND occurred_time_zone IS NOT NULL AND occurred_local_date IS NOT NULL AND occurred_local_time IS NOT NULL)),
    CONSTRAINT driver_events_date_only_has_no_instant CHECK (occurrence_precision <> 'DATE_ONLY' OR (occurred_at IS NULL AND occurred_local_date IS NOT NULL)),
    CONSTRAINT driver_events_zone_valid CHECK (occurred_time_zone IS NULL OR occurred_time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'),
    CONSTRAINT driver_events_source_valid CHECK (btrim(source_type) <> '' AND char_length(source_type) <= 80),
    CONSTRAINT driver_events_origin_valid CHECK (ingestion_origin IN ('MANUAL_ENTRY', 'DOCUMENT_OCR', 'API_INTEGRATION', 'SYSTEM_DERIVED', 'TELEMATICS_INGESTION', 'ELD_INGESTION')),
    CONSTRAINT driver_events_severity_valid CHECK (observed_severity IN ('Low', 'Moderate', 'High', 'Critical', 'Not Applicable', 'Unknown')),
    CONSTRAINT driver_events_potential_severity_valid CHECK (potential_severity IS NULL OR potential_severity IN ('Low', 'Moderate', 'High', 'Critical', 'Not Applicable', 'Unknown')),
    CONSTRAINT driver_events_verification_valid CHECK (verification_state IN ('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'UNABLE_TO_VERIFY')),
    CONSTRAINT driver_events_country_valid CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    CONSTRAINT driver_events_jurisdiction_valid CHECK (jurisdiction_code IS NULL OR jurisdiction_code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
    CONSTRAINT driver_events_geo_valid CHECK ((latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))),
    CONSTRAINT driver_events_record_is_object CHECK (jsonb_typeof(record) = 'object'),
    CONSTRAINT driver_events_version_valid CHECK (current_version >= 1),
    -- closure is attributed and reasoned, and only a Closed event has it
    CONSTRAINT driver_events_closure_consistent CHECK (
        (status = 'Closed') = (closed_at IS NOT NULL AND closed_by_actor_id IS NOT NULL AND closure_reason IS NOT NULL AND btrim(closure_reason) <> '')
        AND (status = 'Closed' OR (closed_at IS NULL AND closed_by_actor_id IS NULL AND closure_reason IS NULL))
    ),
    -- a draft is not closed
    CONSTRAINT driver_events_draft_not_closed CHECK (record_state = 'RECORDED' OR status <> 'Closed')
);
CREATE INDEX driver_events_org_idx ON public.driver_events (organization_id, created_at DESC, id);
CREATE INDEX driver_events_category_idx ON public.driver_events (organization_id, category, occurred_at DESC);
CREATE INDEX driver_events_driver_idx ON public.driver_events (organization_id, driver_relationship_id, occurred_at DESC) WHERE driver_relationship_id IS NOT NULL;
CREATE INDEX driver_events_vehicle_idx ON public.driver_events (organization_id, vehicle_id, occurred_at DESC) WHERE vehicle_id IS NOT NULL;
CREATE INDEX driver_events_status_idx ON public.driver_events (organization_id, status);
-- The same source record can create an event once (idempotent ingestion).
CREATE UNIQUE INDEX driver_events_source_uq ON public.driver_events (organization_id, category, source_type, source_reference) WHERE source_reference IS NOT NULL;

-- ============================================================
-- 2. History (append-only)
-- ============================================================

CREATE TABLE public.driver_event_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    seq integer NOT NULL,
    entry_type text NOT NULL,
    record_version integer,
    snapshot jsonb,
    changes jsonb NOT NULL DEFAULT '[]'::jsonb,
    reason text,
    actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_event_history_event_fk FOREIGN KEY (event_id, organization_id) REFERENCES public.driver_events (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_event_history_seq_uq UNIQUE (event_id, seq),
    CONSTRAINT driver_event_history_type_valid CHECK (entry_type IN (
        'CREATED', 'VERSION', 'CORRECTION', 'STATUS_CHANGED', 'CLOSED', 'REOPENED', 'VERIFICATION_STATE',
        'EVIDENCE_LINKED', 'EVIDENCE_VERIFICATION', 'EVIDENCE_UNLINKED',
        'RELATIONSHIP_ADDED', 'RELATIONSHIP_REMOVED', 'CONSEQUENCE_RECORDED', 'CONSEQUENCE_SUPERSEDED',
        'ACTION_ADDED', 'ACTION_STATUS', 'RESTRICTION_ISSUED', 'RESTRICTION_RELEASED')),
    -- a snapshot-bearing entry names its version; a correction names its reason
    CONSTRAINT driver_event_history_snapshot_consistent CHECK ((snapshot IS NULL) = (record_version IS NULL)),
    CONSTRAINT driver_event_history_correction_reasoned CHECK (entry_type NOT IN ('CORRECTION', 'CLOSED', 'REOPENED', 'RESTRICTION_RELEASED', 'EVIDENCE_UNLINKED', 'RELATIONSHIP_REMOVED', 'CONSEQUENCE_SUPERSEDED') OR (reason IS NOT NULL AND btrim(reason) <> ''))
);
CREATE INDEX driver_event_history_event_idx ON public.driver_event_history (event_id, seq);

-- ============================================================
-- 3. Evidence links
-- ============================================================

CREATE TABLE public.driver_event_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    evidence_document_id uuid NOT NULL REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
    role text NOT NULL,
    note text,
    link_status text NOT NULL DEFAULT 'active',
    verification_state text NOT NULL DEFAULT 'UNVERIFIED',
    verified_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    verified_at timestamptz,
    verification_note text,
    linked_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    unlinked_at timestamptz,
    unlinked_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    unlink_reason text,
    CONSTRAINT driver_event_evidence_event_fk FOREIGN KEY (event_id, organization_id) REFERENCES public.driver_events (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_event_evidence_role_valid CHECK (role IN ('SOURCE_REPORT', 'PHOTO_VIDEO', 'POLICE_REPORT', 'INSPECTION_REPORT', 'REPAIR_RECORD', 'RELEASE_EVIDENCE', 'CORRECTION_EVIDENCE', 'MEDICAL_RECORD', 'INSURER_RECORD', 'REGULATORY_NOTICE', 'OTHER')),
    CONSTRAINT driver_event_evidence_link_status_valid CHECK (link_status IN ('active', 'unlinked')),
    CONSTRAINT driver_event_evidence_verification_valid CHECK (verification_state IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
    -- "linked" is not "verified": verification names who and when, and only a person's review sets it
    CONSTRAINT driver_event_evidence_verified_attributed CHECK ((verification_state = 'UNVERIFIED') = (verified_by_actor_id IS NULL AND verified_at IS NULL)),
    CONSTRAINT driver_event_evidence_unlink_consistent CHECK ((link_status = 'unlinked') = (unlinked_at IS NOT NULL AND unlinked_by_actor_id IS NOT NULL AND unlink_reason IS NOT NULL))
);
CREATE UNIQUE INDEX driver_event_evidence_active_uq ON public.driver_event_evidence (event_id, evidence_document_id, role) WHERE link_status = 'active';
CREATE INDEX driver_event_evidence_event_idx ON public.driver_event_evidence (event_id);
CREATE INDEX driver_event_evidence_document_idx ON public.driver_event_evidence (evidence_document_id);

-- ============================================================
-- 4. Relationships
-- ============================================================

CREATE TABLE public.driver_event_relationships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    from_event_id uuid NOT NULL,
    relationship_type text NOT NULL,
    to_event_id uuid,
    to_record_type text,
    to_record_ref text,
    note text,
    status text NOT NULL DEFAULT 'active',
    created_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    removed_at timestamptz,
    removed_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    removal_reason text,
    CONSTRAINT driver_event_relationships_from_fk FOREIGN KEY (from_event_id, organization_id) REFERENCES public.driver_events (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_event_relationships_to_fk FOREIGN KEY (to_event_id, organization_id) REFERENCES public.driver_events (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_event_relationships_type_valid CHECK (relationship_type IN (
        'DUPLICATE_OF', 'SAME_OCCURRENCE', 'CAUSED_BY', 'CAUSES', 'FOLLOW_UP_OF', 'RELATED',
        'CITATION', 'REPAIR_ORDER', 'CLAIM', 'INSPECTION_FINDING', 'TRAINING_RECORD', 'COMPANY_ACTION', 'MAINTENANCE_RECORD', 'DISPATCH_RECORD')),
    CONSTRAINT driver_event_relationships_one_target CHECK ((to_event_id IS NOT NULL) <> (to_record_type IS NOT NULL AND to_record_ref IS NOT NULL)),
    CONSTRAINT driver_event_relationships_no_self CHECK (to_event_id IS NULL OR to_event_id <> from_event_id),
    CONSTRAINT driver_event_relationships_event_types CHECK (to_event_id IS NULL OR relationship_type IN ('DUPLICATE_OF', 'SAME_OCCURRENCE', 'CAUSED_BY', 'CAUSES', 'FOLLOW_UP_OF', 'RELATED')),
    CONSTRAINT driver_event_relationships_record_types CHECK (to_record_type IS NULL OR relationship_type IN ('CITATION', 'REPAIR_ORDER', 'CLAIM', 'INSPECTION_FINDING', 'TRAINING_RECORD', 'COMPANY_ACTION', 'MAINTENANCE_RECORD', 'DISPATCH_RECORD')),
    CONSTRAINT driver_event_relationships_ref_valid CHECK (to_record_ref IS NULL OR (btrim(to_record_ref) <> '' AND char_length(to_record_ref) <= 200)),
    CONSTRAINT driver_event_relationships_status_valid CHECK (status IN ('active', 'removed')),
    CONSTRAINT driver_event_relationships_removed_consistent CHECK ((status = 'removed') = (removed_at IS NOT NULL AND removed_by_actor_id IS NOT NULL AND removal_reason IS NOT NULL))
);
CREATE UNIQUE INDEX driver_event_relationships_event_uq ON public.driver_event_relationships (from_event_id, relationship_type, to_event_id) WHERE status = 'active' AND to_event_id IS NOT NULL;
CREATE UNIQUE INDEX driver_event_relationships_record_uq ON public.driver_event_relationships (from_event_id, relationship_type, to_record_type, to_record_ref) WHERE status = 'active' AND to_record_type IS NOT NULL;
-- A downstream record (a repair order, a claim, a citation) belongs to ONE occurrence per relationship type: it cannot be attached to two events, so its cost is never counted twice.
CREATE UNIQUE INDEX driver_event_relationships_downstream_once_uq ON public.driver_event_relationships (organization_id, relationship_type, to_record_type, to_record_ref) WHERE status = 'active' AND to_record_type IS NOT NULL AND relationship_type IN ('REPAIR_ORDER', 'CLAIM', 'CITATION', 'MAINTENANCE_RECORD');
CREATE INDEX driver_event_relationships_to_event_idx ON public.driver_event_relationships (to_event_id) WHERE to_event_id IS NOT NULL;

-- ============================================================
-- 5. Consequences
-- ============================================================

CREATE TABLE public.driver_event_consequences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    kind text NOT NULL,
    -- explicit about what is known: a measure, or a stated absence. Missing is never zero.
    measurement_state text NOT NULL,
    quantity numeric(14, 3),
    unit text,
    amount_minor bigint,
    currency text,
    started_at timestamptz,
    ended_at timestamptz,
    measured_on date,
    source text NOT NULL,
    confidence text NOT NULL,
    link_type text,
    link_ref text,
    dedupe_key text NOT NULL,
    note text,
    state text NOT NULL DEFAULT 'ACTIVE',
    superseded_by_id uuid,
    recorded_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_event_consequences_event_fk FOREIGN KEY (event_id, organization_id) REFERENCES public.driver_events (id, organization_id) ON DELETE RESTRICT,
    -- deferred: the replacement is inserted after the old row is marked superseded in the same transaction
    CONSTRAINT driver_event_consequences_superseded_by_fk FOREIGN KEY (superseded_by_id) REFERENCES public.driver_event_consequences (id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT driver_event_consequences_kind_valid CHECK (kind IN (
        'OPERATIONAL_DELAY', 'ASSET_DOWNTIME', 'MISSED_SERVICE', 'COST_ESTIMATED', 'COST_ACTUAL', 'CLAIM', 'RECOVERY', 'INJURY', 'DAMAGE',
        'ENFORCEMENT', 'ENVIRONMENTAL', 'CUSTOMER_IMPACT', 'INVESTIGATION_TIME', 'CORRECTIVE_ACTION_COST')),
    CONSTRAINT driver_event_consequences_state_valid CHECK (measurement_state IN ('MEASURED', 'NONE_CONFIRMED', 'NOT_COLLECTED', 'UNKNOWN')),
    CONSTRAINT driver_event_consequences_measure_consistent CHECK (
        (measurement_state = 'MEASURED' AND (quantity IS NOT NULL OR amount_minor IS NOT NULL OR (started_at IS NOT NULL AND ended_at IS NOT NULL)))
        OR (measurement_state <> 'MEASURED' AND quantity IS NULL AND amount_minor IS NULL AND started_at IS NULL AND ended_at IS NULL)
    ),
    CONSTRAINT driver_event_consequences_amount_currency CHECK ((amount_minor IS NULL) = (currency IS NULL)),
    CONSTRAINT driver_event_consequences_currency_valid CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    CONSTRAINT driver_event_consequences_nonneg CHECK ((quantity IS NULL OR quantity >= 0) AND (amount_minor IS NULL OR amount_minor >= 0)),
    CONSTRAINT driver_event_consequences_window CHECK (started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT driver_event_consequences_unit_with_quantity CHECK ((quantity IS NULL) OR (unit IS NOT NULL AND btrim(unit) <> '')),
    CONSTRAINT driver_event_consequences_confidence_valid CHECK (confidence IN ('CONFIRMED', 'ESTIMATED', 'UNVERIFIED')),
    CONSTRAINT driver_event_consequences_source_valid CHECK (btrim(source) <> '' AND char_length(source) <= 120),
    CONSTRAINT driver_event_consequences_link_pair CHECK ((link_type IS NULL) = (link_ref IS NULL)),
    CONSTRAINT driver_event_consequences_state_check CHECK (state IN ('ACTIVE', 'SUPERSEDED')),
    CONSTRAINT driver_event_consequences_superseded_consistent CHECK ((state = 'SUPERSEDED') = (superseded_by_id IS NOT NULL))
);
CREATE INDEX driver_event_consequences_event_idx ON public.driver_event_consequences (event_id) WHERE state = 'ACTIVE';
-- ONE active consequence per (kind, canonical source record): the same invoice, claim or repair order cannot be counted for two events or twice for one.
CREATE UNIQUE INDEX driver_event_consequences_dedupe_uq ON public.driver_event_consequences (organization_id, kind, dedupe_key) WHERE state = 'ACTIVE';

-- ============================================================
-- 6. Corrective actions and required follow-up
-- ============================================================

CREATE TABLE public.driver_event_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    action_type text NOT NULL,
    title text NOT NULL,
    description text,
    required boolean NOT NULL DEFAULT false,
    owner_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    owner_label text,
    due_date date,
    status text NOT NULL DEFAULT 'OPEN',
    completed_at timestamptz,
    completed_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    completion_note text,
    created_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_event_actions_event_fk FOREIGN KEY (event_id, organization_id) REFERENCES public.driver_events (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_event_actions_type_valid CHECK (action_type IN ('CORRECTIVE', 'PREVENTIVE', 'COACHING', 'TRAINING', 'REPAIR', 'REPORT', 'NOTIFICATION', 'INVESTIGATION', 'OTHER')),
    CONSTRAINT driver_event_actions_title_valid CHECK (btrim(title) <> '' AND char_length(title) <= 300),
    CONSTRAINT driver_event_actions_status_valid CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT driver_event_actions_owner_named CHECK (owner_actor_id IS NOT NULL OR owner_label IS NOT NULL OR status IN ('COMPLETED', 'CANCELLED') OR NOT required),
    CONSTRAINT driver_event_actions_done_consistent CHECK ((status IN ('COMPLETED', 'CANCELLED')) = (completed_at IS NOT NULL AND completed_by_actor_id IS NOT NULL)),
    CONSTRAINT driver_event_actions_done_reasoned CHECK (status NOT IN ('COMPLETED', 'CANCELLED') OR (completion_note IS NOT NULL AND btrim(completion_note) <> ''))
);
CREATE INDEX driver_event_actions_event_idx ON public.driver_event_actions (event_id);
CREATE INDEX driver_event_actions_open_idx ON public.driver_event_actions (organization_id, due_date) WHERE status IN ('OPEN', 'IN_PROGRESS');

-- ============================================================
-- 7. Safety restrictions
-- ============================================================

CREATE TABLE public.driver_event_restrictions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    restriction_kind text NOT NULL,
    authority text NOT NULL,
    mandatory boolean NOT NULL DEFAULT true,
    subject_type text NOT NULL,
    subject_driver_relationship_id uuid,
    subject_vehicle_id uuid,
    subject_label text,
    source_reference text,
    issued_at timestamptz,
    required_correction text,
    response_deadline date,
    state text NOT NULL DEFAULT 'ACTIVE',
    release_basis text,
    release_evidence_document_id uuid REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
    correction_summary text,
    release_note text,
    released_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    released_at timestamptz,
    created_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_event_restrictions_event_fk FOREIGN KEY (event_id, organization_id) REFERENCES public.driver_events (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_event_restrictions_kind_valid CHECK (restriction_kind IN ('DRIVER_OUT_OF_SERVICE', 'VEHICLE_OUT_OF_SERVICE', 'TRAILER_OUT_OF_SERVICE', 'EQUIPMENT_HOLD', 'CARGO_HOLD', 'DRIVER_STAND_DOWN', 'OTHER_SAFETY')),
    CONSTRAINT driver_event_restrictions_authority_valid CHECK (authority IN ('ENFORCEMENT', 'REGULATOR', 'COMPANY', 'OTHER')),
    CONSTRAINT driver_event_restrictions_subject_valid CHECK (subject_type IN ('DRIVER', 'VEHICLE', 'TRAILER', 'CARGO', 'OTHER')),
    CONSTRAINT driver_event_restrictions_subject_named CHECK (subject_driver_relationship_id IS NOT NULL OR subject_vehicle_id IS NOT NULL OR (subject_label IS NOT NULL AND btrim(subject_label) <> '')),
    CONSTRAINT driver_event_restrictions_state_valid CHECK (state IN ('ACTIVE', 'RELEASED')),
    CONSTRAINT driver_event_restrictions_basis_valid CHECK (release_basis IS NULL OR release_basis IN ('AUTHORITY_RELEASE_DOCUMENTED', 'CORRECTED_AND_AUTHORITY_CONFIRMED', 'COMPANY_CLEARANCE')),
    -- RELEASED carries the whole release: who, when, why, what was corrected
    CONSTRAINT driver_event_restrictions_release_complete CHECK (
        (state = 'RELEASED') = (released_by_actor_id IS NOT NULL AND released_at IS NOT NULL AND release_basis IS NOT NULL AND correction_summary IS NOT NULL AND btrim(correction_summary) <> '')
    ),
    -- An enforcement or regulator restriction is released only on a documented authoritative release; a company clearance is not enough for it.
    CONSTRAINT driver_event_restrictions_authority_basis CHECK (
        state = 'ACTIVE' OR authority IN ('COMPANY', 'OTHER') OR (release_basis IN ('AUTHORITY_RELEASE_DOCUMENTED', 'CORRECTED_AND_AUTHORITY_CONFIRMED') AND release_evidence_document_id IS NOT NULL)
    ),
    CONSTRAINT driver_event_restrictions_deadline_after_issue CHECK (response_deadline IS NULL OR issued_at IS NULL OR response_deadline >= issued_at::date)
);
CREATE INDEX driver_event_restrictions_event_idx ON public.driver_event_restrictions (event_id);
CREATE INDEX driver_event_restrictions_active_idx ON public.driver_event_restrictions (organization_id, subject_vehicle_id, subject_driver_relationship_id) WHERE state = 'ACTIVE';

-- ============================================================
-- 8. Analytical facts (contract v1)
-- ============================================================

CREATE TABLE public.driver_event_bi_facts (
    event_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    record_version integer NOT NULL,
    contract_version text NOT NULL,
    category text NOT NULL,
    category_code text NOT NULL,
    schema_version text NOT NULL,
    status text NOT NULL,
    record_state text NOT NULL,
    -- time
    occurrence_precision text NOT NULL,
    occurred_at timestamptz,
    occurred_time_zone text,
    occurred_local_date date,
    reported_at timestamptz,
    reporting_lag_minutes integer,
    -- classification
    severity_observed text NOT NULL,
    severity_potential text,
    source_type text NOT NULL,
    ingestion_origin text NOT NULL,
    source_reliability text NOT NULL,
    -- parties and assets (canonical keys for joins into the wider analytics layer)
    driver_relationship_id uuid,
    driver_person_id uuid,
    vehicle_id uuid,
    trailer_vehicle_id uuid,
    jurisdiction_code text,
    country text,
    state_province text,
    load_reference text,
    shipment_reference text,
    customer_reference text,
    -- evidence and verification
    verification_state text NOT NULL,
    evidence_links_active integer NOT NULL DEFAULT 0,
    evidence_stored integer NOT NULL DEFAULT 0,
    evidence_verified integer NOT NULL DEFAULT 0,
    data_quality_score numeric(4, 3),
    required_fields_total integer,
    required_fields_missing integer,
    quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- outcome measures (NULL = not collected; never zero by default)
    injuries_count integer,
    fatalities_count integer,
    tow_away text,
    property_damage text,
    -- operational disruption
    delay_minutes numeric(12, 2),
    downtime_minutes numeric(12, 2),
    service_interrupted text,
    missed_service text,
    -- financial (minor units; NULL = not collected)
    currency text,
    cost_estimated_minor bigint,
    cost_actual_minor bigint,
    claim_amount_minor bigint,
    recovery_amount_minor bigint,
    net_impact_minor bigint,
    -- corrective actions, restrictions and resolution
    actions_total integer NOT NULL DEFAULT 0,
    actions_open integer NOT NULL DEFAULT 0,
    required_actions_open integer NOT NULL DEFAULT 0,
    next_action_due date,
    restrictions_active integer NOT NULL DEFAULT 0,
    restrictions_released integer NOT NULL DEFAULT 0,
    resolution_state text NOT NULL,
    closed_at timestamptz,
    hours_to_close numeric(12, 2),
    -- recurrence and exposure keys
    recurrence_driver_key text,
    recurrence_vehicle_key text,
    exposure_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
    corrections_count integer NOT NULL DEFAULT 0,
    derived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (event_id, record_version),
    CONSTRAINT driver_event_bi_facts_event_fk FOREIGN KEY (event_id, organization_id) REFERENCES public.driver_events (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_event_bi_facts_reliability_valid CHECK (source_reliability IN ('AUTHORITATIVE', 'CORROBORATED', 'SELF_REPORTED', 'DEVICE_UNVERIFIED', 'UNKNOWN')),
    CONSTRAINT driver_event_bi_facts_resolution_valid CHECK (resolution_state IN ('DRAFT', 'OPEN', 'RESTRICTED', 'AWAITING_ACTIONS', 'CLOSED')),
    CONSTRAINT driver_event_bi_facts_score_valid CHECK (data_quality_score IS NULL OR data_quality_score BETWEEN 0 AND 1),
    CONSTRAINT driver_event_bi_facts_yn_valid CHECK (
        (tow_away IS NULL OR tow_away IN ('YES', 'NO', 'UNKNOWN')) AND (property_damage IS NULL OR property_damage IN ('YES', 'NO', 'UNKNOWN'))
        AND (service_interrupted IS NULL OR service_interrupted IN ('YES', 'NO', 'UNKNOWN')) AND (missed_service IS NULL OR missed_service IN ('YES', 'NO', 'UNKNOWN'))
    )
);
CREATE INDEX driver_event_bi_facts_org_date_idx ON public.driver_event_bi_facts (organization_id, occurred_local_date);

CREATE VIEW public.driver_event_facts_v1 WITH (security_invoker = true) AS
SELECT f.*
  FROM public.driver_event_bi_facts f
  JOIN public.driver_events e ON e.id = f.event_id AND e.organization_id = f.organization_id AND e.current_version = f.record_version
 WHERE NOT EXISTS (
        SELECT 1 FROM public.driver_event_relationships r
         WHERE r.from_event_id = e.id AND r.relationship_type = 'DUPLICATE_OF' AND r.status = 'active'
       );

COMMENT ON VIEW public.driver_event_facts_v1 IS 'Contract v1: one row per current, non-duplicate Driver Event. NULL means not collected, never zero. Join keys: driver_relationship_id, vehicle_id, occurred_local_date.';

-- ============================================================
-- 9. Guards
-- ============================================================

CREATE FUNCTION tes_security.guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_append_only() FROM PUBLIC;
CREATE TRIGGER driver_event_history_append_only BEFORE UPDATE OR DELETE ON public.driver_event_history FOR EACH ROW EXECUTE FUNCTION tes_security.guard_append_only();

-- no row of an event table is ever deleted
CREATE FUNCTION tes_security.guard_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_no_delete() FROM PUBLIC;
-- The analytical fact is DERIVED and recomputable (it is refreshed when consequences, actions, restrictions or evidence change); it is never deleted.
CREATE TRIGGER driver_event_bi_facts_no_delete BEFORE DELETE ON public.driver_event_bi_facts FOR EACH ROW EXECUTE FUNCTION tes_security.guard_no_delete();
CREATE TRIGGER driver_events_no_delete BEFORE DELETE ON public.driver_events FOR EACH ROW EXECUTE FUNCTION tes_security.guard_no_delete();
CREATE TRIGGER driver_event_evidence_no_delete BEFORE DELETE ON public.driver_event_evidence FOR EACH ROW EXECUTE FUNCTION tes_security.guard_no_delete();
CREATE TRIGGER driver_event_relationships_no_delete BEFORE DELETE ON public.driver_event_relationships FOR EACH ROW EXECUTE FUNCTION tes_security.guard_no_delete();
CREATE TRIGGER driver_event_consequences_no_delete BEFORE DELETE ON public.driver_event_consequences FOR EACH ROW EXECUTE FUNCTION tes_security.guard_no_delete();
CREATE TRIGGER driver_event_actions_no_delete BEFORE DELETE ON public.driver_event_actions FOR EACH ROW EXECUTE FUNCTION tes_security.guard_no_delete();
CREATE TRIGGER driver_event_restrictions_no_delete BEFORE DELETE ON public.driver_event_restrictions FOR EACH ROW EXECUTE FUNCTION tes_security.guard_no_delete();

-- An evidence link may only point at a document of the SAME company (tenant check the foreign key cannot express).
CREATE FUNCTION tes_security.driver_event_evidence_same_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    doc_org uuid;
BEGIN
    SELECT organization_id INTO doc_org FROM public.evidence_documents WHERE id = NEW.evidence_document_id;
    IF doc_org IS NULL OR doc_org IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'Evidence belongs to a different company than the event' USING ERRCODE = '23514';
    END IF;
    -- only bytes that completed quarantine -> scan -> intake -> evidence can support an event
    IF NOT EXISTS (SELECT 1 FROM public.evidence_payloads p WHERE p.evidence_document_id = NEW.evidence_document_id AND p.organization_id = NEW.organization_id AND p.lifecycle_state = 'stored') THEN
        RAISE EXCEPTION 'Evidence is not stored yet (it must finish quarantine and scanning first)' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- Lets the service report a document's lifecycle state for a friendly message without holding evidence-read capability. NULL = not this company's.
CREATE FUNCTION tes_security.driver_event_evidence_state(p_org uuid, p_document uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT p.lifecycle_state
      FROM public.evidence_documents d
      JOIN public.evidence_payloads p ON p.evidence_document_id = d.id AND p.organization_id = d.organization_id
     WHERE d.id = p_document AND d.organization_id = p_org
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_evidence_state(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.driver_event_evidence_state(uuid, uuid) TO "tes-backend@tes-production-510007.iam";
REVOKE ALL ON FUNCTION tes_security.driver_event_evidence_same_tenant() FROM PUBLIC;
CREATE TRIGGER driver_event_evidence_tenant BEFORE INSERT ON public.driver_event_evidence FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_evidence_same_tenant();

-- Resolves a company's driver / vehicle relationship id to the canonical person / vehicle id, for callers that hold the event capability but not the driver or
-- vehicle read capability. It answers only for the supplied company, only for an active relationship, and only to a DRIVER_EVENT_MANAGE context.
CREATE FUNCTION tes_security.driver_event_link_driver(p_org uuid, p_relationship uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT r.person_id FROM public.organization_driver_relationships r
     WHERE tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE'])
       AND r.id = p_relationship AND r.organization_id = p_org AND r.record_status = 'active';
$$;
CREATE FUNCTION tes_security.driver_event_link_vehicle(p_org uuid, p_relationship uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT r.vehicle_id FROM public.organization_vehicle_relationships r
     WHERE tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE'])
       AND r.id = p_relationship AND r.organization_id = p_org AND r.record_status = 'active';
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_link_driver(uuid, uuid), tes_security.driver_event_link_vehicle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.driver_event_link_driver(uuid, uuid), tes_security.driver_event_link_vehicle(uuid, uuid) TO "tes-backend@tes-production-510007.iam";

-- Company existence for callers that hold the event capability but not the company-read capability (answers only to a DRIVER_EVENT context).
CREATE FUNCTION tes_security.driver_event_organization_exists(p_org uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE'])
       AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org);
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_organization_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.driver_event_organization_exists(uuid) TO "tes-backend@tes-production-510007.iam";

CREATE FUNCTION tes_security.driver_event_evidence_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.evidence_document_id IS DISTINCT FROM OLD.evidence_document_id OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.linked_by_actor_id IS DISTINCT FROM OLD.linked_by_actor_id OR NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
        RAISE EXCEPTION 'An evidence link keeps its event, document, role and linker' USING ERRCODE = '23514';
    END IF;
    IF OLD.link_status = 'unlinked' THEN
        RAISE EXCEPTION 'An unlinked evidence link is final' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_evidence_guard_update() FROM PUBLIC;
CREATE TRIGGER driver_event_evidence_guard BEFORE UPDATE ON public.driver_event_evidence FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_evidence_guard_update();

-- Relationships and consequences: removal / supersession only, never an edit of the fact itself.
CREATE FUNCTION tes_security.driver_event_relationship_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.from_event_id IS DISTINCT FROM OLD.from_event_id
       OR NEW.relationship_type IS DISTINCT FROM OLD.relationship_type OR NEW.to_event_id IS DISTINCT FROM OLD.to_event_id
       OR NEW.to_record_type IS DISTINCT FROM OLD.to_record_type OR NEW.to_record_ref IS DISTINCT FROM OLD.to_record_ref
       OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'A relationship cannot be edited; remove it with a reason and add the correct one' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'removed' THEN
        RAISE EXCEPTION 'A removed relationship is final' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_relationship_guard_update() FROM PUBLIC;
CREATE TRIGGER driver_event_relationships_guard BEFORE UPDATE ON public.driver_event_relationships FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_relationship_guard_update();

CREATE FUNCTION tes_security.driver_event_consequence_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.state = 'SUPERSEDED' THEN
        RAISE EXCEPTION 'A superseded consequence is final' USING ERRCODE = '23514';
    END IF;
    IF NEW.state <> 'SUPERSEDED' OR NEW.superseded_by_id IS NULL
       OR (to_jsonb(NEW) - 'state' - 'superseded_by_id') IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'superseded_by_id') THEN
        RAISE EXCEPTION 'A consequence is superseded, never edited' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_consequence_guard_update() FROM PUBLIC;
CREATE TRIGGER driver_event_consequences_guard BEFORE UPDATE ON public.driver_event_consequences FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_consequence_guard_update();

-- Actions: only status and its completion may change.
CREATE FUNCTION tes_security.driver_event_action_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'A finished action is final' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'completed_at' - 'completed_by_actor_id' - 'completion_note' - 'due_date' - 'owner_actor_id' - 'owner_label')
       IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'completed_at' - 'completed_by_actor_id' - 'completion_note' - 'due_date' - 'owner_actor_id' - 'owner_label') THEN
        RAISE EXCEPTION 'An action keeps its event, type, title and required flag' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_action_guard_update() FROM PUBLIC;
CREATE TRIGGER driver_event_actions_guard BEFORE UPDATE ON public.driver_event_actions FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_action_guard_update();

-- Restrictions: ACTIVE -> RELEASED only, and only with the documented release. The release evidence must be stored, scanned evidence of the SAME company,
-- linked to THIS event with the role RELEASE_EVIDENCE, and a person must have VERIFIED it (linked is not verified).
CREATE FUNCTION tes_security.driver_event_release_evidence_ok(p_org uuid, p_event uuid, p_document uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.driver_event_evidence l
          JOIN public.evidence_documents d ON d.id = l.evidence_document_id AND d.organization_id = p_org
          JOIN public.evidence_payloads p ON p.evidence_document_id = d.id AND p.organization_id = p_org
         WHERE l.event_id = p_event AND l.organization_id = p_org AND l.evidence_document_id = p_document
           AND l.role = 'RELEASE_EVIDENCE' AND l.link_status = 'active' AND l.verification_state = 'VERIFIED' AND p.lifecycle_state = 'stored'
    );
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_release_evidence_ok(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.driver_event_release_evidence_ok(uuid, uuid, uuid) TO "tes-backend@tes-production-510007.iam";

CREATE FUNCTION tes_security.driver_event_restriction_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.state = 'RELEASED' THEN
        RAISE EXCEPTION 'A released restriction is final; issue a new restriction if the condition returns' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - 'state' - 'release_basis' - 'release_evidence_document_id' - 'correction_summary' - 'release_note' - 'released_by_actor_id' - 'released_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'release_basis' - 'release_evidence_document_id' - 'correction_summary' - 'release_note' - 'released_by_actor_id' - 'released_at') THEN
        RAISE EXCEPTION 'A restriction keeps what was issued; only its release is recorded' USING ERRCODE = '23514';
    END IF;
    IF NEW.state = 'RELEASED' AND NEW.authority IN ('ENFORCEMENT', 'REGULATOR') THEN
        IF NEW.release_evidence_document_id IS NULL
           OR NOT tes_security.driver_event_release_evidence_ok(NEW.organization_id, NEW.event_id, NEW.release_evidence_document_id) THEN
            RAISE EXCEPTION 'An enforcement restriction is released only with stored release evidence linked to this event' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_restriction_guard_update() FROM PUBLIC;
CREATE TRIGGER driver_event_restrictions_guard BEFORE UPDATE ON public.driver_event_restrictions FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_restriction_guard_update();

-- Events: identity and creator are fixed; a changed record is a new version (+1); an event is Closed only through an attributed closure and never
-- while a mandatory restriction is active or a required action is open. An ordinary status change cannot clear a safety restriction.
CREATE FUNCTION tes_security.driver_event_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.category_code IS DISTINCT FROM OLD.category_code OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'An event keeps its company, category and creator' USING ERRCODE = '23514';
    END IF;
    -- The recorded content (everything but status/closure/verification bookkeeping) is versioned: a change is exactly one new version, no change keeps the version.
    IF (to_jsonb(NEW) - 'status' - 'closed_at' - 'closed_by_actor_id' - 'closure_reason' - 'verification_state' - 'updated_at' - 'current_version')
       IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'closed_at' - 'closed_by_actor_id' - 'closure_reason' - 'verification_state' - 'updated_at' - 'current_version') THEN
        IF NEW.current_version <> OLD.current_version + 1 THEN
            RAISE EXCEPTION 'A changed event record is a new version' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.current_version IS DISTINCT FROM OLD.current_version THEN
        RAISE EXCEPTION 'The version only advances with the record' USING ERRCODE = '23514';
    END IF;
    IF OLD.record_state = 'RECORDED' AND NEW.record_state = 'DRAFT' THEN
        RAISE EXCEPTION 'A recorded event cannot return to draft' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'Closed' AND OLD.status IS DISTINCT FROM 'Closed' THEN
        IF EXISTS (SELECT 1 FROM public.driver_event_restrictions r WHERE r.event_id = NEW.id AND r.state = 'ACTIVE' AND r.mandatory) THEN
            RAISE EXCEPTION 'The event has an unresolved mandatory safety restriction; release it with its documented correction before closing' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM public.driver_event_actions a WHERE a.event_id = NEW.id AND a.required AND a.status IN ('OPEN', 'IN_PROGRESS')) THEN
            RAISE EXCEPTION 'The event has required follow-up that is not complete' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_guard_update() FROM PUBLIC;
CREATE TRIGGER driver_events_guard BEFORE UPDATE ON public.driver_events FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_guard_update();

-- A restriction cannot be issued, and an action cannot be added, on a closed event (reopen it first, with a reason).
CREATE FUNCTION tes_security.driver_event_child_open_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    st text;
BEGIN
    SELECT status INTO st FROM public.driver_events WHERE id = NEW.event_id AND organization_id = NEW.organization_id;
    IF st = 'Closed' THEN
        RAISE EXCEPTION 'The event is closed; reopen it with a reason first' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_child_open_only() FROM PUBLIC;
CREATE TRIGGER driver_event_restrictions_open_only BEFORE INSERT ON public.driver_event_restrictions FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_child_open_only();
CREATE TRIGGER driver_event_actions_open_only BEFORE INSERT ON public.driver_event_actions FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_child_open_only();

-- ============================================================
-- 10. Row-level security and grants (SYSTEM scope only)
-- ============================================================

ALTER TABLE public.driver_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_event_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_event_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_event_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_event_consequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_event_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_event_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_event_bi_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_events_system ON public.driver_events FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE']));
CREATE POLICY driver_event_history_system ON public.driver_event_history FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE']));
CREATE POLICY driver_event_evidence_system ON public.driver_event_evidence FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE']));
CREATE POLICY driver_event_relationships_system ON public.driver_event_relationships FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE']));
CREATE POLICY driver_event_consequences_system ON public.driver_event_consequences FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE']));
CREATE POLICY driver_event_actions_system ON public.driver_event_actions FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE']));
-- Issuing or editing a restriction needs MANAGE; the row may only become RELEASED under the dedicated release capability.
CREATE POLICY driver_event_restrictions_read ON public.driver_event_restrictions FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE', 'DRIVER_EVENT_SAFETY_RELEASE']));
CREATE POLICY driver_event_restrictions_insert ON public.driver_event_restrictions FOR INSERT
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE']) AND state = 'ACTIVE');
CREATE POLICY driver_event_restrictions_release ON public.driver_event_restrictions FOR UPDATE
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_SAFETY_RELEASE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_SAFETY_RELEASE']));
CREATE POLICY driver_event_bi_facts_system ON public.driver_event_bi_facts FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_EVENT_MANAGE']));

REVOKE ALL ON TABLE public.driver_events, public.driver_event_history, public.driver_event_evidence, public.driver_event_relationships, public.driver_event_consequences,
    public.driver_event_actions, public.driver_event_restrictions, public.driver_event_bi_facts FROM PUBLIC;
REVOKE ALL ON public.driver_event_facts_v1 FROM PUBLIC;

GRANT SELECT ON TABLE public.driver_events, public.driver_event_history, public.driver_event_evidence, public.driver_event_relationships, public.driver_event_consequences,
    public.driver_event_actions, public.driver_event_restrictions, public.driver_event_bi_facts, public.driver_event_facts_v1 TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, category, category_code, subtype, schema_version, title, narrative, record_state, status, occurrence_precision, occurred_at, occurred_time_zone,
    occurred_local_date, occurred_local_time, reported_at, reported_local_date, reporter_actor_id, reporter_label, source_type, source_reference, ingestion_origin,
    driver_relationship_id, driver_person_id, vehicle_relationship_id, vehicle_id, trailer_relationship_id, trailer_vehicle_id, trip_reference, load_reference, shipment_reference,
    customer_reference, location_text, city, state_province, country, jurisdiction_code, latitude, longitude, observed_severity, potential_severity, verification_state,
    data_quality, record, current_version, created_by_actor_id) ON public.driver_events TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (subtype, title, narrative, record_state, status, occurrence_precision, occurred_at, occurred_time_zone, occurred_local_date, occurred_local_time, reported_at, reported_local_date,
    reporter_actor_id, reporter_label, source_type, source_reference, ingestion_origin, driver_relationship_id, driver_person_id, vehicle_relationship_id, vehicle_id, trailer_relationship_id,
    trailer_vehicle_id, trip_reference, load_reference, shipment_reference, customer_reference, location_text, city, state_province, country, jurisdiction_code, latitude, longitude,
    observed_severity, potential_severity, verification_state, data_quality, record, current_version, schema_version, closed_at, closed_by_actor_id, closure_reason) ON public.driver_events TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, event_id, organization_id, seq, entry_type, record_version, snapshot, changes, reason, actor_id) ON public.driver_event_history TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, event_id, organization_id, evidence_document_id, role, note, linked_by_actor_id) ON public.driver_event_evidence TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (verification_state, verified_by_actor_id, verified_at, verification_note, link_status, unlinked_at, unlinked_by_actor_id, unlink_reason) ON public.driver_event_evidence TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, organization_id, from_event_id, relationship_type, to_event_id, to_record_type, to_record_ref, note, created_by_actor_id) ON public.driver_event_relationships TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (status, removed_at, removed_by_actor_id, removal_reason) ON public.driver_event_relationships TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, event_id, organization_id, kind, measurement_state, quantity, unit, amount_minor, currency, started_at, ended_at, measured_on, source, confidence, link_type, link_ref, dedupe_key, note, recorded_by_actor_id)
    ON public.driver_event_consequences TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (state, superseded_by_id) ON public.driver_event_consequences TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, event_id, organization_id, action_type, title, description, required, owner_actor_id, owner_label, due_date, created_by_actor_id) ON public.driver_event_actions TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (status, completed_at, completed_by_actor_id, completion_note, due_date, owner_actor_id, owner_label) ON public.driver_event_actions TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, event_id, organization_id, restriction_kind, authority, mandatory, subject_type, subject_driver_relationship_id, subject_vehicle_id, subject_label, source_reference, issued_at,
    required_correction, response_deadline, created_by_actor_id) ON public.driver_event_restrictions TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (state, release_basis, release_evidence_document_id, correction_summary, release_note, released_by_actor_id, released_at) ON public.driver_event_restrictions TO "tes-backend@tes-production-510007.iam";
GRANT INSERT, UPDATE ON public.driver_event_bi_facts TO "tes-backend@tes-production-510007.iam";
