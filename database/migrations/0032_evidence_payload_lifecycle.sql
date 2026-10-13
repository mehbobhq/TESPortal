-- TES evidence payload lifecycle (GCS-backed documents)
-- Migration: 0032
--
-- Scope (additive only; builds on the 0030 evidence metadata foundation):
--   - evidence_payloads: one row per uploaded document payload, tracking its lifecycle
--       quarantined -> cleared (scanner promoted it to intake and the portal verified the hash)
--       -> stored (copied create-only into the evidence bucket and re-verified) -> superseded | archived
--       (blocked is a terminal safety state; nothing is ever deleted)
--     The payload itself stays in GCS. PostgreSQL stores metadata only: tenant-scoped object names, generations, hashes.
--   - evidence_payload_access_events: append-only ledger of every secure view; each row carries a Master Register event
--   - database guards:
--       * object names are CHECK-bound to the owning organization / document ids (tenant-scoped paths, no free-form names)
--       * a document can only reach classified / verified when a stored, hash-verified payload backs it
--       * the application role cannot insert an evidence document in any state but 'received'
--       * a document's hash / size / MIME / organization are immutable; its storage location can only move to the
--         verified evidence object of its own payload
--       * an evidence requirement can only be received / verified through a stored payload of the matching document type
--
-- This migration intentionally does NOT:
--   - alter, drop or rewrite any existing table, column, constraint, policy, grant or migration (0030 / 0031 gain guard
--     triggers only; they act on new writes)
--   - add capabilities (EVIDENCE_READ / EVIDENCE_MANAGE from 0030 are reused)
--   - store a payload, a base64 string or a URL in PostgreSQL
--   - delete, truncate or rewrite any existing data

-- ============================================================
-- 1. Payload lifecycle
-- ============================================================

