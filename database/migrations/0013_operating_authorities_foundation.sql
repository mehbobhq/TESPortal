-- TES Companies: Authorities (regulatory operating-authority) foundation
-- Migration: 0013
--
-- Scope (additive only):
--   1. public.authority_kinds                    controlled catalogue of authority kinds (seeded)
--   2. public.operating_authorities              stable authority identity (one row per authority record)
--   3. public.operating_authority_versions       effective-dated number / jurisdiction / date history
--   4. public.operating_authority_status_periods effective-dated regulatory status history
--
-- Authorities are canonical Organization regulatory facts. They are NOT Company mirror fields: this
-- schema owns the authoritative number, jurisdiction, dates and status history.
--
-- Stable identity: an authority is one row in operating_authorities. It survives status changes,
-- suspension / reactivation, legitimate jurisdiction changes and corrections. Nothing is destroyed and
-- recreated for any of those.
--
-- Initial kinds (exactly): USDOT, MC, MVID, RIN, CVOR, SAFETY_FITNESS, IRP. MVID and RIN, and CVOR and
-- SAFETY_FITNESS, are deliberately separate kinds. Not authorities (deferred to their own domains):
-- MCS-150 (a USDOT filing), UCR, PHMSA, SCAC / Canadian Carrier Code (Customs), IFTA and state tax
-- accounts (Tax / Registration), insurance, Operating Area, vehicle-level apportioned registration,
-- vehicle permits, audits and safety-profile snapshots.
--
-- Uniqueness / collision namespace is a property of the kind (authority_kinds.jurisdiction_scope):
--   NATIONAL          one number space for the whole issuing country        (USDOT, MC: US)
--   COUNTRY_REGION    number space per issuing country + region             (MVID, RIN, CVOR, SAFETY_FITNESS)
--   BASE_JURISDICTION number space per base jurisdiction, which may change  (IRP)
-- A CURRENT, non-corrected version holds its number: two authorities can never hold the same number
-- in the same namespace, whether or not either authority is cancelled or archived (reuse must be an
-- explicit reviewed decision, never a silent one).
--
-- Concurrent records per Organization (authority_kinds.one_current_per_organization): the database makes
-- ONLY the claims regulator documentation supports.
--   - USDOT: FMCSA assigns one USDOT number to each legal person, never transfers it, and it stays with
--     that person forever, so an Organization has at most one CURRENT USDOT (no ordinary multi-USDOT
--     path). Enforced by operating_authority_versions_current_identity_uq.
--   - MC, MVID, RIN, CVOR, SAFETY_FITNESS, IRP: regulator documentation does not establish that an
--     Organization can hold only one current record (an entity may need several FMCSA operating
--     authorities; IRP registrants may hold several fleets/accounts; the provincial identifiers are
--     issuer-specific client / operator identifiers). The database therefore does NOT encode one-per-
--     Organization for them; each record is distinguished by its number, which is unique in its
--     namespace. Any stricter rule belongs to the Rules / authority-policy layer or a later migration.
-- MC docket identity vs operating-authority entitlements: an MC record is the regulatory DOCKET NUMBER
-- (the canonical MC identity), held once in its namespace. FMCSA documents that legacy dockets can carry
-- several operating authorities (existing authorities keep sharing a docket), that Motus assigns a separate
-- docket to each newly granted authority, and that each authority has its own regulatory history. This
-- migration therefore deliberately models no entitlement: the docket number is never duplicated to
-- represent several entitlements, and operating_authorities (id, kind) is a unique target so a later,
-- additive child table of per-docket entitlements (each with its own type and status history) can
-- reference the docket without changing anything here. Until then the status history of an MC record is
-- the observed status of the DOCKET as a whole; entitlement-level status is deferred.
-- The jurisdiction of a record is an effective-dated attribute of its VERSION and part of its collision
-- namespace, never part of Organization identity: a wrongly recorded jurisdiction stays correctable like
-- any other recorded fact. A cancelled or archived authority keeps its current version, so it keeps
-- holding its number (and, for USDOT, its identity): reactivation or restoration is the path back.
--
-- Business time vs record time:
--   effective_from / effective_to describe when a fact was true in the real world and may be
--   backdated. issued_on / expires_on are the regulatory document dates. created_at / updated_at are
--   record times and are never used to simulate business history.
--
-- Correction vs real-world change (versions and status periods), the same convention as migration 0012:
--   - real-world change: the old row stays record_status = 'active' and gets effective_to = T; the new
--     row starts at T. Both are genuine business history.
--   - correction: the recorded row was wrong. It is kept, flagged record_status = 'corrected' with
--     corrected_at and a deferred, same-authority pointer to its replacement, and it is NEVER ended and
--     frozen. The replacement carries the business time of the row it corrects. Current and as-of reads
--     use record_status = 'active' rows only, so a known-wrong row is preserved for audit but never
--     becomes current or historical truth.
--
-- Regulatory status is a common vocabulary (PENDING, ACTIVE, INACTIVE, SUSPENDED, REVOKED, CANCELED).
-- Archive is RECORD lifecycle (operating_authorities.record_status), not regulatory status. EXPIRED is
-- deliberately not a stored status: whether an expiry date applies is a property of the kind
-- (authority_kinds.has_expiry) and expiry is interpreted from expires_on, so kind-specific
-- interpretation can evolve without rewriting history. The status history records OBSERVED regulatory
-- status truthfully; no universal transition matrix is enforced, because legal transitions differ by
-- regulator and kind (kind-specific transition policy belongs to the Rules / authority-policy layer).
--
-- Requirement is not stored here: whether an Organization needs an authority is a Rules Pool
-- determination. These tables hold only actual authorities, so absence of a row is never the
-- conclusion, and evidence completeness is deliberately not a column here either.
--
-- Global Organization facts: no tenant column and no row-level security. Visibility is enforced by the
-- server (customer reads start from an authorized Customer; collision details need registry access).
--
-- This migration intentionally does NOT:
--   - add capabilities, SECURITY DEFINER functions, row-level security, evidence or Contacts / Customer /
--     Customs / Tax structures, or touch any existing object
--   - grant DELETE or TRUNCATE on anything


