-- TES onboarding evidence, readiness, customer authority and contracts foundation
-- Migration: 0030
--
-- Scope:
--   - server-controlled evidence/document metadata for GCS-backed payloads
--   - immutable evidence links from documents to canonical records
--   - onboarding evidence requirement ledger and readiness snapshots
--   - exactly one active customer-side Service Decision Authority and Contract Signatory
--   - contract shell and line-item foundation for later generated agreements
--
-- This migration intentionally does NOT:
--   - store document payloads in PostgreSQL
--   - expose browser/localStorage/IndexedDB document storage
--   - create pricing calculations or invoices
--   - sign contracts or make a contract legally effective without later agreement workflow

INSERT INTO public.capabilities(code, display_name, description, is_active, sort_order)
VALUES
  (
    'EVIDENCE_READ',
    'Evidence read',
    'Read server-controlled document/evidence metadata, links, onboarding evidence requirements and readiness snapshots. Intended scope: SYSTEM only.',
    true,
    240
  ),
  (
    'EVIDENCE_MANAGE',
    'Evidence manage',
    'Create, link, classify, review, archive and restore server-controlled document/evidence metadata and onboarding readiness snapshots. Intended scope: SYSTEM only.',
    true,
    241
  ),
  (
    'CONTRACT_READ',
    'Contract read',
    'Read customer authority assignments and contract foundation records. Intended scope: SYSTEM only.',
    true,
    250
  ),
  (
    'CONTRACT_MANAGE',
    'Contract manage',
    'Create and advance customer authority assignments and contract foundation records. Intended scope: SYSTEM only.',
    true,
    251
  );

CREATE TABLE public.evidence_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  document_type text NOT NULL,
  document_title text NOT NULL,
  document_status text NOT NULL DEFAULT 'received',
  sensitivity text NOT NULL DEFAULT 'standard',

  gcs_bucket text NOT NULL,
  gcs_object_name text NOT NULL,
  gcs_generation text,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,

  issued_at date,
  effective_from date,
  expires_at date,

  source_channel text NOT NULL,
  intake_batch_id uuid
    REFERENCES public.legacy_import_batches(id)
    ON DELETE RESTRICT,

  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidence_documents_type_valid
    CHECK (document_type ~ '^[A-Z][A-Z0-9_]{1,80}$'),

  CONSTRAINT evidence_documents_title_valid
    CHECK (
      document_title = btrim(document_title)
      AND char_length(document_title) BETWEEN 1 AND 240
      AND document_title !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
    ),

  CONSTRAINT evidence_documents_status_valid
    CHECK (document_status IN ('received', 'classified', 'verified', 'rejected', 'archived')),

  CONSTRAINT evidence_documents_sensitivity_valid
    CHECK (sensitivity IN ('standard', 'sensitive', 'restricted')),

  CONSTRAINT evidence_documents_bucket_valid
    CHECK (gcs_bucket ~ '^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$'),

  CONSTRAINT evidence_documents_object_valid
    CHECK (
      gcs_object_name = btrim(gcs_object_name)
      AND char_length(gcs_object_name) BETWEEN 3 AND 1000
      AND gcs_object_name !~ '(^/|//|\.\.|[\x01-\x1F\x7F])'
    ),

  CONSTRAINT evidence_documents_generation_valid
    CHECK (gcs_generation IS NULL OR gcs_generation ~ '^[0-9]{1,40}$'),

  CONSTRAINT evidence_documents_sha_valid
    CHECK (sha256 ~ '^[a-f0-9]{64}$'),

  CONSTRAINT evidence_documents_mime_valid
    CHECK (mime_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$'),

  CONSTRAINT evidence_documents_size_valid
    CHECK (byte_size > 0),

  CONSTRAINT evidence_documents_date_window_valid
    CHECK (
      (effective_from IS NULL OR expires_at IS NULL OR expires_at >= effective_from)
      AND (issued_at IS NULL OR expires_at IS NULL OR expires_at >= issued_at)
    ),

  CONSTRAINT evidence_documents_source_valid
    CHECK (source_channel IN ('intake', 'staff_upload', 'client_upload', 'system_generated', 'legacy_import')),

  CONSTRAINT evidence_documents_archive_state_valid
    CHECK (
      (document_status = 'archived' AND archived_at IS NOT NULL)
      OR (document_status <> 'archived' AND archived_at IS NULL)
    )
);

CREATE UNIQUE INDEX evidence_documents_gcs_object_uq
  ON public.evidence_documents(gcs_bucket, gcs_object_name, COALESCE(gcs_generation, ''));

CREATE INDEX evidence_documents_organization_idx
  ON public.evidence_documents(organization_id, document_status, document_type);

