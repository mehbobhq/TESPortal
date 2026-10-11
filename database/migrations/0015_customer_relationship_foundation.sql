-- TES Companies: Customer Relationship foundation
-- Migration: 0015
--
-- Scope (additive only; migrations 0001-0014 are not edited):
--   1. public.engagement_types                     controlled catalogue: RECURRING, ONE_OFF (seeded)
--   2. public.engagement_stage_types               controlled catalogue of lifecycle stages (seeded)
--   3. public.product_levels                       the three TES product layers (seeded)
--   4. public.service_catalogue                    services within a product level (structure only; deliberately unseeded)
--   5. public.engagement_end_reasons               controlled catalogue of structural termination reasons (seeded)
--   6. public.customer_engagements                 ALTERED: engagement_type and end_reason_code columns, identity/termination guards
--   7. public.customer_engagement_stages           effective-dated lifecycle stage history of an Engagement
--   8. public.customer_engagement_terminations     audit trail of every recorded termination fact (original and corrections)
--   9. public.engagement_service_scopes            which product level / service applies during an Engagement
--  10. public.engagement_responsibility_periods    when TES actually assumed operational responsibility for a scope
--  11. public.customer_agreements                  stable agreement identity of a Customer
--  12. public.customer_agreement_versions          effective-dated versions of an agreement
--  13. two capabilities in public.capabilities     CUSTOMER_RELATIONSHIP_READ, CUSTOMER_RELATIONSHIP_MANAGE (rows only)
--
-- Vocabulary (these are different things and are modelled as different things):
--   Customer          TES's lifetime business-relationship identity for ONE Organization (public.customers, migration
--                     0003). At most one per Organization (UNIQUE organization_id). It is never recreated: when a former
--                     Customer returns, the same Customer gets a new Engagement.
--   Engagement        one contiguous period in which TES provides an agreed service relationship (public.customer_engagements,
--                     migration 0003). Many over a Customer's life, at most ONE open at a time (migration 0003's partial
--                     unique index). RECURRING or ONE_OFF. ONE_OFF is an engagement type, not another kind of Customer.
--   Stage             where an Engagement is in its life (ONBOARDING, TRIAL, ACTIVE, MANAGED_PROBATION, SUSPENDED, ENDED).
--                     TRIAL and MANAGED_PROBATION are stages, not engagement types.
--   Product level     the broad TES layer (COMPLIANCE, BUSINESS_INTELLIGENCE, DECISION_SUPPORT).
--   Service           one particular service within a product level.
--   Service scope     what TES agreed to provide during (part of) an Engagement.
--   Responsibility    when TES actually ASSUMED operational responsibility for a scope. It starts no earlier than the scope
--                     and the Engagement, ends no later than either, and never reaches back before TES took over.
--   Agreement         the Customer's contract identity; versions record amendments. No terms, prices or documents here.
--
-- ONE canonical termination truth:
--   public.customer_engagements.ended_at (migration 0003) is THE authoritative fact that an Engagement ended. The ENDED
--   stage is a synchronized projection of it, never an independent fact. A deferred constraint trigger
--   (require_engagement_consistency) makes contradiction impossible at commit:
--     - the Engagement is open     <=>  its current stage is not ENDED
--     - the Engagement has ended   <=>  its current stage is ENDED and starts exactly at ended_at
--     - stage history is gap-free from started_at to ended_at, never overlaps, and nothing continues past the boundary
--     - no active scope or responsibility reaches past ended_at.
--   An ended Engagement is never REOPENED: ended_at and end_reason_code can never return to NULL (a returning Customer gets
--   a NEW Engagement). A wrongly recorded termination can be CORRECTED, never silently overwritten:
--     - ended_at / end_reason_code may change from one value to another only while an audit row in
--       customer_engagement_terminations records it. That table holds one 'active' row mirroring the canonical values and,
--       for every earlier recording, a frozen 'corrected' row linked to its replacement (nothing is destroyed). The deferred
--       consistency trigger rejects any commit in which the active row and the canonical columns disagree, so a change
--       without its audit row cannot commit.
--     - the ENDED stage and the stage that preceded it move with it (corrected, not rewritten), so history stays gap-free.
--     - the server never lets a correction expand TES responsibility, and refuses a date that leaves a scope or
--       responsibility window impossible; see lib/customer-relationship/operations.ts (correctEngagementTermination).
--
-- Termination reason: customer_engagements.end_reason (0003, free text) is RETIRED - a CHECK requires it to stay NULL and the
-- runtime role loses INSERT/UPDATE on it. The structural reason is end_reason_code, a foreign key to the small controlled
-- catalogue engagement_end_reasons. There is deliberately no OTHER code and no free-text companion column: any narrative
-- belongs in a future notes/evidence record, never in the structural termination fact.
--
-- Stages and policy: PostgreSQL owns STRUCTURE only. It does not encode which stage may follow which (that is policy for a
-- future Rules layer) and does not encode the managed-probation maximum (also policy, and it must be versionable). A stage
-- the catalogue marks bounded (TRIAL, MANAGED_PROBATION) must carry planned_end_at; nothing limits its length.
--
-- Lifecycle convention (0012-0014): a REAL-WORLD change ends the old row and starts a new one; a CORRECTION marks the wrong
-- row 'corrected' with a deferred superseded_by link, never ends it and freezes it (the replacement inherits its business
-- time); 'voided' (scopes, responsibility, agreement versions) is an entered-in-error row with no replacement. Stage
-- history cannot be voided - it must stay contiguous - only corrected. Nothing is ever deleted: DELETE and TRUNCATE are
-- refused by trigger on every new business table.
--
-- No RLS: this is an internal SYSTEM foundation. customers and customer_engagements are not RLS tables, SYSTEM work runs
-- without tenant context, and no CUSTOMER-facing read exists. Visibility is enforced by the server's SYSTEM capabilities.
-- RLS may be added additively later, when a real customer-facing read exists. No SECURITY DEFINER anywhere.
--
-- Lock order (every mutation): Organization -> (Customer: immutable, advisory-locked by the Engagement insert trigger) ->
-- Engagement -> dependent rows. Dependent-row triggers take the
-- Engagement row FOR NO KEY UPDATE first, so all writers of one Engagement serialize; unique indexes and the deferred
-- consistency trigger are the structural backstops.
--
-- Capabilities: CUSTOMER_ESTABLISH (0011) keeps its meaning: turn an eligible Organization into a Customer relationship
-- (or re-engage it) and begin an Engagement. The two new capabilities are SYSTEM-only catalogue rows and are granted to
-- nobody here: CUSTOMER_RELATIONSHIP_READ reads the domain; CUSTOMER_RELATIONSHIP_MANAGE manages an established one.


