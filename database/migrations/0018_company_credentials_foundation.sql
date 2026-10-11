-- TES Companies: Company Credentials foundation (metadata and secret-reference structure ONLY)
-- Migration: 0018
--
-- Scope (additive only):
--   1. public.credential_categories          controlled catalogue of credential categories (seeded)
--   2. public.credential_systems             canonical portal / system registry (globally unambiguous names)
--   3. public.credential_system_aliases      alternate names, unique across the whole registry
--   4. public.company_credentials            stable credential identity: an Organization's account on one system
--   5. public.credential_status_periods      effective-dated credential status history
--   6. public.credential_verifications       append-only verification history
--   7. public.credential_secret_slots        secret / recovery / MFA slots: state and an opaque secret-store reference
--   8. tes_security trigger functions and two SYSTEM-only capabilities (catalogue rows only, granted to nobody)
--
-- NO SECRET VALUE IS STORED IN POSTGRESQL, EVER. Passwords, MFA seeds, backup codes, recovery PINs and security answers
-- belong to a dedicated secret store. This schema stores only metadata and an explicit slot state:
--   UNRESOLVED   a secret of this kind is expected but is not (yet) held anywhere TES can reach. This is the honest state
--                until the secret-store integration exists; it is NOT an insecure substitute.
--   STORED       a secret exists in the named secret store; secret_reference is an opaque RESOURCE NAME of that store, not
--                a value. A CHECK constrains the reference to the store's resource-name shape (GCP Secret Manager
--                projects/<id>/secrets/<name>[/versions/<n>]), so a pasted password does not fit the column.
--   RETIRED      superseded or no longer valid (the reference is kept so the stored version can be destroyed and audited).
-- There is no reveal path, no capability to reveal, and no column that could hold a secret. Nothing here is readable by
-- a browser. Master Register events never carry usernames, references or secrets (only table:id references).
--
-- Canonical system registry. A credential names a SYSTEM (ATIOS Alberta, TRACS Alberta, BVD, Motive, Samsara ...), never
-- free text. System names are globally unambiguous: display_name_normalized (lower-case, accents folded, punctuation
-- collapsed to single spaces) is UNIQUE, so "ATIOS Alberta", "ATIOS-Alberta" and "atios  alberta" are one system. An
-- alias is unique across ALL aliases and may not equal any other system's name (trigger, serialized with an advisory
-- lock). ATIOS and TRACS are different systems. The same username on two systems is never a duplicate. A system is
-- operated by an Organization (provider_organization_id) when known; the registry never invents provider Organizations.
--
-- Credential identity. A credential is the account an Organization holds on one system. One ACTIVE credential per
-- (Organization, system, normalized username). A changed or wrongly entered login is a NEW credential that points to the
-- one it replaces (replaces_credential_id, same Organization and system); the old credential is archived, never edited
-- or deleted, so status, verification and secret history stay attached to the account they described.
--
-- Access boundary. Credentials are SYSTEM-only. Category is a controlled classification stored with the credential so that
-- later category / team scoped grants can be added without changing this schema; authorization is by capability, never by
-- job title. Customers receive no access. Team ownership belongs to the later Teams / RBAC domain.
--
-- History conventions follow migrations 0012-0017: a status change ends the old period and starts a new one; a correction
-- marks the wrong period 'corrected' (never ended) with a deferred same-credential pointer to its replacement, which
-- inherits the business time. Verification rows are append-only facts; a verification entered in error is VOIDED
-- (one-way), never edited. Archive is RECORD lifecycle, not credential status.
--
-- Global Organization facts: no tenant column and no row-level security; visibility is enforced by the server. All new
-- functions are SECURITY INVOKER with a fixed search_path; none is SECURITY DEFINER. No DELETE or TRUNCATE is granted
-- and none is possible (triggers). No existing object is touched. Reuses tes_security.guard_active_organization (0016).


-- ============================================================
-- 1. Credential category catalogue
-- ============================================================

CREATE TABLE public.credential_categories (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT credential_categories_code_valid
        CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),

    CONSTRAINT credential_categories_display_name_not_blank
        CHECK (btrim(display_name) <> ''),

    CONSTRAINT credential_categories_sort_order_uq
        UNIQUE (sort_order)
);