CREATE TABLE public.evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  evidence_document_id uuid NOT NULL
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,

  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  target_table text NOT NULL,
  target_id uuid NOT NULL,
  relationship_type text NOT NULL DEFAULT 'supports',
  link_status text NOT NULL DEFAULT 'active',

  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  CONSTRAINT evidence_links_target_valid
    CHECK (
      target_table IN (
        'organizations',
        'customers',
        'customer_engagements',
        'engagement_service_scopes',
        'engagement_responsibility_periods',
        'operating_authorities',
        'registrations',
        'insurance_policies',
        'company_credentials',
        'credential_systems',
        'vehicles',
        'organization_vehicle_relationships',
        'driver_profiles',
        'organization_driver_relationships',
        'company_operating_scope_assertions',
        'company_driver_requirement_assertions',
        'customer_authority_assignments',
        'customer_contracts',
        'customer_contract_line_items'
      )
    ),

  CONSTRAINT evidence_links_relationship_valid
    CHECK (relationship_type IN ('supports', 'source', 'authority_notice', 'contract_attachment', 'readiness_requirement')),

  CONSTRAINT evidence_links_status_valid
    CHECK (link_status IN ('active', 'archived')),

  CONSTRAINT evidence_links_archive_state_valid
    CHECK (
      (link_status = 'archived' AND archived_at IS NOT NULL)
      OR (link_status = 'active' AND archived_at IS NULL)
    )
);

CREATE UNIQUE INDEX evidence_links_active_target_uq
  ON public.evidence_links(evidence_document_id, target_table, target_id, relationship_type)
  WHERE link_status = 'active';

CREATE INDEX evidence_links_target_idx
  ON public.evidence_links(target_table, target_id, link_status);

CREATE TABLE public.onboarding_evidence_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  engagement_id uuid
    REFERENCES public.customer_engagements(id)
    ON DELETE RESTRICT,

  scope_id uuid
    REFERENCES public.engagement_service_scopes(id)
    ON DELETE RESTRICT,

  requirement_code text NOT NULL,
  requirement_label text NOT NULL,
  required_for text NOT NULL,
  required_document_type text NOT NULL,
  requirement_status text NOT NULL DEFAULT 'missing',
  satisfied_by_evidence_document_id uuid
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT onboarding_evidence_requirements_code_valid
    CHECK (requirement_code ~ '^[A-Z][A-Z0-9_]{1,80}$'),

  CONSTRAINT onboarding_evidence_requirements_label_valid
    CHECK (
      requirement_label = btrim(requirement_label)
      AND char_length(requirement_label) BETWEEN 1 AND 240
      AND requirement_label !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
    ),

  CONSTRAINT onboarding_evidence_requirements_for_valid
    CHECK (required_for IN ('organization', 'service_scope', 'responsibility', 'settings', 'authority_roles', 'contract')),

  CONSTRAINT onboarding_evidence_requirements_doc_type_valid
    CHECK (required_document_type ~ '^[A-Z][A-Z0-9_]{1,80}$'),

  CONSTRAINT onboarding_evidence_requirements_status_valid
    CHECK (requirement_status IN ('missing', 'received', 'verified', 'waived', 'not_applicable')),

  CONSTRAINT onboarding_evidence_requirements_satisfaction_valid
    CHECK (
      (requirement_status IN ('received', 'verified') AND satisfied_by_evidence_document_id IS NOT NULL)
      OR (requirement_status IN ('missing', 'waived', 'not_applicable') AND satisfied_by_evidence_document_id IS NULL)
    )
);

CREATE UNIQUE INDEX onboarding_evidence_requirements_current_uq
  ON public.onboarding_evidence_requirements(organization_id, COALESCE(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), requirement_code);

CREATE INDEX onboarding_evidence_requirements_status_idx
  ON public.onboarding_evidence_requirements(organization_id, requirement_status, required_for);

CREATE TABLE public.onboarding_readiness_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  engagement_id uuid
    REFERENCES public.customer_engagements(id)
    ON DELETE RESTRICT,

  readiness_status text NOT NULL,
  completed_count integer NOT NULL,
  total_count integer NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  computed_by_actor_id uuid NOT NULL
    REFERENCES public.actors(id)
    ON DELETE RESTRICT,

  CONSTRAINT onboarding_readiness_status_valid
    CHECK (readiness_status IN ('not_ready', 'missing_evidence', 'settings_required', 'ready_for_contract', 'ready_for_service_start')),

  CONSTRAINT onboarding_readiness_counts_valid
    CHECK (completed_count >= 0 AND total_count >= completed_count),

  CONSTRAINT onboarding_readiness_blockers_is_array
    CHECK (jsonb_typeof(blockers) = 'array')
);

