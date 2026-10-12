-- TES canonical data cutover import infrastructure
-- Migration: 0029
--
-- Scope:
--   - controlled import batch ledger for browser/localStorage source datasets
--   - per-record immutable source snapshots with SHA-256 provenance
--   - explicit review/exception tracking before canonical writes are committed
--   - namespace-scoped continuity support for non-company legacy entities
--
-- This migration intentionally does NOT:
--   - import any browser/localStorage data
--   - create or mutate any canonical organization, vehicle, driver, authority, insurance, registration or credential row
--   - delete or clear browser data
--   - store credential secrets
--   - store evidence/document payloads

INSERT INTO public.capabilities(code, display_name, description, is_active, sort_order)
VALUES
  (
    'LEGACY_IMPORT_READ',
    'Legacy import read',
    'Read controlled browser/localStorage import batches, reports and exceptions. Intended scope: SYSTEM only.',
    true,
    230
  ),
  (
    'LEGACY_IMPORT_MANAGE',
    'Legacy import manage',
    'Create and advance controlled browser/localStorage import batches and reconciliation decisions. Intended scope: SYSTEM only.',
    true,
    231
  );

CREATE TABLE public.legacy_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source_system text NOT NULL,
  source_namespace text NOT NULL,
  source_description text,

  import_mode text NOT NULL,
  batch_status text NOT NULL DEFAULT 'draft',

  requested_by_actor_id uuid NOT NULL
    REFERENCES public.actors(id)
    ON DELETE RESTRICT,

  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT legacy_import_batches_source_system_valid
    CHECK (source_system ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

  CONSTRAINT legacy_import_batches_source_namespace_valid
    CHECK (
      btrim(source_namespace) <> ''
      AND source_namespace = btrim(source_namespace)
      AND char_length(source_namespace) <= 200
      AND source_namespace !~ '[\x01-\x1F\x7F]'
    ),

  CONSTRAINT legacy_import_batches_description_valid
    CHECK (
      source_description IS NULL
      OR (
        source_description = btrim(source_description)
        AND char_length(source_description) BETWEEN 1 AND 1000
        AND source_description !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
      )
    ),

  CONSTRAINT legacy_import_batches_mode_valid
    CHECK (import_mode IN ('dry_run', 'commit')),

  CONSTRAINT legacy_import_batches_status_valid
    CHECK (batch_status IN ('draft', 'running', 'completed', 'failed', 'cancelled')),

  CONSTRAINT legacy_import_batches_time_state_valid
    CHECK (
      (batch_status = 'draft' AND started_at IS NULL AND completed_at IS NULL AND failed_at IS NULL)
      OR
      (batch_status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL)
      OR
      (batch_status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL)
      OR
      (batch_status = 'failed' AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NOT NULL AND failure_reason IS NOT NULL)
      OR
      (batch_status = 'cancelled' AND completed_at IS NULL)
    )
);

CREATE INDEX legacy_import_batches_source_idx
  ON public.legacy_import_batches(source_system, source_namespace, created_at DESC);

CREATE INDEX legacy_import_batches_status_idx
  ON public.legacy_import_batches(batch_status, created_at DESC);

