-- TES Contacts: restricted person identity details and audited operational-email exclusions
-- Migration: 0035
--
-- Scope (additive only; migrations 0001-0034 are not edited, no existing row is read, rewritten or removed):
--   1. capabilities PERSON_IDENTITY_READ and PERSON_IDENTITY_MANAGE           (SYSTEM only)
--   2. public.person_birth_dates                                              restricted date of birth of a Person, with correction history
--   3. public.organization_person_operational_email_exclusions                effective-dated, audited "do not copy this contact on operational email"
--      (plus one additive unique index on evidence_documents(id, organization_id) so evidence can be tied to the same company by foreign key)
--   4. integrity triggers, row-level security policies and column-level runtime grants for the new tables
--
-- WHY A DATE OF BIRTH TABLE. Migration 0014 deliberately kept date of birth out of the Contacts tables (a contact is not a Driver) and
-- 0021 modelled the driver LICENCE but never the birth date. The Contacts workspace must be able to record a person's date of birth
-- WITHOUT a browser-local copy and without creating a conflicting second identity record, so it gets its own restricted table keyed by the
-- ONE canonical Person. It is restricted: only an actor holding PERSON_IDENTITY_READ may read it and only PERSON_IDENTITY_MANAGE may write it
-- (neither is implied by CONTACT_MANAGE or PERSON_REGISTRY_READ). A date of birth is a recorded fact, never a verification: nothing here
-- marks an identity verified. A wrong entry is CORRECTED (the wrong row is kept, flagged, and points at its replacement) or VOIDED; a
-- date of birth never "changes", so there is no effective window. Nothing is deleted.
--
-- Driving licence number, jurisdiction, issue/expiry and class are NOT stored here: they reuse public.driver_licences (0021) so a person
-- never has two licence records. Restrictions are intentionally not part of this workflow.
--
-- WHY AN EXCLUSION TABLE. Ending a person's email, ending their company relationship and changing the Primary Contact are different
-- operations from "stop copying this contact on operational email". The canonical model had no place to record the last one, and the
-- resolver (lib/contacts/communication-routing.ts) must not infer it from the others. This table records ONLY the exclusion (the default
-- is inclusion, so there is no INCLUDE row): who instructed it and how, optional supporting evidence, effective dates and the end of the
-- exclusion. It never touches the person, their channels, the relationship or the PRIMARY designation. Billing routing is separate and is
-- not affected. It is a record the resolver reads; it is not an email system and enforces nothing by itself.
--
-- History conventions follow 0014/0033: a real-world change ends the row; a correction marks the wrong row 'corrected' with a deferred
-- same-subject pointer to its replacement; 'voided' is an entry made in error. Frozen once corrected or voided. DELETE and TRUNCATE are
-- refused by trigger. All functions are SECURITY INVOKER with a fixed search_path.

-- ============================================================
-- 1. Capabilities
-- ============================================================

INSERT INTO public.capabilities(code, display_name, description, is_active, sort_order)
VALUES
    (
        'PERSON_IDENTITY_READ',
        'Person identity read',
        'Read restricted person identity details (date of birth and the person''s driving licence record) shown in Contacts. Intended scope: SYSTEM only.',
        true,
        262
    ),
    (
        'PERSON_IDENTITY_MANAGE',
        'Person identity manage',
        'Record and correct restricted person identity details (date of birth and the person''s driving licence record) from Contacts. Intended scope: SYSTEM only.',
        true,
        263
    );

-- ============================================================
-- 2. Person birth dates
-- ============================================================