CREATE INDEX onboarding_readiness_snapshots_current_idx
  ON public.onboarding_readiness_snapshots(organization_id, computed_at DESC);

CREATE TABLE public.customer_authority_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  customer_id uuid NOT NULL
    REFERENCES public.customers(id)
    ON DELETE RESTRICT,

  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  person_id uuid NOT NULL
    REFERENCES public.persons(id)
    ON DELETE RESTRICT,

  authority_type text NOT NULL,
  assignment_status text NOT NULL DEFAULT 'active',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  replacement_reason text,
  notice_evidence_document_id uuid
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_authority_assignments_type_valid
    CHECK (authority_type IN ('SERVICE_DECISION_AUTHORITY', 'CONTRACT_SIGNATORY')),

  CONSTRAINT customer_authority_assignments_status_valid
    CHECK (assignment_status IN ('active', 'superseded', 'voided')),

  CONSTRAINT customer_authority_assignments_window_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from),

  CONSTRAINT customer_authority_assignments_replacement_reason_valid
    CHECK (
      replacement_reason IS NULL
      OR (
        replacement_reason = btrim(replacement_reason)
        AND char_length(replacement_reason) BETWEEN 3 AND 240
        AND replacement_reason !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
      )
    ),

  CONSTRAINT customer_authority_assignments_end_state_valid
    CHECK (
      (assignment_status = 'active' AND effective_to IS NULL)
      OR (assignment_status IN ('superseded', 'voided') AND effective_to IS NOT NULL)
    )
);

CREATE UNIQUE INDEX customer_authority_assignments_one_active_uq
  ON public.customer_authority_assignments(customer_id, authority_type)
  WHERE assignment_status = 'active' AND effective_to IS NULL;

CREATE INDEX customer_authority_assignments_org_idx
  ON public.customer_authority_assignments(organization_id, authority_type, assignment_status);

CREATE TABLE public.customer_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  customer_id uuid NOT NULL
    REFERENCES public.customers(id)
    ON DELETE RESTRICT,

  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  engagement_id uuid NOT NULL
    REFERENCES public.customer_engagements(id)
    ON DELETE RESTRICT,

  contract_status text NOT NULL DEFAULT 'draft',
  contract_reference text,
  service_decision_authority_assignment_id uuid
    REFERENCES public.customer_authority_assignments(id)
    ON DELETE RESTRICT,
  contract_signatory_assignment_id uuid
    REFERENCES public.customer_authority_assignments(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  CONSTRAINT customer_contracts_status_valid
    CHECK (contract_status IN ('draft', 'ready_for_signature', 'signed', 'superseded', 'archived')),

  CONSTRAINT customer_contracts_reference_valid
    CHECK (
      contract_reference IS NULL
      OR (
        contract_reference = btrim(contract_reference)
        AND char_length(contract_reference) BETWEEN 1 AND 120
        AND contract_reference !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
      )
    ),

  CONSTRAINT customer_contracts_archive_state_valid
    CHECK (
      (contract_status = 'archived' AND archived_at IS NOT NULL)
      OR (contract_status <> 'archived' AND archived_at IS NULL)
    )
);

CREATE INDEX customer_contracts_org_idx
  ON public.customer_contracts(organization_id, contract_status, created_at DESC);

CREATE TABLE public.customer_contract_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  contract_id uuid NOT NULL
    REFERENCES public.customer_contracts(id)
    ON DELETE RESTRICT,

  scope_id uuid NOT NULL
    REFERENCES public.engagement_service_scopes(id)
    ON DELETE RESTRICT,

  line_status text NOT NULL DEFAULT 'draft',
  pricing_basis text NOT NULL DEFAULT 'to_be_defined',
  package_code text,
  responsibility_boundary text NOT NULL DEFAULT 'from_effective_responsibility_date_only',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_contract_line_items_status_valid
    CHECK (line_status IN ('draft', 'ready', 'signed', 'removed')),

  CONSTRAINT customer_contract_line_items_pricing_basis_valid
    CHECK (pricing_basis IN ('monthly_package', 'one_time_service', 'included_in_package', 'to_be_defined')),

  CONSTRAINT customer_contract_line_items_package_valid
    CHECK (
      package_code IS NULL
      OR package_code ~ '^[A-Z][A-Z0-9_]{1,80}$'
    ),

  CONSTRAINT customer_contract_line_items_boundary_valid
    CHECK (responsibility_boundary IN ('from_effective_responsibility_date_only', 'customer_retains_history', 'tes_assumes_defined_history_with_evidence'))
);