-- ============================================================
-- 1. Authority kind catalogue
-- ============================================================

CREATE TABLE public.authority_kinds (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text,

    -- Collision / identity namespace (see header).
    jurisdiction_scope text NOT NULL,
    -- Issuing country, when the kind has exactly one (NULL: any supported country).
    issuer_country text,
    -- Whether the issuing jurisdiction includes a region (province / state).
    region_required boolean NOT NULL,
    -- A region the kind is bound to (CVOR and RIN are Ontario programs).
    fixed_region text,
    -- Whether an expiry date applies to this kind.
    has_expiry boolean NOT NULL,
    -- Whether regulator documentation supports at most one CURRENT record per Organization
    -- (enforced by operating_authority_versions_current_identity_uq; a new true value needs a migration).
    one_current_per_organization boolean NOT NULL,

    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT authority_kinds_code_valid
        CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),

    CONSTRAINT authority_kinds_display_name_not_blank
        CHECK (btrim(display_name) <> ''),

    CONSTRAINT authority_kinds_jurisdiction_scope_valid
        CHECK (jurisdiction_scope IN ('NATIONAL', 'COUNTRY_REGION', 'BASE_JURISDICTION')),

    CONSTRAINT authority_kinds_issuer_country_valid
        CHECK (issuer_country IS NULL OR issuer_country ~ '^[A-Z]{2}$'),

    CONSTRAINT authority_kinds_fixed_region_valid
        CHECK (fixed_region IS NULL OR fixed_region ~ '^[A-Z0-9]{1,8}$'),

    CONSTRAINT authority_kinds_scope_shape_consistent
        CHECK (
            (jurisdiction_scope = 'NATIONAL'
                AND issuer_country IS NOT NULL AND region_required = false AND fixed_region IS NULL)
            OR
            (jurisdiction_scope = 'COUNTRY_REGION'
                AND issuer_country IS NOT NULL AND region_required = true)
            OR
            (jurisdiction_scope = 'BASE_JURISDICTION'
                AND region_required = true AND fixed_region IS NULL)
        ),

    CONSTRAINT authority_kinds_sort_order_uq
        UNIQUE (sort_order)
);

INSERT INTO public.authority_kinds
    (code, display_name, description, jurisdiction_scope, issuer_country, region_required, fixed_region, has_expiry, one_current_per_organization, sort_order)