-- ============================================================
-- 1. Controlled catalogues
-- ============================================================

CREATE TABLE public.engagement_types (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    CONSTRAINT engagement_types_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT engagement_types_display_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT engagement_types_sort_order_uq UNIQUE (sort_order)
);

INSERT INTO public.engagement_types (code, display_name, description, sort_order)
VALUES
    ('RECURRING', 'Recurring', 'An ongoing service relationship without a fixed end.', 10),
    ('ONE_OFF', 'One-off', 'A bounded, transactional service relationship for a specific piece of work. The Customer identity is the same as for any other Engagement.', 20);

CREATE TABLE public.engagement_stage_types (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text NOT NULL,

    -- A bounded stage is time-boxed by nature: its rows must carry planned_end_at. How long is policy, not schema.
    is_bounded boolean NOT NULL DEFAULT false,

    -- A terminal stage is the end of an Engagement. It is only ever the current, open stage, starting at ended_at.
    is_terminal boolean NOT NULL DEFAULT false,

    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    CONSTRAINT engagement_stage_types_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT engagement_stage_types_display_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT engagement_stage_types_not_bounded_and_terminal CHECK (NOT (is_bounded AND is_terminal)),
    CONSTRAINT engagement_stage_types_sort_order_uq UNIQUE (sort_order)
);

INSERT INTO public.engagement_stage_types (code, display_name, description, is_bounded, is_terminal, sort_order)
VALUES
    ('ONBOARDING', 'Onboarding', 'TES is setting the Customer up; service has not fully started.', false, false, 10),
    ('TRIAL', 'Trial', 'A time-boxed evaluation period.', true, false, 20),
    ('ACTIVE', 'Active', 'Service is being delivered in the ordinary way.', false, false, 30),
    ('MANAGED_PROBATION', 'Managed probation', 'A time-boxed period of closer management. The maximum length is policy, not schema.', true, false, 40),
    ('SUSPENDED', 'Suspended', 'The Engagement is open but service is paused.', false, false, 50),
    ('ENDED', 'Ended', 'The Engagement has ended. A projection of customer_engagements.ended_at, never an independent fact.', false, true, 60);

CREATE TABLE public.product_levels (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    CONSTRAINT product_levels_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT product_levels_display_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT product_levels_sort_order_uq UNIQUE (sort_order)
);

INSERT INTO public.product_levels (code, display_name, description, sort_order)
VALUES
    ('COMPLIANCE', 'Compliance', 'Regulatory and safety compliance services.', 10),
    ('BUSINESS_INTELLIGENCE', 'Business intelligence', 'Reporting and insight services.', 20),
    ('DECISION_SUPPORT', 'Decision support', 'Advisory and decision-support services.', 30);

-- Structure only: no services are seeded because none is a stable, agreed concept yet. A scope with a NULL service means
-- "the whole product level"; services are added to this catalogue by later migrations.
CREATE TABLE public.service_catalogue (
    code text PRIMARY KEY,
    product_level_code text NOT NULL
        REFERENCES public.product_levels (code)
        ON DELETE RESTRICT,
    display_name text NOT NULL,
    description text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    CONSTRAINT service_catalogue_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT service_catalogue_display_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT service_catalogue_sort_order_uq UNIQUE (sort_order),
    CONSTRAINT service_catalogue_code_level_uq UNIQUE (code, product_level_code)
);


CREATE TABLE public.engagement_end_reasons (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    CONSTRAINT engagement_end_reasons_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT engagement_end_reasons_display_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT engagement_end_reasons_sort_order_uq UNIQUE (sort_order)
);

-- A deliberately small structural set that can stay stable. More codes arrive by migration; "other" never does.
INSERT INTO public.engagement_end_reasons (code, display_name, description, sort_order)
VALUES
    ('COMPLETED', 'Completed', 'The agreed work or term was completed.', 10),
    ('CUSTOMER_TERMINATED', 'Ended by the Customer', 'The Customer ended the relationship.', 20),
    ('TES_TERMINATED', 'Ended by TES', 'TES ended the relationship.', 30),
    ('MUTUAL_AGREEMENT', 'Ended by mutual agreement', 'Both parties agreed to end the relationship.', 40),
    ('ENTERED_IN_ERROR', 'Entered in error', 'The Engagement should never have been established. The row is kept as history.', 50);


-- ============================================================
-- 2. customer_engagements (migration 0003): additive change
--
-- engagement_type is chosen when the Engagement is established and is immutable. The column is nullable at the column
-- level only so the ALTER is safe on any existing row; guard_engagement_insert refuses a new Engagement without one.
-- Mistyping an Engagement is not correctable in this migration (a real change of nature - a one-off becoming recurring -
-- is a new Engagement; the Customer identity persists).
-- ============================================================

ALTER TABLE public.customer_engagements
    ADD COLUMN engagement_type text;

ALTER TABLE public.customer_engagements
    ADD COLUMN end_reason_code text;

ALTER TABLE public.customer_engagements
    ADD CONSTRAINT customer_engagements_engagement_type_fk
    FOREIGN KEY (engagement_type)
    REFERENCES public.engagement_types (code)
    ON DELETE RESTRICT;

ALTER TABLE public.customer_engagements
    ADD CONSTRAINT customer_engagements_end_reason_code_fk
    FOREIGN KEY (end_reason_code)
    REFERENCES public.engagement_end_reasons (code)
    ON DELETE RESTRICT;

-- ended_at must be strictly after started_at (a zero-length Engagement cannot carry a stage).
ALTER TABLE public.customer_engagements
    ADD CONSTRAINT customer_engagements_ended_after_start
    CHECK (ended_at IS NULL OR ended_at > started_at);

-- An Engagement has a structural end reason exactly when it has ended; the retired free-text column stays empty.
ALTER TABLE public.customer_engagements
    ADD CONSTRAINT customer_engagements_end_reason_code_with_end
    CHECK ((ended_at IS NULL) = (end_reason_code IS NULL));

ALTER TABLE public.customer_engagements
    ADD CONSTRAINT customer_engagements_end_reason_retired
    CHECK (end_reason IS NULL);


-- ============================================================
-- 3. Engagement stage history
-- ============================================================