CREATE UNIQUE INDEX customer_contract_line_items_scope_uq
  ON public.customer_contract_line_items(contract_id, scope_id)
  WHERE line_status <> 'removed';

CREATE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'Onboarding evidence and contract foundation data cannot be deleted or truncated (% on %.%)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER evidence_documents_no_delete
  BEFORE DELETE ON public.evidence_documents
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();
CREATE TRIGGER evidence_documents_no_truncate
  BEFORE TRUNCATE ON public.evidence_documents
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();

CREATE TRIGGER evidence_links_no_delete
  BEFORE DELETE ON public.evidence_links
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();
CREATE TRIGGER evidence_links_no_truncate
  BEFORE TRUNCATE ON public.evidence_links
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();

CREATE TRIGGER onboarding_evidence_requirements_no_delete
  BEFORE DELETE ON public.onboarding_evidence_requirements
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();
CREATE TRIGGER onboarding_evidence_requirements_no_truncate
  BEFORE TRUNCATE ON public.onboarding_evidence_requirements
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();

CREATE TRIGGER onboarding_readiness_snapshots_no_delete
  BEFORE DELETE ON public.onboarding_readiness_snapshots
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();
CREATE TRIGGER onboarding_readiness_snapshots_no_truncate
  BEFORE TRUNCATE ON public.onboarding_readiness_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();

CREATE TRIGGER customer_authority_assignments_no_delete
  BEFORE DELETE ON public.customer_authority_assignments
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();
CREATE TRIGGER customer_authority_assignments_no_truncate
  BEFORE TRUNCATE ON public.customer_authority_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();

CREATE TRIGGER customer_contracts_no_delete
  BEFORE DELETE ON public.customer_contracts
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();
CREATE TRIGGER customer_contracts_no_truncate
  BEFORE TRUNCATE ON public.customer_contracts
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();

CREATE TRIGGER customer_contract_line_items_no_delete
  BEFORE DELETE ON public.customer_contract_line_items
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();
CREATE TRIGGER customer_contract_line_items_no_truncate
  BEFORE TRUNCATE ON public.customer_contract_line_items
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_onboarding_foundation_delete_or_truncate();

ALTER TABLE public.evidence_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_evidence_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_readiness_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_authority_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contract_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_documents_system_read ON public.evidence_documents FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_READ','EVIDENCE_MANAGE']));
CREATE POLICY evidence_documents_system_insert ON public.evidence_documents FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));
CREATE POLICY evidence_documents_system_update ON public.evidence_documents FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));

CREATE POLICY evidence_links_system_read ON public.evidence_links FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_READ','EVIDENCE_MANAGE']));
CREATE POLICY evidence_links_system_insert ON public.evidence_links FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));
CREATE POLICY evidence_links_system_update ON public.evidence_links FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));

CREATE POLICY onboarding_evidence_requirements_system_read ON public.onboarding_evidence_requirements FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_READ','EVIDENCE_MANAGE']));
CREATE POLICY onboarding_evidence_requirements_system_insert ON public.onboarding_evidence_requirements FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));
CREATE POLICY onboarding_evidence_requirements_system_update ON public.onboarding_evidence_requirements FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));

CREATE POLICY onboarding_readiness_snapshots_system_read ON public.onboarding_readiness_snapshots FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_READ','EVIDENCE_MANAGE']));
CREATE POLICY onboarding_readiness_snapshots_system_insert ON public.onboarding_readiness_snapshots FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));

CREATE POLICY customer_authority_assignments_system_read ON public.customer_authority_assignments FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY customer_authority_assignments_system_insert ON public.customer_authority_assignments FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));
CREATE POLICY customer_authority_assignments_system_update ON public.customer_authority_assignments FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

CREATE POLICY customer_contracts_system_read ON public.customer_contracts FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY customer_contracts_system_insert ON public.customer_contracts FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));
CREATE POLICY customer_contracts_system_update ON public.customer_contracts FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

CREATE POLICY customer_contract_line_items_system_read ON public.customer_contract_line_items FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_READ','CONTRACT_MANAGE']));
CREATE POLICY customer_contract_line_items_system_insert ON public.customer_contract_line_items FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));
CREATE POLICY customer_contract_line_items_system_update ON public.customer_contract_line_items FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTRACT_MANAGE']));

GRANT SELECT, INSERT, UPDATE ON
  public.evidence_documents,
  public.evidence_links,
  public.onboarding_evidence_requirements,
  public.onboarding_readiness_snapshots,
  public.customer_authority_assignments,
  public.customer_contracts,
  public.customer_contract_line_items
TO "tes-backend@tes-production-510007.iam";