INSERT INTO public.credential_categories (code, display_name, description, sort_order)
VALUES
    ('FLEET', 'Fleet', 'Fleet management, telematics and ELD systems.', 10),
    ('COMPLIANCE', 'Compliance', 'Regulatory compliance and safety systems.', 20),
    ('REGISTRATION', 'Registration', 'Registration, licensing and permit systems.', 30),
    ('INSURANCE', 'Insurance', 'Insurer, broker and workers'' compensation portals.', 40),
    ('ACCOUNTING', 'Accounting', 'Accounting, payroll and banking systems.', 50),
    ('FUEL', 'Fuel', 'Fuel card and fuel-tax systems.', 60),
    ('OTHER', 'Other', 'Systems that fit no other category.', 70);


-- ============================================================
-- 2. Canonical system registry
-- ============================================================

CREATE TABLE public.credential_systems (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    display_name text NOT NULL,
    -- Lower-case ASCII words separated by single spaces (accents folded, punctuation collapsed) - see header.
    display_name_normalized text NOT NULL,

    -- The Organization that operates the system, when known (never an invented Organization).
    provider_organization_id uuid
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    jurisdiction_country text,
    jurisdiction_region text,

    -- Public https sign-in page. No credentials, query string or fragment.
    login_url text,

    record_status text NOT NULL DEFAULT 'active',
    archived_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT credential_systems_display_name_not_blank
        CHECK (btrim(display_name) <> '' AND display_name = btrim(display_name)),

    CONSTRAINT credential_systems_name_normalized_valid
        CHECK (display_name_normalized ~ '^[a-z0-9]+( [a-z0-9]+)*$' AND length(display_name_normalized) <= 120),

    CONSTRAINT credential_systems_country_valid
        CHECK (jurisdiction_country IS NULL OR jurisdiction_country ~ '^[A-Z]{2}$'),

    CONSTRAINT credential_systems_region_valid
        CHECK (jurisdiction_region IS NULL OR (jurisdiction_region ~ '^[A-Z0-9]{1,8}$' AND jurisdiction_country IS NOT NULL)),

    CONSTRAINT credential_systems_login_url_valid
        CHECK (login_url IS NULL OR (length(login_url) <= 500 AND login_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]?#]*)?$')),

    CONSTRAINT credential_systems_record_status_valid
        CHECK (record_status IN ('active', 'archived')),

    CONSTRAINT credential_systems_archive_state_consistent
        CHECK (
            (record_status = 'archived' AND archived_at IS NOT NULL)
            OR
            (record_status = 'active' AND archived_at IS NULL)
        ),

    -- A canonical name is held once, forever (archived systems keep it): no two systems can be confused.
    CONSTRAINT credential_systems_name_normalized_uq
        UNIQUE (display_name_normalized)
);

CREATE INDEX credential_systems_provider_idx
    ON public.credential_systems (provider_organization_id)
    WHERE provider_organization_id IS NOT NULL;


-- ============================================================
-- 3. System aliases
-- ============================================================

CREATE TABLE public.credential_system_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    system_id uuid NOT NULL
        REFERENCES public.credential_systems(id)
        ON DELETE RESTRICT,

    alias_display text NOT NULL,
    alias_normalized text NOT NULL,

    record_status text NOT NULL DEFAULT 'active',
    retired_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT credential_system_aliases_display_not_blank
        CHECK (btrim(alias_display) <> '' AND alias_display = btrim(alias_display)),

    CONSTRAINT credential_system_aliases_normalized_valid
        CHECK (alias_normalized ~ '^[a-z0-9]+( [a-z0-9]+)*$' AND length(alias_normalized) <= 120),

    CONSTRAINT credential_system_aliases_record_status_valid
        CHECK (record_status IN ('active', 'retired')),

    CONSTRAINT credential_system_aliases_retire_state_consistent
        CHECK (
            (record_status = 'retired' AND retired_at IS NOT NULL)
            OR
            (record_status = 'active' AND retired_at IS NULL)
        )
);

-- An ACTIVE alias is unique across all systems (the additional "may not equal a system name" rule is the trigger).
CREATE UNIQUE INDEX credential_system_aliases_active_uq
    ON public.credential_system_aliases (alias_normalized)
    WHERE record_status = 'active';

CREATE INDEX credential_system_aliases_system_idx
    ON public.credential_system_aliases (system_id);