CREATE TABLE public.person_birth_dates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    person_id uuid NOT NULL
        REFERENCES public.persons(id)
        ON DELETE RESTRICT,

    date_of_birth date NOT NULL,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT person_birth_dates_plausible
        CHECK (date_of_birth >= DATE '1900-01-01'),

    CONSTRAINT person_birth_dates_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT person_birth_dates_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT person_birth_dates_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT person_birth_dates_id_person_uq
        UNIQUE (id, person_id),

    CONSTRAINT person_birth_dates_superseded_by_fk
        FOREIGN KEY (superseded_by_id, person_id)
        REFERENCES public.person_birth_dates (id, person_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one current date of birth per person.
CREATE UNIQUE INDEX person_birth_dates_current_uq
    ON public.person_birth_dates (person_id)
    WHERE record_status = 'active';

CREATE INDEX person_birth_dates_history_idx
    ON public.person_birth_dates (person_id, created_at);

-- ============================================================
-- 3. Operational-email exclusions
-- ============================================================

-- Additive: lets a child row reference a document TOGETHER with its company (the pair is already unique because id is).
CREATE UNIQUE INDEX evidence_documents_id_organization_uq
    ON public.evidence_documents (id, organization_id);

CREATE TABLE public.organization_person_operational_email_exclusions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    person_id uuid NOT NULL,
    relationship_id uuid NOT NULL,

    -- Only OPERATIONAL mail is covered; billing routing is separate and has no exclusion here.
    message_class text NOT NULL DEFAULT 'OPERATIONAL',

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    -- Who instructed it and how, so the instruction is traceable. Free text is a REFERENCE (for example "email from the contact,
    -- 2026-10-19, subject: stop copying me"), never the message body. The actor who recorded it is in the Master Register.
    instruction_source text NOT NULL,
    instruction_reference text NOT NULL,
    instructed_by_person_id uuid
        REFERENCES public.persons(id)
        ON DELETE RESTRICT,
    evidence_document_id uuid,

    change_reason text NOT NULL DEFAULT 'INITIAL',
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT operational_email_exclusions_relationship_fk
        FOREIGN KEY (relationship_id, organization_id, person_id)
        REFERENCES public.organization_person_relationships (id, organization_id, person_id)
        ON DELETE RESTRICT,

    -- Supporting evidence must belong to the SAME company (MATCH SIMPLE: not enforced while no evidence is attached).
    CONSTRAINT operational_email_exclusions_evidence_fk
        FOREIGN KEY (evidence_document_id, organization_id)
        REFERENCES public.evidence_documents (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT operational_email_exclusions_class_valid
        CHECK (message_class = 'OPERATIONAL'),

    CONSTRAINT operational_email_exclusions_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT operational_email_exclusions_source_valid
        CHECK (instruction_source IN ('COMPANY_WRITTEN_REQUEST', 'COMPANY_VERBAL_CONFIRMED', 'TES_DECISION')),

    CONSTRAINT operational_email_exclusions_reference_valid
        CHECK (
            instruction_reference = btrim(instruction_reference)
            AND char_length(instruction_reference) BETWEEN 3 AND 500
            AND instruction_reference !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
        ),

    CONSTRAINT operational_email_exclusions_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CORRECTION')),

    CONSTRAINT operational_email_exclusions_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT operational_email_exclusions_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT operational_email_exclusions_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT operational_email_exclusions_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT operational_email_exclusions_superseded_by_fk
        FOREIGN KEY (superseded_by_id, organization_id)
        REFERENCES public.organization_person_operational_email_exclusions (id, organization_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one current exclusion per relationship.
CREATE UNIQUE INDEX operational_email_exclusions_current_uq
    ON public.organization_person_operational_email_exclusions (relationship_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

-- No two ACTIVE exclusions of the same relationship may overlap in time (half-open ranges allow an exact hand-over; corrected and voided
-- rows are excluded). Requires btree_gist, which migration 0023 creates.
ALTER TABLE public.organization_person_operational_email_exclusions
    ADD CONSTRAINT operational_email_exclusions_no_overlap
    EXCLUDE USING gist (
        relationship_id WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
    )
    WHERE (record_status = 'active');

CREATE INDEX operational_email_exclusions_history_idx
    ON public.organization_person_operational_email_exclusions (organization_id, relationship_id, effective_from);

-- ============================================================
-- 4. Integrity triggers
-- ============================================================

-- A date of birth is never in the future (checked here, not in a CHECK, because it depends on the clock). The person's existence is
-- the foreign key's job; that the person is ACTIVE is checked by the service under the Contacts capability (this trigger runs under
-- the identity capability, which deliberately cannot read the persons table, so it must not depend on reading it).
CREATE FUNCTION tes_security.guard_person_identity_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.date_of_birth > (now() AT TIME ZONE 'UTC')::date THEN
        RAISE EXCEPTION 'A date of birth cannot be in the future'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'person_birth_dates_not_future';
    END IF;

    RETURN NEW;
END;
$$;

-- An exclusion may only be recorded for a relationship that is not voided. (The supporting evidence is tied to the same company by the
-- composite foreign key below, which the database checks regardless of row-level security.)
CREATE FUNCTION tes_security.guard_operational_email_exclusion_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.organization_person_relationships AS r
         WHERE r.id = NEW.relationship_id
           AND r.organization_id = NEW.organization_id
           AND r.person_id = NEW.person_id
           AND r.record_status = 'active'
    ) THEN
        RAISE EXCEPTION 'The relationship is not a current record of this company and person'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'operational_email_exclusions_relationship_active';
    END IF;

    RETURN NEW;
END;
$$;

-- Shared update guard: a corrected or voided row is frozen; content is immutable; an ended row cannot be re-dated; a correction never
-- ends a row. TG_ARGV names the immutable columns.
CREATE FUNCTION tes_security.guard_person_identity_period_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    column_name text;
BEGIN
    IF OLD.record_status <> 'active' THEN
        RAISE EXCEPTION 'A corrected or voided % row is frozen', TG_TABLE_NAME
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION '% content is immutable; record a change or a correction as a new row', TG_TABLE_NAME
            USING ERRCODE = '55000';
    END IF;

    FOREACH column_name IN ARRAY TG_ARGV LOOP
        IF to_jsonb(NEW) -> column_name IS DISTINCT FROM to_jsonb(OLD) -> column_name THEN
            RAISE EXCEPTION '% content is immutable; record a change or a correction as a new row', TG_TABLE_NAME
                USING ERRCODE = '55000';
        END IF;
    END LOOP;

    IF TG_TABLE_NAME = 'organization_person_operational_email_exclusions' THEN
        IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
            RAISE EXCEPTION 'An ended % row cannot be re-dated', TG_TABLE_NAME
                USING ERRCODE = '55000';
        END IF;

        IF NEW.record_status <> 'active' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
            RAISE EXCEPTION 'A correction does not end a % row', TG_TABLE_NAME
                USING ERRCODE = '55000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.prevent_person_identity_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'TES person identity details and contact-routing instructions are append-preserving'
        USING ERRCODE = '23514';
END;
$$;

REVOKE ALL ON FUNCTION tes_security.guard_person_identity_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_operational_email_exclusion_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_person_identity_period_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.prevent_person_identity_removal() FROM PUBLIC;

CREATE TRIGGER person_birth_dates_guard_insert
BEFORE INSERT ON public.person_birth_dates
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_person_identity_insert();

CREATE TRIGGER person_birth_dates_guard_update
BEFORE UPDATE ON public.person_birth_dates
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_person_identity_period_update('person_id', 'date_of_birth', 'created_at');

CREATE TRIGGER person_birth_dates_no_delete
BEFORE DELETE ON public.person_birth_dates
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_person_identity_removal();

CREATE TRIGGER person_birth_dates_no_truncate
BEFORE TRUNCATE ON public.person_birth_dates
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_person_identity_removal();

CREATE TRIGGER operational_email_exclusions_guard_active_organization
BEFORE INSERT ON public.organization_person_operational_email_exclusions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER operational_email_exclusions_guard_insert
BEFORE INSERT ON public.organization_person_operational_email_exclusions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_operational_email_exclusion_insert();

CREATE TRIGGER operational_email_exclusions_guard_update
BEFORE UPDATE ON public.organization_person_operational_email_exclusions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_person_identity_period_update(
    'organization_id', 'person_id', 'relationship_id', 'message_class', 'effective_from',
    'instruction_source', 'instruction_reference', 'instructed_by_person_id', 'evidence_document_id', 'created_at'
);

CREATE TRIGGER operational_email_exclusions_no_delete
BEFORE DELETE ON public.organization_person_operational_email_exclusions
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_person_identity_removal();

CREATE TRIGGER operational_email_exclusions_no_truncate
BEFORE TRUNCATE ON public.organization_person_operational_email_exclusions
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_person_identity_removal();

-- ============================================================
-- 5. Row-level security (SYSTEM only; no CUSTOMER-facing read)
-- ============================================================

ALTER TABLE public.person_birth_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_person_operational_email_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY person_birth_dates_system ON public.person_birth_dates FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['PERSON_IDENTITY_READ', 'PERSON_IDENTITY_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['PERSON_IDENTITY_MANAGE']));

CREATE POLICY organization_person_operational_email_exclusions_system ON public.organization_person_operational_email_exclusions FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ', 'CONTACT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE']));

-- ============================================================
-- 6. Runtime privileges (no DELETE, no TRUNCATE, no rewriting of content)
-- ============================================================

REVOKE ALL
ON TABLE
    public.person_birth_dates,
    public.organization_person_operational_email_exclusions
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.person_birth_dates,
    public.organization_person_operational_email_exclusions
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, person_id, date_of_birth)
ON public.person_birth_dates
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, corrected_at, superseded_by_id, updated_at)
ON public.person_birth_dates
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id, organization_id, person_id, relationship_id, effective_from, effective_to,
    instruction_source, instruction_reference, instructed_by_person_id, evidence_document_id, change_reason
)
ON public.organization_person_operational_email_exclusions
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.organization_person_operational_email_exclusions
TO "tes-backend@tes-production-510007.iam";