CREATE TABLE public.evidence_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  evidence_document_id uuid NOT NULL
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,

  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  -- A new upload that replaces an earlier document (the earlier one is archived, never deleted, once this one is stored).
  supersedes_evidence_document_id uuid
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,

  lifecycle_state text NOT NULL DEFAULT 'quarantined',

  batch_id uuid NOT NULL,
  source_file_id uuid NOT NULL,

  quarantine_bucket text NOT NULL,
  quarantine_object_name text NOT NULL,
  quarantine_generation text,

  intake_object_name text,
  intake_generation text,

  evidence_bucket text,
  evidence_object_name text,
  evidence_generation text,

  declared_sha256 text NOT NULL,
  verified_sha256 text,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  original_filename text NOT NULL,
  block_reason text,

  uploaded_by_actor_id uuid NOT NULL
    REFERENCES public.actors(id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  stored_at timestamptz,

  CONSTRAINT evidence_payloads_state_valid
    CHECK (lifecycle_state IN ('quarantined', 'cleared', 'stored', 'blocked', 'superseded', 'archived')),

  -- Tenant-scoped object names: the organization and ids are part of the name and the name is derived, never free-form.
  CONSTRAINT evidence_payloads_quarantine_name_valid
    CHECK (quarantine_object_name = 'quarantine/' || organization_id::text || '/' || batch_id::text || '/' || source_file_id::text || '/source'),
  CONSTRAINT evidence_payloads_intake_name_valid
    CHECK (intake_object_name IS NULL OR intake_object_name = 'intake/' || organization_id::text || '/' || batch_id::text || '/' || source_file_id::text || '/source'),
  CONSTRAINT evidence_payloads_evidence_name_valid
    CHECK (evidence_object_name IS NULL OR evidence_object_name = 'evidence/' || organization_id::text || '/' || evidence_document_id::text || '/source'),

  CONSTRAINT evidence_payloads_buckets_valid
    CHECK (
      quarantine_bucket ~ '^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$'
      AND (evidence_bucket IS NULL OR evidence_bucket ~ '^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$')
      AND (evidence_bucket IS NULL OR evidence_bucket <> quarantine_bucket)
    ),
  CONSTRAINT evidence_payloads_generations_valid
    CHECK (
      (quarantine_generation IS NULL OR quarantine_generation ~ '^[0-9]{1,40}$')
      AND (intake_generation IS NULL OR intake_generation ~ '^[0-9]{1,40}$')
      AND (evidence_generation IS NULL OR evidence_generation ~ '^[0-9]{1,40}$')
    ),
  CONSTRAINT evidence_payloads_hash_valid
    CHECK (
      declared_sha256 ~ '^[a-f0-9]{64}$'
      AND (verified_sha256 IS NULL OR (verified_sha256 ~ '^[a-f0-9]{64}$' AND verified_sha256 = declared_sha256))
    ),
  CONSTRAINT evidence_payloads_mime_valid
    CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp')),
  CONSTRAINT evidence_payloads_size_valid
    CHECK (byte_size BETWEEN 1 AND 26214400),
  CONSTRAINT evidence_payloads_filename_valid
    CHECK (
      original_filename = btrim(original_filename)
      AND char_length(original_filename) BETWEEN 1 AND 255
      AND original_filename !~ '[\x00-\x1F\x7F/\\]'
    ),
  CONSTRAINT evidence_payloads_block_reason_valid
    CHECK (block_reason IS NULL OR block_reason IN ('INTEGRITY_MISMATCH', 'EVIDENCE_HASH_MISMATCH', 'SCAN_NOT_CLEARED', 'OPERATOR_BLOCKED')),
  CONSTRAINT evidence_payloads_supersedes_not_self
    CHECK (supersedes_evidence_document_id IS NULL OR supersedes_evidence_document_id <> evidence_document_id),

  CONSTRAINT evidence_payloads_state_shape_valid
    CHECK (
      (lifecycle_state = 'quarantined'
        AND intake_object_name IS NULL AND evidence_object_name IS NULL AND verified_sha256 IS NULL
        AND block_reason IS NULL AND cleared_at IS NULL AND stored_at IS NULL)
      OR (lifecycle_state = 'cleared'
        AND intake_object_name IS NOT NULL AND intake_generation IS NOT NULL AND cleared_at IS NOT NULL
        AND evidence_object_name IS NULL AND verified_sha256 IS NULL AND block_reason IS NULL AND stored_at IS NULL)
      OR (lifecycle_state IN ('stored', 'superseded')
        AND evidence_bucket IS NOT NULL AND evidence_object_name IS NOT NULL AND evidence_generation IS NOT NULL
        AND verified_sha256 IS NOT NULL AND stored_at IS NOT NULL AND block_reason IS NULL)
      OR (lifecycle_state = 'blocked' AND block_reason IS NOT NULL AND evidence_object_name IS NULL AND stored_at IS NULL)
      OR (lifecycle_state = 'archived')
    )
);

CREATE UNIQUE INDEX evidence_payloads_document_uq
  ON public.evidence_payloads(evidence_document_id);
CREATE UNIQUE INDEX evidence_payloads_source_file_uq
  ON public.evidence_payloads(batch_id, source_file_id);
CREATE INDEX evidence_payloads_organization_idx
  ON public.evidence_payloads(organization_id, lifecycle_state, created_at DESC);
CREATE INDEX evidence_payloads_supersedes_idx
  ON public.evidence_payloads(supersedes_evidence_document_id)
  WHERE supersedes_evidence_document_id IS NOT NULL;

-- Every secure view of a payload. Append-only; each row names the Master Register event that recorded the access.
CREATE TABLE public.evidence_payload_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  payload_id uuid NOT NULL
    REFERENCES public.evidence_payloads(id)
    ON DELETE RESTRICT,
  evidence_document_id uuid NOT NULL
    REFERENCES public.evidence_documents(id)
    ON DELETE RESTRICT,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  access_kind text NOT NULL DEFAULT 'view',
  actor_id uuid NOT NULL
    REFERENCES public.actors(id)
    ON DELETE RESTRICT,
  master_register_event_id uuid NOT NULL
    REFERENCES public.master_register_events(event_id)
    ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT evidence_payload_access_events_kind_valid
    CHECK (access_kind IN ('view'))
);

CREATE INDEX evidence_payload_access_events_payload_idx
  ON public.evidence_payload_access_events(payload_id, created_at DESC);
CREATE INDEX evidence_payload_access_events_org_idx
  ON public.evidence_payload_access_events(organization_id, created_at DESC);