VALUES
    ('USDOT', 'USDOT Number',
        'FMCSA USDOT number: assigned once to a legal person, non-transferable. National (US) number space; at most one current per Organization.',
        'NATIONAL', 'US', false, NULL, false, true, 10),
    ('MC', 'MC Docket Number',
        'FMCSA MC-prefixed docket number: the regulatory docket identity (FF and MX dockets are different prefixes and are not modelled). One record per docket; individual operating-authority entitlements under a docket are deferred. National (US) number space; an Organization may hold more than one docket.',
        'NATIONAL', 'US', false, NULL, false, false, 20),
    ('MVID', 'MVID',
        'Provincial motor vehicle client identifier (Alberta Registries uses MVID). Issuing province recorded per version; number space per issuing province.',
        'COUNTRY_REGION', 'CA', true, NULL, false, false, 30),
    ('RIN', 'RIN',
        'Ontario Registrant Identification Number (MTO / ServiceOntario) identifying a registrant of vehicles. Ontario number space.',
        'COUNTRY_REGION', 'CA', true, 'ON', false, false, 40),
    ('CVOR', 'CVOR',
        'Ontario Commercial Vehicle Operator''s Registration: nine-digit operator number on the CVOR certificate. Ontario number space.',
        'COUNTRY_REGION', 'CA', true, 'ON', true, false, 50),
    ('SAFETY_FITNESS', 'NSC / Safety Fitness Certificate',
        'Canadian National Safety Code carrier number / safety fitness certificate assigned by the carrier''s home province or territory. Number space per issuing province / territory.',
        'COUNTRY_REGION', 'CA', true, NULL, true, false, 60),
    ('IRP', 'IRP Account',
        'International Registration Plan account issued by the registrant''s base jurisdiction. Number space per base jurisdiction, which may change over time; an Organization may hold more than one.',
        'BASE_JURISDICTION', NULL, true, NULL, false, false, 70);


-- ============================================================
-- 2. Operating authorities (stable identity)
-- ============================================================

CREATE TABLE public.operating_authorities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    kind text NOT NULL
        REFERENCES public.authority_kinds(code)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    -- Record lifecycle (NOT regulatory status).
    record_status text NOT NULL DEFAULT 'active',
    archived_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT operating_authorities_record_status_valid
        CHECK (record_status IN ('active', 'archived')),

    CONSTRAINT operating_authorities_archive_state_consistent
        CHECK (
            (record_status = 'archived' AND archived_at IS NOT NULL)
            OR
            (record_status = 'active' AND archived_at IS NULL)
        ),

    -- Targets of the composite foreign keys on versions.
    CONSTRAINT operating_authorities_id_kind_uq
        UNIQUE (id, kind),

    CONSTRAINT operating_authorities_id_organization_uq
        UNIQUE (id, organization_id)
);

CREATE INDEX operating_authorities_organization_idx
    ON public.operating_authorities (organization_id, kind);


-- ============================================================
-- 3. Authority versions (number, jurisdiction, dates)
-- ============================================================

