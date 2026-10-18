-- TES Companies: company and customer profile facts (cargo categories, fleet providers, billing preference)
-- Migration: 0033
--
-- Scope (additive only; migrations 0001-0032 are not edited):
--   1. public.cargo_categories                         controlled catalogue of descriptive cargo categories (seeded, 6 rows)
--   2. public.billing_payment_methods                  controlled catalogue of billing payment method names (seeded, 4 rows)
--   3. public.company_cargo_category_periods           effective-dated cargo categories a company carries (company operating profile)
--   4. public.fleet_service_categories                 controlled catalogue of fleet service categories: ELD/HOS, GPS/Telematics, Fuel Services (seeded, 3 rows)
--   5. public.company_fleet_providers                  one identity row per provider NAME a company uses (never an Organization)
--   6. public.company_fleet_provider_periods           effective-dated assignment of a provider to a service category (company operating profile)
--   7. public.customer_billing_preference_periods      effective-dated preferred billing payment method of a Customer (customer relationship)
--   8. integrity triggers, row-level security policies and column-level runtime grants for the new tables
--
-- WHY THESE ARE THEIR OWN TYPED TABLES. The company creation form collects Cargo Information, Truck GPS Provider, Fuel Provider and
-- Payment Method. None had a canonical owner (docs/recovery/canonical-field-ownership.md, class C). Migration 0019 states there is
-- deliberately NO generic key/value settings table, so each is a typed, validated, effective-dated fact with correction history:
--
--   Cargo categories   DESCRIPTIVE. "This company hauls general freight." They are NOT a compliance claim: they never assert that a
--                      regulation applies (that is company_rule_applicability_periods, 0019, whose rules are jurisdiction specific
--                      and are never derived from these categories). The catalogue is the six categories of the original form.
--                      A company may carry several at once, so the unit of history is one category membership, not a list.
--   Fleet providers    The NAME the company gives for a provider of a fleet service. Names only: creating one never creates an
--                      Organization, a credential or a registry entry (a future migration may link a name to an Organization
--                      additively). Three distinct service categories exist - ELD/HOS, GPS/Telematics and Fuel Services - because
--                      one vendor commonly supplies several of them and a company may use different vendors for each. A provider
--                      is ONE identity row per company (company_fleet_providers); each category it serves is its own
--                      effective-dated period (company_fleet_provider_periods), so the identity is never duplicated, and replacing
--                      FleetHunt with Motive for one category ends one period and starts another while the history is kept.
--                      Today one current provider per company and category (assignment_scope = 'COMPANY'). A fleet may in future
--                      use different vendors per vehicle: that is an ADDITIVE extension of the same period table (relax the
--                      assignment_scope check, add a vehicle reference and widen the current-uniqueness index and the no-overlap constraint) and needs no
--                      change to the identity table or to existing rows.
--   Billing preference The payment method a Customer PREFERS to be billed by. It is explicitly NOT contractual payment terms
--                      (those live in the contract model, 0030/0031, and are decided by the Service Decision Authority), NOT a
--                      payment transaction, and holds no account, card or bank detail. Controlled names only. Customers only.
--
-- NOT HERE (and why). Service Type is contract-governed (a package on a signed contract line, 0031) and is only DISPLAYED, derived
-- from the contract. Service Status is the engagement stage (0015). Assessment Date is the latest readiness snapshot (0030). End
-- Date is the engagement termination workflow (0015). None of those is written by this migration.
--
-- History conventions follow 0015/0019: a REAL-WORLD change ends the old row and starts a new one; a CORRECTION marks the wrong row
-- 'corrected' with a deferred same-subject pointer to its replacement (which inherits its business time); 'voided' is an entry made
-- in error with no replacement. Frozen once corrected or voided. Nothing is ever deleted: DELETE and TRUNCATE are refused by trigger.
--
-- Global Organization facts, SYSTEM only: row-level security admits SYSTEM capabilities only (the existing COMPANY_PROFILE_* and
-- CUSTOMER_RELATIONSHIP_* capabilities; no capability is added). There is no CUSTOMER-facing read. All functions are SECURITY
-- INVOKER with a fixed search_path; none is SECURITY DEFINER. Existing functions are reused, not replaced:
-- tes_security.guard_active_organization (0016) and tes_security.prevent_company_profile_data_removal (0019).


