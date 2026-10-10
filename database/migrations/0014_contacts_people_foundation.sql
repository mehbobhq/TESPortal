-- TES Companies: Contacts / People foundation
-- Migration: 0014
--
-- Scope (additive only):
--   1. public.contact_purpose_types              controlled catalogue of contact purposes (seeded)
--   2. public.persons                            canonical human identity (identity + record lifecycle only)
--   3. public.person_name_versions               effective-dated legal / working name of a person
--   4. public.person_channels                    a person's email / phone / future channels
--   5. public.organization_channels              an Organization's own channels, independent of any person
--   6. public.organization_person_relationships  a person's relationship with an Organization over time
--   7. public.organization_person_titles         job titles held within a relationship over time
--   8. public.contact_purpose_assignments        contact purposes (billing, safety, ...) served within a relationship
--   9. two capabilities in public.capabilities   PERSON_REGISTRY_READ, CONTACT_MANAGE (catalogue rows only)
--
-- A person is NOT a field of an Organization. One human identity can work with several Organizations, serve several
-- purposes inside one, and later be referenced by the Driver domain without a second human record. An ordinary
-- contact is deliberately NOT a driver: no licence, medical, date of birth, government identity document or
-- driver-qualification attribute is stored here. Driver will reference persons.id later.
--
-- Titles are history, not identity, and never authorize anything. Purposes are not titles: "Safety Manager" is a title,
-- SAFETY is a purpose. "Primary" is never a person's identity: it is a flag on a purpose assignment, and a purpose's
-- primary_mode decides whether a primary flag is not allowed (NONE), optional (OPTIONAL) or implied (SINGLE). At most
-- one CURRENT primary assignment exists per Organization + purpose.
--
-- primary_mode makes NO "there must always be a primary" promise (an Organization may legitimately have no assignment
-- for a purpose). OPTIONAL: any number of current assignments, at most one of them flagged primary; zero primaries is
-- allowed. SINGLE: the purpose has at most one current holder per Organization and that holder is the primary. NONE:
-- the flag can never be set. The PRIMARY purpose (the Organization's general point of contact, SINGLE) is a different
-- thing from the primary flag on BILLING, SAFETY, ... (the preferred contact WITHIN that purpose); the two are
-- independent and a person can hold both.
--
-- Every person always has exactly one CURRENT name (enforced at commit by a deferred constraint trigger).
--
-- Channels carry no uniqueness across the registry: shared phone numbers and shared mailboxes are legitimate, and
-- normalization only assists ADVISORY matching - it never merges people. No channel is marked verified, because nothing
-- here verifies it (verification, when it exists, is its own evidence-bearing record).
--
-- Lifecycle per table:
--   contact_purpose_types   catalogue, changed only by migrations
--   persons                 record lifecycle (active / archived); a person is never ended. Archiving requires that the
--                           person has no CURRENT relationship
--   person_name_versions    effective-dated: a real name change ends the row and starts the next; a correction keeps the
--                           wrong row (record_status = 'corrected', pointing to its replacement)
--   person_channels         effective-dated; correction and void
--   organization_channels   effective-dated; correction and void
--   organization_person_relationships
--                           effective-dated: leaving ends the row (never deleted); a wrongly recorded relationship is
--                           voided. A rehire is a new relationship. Start-date correction is deferred (void + recreate)
--   organization_person_titles / contact_purpose_assignments
--                           effective-dated; correction and void; they live inside a relationship and cannot outlive it
--
-- Correction vs real-world change (the same convention as migrations 0012 and 0013):
--   - real-world change: the old row stays record_status = 'active' and gets effective_to = T; the new row starts at T.
--   - correction: the recorded row was wrong. It is kept, flagged record_status = 'corrected' with corrected_at and a
--     deferred pointer to its replacement (superseded_by_id), NEVER ended and frozen. The replacement carries the
--     business time of the row it corrects.
--   - void: the row should never have existed (entered in error) and has no replacement. It is kept, flagged
--     record_status = 'voided' with corrected_at, never ended and frozen.
--   Current and as-of reads use record_status = 'active' rows only.
--
-- Uniform lifecycle columns on every effective-dated table (effective_to, record_status, corrected_at,
-- superseded_by_id, updated_at) let one generic trigger guard them: content is immutable, a corrected / voided row is
-- frozen, an ended row cannot be re-dated.
--
-- Global canonical data: persons and their channels are not tenant-owned (one person can belong to many Organizations),
-- so there is no tenant column and no row-level security. Visibility is enforced by the server: every read and write is
-- a SYSTEM operation authorized by PERSON_REGISTRY_READ / CONTACT_MANAGE, and no CUSTOMER-scope path exists.
-- Row-level security keyed to a customer would also hide the data from SYSTEM operations by design (SYSTEM never sets a
-- tenant context), so it cannot be used here without an authorization redesign.
--
-- Concurrency: writers lock the Organization row first, then the person row, then the relationship, then dependents.
-- Unique indexes on current rows (one open relationship per Organization + person, one current primary per Organization +
-- purpose, no duplicate current title / purpose / channel) are the structural backstop.
--
-- This migration intentionally does NOT:
--   - model Drivers, licences, DOB, government identity documents, Customer relationships, Prospects, evidence,
--     verification, automatic person merging, or migrate any browser (tes_contacts_v5) data
--   - add SECURITY DEFINER functions or row-level security, or touch any existing object
--   - grant DELETE or TRUNCATE on anything


-- ============================================================
-- 1. Contact purpose catalogue
-- ============================================================

CREATE TABLE public.contact_purpose_types (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text,

    -- NONE: a primary flag is not allowed. OPTIONAL: an assignment may be flagged primary (at most one current primary
    -- per Organization + purpose). SINGLE: the assignment is always the primary one, so at most one current holder per Organization.
    primary_mode text NOT NULL,

    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT contact_purpose_types_code_valid
        CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),

    CONSTRAINT contact_purpose_types_display_name_not_blank
        CHECK (btrim(display_name) <> ''),

    CONSTRAINT contact_purpose_types_primary_mode_valid
        CHECK (primary_mode IN ('NONE', 'OPTIONAL', 'SINGLE')),

    CONSTRAINT contact_purpose_types_sort_order_uq
        UNIQUE (sort_order)
);