CREATE TABLE public.operating_authority_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    authority_id uuid NOT NULL,

    -- Copies of operating_authorities.organization_id and .kind, bound by the composite foreign keys
    -- below, so the identity and collision indexes can be single-table indexes without trusting
    -- application code.
    organization_id uuid NOT NULL,
    kind text NOT NULL,

    -- Displayable number exactly as recorded, the normalized form used for matching and collision, and
    -- the version of the kind-specific normalization rule that produced it.
    number_display text NOT NULL,
    number_normalized text NOT NULL,
    normalization_rule_version text NOT NULL,

    -- Issuing jurisdiction of THIS version (the namespace the number is unique in).
    jurisdiction_country text NOT NULL,
    jurisdiction_region text,

    -- Regulatory document dates (expires_on only for kinds where expiry applies).
    issued_on date,
    expires_on date,

    -- How this version came to exist.
    version_reason text NOT NULL,

    -- Business time (may be backdated).
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    -- 'active': asserted true for [effective_from, effective_to).
    -- 'corrected': known to have been wrongly recorded; preserved, never a genuine business fact.
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_version_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT operating_authority_versions_authority_fk
        FOREIGN KEY (authority_id, kind)
        REFERENCES public.operating_authorities (id, kind)
        ON DELETE RESTRICT,

    CONSTRAINT operating_authority_versions_organization_fk
        FOREIGN KEY (authority_id, organization_id)
        REFERENCES public.operating_authorities (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT operating_authority_versions_number_display_not_blank
        CHECK (btrim(number_display) <> ''),

    CONSTRAINT operating_authority_versions_number_normalized_not_blank
        CHECK (btrim(number_normalized) <> ''),

    CONSTRAINT operating_authority_versions_rule_version_not_blank
        CHECK (btrim(normalization_rule_version) <> ''),

    CONSTRAINT operating_authority_versions_country_valid
        CHECK (jurisdiction_country ~ '^[A-Z]{2}$'),

    CONSTRAINT operating_authority_versions_region_valid
        CHECK (jurisdiction_region IS NULL OR jurisdiction_region ~ '^[A-Z0-9]{1,8}$'),

    CONSTRAINT operating_authority_versions_document_dates_valid
        CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on),

    CONSTRAINT operating_authority_versions_reason_valid
        CHECK (version_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT operating_authority_versions_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT operating_authority_versions_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT operating_authority_versions_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_version_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_version_id IS NOT NULL)
        ),

    CONSTRAINT operating_authority_versions_not_superseded_by_self
        CHECK (superseded_by_version_id IS NULL OR superseded_by_version_id <> id),

    -- Target of the same-authority replacement foreign key below.
    CONSTRAINT operating_authority_versions_id_authority_uq
        UNIQUE (id, authority_id),

    -- A corrected version points to its replacement, which must belong to the same authority.
    -- Deferred so a correction can mark the old row and create its replacement in either order inside
    -- one transaction.
    CONSTRAINT operating_authority_versions_superseded_by_fk
        FOREIGN KEY (superseded_by_version_id, authority_id)
        REFERENCES public.operating_authority_versions (id, authority_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- Exactly one CURRENT version per authority. Corrected rows never count.
CREATE UNIQUE INDEX operating_authority_versions_current_uq
    ON public.operating_authority_versions (authority_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

-- Supported invariant: one CURRENT USDOT per Organization (FMCSA assigns one USDOT number per legal
-- person). Only kinds with authority_kinds.one_current_per_organization = true are listed; a kind
-- added later must be added to (or deliberately kept out of) the list below by its own migration, and
-- the production verification asserts the exact definition. The server serializes writers with a row
-- lock on the Organization; this index is the final concurrency backstop.
CREATE UNIQUE INDEX operating_authority_versions_current_identity_uq
    ON public.operating_authority_versions (organization_id, kind)
    WHERE record_status = 'active' AND effective_to IS NULL AND kind IN ('USDOT');

-- Authoritative collision protection: a CURRENT, non-corrected version holds its number in its
-- namespace. Independent of whether the authority's status is cancelled or the record archived.
CREATE UNIQUE INDEX operating_authority_versions_current_number_uq
    ON public.operating_authority_versions (kind, jurisdiction_country, jurisdiction_region, number_normalized)
    NULLS NOT DISTINCT
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX operating_authority_versions_history_idx
    ON public.operating_authority_versions (authority_id, effective_from);

-- Review lookups across all versions (ended and corrected included). Not unique.
CREATE INDEX operating_authority_versions_number_lookup_idx
    ON public.operating_authority_versions (kind, number_normalized);


-- ============================================================
-- 4. Authority status periods (regulatory status history)
-- ============================================================

CREATE TABLE public.operating_authority_status_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    authority_id uuid NOT NULL
        REFERENCES public.operating_authorities(id)
        ON DELETE RESTRICT,

    authority_status text NOT NULL,

    -- How this period came to exist. REACTIVATION is a real transition back to ACTIVE.
    period_reason text NOT NULL,

    -- Business time (may be backdated).
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT operating_authority_status_periods_status_valid
        CHECK (authority_status IN ('PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REVOKED', 'CANCELED')),

    CONSTRAINT operating_authority_status_periods_reason_valid
        CHECK (period_reason IN ('INITIAL', 'TRANSITION', 'REACTIVATION', 'CORRECTION')),

    CONSTRAINT operating_authority_status_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT operating_authority_status_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT operating_authority_status_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
        ),

    CONSTRAINT operating_authority_status_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT operating_authority_status_periods_id_authority_uq
        UNIQUE (id, authority_id),

    CONSTRAINT operating_authority_status_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, authority_id)
        REFERENCES public.operating_authority_status_periods (id, authority_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- Exactly one CURRENT status period per authority. Corrected rows never count.
CREATE UNIQUE INDEX operating_authority_status_periods_current_uq
    ON public.operating_authority_status_periods (authority_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX operating_authority_status_periods_history_idx
    ON public.operating_authority_status_periods (authority_id, effective_from);


-- ============================================================
-- 5. Integrity triggers
--
-- Enforced in the database so they do not depend on application code and apply to the table owner as
-- well (same approach as 0008 / 0010 / 0012). All functions are SECURITY INVOKER with a fixed
-- search_path; none is SECURITY DEFINER.
-- ============================================================

-- No hard delete or truncate of authority data, ever.
CREATE FUNCTION tes_security.prevent_authority_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Authority data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- Authority identity is immutable. Only the record lifecycle (archive / restore) may change.
CREATE FUNCTION tes_security.guard_authority_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Authority identity is immutable; only the record lifecycle can change'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A new version must belong to an ACTIVE (non-archived) authority record (the row is locked FOR SHARE
-- so a concurrent archive and a concurrent version cannot both succeed) and must satisfy its kind's
-- jurisdiction and expiry rules.
CREATE FUNCTION tes_security.guard_authority_version_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.operating_authorities AS a
         WHERE a.id = NEW.authority_id
           AND a.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A version must belong to an active authority record'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'operating_authority_versions_authority_active';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.authority_kinds AS k
         WHERE k.code = NEW.kind
           AND k.is_active
           AND (
               (k.jurisdiction_scope = 'NATIONAL'
                   AND NEW.jurisdiction_country = k.issuer_country
                   AND NEW.jurisdiction_region IS NULL)
               OR
               (k.jurisdiction_scope = 'COUNTRY_REGION'
                   AND NEW.jurisdiction_country = k.issuer_country
                   AND NEW.jurisdiction_region IS NOT NULL
                   AND (k.fixed_region IS NULL OR NEW.jurisdiction_region = k.fixed_region))
               OR
               (k.jurisdiction_scope = 'BASE_JURISDICTION'
                   AND NEW.jurisdiction_region IS NOT NULL
                   AND (k.issuer_country IS NULL OR NEW.jurisdiction_country = k.issuer_country))
           )
    ) THEN
        RAISE EXCEPTION 'The version jurisdiction does not satisfy the rules of its authority kind'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'operating_authority_versions_jurisdiction_rules';
    END IF;

    IF NEW.expires_on IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM public.authority_kinds AS k
         WHERE k.code = NEW.kind
           AND k.has_expiry
    ) THEN
        RAISE EXCEPTION 'An expiry date does not apply to this authority kind'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'operating_authority_versions_expiry_applicable';
    END IF;

    RETURN NEW;
