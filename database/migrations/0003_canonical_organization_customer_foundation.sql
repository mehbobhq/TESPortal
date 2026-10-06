-- TES canonical organization and customer/tenant foundation
-- Migration: 0003
--
-- Scope:
--   - canonical organization identity
--   - organization identifiers and aliases
--   - evolvable organization classifications
--   - permanent customer/tenant identity
--   - historical customer engagement periods
--
-- This migration intentionally does NOT introduce:
--   - prospect/commercial models
--   - authentication/authorization
--   - tenant-owned operational records
--   - credentials/secrets
--   - Master Register
--   - hard-delete privileges for the runtime identity


-- ============================================================
-- 1. Canonical organizations
-- ============================================================

CREATE TABLE public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    legal_name text NOT NULL,
    display_name text,
    normalized_legal_name text NOT NULL,

    status text NOT NULL DEFAULT 'active',

    country_code text,
    region_code text,

    merged_into_organization_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,

    CONSTRAINT organizations_legal_name_not_blank
        CHECK (btrim(legal_name) <> ''),

    CONSTRAINT organizations_normalized_legal_name_not_blank
        CHECK (btrim(normalized_legal_name) <> ''),

    CONSTRAINT organizations_status_valid
        CHECK (status IN ('active', 'archived', 'merged')),

    CONSTRAINT organizations_merge_target_fk
        FOREIGN KEY (merged_into_organization_id)
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    CONSTRAINT organizations_not_merged_into_self
        CHECK (
            merged_into_organization_id IS NULL
            OR merged_into_organization_id <> id
        ),

    CONSTRAINT organizations_merge_state_consistent
        CHECK (
            (status = 'merged' AND merged_into_organization_id IS NOT NULL)
            OR
            (status <> 'merged' AND merged_into_organization_id IS NULL)
        ),

    CONSTRAINT organizations_archive_state_consistent
        CHECK (
            (status = 'archived' AND archived_at IS NOT NULL)
            OR
            (status <> 'archived' AND archived_at IS NULL)
        )
);

CREATE INDEX organizations_normalized_legal_name_idx
    ON public.organizations (normalized_legal_name);

CREATE INDEX organizations_status_idx
    ON public.organizations (status);


-- ============================================================
-- 2. Organization identifiers
-- ============================================================

CREATE TABLE public.organization_identifiers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    identifier_type text NOT NULL,
    namespace text NOT NULL,

    jurisdiction_country text,
    jurisdiction_region text,

    value text NOT NULL,
    normalized_value text NOT NULL,

    normalization_rule_version text,

    verification_status text NOT NULL DEFAULT 'unverified',
    verified_at timestamptz,

    status text NOT NULL DEFAULT 'active',
    superseded_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT organization_identifiers_type_not_blank
        CHECK (btrim(identifier_type) <> ''),

    CONSTRAINT organization_identifiers_namespace_not_blank
        CHECK (btrim(namespace) <> ''),

    CONSTRAINT organization_identifiers_value_not_blank
        CHECK (btrim(value) <> ''),

    CONSTRAINT organization_identifiers_normalized_value_not_blank
        CHECK (btrim(normalized_value) <> ''),

    CONSTRAINT organization_identifiers_status_valid
        CHECK (status IN ('active', 'superseded')),

    CONSTRAINT organization_identifiers_superseded_state_consistent
        CHECK (
            (status = 'superseded' AND superseded_at IS NOT NULL)
            OR
            (status = 'active' AND superseded_at IS NULL)
        )
);

CREATE UNIQUE INDEX organization_identifiers_active_identity_uq
    ON public.organization_identifiers (
        lower(btrim(namespace)),
        lower(btrim(identifier_type)),
        upper(btrim(jurisdiction_country)),
        upper(btrim(jurisdiction_region)),
        normalized_value
    )
    NULLS NOT DISTINCT
    WHERE status = 'active';


-- ============================================================
-- 3. Organization aliases
-- ============================================================

CREATE TABLE public.organization_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    alias text NOT NULL,
    normalized_alias text NOT NULL,
    alias_type text,

    status text NOT NULL DEFAULT 'active',

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT organization_aliases_alias_not_blank
        CHECK (btrim(alias) <> ''),

    CONSTRAINT organization_aliases_normalized_alias_not_blank
        CHECK (btrim(normalized_alias) <> ''),

    CONSTRAINT organization_aliases_status_valid
        CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX organization_aliases_current_per_org_uq
    ON public.organization_aliases (
        organization_id,
        normalized_alias,
        alias_type
    )
    NULLS NOT DISTINCT
    WHERE status = 'active';

CREATE INDEX organization_aliases_normalized_alias_idx
    ON public.organization_aliases (normalized_alias);


-- ============================================================
-- 4. Organization classification vocabulary
-- ============================================================

CREATE TABLE public.organization_classification_types (
    code text PRIMARY KEY,

    display_name text NOT NULL,
    description text,

    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT organization_classification_types_code_not_blank
        CHECK (btrim(code) <> ''),

    CONSTRAINT organization_classification_types_display_name_not_blank
        CHECK (btrim(display_name) <> '')
);

INSERT INTO public.organization_classification_types (
    code,
    display_name,
    sort_order
)
VALUES
    ('owner_operator', 'Owner Operator', 10),
    ('service_provider', 'Service Provider', 20),
    ('finance_leasing_company', 'Finance / Leasing Company', 30),
    ('insurance_broker', 'Insurance Broker', 40),
    ('insurance_company', 'Insurance Company', 50),
    ('workers_insurance', 'Workers Insurance', 60),
    ('employee_reference', 'Employee Reference', 70),
    ('government_agency', 'Government Agency', 80),
    ('sub_contractor', 'Sub Contractor', 90),
    ('other', 'Other', 100);