-- ============================================================
-- 4. Company credentials (stable identity)
-- ============================================================

CREATE TABLE public.company_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The company whose account this is.
    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    system_id uuid NOT NULL
        REFERENCES public.credential_systems(id)
        ON DELETE RESTRICT,

    category text NOT NULL
        REFERENCES public.credential_categories(code)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    -- The account identity on the system: as entered, and the comparison form (lower-case, trimmed).
    username_display text NOT NULL,
    username_normalized text NOT NULL,

    -- How the system's multi-factor sign-in works, when known (NULL = not recorded). Descriptive metadata only.
    mfa_method text,

    -- Set when this credential replaces an earlier one on the same system (changed or wrongly entered login).
    replaces_credential_id uuid,
    replacement_reason text,

    record_status text NOT NULL DEFAULT 'active',
    archived_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_credentials_username_display_not_blank
        CHECK (btrim(username_display) <> '' AND username_display = btrim(username_display) AND length(username_display) <= 254),

    CONSTRAINT company_credentials_username_normalized_valid
        CHECK (btrim(username_normalized) <> '' AND username_normalized = btrim(username_normalized) AND username_normalized = lower(username_normalized)),

    CONSTRAINT company_credentials_mfa_method_valid
        CHECK (mfa_method IS NULL OR mfa_method IN ('NONE', 'AUTHENTICATOR_APP', 'SMS', 'EMAIL', 'HARDWARE_KEY', 'OTHER')),

    CONSTRAINT company_credentials_replacement_state_consistent
        CHECK ((replaces_credential_id IS NULL) = (replacement_reason IS NULL)),

    CONSTRAINT company_credentials_replacement_reason_valid
        CHECK (replacement_reason IS NULL OR replacement_reason IN ('USERNAME_CHANGED', 'CORRECTION')),

    CONSTRAINT company_credentials_not_replacement_of_self
        CHECK (replaces_credential_id IS NULL OR replaces_credential_id <> id),

    CONSTRAINT company_credentials_record_status_valid
        CHECK (record_status IN ('active', 'archived')),

    CONSTRAINT company_credentials_archive_state_consistent
        CHECK (
            (record_status = 'archived' AND archived_at IS NOT NULL)
            OR
            (record_status = 'active' AND archived_at IS NULL)
        ),

    -- Targets of composite foreign keys.
    CONSTRAINT company_credentials_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT company_credentials_id_scope_uq
        UNIQUE (id, organization_id, system_id),

    CONSTRAINT company_credentials_replaces_fk
        FOREIGN KEY (replaces_credential_id, organization_id, system_id)
        REFERENCES public.company_credentials (id, organization_id, system_id)
        ON DELETE RESTRICT
);

-- One ACTIVE credential per Organization, system and username. The same username on another system is not a duplicate.
CREATE UNIQUE INDEX company_credentials_active_account_uq
    ON public.company_credentials (organization_id, system_id, username_normalized)
    WHERE record_status = 'active';

CREATE INDEX company_credentials_organization_idx
    ON public.company_credentials (organization_id, category);

CREATE INDEX company_credentials_system_idx
    ON public.company_credentials (system_id);


-- ============================================================
-- 5. Credential status periods
-- ============================================================