END;
$$;

-- Version content is immutable. Only these one-way changes are permitted:
--   - effective_to: NULL -> value (a real-world change ends the version)
--   - record_status: active -> corrected, together with corrected_at and superseded_by_version_id
--     (a known-wrong version is superseded; it is NOT ended)
-- A corrected version is frozen entirely.
CREATE FUNCTION tes_security.guard_authority_version_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected authority version is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.authority_id IS DISTINCT FROM OLD.authority_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.number_display IS DISTINCT FROM OLD.number_display
       OR NEW.number_normalized IS DISTINCT FROM OLD.number_normalized
       OR NEW.normalization_rule_version IS DISTINCT FROM OLD.normalization_rule_version
       OR NEW.jurisdiction_country IS DISTINCT FROM OLD.jurisdiction_country
       OR NEW.jurisdiction_region IS DISTINCT FROM OLD.jurisdiction_region
       OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
       OR NEW.expires_on IS DISTINCT FROM OLD.expires_on
       OR NEW.version_reason IS DISTINCT FROM OLD.version_reason
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Authority version content is immutable; record a change or a correction as a new version'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended authority version cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a version; it must not set effective_to'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A new status period must belong to an ACTIVE (non-archived) authority record.
CREATE FUNCTION tes_security.guard_authority_status_period_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.operating_authorities AS a
         WHERE a.id = NEW.authority_id
           AND a.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A status period must belong to an active authority record'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'operating_authority_status_periods_authority_active';
    END IF;

    RETURN NEW;
END;
$$;