-- Narrow boolean-only predicate: lets the evidence capabilities (which cannot read organizations) prove that an
-- organization exists before anything is written to storage under its prefix. Returns no data.
CREATE FUNCTION tes_security.evidence_organization_exists(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id)
$$;

REVOKE ALL ON FUNCTION tes_security.evidence_organization_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.evidence_organization_exists(uuid) TO "tes-backend@tes-production-510007.iam";

-- ============================================================
-- 2. No delete / truncate; the access ledger is append-only
-- ============================================================

CREATE FUNCTION tes_security.prevent_evidence_payload_delete_or_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'Evidence payload data cannot be deleted or truncated (% on %.%)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION tes_security.prevent_evidence_payload_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'Evidence payload access events are append-only (% on %.%)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER evidence_payloads_no_delete BEFORE DELETE ON public.evidence_payloads
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_evidence_payload_delete_or_truncate();
CREATE TRIGGER evidence_payloads_no_truncate BEFORE TRUNCATE ON public.evidence_payloads
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_evidence_payload_delete_or_truncate();
CREATE TRIGGER evidence_payload_access_events_no_delete BEFORE DELETE ON public.evidence_payload_access_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_evidence_payload_delete_or_truncate();
CREATE TRIGGER evidence_payload_access_events_no_truncate BEFORE TRUNCATE ON public.evidence_payload_access_events
  FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_evidence_payload_delete_or_truncate();
CREATE TRIGGER evidence_payload_access_events_immutable BEFORE UPDATE ON public.evidence_payload_access_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_evidence_payload_ledger_mutation();

-- ============================================================
-- 3. Payload guards
-- ============================================================

-- A payload starts quarantined, for a live document of the same organization; a superseded document must share the type.
CREATE FUNCTION tes_security.guard_evidence_payload_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  doc public.evidence_documents%ROWTYPE;
  older public.evidence_documents%ROWTYPE;
BEGIN
  IF NEW.lifecycle_state <> 'quarantined' THEN
    RAISE EXCEPTION 'An evidence payload must start in quarantine' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO doc FROM public.evidence_documents WHERE id = NEW.evidence_document_id;
  IF NOT FOUND OR doc.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'The payload must belong to the organization of its evidence document' USING ERRCODE = '23514';
  END IF;
  IF doc.document_status <> 'received' THEN
    RAISE EXCEPTION 'A payload can only be attached to a newly received evidence document' USING ERRCODE = '23514';
  END IF;
  IF doc.sha256 <> NEW.declared_sha256 OR doc.mime_type <> NEW.mime_type OR doc.byte_size <> NEW.byte_size THEN
    RAISE EXCEPTION 'The payload hash, type and size must match its evidence document' USING ERRCODE = '23514';
  END IF;
  IF doc.gcs_bucket <> NEW.quarantine_bucket OR doc.gcs_object_name <> NEW.quarantine_object_name THEN
    RAISE EXCEPTION 'A new evidence document must point at its quarantine object' USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_evidence_document_id IS NOT NULL THEN
    SELECT * INTO older FROM public.evidence_documents WHERE id = NEW.supersedes_evidence_document_id;
    IF NOT FOUND OR older.organization_id <> NEW.organization_id OR older.document_type <> doc.document_type THEN
      RAISE EXCEPTION 'A superseded document must belong to the same organization and have the same document type' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Forward-only lifecycle; identity, hashes and storage locations are immutable once set.