CREATE TABLE public.credential_status_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    credential_id uuid NOT NULL
        REFERENCES public.company_credentials(id)
        ON DELETE RESTRICT,

    credential_status text NOT NULL,
    period_reason text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT credential_status_periods_status_valid
        CHECK (credential_status IN ('ACTIVE', 'NEEDS_VERIFICATION', 'LOCKED', 'DISABLED')),

    CONSTRAINT credential_status_periods_reason_valid
        CHECK (period_reason IN ('INITIAL', 'TRANSITION', 'CORRECTION')),

    CONSTRAINT credential_status_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT credential_status_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT credential_status_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
        ),

    CONSTRAINT credential_status_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT credential_status_periods_id_credential_uq
        UNIQUE (id, credential_id),

    CONSTRAINT credential_status_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, credential_id)
        REFERENCES public.credential_status_periods (id, credential_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX credential_status_periods_current_uq
    ON public.credential_status_periods (credential_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX credential_status_periods_history_idx
    ON public.credential_status_periods (credential_id, effective_from);


-- ============================================================
-- 6. Verification history (append-only)
-- ============================================================

CREATE TABLE public.credential_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    credential_id uuid NOT NULL,
    organization_id uuid NOT NULL,

    outcome text NOT NULL,
    method text NOT NULL,

    -- When the verification happened (business time; never in the future).
    verified_at timestamptz NOT NULL,

    -- The TES actor who recorded it.
    recorded_by_actor_id uuid NOT NULL
        REFERENCES public.actors(id)
        ON DELETE RESTRICT,

    -- A verification entered in error is voided (one-way); it is never edited or deleted.
    record_status text NOT NULL DEFAULT 'active',
    voided_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT credential_verifications_credential_fk
        FOREIGN KEY (credential_id, organization_id)
        REFERENCES public.company_credentials (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT credential_verifications_outcome_valid
        CHECK (outcome IN ('VERIFIED', 'FAILED', 'LOCKED_OUT')),

    CONSTRAINT credential_verifications_method_valid
        CHECK (method IN ('MANUAL_LOGIN', 'PORTAL_CHECK', 'CLIENT_CONFIRMATION')),

    CONSTRAINT credential_verifications_record_status_valid
        CHECK (record_status IN ('active', 'voided')),

    CONSTRAINT credential_verifications_void_state_consistent
        CHECK (
            (record_status = 'active' AND voided_at IS NULL)
            OR
            (record_status = 'voided' AND voided_at IS NOT NULL)
        )
);

CREATE INDEX credential_verifications_history_idx
    ON public.credential_verifications (credential_id, verified_at);


-- ============================================================
-- 7. Secret / recovery / MFA slots (state and opaque reference only)
-- ============================================================

CREATE TABLE public.credential_secret_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    credential_id uuid NOT NULL,
    organization_id uuid NOT NULL,

    slot_kind text NOT NULL,
    secret_state text NOT NULL DEFAULT 'UNRESOLVED',

    -- Where the secret lives and the opaque resource name of it. NEVER a secret value.
    secret_store text,
    secret_reference text,

    stored_at timestamptz,
    retired_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT credential_secret_slots_credential_fk
        FOREIGN KEY (credential_id, organization_id)
        REFERENCES public.company_credentials (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT credential_secret_slots_kind_valid
        CHECK (slot_kind IN ('PASSWORD', 'MFA_SECRET', 'RECOVERY_EMAIL', 'RECOVERY_PHONE', 'RECOVERY_PIN',
                             'BACKUP_CODES', 'SECURITY_ANSWER', 'OTHER_RECOVERY')),

    CONSTRAINT credential_secret_slots_state_valid
        CHECK (secret_state IN ('UNRESOLVED', 'STORED', 'RETIRED')),

    CONSTRAINT credential_secret_slots_store_valid
        CHECK (secret_store IS NULL OR secret_store IN ('GCP_SECRET_MANAGER')),

    CONSTRAINT credential_secret_slots_reference_shape
        CHECK (secret_reference IS NULL OR (
            length(secret_reference) <= 400
            AND secret_reference ~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/[A-Za-z0-9_-]{1,255}(/versions/([0-9]+|latest))?$'
        )),

    CONSTRAINT credential_secret_slots_store_pair
        CHECK ((secret_store IS NULL) = (secret_reference IS NULL)),

    -- UNRESOLVED holds nothing; STORED holds a store, a reference and a time; RETIRED holds a retirement time.
    CONSTRAINT credential_secret_slots_state_consistent
        CHECK (
            (secret_state = 'UNRESOLVED' AND secret_reference IS NULL AND stored_at IS NULL AND retired_at IS NULL)
            OR
            (secret_state = 'STORED' AND secret_reference IS NOT NULL AND stored_at IS NOT NULL AND retired_at IS NULL)
            OR
            (secret_state = 'RETIRED' AND retired_at IS NOT NULL)
        )
);

-- At most one live (non-retired) PASSWORD and one live MFA_SECRET slot per credential.
CREATE UNIQUE INDEX credential_secret_slots_single_live_uq
    ON public.credential_secret_slots (credential_id, slot_kind)
    WHERE secret_state <> 'RETIRED' AND slot_kind IN ('PASSWORD', 'MFA_SECRET');

CREATE INDEX credential_secret_slots_credential_idx
    ON public.credential_secret_slots (credential_id, slot_kind);


-- ============================================================
-- 8. Integrity triggers
-- ============================================================

CREATE FUNCTION tes_security.prevent_credential_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Credential data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- System names: the canonical name may not equal any ACTIVE alias of ANOTHER system. Serialized per normalized name.
CREATE FUNCTION tes_security.guard_credential_system_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('credential_system_name:' || NEW.display_name_normalized, 0));

    IF EXISTS (
        SELECT 1
          FROM public.credential_system_aliases AS a
         WHERE a.alias_normalized = NEW.display_name_normalized
           AND a.record_status = 'active'
           AND a.system_id <> NEW.id
    ) THEN
        RAISE EXCEPTION 'This name is already an alias of another system'
            USING ERRCODE = '23505',
                  CONSTRAINT = 'credential_systems_name_not_alias';
    END IF;

    IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
        RAISE EXCEPTION 'Credential system identity is immutable'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Aliases: the alias may not equal any other system's canonical name; the system must be active.
CREATE FUNCTION tes_security.guard_credential_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.system_id IS DISTINCT FROM OLD.system_id
           OR NEW.alias_display IS DISTINCT FROM OLD.alias_display
           OR NEW.alias_normalized IS DISTINCT FROM OLD.alias_normalized
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
            RAISE EXCEPTION 'Alias content is immutable; retire the alias instead'
                USING ERRCODE = '55000';
        END IF;
        IF OLD.record_status = 'retired' THEN
            RAISE EXCEPTION 'A retired alias is frozen'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('credential_system_name:' || NEW.alias_normalized, 0));

    IF EXISTS (
        SELECT 1
          FROM public.credential_systems AS s
         WHERE s.display_name_normalized = NEW.alias_normalized
           AND s.id <> NEW.system_id
    ) THEN
        RAISE EXCEPTION 'This alias equals the name of another system'
            USING ERRCODE = '23505',
                  CONSTRAINT = 'credential_system_aliases_not_system_name';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.credential_systems AS s
         WHERE s.id = NEW.system_id
           AND s.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'An alias must belong to an active system'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'credential_system_aliases_system_active';
    END IF;

    RETURN NEW;