CREATE TABLE public.legacy_canonical_record_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source_system text NOT NULL,
  source_namespace text NOT NULL,
  legacy_entity_type text NOT NULL,
  legacy_id text NOT NULL,

  canonical_table text NOT NULL,
  canonical_id uuid NOT NULL,

  mapping_status text NOT NULL DEFAULT 'active',
  superseded_at timestamptz,

  import_batch_id uuid NOT NULL
    REFERENCES public.legacy_import_batches(id)
    ON DELETE RESTRICT,

  imported_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT legacy_canonical_record_map_source_system_valid
    CHECK (source_system ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

  CONSTRAINT legacy_canonical_record_map_source_namespace_valid
    CHECK (
      btrim(source_namespace) <> ''
      AND source_namespace = btrim(source_namespace)
      AND char_length(source_namespace) <= 200
      AND source_namespace !~ '[\x01-\x1F\x7F]'
    ),

  CONSTRAINT legacy_canonical_record_map_entity_type_valid
    CHECK (
      legacy_entity_type IN (
        'CUSTOMER',
        'LOCATION',
        'PERSON',
        'CONTACT_RELATIONSHIP',
        'VEHICLE',
        'ORGANIZATION_VEHICLE_RELATIONSHIP',
        'DRIVER_PROFILE',
        'ORGANIZATION_DRIVER_RELATIONSHIP',
        'AUTHORITY',
        'TAX_REGISTRATION',
        'INSURANCE_POLICY',
        'CREDENTIAL_SYSTEM',
        'COMPANY_CREDENTIAL'
      )
    ),

  CONSTRAINT legacy_canonical_record_map_legacy_id_valid
    CHECK (legacy_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),

  CONSTRAINT legacy_canonical_record_map_table_valid
    CHECK (
      canonical_table IN (
        'customers',
        'locations',
        'persons',
        'organization_person_relationships',
        'vehicles',
        'organization_vehicle_relationships',
        'driver_profiles',
        'organization_driver_relationships',
        'operating_authorities',
        'registrations',
        'insurance_policies',
        'credential_systems',
        'company_credentials'
      )
    ),

  CONSTRAINT legacy_canonical_record_map_status_valid
    CHECK (mapping_status IN ('active', 'superseded')),

  CONSTRAINT legacy_canonical_record_map_supersede_state_consistent
    CHECK (
      (mapping_status = 'active' AND superseded_at IS NULL)
      OR
      (mapping_status = 'superseded' AND superseded_at IS NOT NULL)
    ),

  CONSTRAINT legacy_canonical_record_map_supersede_not_before_import
    CHECK (superseded_at IS NULL OR superseded_at >= imported_at)
);

CREATE UNIQUE INDEX legacy_canonical_record_map_active_source_key_uq
  ON public.legacy_canonical_record_map (
    source_system,
    source_namespace,
    legacy_entity_type,
    legacy_id
  )
  WHERE mapping_status = 'active';

CREATE INDEX legacy_canonical_record_map_target_idx
  ON public.legacy_canonical_record_map(canonical_table, canonical_id);

CREATE TABLE public.legacy_import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  import_batch_id uuid NOT NULL
    REFERENCES public.legacy_import_batches(id)
    ON DELETE RESTRICT,

  source_system text NOT NULL,
  source_namespace text NOT NULL,
  legacy_entity_type text NOT NULL,
  legacy_id text NOT NULL,

  source_key text NOT NULL,
  source_sha256 text NOT NULL,
  source_snapshot jsonb NOT NULL,

  record_status text NOT NULL DEFAULT 'pending',
  canonical_table text,
  canonical_id uuid,
  legacy_company_record_map_id uuid
    REFERENCES public.legacy_record_map(id)
    ON DELETE RESTRICT,
  legacy_canonical_record_map_id uuid
    REFERENCES public.legacy_canonical_record_map(id)
    ON DELETE RESTRICT,

  parent_legacy_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  secondary_canonical_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  unsupported_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  exception_summary text,
  exception_details jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT legacy_import_records_source_system_valid
    CHECK (source_system ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

  CONSTRAINT legacy_import_records_source_namespace_valid
    CHECK (
      btrim(source_namespace) <> ''
      AND source_namespace = btrim(source_namespace)
      AND char_length(source_namespace) <= 200
      AND source_namespace !~ '[\x01-\x1F\x7F]'
    ),

  CONSTRAINT legacy_import_records_entity_type_valid
    CHECK (
      legacy_entity_type IN (
        'COMPANY',
        'CUSTOMER',
        'LOCATION',
        'PERSON',
        'CONTACT_RELATIONSHIP',
        'VEHICLE',
        'ORGANIZATION_VEHICLE_RELATIONSHIP',
        'DRIVER_PROFILE',
        'ORGANIZATION_DRIVER_RELATIONSHIP',
        'AUTHORITY',
        'TAX_REGISTRATION',
        'INSURANCE_POLICY',
        'CREDENTIAL_SYSTEM',
        'COMPANY_CREDENTIAL',
        'UNSUPPORTED'
      )
    ),

  CONSTRAINT legacy_import_records_legacy_id_valid
    CHECK (legacy_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),

  CONSTRAINT legacy_import_records_source_key_valid
    CHECK (
      btrim(source_key) <> ''
      AND source_key = btrim(source_key)
      AND char_length(source_key) <= 500
      AND source_key !~ '[\x01-\x1F\x7F]'
    ),

  CONSTRAINT legacy_import_records_sha256_valid
    CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT legacy_import_records_snapshot_is_object
    CHECK (jsonb_typeof(source_snapshot) = 'object' AND source_snapshot <> '{}'::jsonb),

  CONSTRAINT legacy_import_records_status_valid
    CHECK (record_status IN ('pending', 'imported', 'review_required', 'unsupported', 'skipped', 'failed')),

  CONSTRAINT legacy_import_records_canonical_table_valid
    CHECK (
      canonical_table IS NULL
      OR canonical_table IN (
        'organizations',
        'customers',
        'locations',
        'persons',
        'organization_person_relationships',
        'vehicles',
        'organization_vehicle_relationships',
        'driver_profiles',
        'organization_driver_relationships',
        'operating_authorities',
        'registrations',
        'insurance_policies',
        'credential_systems',
        'company_credentials'
      )
    ),

  CONSTRAINT legacy_import_records_json_shapes_valid
    CHECK (
      jsonb_typeof(parent_legacy_ids) = 'object'
      AND jsonb_typeof(secondary_canonical_rows) = 'array'
      AND jsonb_typeof(unsupported_fields) = 'array'
      AND jsonb_typeof(exception_details) = 'object'
    ),

  CONSTRAINT legacy_import_records_imported_has_target
    CHECK (
      record_status <> 'imported'
      OR (canonical_table IS NOT NULL AND canonical_id IS NOT NULL)
    ),

  CONSTRAINT legacy_import_records_exception_summary_valid
    CHECK (
      exception_summary IS NULL
      OR (
        exception_summary = btrim(exception_summary)
        AND char_length(exception_summary) BETWEEN 1 AND 1000
        AND exception_summary !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
      )
    ),

  CONSTRAINT legacy_import_records_source_matches_batch_uq
    UNIQUE (import_batch_id, source_key),

  CONSTRAINT legacy_import_records_identity_content_uq
    UNIQUE (import_batch_id, source_system, source_namespace, legacy_entity_type, legacy_id, source_sha256)
);