INSERT INTO public.contact_purpose_types (code, display_name, description, primary_mode, sort_order)
VALUES
    ('PRIMARY', 'Primary contact',
        'The Organization''s primary point of contact. At most one current holder per Organization.',
        'SINGLE', 10),
    ('BILLING', 'Billing',
        'Billing, invoicing and accounts-payable contact.',
        'OPTIONAL', 20),
    ('SAFETY', 'Safety',
        'Safety contact.',
        'OPTIONAL', 30),
    ('OPERATIONS', 'Operations',
        'Dispatch and day-to-day operations contact.',
        'OPTIONAL', 40),
    ('COMPLIANCE', 'Compliance',
        'Regulatory compliance contact.',
        'OPTIONAL', 50),
    ('EMERGENCY', 'Emergency',
        'Emergency contact.',
        'OPTIONAL', 60);


-- ============================================================
-- 2. Persons (canonical human identity)
-- ============================================================

CREATE TABLE public.persons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Record lifecycle (a person is never "ended").
    record_status text NOT NULL DEFAULT 'active',
    archived_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT persons_record_status_valid
        CHECK (record_status IN ('active', 'archived')),

    CONSTRAINT persons_archive_state_consistent
        CHECK (
            (record_status = 'archived' AND archived_at IS NOT NULL)
            OR
            (record_status = 'active' AND archived_at IS NULL)
        )
);


-- ============================================================
-- 3. Person name versions
-- ============================================================