CREATE TABLE public.customer_engagement_stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    engagement_id uuid NOT NULL
        REFERENCES public.customer_engagements (id)
        ON DELETE RESTRICT,

    stage_code text NOT NULL
        REFERENCES public.engagement_stage_types (code)
        ON DELETE RESTRICT,

    -- Required for a bounded stage, absent otherwise. A date the stage is expected to end; the maximum is policy.
    planned_end_at timestamptz,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT customer_engagement_stages_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT customer_engagement_stages_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT customer_engagement_stages_planned_end_after_start
        CHECK (planned_end_at IS NULL OR planned_end_at > effective_from),

    CONSTRAINT customer_engagement_stages_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT customer_engagement_stages_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
        ),

    CONSTRAINT customer_engagement_stages_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT customer_engagement_stages_id_engagement_uq
        UNIQUE (id, engagement_id),

    CONSTRAINT customer_engagement_stages_superseded_by_fk
        FOREIGN KEY (superseded_by_id, engagement_id)
        REFERENCES public.customer_engagement_stages (id, engagement_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- Exactly one CURRENT stage row per Engagement (require_engagement_consistency makes "at least one" true at commit).
CREATE UNIQUE INDEX customer_engagement_stages_current_uq
    ON public.customer_engagement_stages (engagement_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX customer_engagement_stages_history_idx
    ON public.customer_engagement_stages (engagement_id, effective_from);


-- ============================================================
-- 3b. Termination audit trail
--
-- One 'active' row mirrors customer_engagements.ended_at / end_reason_code for an ended Engagement; every earlier recording
-- is kept as a frozen 'corrected' row pointing at its replacement. The canonical columns stay the authoritative truth; this
-- table is the structural guarantee that they can never change without leaving a trail.
-- ============================================================

CREATE TABLE public.customer_engagement_terminations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    engagement_id uuid NOT NULL
        REFERENCES public.customer_engagements (id)
        ON DELETE RESTRICT,

    ended_at timestamptz NOT NULL,

    end_reason_code text NOT NULL
        REFERENCES public.engagement_end_reasons (code)
        ON DELETE RESTRICT,

    change_reason text NOT NULL,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT customer_engagement_terminations_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CORRECTION')),

    CONSTRAINT customer_engagement_terminations_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT customer_engagement_terminations_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
        ),

    CONSTRAINT customer_engagement_terminations_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT customer_engagement_terminations_id_engagement_uq
        UNIQUE (id, engagement_id),

    CONSTRAINT customer_engagement_terminations_superseded_by_fk
        FOREIGN KEY (superseded_by_id, engagement_id)
        REFERENCES public.customer_engagement_terminations (id, engagement_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one recorded termination is current for an Engagement (the consistency trigger requires exactly one once ended).
CREATE UNIQUE INDEX customer_engagement_terminations_current_uq
    ON public.customer_engagement_terminations (engagement_id)
    WHERE record_status = 'active';

CREATE INDEX customer_engagement_terminations_history_idx
    ON public.customer_engagement_terminations (engagement_id, created_at);


-- ============================================================
-- 4. Agreements (stable identity + versions)
--
-- No document binaries, credentials, payment details, prices or invoicing. Evidence/document linkage is deliberately
-- absent: it belongs to the future Evidence foundation and will arrive as a nullable additive column.
-- ============================================================

CREATE TABLE public.customer_agreements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    customer_id uuid NOT NULL
        REFERENCES public.customers (id)
        ON DELETE RESTRICT,

    record_status text NOT NULL DEFAULT 'active',
    archived_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT customer_agreements_record_status_valid
        CHECK (record_status IN ('active', 'archived')),

    CONSTRAINT customer_agreements_archive_state_consistent
        CHECK (
            (record_status = 'archived' AND archived_at IS NOT NULL)
            OR
            (record_status = 'active' AND archived_at IS NULL)
        )
);

CREATE INDEX customer_agreements_customer_idx
    ON public.customer_agreements (customer_id);

CREATE TABLE public.customer_agreement_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    agreement_id uuid NOT NULL
        REFERENCES public.customer_agreements (id)
        ON DELETE RESTRICT,

    -- The Customer's own reference for the agreement (for example a contract number). Not unique: it is not an identity.
    agreement_reference text,
    signed_on date,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT customer_agreement_versions_reference_shape
        CHECK (agreement_reference IS NULL OR (btrim(agreement_reference) <> '' AND char_length(agreement_reference) <= 100)),

    CONSTRAINT customer_agreement_versions_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'AMENDMENT', 'CORRECTION')),

    CONSTRAINT customer_agreement_versions_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT customer_agreement_versions_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT customer_agreement_versions_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT customer_agreement_versions_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT customer_agreement_versions_id_agreement_uq
        UNIQUE (id, agreement_id),

    CONSTRAINT customer_agreement_versions_superseded_by_fk
        FOREIGN KEY (superseded_by_id, agreement_id)
        REFERENCES public.customer_agreement_versions (id, agreement_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX customer_agreement_versions_current_uq
    ON public.customer_agreement_versions (agreement_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX customer_agreement_versions_history_idx
    ON public.customer_agreement_versions (agreement_id, effective_from);


-- ============================================================
-- 5. Service scope
-- ============================================================

CREATE TABLE public.engagement_service_scopes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    engagement_id uuid NOT NULL
        REFERENCES public.customer_engagements (id)
        ON DELETE RESTRICT,

    product_level_code text NOT NULL
        REFERENCES public.product_levels (code)
        ON DELETE RESTRICT,

    -- NULL means the whole product level. When present it must belong to product_level_code.
    service_code text,

    -- Optional: the agreement that covers this scope (must belong to the Engagement's Customer; checked by trigger).
    agreement_id uuid
        REFERENCES public.customer_agreements (id)
        ON DELETE RESTRICT,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT engagement_service_scopes_service_fk
        FOREIGN KEY (service_code, product_level_code)
        REFERENCES public.service_catalogue (code, product_level_code)
        ON DELETE RESTRICT,

    CONSTRAINT engagement_service_scopes_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT engagement_service_scopes_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT engagement_service_scopes_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT engagement_service_scopes_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT engagement_service_scopes_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT engagement_service_scopes_id_engagement_uq
        UNIQUE (id, engagement_id),

    CONSTRAINT engagement_service_scopes_superseded_by_fk
        FOREIGN KEY (superseded_by_id, engagement_id)
        REFERENCES public.engagement_service_scopes (id, engagement_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- One current scope per Engagement + product level + service. (The trigger additionally forbids overlap in history and a
-- whole-level scope overlapping a specific service of the same level.)
CREATE UNIQUE INDEX engagement_service_scopes_current_uq
    ON public.engagement_service_scopes (engagement_id, product_level_code, COALESCE(service_code, ''))
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX engagement_service_scopes_history_idx
    ON public.engagement_service_scopes (engagement_id, effective_from);

CREATE INDEX engagement_service_scopes_agreement_idx
    ON public.engagement_service_scopes (agreement_id)
    WHERE agreement_id IS NOT NULL;


-- ============================================================
-- 6. TES responsibility windows
--
-- "From when, until when, did TES actually hold operational responsibility for this scope". It is bounded by its scope and
-- therefore by its Engagement, so TES can never be implied responsible for a period before it took over. No responsible
-- person or account manager is recorded: that reference is not canonically defined, and a Contact is not an HR record.
-- ============================================================

CREATE TABLE public.engagement_responsibility_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    engagement_id uuid NOT NULL
        REFERENCES public.customer_engagements (id)
        ON DELETE RESTRICT,

    scope_id uuid NOT NULL,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT engagement_responsibility_periods_scope_fk
        FOREIGN KEY (scope_id, engagement_id)
        REFERENCES public.engagement_service_scopes (id, engagement_id)
        ON DELETE RESTRICT,

    CONSTRAINT engagement_responsibility_periods_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT engagement_responsibility_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT engagement_responsibility_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT engagement_responsibility_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT engagement_responsibility_periods_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT engagement_responsibility_periods_id_engagement_uq
        UNIQUE (id, engagement_id),

    CONSTRAINT engagement_responsibility_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_id, engagement_id)
        REFERENCES public.engagement_responsibility_periods (id, engagement_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX engagement_responsibility_periods_current_uq
    ON public.engagement_responsibility_periods (scope_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX engagement_responsibility_periods_history_idx
    ON public.engagement_responsibility_periods (scope_id, effective_from);

CREATE INDEX engagement_responsibility_periods_engagement_idx
    ON public.engagement_responsibility_periods (engagement_id);


-- ============================================================
-- 7. Integrity trigger functions
--
-- SECURITY INVOKER with a fixed search_path; none is executable by PUBLIC. Written on the single-line "AS $$ [DECLARE ...]
-- BEGIN" form so the migration runner's transaction-control check accepts them.
-- ============================================================

-- No hard delete or truncate of Customer Relationship history, ever.
CREATE FUNCTION tes_security.prevent_customer_relationship_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Customer relationship data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- A new Engagement needs an engagement type, an ACTIVE Organization, and must not overlap another Engagement of the same
-- Customer. Customers rows are immutable and the runtime role cannot row-lock them, so concurrent inserts for one Customer
-- are serialized with a transaction-scoped advisory lock keyed by the Customer (the server also locks the Organization).
CREATE FUNCTION tes_security.guard_engagement_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE v_status text; BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('customer_engagements:' || NEW.customer_id::text, 0));

    SELECT o.status
      INTO v_status
      FROM public.customers AS c
      JOIN public.organizations AS o ON o.id = c.organization_id
     WHERE c.id = NEW.customer_id;

    IF v_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'An Engagement needs an active Organization'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'customer_engagements_organization_active';
    END IF;

    IF NEW.engagement_type IS NULL THEN
        RAISE EXCEPTION 'An Engagement needs an engagement type'
            USING ERRCODE = '23502',
                  CONSTRAINT = 'customer_engagements_engagement_type_required';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.customer_engagements AS e
         WHERE e.customer_id = NEW.customer_id
           AND e.id <> NEW.id
           AND e.started_at < COALESCE(NEW.ended_at, 'infinity'::timestamptz)
           AND (e.ended_at IS NULL OR e.ended_at > NEW.started_at)
    ) THEN
        RAISE EXCEPTION 'Engagements of one Customer cannot overlap'
            USING ERRCODE = '23P01',
                  CONSTRAINT = 'customer_engagements_no_overlap';
    END IF;

    RETURN NEW;
END;
$$;

-- Engagement identity, start and type are immutable. An ended Engagement is never reopened: ended_at and end_reason_code can
-- change from one value to another (a CORRECTION - the deferred consistency trigger requires the audit row in
-- customer_engagement_terminations in the same transaction) but never back to NULL.
CREATE FUNCTION tes_security.guard_engagement_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.engagement_type IS DISTINCT FROM OLD.engagement_type
    THEN
        RAISE EXCEPTION 'Engagement identity, start and type are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.ended_at IS NOT NULL AND (NEW.ended_at IS NULL OR NEW.end_reason_code IS NULL) THEN
        RAISE EXCEPTION 'An ended Engagement cannot be reopened; correct its termination or establish a new Engagement'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'customer_engagements_ended_is_final';
    END IF;

    RETURN NEW;
END;
$$;

-- One generic guard for the effective-dated child tables (stages, scopes, responsibility, agreement versions). The
-- lifecycle columns share names on all of them, so: content (everything else) is immutable, a corrected / voided row is
-- frozen, an ended row cannot be re-dated, and a correction or void never ends a row.
CREATE FUNCTION tes_security.guard_engagement_child_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status <> 'active' THEN
        RAISE EXCEPTION 'A corrected or voided record is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF (to_jsonb(NEW) - ARRAY['effective_to', 'record_status', 'corrected_at', 'superseded_by_id', 'updated_at']::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['effective_to', 'record_status', 'corrected_at', 'superseded_by_id', 'updated_at']::text[])
    THEN
        RAISE EXCEPTION 'Record content is immutable; record a change, a correction or a void instead'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended record cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status <> 'active' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction or void does not end a record; it must not set effective_to'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A stage row: created active, a catalogue stage, planned_end_at exactly when the stage is bounded, a terminal stage only
-- as the open row, inside the Engagement, and never overlapping another active stage row. The Engagement row is locked
-- first so every writer of one Engagement serializes (this is what makes the overlap check race-proof).
CREATE FUNCTION tes_security.guard_engagement_stage_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE v_started timestamptz; v_ended timestamptz; v_bounded boolean; v_terminal boolean; v_available boolean; BEGIN
    SELECT e.started_at, e.ended_at
      INTO v_started, v_ended
      FROM public.customer_engagements AS e
     WHERE e.id = NEW.engagement_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The Engagement does not exist'
            USING ERRCODE = '23503',
                  CONSTRAINT = 'customer_engagement_stages_engagement_exists';
    END IF;

    IF NEW.record_status <> 'active' THEN
        RAISE EXCEPTION 'Stage rows are created active'
            USING ERRCODE = '55000';
    END IF;

    SELECT t.is_bounded, t.is_terminal, t.is_active
      INTO v_bounded, v_terminal, v_available
      FROM public.engagement_stage_types AS t
     WHERE t.code = NEW.stage_code;

    IF NOT FOUND OR NOT v_available THEN
        RAISE EXCEPTION 'The stage is unknown or not available'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_engagement_stages_stage_rules';
    END IF;

    IF v_bounded IS DISTINCT FROM (NEW.planned_end_at IS NOT NULL) THEN
        RAISE EXCEPTION 'A bounded stage needs planned_end_at; other stages must not have one'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_engagement_stages_stage_rules';
    END IF;

    IF v_terminal AND NEW.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'The ended stage is terminal and cannot itself end'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_engagement_stages_stage_rules';
    END IF;

    IF NEW.effective_from < v_started THEN
        RAISE EXCEPTION 'A stage cannot start before its Engagement'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_engagement_stages_engagement_window';
    END IF;

    IF v_ended IS NOT NULL THEN
        IF v_terminal THEN
            IF NEW.effective_from <> v_ended THEN
                RAISE EXCEPTION 'The ended stage must start exactly when the Engagement ended'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'customer_engagement_stages_engagement_window';
            END IF;
        ELSIF NEW.effective_to IS NULL OR NEW.effective_to > v_ended THEN
            RAISE EXCEPTION 'A stage cannot continue past the end of its Engagement'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'customer_engagement_stages_engagement_window';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.customer_engagement_stages AS s
         WHERE s.engagement_id = NEW.engagement_id
           AND s.record_status = 'active'
           AND s.id <> NEW.id
           AND s.effective_from < COALESCE(NEW.effective_to, 'infinity'::timestamptz)
           AND COALESCE(s.effective_to, 'infinity'::timestamptz) > NEW.effective_from
    ) THEN
        RAISE EXCEPTION 'Stage periods of one Engagement cannot overlap'
            USING ERRCODE = '23P01',
                  CONSTRAINT = 'customer_engagement_stages_no_overlap';
    END IF;

    RETURN NEW;
END;
$$;

-- A scope row: created active, inside the Engagement, a catalogue product level / service, an agreement of the same
-- Customer, and never overlapping another active scope of the same Engagement + product level where either covers the
-- whole level or both name the same service.
CREATE FUNCTION tes_security.guard_engagement_scope_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE v_customer uuid; v_started timestamptz; v_ended timestamptz; v_level_available boolean; v_service_available boolean; v_agreement_customer uuid; v_agreement_status text; BEGIN
    SELECT e.customer_id, e.started_at, e.ended_at
      INTO v_customer, v_started, v_ended
      FROM public.customer_engagements AS e
     WHERE e.id = NEW.engagement_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The Engagement does not exist'
            USING ERRCODE = '23503',
                  CONSTRAINT = 'engagement_service_scopes_engagement_exists';
    END IF;

    IF NEW.record_status <> 'active' THEN
        RAISE EXCEPTION 'Scope rows are created active'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.effective_from < v_started OR (v_ended IS NOT NULL AND (NEW.effective_from >= v_ended OR NEW.effective_to IS NULL OR NEW.effective_to > v_ended)) THEN
        RAISE EXCEPTION 'A scope must fall inside its Engagement'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'engagement_service_scopes_engagement_window';
    END IF;

    SELECT p.is_active INTO v_level_available FROM public.product_levels AS p WHERE p.code = NEW.product_level_code;
    IF NOT FOUND OR NOT v_level_available THEN
        RAISE EXCEPTION 'The product level is unknown or not available'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'engagement_service_scopes_catalogue_rules';
    END IF;

    IF NEW.service_code IS NOT NULL THEN
        SELECT s.is_active INTO v_service_available FROM public.service_catalogue AS s WHERE s.code = NEW.service_code;
        IF NOT FOUND OR NOT v_service_available THEN
            RAISE EXCEPTION 'The service is unknown or not available'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'engagement_service_scopes_catalogue_rules';
        END IF;
    END IF;

    IF NEW.agreement_id IS NOT NULL THEN
        SELECT a.customer_id, a.record_status
          INTO v_agreement_customer, v_agreement_status
          FROM public.customer_agreements AS a
         WHERE a.id = NEW.agreement_id
           FOR SHARE;

        IF NOT FOUND OR v_agreement_customer <> v_customer OR v_agreement_status <> 'active' THEN
            RAISE EXCEPTION 'The agreement must be an active agreement of the Engagement''s Customer'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'engagement_service_scopes_agreement_rules';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.engagement_service_scopes AS s
         WHERE s.engagement_id = NEW.engagement_id
           AND s.record_status = 'active'
           AND s.id <> NEW.id
           AND s.product_level_code = NEW.product_level_code
           AND (s.service_code IS NULL OR NEW.service_code IS NULL OR s.service_code = NEW.service_code)
           AND s.effective_from < COALESCE(NEW.effective_to, 'infinity'::timestamptz)
           AND COALESCE(s.effective_to, 'infinity'::timestamptz) > NEW.effective_from
    ) THEN
        RAISE EXCEPTION 'Scopes of one Engagement cannot overlap for the same product level and service'
            USING ERRCODE = '23P01',
                  CONSTRAINT = 'engagement_service_scopes_no_overlap';
    END IF;

    RETURN NEW;
END;
$$;

-- A scope cannot end before, or be corrected / voided under, a responsibility window that depends on it.
CREATE FUNCTION tes_security.guard_engagement_scope_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    PERFORM 1
       FROM public.customer_engagements AS e
      WHERE e.id = NEW.engagement_id
        FOR NO KEY UPDATE;

    IF OLD.record_status = 'active' AND NEW.record_status <> 'active' AND EXISTS (
        SELECT 1
          FROM public.engagement_responsibility_periods AS r
         WHERE r.scope_id = NEW.id
           AND r.record_status = 'active'
    ) THEN
        RAISE EXCEPTION 'A scope with responsibility windows cannot be corrected or voided; correct or void those first'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'engagement_service_scopes_dependents_block_change';
    END IF;

    IF OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.engagement_responsibility_periods AS r
         WHERE r.scope_id = NEW.id
           AND r.record_status = 'active'
           AND (r.effective_to IS NULL OR r.effective_to > NEW.effective_to)
    ) THEN
        RAISE EXCEPTION 'A scope cannot end while a responsibility window outlives it'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'engagement_service_scopes_dependents_block_end';
    END IF;

    RETURN NEW;