-- Status period content is immutable; same one-way changes as versions. A corrected period is frozen
-- and a correction never ends the period (no regulatory transition is invented).
CREATE FUNCTION tes_security.guard_authority_status_period_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected authority status period is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.authority_id IS DISTINCT FROM OLD.authority_id
       OR NEW.authority_status IS DISTINCT FROM OLD.authority_status
       OR NEW.period_reason IS DISTINCT FROM OLD.period_reason
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Authority status period content is immutable; record a transition or a correction as a new period'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended authority status period cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a status period; it must not set effective_to'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Every authority must have a current version and a current status period by the end of the
-- transaction that created it.
CREATE FUNCTION tes_security.require_authority_current_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.operating_authority_versions AS v
         WHERE v.authority_id = NEW.id
           AND v.record_status = 'active'
           AND v.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'An authority must have a current version'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'operating_authorities_require_current_version';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.operating_authority_status_periods AS p
         WHERE p.authority_id = NEW.id
           AND p.record_status = 'active'
           AND p.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'An authority must have a current status period'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'operating_authorities_require_current_status';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_authority_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_authority_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_authority_version_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_authority_version_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_authority_status_period_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_authority_status_period_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_authority_current_state() FROM PUBLIC;

CREATE TRIGGER operating_authorities_guard_update
BEFORE UPDATE ON public.operating_authorities
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_authority_update();

CREATE CONSTRAINT TRIGGER operating_authorities_require_current_state
AFTER INSERT ON public.operating_authorities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_authority_current_state();

CREATE TRIGGER operating_authority_versions_guard_insert
BEFORE INSERT ON public.operating_authority_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_authority_version_insert();

CREATE TRIGGER operating_authority_versions_guard_update
BEFORE UPDATE ON public.operating_authority_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_authority_version_update();

CREATE TRIGGER operating_authority_status_periods_guard_insert
BEFORE INSERT ON public.operating_authority_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_authority_status_period_insert();

CREATE TRIGGER operating_authority_status_periods_guard_update
BEFORE UPDATE ON public.operating_authority_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_authority_status_period_update();

CREATE TRIGGER operating_authorities_no_delete
BEFORE DELETE ON public.operating_authorities
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_authority_data_removal();

CREATE TRIGGER operating_authority_versions_no_delete
BEFORE DELETE ON public.operating_authority_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_authority_data_removal();

CREATE TRIGGER operating_authority_status_periods_no_delete
BEFORE DELETE ON public.operating_authority_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_authority_data_removal();

CREATE TRIGGER operating_authorities_no_truncate
BEFORE TRUNCATE ON public.operating_authorities
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_authority_data_removal();

CREATE TRIGGER operating_authority_versions_no_truncate
BEFORE TRUNCATE ON public.operating_authority_versions
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_authority_data_removal();

CREATE TRIGGER operating_authority_status_periods_no_truncate
BEFORE TRUNCATE ON public.operating_authority_status_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_authority_data_removal();


-- ============================================================
-- 6. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is deliberate and
-- object-specific. The runtime identity gets no DELETE and no TRUNCATE, may not rewrite version or
-- status-period content or authority identity, and has read-only access to the kind catalogue
-- (changed only by migrations).
-- ============================================================

REVOKE ALL
ON TABLE
    public.authority_kinds,
    public.operating_authorities,
    public.operating_authority_versions,
    public.operating_authority_status_periods
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.authority_kinds,
    public.operating_authorities,
    public.operating_authority_versions,
    public.operating_authority_status_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (organization_id, kind)
ON public.operating_authorities
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, archived_at, updated_at)
ON public.operating_authorities
TO "tes-backend@tes-production-510007.iam";

-- id is insertable so a correction can name its replacement before creating it.
GRANT INSERT (
    id,
    authority_id,
    organization_id,
    kind,
    number_display,
    number_normalized,
    normalization_rule_version,
    jurisdiction_country,
    jurisdiction_region,
    issued_on,
    expires_on,
    version_reason,
    effective_from
)
ON public.operating_authority_versions
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_version_id, updated_at)
ON public.operating_authority_versions
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id,
    authority_id,
    authority_status,
    period_reason,
    effective_from
)
ON public.operating_authority_status_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.operating_authority_status_periods
TO "tes-backend@tes-production-510007.iam";