-- ============================================================
-- 5. Organization classifications
-- ============================================================

CREATE TABLE public.organization_classifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    classification_code text NOT NULL
        REFERENCES public.organization_classification_types(code)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    is_primary boolean NOT NULL DEFAULT false,

    effective_from timestamptz NOT NULL DEFAULT now(),
    effective_to timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT organization_classifications_dates_valid
        CHECK (
            effective_to IS NULL
            OR effective_to >= effective_from
        )
);

CREATE UNIQUE INDEX organization_classifications_current_type_uq
    ON public.organization_classifications (
        organization_id,
        classification_code
    )
    WHERE effective_to IS NULL;

CREATE UNIQUE INDEX organization_classifications_current_primary_uq
    ON public.organization_classifications (organization_id)
    WHERE is_primary = true
      AND effective_to IS NULL;

CREATE INDEX organization_classifications_organization_idx
    ON public.organization_classifications (organization_id);


-- ============================================================
-- 6. Permanent customer / tenant identity
-- ============================================================

CREATE TABLE public.customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL UNIQUE
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    created_at timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- 7. Customer engagement history
-- ============================================================

CREATE TABLE public.customer_engagements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    customer_id uuid NOT NULL
        REFERENCES public.customers(id)
        ON DELETE RESTRICT,

    started_at timestamptz NOT NULL,
    ended_at timestamptz,

    end_reason text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT customer_engagements_dates_valid
        CHECK (
            ended_at IS NULL
            OR ended_at >= started_at
        ),

    CONSTRAINT customer_engagements_end_reason_consistent
        CHECK (
            ended_at IS NOT NULL
            OR end_reason IS NULL
        )
);

CREATE UNIQUE INDEX customer_engagements_one_open_uq
    ON public.customer_engagements (customer_id)
    WHERE ended_at IS NULL;

CREATE INDEX customer_engagements_customer_idx
    ON public.customer_engagements (customer_id);

CREATE INDEX customer_engagements_started_at_idx
    ON public.customer_engagements (started_at);


-- ============================================================
-- Runtime privileges
--
-- 0002 removed automatic runtime privileges.
-- Everything below is therefore deliberate and object-specific.
--
-- Runtime receives no DELETE or TRUNCATE privileges.
-- Identity anchors are excluded from UPDATE privileges.
-- ============================================================

GRANT SELECT
ON TABLE
    public.organizations,
    public.organization_identifiers,
    public.organization_aliases,
    public.organization_classification_types,
    public.organization_classifications,
    public.customers,
    public.customer_engagements
TO "tes-backend@tes-production-510007.iam";


-- Organizations:
-- Runtime may create organizations, but UUID/timestamps are generated by DB.

GRANT INSERT (
    legal_name,
    display_name,
    normalized_legal_name,
    status,
    country_code,
    region_code,
    archived_at
)
ON public.organizations
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (
    legal_name,
    display_name,
    normalized_legal_name,
    status,
    country_code,
    region_code,
    updated_at,
    archived_at
)
ON public.organizations
TO "tes-backend@tes-production-510007.iam";


-- Organization identifiers:
-- Identity-defining fields cannot be rewritten by runtime after creation.
-- Corrections use supersession + a new identifier record.

GRANT INSERT (
    organization_id,
    identifier_type,
    namespace,
    jurisdiction_country,
    jurisdiction_region,
    value,
    normalized_value,
    normalization_rule_version,
    verification_status,
    verified_at,
    status,
    superseded_at
)
ON public.organization_identifiers
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (
    verification_status,
    verified_at,
    status,
    superseded_at,
    updated_at
)
ON public.organization_identifiers
TO "tes-backend@tes-production-510007.iam";


-- Organization aliases:
-- Aliases are searchable metadata rather than canonical identity anchors.

GRANT INSERT (
    organization_id,
    alias,
    normalized_alias,
    alias_type,
    status
)
ON public.organization_aliases
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (
    alias,
    normalized_alias,
    alias_type,
    status,
    updated_at
)
ON public.organization_aliases
TO "tes-backend@tes-production-510007.iam";


-- Classification vocabulary is migration-controlled.
-- Runtime has SELECT only on organization_classification_types.


-- Organization classifications:
-- organization_id and classification_code remain immutable after creation.
-- Lifecycle is represented through effective dates.

GRANT INSERT (
    organization_id,
    classification_code,
    is_primary,
    effective_from,
    effective_to
)
ON public.organization_classifications
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (
    is_primary,
    effective_to,
    updated_at
)
ON public.organization_classifications
TO "tes-backend@tes-production-510007.iam";


-- Customers:
-- Permanent tenant identity.
-- Runtime may create the relationship once but cannot rewrite it.

GRANT INSERT (organization_id)
ON public.customers
TO "tes-backend@tes-production-510007.iam";


-- Customer engagements:
-- customer_id and started_at are immutable after creation.
-- Runtime may close an engagement but not rewrite its identity/history start.

GRANT INSERT (
    customer_id,
    started_at,
    ended_at,
    end_reason
)
ON public.customer_engagements
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (
    ended_at,
    end_reason,
    updated_at
)
ON public.customer_engagements
TO "tes-backend@tes-production-510007.iam";