END;
$$;

-- A responsibility window: created active, on an ACTIVE scope of the same Engagement, inside both the scope and the
-- Engagement, and never overlapping another active window of the same scope.
CREATE FUNCTION tes_security.guard_engagement_responsibility_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE v_started timestamptz; v_ended timestamptz; v_scope_from timestamptz; v_scope_to timestamptz; v_scope_status text; BEGIN
    SELECT e.started_at, e.ended_at
      INTO v_started, v_ended
      FROM public.customer_engagements AS e
     WHERE e.id = NEW.engagement_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The Engagement does not exist'
            USING ERRCODE = '23503',
                  CONSTRAINT = 'engagement_responsibility_periods_engagement_exists';
    END IF;

    IF NEW.record_status <> 'active' THEN
        RAISE EXCEPTION 'Responsibility rows are created active'
            USING ERRCODE = '55000';
    END IF;

    SELECT s.effective_from, s.effective_to, s.record_status
      INTO v_scope_from, v_scope_to, v_scope_status
      FROM public.engagement_service_scopes AS s
     WHERE s.id = NEW.scope_id
       AND s.engagement_id = NEW.engagement_id
       FOR SHARE;

    IF NOT FOUND OR v_scope_status <> 'active' THEN
        RAISE EXCEPTION 'Responsibility needs an active scope of the same Engagement'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'engagement_responsibility_periods_scope_window';
    END IF;

    IF NEW.effective_from < v_scope_from
       OR (v_scope_to IS NOT NULL AND (NEW.effective_to IS NULL OR NEW.effective_to > v_scope_to))
       OR NEW.effective_from < v_started
       OR (v_ended IS NOT NULL AND (NEW.effective_from >= v_ended OR NEW.effective_to IS NULL OR NEW.effective_to > v_ended))
    THEN
        RAISE EXCEPTION 'Responsibility must fall inside its scope and its Engagement'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'engagement_responsibility_periods_scope_window';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.engagement_responsibility_periods AS r
         WHERE r.scope_id = NEW.scope_id
           AND r.record_status = 'active'
           AND r.id <> NEW.id
           AND r.effective_from < COALESCE(NEW.effective_to, 'infinity'::timestamptz)
           AND COALESCE(r.effective_to, 'infinity'::timestamptz) > NEW.effective_from
    ) THEN
        RAISE EXCEPTION 'Responsibility windows of one scope cannot overlap'
            USING ERRCODE = '23P01',
                  CONSTRAINT = 'engagement_responsibility_periods_no_overlap';
    END IF;

    RETURN NEW;