-- ============================================================
-- 1. Controlled catalogues
-- ============================================================

CREATE TABLE public.cargo_categories (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    CONSTRAINT cargo_categories_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    CONSTRAINT cargo_categories_display_name_not_blank CHECK (btrim(display_name) <> '')
);

INSERT INTO public.cargo_categories (code, display_name, sort_order)
VALUES
    ('GENERAL_FREIGHT', 'General Freight', 10),
    ('SPECIALIZED_EQUIPMENT', 'Specialized Equipment', 20),
    ('HOUSEHOLD_GOODS', 'Household Goods', 30),
    ('TEMPERATURE_CONTROLLED_FOOD', 'Temperature-Controlled & Food', 40),
    ('HAZARDOUS_MATERIALS', 'Hazardous Materials', 50),
    ('BULK_OTHER', 'Bulk & Other', 60);

CREATE TABLE public.billing_payment_methods (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    CONSTRAINT billing_payment_methods_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    CONSTRAINT billing_payment_methods_display_name_not_blank CHECK (btrim(display_name) <> '')
);

INSERT INTO public.billing_payment_methods (code, display_name, sort_order)
VALUES
    ('E_TRANSFER', 'E-Transfer', 10),
    ('CREDIT_CARD', 'Credit Card', 20),
    ('WIRE_TRANSFER', 'Wire Transfer', 30),
    ('CHEQUE', 'Cheque', 40);


-- ============================================================
-- 2. Cargo category periods
-- ============================================================

CREATE TABLE public.company_cargo_category_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    cargo_category_code text NOT NULL
        REFERENCES public.cargo_categories(code)
        ON DELETE RESTRICT,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_cargo_category_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT company_cargo_category_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT company_cargo_category_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NULL)
        ),

    CONSTRAINT company_cargo_category_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT company_cargo_category_periods_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT company_cargo_category_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, organization_id)
        REFERENCES public.company_cargo_category_periods (id, organization_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one current membership per company and category.
CREATE UNIQUE INDEX company_cargo_category_periods_current_uq
    ON public.company_cargo_category_periods (organization_id, cargo_category_code)
    WHERE record_status = 'active' AND effective_to IS NULL;

-- No two ACTIVE periods of the same company and cargo category may overlap in time, closed or current (same semantics and reasoning as
-- company_fleet_provider_periods_no_overlap below: half-open ranges allow an exact hand-over; corrected and voided rows are no longer
-- 'active' and never block their replacement or a fresh period; different categories may be active at once). Requires btree_gist (0023).
ALTER TABLE public.company_cargo_category_periods
    ADD CONSTRAINT company_cargo_category_periods_no_overlap
    EXCLUDE USING gist (
        organization_id WITH =,
        cargo_category_code WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
    )
    WHERE (record_status = 'active');

CREATE INDEX company_cargo_category_periods_history_idx
    ON public.company_cargo_category_periods (organization_id, effective_from);


-- ============================================================
-- 3. Fleet service categories, provider identities and provider periods
-- ============================================================

CREATE TABLE public.fleet_service_categories (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    CONSTRAINT fleet_service_categories_code_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    CONSTRAINT fleet_service_categories_display_name_not_blank CHECK (btrim(display_name) <> '')
);

INSERT INTO public.fleet_service_categories (code, display_name, sort_order)
VALUES
    ('ELD_HOS', 'ELD / Hours of Service', 10),
    ('GPS_TELEMATICS', 'GPS / Telematics', 20),
    ('FUEL_SERVICES', 'Fuel Card / Fuel Services', 30);

-- One identity per provider NAME per company. The name is a label, not an Organization. Immutable: a misspelt name is corrected
-- by voiding the period that uses it and recording the right name; an unused identity row is harmless and is never shown.
CREATE TABLE public.company_fleet_providers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    provider_name text NOT NULL,
    provider_name_normalized text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_fleet_providers_name_valid
        CHECK (
            provider_name = btrim(provider_name)
            AND char_length(provider_name) BETWEEN 1 AND 120
            AND provider_name !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
        ),

    CONSTRAINT company_fleet_providers_name_normalized_valid
        CHECK (btrim(provider_name_normalized) <> '' AND char_length(provider_name_normalized) <= 120),

    CONSTRAINT company_fleet_providers_name_uq
        UNIQUE (organization_id, provider_name_normalized),

    CONSTRAINT company_fleet_providers_id_organization_uq
        UNIQUE (id, organization_id)
);