END;
$$;

-- A credential must name an ACTIVE system. Identity is immutable; category, MFA method and lifecycle may change.
CREATE FUNCTION tes_security.guard_company_credential_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.credential_systems AS s
         WHERE s.id = NEW.system_id
           AND s.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A credential must name an active system'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'company_credentials_system_active';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_company_credential_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.system_id IS DISTINCT FROM OLD.system_id
       OR NEW.username_display IS DISTINCT FROM OLD.username_display
       OR NEW.username_normalized IS DISTINCT FROM OLD.username_normalized
       OR NEW.replaces_credential_id IS DISTINCT FROM OLD.replaces_credential_id
       OR NEW.replacement_reason IS DISTINCT FROM OLD.replacement_reason
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Credential identity is immutable; a changed login is a new credential that replaces this one'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A status period belongs to an ACTIVE credential.
CREATE FUNCTION tes_security.guard_credential_status_period_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.company_credentials AS c
         WHERE c.id = NEW.credential_id
           AND c.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A status period must belong to an active credential'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'credential_status_periods_credential_active';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_credential_status_period_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected credential status period is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
       OR NEW.credential_status IS DISTINCT FROM OLD.credential_status
       OR NEW.period_reason IS DISTINCT FROM OLD.period_reason
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Credential status period content is immutable; record a transition or a correction as a new period'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended credential status period cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a credential status period'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Every credential has a current status period by the end of the transaction that created it.
CREATE FUNCTION tes_security.require_credential_current_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.credential_status_periods AS p
         WHERE p.credential_id = NEW.id
           AND p.record_status = 'active'
           AND p.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'A credential must have a current status period'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'company_credentials_require_current_status';
    END IF;

    RETURN NULL;
END;
$$;