END;
$$;

-- Agreement identity is immutable; an agreement with a CURRENT version cannot be archived (end the version first).
CREATE FUNCTION tes_security.guard_customer_agreement_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Agreement identity is immutable; only the record lifecycle can change'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'archived' AND OLD.record_status = 'active' AND EXISTS (
        SELECT 1
          FROM public.customer_agreement_versions AS v
         WHERE v.agreement_id = NEW.id
           AND v.record_status = 'active'
           AND v.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'An agreement with a current version cannot be archived'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'customer_agreements_archive_requires_no_current_version';
    END IF;

    RETURN NEW;
END;
$$;

-- An agreement version belongs to an ACTIVE agreement (locked, so archive and insert cannot both succeed), is created
-- active, and never overlaps another active version of the same agreement.
CREATE FUNCTION tes_security.guard_customer_agreement_version_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE v_status text; BEGIN
    SELECT a.record_status
      INTO v_status
      FROM public.customer_agreements AS a
     WHERE a.id = NEW.agreement_id
       FOR NO KEY UPDATE;

    IF v_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'An agreement version must belong to an active agreement'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'customer_agreement_versions_agreement_active';
    END IF;

    IF NEW.record_status <> 'active' THEN
        RAISE EXCEPTION 'Agreement version rows are created active'
            USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.customer_agreement_versions AS v
         WHERE v.agreement_id = NEW.agreement_id
           AND v.record_status = 'active'
           AND v.id <> NEW.id
           AND v.effective_from < COALESCE(NEW.effective_to, 'infinity'::timestamptz)
           AND COALESCE(v.effective_to, 'infinity'::timestamptz) > NEW.effective_from
    ) THEN
        RAISE EXCEPTION 'Versions of one agreement cannot overlap'
            USING ERRCODE = '23P01',
                  CONSTRAINT = 'customer_agreement_versions_no_overlap';
    END IF;

    RETURN NEW;