CREATE TABLE public.company_fleet_provider_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    provider_id uuid NOT NULL,

    service_category_code text NOT NULL
        REFERENCES public.fleet_service_categories(code)
        ON DELETE RESTRICT,

    -- Today the provider serves the whole company for the category. A per-vehicle assignment is a future additive extension
    -- (see the header); until then the only admitted scope is COMPANY.
    assignment_scope text NOT NULL DEFAULT 'COMPANY',

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_fleet_provider_periods_provider_fk
        FOREIGN KEY (provider_id, organization_id)
        REFERENCES public.company_fleet_providers (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT company_fleet_provider_periods_scope_valid
        CHECK (assignment_scope = 'COMPANY'),

    CONSTRAINT company_fleet_provider_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT company_fleet_provider_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT company_fleet_provider_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NULL)
        ),

    CONSTRAINT company_fleet_provider_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT company_fleet_provider_periods_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT company_fleet_provider_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, organization_id)
        REFERENCES public.company_fleet_provider_periods (id, organization_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one current provider per company, service category and scope.
CREATE UNIQUE INDEX company_fleet_provider_periods_current_uq
    ON public.company_fleet_provider_periods (organization_id, service_category_code, assignment_scope)
    WHERE record_status = 'active' AND effective_to IS NULL;

-- No two ACTIVE periods of the same company, service category and scope may overlap in time, closed or current. Half-open ranges
-- [from, to) make a clean hand-over (the old provider ends at exactly the instant the new one starts) legal while any real overlap is
-- refused by the database itself, whatever path wrote it. A corrected or voided row is no longer 'active', so it never blocks its
-- replacement (a correction marks the wrong row first and then inserts the right one with the same window), and history is untouched.
-- Different categories (one vendor serving several), different companies and, in future, different scopes never conflict.
-- Requires btree_gist, which migration 0023 creates.
ALTER TABLE public.company_fleet_provider_periods
    ADD CONSTRAINT company_fleet_provider_periods_no_overlap
    EXCLUDE USING gist (
        organization_id WITH =,
        service_category_code WITH =,
        assignment_scope WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
    )
    WHERE (record_status = 'active');

CREATE INDEX company_fleet_provider_periods_history_idx
    ON public.company_fleet_provider_periods (organization_id, service_category_code, effective_from);

CREATE INDEX company_fleet_provider_periods_provider_idx
    ON public.company_fleet_provider_periods (provider_id);


-- ============================================================
-- 4. Customer billing preference periods
-- ============================================================

CREATE TABLE public.customer_billing_preference_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    payment_method_code text NOT NULL
        REFERENCES public.billing_payment_methods(code)
        ON DELETE RESTRICT,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT customer_billing_preference_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT customer_billing_preference_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected', 'voided')),

    CONSTRAINT customer_billing_preference_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
            OR
            (record_status = 'voided' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NULL)
        ),

    CONSTRAINT customer_billing_preference_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT customer_billing_preference_periods_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT customer_billing_preference_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, organization_id)
        REFERENCES public.customer_billing_preference_periods (id, organization_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one current preference per Customer.
CREATE UNIQUE INDEX customer_billing_preference_periods_current_uq
    ON public.customer_billing_preference_periods (organization_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

-- A Customer has at most one ACTIVE billing preference at any moment: no two active periods of the same company may overlap, closed or
-- current. Half-open ranges allow an exact hand-over to a new preference; corrected and voided rows are excluded, so history, corrections
-- and voids are untouched. This is a preference only: it never constrains contract payment terms or payment transactions.
ALTER TABLE public.customer_billing_preference_periods
    ADD CONSTRAINT customer_billing_preference_periods_no_overlap
    EXCLUDE USING gist (
        organization_id WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
    )
    WHERE (record_status = 'active');

CREATE INDEX customer_billing_preference_periods_history_idx
    ON public.customer_billing_preference_periods (organization_id, effective_from);


-- ============================================================
-- 5. Integrity triggers
-- ============================================================

-- A cargo category may only be recorded against an ACTIVE catalogue entry.
CREATE FUNCTION tes_security.guard_company_cargo_category_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.cargo_categories AS c
         WHERE c.code = NEW.cargo_category_code
           AND c.is_active
    ) THEN
        RAISE EXCEPTION 'The cargo category is not an active catalogue category'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'company_cargo_category_periods_category_active';
    END IF;

    RETURN NEW;
END;
$$;

-- A billing preference may only be recorded against an ACTIVE payment method, and only for a Customer.
CREATE FUNCTION tes_security.guard_customer_billing_preference_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.billing_payment_methods AS m
         WHERE m.code = NEW.payment_method_code
           AND m.is_active
    ) THEN
        RAISE EXCEPTION 'The payment method is not an active catalogue method'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_billing_preference_periods_method_active';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.customers AS c
         WHERE c.organization_id = NEW.organization_id
    ) THEN
        RAISE EXCEPTION 'A billing preference can only be recorded for a Customer'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'customer_billing_preference_periods_customer_exists';
    END IF;

    RETURN NEW;