CREATE FUNCTION tes_security.guard_evidence_payload_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.evidence_document_id <> OLD.evidence_document_id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.supersedes_evidence_document_id IS DISTINCT FROM OLD.supersedes_evidence_document_id
     OR NEW.batch_id <> OLD.batch_id
     OR NEW.source_file_id <> OLD.source_file_id
     OR NEW.quarantine_bucket <> OLD.quarantine_bucket
     OR NEW.quarantine_object_name <> OLD.quarantine_object_name
     OR NEW.declared_sha256 <> OLD.declared_sha256
     OR NEW.mime_type <> OLD.mime_type
     OR NEW.byte_size <> OLD.byte_size
     OR NEW.original_filename <> OLD.original_filename
     OR NEW.uploaded_by_actor_id <> OLD.uploaded_by_actor_id
     OR (OLD.quarantine_generation IS NOT NULL AND NEW.quarantine_generation IS DISTINCT FROM OLD.quarantine_generation)
     OR (OLD.intake_object_name IS NOT NULL AND NEW.intake_object_name IS DISTINCT FROM OLD.intake_object_name)
     OR (OLD.intake_generation IS NOT NULL AND NEW.intake_generation IS DISTINCT FROM OLD.intake_generation)
     OR (OLD.evidence_bucket IS NOT NULL AND NEW.evidence_bucket IS DISTINCT FROM OLD.evidence_bucket)
     OR (OLD.evidence_object_name IS NOT NULL AND NEW.evidence_object_name IS DISTINCT FROM OLD.evidence_object_name)
     OR (OLD.evidence_generation IS NOT NULL AND NEW.evidence_generation IS DISTINCT FROM OLD.evidence_generation)
     OR (OLD.verified_sha256 IS NOT NULL AND NEW.verified_sha256 IS DISTINCT FROM OLD.verified_sha256) THEN
    RAISE EXCEPTION 'Evidence payload identity, hashes and storage locations are immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.lifecycle_state <> OLD.lifecycle_state AND NOT (
       (OLD.lifecycle_state = 'quarantined' AND NEW.lifecycle_state IN ('cleared', 'blocked', 'archived'))
    OR (OLD.lifecycle_state = 'cleared' AND NEW.lifecycle_state IN ('stored', 'blocked', 'archived'))
    OR (OLD.lifecycle_state = 'stored' AND NEW.lifecycle_state IN ('superseded', 'archived'))
    OR (OLD.lifecycle_state = 'blocked' AND NEW.lifecycle_state = 'archived')
    OR (OLD.lifecycle_state = 'superseded' AND NEW.lifecycle_state = 'archived')
  ) THEN
    RAISE EXCEPTION 'Invalid evidence payload transition % -> %', OLD.lifecycle_state, NEW.lifecycle_state USING ERRCODE = '55000';
  END IF;

  IF OLD.lifecycle_state IN ('stored', 'superseded', 'archived', 'blocked') AND NEW.lifecycle_state = OLD.lifecycle_state THEN
    RAISE EXCEPTION 'A % evidence payload cannot change', OLD.lifecycle_state USING ERRCODE = '55000';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_payloads_guard_insert BEFORE INSERT ON public.evidence_payloads
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_evidence_payload_insert();
CREATE TRIGGER evidence_payloads_guard_update BEFORE UPDATE ON public.evidence_payloads
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_evidence_payload_update();

-- An access event must describe a readable (evidence-stored) payload of its own organization and document.
CREATE FUNCTION tes_security.guard_evidence_payload_access_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  payload public.evidence_payloads%ROWTYPE;
BEGIN
  SELECT * INTO payload FROM public.evidence_payloads WHERE id = NEW.payload_id;
  IF NOT FOUND
     OR payload.organization_id <> NEW.organization_id
     OR payload.evidence_document_id <> NEW.evidence_document_id
     OR payload.evidence_object_name IS NULL THEN
    RAISE EXCEPTION 'The access event does not match a stored payload of this organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_payload_access_events_guard_insert BEFORE INSERT ON public.evidence_payload_access_events
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_evidence_payload_access_event_insert();

-- ============================================================
-- 4. Guards on the 0030 evidence metadata (triggers only; existing rows are untouched)
-- ============================================================