END;
$$;

-- A termination audit row: created active, on an ended-or-ending Engagement (locked, so recordings serialize), after the
-- Engagement began.
CREATE FUNCTION tes_security.guard_engagement_termination_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE v_started timestamptz; BEGIN
    SELECT e.started_at
      INTO v_started
      FROM public.customer_engagements AS e
     WHERE e.id = NEW.engagement_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The Engagement does not exist'
            USING ERRCODE = '23503',
                  CONSTRAINT = 'customer_engagement_terminations_engagement_exists';
    END IF;

    IF NEW.record_status <> 'active' THEN
        RAISE EXCEPTION 'Termination rows are created active'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.ended_at <= v_started THEN
        RAISE EXCEPTION 'An Engagement cannot end before it began'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_engagement_terminations_after_start';
    END IF;

    RETURN NEW;
END;
$$;

-- A termination audit row is immutable. The only change it ever undergoes is being superseded by a correction.
CREATE FUNCTION tes_security.guard_engagement_termination_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status <> 'active' THEN
        RAISE EXCEPTION 'A corrected termination record is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF (to_jsonb(NEW) - ARRAY['record_status', 'corrected_at', 'superseded_by_id', 'updated_at']::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['record_status', 'corrected_at', 'superseded_by_id', 'updated_at']::text[])
    THEN
        RAISE EXCEPTION 'Termination record content is immutable; record a correction instead'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status <> 'corrected' THEN
        RAISE EXCEPTION 'A termination record can only be superseded by a correction'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Deferred, at commit: the Engagement, its stage history and its dependents agree with each other, and the ENDED stage is
