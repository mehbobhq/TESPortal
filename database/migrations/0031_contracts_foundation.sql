-- TES Contracts foundation
-- Migration: 0031
--
-- Scope (additive only; builds on the 0030 contract shell):
--   - package definitions and per-line pricing/package metadata (no billing, invoicing or payment collection)
--   - per-line responsibility matrix with an explicit effective responsibility date and history treatment
--   - contract evidence rule catalogue and per-contract evidence requirement ledger
--   - append-only contract status ledger: every status change carries verified evidence and a Master Register event
--   - append-only authority change ledger: every Service Decision Authority / Contract Signatory change carries a
--     verified written company notice and a Master Register event
--   - database-enforced gates: contract_gate_failures() is the single source of readiness truth, and the contract status
--     trigger refuses to advance a contract while any gate fails
--
-- This migration intentionally does NOT:
--   - alter, drop or rewrite any existing table, column, constraint, policy, grant or migration
--   - add capabilities (CONTRACT_READ / CONTRACT_MANAGE from 0030 are reused; cross-table facts the active capability
--     cannot read are answered by narrow boolean-only SECURITY DEFINER predicates)
--   - store document payloads (evidence stays GCS-backed metadata in evidence_documents)
--   - implement e-signature, invoicing, payments or tax calculation
--   - delete, truncate or rewrite any existing data
--
-- Statuses: draft -> ready_for_signature -> signed -> superseded | archived (ready_for_signature may return to draft).

-- ============================================================
-- 1. Narrow boolean-only predicates over tables the active capability cannot read
--    (SECURITY DEFINER, fixed search_path, no data returned, EXECUTE only for the runtime role)
-- ============================================================

CREATE FUNCTION tes_security.contract_evidence_document_acceptable(
  p_document_id uuid,
  p_organization_id uuid,
  p_document_type text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.evidence_documents d
     WHERE d.id = p_document_id
       AND d.organization_id = p_organization_id
       AND d.document_status = 'verified'
       AND (p_document_type IS NULL OR d.document_type = p_document_type)
       AND (d.expires_at IS NULL OR d.expires_at >= current_date)
  )
$$;

CREATE FUNCTION tes_security.contract_person_is_organization_contact(
  p_person_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.organization_person_relationships r
     WHERE r.organization_id = p_organization_id
       AND r.person_id = p_person_id
       AND r.record_status = 'active'
       AND r.effective_from <= clock_timestamp()
       AND (r.effective_to IS NULL OR r.effective_to > clock_timestamp())
  )
$$;

CREATE FUNCTION tes_security.contract_customer_matches_organization(
  p_customer_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.organization_id = p_organization_id
  )
$$;

CREATE FUNCTION tes_security.contract_engagement_is_open_for_customer(
  p_engagement_id uuid,
  p_customer_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.customer_engagements e
     WHERE e.id = p_engagement_id
       AND e.customer_id = p_customer_id
       AND e.ended_at IS NULL
  )
$$;

CREATE FUNCTION tes_security.contract_scope_is_current_in_engagement(
  p_scope_id uuid,
  p_engagement_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.engagement_service_scopes s
     WHERE s.id = p_scope_id
       AND s.engagement_id = p_engagement_id
       AND s.record_status = 'active'
       AND s.effective_to IS NULL
  )
$$;

-- The UTC date from which TES holds responsibility for a scope, or NULL when TES has not assumed responsibility.
CREATE FUNCTION tes_security.contract_scope_responsibility_start(p_scope_id uuid)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT (min(p.effective_from) AT TIME ZONE 'UTC')::date
    FROM public.engagement_responsibility_periods p
   WHERE p.scope_id = p_scope_id
     AND p.record_status = 'active'
$$;

CREATE FUNCTION tes_security.contract_required_settings_present(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.company_operating_scope_periods s
            WHERE s.organization_id = p_organization_id AND s.record_status = 'active' AND s.effective_to IS NULL
         )
     AND EXISTS (
           SELECT 1 FROM public.company_driver_requirement_periods d
            WHERE d.organization_id = p_organization_id AND d.record_status = 'active' AND d.effective_to IS NULL
         )
$$;