-- Verifications: a new row needs an ACTIVE credential and is not dated in the future; rows are immutable except for the
-- one-way void.
CREATE FUNCTION tes_security.guard_credential_verification_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.company_credentials AS c
         WHERE c.id = NEW.credential_id
           AND c.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A verification must belong to an active credential'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'credential_verifications_credential_active';
    END IF;

    IF NEW.verified_at > clock_timestamp() THEN
        RAISE EXCEPTION 'A verification cannot be dated in the future'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'credential_verifications_not_future';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_credential_verification_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'voided' THEN
        RAISE EXCEPTION 'A voided verification is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.recorded_by_actor_id IS DISTINCT FROM OLD.recorded_by_actor_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'A verification is an immutable fact; void it if it was entered in error'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Secret slots: a slot belongs to an ACTIVE credential; kind and credential are immutable; state moves only
-- UNRESOLVED -> STORED -> RETIRED (or UNRESOLVED -> RETIRED); a stored reference is never rewritten; a retired slot is frozen.
CREATE FUNCTION tes_security.guard_credential_secret_slot_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.company_credentials AS c
         WHERE c.id = NEW.credential_id
           AND c.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A secret slot must belong to an active credential'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'credential_secret_slots_credential_active';
    END IF;

    IF NEW.secret_state <> 'UNRESOLVED' THEN
        RAISE EXCEPTION 'A secret slot starts UNRESOLVED; a reference is attached later'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'credential_secret_slots_starts_unresolved';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_credential_secret_slot_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.secret_state = 'RETIRED' THEN
        RAISE EXCEPTION 'A retired secret slot is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.slot_kind IS DISTINCT FROM OLD.slot_kind
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Secret slot identity is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.secret_state = 'UNRESOLVED' AND NEW.secret_state NOT IN ('UNRESOLVED', 'STORED', 'RETIRED') THEN
        RAISE EXCEPTION 'Invalid secret slot transition'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.secret_state = 'STORED' AND NEW.secret_state <> 'RETIRED' AND NEW.secret_state <> 'STORED' THEN
        RAISE EXCEPTION 'Invalid secret slot transition'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.secret_state = 'STORED' AND NEW.secret_state = 'STORED'
       AND (NEW.secret_store IS DISTINCT FROM OLD.secret_store
            OR NEW.secret_reference IS DISTINCT FROM OLD.secret_reference
            OR NEW.stored_at IS DISTINCT FROM OLD.stored_at)
    THEN
        RAISE EXCEPTION 'A stored secret reference is never rewritten; retire the slot and create a new one'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.secret_state = 'RETIRED'
       AND (NEW.secret_store IS DISTINCT FROM OLD.secret_store
            OR NEW.secret_reference IS DISTINCT FROM OLD.secret_reference
            OR NEW.stored_at IS DISTINCT FROM OLD.stored_at)
    THEN
        RAISE EXCEPTION 'Retiring a secret slot keeps its reference unchanged'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_credential_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_credential_system_name() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_credential_alias() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_credential_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_credential_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_credential_status_period_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_credential_status_period_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_credential_current_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_credential_verification_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_credential_verification_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_credential_secret_slot_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_credential_secret_slot_update() FROM PUBLIC;

CREATE TRIGGER credential_systems_guard_name
BEFORE INSERT OR UPDATE ON public.credential_systems
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_credential_system_name();

CREATE TRIGGER credential_systems_guard_active_organization
BEFORE INSERT ON public.credential_systems
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('provider_organization_id');

CREATE TRIGGER credential_system_aliases_guard
BEFORE INSERT OR UPDATE ON public.credential_system_aliases
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_credential_alias();

CREATE TRIGGER company_credentials_guard_insert
BEFORE INSERT ON public.company_credentials
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_credential_insert();

CREATE TRIGGER company_credentials_guard_active_organization
BEFORE INSERT ON public.company_credentials
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER company_credentials_guard_update
BEFORE UPDATE ON public.company_credentials
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_credential_update();

CREATE CONSTRAINT TRIGGER company_credentials_require_current_state
AFTER INSERT ON public.company_credentials
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_credential_current_state();

CREATE TRIGGER credential_status_periods_guard_insert
BEFORE INSERT ON public.credential_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_credential_status_period_insert();

CREATE TRIGGER credential_status_periods_guard_update
BEFORE UPDATE ON public.credential_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_credential_status_period_update();

CREATE TRIGGER credential_verifications_guard_insert
BEFORE INSERT ON public.credential_verifications
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_credential_verification_insert();

CREATE TRIGGER credential_verifications_guard_update
BEFORE UPDATE ON public.credential_verifications
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_credential_verification_update();