-- exactly the projection of customer_engagements.ended_at (see the header). Fires for every touched Engagement, stage,
-- scope and responsibility row.
CREATE FUNCTION tes_security.require_engagement_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE v_engagement uuid; v_started timestamptz; v_ended timestamptz; v_type text; v_reason text; v_stage text; v_terminal boolean; v_stage_from timestamptz; BEGIN
    v_engagement := (CASE WHEN TG_TABLE_NAME = 'customer_engagements' THEN to_jsonb(NEW) ->> 'id' ELSE to_jsonb(NEW) ->> 'engagement_id' END)::uuid;

    SELECT e.started_at, e.ended_at, e.engagement_type, e.end_reason_code
      INTO v_started, v_ended, v_type, v_reason
      FROM public.customer_engagements AS e
     WHERE e.id = v_engagement;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_type IS NULL THEN
        RAISE EXCEPTION 'An Engagement needs an engagement type'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_engagements_engagement_type_required';
    END IF;

    SELECT s.stage_code, t.is_terminal, s.effective_from
      INTO v_stage, v_terminal, v_stage_from
      FROM public.customer_engagement_stages AS s
      JOIN public.engagement_stage_types AS t ON t.code = s.stage_code
     WHERE s.engagement_id = v_engagement
       AND s.record_status = 'active'
       AND s.effective_to IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'An Engagement must have exactly one current stage'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'engagement_consistency_current_stage';
    END IF;

    IF (SELECT min(s.effective_from) FROM public.customer_engagement_stages AS s WHERE s.engagement_id = v_engagement AND s.record_status = 'active') <> v_started THEN
        RAISE EXCEPTION 'Stage history must begin when the Engagement began'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'engagement_consistency_stage_history';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.customer_engagement_stages AS s
         WHERE s.engagement_id = v_engagement
           AND s.record_status = 'active'
           AND s.effective_to IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
                 FROM public.customer_engagement_stages AS n
                WHERE n.engagement_id = s.engagement_id
                  AND n.record_status = 'active'
                  AND n.effective_from = s.effective_to
           )
    ) THEN
        RAISE EXCEPTION 'Stage history must be continuous'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'engagement_consistency_stage_history';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.customer_engagement_stages AS s
          JOIN public.engagement_stage_types AS t ON t.code = s.stage_code
         WHERE s.engagement_id = v_engagement
           AND s.record_status = 'active'
           AND t.is_terminal
           AND s.effective_to IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'The ended stage cannot itself end'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'engagement_consistency_termination';
    END IF;

    IF v_ended IS NULL THEN
        IF v_terminal THEN
            RAISE EXCEPTION 'An open Engagement cannot be in the ended stage'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'engagement_consistency_termination';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM public.customer_engagement_terminations AS t
             WHERE t.engagement_id = v_engagement
               AND t.record_status = 'active'
        ) THEN
            RAISE EXCEPTION 'An open Engagement cannot carry a termination record'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'engagement_consistency_termination_record';
        END IF;
    ELSE
        IF NOT v_terminal OR v_stage_from <> v_ended THEN
            RAISE EXCEPTION 'An ended Engagement must be in the ended stage, starting exactly when it ended'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'engagement_consistency_termination';
        END IF;

        IF (SELECT count(*)
              FROM public.customer_engagement_terminations AS t
             WHERE t.engagement_id = v_engagement
               AND t.record_status = 'active') <> 1
           OR NOT EXISTS (
               SELECT 1
                 FROM public.customer_engagement_terminations AS t
                WHERE t.engagement_id = v_engagement
                  AND t.record_status = 'active'
                  AND t.ended_at = v_ended
                  AND t.end_reason_code = v_reason
           )
        THEN
            RAISE EXCEPTION 'The termination record must mirror the Engagement''s ended_at and end reason'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'engagement_consistency_termination_record';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM public.engagement_service_scopes AS s
             WHERE s.engagement_id = v_engagement
               AND s.record_status = 'active'
               AND (s.effective_from >= v_ended OR s.effective_to IS NULL OR s.effective_to > v_ended)
        ) OR EXISTS (
            SELECT 1
              FROM public.engagement_responsibility_periods AS r
             WHERE r.engagement_id = v_engagement
               AND r.record_status = 'active'
               AND (r.effective_from >= v_ended OR r.effective_to IS NULL OR r.effective_to > v_ended)
        ) THEN
            RAISE EXCEPTION 'Nothing may continue past the end of its Engagement'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'engagement_consistency_dependents';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

-- Deferred, at commit: an agreement always has at least one genuine version.
CREATE FUNCTION tes_security.require_customer_agreement_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.customer_agreement_versions AS v
         WHERE v.agreement_id = (CASE WHEN TG_TABLE_NAME = 'customer_agreements' THEN to_jsonb(NEW) ->> 'id' ELSE to_jsonb(NEW) ->> 'agreement_id' END)::uuid
           AND v.record_status = 'active'
    ) THEN
        RAISE EXCEPTION 'An agreement must have at least one version'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_agreements_require_version';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_customer_relationship_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_child_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_stage_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_termination_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_termination_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_scope_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_scope_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_engagement_responsibility_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_customer_agreement_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_customer_agreement_version_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_engagement_consistency() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_customer_agreement_version() FROM PUBLIC;


-- ============================================================
-- 8. Triggers
-- ============================================================

CREATE TRIGGER customer_engagements_guard_insert
BEFORE INSERT ON public.customer_engagements
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_insert();

CREATE TRIGGER customer_engagements_guard_update
BEFORE UPDATE ON public.customer_engagements
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_update();

CREATE CONSTRAINT TRIGGER customer_engagements_require_consistency
AFTER INSERT OR UPDATE ON public.customer_engagements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_engagement_consistency();

CREATE TRIGGER customer_engagement_stages_guard_insert
BEFORE INSERT ON public.customer_engagement_stages
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_stage_insert();

CREATE TRIGGER customer_engagement_stages_guard_update
BEFORE UPDATE ON public.customer_engagement_stages
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_child_update();

CREATE CONSTRAINT TRIGGER customer_engagement_stages_require_consistency
AFTER INSERT OR UPDATE ON public.customer_engagement_stages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_engagement_consistency();

CREATE TRIGGER customer_engagement_terminations_guard_insert
BEFORE INSERT ON public.customer_engagement_terminations
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_termination_insert();

CREATE TRIGGER customer_engagement_terminations_guard_update
BEFORE UPDATE ON public.customer_engagement_terminations
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_termination_update();

CREATE CONSTRAINT TRIGGER customer_engagement_terminations_require_consistency
AFTER INSERT OR UPDATE ON public.customer_engagement_terminations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_engagement_consistency();

CREATE TRIGGER engagement_service_scopes_guard_insert
BEFORE INSERT ON public.engagement_service_scopes
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_scope_insert();

CREATE TRIGGER engagement_service_scopes_guard_update
BEFORE UPDATE ON public.engagement_service_scopes
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_child_update();

CREATE TRIGGER engagement_service_scopes_guard_dependents
BEFORE UPDATE ON public.engagement_service_scopes
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_scope_update();

CREATE CONSTRAINT TRIGGER engagement_service_scopes_require_consistency
AFTER INSERT OR UPDATE ON public.engagement_service_scopes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_engagement_consistency();