CREATE FUNCTION tes_security.guard_evidence_document_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  payload public.evidence_payloads%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The application role can only register a freshly received document; classification / verification is a later,
    -- payload-backed step. (Migrations and operators run as the migration identity.)
    IF current_user::text = 'tes-backend@tes-production-510007.iam' AND (NEW.document_status <> 'received' OR NEW.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'The application can only register a received evidence document' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.sha256 <> OLD.sha256 OR NEW.mime_type <> OLD.mime_type OR NEW.byte_size <> OLD.byte_size OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'Evidence document hash, type, size and organization are immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.gcs_bucket <> OLD.gcs_bucket OR NEW.gcs_object_name <> OLD.gcs_object_name OR NEW.gcs_generation IS DISTINCT FROM OLD.gcs_generation THEN
    SELECT * INTO payload FROM public.evidence_payloads WHERE evidence_document_id = NEW.id;
    IF NOT FOUND
       OR payload.lifecycle_state NOT IN ('stored', 'superseded', 'archived')
       OR payload.evidence_object_name IS NULL
       OR payload.evidence_bucket IS DISTINCT FROM NEW.gcs_bucket
       OR payload.evidence_object_name IS DISTINCT FROM NEW.gcs_object_name
       OR payload.evidence_generation IS DISTINCT FROM NEW.gcs_generation THEN
      RAISE EXCEPTION 'An evidence document can only point at the verified evidence object of its own payload' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.document_status IN ('classified', 'verified') AND NEW.document_status IS DISTINCT FROM OLD.document_status THEN
    SELECT * INTO payload FROM public.evidence_payloads WHERE evidence_document_id = NEW.id;
    IF NOT FOUND
       OR payload.lifecycle_state <> 'stored'
       OR payload.verified_sha256 IS DISTINCT FROM NEW.sha256
       OR payload.evidence_object_name IS DISTINCT FROM NEW.gcs_object_name THEN
      RAISE EXCEPTION 'A document can only be classified or verified once a stored, hash-verified payload backs it' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_documents_guard_write BEFORE INSERT OR UPDATE ON public.evidence_documents
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_evidence_document_write();

-- A requirement is received / verified only through a stored payload of the required document type, and verified only once
-- the document itself is verified and unexpired.
CREATE FUNCTION tes_security.guard_onboarding_evidence_requirement_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  doc public.evidence_documents%ROWTYPE;
  payload public.evidence_payloads%ROWTYPE;
BEGIN
  IF NEW.requirement_status IN ('received', 'verified') THEN
    SELECT * INTO doc FROM public.evidence_documents WHERE id = NEW.satisfied_by_evidence_document_id;
    IF NOT FOUND OR doc.organization_id <> NEW.organization_id OR doc.document_type <> NEW.required_document_type THEN
      RAISE EXCEPTION 'A requirement can only be satisfied by a document of the required type from the same organization' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO payload FROM public.evidence_payloads WHERE evidence_document_id = doc.id;
    IF NOT FOUND OR payload.lifecycle_state <> 'stored' THEN
      RAISE EXCEPTION 'A requirement can only be satisfied by a document with a stored, hash-verified payload' USING ERRCODE = '23514';
    END IF;
    IF NEW.requirement_status = 'verified'
       AND (doc.document_status <> 'verified' OR (doc.expires_at IS NOT NULL AND doc.expires_at < current_date)) THEN
      RAISE EXCEPTION 'A requirement is verified only by a verified, unexpired document' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER onboarding_evidence_requirements_guard_write BEFORE INSERT OR UPDATE ON public.onboarding_evidence_requirements
  FOR EACH ROW EXECUTE FUNCTION tes_security.guard_onboarding_evidence_requirement_write();

-- ============================================================
-- 5. Row level security, policies and grants
-- ============================================================

ALTER TABLE public.evidence_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_payload_access_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_payloads_system_read ON public.evidence_payloads FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_READ','EVIDENCE_MANAGE']));
CREATE POLICY evidence_payloads_system_insert ON public.evidence_payloads FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));
CREATE POLICY evidence_payloads_system_update ON public.evidence_payloads FOR UPDATE
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_MANAGE']));

CREATE POLICY evidence_payload_access_events_system_read ON public.evidence_payload_access_events FOR SELECT
  USING (tes_security.system_context_authorized(ARRAY['EVIDENCE_READ','EVIDENCE_MANAGE']));
CREATE POLICY evidence_payload_access_events_system_insert ON public.evidence_payload_access_events FOR INSERT
  WITH CHECK (tes_security.system_context_authorized(ARRAY['EVIDENCE_READ','EVIDENCE_MANAGE']));

GRANT SELECT, INSERT, UPDATE ON public.evidence_payloads TO "tes-backend@tes-production-510007.iam";
GRANT SELECT, INSERT ON public.evidence_payload_access_events TO "tes-backend@tes-production-510007.iam";