CREATE INDEX legacy_import_records_lookup_idx
  ON public.legacy_import_records(source_system, source_namespace, legacy_entity_type, legacy_id);

CREATE INDEX legacy_import_records_batch_status_idx
  ON public.legacy_import_records(import_batch_id, record_status, legacy_entity_type);

CREATE INDEX legacy_import_records_target_idx
  ON public.legacy_import_records(canonical_table, canonical_id)
  WHERE canonical_table IS NOT NULL AND canonical_id IS NOT NULL;

CREATE TABLE public.legacy_import_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  import_batch_id uuid NOT NULL
    REFERENCES public.legacy_import_batches(id)
    ON DELETE RESTRICT,

  domain_code text NOT NULL,
  checkpoint_status text NOT NULL DEFAULT 'pending',
  processed_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  unsupported_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  last_source_key text,
  checkpoint_payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT legacy_import_checkpoints_domain_valid
    CHECK (
      domain_code IN (
        'COMPANIES',
        'CUSTOMERS',
        'LOCATIONS',
        'CONTACTS',
        'VEHICLES',
        'DRIVERS',
        'AUTHORITIES',
        'TAX_REGISTRATIONS',
        'COMPANY_PROFILE',
        'INSURANCE',
        'CREDENTIAL_METADATA',
        'UNSUPPORTED_SNAPSHOTS'
      )
    ),

  CONSTRAINT legacy_import_checkpoints_status_valid
    CHECK (checkpoint_status IN ('pending', 'running', 'completed', 'blocked', 'failed', 'skipped')),

  CONSTRAINT legacy_import_checkpoints_counts_valid
    CHECK (
      processed_count >= 0
      AND imported_count >= 0
      AND review_count >= 0
      AND unsupported_count >= 0
      AND failed_count >= 0
      AND imported_count + review_count + unsupported_count + failed_count <= processed_count
    ),

  CONSTRAINT legacy_import_checkpoints_last_source_key_valid
    CHECK (
      last_source_key IS NULL
      OR (
        btrim(last_source_key) <> ''
        AND last_source_key = btrim(last_source_key)
        AND char_length(last_source_key) <= 500
        AND last_source_key !~ '[\x01-\x1F\x7F]'
      )
    ),

  CONSTRAINT legacy_import_checkpoints_payload_is_object
    CHECK (jsonb_typeof(checkpoint_payload) = 'object'),

  CONSTRAINT legacy_import_checkpoints_batch_domain_uq
    UNIQUE (import_batch_id, domain_code)
);