CREATE TRIGGER engagement_responsibility_periods_guard_insert
BEFORE INSERT ON public.engagement_responsibility_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_responsibility_insert();

CREATE TRIGGER engagement_responsibility_periods_guard_update
BEFORE UPDATE ON public.engagement_responsibility_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_child_update();

CREATE CONSTRAINT TRIGGER engagement_responsibility_periods_require_consistency
AFTER INSERT OR UPDATE ON public.engagement_responsibility_periods
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_engagement_consistency();

CREATE TRIGGER customer_agreements_guard_update
BEFORE UPDATE ON public.customer_agreements
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_customer_agreement_update();

CREATE CONSTRAINT TRIGGER customer_agreements_require_version
AFTER INSERT ON public.customer_agreements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_customer_agreement_version();

CREATE TRIGGER customer_agreement_versions_guard_insert
BEFORE INSERT ON public.customer_agreement_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_customer_agreement_version_insert();

CREATE TRIGGER customer_agreement_versions_guard_update
BEFORE UPDATE ON public.customer_agreement_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_engagement_child_update();

CREATE CONSTRAINT TRIGGER customer_agreement_versions_require_version
AFTER INSERT OR UPDATE ON public.customer_agreement_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_customer_agreement_version();

CREATE TRIGGER customer_engagement_stages_no_delete
BEFORE DELETE ON public.customer_engagement_stages
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER customer_engagement_terminations_no_delete
BEFORE DELETE ON public.customer_engagement_terminations
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER engagement_service_scopes_no_delete
BEFORE DELETE ON public.engagement_service_scopes
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER engagement_responsibility_periods_no_delete
BEFORE DELETE ON public.engagement_responsibility_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER customer_agreements_no_delete
BEFORE DELETE ON public.customer_agreements
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER customer_agreement_versions_no_delete
BEFORE DELETE ON public.customer_agreement_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER customer_engagement_stages_no_truncate
BEFORE TRUNCATE ON public.customer_engagement_stages
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER customer_engagement_terminations_no_truncate
BEFORE TRUNCATE ON public.customer_engagement_terminations
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER engagement_service_scopes_no_truncate
BEFORE TRUNCATE ON public.engagement_service_scopes
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER engagement_responsibility_periods_no_truncate
BEFORE TRUNCATE ON public.engagement_responsibility_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER customer_agreements_no_truncate
BEFORE TRUNCATE ON public.customer_agreements
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();

CREATE TRIGGER customer_agreement_versions_no_truncate
BEFORE TRUNCATE ON public.customer_agreement_versions
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_customer_relationship_removal();


-- ============================================================
-- 9. Capabilities (catalogue rows only; nothing is granted)
--
-- CUSTOMER_ESTABLISH (0011) is unchanged: it establishes / re-engages a Customer relationship and begins an Engagement.
-- Both new capabilities are SYSTEM-only: this is an internal TES foundation and no CUSTOMER-facing read exists. This
-- migration creates no relationship, assignment or grant.
-- ============================================================

INSERT INTO public.capabilities (code, display_name, description, is_active, sort_order)
VALUES
    (
        'CUSTOMER_RELATIONSHIP_READ',
        'Read Customer Relationship',
        'SYSTEM-wide read access to Customer relationship state: Customers, Engagements, their stage history, service scope, TES responsibility windows and agreements. Intended scope: SYSTEM only.',
        true,
        90
    ),
    (
        'CUSTOMER_RELATIONSHIP_MANAGE',
        'Manage Customer Relationship',
        'Manage an already-established Customer relationship: change and correct Engagement stages, end an Engagement, maintain service scope, TES responsibility windows and agreements. Does not establish a Customer (CUSTOMER_ESTABLISH). Intended scope: SYSTEM only.',
        true,
        100
    );


-- ============================================================
-- 10. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is deliberate and object-specific. The runtime
-- identity gets no DELETE and no TRUNCATE, may not rewrite content or identity, and has read-only access to the
-- catalogues (changed only by migrations). Existing grants on customers / customer_engagements (0003) are unchanged
-- except that engagement_type may be supplied when an Engagement is created.
-- ============================================================

REVOKE ALL
ON TABLE
    public.engagement_types,
    public.engagement_stage_types,
    public.product_levels,
    public.service_catalogue,
    public.engagement_end_reasons,
    public.customer_engagement_stages,
    public.customer_engagement_terminations,
    public.engagement_service_scopes,
    public.engagement_responsibility_periods,
    public.customer_agreements,
    public.customer_agreement_versions
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.engagement_types,
    public.engagement_stage_types,
    public.product_levels,
    public.service_catalogue,
    public.engagement_end_reasons,
    public.customer_engagement_stages,
    public.customer_engagement_terminations,
    public.engagement_service_scopes,
    public.engagement_responsibility_periods,
    public.customer_agreements,
    public.customer_agreement_versions
TO "tes-backend@tes-production-510007.iam";

-- The retired free-text end_reason can no longer be written by the runtime role (a CHECK also keeps it NULL). The structural
-- end_reason_code may be supplied when an Engagement is created and changed when it is ended or its termination corrected.
REVOKE INSERT (end_reason), UPDATE (end_reason)
ON public.customer_engagements
FROM "tes-backend@tes-production-510007.iam";

GRANT INSERT (engagement_type, end_reason_code)
ON public.customer_engagements
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (end_reason_code)
ON public.customer_engagements
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, engagement_id, ended_at, end_reason_code, change_reason)
ON public.customer_engagement_terminations
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, corrected_at, superseded_by_id, updated_at)
ON public.customer_engagement_terminations
TO "tes-backend@tes-production-510007.iam";

-- id is insertable so a correction can name its replacement before creating it; effective_to is insertable so a
-- correction of an already-ended row can carry the same closed window.
GRANT INSERT (id, engagement_id, stage_code, planned_end_at, change_reason, effective_from, effective_to)
ON public.customer_engagement_stages
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.customer_engagement_stages
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, engagement_id, product_level_code, service_code, agreement_id, change_reason, effective_from, effective_to)
ON public.engagement_service_scopes
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.engagement_service_scopes
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, engagement_id, scope_id, change_reason, effective_from, effective_to)
ON public.engagement_responsibility_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.engagement_responsibility_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, customer_id)
ON public.customer_agreements
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, archived_at, updated_at)
ON public.customer_agreements
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, agreement_id, agreement_reference, signed_on, change_reason, effective_from, effective_to)
ON public.customer_agreement_versions
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.customer_agreement_versions
TO "tes-backend@tes-production-510007.iam";
