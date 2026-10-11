-- TES Companies: Insurance foundation
-- Migration: 0017
--
-- Scope (additive only):
--   1. public.insurance_coverage_types       controlled catalogue of coverage / account / bond types (seeded)
--   2. public.insurance_policies             stable policy / account / bond identity
--   3. public.insurance_policy_terms         policy terms (periods), policy number, cancellation, correction
--   4. public.insurance_endorsements         mid-term endorsements that change coverage
--   5. public.insurance_coverages            coverage rows (limit, deductible, currency) within a term
--   6. public.insurance_broker_periods       effective-dated broker / producer of record
--   7. tes_security trigger functions and two SYSTEM-only capabilities (catalogue rows only, granted to nobody)
--
-- INSURANCE IS STRUCTURED FACTS, NOT UPLOADED PDFS. This schema stores who insures whom, under which policy number,
-- for which period, with which coverages and limits, and through which broker. Documents are evidence (GCS) and are
-- linked later by stable ids; nothing here stores file content, URLs or OCR output.
--
-- Concepts kept separate (and where each lives):
--   insurer / carrier / surety / board   an Organization (insurance_policies.insurer_organization_id)
--   broker / producer firm               an Organization (insurance_broker_periods.broker_organization_id)
--   broker contact                       a Contacts person via an ACTIVE organization_person_relationships row (0014)
--   policy identity                      insurance_policies (survives renewals that keep the carrier's identity)
--   policy term                          insurance_policy_terms (a period; renewal = a new term, or a new policy
--                                        linked by renews_policy_id when the carrier issues a new identity)
--   coverage                             insurance_coverages (type, limit, deductible, currency) within a term
--   endorsement                          insurance_endorsements (a dated change of coverage inside a term)
--   certificate / evidence               NOT here: a later Evidence link to insurance_policy_terms.id
--   regulatory filing (BMC-91/91X, ...)  NOT here: a later link to insurance_policy_terms.id
--   scheduled vehicle                    NOT here: a later Vehicles link to insurance_coverages.id
--   coverage sufficiency                 NOT here: a Rules determination over these facts
--
-- Family. Every policy has a family fixed at creation: INSURANCE (insurance policies), WORKERS_COMPENSATION (an
-- employer account with a workers' compensation board; the board is the insurer Organization and the account number
-- is the policy number) and BOND (surety bonds; the penal sum is the limit). A coverage must belong to its policy's
-- family (composite foreign keys). The principal / employer / insured is the Organization named on the policy.
--
-- Renewal. Carriers differ. Where the carrier keeps one policy identity, a renewal is a NEW TERM of the same policy
-- (the policy number may or may not change). Where the carrier issues a new policy, the renewal is a NEW POLICY that
-- points to its predecessor (renews_policy_id, same Organization, same family). Terms of one policy never overlap.
--
-- Policy-number namespace. A policy number identifies ONE policy within its insurer. It is never globally unique:
-- two insurers may issue the same number. Within one insurer an ACTIVE (non-corrected) term holds its number for its
-- policy only; every term of the same policy may repeat it (carriers often keep the number across renewals), but no
-- other policy of that insurer may use it. Enforced by a trigger serialized with an advisory lock, because a unique
-- index cannot express "same number, same policy".
--
-- Business time. Term and coverage periods are calendar DATES printed on the policy ([term_start, term_end) in
-- practice, stored as the stated dates; term_end is the stated expiry date and may be NULL only for BOND, where a
-- continuous bond has no stated expiry). Broker periods use instants like the other effective-dated tables. A change
-- of coverage inside a term ends the old coverage row and starts a new one on the endorsement date; both stay history.
--
-- Correction vs real-world change follows migrations 0012-0015: a correction marks the wrong row 'corrected' (kept, never
-- ended) with a deferred same-policy / same-term pointer to its replacement; the replacement inherits the business
-- time. Reads use 'active' rows only. A cancellation is a one-way fact on the term (cancelled_on + a controlled reason);
-- a wrong cancellation is corrected like any other term fact. Coverage rows of a corrected term are implicitly
-- superseded: they count only while their term is 'active'.
--
-- Archive is RECORD lifecycle (insurance_policies.record_status), not policy status. Expiry and "in force" are
-- interpreted from the dates; no status is stored.
--
-- Global Organization facts: no tenant column and no row-level security; visibility is enforced by the server. All new
-- functions are SECURITY INVOKER with a fixed search_path; none is SECURITY DEFINER. No DELETE or TRUNCATE is granted
-- and none is possible (triggers). No existing object is touched. Reuses tes_security.guard_active_organization (0016).


-- ============================================================
-- 1. Coverage type catalogue
-- ============================================================

CREATE TABLE public.insurance_coverage_types (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text,

    family text NOT NULL,
    -- Whether a limit amount is required (insurance, bonds) or not applicable (workers' compensation is statutory).
    limit_required boolean NOT NULL,

    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT insurance_coverage_types_code_valid
        CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),

    CONSTRAINT insurance_coverage_types_display_name_not_blank
        CHECK (btrim(display_name) <> ''),

    CONSTRAINT insurance_coverage_types_family_valid
        CHECK (family IN ('INSURANCE', 'WORKERS_COMPENSATION', 'BOND')),

    CONSTRAINT insurance_coverage_types_sort_order_uq
        UNIQUE (sort_order),

    -- Target of the (coverage_type, family) foreign key on coverages.
    CONSTRAINT insurance_coverage_types_code_family_uq
        UNIQUE (code, family)
);

INSERT INTO public.insurance_coverage_types
    (code, display_name, description, family, limit_required, sort_order)
VALUES
    ('AUTO_LIABILITY', 'Auto Liability',
        'Motor carrier / commercial auto liability (limits are normally a combined single limit).',
        'INSURANCE', true, 10),
    ('MOTOR_TRUCK_CARGO', 'Motor Truck Cargo',
        'Cargo (freight in transit) coverage.',
        'INSURANCE', true, 20),
    ('GENERAL_LIABILITY', 'General Liability',
        'Commercial general liability.',
        'INSURANCE', true, 30),
    ('PHYSICAL_DAMAGE', 'Physical Damage',
        'Physical damage to scheduled or owned equipment.',
        'INSURANCE', true, 40),
    ('UMBRELLA_EXCESS', 'Umbrella / Excess Liability',
        'Umbrella or excess liability above underlying limits.',
        'INSURANCE', true, 50),
    ('REEFER_BREAKDOWN', 'Reefer Breakdown',
        'Refrigeration unit breakdown coverage.',
        'INSURANCE', true, 60),
    ('WORKERS_COMPENSATION', 'Workers'' Compensation Account',
        'Employer account with a workers'' compensation board or insurer. Coverage is statutory: no limit is recorded.',
        'WORKERS_COMPENSATION', false, 70),
    ('BOND_FREIGHT_BROKER', 'Freight Broker Surety Bond (BMC-84)',
        'Freight broker / freight forwarder surety bond; the limit is the penal sum.',
        'BOND', true, 80),
    ('BOND_CUSTOMS', 'Customs / In-Transit Bond',
        'Customs, in-bond or in-transit surety bond; the limit is the penal sum.',
        'BOND', true, 90),
    ('BOND_PERFORMANCE', 'Performance Bond',
        'Performance surety bond; the limit is the penal sum.',
        'BOND', true, 100);


-- ============================================================
-- 2. Policies (stable identity)
-- ============================================================

CREATE TABLE public.insurance_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The insured / employer / bond principal.
    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    -- The insurer / carrier / surety / workers' compensation board.
    insurer_organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    family text NOT NULL,

    -- Predecessor policy when a renewal is a NEW policy identity (same Organization, same family).
    renews_policy_id uuid,

    -- Record lifecycle (NOT policy status).
    record_status text NOT NULL DEFAULT 'active',
    archived_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT insurance_policies_family_valid
        CHECK (family IN ('INSURANCE', 'WORKERS_COMPENSATION', 'BOND')),

    CONSTRAINT insurance_policies_insurer_differs_from_insured
        CHECK (insurer_organization_id <> organization_id),

    CONSTRAINT insurance_policies_not_renewal_of_self
        CHECK (renews_policy_id IS NULL OR renews_policy_id <> id),

    CONSTRAINT insurance_policies_record_status_valid
        CHECK (record_status IN ('active', 'archived')),

    CONSTRAINT insurance_policies_archive_state_consistent
        CHECK (
            (record_status = 'archived' AND archived_at IS NOT NULL)
            OR
            (record_status = 'active' AND archived_at IS NULL)
        ),

    -- Targets of the composite foreign keys on terms / broker periods / renewal lineage.
    CONSTRAINT insurance_policies_id_organization_family_uq
        UNIQUE (id, organization_id, family),

    CONSTRAINT insurance_policies_id_scope_uq
        UNIQUE (id, organization_id, insurer_organization_id, family),

    CONSTRAINT insurance_policies_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT insurance_policies_renews_fk
        FOREIGN KEY (renews_policy_id, organization_id, family)
        REFERENCES public.insurance_policies (id, organization_id, family)
        ON DELETE RESTRICT
);