REVOKE ALL ON FUNCTION tes_security.contract_evidence_document_acceptable(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.contract_person_is_organization_contact(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.contract_customer_matches_organization(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.contract_engagement_is_open_for_customer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.contract_scope_is_current_in_engagement(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.contract_scope_responsibility_start(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.contract_required_settings_present(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  tes_security.contract_evidence_document_acceptable(uuid, uuid, text),
  tes_security.contract_person_is_organization_contact(uuid, uuid),
  tes_security.contract_customer_matches_organization(uuid, uuid),
  tes_security.contract_engagement_is_open_for_customer(uuid, uuid),
  tes_security.contract_scope_is_current_in_engagement(uuid, uuid),
  tes_security.contract_scope_responsibility_start(uuid),
  tes_security.contract_required_settings_present(uuid)
TO "tes-backend@tes-production-510007.iam";

-- ============================================================
-- 2. Tables
-- ============================================================

-- Package catalogue. Metadata only: a package names a pricing basis; it never bills anything.
CREATE TABLE public.contract_package_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_code text NOT NULL,
  package_name text NOT NULL,
  pricing_basis text NOT NULL,
  package_status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_package_definitions_code_valid
    CHECK (package_code ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  CONSTRAINT contract_package_definitions_name_valid
    CHECK (
      package_name = btrim(package_name)
      AND char_length(package_name) BETWEEN 1 AND 160
      AND package_name !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
    ),
  CONSTRAINT contract_package_definitions_basis_valid
    CHECK (pricing_basis IN ('monthly_package', 'one_time_service', 'included_in_package')),
  CONSTRAINT contract_package_definitions_status_valid
    CHECK (package_status IN ('active', 'retired'))
);

CREATE UNIQUE INDEX contract_package_definitions_code_uq
  ON public.contract_package_definitions(package_code);

-- Evidence rule catalogue: which verified document type must back a contract before it may reach a status.
CREATE TABLE public.contract_evidence_rules (
  rule_code text PRIMARY KEY,
  rule_label text NOT NULL,
  required_document_type text NOT NULL,
  required_before_status text NOT NULL,
  rule_status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_evidence_rules_code_valid
    CHECK (rule_code ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  CONSTRAINT contract_evidence_rules_doc_type_valid
    CHECK (required_document_type ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  CONSTRAINT contract_evidence_rules_before_valid
    CHECK (required_before_status IN ('ready_for_signature', 'signed')),
  CONSTRAINT contract_evidence_rules_status_valid
    CHECK (rule_status IN ('active', 'retired'))
);

INSERT INTO public.contract_evidence_rules(rule_code, rule_label, required_document_type, required_before_status)
VALUES
  ('CUSTOMER_AUTHORITY_NOTICE', 'Written company notice naming Service Decision Authority and Contract Signatory', 'CUSTOMER_AUTHORITY_NOTICE', 'ready_for_signature'),
  ('SERVICE_SCOPE_CONFIRMATION', 'Customer confirmation of the contracted service scope', 'SERVICE_SCOPE_CONFIRMATION', 'ready_for_signature'),
  ('RESPONSIBILITY_START_CONFIRMATION', 'Evidence of the TES responsibility start boundary', 'RESPONSIBILITY_START_CONFIRMATION', 'ready_for_signature'),
  ('REQUIRED_SETTINGS_CONFIRMATION', 'Evidence supporting the required onboarding settings', 'REQUIRED_SETTINGS_CONFIRMATION', 'ready_for_signature'),
  ('PRICING_PACKAGE_CONFIRMATION', 'Customer confirmation of the pricing and package terms', 'PRICING_PACKAGE_CONFIRMATION', 'ready_for_signature'),
  ('SIGNED_CONTRACT_DOCUMENT', 'The signed contract document', 'SIGNED_CONTRACT_DOCUMENT', 'signed');

-- Pricing/package metadata for one contract line. Fees are agreed terms, not billing records.
CREATE TABLE public.customer_contract_line_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  line_item_id uuid NOT NULL
    REFERENCES public.customer_contract_line_items(id)
    ON DELETE RESTRICT,

  pricing_basis text NOT NULL,
  package_code text
    REFERENCES public.contract_package_definitions(package_code)
    ON DELETE RESTRICT,
  fee_minor_units bigint,
  fee_currency text,
  fee_period text NOT NULL DEFAULT 'none',

  decided_by_assignment_id uuid NOT NULL
    REFERENCES public.customer_authority_assignments(id)
    ON DELETE RESTRICT,
  decision_evidence_document_id uuid NOT NULL
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,
  master_register_event_id uuid NOT NULL
    REFERENCES public.master_register_events(event_id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_contract_line_pricing_basis_valid
    CHECK (pricing_basis IN ('monthly_package', 'one_time_service', 'included_in_package')),
  CONSTRAINT customer_contract_line_pricing_fee_valid
    CHECK (fee_minor_units IS NULL OR fee_minor_units >= 0),
  CONSTRAINT customer_contract_line_pricing_currency_valid
    CHECK (fee_currency IS NULL OR fee_currency IN ('CAD', 'USD')),
  CONSTRAINT customer_contract_line_pricing_period_valid
    CHECK (fee_period IN ('none', 'monthly', 'one_time')),
  CONSTRAINT customer_contract_line_pricing_shape_valid
    CHECK (
      (pricing_basis = 'monthly_package'
        AND package_code IS NOT NULL AND fee_minor_units IS NOT NULL AND fee_currency IS NOT NULL AND fee_period = 'monthly')
      OR (pricing_basis = 'one_time_service'
        AND fee_minor_units IS NOT NULL AND fee_currency IS NOT NULL AND fee_period = 'one_time')
      OR (pricing_basis = 'included_in_package'
        AND package_code IS NOT NULL AND fee_minor_units IS NULL AND fee_currency IS NULL AND fee_period = 'none')
    )
);

CREATE UNIQUE INDEX customer_contract_line_pricing_line_uq
  ON public.customer_contract_line_pricing(line_item_id);

-- Responsibility matrix for one contract line: who is responsible for what, from which date, and what happens to history.
CREATE TABLE public.customer_contract_responsibility_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  line_item_id uuid NOT NULL
    REFERENCES public.customer_contract_line_items(id)
    ON DELETE RESTRICT,

  responsibility_area text NOT NULL,
  responsible_party text NOT NULL,
  effective_responsibility_date date NOT NULL,
  history_treatment text NOT NULL DEFAULT 'excluded',
  history_assumed_from date,
  history_evidence_document_id uuid
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,

  decided_by_assignment_id uuid NOT NULL
    REFERENCES public.customer_authority_assignments(id)
    ON DELETE RESTRICT,
  decision_evidence_document_id uuid NOT NULL
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,
  master_register_event_id uuid NOT NULL
    REFERENCES public.master_register_events(event_id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_contract_responsibility_area_valid
    CHECK (responsibility_area ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  CONSTRAINT customer_contract_responsibility_party_valid
    CHECK (responsible_party IN ('TES', 'CUSTOMER', 'SHARED')),
  CONSTRAINT customer_contract_responsibility_history_valid
    CHECK (history_treatment IN ('excluded', 'customer_retains', 'tes_assumes_with_evidence')),
  CONSTRAINT customer_contract_responsibility_history_shape_valid
    CHECK (
      (history_treatment = 'tes_assumes_with_evidence'
        AND history_evidence_document_id IS NOT NULL
        AND history_assumed_from IS NOT NULL
        AND history_assumed_from < effective_responsibility_date)
      OR (history_treatment IN ('excluded', 'customer_retains')
        AND history_evidence_document_id IS NULL
        AND history_assumed_from IS NULL)
    )
);

CREATE UNIQUE INDEX customer_contract_responsibility_area_uq
  ON public.customer_contract_responsibility_matrix(line_item_id, responsibility_area);

-- Per-contract evidence requirement ledger, one row per catalogue rule.
CREATE TABLE public.customer_contract_evidence_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  contract_id uuid NOT NULL
    REFERENCES public.customer_contracts(id)
    ON DELETE RESTRICT,
  rule_code text NOT NULL
    REFERENCES public.contract_evidence_rules(rule_code)
    ON DELETE RESTRICT,

  requirement_status text NOT NULL DEFAULT 'missing',
  evidence_document_id uuid
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,
  master_register_event_id uuid
    REFERENCES public.master_register_events(event_id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_contract_evidence_requirements_status_valid
    CHECK (requirement_status IN ('missing', 'verified')),
  CONSTRAINT customer_contract_evidence_requirements_shape_valid
    CHECK (
      (requirement_status = 'verified' AND evidence_document_id IS NOT NULL AND master_register_event_id IS NOT NULL)
      OR (requirement_status = 'missing' AND evidence_document_id IS NULL AND master_register_event_id IS NULL)
    )
);

CREATE UNIQUE INDEX customer_contract_evidence_requirements_rule_uq
  ON public.customer_contract_evidence_requirements(contract_id, rule_code);

-- Append-only ledger of contract status. A NULL from_status is the accountability baseline (draft).
CREATE TABLE public.customer_contract_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  contract_id uuid NOT NULL
    REFERENCES public.customer_contracts(id)
    ON DELETE RESTRICT,

  from_status text,
  to_status text NOT NULL,
  evidence_document_id uuid
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,
  master_register_event_id uuid NOT NULL
    REFERENCES public.master_register_events(event_id)
    ON DELETE RESTRICT,
  actor_id uuid NOT NULL
    REFERENCES public.actors(id)
    ON DELETE RESTRICT,

  seq bigint GENERATED ALWAYS AS IDENTITY,
  recorded_txid bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT customer_contract_status_events_status_valid
    CHECK (
      to_status IN ('draft', 'ready_for_signature', 'signed', 'superseded', 'archived')
      AND (from_status IS NULL OR from_status IN ('draft', 'ready_for_signature', 'signed', 'superseded', 'archived'))
    ),
  CONSTRAINT customer_contract_status_events_transition_valid
    CHECK (
      (from_status IS NULL AND to_status = 'draft')
      OR (from_status = 'draft' AND to_status IN ('ready_for_signature', 'archived'))
      OR (from_status = 'ready_for_signature' AND to_status IN ('draft', 'signed'))
      OR (from_status = 'signed' AND to_status IN ('superseded', 'archived'))
      OR (from_status = 'superseded' AND to_status = 'archived')
    ),
  CONSTRAINT customer_contract_status_events_evidence_required
    CHECK (from_status IS NULL OR evidence_document_id IS NOT NULL)
);

CREATE UNIQUE INDEX customer_contract_status_events_seq_uq
  ON public.customer_contract_status_events(seq);
CREATE INDEX customer_contract_status_events_contract_idx
  ON public.customer_contract_status_events(contract_id, seq DESC);

-- Append-only ledger of authority changes. Every change names the verified written company notice behind it.
CREATE TABLE public.customer_authority_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  customer_id uuid NOT NULL
    REFERENCES public.customers(id)
    ON DELETE RESTRICT,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  authority_type text NOT NULL,
  change_type text NOT NULL,
  new_assignment_id uuid
    REFERENCES public.customer_authority_assignments(id)
    ON DELETE RESTRICT,
  prior_assignment_id uuid
    REFERENCES public.customer_authority_assignments(id)
    ON DELETE RESTRICT,
  notice_evidence_document_id uuid NOT NULL
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,
  master_register_event_id uuid NOT NULL
    REFERENCES public.master_register_events(event_id)
    ON DELETE RESTRICT,
  actor_id uuid NOT NULL
    REFERENCES public.actors(id)
    ON DELETE RESTRICT,

  recorded_txid bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT customer_authority_change_events_type_valid
    CHECK (authority_type IN ('SERVICE_DECISION_AUTHORITY', 'CONTRACT_SIGNATORY')),
  CONSTRAINT customer_authority_change_events_change_valid
    CHECK (change_type IN ('assigned', 'replaced', 'revoked')),
  CONSTRAINT customer_authority_change_events_shape_valid
    CHECK (
      (change_type = 'assigned' AND new_assignment_id IS NOT NULL AND prior_assignment_id IS NULL)
      OR (change_type = 'replaced' AND new_assignment_id IS NOT NULL AND prior_assignment_id IS NOT NULL AND new_assignment_id <> prior_assignment_id)
      OR (change_type = 'revoked' AND new_assignment_id IS NULL AND prior_assignment_id IS NOT NULL)
    )
);

CREATE INDEX customer_authority_change_events_customer_idx
  ON public.customer_authority_change_events(customer_id, authority_type, created_at DESC);
CREATE INDEX customer_authority_change_events_new_idx
  ON public.customer_authority_change_events(new_assignment_id) WHERE new_assignment_id IS NOT NULL;
CREATE INDEX customer_authority_change_events_prior_idx
  ON public.customer_authority_change_events(prior_assignment_id) WHERE prior_assignment_id IS NOT NULL;

-- ============================================================
-- 3. No delete / truncate, ledgers immutable
-- ============================================================

CREATE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'Contracts foundation data cannot be deleted or truncated (% on %.%)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION tes_security.prevent_contracts_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'Contracts ledger rows are append-only (% on %.%)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER contract_package_definitions_no_delete BEFORE DELETE ON public.contract_package_definitions
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER contract_package_definitions_no_truncate BEFORE TRUNCATE ON public.contract_package_definitions
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER contract_evidence_rules_no_delete BEFORE DELETE ON public.contract_evidence_rules
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER contract_evidence_rules_no_truncate BEFORE TRUNCATE ON public.contract_evidence_rules
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_line_pricing_no_delete BEFORE DELETE ON public.customer_contract_line_pricing
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_line_pricing_no_truncate BEFORE TRUNCATE ON public.customer_contract_line_pricing
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_responsibility_matrix_no_delete BEFORE DELETE ON public.customer_contract_responsibility_matrix
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_responsibility_matrix_no_truncate BEFORE TRUNCATE ON public.customer_contract_responsibility_matrix
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_evidence_requirements_no_delete BEFORE DELETE ON public.customer_contract_evidence_requirements
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_evidence_requirements_no_truncate BEFORE TRUNCATE ON public.customer_contract_evidence_requirements
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_status_events_no_delete BEFORE DELETE ON public.customer_contract_status_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_status_events_no_truncate BEFORE TRUNCATE ON public.customer_contract_status_events
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_authority_change_events_no_delete BEFORE DELETE ON public.customer_authority_change_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();
CREATE TRIGGER customer_authority_change_events_no_truncate BEFORE TRUNCATE ON public.customer_authority_change_events
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_contracts_foundation_delete_or_truncate();

CREATE TRIGGER customer_contract_status_events_immutable BEFORE UPDATE ON public.customer_contract_status_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_ledger_mutation();
CREATE TRIGGER customer_authority_change_events_immutable BEFORE UPDATE ON public.customer_authority_change_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_ledger_mutation();
CREATE TRIGGER contract_evidence_rules_immutable BEFORE UPDATE ON public.contract_evidence_rules
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_contracts_ledger_mutation();

-- ============================================================
-- 4. Customer authority: assignment guards and change ledger
-- ============================================================

-- New assignments must be active, name a verified written company notice, point at a real contact of the company and a
-- customer that belongs to the organization.
CREATE FUNCTION tes_security.guard_customer_authority_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ BEGIN
  IF NEW.assignment_status <> 'active' OR NEW.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'A customer authority assignment must start active and open' USING ERRCODE = '23514';
  END IF;
  IF NEW.notice_evidence_document_id IS NULL THEN
    RAISE EXCEPTION 'A customer authority assignment requires a verified written company notice' USING ERRCODE = '23514';
  END IF;
  IF NOT tes_security.contract_customer_matches_organization(NEW.customer_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'The customer does not belong to the organization' USING ERRCODE = '23514';
  END IF;
  IF NOT tes_security.contract_evidence_document_acceptable(NEW.notice_evidence_document_id, NEW.organization_id, 'CUSTOMER_AUTHORITY_NOTICE') THEN
    RAISE EXCEPTION 'The authority notice must be a verified, unexpired CUSTOMER_AUTHORITY_NOTICE of the same organization' USING ERRCODE = '23514';
  END IF;
  IF NOT tes_security.contract_person_is_organization_contact(NEW.person_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'The authority holder must be an active contact of the organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- An assignment is history once it leaves active: the only permitted change is active -> superseded/voided with its end and reason.
CREATE FUNCTION tes_security.guard_customer_authority_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ BEGIN
  IF OLD.assignment_status <> 'active' THEN
    RAISE EXCEPTION 'A superseded or voided authority assignment is preserved history and cannot change' USING ERRCODE = '55000';
  END IF;
  IF NEW.assignment_status = 'active' THEN
    RAISE EXCEPTION 'An active authority assignment can only be ended by a verified replacement or revocation' USING ERRCODE = '55000';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.person_id IS DISTINCT FROM OLD.person_id
     OR NEW.authority_type IS DISTINCT FROM OLD.authority_type
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.notice_evidence_document_id IS DISTINCT FROM OLD.notice_evidence_document_id THEN
    RAISE EXCEPTION 'Authority assignment identity and evidence are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.replacement_reason IS NULL THEN
    RAISE EXCEPTION 'Ending an authority assignment requires a reason' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Deferred: by commit, every authority creation and ending must be backed by a ledger row written in the same transaction.
CREATE FUNCTION tes_security.assert_customer_authority_change_recorded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_authority_change_events e
       WHERE e.new_assignment_id = NEW.id
         AND e.change_type IN ('assigned', 'replaced')
         AND e.recorded_txid = txid_current()
         AND e.authority_type = NEW.authority_type
         AND e.customer_id = NEW.customer_id
         AND e.notice_evidence_document_id = NEW.notice_evidence_document_id
    ) THEN
      RAISE EXCEPTION 'Authority assignment % has no verified-notice change record with a Master Register event in this transaction', NEW.id
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.assignment_status IN ('superseded', 'voided') AND OLD.assignment_status = 'active' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_authority_change_events e
       WHERE e.prior_assignment_id = NEW.id
         AND e.change_type IN ('replaced', 'revoked')
         AND e.recorded_txid = txid_current()
         AND e.authority_type = NEW.authority_type
         AND e.customer_id = NEW.customer_id
    ) THEN
      RAISE EXCEPTION 'Ending authority assignment % has no verified-notice change record with a Master Register event in this transaction', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION tes_security.guard_customer_authority_change_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  new_row public.customer_authority_assignments%ROWTYPE;
  prior_row public.customer_authority_assignments%ROWTYPE;
BEGIN
  NEW.recorded_txid := txid_current();
  IF NOT tes_security.contract_customer_matches_organization(NEW.customer_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'The customer does not belong to the organization' USING ERRCODE = '23514';
  END IF;
  IF NOT tes_security.contract_evidence_document_acceptable(NEW.notice_evidence_document_id, NEW.organization_id, 'CUSTOMER_AUTHORITY_NOTICE') THEN
    RAISE EXCEPTION 'The authority change notice must be a verified, unexpired CUSTOMER_AUTHORITY_NOTICE of the same organization' USING ERRCODE = '23514';
  END IF;
  IF NEW.new_assignment_id IS NOT NULL THEN
    SELECT * INTO new_row FROM public.customer_authority_assignments WHERE id = NEW.new_assignment_id;
    IF NOT FOUND
       OR new_row.customer_id <> NEW.customer_id
       OR new_row.authority_type <> NEW.authority_type
       OR new_row.assignment_status <> 'active'
       OR new_row.notice_evidence_document_id IS DISTINCT FROM NEW.notice_evidence_document_id THEN
      RAISE EXCEPTION 'The new assignment does not match this authority change' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.prior_assignment_id IS NOT NULL THEN
    SELECT * INTO prior_row FROM public.customer_authority_assignments WHERE id = NEW.prior_assignment_id;
    IF NOT FOUND
       OR prior_row.customer_id <> NEW.customer_id
       OR prior_row.authority_type <> NEW.authority_type
       OR prior_row.assignment_status NOT IN ('superseded', 'voided') THEN
      RAISE EXCEPTION 'The prior assignment must belong to this authority and already be ended' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_authority_assignments_guard_insert
  BEFORE INSERT ON public.customer_authority_assignments
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_customer_authority_insert();
CREATE TRIGGER customer_authority_assignments_guard_update
  BEFORE UPDATE ON public.customer_authority_assignments
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_customer_authority_update();
CREATE CONSTRAINT TRIGGER customer_authority_assignments_change_recorded
  AFTER INSERT OR UPDATE ON public.customer_authority_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tes_security.assert_customer_authority_change_recorded();
CREATE TRIGGER customer_authority_change_events_guard_insert
  BEFORE INSERT ON public.customer_authority_change_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_customer_authority_change_event_insert();

-- ============================================================
-- 5. Contract design rows: only while the contract is a draft, only under the current Service Decision Authority
-- ============================================================

-- Shared guard for pricing and responsibility rows.
CREATE FUNCTION tes_security.guard_contract_decision_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  contract public.customer_contracts%ROWTYPE;
  assignment public.customer_authority_assignments%ROWTYPE;
  line_scope uuid;
  start_date date;
BEGIN
  SELECT c.* INTO contract
    FROM public.customer_contracts c
    JOIN public.customer_contract_line_items l ON l.contract_id = c.id
   WHERE l.id = NEW.line_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract line item not found' USING ERRCODE = '23503';
  END IF;
  IF contract.contract_status <> 'draft' THEN
    RAISE EXCEPTION 'Contract design can only change while the contract is a draft' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.line_item_id <> OLD.line_item_id THEN
    RAISE EXCEPTION 'A design row cannot move between line items' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO assignment FROM public.customer_authority_assignments WHERE id = NEW.decided_by_assignment_id;
  IF NOT FOUND
     OR assignment.authority_type <> 'SERVICE_DECISION_AUTHORITY'
     OR assignment.assignment_status <> 'active'
     OR assignment.customer_id <> contract.customer_id
     OR contract.service_decision_authority_assignment_id IS DISTINCT FROM assignment.id THEN
    RAISE EXCEPTION 'Contracted service scope can only be decided by the contract''s active Service Decision Authority' USING ERRCODE = '23514';
  END IF;
  IF NOT tes_security.contract_evidence_document_acceptable(NEW.decision_evidence_document_id, contract.organization_id, NULL) THEN
    RAISE EXCEPTION 'The decision evidence must be a verified, unexpired document of the same organization' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'customer_contract_responsibility_matrix' THEN
    SELECT scope_id INTO line_scope FROM public.customer_contract_line_items WHERE id = NEW.line_item_id;
    start_date := tes_security.contract_scope_responsibility_start(line_scope);
    IF start_date IS NULL THEN
      RAISE EXCEPTION 'TES has not assumed responsibility for this scope yet' USING ERRCODE = '23514';
    END IF;
    IF NEW.effective_responsibility_date < start_date THEN
      RAISE EXCEPTION 'The effective responsibility date cannot precede the date TES assumed responsibility for the scope' USING ERRCODE = '23514';
    END IF;
    IF NEW.history_evidence_document_id IS NOT NULL
       AND NOT tes_security.contract_evidence_document_acceptable(NEW.history_evidence_document_id, contract.organization_id, NULL) THEN
      RAISE EXCEPTION 'Assumed pre-engagement history requires verified, unexpired evidence of the same organization' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.package_code IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.contract_package_definitions p
       WHERE p.package_code = NEW.package_code AND p.package_status = 'active'
         AND (NEW.pricing_basis = 'included_in_package' OR p.pricing_basis = NEW.pricing_basis)
    ) THEN
      RAISE EXCEPTION 'The package is not active or does not match the pricing basis' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_contract_line_pricing_guard
  BEFORE INSERT OR UPDATE ON public.customer_contract_line_pricing
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_contract_decision_row();
CREATE TRIGGER customer_contract_responsibility_matrix_guard
  BEFORE INSERT OR UPDATE ON public.customer_contract_responsibility_matrix
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_contract_decision_row();

-- Line items (0030 table): scopes can only be attached to a draft contract, must be current scopes of the contract's
-- engagement, and line identity is immutable. Added as a guard only; no existing row or column changes.
CREATE FUNCTION tes_security.guard_contract_line_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  contract public.customer_contracts%ROWTYPE;
BEGIN
  SELECT * INTO contract FROM public.customer_contracts WHERE id = NEW.contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF contract.contract_status <> 'draft' THEN
      RAISE EXCEPTION 'Scopes can only be attached to a draft contract' USING ERRCODE = '55000';
    END IF;
    IF NOT tes_security.contract_scope_is_current_in_engagement(NEW.scope_id, contract.engagement_id) THEN
      RAISE EXCEPTION 'The scope must be a current scope of the contract engagement' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.contract_id <> OLD.contract_id OR NEW.scope_id <> OLD.scope_id THEN
      RAISE EXCEPTION 'A contract line item cannot change contract or scope' USING ERRCODE = '55000';
    END IF;
    IF contract.contract_status <> 'draft'
       AND (NEW.line_status NOT IN ('ready', 'signed')
            OR OLD.line_status = 'removed'
            OR NEW.pricing_basis IS DISTINCT FROM OLD.pricing_basis
            OR NEW.package_code IS DISTINCT FROM OLD.package_code
            OR NEW.responsibility_boundary IS DISTINCT FROM OLD.responsibility_boundary) THEN
      RAISE EXCEPTION 'A line item of a non-draft contract can only advance its line status' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_contract_line_items_guard
  BEFORE INSERT OR UPDATE ON public.customer_contract_line_items
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_contract_line_item();

-- Evidence requirement rows: verified only with an acceptable document of the rule's type, never on a finished contract.
CREATE FUNCTION tes_security.guard_contract_evidence_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  contract public.customer_contracts%ROWTYPE;
  rule public.contract_evidence_rules%ROWTYPE;
BEGIN
  SELECT * INTO contract FROM public.customer_contracts WHERE id = NEW.contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found' USING ERRCODE = '23503';
  END IF;
  IF contract.contract_status NOT IN ('draft', 'ready_for_signature') THEN
    RAISE EXCEPTION 'Evidence can no longer be re-linked on a signed, superseded or archived contract' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.contract_id <> OLD.contract_id OR NEW.rule_code <> OLD.rule_code) THEN
    RAISE EXCEPTION 'An evidence requirement cannot change contract or rule' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO rule FROM public.contract_evidence_rules WHERE rule_code = NEW.rule_code;
  IF NEW.requirement_status = 'verified' AND NOT tes_security.contract_evidence_document_acceptable(NEW.evidence_document_id, contract.organization_id, rule.required_document_type) THEN
    RAISE EXCEPTION 'Requirement % needs a verified, unexpired % document of the same organization', NEW.rule_code, rule.required_document_type USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_contract_evidence_requirements_guard
  BEFORE INSERT OR UPDATE ON public.customer_contract_evidence_requirements
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_contract_evidence_requirement();

-- ============================================================
-- 6. Readiness gates: the single source of truth, used by the status trigger and by the application
-- ============================================================

CREATE FUNCTION tes_security.contract_gate_failures(p_contract_id uuid, p_target_status text)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c public.customer_contracts%ROWTYPE;
  sda public.customer_authority_assignments%ROWTYPE;
  sig public.customer_authority_assignments%ROWTYPE;
  failures text[] := ARRAY[]::text[];
  line_count integer;
  start_date date;
  rec record;
BEGIN
  SELECT * INTO c FROM public.customer_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RETURN ARRAY['CONTRACT_NOT_FOUND'];
  END IF;

  -- organization / customer relationship
  IF NOT tes_security.contract_customer_matches_organization(c.customer_id, c.organization_id)
     OR NOT tes_security.contract_engagement_is_open_for_customer(c.engagement_id, c.customer_id) THEN
    failures := array_append(failures, 'CUSTOMER_RELATIONSHIP');
  END IF;

  IF c.contract_reference IS NULL THEN
    failures := array_append(failures, 'CONTRACT_REFERENCE');
  END IF;

  -- service scope
  SELECT count(*) INTO line_count FROM public.customer_contract_line_items l WHERE l.contract_id = c.id AND l.line_status <> 'removed';
  IF line_count = 0 THEN
    failures := array_append(failures, 'SERVICE_SCOPE');
  ELSIF EXISTS (
    SELECT 1 FROM public.customer_contract_line_items l
     WHERE l.contract_id = c.id AND l.line_status <> 'removed'
       AND NOT tes_security.contract_scope_is_current_in_engagement(l.scope_id, c.engagement_id)
  ) THEN
    failures := array_append(failures, 'SERVICE_SCOPE');
  END IF;

  -- responsibility matrix (explicit effective date inside TES responsibility, decided by the current authority)
  IF line_count = 0 OR EXISTS (
    SELECT 1 FROM public.customer_contract_line_items l
     WHERE l.contract_id = c.id AND l.line_status <> 'removed'
       AND NOT EXISTS (SELECT 1 FROM public.customer_contract_responsibility_matrix m WHERE m.line_item_id = l.id)
  ) THEN
    failures := array_append(failures, 'RESPONSIBILITY_MATRIX');
  ELSE
    FOR rec IN
      SELECT m.*, l.scope_id FROM public.customer_contract_responsibility_matrix m
        JOIN public.customer_contract_line_items l ON l.id = m.line_item_id
       WHERE l.contract_id = c.id AND l.line_status <> 'removed'
    LOOP
      start_date := tes_security.contract_scope_responsibility_start(rec.scope_id);
      IF start_date IS NULL OR rec.effective_responsibility_date < start_date THEN
        failures := array_append(failures, 'RESPONSIBILITY_MATRIX');
        EXIT;
      END IF;
      IF rec.history_treatment = 'tes_assumes_with_evidence'
         AND NOT tes_security.contract_evidence_document_acceptable(rec.history_evidence_document_id, c.organization_id, NULL) THEN
        failures := array_append(failures, 'RESPONSIBILITY_MATRIX');
        EXIT;
      END IF;
      IF rec.decided_by_assignment_id IS DISTINCT FROM c.service_decision_authority_assignment_id THEN
        failures := array_append(failures, 'RESPONSIBILITY_MATRIX');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- required settings
  IF NOT tes_security.contract_required_settings_present(c.organization_id) THEN
    failures := array_append(failures, 'REQUIRED_SETTINGS');
  END IF;

  -- pricing / package definition
  IF line_count = 0 OR EXISTS (
    SELECT 1 FROM public.customer_contract_line_items l
     WHERE l.contract_id = c.id AND l.line_status <> 'removed'
       AND NOT EXISTS (
         SELECT 1 FROM public.customer_contract_line_pricing p
          WHERE p.line_item_id = l.id
            AND p.decided_by_assignment_id IS NOT DISTINCT FROM c.service_decision_authority_assignment_id
            AND (p.package_code IS NULL OR EXISTS (
                  SELECT 1 FROM public.contract_package_definitions d WHERE d.package_code = p.package_code AND d.package_status = 'active'))
       )
  ) THEN
    failures := array_append(failures, 'PRICING_PACKAGE');
  END IF;

  -- Service Decision Authority
  SELECT * INTO sda FROM public.customer_authority_assignments WHERE id = c.service_decision_authority_assignment_id;
  IF NOT FOUND OR sda.authority_type <> 'SERVICE_DECISION_AUTHORITY' OR sda.assignment_status <> 'active'
     OR sda.effective_to IS NOT NULL OR sda.customer_id <> c.customer_id
     OR NOT tes_security.contract_evidence_document_acceptable(sda.notice_evidence_document_id, c.organization_id, 'CUSTOMER_AUTHORITY_NOTICE') THEN
    failures := array_append(failures, 'SERVICE_DECISION_AUTHORITY');
  END IF;

  -- Contract Signatory
  SELECT * INTO sig FROM public.customer_authority_assignments WHERE id = c.contract_signatory_assignment_id;
  IF NOT FOUND OR sig.authority_type <> 'CONTRACT_SIGNATORY' OR sig.assignment_status <> 'active'
     OR sig.effective_to IS NOT NULL OR sig.customer_id <> c.customer_id
     OR NOT tes_security.contract_evidence_document_acceptable(sig.notice_evidence_document_id, c.organization_id, 'CUSTOMER_AUTHORITY_NOTICE') THEN
    failures := array_append(failures, 'CONTRACT_SIGNATORY');
  END IF;

  -- evidence requirements (every active rule due at or before the target status must be verified)
  IF EXISTS (
    SELECT 1 FROM public.contract_evidence_rules r
     WHERE r.rule_status = 'active'
       AND (r.required_before_status = 'ready_for_signature' OR p_target_status = 'signed')
       AND NOT EXISTS (
         SELECT 1 FROM public.customer_contract_evidence_requirements q
          WHERE q.contract_id = c.id AND q.rule_code = r.rule_code AND q.requirement_status = 'verified'
            AND tes_security.contract_evidence_document_acceptable(q.evidence_document_id, c.organization_id, r.required_document_type)
       )
  ) THEN
    failures := array_append(failures, 'EVIDENCE_REQUIREMENTS');
  END IF;

  -- Master Register accountability path: a baseline ledger entry exists and the newest ledger entry either records the
  -- contract's current status or (inside a transition) the move from the current status to the target status.
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_contract_status_events e WHERE e.contract_id = c.id AND e.from_status IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.customer_contract_status_events e
     WHERE e.contract_id = c.id
       AND e.seq = (SELECT max(e2.seq) FROM public.customer_contract_status_events e2 WHERE e2.contract_id = c.id)
       AND (e.to_status = c.contract_status OR (e.from_status = c.contract_status AND e.to_status = p_target_status))
  ) THEN
    failures := array_append(failures, 'MASTER_REGISTER_ACCOUNTABILITY');
  END IF;

  RETURN failures;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.contract_gate_failures(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.contract_gate_failures(uuid, text) TO "tes-backend@tes-production-510007.iam";

-- Status ledger insert: the transition must match the contract, carry acceptable evidence, and (for signing) the signed document.
CREATE FUNCTION tes_security.guard_contract_status_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  contract public.customer_contracts%ROWTYPE;
BEGIN
  NEW.recorded_txid := txid_current();
  SELECT * INTO contract FROM public.customer_contracts WHERE id = NEW.contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.from_status IS NULL THEN
    IF contract.contract_status <> 'draft' OR EXISTS (SELECT 1 FROM public.customer_contract_status_events e WHERE e.contract_id = NEW.contract_id) THEN
      RAISE EXCEPTION 'The accountability baseline can only be recorded once, for a draft contract' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.from_status <> contract.contract_status THEN
    RAISE EXCEPTION 'The recorded transition does not start from the contract''s current status' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_contract_status_events e WHERE e.contract_id = NEW.contract_id AND e.from_status IS NULL) THEN
    RAISE EXCEPTION 'The contract has no Master Register accountability baseline' USING ERRCODE = '23514';
  END IF;
  IF NOT tes_security.contract_evidence_document_acceptable(
       NEW.evidence_document_id,
       contract.organization_id,
       CASE WHEN NEW.to_status = 'signed' THEN 'SIGNED_CONTRACT_DOCUMENT' ELSE NULL END) THEN
    RAISE EXCEPTION 'A contract status change requires verified, unexpired evidence of the same organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_contract_status_events_guard_insert
  BEFORE INSERT ON public.customer_contract_status_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_contract_status_event_insert();

-- Contract status trigger: no status change without a same-transaction ledger row and passing gates; frozen identity.
CREATE FUNCTION tes_security.guard_customer_contract_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  failures text[];
BEGIN
  IF NEW.customer_id <> OLD.customer_id OR NEW.organization_id <> OLD.organization_id OR NEW.engagement_id <> OLD.engagement_id THEN
    RAISE EXCEPTION 'A contract cannot change customer, organization or engagement' USING ERRCODE = '55000';
  END IF;

  IF NEW.contract_status = 'draft' AND OLD.contract_status = 'draft' THEN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.contract_status = OLD.contract_status THEN
    IF NEW.service_decision_authority_assignment_id IS DISTINCT FROM OLD.service_decision_authority_assignment_id
       OR NEW.contract_signatory_assignment_id IS DISTINCT FROM OLD.contract_signatory_assignment_id
       OR NEW.contract_reference IS DISTINCT FROM OLD.contract_reference THEN
      RAISE EXCEPTION 'A non-draft contract cannot change its authorities or reference' USING ERRCODE = '55000';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_contract_status_events e
     WHERE e.contract_id = NEW.id
       AND e.from_status = OLD.contract_status
       AND e.to_status = NEW.contract_status
       AND e.recorded_txid = txid_current()
  ) THEN
    RAISE EXCEPTION 'Contract status change % -> % requires verified evidence and a Master Register accountability record in the same transaction',
      OLD.contract_status, NEW.contract_status USING ERRCODE = '23514';
  END IF;

  IF NEW.contract_status IN ('ready_for_signature', 'signed') THEN
    failures := tes_security.contract_gate_failures(NEW.id, NEW.contract_status);
    IF coalesce(array_length(failures, 1), 0) > 0 THEN
      RAISE EXCEPTION 'Contract readiness gates failed: %', array_to_string(failures, ', ') USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.contract_status = 'archived' AND NEW.archived_at IS NULL THEN
    NEW.archived_at := clock_timestamp();
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_contracts_guard_update
  BEFORE UPDATE ON public.customer_contracts
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_customer_contract_update();

-- ============================================================
-- 7. Row level security, policies and grants
-- ============================================================

ALTER TABLE public.contract_package_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_evidence_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contract_line_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contract_responsibility_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contract_evidence_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contract_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_authority_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_package_definitions_system_read ON public.contract_package_definitions FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY contract_package_definitions_system_insert ON public.contract_package_definitions FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));
CREATE POLICY contract_package_definitions_system_update ON public.contract_package_definitions FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

CREATE POLICY contract_evidence_rules_system_read ON public.contract_evidence_rules FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));