CREATE TABLE public.person_name_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    person_id uuid NOT NULL
        REFERENCES public.persons(id)
        ON DELETE RESTRICT,

    given_name text,
    family_name text,

    -- Lower-cased, accent-folded, punctuation-free form used ONLY for advisory matching.
    name_normalized text NOT NULL,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT person_name_versions_given_name_not_blank
        CHECK (given_name IS NULL OR btrim(given_name) <> ''),

    CONSTRAINT person_name_versions_family_name_not_blank
        CHECK (family_name IS NULL OR btrim(family_name) <> ''),

    CONSTRAINT person_name_versions_has_a_name
        CHECK (given_name IS NOT NULL OR family_name IS NOT NULL),

    CONSTRAINT person_name_versions_name_normalized_not_blank
        CHECK (btrim(name_normalized) <> ''),

    CONSTRAINT person_name_versions_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT person_name_versions_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT person_name_versions_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT person_name_versions_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
        ),

    CONSTRAINT person_name_versions_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT person_name_versions_id_person_uq
        UNIQUE (id, person_id),

    CONSTRAINT person_name_versions_superseded_by_fk
        FOREIGN KEY (superseded_by_id, person_id)
        REFERENCES public.person_name_versions (id, person_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- Exactly one CURRENT name per person.
CREATE UNIQUE INDEX person_name_versions_current_uq
    ON public.person_name_versions (person_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX person_name_versions_history_idx
    ON public.person_name_versions (person_id, effective_from);

-- Advisory matching only: deliberately NOT unique.
CREATE INDEX person_name_versions_match_idx
    ON public.person_name_versions (name_normalized)
    WHERE record_status = 'active' AND effective_to IS NULL;


-- ============================================================
-- 4. Person channels
-- ============================================================

CREATE TABLE public.person_channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    person_id uuid NOT NULL
        REFERENCES public.persons(id)
        ON DELETE RESTRICT,

    -- Shape only: the set of supported types (EMAIL, PHONE, ...) is server policy so a new type needs no migration.
    channel_type text NOT NULL,

    value_display text NOT NULL,
    value_normalized text NOT NULL,
    normalization_rule_version text NOT NULL,
    extension text,

    -- Preferred channel of its type for the person (at most one current).
    is_preferred boolean NOT NULL DEFAULT false,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT person_channels_channel_type_valid
        CHECK (channel_type ~ '^[A-Z][A-Z0-9_]{1,31}$'),

    CONSTRAINT person_channels_value_display_not_blank
        CHECK (btrim(value_display) <> ''),

    CONSTRAINT person_channels_value_normalized_not_blank
        CHECK (btrim(value_normalized) <> ''),

    CONSTRAINT person_channels_rule_version_not_blank
        CHECK (btrim(normalization_rule_version) <> ''),

    CONSTRAINT person_channels_extension_not_blank
        CHECK (extension IS NULL OR btrim(extension) <> ''),

    CONSTRAINT person_channels_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT person_channels_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT person_channels_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT person_channels_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT person_channels_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT person_channels_id_person_uq
        UNIQUE (id, person_id),

    CONSTRAINT person_channels_superseded_by_fk
        FOREIGN KEY (superseded_by_id, person_id)
        REFERENCES public.person_channels (id, person_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- The same value is never held twice as a CURRENT channel of one person.
CREATE UNIQUE INDEX person_channels_current_value_uq
    ON public.person_channels (person_id, channel_type, value_normalized, COALESCE(extension, ''))
    WHERE record_status = 'active' AND effective_to IS NULL;

-- At most one preferred CURRENT channel per person and type.
CREATE UNIQUE INDEX person_channels_current_preferred_uq
    ON public.person_channels (person_id, channel_type)
    WHERE record_status = 'active' AND effective_to IS NULL AND is_preferred;

CREATE INDEX person_channels_history_idx
    ON public.person_channels (person_id, effective_from);

-- Advisory matching only: deliberately NOT unique (shared numbers and mailboxes are legitimate).
CREATE INDEX person_channels_match_idx
    ON public.person_channels (channel_type, value_normalized)
    WHERE record_status = 'active' AND effective_to IS NULL;


-- ============================================================
-- 5. Organization channels
-- ============================================================

CREATE TABLE public.organization_channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    channel_type text NOT NULL,

    -- What the channel is for (GENERAL, DISPATCH, ...). Shape only; the vocabulary is server policy.
    channel_usage text NOT NULL,

    value_display text NOT NULL,
    value_normalized text NOT NULL,
    normalization_rule_version text NOT NULL,
    extension text,

    -- Preferred channel of its type and usage for the Organization (at most one current).
    is_preferred boolean NOT NULL DEFAULT false,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT organization_channels_channel_type_valid
        CHECK (channel_type ~ '^[A-Z][A-Z0-9_]{1,31}$'),

    CONSTRAINT organization_channels_channel_usage_valid
        CHECK (channel_usage ~ '^[A-Z][A-Z0-9_]{1,31}$'),

    CONSTRAINT organization_channels_value_display_not_blank
        CHECK (btrim(value_display) <> ''),

    CONSTRAINT organization_channels_value_normalized_not_blank
        CHECK (btrim(value_normalized) <> ''),

    CONSTRAINT organization_channels_rule_version_not_blank
        CHECK (btrim(normalization_rule_version) <> ''),

    CONSTRAINT organization_channels_extension_not_blank
        CHECK (extension IS NULL OR btrim(extension) <> ''),

    CONSTRAINT organization_channels_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT organization_channels_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT organization_channels_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT organization_channels_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT organization_channels_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT organization_channels_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT organization_channels_superseded_by_fk
        FOREIGN KEY (superseded_by_id, organization_id)
        REFERENCES public.organization_channels (id, organization_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX organization_channels_current_value_uq
    ON public.organization_channels (organization_id, channel_type, channel_usage, value_normalized, COALESCE(extension, ''))
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE UNIQUE INDEX organization_channels_current_preferred_uq
    ON public.organization_channels (organization_id, channel_type, channel_usage)
    WHERE record_status = 'active' AND effective_to IS NULL AND is_preferred;

CREATE INDEX organization_channels_history_idx
    ON public.organization_channels (organization_id, effective_from);

CREATE INDEX organization_channels_match_idx
    ON public.organization_channels (channel_type, value_normalized)
    WHERE record_status = 'active' AND effective_to IS NULL;


-- ============================================================
-- 6. Organization <-> person relationships
-- ============================================================

CREATE TABLE public.organization_person_relationships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    person_id uuid NOT NULL
        REFERENCES public.persons(id)
        ON DELETE RESTRICT,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT organization_person_relationships_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT organization_person_relationships_record_status_valid
        CHECK (record_status IN ('active', 'voided')),

    CONSTRAINT organization_person_relationships_void_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL)
        ),

    -- Target of the composite foreign keys on titles and purpose assignments.
    CONSTRAINT organization_person_relationships_id_org_person_uq
        UNIQUE (id, organization_id, person_id)
);

-- No duplicate simultaneously-open relationship between one Organization and one person.
CREATE UNIQUE INDEX organization_person_relationships_current_uq
    ON public.organization_person_relationships (organization_id, person_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX organization_person_relationships_org_history_idx
    ON public.organization_person_relationships (organization_id, effective_from);

CREATE INDEX organization_person_relationships_person_idx
    ON public.organization_person_relationships (person_id);


-- ============================================================
-- 7. Titles held within a relationship
-- ============================================================

CREATE TABLE public.organization_person_titles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    relationship_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    person_id uuid NOT NULL,

    title_display text NOT NULL,
    title_normalized text NOT NULL,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT organization_person_titles_relationship_fk
        FOREIGN KEY (relationship_id, organization_id, person_id)
        REFERENCES public.organization_person_relationships (id, organization_id, person_id)
        ON DELETE RESTRICT,

    CONSTRAINT organization_person_titles_title_display_not_blank
        CHECK (btrim(title_display) <> ''),

    CONSTRAINT organization_person_titles_title_normalized_not_blank
        CHECK (btrim(title_normalized) <> ''),

    CONSTRAINT organization_person_titles_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT organization_person_titles_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT organization_person_titles_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT organization_person_titles_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT organization_person_titles_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT organization_person_titles_id_relationship_uq
        UNIQUE (id, relationship_id),

    CONSTRAINT organization_person_titles_superseded_by_fk
        FOREIGN KEY (superseded_by_id, relationship_id)
        REFERENCES public.organization_person_titles (id, relationship_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- A person may hold several titles at once, but never the same title twice as a CURRENT title.
CREATE UNIQUE INDEX organization_person_titles_current_uq
    ON public.organization_person_titles (relationship_id, title_normalized)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX organization_person_titles_history_idx
    ON public.organization_person_titles (relationship_id, effective_from);


-- ============================================================
-- 8. Contact purpose assignments
-- ============================================================

CREATE TABLE public.contact_purpose_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    relationship_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    person_id uuid NOT NULL,

    purpose_code text NOT NULL
        REFERENCES public.contact_purpose_types(code)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    is_primary boolean NOT NULL DEFAULT false,

    change_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT contact_purpose_assignments_relationship_fk
        FOREIGN KEY (relationship_id, organization_id, person_id)
        REFERENCES public.organization_person_relationships (id, organization_id, person_id)
        ON DELETE RESTRICT,

    CONSTRAINT contact_purpose_assignments_change_reason_valid
        CHECK (change_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT contact_purpose_assignments_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT contact_purpose_assignments_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT contact_purpose_assignments_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)
        ),

    CONSTRAINT contact_purpose_assignments_not_superseded_by_self
        CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),

    CONSTRAINT contact_purpose_assignments_id_relationship_uq
        UNIQUE (id, relationship_id),

    CONSTRAINT contact_purpose_assignments_superseded_by_fk
        FOREIGN KEY (superseded_by_id, relationship_id)
        REFERENCES public.contact_purpose_assignments (id, relationship_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- A person serves a purpose at most once at a time within a relationship.
CREATE UNIQUE INDEX contact_purpose_assignments_current_uq
    ON public.contact_purpose_assignments (relationship_id, purpose_code)
    WHERE record_status = 'active' AND effective_to IS NULL;

-- At most ONE current primary contact per Organization + purpose.
CREATE UNIQUE INDEX contact_purpose_assignments_current_primary_uq
    ON public.contact_purpose_assignments (organization_id, purpose_code)
    WHERE record_status = 'active' AND effective_to IS NULL AND is_primary;

CREATE INDEX contact_purpose_assignments_history_idx
    ON public.contact_purpose_assignments (relationship_id, effective_from);

CREATE INDEX contact_purpose_assignments_org_purpose_idx
    ON public.contact_purpose_assignments (organization_id, purpose_code);


-- ============================================================
-- 9. Integrity trigger functions
--
-- SECURITY INVOKER with a fixed search_path; none is executable by PUBLIC. Written on single-line
-- "AS $$ BEGIN" form so the migration runner's transaction-control check accepts them.
-- ============================================================

-- No hard delete or truncate of contact data, ever.
CREATE FUNCTION tes_security.prevent_contact_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Contact data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- Person identity is immutable. Only the record lifecycle may change, and a person with a CURRENT relationship cannot
-- be archived (end the relationship first).
CREATE FUNCTION tes_security.guard_person_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Person identity is immutable; only the record lifecycle can change'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'archived' AND OLD.record_status = 'active' AND EXISTS (
        SELECT 1
          FROM public.organization_person_relationships AS r
         WHERE r.person_id = NEW.id
           AND r.record_status = 'active'
           AND r.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'A person with a current Organization relationship cannot be archived'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'persons_archive_requires_no_current_relationship';
    END IF;

    RETURN NEW;
END;
$$;

-- One generic guard for every effective-dated table. The lifecycle columns share names on all of them, so: content
-- (everything else) is immutable, a corrected / voided row is frozen, an ended row cannot be re-dated, and a correction
-- or void never ends a row.
CREATE FUNCTION tes_security.guard_contact_period_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status <> 'active' THEN
        RAISE EXCEPTION 'A corrected or voided contact record is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF (to_jsonb(NEW) - ARRAY['effective_to', 'record_status', 'corrected_at', 'superseded_by_id', 'updated_at']::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['effective_to', 'record_status', 'corrected_at', 'superseded_by_id', 'updated_at']::text[])
    THEN
        RAISE EXCEPTION 'Contact record content is immutable; record a change, a correction or a void instead'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended contact record cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status <> 'active' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction or void does not end a record; it must not set effective_to'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A name version or person channel must belong to an ACTIVE (non-archived) person. The person row is locked FOR SHARE
-- so a concurrent archive and a concurrent insert cannot both succeed.
CREATE FUNCTION tes_security.guard_person_dependent_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.persons AS p
         WHERE p.id = NEW.person_id
           AND p.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A record must belong to an active person'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'contact_records_person_active';
    END IF;

    RETURN NEW;
END;
$$;

-- An Organization channel must belong to an ACTIVE Organization.
CREATE FUNCTION tes_security.guard_organization_channel_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.organizations AS o
         WHERE o.id = NEW.organization_id
           AND o.status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'An Organization channel must belong to an active Organization'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'organization_channels_organization_active';
    END IF;

    RETURN NEW;
END;
$$;

-- A relationship needs an ACTIVE Organization and an ACTIVE person.
CREATE FUNCTION tes_security.guard_relationship_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.organizations AS o
         WHERE o.id = NEW.organization_id
           AND o.status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A relationship must belong to an active Organization'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'organization_person_relationships_organization_active';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.persons AS p
         WHERE p.id = NEW.person_id
           AND p.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A relationship must belong to an active person'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'contact_records_person_active';
    END IF;

    RETURN NEW;
END;
$$;

-- A relationship cannot be ended or voided while it still has titles or purpose assignments that outlive that decision.
CREATE FUNCTION tes_security.guard_relationship_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.record_status = 'voided' AND OLD.record_status = 'active' AND (
        EXISTS (
            SELECT 1 FROM public.organization_person_titles AS t
             WHERE t.relationship_id = NEW.id AND t.record_status = 'active'
        ) OR EXISTS (
            SELECT 1 FROM public.contact_purpose_assignments AS a
             WHERE a.relationship_id = NEW.id AND a.record_status = 'active'
        )
    ) THEN
        RAISE EXCEPTION 'A relationship with titles or purpose assignments cannot be voided; void them first'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'organization_person_relationships_dependents_block_void';
    END IF;

    IF NEW.effective_to IS NOT NULL AND OLD.effective_to IS NULL AND (
        EXISTS (
            SELECT 1 FROM public.organization_person_titles AS t
             WHERE t.relationship_id = NEW.id AND t.record_status = 'active'
               AND (t.effective_to IS NULL OR t.effective_to > NEW.effective_to)
        ) OR EXISTS (
            SELECT 1 FROM public.contact_purpose_assignments AS a
             WHERE a.relationship_id = NEW.id AND a.record_status = 'active'
               AND (a.effective_to IS NULL OR a.effective_to > NEW.effective_to)
        )
    ) THEN
        RAISE EXCEPTION 'A relationship cannot end while titles or purpose assignments outlive it'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'organization_person_relationships_dependents_block_end';
    END IF;

    RETURN NEW;
END;
$$;

-- A title or purpose assignment lives inside its relationship: the relationship must be an ACTIVE record (locked FOR
-- SHARE) and the dependent's window must start no earlier than the relationship and end no later than it.
CREATE FUNCTION tes_security.guard_relationship_dependent_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.organization_person_relationships AS r
         WHERE r.id = NEW.relationship_id
           AND r.record_status = 'active'
           AND NEW.effective_from >= r.effective_from
           AND (r.effective_to IS NULL OR (NEW.effective_to IS NOT NULL AND NEW.effective_to <= r.effective_to))
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'The record must fall inside an active relationship'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'contact_records_relationship_window';
    END IF;

    RETURN NEW;
END;
$$;

-- A purpose assignment must use an ACTIVE purpose and respect the purpose's primary_mode.
CREATE FUNCTION tes_security.guard_purpose_assignment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.contact_purpose_types AS k
         WHERE k.code = NEW.purpose_code
           AND k.is_active
           AND (
               (k.primary_mode = 'NONE' AND NOT NEW.is_primary)
               OR k.primary_mode = 'OPTIONAL'
               OR (k.primary_mode = 'SINGLE' AND NEW.is_primary)
           )
    ) THEN
        RAISE EXCEPTION 'The purpose is unknown, inactive, or incompatible with the primary flag'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'contact_purpose_assignments_purpose_rules';
    END IF;

    RETURN NEW;
END;
$$;

-- Every person has exactly one CURRENT name when the transaction commits. Deferred so a person and its first name (or a
-- name change / correction: end or mark the old row, insert the replacement) can be written in any order inside one
-- transaction. The unique index already forbids two current names; this forbids none.
CREATE FUNCTION tes_security.require_current_person_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.person_name_versions AS n
         WHERE n.person_id = (CASE WHEN TG_TABLE_NAME = 'persons' THEN to_jsonb(NEW) ->> 'id' ELSE to_jsonb(NEW) ->> 'person_id' END)::uuid
           AND n.record_status = 'active'
           AND n.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'A person must have exactly one current name'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'persons_require_current_name';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_contact_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_person_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_contact_period_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_person_dependent_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_organization_channel_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_relationship_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_relationship_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_relationship_dependent_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_purpose_assignment_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_current_person_name() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER persons_require_current_name
AFTER INSERT ON public.persons
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_current_person_name();

CREATE CONSTRAINT TRIGGER person_name_versions_require_current_name
AFTER INSERT OR UPDATE ON public.person_name_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_current_person_name();

CREATE TRIGGER persons_guard_update
BEFORE UPDATE ON public.persons
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_person_update();

CREATE TRIGGER person_name_versions_guard_insert
BEFORE INSERT ON public.person_name_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_person_dependent_insert();

CREATE TRIGGER person_name_versions_guard_update
BEFORE UPDATE ON public.person_name_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_contact_period_update();

CREATE TRIGGER person_channels_guard_insert
BEFORE INSERT ON public.person_channels
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_person_dependent_insert();

CREATE TRIGGER person_channels_guard_update
BEFORE UPDATE ON public.person_channels
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_contact_period_update();

CREATE TRIGGER organization_channels_guard_insert
BEFORE INSERT ON public.organization_channels
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_organization_channel_insert();

CREATE TRIGGER organization_channels_guard_update
BEFORE UPDATE ON public.organization_channels
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_contact_period_update();

CREATE TRIGGER organization_person_relationships_guard_insert
BEFORE INSERT ON public.organization_person_relationships
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_relationship_insert();

CREATE TRIGGER organization_person_relationships_guard_update
BEFORE UPDATE ON public.organization_person_relationships
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_contact_period_update();

CREATE TRIGGER organization_person_relationships_guard_dependents
BEFORE UPDATE ON public.organization_person_relationships
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_relationship_update();

CREATE TRIGGER organization_person_titles_guard_insert
BEFORE INSERT ON public.organization_person_titles
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_relationship_dependent_insert();

CREATE TRIGGER organization_person_titles_guard_update
BEFORE UPDATE ON public.organization_person_titles
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_contact_period_update();

CREATE TRIGGER contact_purpose_assignments_guard_insert
BEFORE INSERT ON public.contact_purpose_assignments
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_relationship_dependent_insert();

CREATE TRIGGER contact_purpose_assignments_guard_purpose
BEFORE INSERT ON public.contact_purpose_assignments
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_purpose_assignment_insert();

CREATE TRIGGER contact_purpose_assignments_guard_update
BEFORE UPDATE ON public.contact_purpose_assignments
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_contact_period_update();

CREATE TRIGGER persons_no_delete
BEFORE DELETE ON public.persons
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER person_name_versions_no_delete
BEFORE DELETE ON public.person_name_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER person_channels_no_delete
BEFORE DELETE ON public.person_channels
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER organization_channels_no_delete
BEFORE DELETE ON public.organization_channels
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER organization_person_relationships_no_delete
BEFORE DELETE ON public.organization_person_relationships
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER organization_person_titles_no_delete
BEFORE DELETE ON public.organization_person_titles
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER contact_purpose_assignments_no_delete
BEFORE DELETE ON public.contact_purpose_assignments
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER persons_no_truncate
BEFORE TRUNCATE ON public.persons
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER person_name_versions_no_truncate
BEFORE TRUNCATE ON public.person_name_versions
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER person_channels_no_truncate
BEFORE TRUNCATE ON public.person_channels
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER organization_channels_no_truncate
BEFORE TRUNCATE ON public.organization_channels
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER organization_person_relationships_no_truncate
BEFORE TRUNCATE ON public.organization_person_relationships
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER organization_person_titles_no_truncate
BEFORE TRUNCATE ON public.organization_person_titles
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();

CREATE TRIGGER contact_purpose_assignments_no_truncate
BEFORE TRUNCATE ON public.contact_purpose_assignments
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_contact_data_removal();


-- ============================================================
-- 10. Capabilities (catalogue rows only; nothing is granted)
--
-- ORGANIZATION_UPDATE explicitly does not authorize Contacts (migration 0011), so Contacts has its own capabilities.
-- Both are SYSTEM-only: a person is globally canonical, which is not global visibility, and no CUSTOMER-scope contact
-- access exists yet. This migration creates no relationship, assignment or grant.
-- ============================================================

INSERT INTO public.capabilities (code, display_name, description, is_active, sort_order)
VALUES
    (
        'PERSON_REGISTRY_READ',
        'Read Person and Contact Registry',
        'SYSTEM-wide read access to canonical people and Organization contact data: read the contacts of any Organization, find potential duplicate people, and view matched people across Organizations. Intended scope: SYSTEM only.',
        true,
        70
    ),
    (
        'CONTACT_MANAGE',
        'Manage Contacts',
        'Create and maintain people, their channels, Organization contact channels, Organization-person relationships, titles and contact purposes, including corrections and ending history. Does not authorize reading people across Organizations. Intended scope: SYSTEM only.',
        true,
        80
    );


-- ============================================================
-- 11. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is deliberate and object-specific. The
-- runtime identity gets no DELETE and no TRUNCATE, may not rewrite content or identity, and has read-only access to the
-- purpose catalogue (changed only by migrations).
-- ============================================================

REVOKE ALL
ON TABLE
    public.contact_purpose_types,
    public.persons,
    public.person_name_versions,
    public.person_channels,
    public.organization_channels,
    public.organization_person_relationships,
    public.organization_person_titles,
    public.contact_purpose_assignments
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.contact_purpose_types,
    public.persons,
    public.person_name_versions,
    public.person_channels,
    public.organization_channels,
    public.organization_person_relationships,
    public.organization_person_titles,
    public.contact_purpose_assignments
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id)
ON public.persons
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, archived_at, updated_at)
ON public.persons
TO "tes-backend@tes-production-510007.iam";

-- id is insertable so a correction can name its replacement before creating it.
GRANT INSERT (id, person_id, given_name, family_name, name_normalized, change_reason, effective_from)
ON public.person_name_versions
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.person_name_versions
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, person_id, channel_type, value_display, value_normalized, normalization_rule_version, extension, is_preferred, change_reason, effective_from)
ON public.person_channels
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.person_channels
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, channel_type, channel_usage, value_display, value_normalized, normalization_rule_version, extension, is_preferred, change_reason, effective_from)
ON public.organization_channels
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.organization_channels
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, person_id, effective_from)
ON public.organization_person_relationships
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, updated_at)
ON public.organization_person_relationships
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, relationship_id, organization_id, person_id, title_display, title_normalized, change_reason, effective_from)
ON public.organization_person_titles
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.organization_person_titles
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from)
ON public.contact_purpose_assignments
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_id, updated_at)
ON public.contact_purpose_assignments
TO "tes-backend@tes-production-510007.iam";