END;
$$;

-- Shared update guard for the three period tables. TG_ARGV names the columns whose content is immutable. A corrected or voided
-- row is frozen; an ended row cannot be re-dated; a correction or void never ends a period.
CREATE FUNCTION tes_security.guard_company_fact_period_update()
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

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended % row cannot be re-dated', TG_TABLE_NAME
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status <> 'active' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a % row', TG_TABLE_NAME
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A fleet provider period may only be recorded against an ACTIVE service category.
CREATE FUNCTION tes_security.guard_company_fleet_provider_period_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.fleet_service_categories AS c
         WHERE c.code = NEW.service_category_code
           AND c.is_active
    ) THEN
        RAISE EXCEPTION 'The fleet service category is not an active catalogue category'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'company_fleet_provider_periods_category_active';
    END IF;

    RETURN NEW;
END;
$$;

-- A provider identity row is never rewritten.
CREATE FUNCTION tes_security.prevent_company_fleet_provider_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION '% content is immutable; record the right name as a new provider', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION tes_security.guard_company_fleet_provider_period_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.prevent_company_fleet_provider_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_cargo_category_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_customer_billing_preference_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_fact_period_update() FROM PUBLIC;

CREATE TRIGGER company_cargo_category_periods_guard_active_organization
BEFORE INSERT ON public.company_cargo_category_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER company_fleet_provider_periods_guard_active_organization
BEFORE INSERT ON public.company_fleet_provider_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER company_fleet_providers_guard_active_organization
BEFORE INSERT ON public.company_fleet_providers
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER company_fleet_provider_periods_guard_insert
BEFORE INSERT ON public.company_fleet_provider_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_fleet_provider_period_insert();

CREATE TRIGGER company_fleet_providers_no_update
BEFORE UPDATE ON public.company_fleet_providers
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_company_fleet_provider_update();