CREATE POLICY customer_contract_line_pricing_system_read ON public.customer_contract_line_pricing FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY customer_contract_line_pricing_system_insert ON public.customer_contract_line_pricing FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));
CREATE POLICY customer_contract_line_pricing_system_update ON public.customer_contract_line_pricing FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

CREATE POLICY customer_contract_responsibility_matrix_system_read ON public.customer_contract_responsibility_matrix FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY customer_contract_responsibility_matrix_system_insert ON public.customer_contract_responsibility_matrix FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));
CREATE POLICY customer_contract_responsibility_matrix_system_update ON public.customer_contract_responsibility_matrix FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

CREATE POLICY customer_contract_evidence_requirements_system_read ON public.customer_contract_evidence_requirements FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY customer_contract_evidence_requirements_system_insert ON public.customer_contract_evidence_requirements FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));
CREATE POLICY customer_contract_evidence_requirements_system_update ON public.customer_contract_evidence_requirements FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

CREATE POLICY customer_contract_status_events_system_read ON public.customer_contract_status_events FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY customer_contract_status_events_system_insert ON public.customer_contract_status_events FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

CREATE POLICY customer_authority_change_events_system_read ON public.customer_authority_change_events FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY customer_authority_change_events_system_insert ON public.customer_authority_change_events FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

GRANT SELECT, INSERT, UPDATE ON
  public.contract_package_definitions,
  public.customer_contract_line_pricing,
  public.customer_contract_responsibility_matrix,
  public.customer_contract_evidence_requirements
TO "tes-backend@tes-production-510007.iam";

GRANT SELECT, INSERT ON
  public.customer_contract_status_events,
  public.customer_authority_change_events
TO "tes-backend@tes-production-510007.iam";

GRANT SELECT ON public.contract_evidence_rules TO "tes-backend@tes-production-510007.iam";