CREATE TRIGGER credential_secret_slots_guard_insert
BEFORE INSERT ON public.credential_secret_slots
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_credential_secret_slot_insert();

CREATE TRIGGER credential_secret_slots_guard_update
BEFORE UPDATE ON public.credential_secret_slots
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_credential_secret_slot_update();

CREATE TRIGGER credential_systems_no_delete
BEFORE DELETE ON public.credential_systems
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_system_aliases_no_delete
BEFORE DELETE ON public.credential_system_aliases
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER company_credentials_no_delete
BEFORE DELETE ON public.company_credentials
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_status_periods_no_delete
BEFORE DELETE ON public.credential_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_verifications_no_delete
BEFORE DELETE ON public.credential_verifications
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_secret_slots_no_delete
BEFORE DELETE ON public.credential_secret_slots
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_systems_no_truncate
BEFORE TRUNCATE ON public.credential_systems
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_system_aliases_no_truncate
BEFORE TRUNCATE ON public.credential_system_aliases
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER company_credentials_no_truncate
BEFORE TRUNCATE ON public.company_credentials
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_status_periods_no_truncate
BEFORE TRUNCATE ON public.credential_status_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_verifications_no_truncate
BEFORE TRUNCATE ON public.credential_verifications
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();

CREATE TRIGGER credential_secret_slots_no_truncate
BEFORE TRUNCATE ON public.credential_secret_slots
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_credential_data_removal();


-- ============================================================
-- 9. Capabilities (catalogue rows only)
--
-- Capability existence and assignment are separate: this migration creates no relationship, assignment or grant. Both are
-- SYSTEM-only; customers receive no access to credentials. No capability reveals a secret, because no secret exists here.
-- ============================================================

INSERT INTO public.capabilities (code, display_name, description, is_active, sort_order)
VALUES
    (
        'CREDENTIAL_READ',
        'Read Company Credentials',
        'SYSTEM-wide read access to company credential metadata: systems, accounts, status and verification history and secret-slot state. Never returns a secret. Intended scope: SYSTEM only.',
        true,
        150
    ),
    (
        'CREDENTIAL_MANAGE',
        'Manage Company Credentials',
        'Maintain the canonical system registry and company credential metadata: create, replace, archive and verify credentials, record status changes and attach secret-store references. Never handles secret values. Intended scope: SYSTEM only.',
        true,
        160
    );


-- ============================================================
-- 10. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is deliberate and object-specific. The runtime
-- identity gets no DELETE and no TRUNCATE, may not rewrite identity, and has read-only access to the category catalogue.
-- ============================================================

REVOKE ALL
ON TABLE
    public.credential_categories,
    public.credential_systems,
    public.credential_system_aliases,
    public.company_credentials,
    public.credential_status_periods,
    public.credential_verifications,
    public.credential_secret_slots
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.credential_categories,
    public.credential_systems,
    public.credential_system_aliases,
    public.company_credentials,
    public.credential_status_periods,
    public.credential_verifications,
    public.credential_secret_slots
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, display_name, display_name_normalized, provider_organization_id, jurisdiction_country, jurisdiction_region, login_url)
ON public.credential_systems
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (display_name, display_name_normalized, provider_organization_id, jurisdiction_country, jurisdiction_region, login_url, record_status, archived_at, updated_at)
ON public.credential_systems
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, system_id, alias_display, alias_normalized)
ON public.credential_system_aliases
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, retired_at, updated_at)
ON public.credential_system_aliases
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, system_id, category, username_display, username_normalized, mfa_method, replaces_credential_id, replacement_reason)
ON public.company_credentials
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (category, mfa_method, record_status, archived_at, updated_at)
ON public.company_credentials
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, credential_id, credential_status, period_reason, effective_from)
ON public.credential_status_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.credential_status_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, credential_id, organization_id, outcome, method, verified_at, recorded_by_actor_id)
ON public.credential_verifications
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, voided_at, updated_at)
ON public.credential_verifications
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, credential_id, organization_id, slot_kind)
ON public.credential_secret_slots
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (secret_state, secret_store, secret_reference, stored_at, retired_at, updated_at)
ON public.credential_secret_slots
TO "tes-backend@tes-production-510007.iam";