CREATE TABLE public.legacy_import_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  import_record_id uuid NOT NULL
    REFERENCES public.legacy_import_records(id)
    ON DELETE RESTRICT,

  decision text NOT NULL,
  decided_by_actor_id uuid NOT NULL
    REFERENCES public.actors(id)
    ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now(),
  decision_reason text NOT NULL,
  decision_payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT legacy_import_review_decisions_decision_valid
    CHECK (decision IN ('approve_match', 'create_new', 'skip', 'mark_unsupported', 'reject_source')),

  CONSTRAINT legacy_import_review_decisions_reason_valid
    CHECK (
      decision_reason = btrim(decision_reason)
      AND char_length(decision_reason) BETWEEN 3 AND 2000
      AND decision_reason !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
    ),

  CONSTRAINT legacy_import_review_decisions_payload_is_object
    CHECK (jsonb_typeof(decision_payload) = 'object')
);

CREATE INDEX legacy_import_review_decisions_record_idx
  ON public.legacy_import_review_decisions(import_record_id, decided_at DESC);

CREATE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'Legacy import control data cannot be deleted or truncated (% on %.%)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER legacy_import_batches_no_delete
  BEFORE DELETE ON public.legacy_import_batches
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_import_batches_no_truncate
  BEFORE TRUNCATE ON public.legacy_import_batches
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_canonical_record_map_no_delete
  BEFORE DELETE ON public.legacy_canonical_record_map
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_canonical_record_map_no_truncate
  BEFORE TRUNCATE ON public.legacy_canonical_record_map
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_import_records_no_delete
  BEFORE DELETE ON public.legacy_import_records
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_import_records_no_truncate
  BEFORE TRUNCATE ON public.legacy_import_records
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_import_checkpoints_no_delete
  BEFORE DELETE ON public.legacy_import_checkpoints
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_import_checkpoints_no_truncate
  BEFORE TRUNCATE ON public.legacy_import_checkpoints
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_import_review_decisions_no_delete
  BEFORE DELETE ON public.legacy_import_review_decisions
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

CREATE TRIGGER legacy_import_review_decisions_no_truncate
  BEFORE TRUNCATE ON public.legacy_import_review_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_legacy_import_delete_or_truncate();

ALTER TABLE public.legacy_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_canonical_record_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_import_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_import_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_import_review_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY legacy_import_batches_system_read ON public.legacy_import_batches FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_READ','LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_batches_system_insert ON public.legacy_import_batches FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_batches_system_update ON public.legacy_import_batches FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_canonical_record_map_system_read ON public.legacy_canonical_record_map FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_READ','LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_canonical_record_map_system_insert ON public.legacy_canonical_record_map FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_canonical_record_map_system_update ON public.legacy_canonical_record_map FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_records_system_read ON public.legacy_import_records FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_READ','LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_records_system_insert ON public.legacy_import_records FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_records_system_update ON public.legacy_import_records FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_checkpoints_system_read ON public.legacy_import_checkpoints FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_READ','LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_checkpoints_system_insert ON public.legacy_import_checkpoints FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_checkpoints_system_update ON public.legacy_import_checkpoints FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_review_decisions_system_read ON public.legacy_import_review_decisions FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_READ','LEGACY_IMPORT_MANAGE']));

CREATE POLICY legacy_import_review_decisions_system_insert ON public.legacy_import_review_decisions FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['LEGACY_IMPORT_MANAGE']));

GRANT SELECT, INSERT, UPDATE ON
  public.legacy_import_batches,
  public.legacy_canonical_record_map,
  public.legacy_import_records,
  public.legacy_import_checkpoints,
  public.legacy_import_review_decisions
TO "tes-backend@tes-production-510007.iam";