CREATE INDEX insurance_policies_organization_idx
    ON public.insurance_policies (organization_id, family);

CREATE INDEX insurance_policies_insurer_idx
    ON public.insurance_policies (insurer_organization_id);

CREATE INDEX insurance_policies_renews_idx
    ON public.insurance_policies (renews_policy_id)
    WHERE renews_policy_id IS NOT NULL;


-- ============================================================
-- 3. Policy terms
-- ============================================================

CREATE TABLE public.insurance_policy_terms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    policy_id uuid NOT NULL,

    -- Copies bound by the composite foreign key below, so number-namespace and overlap logic is single-table.
    organization_id uuid NOT NULL,
    insurer_organization_id uuid NOT NULL,
    family text NOT NULL,

    -- Policy number exactly as printed, its normalized comparison form, and the normalization rule version.
    number_display text NOT NULL,
    number_normalized text NOT NULL,
    normalization_rule_version text NOT NULL,

    -- Stated period. term_end is NULL only for a continuous BOND.
    term_start date NOT NULL,
    term_end date,

    -- One-way cancellation fact (both columns or neither).
    cancelled_on date,
    cancellation_reason text,

    -- How this term came to exist.
    term_reason text NOT NULL,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_term_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT insurance_policy_terms_policy_fk
        FOREIGN KEY (policy_id, organization_id, insurer_organization_id, family)
        REFERENCES public.insurance_policies (id, organization_id, insurer_organization_id, family)
        ON DELETE RESTRICT,

    CONSTRAINT insurance_policy_terms_number_display_not_blank
        CHECK (btrim(number_display) <> ''),

    CONSTRAINT insurance_policy_terms_number_normalized_not_blank
        CHECK (btrim(number_normalized) <> ''),

    CONSTRAINT insurance_policy_terms_rule_version_not_blank
        CHECK (btrim(normalization_rule_version) <> ''),

    CONSTRAINT insurance_policy_terms_period_valid
        CHECK (term_end IS NULL OR term_end > term_start),

    -- Only a continuous bond may have no stated expiry.
    CONSTRAINT insurance_policy_terms_expiry_required
        CHECK (term_end IS NOT NULL OR family = 'BOND'),

    CONSTRAINT insurance_policy_terms_cancellation_state_consistent
        CHECK ((cancelled_on IS NULL) = (cancellation_reason IS NULL)),

    CONSTRAINT insurance_policy_terms_cancellation_reason_valid
        CHECK (cancellation_reason IS NULL OR cancellation_reason IN
            ('INSURED_REQUEST', 'INSURER_CANCELLATION', 'NON_PAYMENT', 'REPLACED_BY_NEW_POLICY')),

    CONSTRAINT insurance_policy_terms_cancellation_within_term
        CHECK (cancelled_on IS NULL OR (cancelled_on >= term_start AND (term_end IS NULL OR cancelled_on <= term_end))),

    CONSTRAINT insurance_policy_terms_reason_valid
        CHECK (term_reason IN ('INITIAL', 'RENEWAL', 'CORRECTION')),

    CONSTRAINT insurance_policy_terms_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT insurance_policy_terms_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_term_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_term_id IS NOT NULL)
        ),

    CONSTRAINT insurance_policy_terms_not_superseded_by_self
        CHECK (superseded_by_term_id IS NULL OR superseded_by_term_id <> id),

    -- Targets of composite foreign keys.
    CONSTRAINT insurance_policy_terms_id_policy_uq
        UNIQUE (id, policy_id),

    CONSTRAINT insurance_policy_terms_id_scope_uq
        UNIQUE (id, policy_id, organization_id, family),

    -- A corrected term points to its replacement, which must belong to the same policy (deferred: either order).
    CONSTRAINT insurance_policy_terms_superseded_by_fk
        FOREIGN KEY (superseded_by_term_id, policy_id)
        REFERENCES public.insurance_policy_terms (id, policy_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX insurance_policy_terms_policy_idx
    ON public.insurance_policy_terms (policy_id, term_start);

-- Policy-number namespace lookup (the rule itself is the trigger; see header).
CREATE INDEX insurance_policy_terms_number_lookup_idx
    ON public.insurance_policy_terms (insurer_organization_id, number_normalized)
    WHERE record_status = 'active';

CREATE INDEX insurance_policy_terms_organization_idx
    ON public.insurance_policy_terms (organization_id, term_start);


-- ============================================================
-- 4. Endorsements
-- ============================================================

CREATE TABLE public.insurance_endorsements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    term_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    family text NOT NULL,

    -- The endorsement number as printed, when the insurer assigned one.
    number_display text,
    number_normalized text,

    endorsement_kind text NOT NULL,
    effective_on date NOT NULL,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_endorsement_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT insurance_endorsements_term_fk
        FOREIGN KEY (term_id, policy_id, organization_id, family)
        REFERENCES public.insurance_policy_terms (id, policy_id, organization_id, family)
        ON DELETE RESTRICT,

    CONSTRAINT insurance_endorsements_number_pair
        CHECK ((number_display IS NULL) = (number_normalized IS NULL)),

    CONSTRAINT insurance_endorsements_number_not_blank
        CHECK (number_display IS NULL OR (btrim(number_display) <> '' AND btrim(number_normalized) <> '')),

    CONSTRAINT insurance_endorsements_kind_valid
        CHECK (endorsement_kind IN ('COVERAGE_ADDED', 'COVERAGE_CHANGED', 'COVERAGE_REMOVED')),

    CONSTRAINT insurance_endorsements_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT insurance_endorsements_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_endorsement_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_endorsement_id IS NOT NULL)
        ),

    CONSTRAINT insurance_endorsements_not_superseded_by_self
        CHECK (superseded_by_endorsement_id IS NULL OR superseded_by_endorsement_id <> id),

    CONSTRAINT insurance_endorsements_id_term_uq
        UNIQUE (id, term_id),

    CONSTRAINT insurance_endorsements_superseded_by_fk
        FOREIGN KEY (superseded_by_endorsement_id, term_id)
        REFERENCES public.insurance_endorsements (id, term_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- One ACTIVE endorsement per number within a term.
CREATE UNIQUE INDEX insurance_endorsements_number_uq
    ON public.insurance_endorsements (term_id, number_normalized)
    WHERE record_status = 'active' AND number_normalized IS NOT NULL;

CREATE INDEX insurance_endorsements_term_idx
    ON public.insurance_endorsements (term_id, effective_on);


-- ============================================================
-- 5. Coverages
-- ============================================================

CREATE TABLE public.insurance_coverages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    term_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    family text NOT NULL,

    coverage_type text NOT NULL,

    limit_amount numeric(14, 2),
    deductible_amount numeric(14, 2),
    currency text,
    limit_basis text,
    scheduled_vehicles_only boolean NOT NULL DEFAULT false,

    -- Period this coverage row is true for (dates; effective_to is exclusive-by-convention end, NULL = to term end).
    effective_from date NOT NULL,
    effective_to date,

    -- The endorsements that started / ended this row's state (NULL for the state in force from the term start).
    endorsement_id uuid,
    ended_by_endorsement_id uuid,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_coverage_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT insurance_coverages_term_fk
        FOREIGN KEY (term_id, policy_id, organization_id, family)
        REFERENCES public.insurance_policy_terms (id, policy_id, organization_id, family)
        ON DELETE RESTRICT,

    CONSTRAINT insurance_coverages_type_fk
        FOREIGN KEY (coverage_type, family)
        REFERENCES public.insurance_coverage_types (code, family)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    CONSTRAINT insurance_coverages_endorsement_fk
        FOREIGN KEY (endorsement_id, term_id)
        REFERENCES public.insurance_endorsements (id, term_id)
        ON DELETE RESTRICT,

    CONSTRAINT insurance_coverages_ended_by_endorsement_fk
        FOREIGN KEY (ended_by_endorsement_id, term_id)
        REFERENCES public.insurance_endorsements (id, term_id)
        ON DELETE RESTRICT,

    CONSTRAINT insurance_coverages_limit_positive
        CHECK (limit_amount IS NULL OR limit_amount > 0),

    CONSTRAINT insurance_coverages_deductible_non_negative
        CHECK (deductible_amount IS NULL OR deductible_amount >= 0),

    -- A currency exists exactly when an amount does.
    CONSTRAINT insurance_coverages_currency_state_consistent
        CHECK ((currency IS NULL) = (limit_amount IS NULL AND deductible_amount IS NULL)),

    CONSTRAINT insurance_coverages_currency_valid
        CHECK (currency IS NULL OR currency IN ('CAD', 'USD')),

    CONSTRAINT insurance_coverages_limit_basis_valid
        CHECK (limit_basis IS NULL OR limit_basis IN
            ('COMBINED_SINGLE_LIMIT', 'PER_OCCURRENCE', 'PER_VEHICLE', 'AGGREGATE', 'PENAL_SUM')),

    CONSTRAINT insurance_coverages_limit_basis_needs_limit
        CHECK (limit_basis IS NULL OR limit_amount IS NOT NULL),

    CONSTRAINT insurance_coverages_period_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT insurance_coverages_end_endorsement_needs_end
        CHECK (ended_by_endorsement_id IS NULL OR effective_to IS NOT NULL),

    CONSTRAINT insurance_coverages_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT insurance_coverages_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_coverage_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_coverage_id IS NOT NULL)
        ),

    CONSTRAINT insurance_coverages_not_superseded_by_self
        CHECK (superseded_by_coverage_id IS NULL OR superseded_by_coverage_id <> id),

    CONSTRAINT insurance_coverages_id_term_uq
        UNIQUE (id, term_id),

    CONSTRAINT insurance_coverages_superseded_by_fk
        FOREIGN KEY (superseded_by_coverage_id, term_id)
        REFERENCES public.insurance_coverages (id, term_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one CURRENT (open-ended, active) coverage row per coverage type within a term.
CREATE UNIQUE INDEX insurance_coverages_current_uq
    ON public.insurance_coverages (term_id, coverage_type)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX insurance_coverages_term_idx
    ON public.insurance_coverages (term_id, coverage_type, effective_from);

CREATE INDEX insurance_coverages_organization_idx
    ON public.insurance_coverages (organization_id, coverage_type);


-- ============================================================
-- 6. Broker / producer of record (effective-dated)
-- ============================================================

CREATE TABLE public.insurance_broker_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    policy_id uuid NOT NULL,
    organization_id uuid NOT NULL,

    -- The brokerage / producer firm.
    broker_organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    -- Optional named broker contact, through the canonical Contacts relationship with the brokerage firm (0014).
    broker_relationship_id uuid,
    broker_person_id uuid,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT insurance_broker_periods_policy_fk
        FOREIGN KEY (policy_id, organization_id)
        REFERENCES public.insurance_policies (id, organization_id)
        ON DELETE RESTRICT,

    -- The contact must be a person related to the brokerage firm in Contacts. MATCH SIMPLE: skipped when all NULL.
    CONSTRAINT insurance_broker_periods_contact_fk
        FOREIGN KEY (broker_relationship_id, broker_organization_id, broker_person_id)
        REFERENCES public.organization_person_relationships (id, organization_id, person_id)
        ON DELETE RESTRICT,

    CONSTRAINT insurance_broker_periods_contact_pair
        CHECK ((broker_relationship_id IS NULL) = (broker_person_id IS NULL)),

    CONSTRAINT insurance_broker_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT insurance_broker_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT insurance_broker_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
        ),

    CONSTRAINT insurance_broker_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT insurance_broker_periods_id_policy_uq
        UNIQUE (id, policy_id),

    CONSTRAINT insurance_broker_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, policy_id)
        REFERENCES public.insurance_broker_periods (id, policy_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one CURRENT broker of record per policy.
CREATE UNIQUE INDEX insurance_broker_periods_current_uq
    ON public.insurance_broker_periods (policy_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX insurance_broker_periods_history_idx
    ON public.insurance_broker_periods (policy_id, effective_from);

CREATE INDEX insurance_broker_periods_broker_idx
    ON public.insurance_broker_periods (broker_organization_id);


-- ============================================================
-- 7. Integrity triggers
--
-- Enforced in the database so they do not depend on application code and apply to the table owner as well. All
-- functions are SECURITY INVOKER with a fixed search_path; none is SECURITY DEFINER.
-- ============================================================

-- No hard delete or truncate of insurance data, ever.
CREATE FUNCTION tes_security.prevent_insurance_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Insurance data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- Policy identity is immutable; only the record lifecycle may change.
CREATE FUNCTION tes_security.guard_insurance_policy_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.insurer_organization_id IS DISTINCT FROM OLD.insurer_organization_id
       OR NEW.family IS DISTINCT FROM OLD.family
       OR NEW.renews_policy_id IS DISTINCT FROM OLD.renews_policy_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Insurance policy identity is immutable; only the record lifecycle can change'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A term must belong to an ACTIVE policy. The policy row is locked FOR UPDATE so concurrent term writers for one policy
-- serialize. Terms of one policy never overlap (a cancelled term ends on its cancellation date, so a successor may start then); a policy number belongs to one policy within its insurer.
CREATE FUNCTION tes_security.guard_insurance_term_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.insurance_policies AS p
         WHERE p.id = NEW.policy_id
           AND p.record_status = 'active'
           FOR UPDATE
    ) THEN
        RAISE EXCEPTION 'A term must belong to an active insurance policy record'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'insurance_policy_terms_policy_active';
    END IF;

    IF NEW.record_status = 'active' THEN
        IF EXISTS (
            SELECT 1
              FROM public.insurance_policy_terms AS t
             WHERE t.policy_id = NEW.policy_id
               AND t.record_status = 'active'
               AND t.id <> NEW.id
               AND daterange(t.term_start, COALESCE(t.cancelled_on, t.term_end), '[)') && daterange(NEW.term_start, NEW.term_end, '[)')
        ) THEN
            RAISE EXCEPTION 'Terms of one policy cannot overlap'
                USING ERRCODE = '23P01',
                      CONSTRAINT = 'insurance_policy_terms_no_overlap';
        END IF;

        PERFORM pg_advisory_xact_lock(hashtextextended('insurance_policy_number:' || NEW.insurer_organization_id::text || ':' || NEW.number_normalized, 0));

        IF EXISTS (
            SELECT 1
              FROM public.insurance_policy_terms AS t
             WHERE t.insurer_organization_id = NEW.insurer_organization_id
               AND t.number_normalized = NEW.number_normalized
               AND t.record_status = 'active'
               AND t.policy_id <> NEW.policy_id
        ) THEN
            RAISE EXCEPTION 'This policy number is already held by another policy of the same insurer'
                USING ERRCODE = '23505',
                      CONSTRAINT = 'insurance_policy_terms_number_namespace';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Term content is immutable. Permitted one-way changes: cancelled_on + cancellation_reason (NULL -> value, together),
-- and record_status active -> corrected with corrected_at + superseded_by_term_id. A corrected term is frozen.
CREATE FUNCTION tes_security.guard_insurance_term_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected insurance term is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.insurer_organization_id IS DISTINCT FROM OLD.insurer_organization_id
       OR NEW.family IS DISTINCT FROM OLD.family
       OR NEW.number_display IS DISTINCT FROM OLD.number_display
       OR NEW.number_normalized IS DISTINCT FROM OLD.number_normalized
       OR NEW.normalization_rule_version IS DISTINCT FROM OLD.normalization_rule_version
       OR NEW.term_start IS DISTINCT FROM OLD.term_start
       OR NEW.term_end IS DISTINCT FROM OLD.term_end
       OR NEW.term_reason IS DISTINCT FROM OLD.term_reason
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Insurance term content is immutable; record a renewal or a correction as a new term'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.cancelled_on IS NOT NULL
       AND (NEW.cancelled_on IS DISTINCT FROM OLD.cancelled_on OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason)
    THEN
        RAISE EXCEPTION 'A recorded cancellation cannot be changed; correct the term instead'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected'
       AND (NEW.cancelled_on IS DISTINCT FROM OLD.cancelled_on OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason)
    THEN
        RAISE EXCEPTION 'A correction does not cancel a term'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- An endorsement belongs to an ACTIVE term, is dated inside the term, and not after a cancellation.
CREATE FUNCTION tes_security.guard_insurance_endorsement_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.insurance_policy_terms AS t
         WHERE t.id = NEW.term_id
           AND t.record_status = 'active'
           AND NEW.effective_on >= t.term_start
           AND (t.term_end IS NULL OR NEW.effective_on < t.term_end)
           AND (t.cancelled_on IS NULL OR NEW.effective_on <= t.cancelled_on)
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'An endorsement must belong to an active term and fall inside its period'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_endorsements_inside_active_term';
    END IF;

    RETURN NEW;
END;
$$;

-- Endorsement content is immutable; only active -> corrected (never ended). A corrected endorsement is frozen.
CREATE FUNCTION tes_security.guard_insurance_endorsement_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected endorsement is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.term_id IS DISTINCT FROM OLD.term_id
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.family IS DISTINCT FROM OLD.family
       OR NEW.number_display IS DISTINCT FROM OLD.number_display
       OR NEW.number_normalized IS DISTINCT FROM OLD.number_normalized
       OR NEW.endorsement_kind IS DISTINCT FROM OLD.endorsement_kind
       OR NEW.effective_on IS DISTINCT FROM OLD.effective_on
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Endorsement content is immutable; record a correction as a new endorsement'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A coverage row belongs to an ACTIVE term, lies inside it (and not after a cancellation), follows the type's limit
-- rule, and never overlaps another ACTIVE row of the same type in the term.
CREATE FUNCTION tes_security.guard_insurance_coverage_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.insurance_policy_terms AS t
         WHERE t.id = NEW.term_id
           AND t.record_status = 'active'
           AND NEW.effective_from >= t.term_start
           AND (t.term_end IS NULL OR NEW.effective_from < t.term_end)
           AND (NEW.effective_to IS NULL OR t.term_end IS NULL OR NEW.effective_to <= t.term_end)
           AND (t.cancelled_on IS NULL OR NEW.effective_from <= t.cancelled_on)
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A coverage must belong to an active term and fall inside its period'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_coverages_inside_active_term';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.insurance_coverage_types AS c
         WHERE c.code = NEW.coverage_type
           AND c.is_active
           AND c.limit_required = (NEW.limit_amount IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'The coverage limit does not satisfy the rules of its coverage type'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_coverages_limit_rules';
    END IF;

    IF NEW.record_status = 'active' AND EXISTS (
        SELECT 1
          FROM public.insurance_coverages AS c
         WHERE c.term_id = NEW.term_id
           AND c.coverage_type = NEW.coverage_type
           AND c.record_status = 'active'
           AND c.id <> NEW.id
           AND daterange(c.effective_from, c.effective_to, '[)') && daterange(NEW.effective_from, NEW.effective_to, '[)')
    ) THEN
        RAISE EXCEPTION 'Coverage rows of one type cannot overlap within a term'
            USING ERRCODE = '23P01',
                  CONSTRAINT = 'insurance_coverages_no_overlap';
    END IF;

    RETURN NEW;
END;
$$;

-- Coverage content is immutable. Permitted one-way changes: effective_to NULL -> value together with
-- ended_by_endorsement_id (a real change ends the row), and active -> corrected (never ended). Corrected rows are frozen.
CREATE FUNCTION tes_security.guard_insurance_coverage_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected coverage is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.term_id IS DISTINCT FROM OLD.term_id
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.family IS DISTINCT FROM OLD.family
       OR NEW.coverage_type IS DISTINCT FROM OLD.coverage_type
       OR NEW.limit_amount IS DISTINCT FROM OLD.limit_amount
       OR NEW.deductible_amount IS DISTINCT FROM OLD.deductible_amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.limit_basis IS DISTINCT FROM OLD.limit_basis
       OR NEW.scheduled_vehicles_only IS DISTINCT FROM OLD.scheduled_vehicles_only
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.endorsement_id IS DISTINCT FROM OLD.endorsement_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Coverage content is immutable; record a change or a correction as a new coverage row'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL
       AND (NEW.effective_to IS DISTINCT FROM OLD.effective_to OR NEW.ended_by_endorsement_id IS DISTINCT FROM OLD.ended_by_endorsement_id)
    THEN
        RAISE EXCEPTION 'An ended coverage cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected'
       AND (NEW.effective_to IS DISTINCT FROM OLD.effective_to OR NEW.ended_by_endorsement_id IS DISTINCT FROM OLD.ended_by_endorsement_id)
    THEN
        RAISE EXCEPTION 'A correction does not end a coverage'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.effective_to IS DISTINCT FROM OLD.effective_to AND NOT EXISTS (
        SELECT 1
          FROM public.insurance_policy_terms AS t
         WHERE t.id = NEW.term_id
           AND (t.term_end IS NULL OR NEW.effective_to <= t.term_end)
    ) THEN
        RAISE EXCEPTION 'A coverage cannot end after its term'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_coverages_inside_active_term';
    END IF;

    RETURN NEW;
END;
$$;

-- A broker period belongs to an ACTIVE policy; a named contact must hold an ACTIVE relationship with the brokerage firm.
CREATE FUNCTION tes_security.guard_insurance_broker_period_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.insurance_policies AS p
         WHERE p.id = NEW.policy_id
           AND p.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A broker period must belong to an active insurance policy record'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'insurance_broker_periods_policy_active';
    END IF;

    IF NEW.broker_relationship_id IS NOT NULL AND NEW.record_status = 'active' AND NOT EXISTS (
        SELECT 1
          FROM public.organization_person_relationships AS r
         WHERE r.id = NEW.broker_relationship_id
           AND r.record_status = 'active'
           AND r.effective_to IS NULL
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'The broker contact must hold an active relationship with the brokerage firm'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_broker_periods_contact_active';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_insurance_broker_period_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected broker period is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.broker_organization_id IS DISTINCT FROM OLD.broker_organization_id
       OR NEW.broker_relationship_id IS DISTINCT FROM OLD.broker_relationship_id
       OR NEW.broker_person_id IS DISTINCT FROM OLD.broker_person_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Broker period content is immutable; record a change or a correction as a new period'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended broker period cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a broker period'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Every policy has an active term by the end of the transaction that created it.
CREATE FUNCTION tes_security.require_insurance_policy_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.insurance_policy_terms AS t
         WHERE t.policy_id = NEW.id
           AND t.record_status = 'active'
    ) THEN
        RAISE EXCEPTION 'An insurance policy must have an active term'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_policies_require_active_term';
    END IF;

    RETURN NULL;
END;
$$;

-- Every active term has at least one active coverage by the end of the transaction that created it.
CREATE FUNCTION tes_security.require_insurance_term_coverage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.record_status = 'active' AND NOT EXISTS (
        SELECT 1
          FROM public.insurance_coverages AS c
         WHERE c.term_id = NEW.id
           AND c.record_status = 'active'
    ) THEN
        RAISE EXCEPTION 'An active insurance term must have at least one coverage'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_policy_terms_require_coverage';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_insurance_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_policy_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_term_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_term_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_endorsement_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_endorsement_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_coverage_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_coverage_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_broker_period_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_broker_period_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_insurance_policy_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_insurance_term_coverage() FROM PUBLIC;

CREATE TRIGGER insurance_policies_guard_update
BEFORE UPDATE ON public.insurance_policies
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_policy_update();

CREATE TRIGGER insurance_policies_guard_active_organization
BEFORE INSERT ON public.insurance_policies
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id', 'insurer_organization_id');

CREATE CONSTRAINT TRIGGER insurance_policies_require_active_term
AFTER INSERT ON public.insurance_policies
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_insurance_policy_state();

CREATE TRIGGER insurance_policy_terms_guard_insert
BEFORE INSERT ON public.insurance_policy_terms
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_term_insert();

CREATE TRIGGER insurance_policy_terms_guard_active_organization
BEFORE INSERT ON public.insurance_policy_terms
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id', 'insurer_organization_id');

CREATE TRIGGER insurance_policy_terms_guard_update
BEFORE UPDATE ON public.insurance_policy_terms
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_term_update();

CREATE CONSTRAINT TRIGGER insurance_policy_terms_require_coverage
AFTER INSERT ON public.insurance_policy_terms
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_insurance_term_coverage();

CREATE TRIGGER insurance_endorsements_guard_insert
BEFORE INSERT ON public.insurance_endorsements
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_endorsement_insert();

CREATE TRIGGER insurance_endorsements_guard_update
BEFORE UPDATE ON public.insurance_endorsements
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_endorsement_update();

CREATE TRIGGER insurance_coverages_guard_insert
BEFORE INSERT ON public.insurance_coverages
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_coverage_insert();

CREATE TRIGGER insurance_coverages_guard_update
BEFORE UPDATE ON public.insurance_coverages
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_coverage_update();

CREATE TRIGGER insurance_broker_periods_guard_insert
BEFORE INSERT ON public.insurance_broker_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_broker_period_insert();

CREATE TRIGGER insurance_broker_periods_guard_active_organization
BEFORE INSERT ON public.insurance_broker_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id', 'broker_organization_id');

CREATE TRIGGER insurance_broker_periods_guard_update
BEFORE UPDATE ON public.insurance_broker_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_broker_period_update();

CREATE TRIGGER insurance_policies_no_delete
BEFORE DELETE ON public.insurance_policies
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_policy_terms_no_delete
BEFORE DELETE ON public.insurance_policy_terms
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_endorsements_no_delete
BEFORE DELETE ON public.insurance_endorsements
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_coverages_no_delete
BEFORE DELETE ON public.insurance_coverages
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_broker_periods_no_delete
BEFORE DELETE ON public.insurance_broker_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_policies_no_truncate
BEFORE TRUNCATE ON public.insurance_policies
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_policy_terms_no_truncate
BEFORE TRUNCATE ON public.insurance_policy_terms
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_endorsements_no_truncate
BEFORE TRUNCATE ON public.insurance_endorsements
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_coverages_no_truncate
BEFORE TRUNCATE ON public.insurance_coverages
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();

CREATE TRIGGER insurance_broker_periods_no_truncate
BEFORE TRUNCATE ON public.insurance_broker_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_insurance_data_removal();


-- ============================================================
-- 8. Capabilities (catalogue rows only)
--
-- Capability existence and assignment are separate: this migration creates no relationship, assignment or grant. Both are
-- SYSTEM-only; customers receive no access to insurance.
-- ============================================================

INSERT INTO public.capabilities (code, display_name, description, is_active, sort_order)
VALUES
    (
        'INSURANCE_READ',
        'Read Insurance',
        'SYSTEM-wide read access to Organization insurance policies, terms, coverages, endorsements, workers'' compensation accounts, bonds and broker-of-record history, and to the policy-number registry. Intended scope: SYSTEM only.',
        true,
        130
    ),
    (
        'INSURANCE_MANAGE',
        'Manage Insurance',
        'Create, renew, cancel, endorse, correct, archive and restore Organization insurance policies, coverages and broker-of-record assignments. Does not store certificates or evidence. Intended scope: SYSTEM only.',
        true,
        140
    );


-- ============================================================
-- 9. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is deliberate and object-specific. The runtime
-- identity gets no DELETE and no TRUNCATE, may not rewrite content or identity, and has read-only access to the coverage
-- type catalogue (changed only by migrations).
-- ============================================================

REVOKE ALL
ON TABLE
    public.insurance_coverage_types,
    public.insurance_policies,
    public.insurance_policy_terms,
    public.insurance_endorsements,
    public.insurance_coverages,
    public.insurance_broker_periods
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.insurance_coverage_types,
    public.insurance_policies,
    public.insurance_policy_terms,
    public.insurance_endorsements,
    public.insurance_coverages,
    public.insurance_broker_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, insurer_organization_id, family, renews_policy_id)
ON public.insurance_policies
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, archived_at, updated_at)
ON public.insurance_policies
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id, policy_id, organization_id, insurer_organization_id, family,
    number_display, number_normalized, normalization_rule_version,
    term_start, term_end, term_reason
)
ON public.insurance_policy_terms
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (cancelled_on, cancellation_reason, record_status, corrected_at, superseded_by_term_id, updated_at)
ON public.insurance_policy_terms
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id, term_id, policy_id, organization_id, family,
    number_display, number_normalized, endorsement_kind, effective_on
)
ON public.insurance_endorsements
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, corrected_at, superseded_by_endorsement_id, updated_at)
ON public.insurance_endorsements
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id, term_id, policy_id, organization_id, family, coverage_type,
    limit_amount, deductible_amount, currency, limit_basis, scheduled_vehicles_only,
    effective_from, effective_to, endorsement_id
)
ON public.insurance_coverages
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, ended_by_endorsement_id, record_status, corrected_at, superseded_by_coverage_id, updated_at)
ON public.insurance_coverages
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id, policy_id, organization_id, broker_organization_id,
    broker_relationship_id, broker_person_id, effective_from
)
ON public.insurance_broker_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.insurance_broker_periods
TO "tes-backend@tes-production-510007.iam";