CREATE TRIGGER company_fleet_providers_no_delete
BEFORE DELETE ON public.company_fleet_providers
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_fleet_providers_no_truncate
BEFORE TRUNCATE ON public.company_fleet_providers
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER customer_billing_preference_periods_guard_active_organization
BEFORE INSERT ON public.customer_billing_preference_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER company_cargo_category_periods_guard_insert
BEFORE INSERT ON public.company_cargo_category_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_cargo_category_insert();

CREATE TRIGGER customer_billing_preference_periods_guard_insert
BEFORE INSERT ON public.customer_billing_preference_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_customer_billing_preference_insert();

CREATE TRIGGER company_cargo_category_periods_guard_update
BEFORE UPDATE ON public.company_cargo_category_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_fact_period_update('organization_id', 'cargo_category_code', 'effective_from', 'created_at');

CREATE TRIGGER company_fleet_provider_periods_guard_update
BEFORE UPDATE ON public.company_fleet_provider_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_fact_period_update('organization_id', 'provider_id', 'service_category_code', 'assignment_scope', 'effective_from', 'created_at');

CREATE TRIGGER customer_billing_preference_periods_guard_update
BEFORE UPDATE ON public.customer_billing_preference_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_fact_period_update('organization_id', 'payment_method_code', 'effective_from', 'created_at');

CREATE TRIGGER company_cargo_category_periods_no_delete
BEFORE DELETE ON public.company_cargo_category_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_fleet_provider_periods_no_delete
BEFORE DELETE ON public.company_fleet_provider_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER customer_billing_preference_periods_no_delete
BEFORE DELETE ON public.customer_billing_preference_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_cargo_category_periods_no_truncate
BEFORE TRUNCATE ON public.company_cargo_category_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_fleet_provider_periods_no_truncate
BEFORE TRUNCATE ON public.company_fleet_provider_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER customer_billing_preference_periods_no_truncate
BEFORE TRUNCATE ON public.customer_billing_preference_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();


-- ============================================================
-- 6. Row-level security (SYSTEM only; no CUSTOMER-facing read)
-- ============================================================

ALTER TABLE public.company_cargo_category_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_fleet_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_fleet_provider_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_billing_preference_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_cargo_category_periods_system ON public.company_cargo_category_periods FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_READ', 'COMPANY_PROFILE_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_MANAGE']));

CREATE POLICY company_fleet_providers_system ON public.company_fleet_providers FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_READ', 'COMPANY_PROFILE_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_MANAGE']));

CREATE POLICY company_fleet_provider_periods_system ON public.company_fleet_provider_periods FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_READ', 'COMPANY_PROFILE_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_MANAGE']));

CREATE POLICY customer_billing_preference_periods_system ON public.customer_billing_preference_periods FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_READ', 'CUSTOMER_RELATIONSHIP_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_MANAGE']));


-- ============================================================
-- 7. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is deliberate and object-specific. The runtime
-- identity gets no DELETE and no TRUNCATE, may not rewrite period content, and has read-only access to the catalogues.
-- effective_to is insertable so a correction of an already-ended period can create its replacement with the same window.
-- ============================================================

REVOKE ALL
ON TABLE
    public.cargo_categories,
    public.billing_payment_methods,
    public.fleet_service_categories,
    public.company_cargo_category_periods,
    public.company_fleet_providers,
    public.company_fleet_provider_periods,
    public.customer_billing_preference_periods
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.cargo_categories,
    public.billing_payment_methods,
    public.fleet_service_categories,
    public.company_cargo_category_periods,
    public.company_fleet_providers,
    public.company_fleet_provider_periods,
    public.customer_billing_preference_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, cargo_category_code, effective_from, effective_to)
ON public.company_cargo_category_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.company_cargo_category_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, provider_name, provider_name_normalized)
ON public.company_fleet_providers
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, provider_id, service_category_code, effective_from, effective_to)
ON public.company_fleet_provider_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.company_fleet_provider_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, payment_method_code, effective_from, effective_to)
ON public.customer_billing_preference_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.customer_billing_preference_periods
TO "tes-backend@tes-production-510007.iam";
