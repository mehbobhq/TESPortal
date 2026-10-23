-- TES Drivers: the universal hiring application (applicant sessions, canonical application records, consents, uploads, sensitive values, review)
-- Migration: 0041 (forward-only; migrations 0001-0040 are not edited; requires 0039 and 0040)
--
-- WHY. Until now an applicant's work lived in browser storage, files were never uploaded, the session was a signed token carrying personal data in
-- the URL, submission contents were assembled by the browser, and employer review was browser-local. This migration moves all of it into PostgreSQL:
--
--   driver_application_sessions     server-side applicant sessions (hash only), one applicant ACTOR per invitation so every applicant action is
--                                   individually attributable in the Master Register
--   driver_applications             ONE canonical application per invitation: the exact plan (sections, questions, consents) it was issued with,
--                                   frozen; status; server-generated receipt and timestamps
--   driver_application_drafts       autosaved answers (optimistic concurrency); hidden answers are kept, never silently erased
--   driver_application_snapshots    the immutable submitted snapshot (+ SHA-256); the original signed application is never rewritten
--   driver_application_consent_*    presentations (exact text shown), acceptances (signature) and revocations, each independently versioned
--   driver_application_uploads      links applicant documents to the EXISTING evidence pipeline (quarantine -> scanner -> evidence)
--   driver_sensitive_values         application-level envelope-encrypted identifiers (SSN/SIN/passport number), write-only for the applicant
--   driver_application_verifications / _decisions / _corrections   employer review: declared vs received vs verified, qualification decisions, corrections
--   organization_hr_screening_profiles   versioned, carrier-chosen HR screening selections (validated against a legal matrix in the service)
--
-- ACCESS MODEL. The applicant has no database identity. Every applicant operation is a narrow SECURITY DEFINER function that acts ONLY on the
-- application named by a server-validated session; the applicant never touches a table. Staff reach the data through ordinary SYSTEM-scope RLS
-- (DRIVER_READ / DRIVER_MANAGE); sensitive values need the new DRIVER_SENSITIVE_READ capability. Nothing is deleted.

-- ============================================================
-- 0. Capability
-- ============================================================

INSERT INTO public.capabilities(code, display_name, description, is_active, sort_order)
VALUES (
    'DRIVER_SENSITIVE_READ',
    'Driver sensitive identifier read',
    'Read the encrypted sensitive identifiers (SSN, SIN, passport number) collected in a driver application, and record that access. Intended scope: SYSTEM only.',
    true,
    266
);

-- ============================================================
-- 1. Rate limiting (persistent across serverless instances)
-- ============================================================

CREATE TABLE public.applicant_rate_counters (
    key_hash text NOT NULL,
    window_start timestamptz NOT NULL,
    request_count integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key_hash, window_start),
    CONSTRAINT applicant_rate_counters_key_valid CHECK (key_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.applicant_rate_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.applicant_rate_counters FROM PUBLIC;

-- Returns true while the caller is within the limit for this key and window. The key is a hash chosen by the server; the counter holds no personal data.
CREATE FUNCTION tes_security.applicant_rate_check(p_key_hash text, p_limit integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    w timestamptz;
    c integer;
BEGIN
    IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100000 OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
        RAISE EXCEPTION 'Invalid rate-limit request' USING ERRCODE = '22023';
    END IF;
    w := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds);
    INSERT INTO public.applicant_rate_counters (key_hash, window_start, request_count) VALUES (p_key_hash, w, 1)
    ON CONFLICT (key_hash, window_start) DO UPDATE SET request_count = public.applicant_rate_counters.request_count + 1
    RETURNING request_count INTO c;
    IF random() < 0.01 THEN
        DELETE FROM public.applicant_rate_counters WHERE window_start < clock_timestamp() - interval '2 days';
    END IF;
    RETURN c <= p_limit;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_rate_check(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_rate_check(text, integer, integer) TO "tes-backend@tes-production-510007.iam";

-- ============================================================
-- 2. Canonical application, sessions, drafts, snapshots
-- ============================================================

CREATE TABLE public.driver_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invitation_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    applicant_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    collection_stage text NOT NULL DEFAULT 'PRE_OFFER',
    -- A later-stage request (for example after a conditional offer) is a NEW application that supplements the original; the original is never edited.
    supplements_application_id uuid,
    catalogue_version text NOT NULL,
    plan jsonb NOT NULL,
    plan_sha256 text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    receipt_id text,
    submitted_at timestamptz,
    snapshot_sha256 text,
    pdf_evidence_document_id uuid REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
    pdf_sha256 text,
    pdf_generated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_applications_invitation_uq UNIQUE (invitation_id),
    CONSTRAINT driver_applications_receipt_uq UNIQUE (receipt_id),
    CONSTRAINT driver_applications_id_scope_uq UNIQUE (id, organization_id),
    CONSTRAINT driver_applications_invitation_fk FOREIGN KEY (invitation_id, prospect_id, organization_id)
        REFERENCES public.driver_application_invitations (id, prospect_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_applications_supplements_fk FOREIGN KEY (supplements_application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_applications_supplement_stage CHECK (supplements_application_id IS NULL OR collection_stage <> 'PRE_OFFER'),
    CONSTRAINT driver_applications_stage_valid CHECK (collection_stage IN ('PRE_OFFER', 'CONDITIONAL_OFFER', 'POST_OFFER')),
    CONSTRAINT driver_applications_status_valid CHECK (status IN ('DRAFT', 'SUBMITTED')),
    CONSTRAINT driver_applications_plan_object CHECK (jsonb_typeof(plan) = 'object'),
    CONSTRAINT driver_applications_plan_sha_valid CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT driver_applications_submitted_consistent CHECK (
        (status = 'SUBMITTED') = (receipt_id IS NOT NULL AND submitted_at IS NOT NULL AND snapshot_sha256 IS NOT NULL)
    ),
    CONSTRAINT driver_applications_pdf_together CHECK ((pdf_evidence_document_id IS NULL) = (pdf_sha256 IS NULL) AND (pdf_sha256 IS NULL) = (pdf_generated_at IS NULL))
);
CREATE INDEX driver_applications_prospect_idx ON public.driver_applications (prospect_id, created_at DESC);
CREATE INDEX driver_applications_organization_idx ON public.driver_applications (organization_id, status, created_at DESC);

CREATE TABLE public.driver_application_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    invitation_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    applicant_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    session_hash text NOT NULL,
    csrf_hash text NOT NULL,
    client_hash text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CONSTRAINT driver_application_sessions_hash_uq UNIQUE (session_hash),
    CONSTRAINT driver_application_sessions_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_sessions_hashes_valid CHECK (session_hash ~ '^[0-9a-f]{64}$' AND csrf_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT driver_application_sessions_window_valid CHECK (expires_at > created_at)
);
CREATE INDEX driver_application_sessions_application_idx ON public.driver_application_sessions (application_id, created_at DESC);

CREATE TABLE public.driver_application_drafts (
    application_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    answers jsonb NOT NULL DEFAULT '{}'::jsonb,
    version integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_application_drafts_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_drafts_object CHECK (jsonb_typeof(answers) = 'object'),
    CONSTRAINT driver_application_drafts_size CHECK (pg_column_size(answers) < 1048576)
);

CREATE TABLE public.driver_application_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_sha256 text NOT NULL,
    submitted_at timestamptz NOT NULL,
    CONSTRAINT driver_application_snapshots_application_uq UNIQUE (application_id),
    CONSTRAINT driver_application_snapshots_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_snapshots_object CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT driver_application_snapshots_sha_valid CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);

-- ============================================================
-- 3. Authorizations and disclosures
-- ============================================================

CREATE TABLE public.driver_application_consent_presentations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    consent_key text NOT NULL,
    consent_version text NOT NULL,
    text_snapshot text NOT NULL,
    text_sha256 text NOT NULL,
    legal_status text NOT NULL,
    presented_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_application_consent_presentations_uq UNIQUE (application_id, consent_key, consent_version, text_sha256),
    CONSTRAINT driver_application_consent_presentations_scope_uq UNIQUE (id, application_id, organization_id),
    CONSTRAINT driver_application_consent_presentations_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_consent_presentations_key_valid CHECK (consent_key ~ '^[a-z][a-z0-9_]{2,60}$'),
    CONSTRAINT driver_application_consent_presentations_sha_valid CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT driver_application_consent_presentations_legal_valid CHECK (legal_status IN ('APPROVED', 'PENDING_LEGAL_REVIEW', 'EXTERNAL_PROCESS_REQUIRED'))
);

CREATE TABLE public.driver_application_consents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    presentation_id uuid NOT NULL,
    consent_key text NOT NULL,
    consent_version text NOT NULL,
    text_sha256 text NOT NULL,
    legal_status text NOT NULL,
    purpose text NOT NULL,
    scope jsonb NOT NULL DEFAULT '{}'::jsonb,
    authorized_parties jsonb NOT NULL DEFAULT '[]'::jsonb,
    jurisdiction text,
    presented_at timestamptz NOT NULL,
    accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    acceptance_action text NOT NULL,
    signature_name text NOT NULL,
    signature_evidence_document_id uuid REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
    applicant_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_consents_presentation_uq UNIQUE (presentation_id),
    CONSTRAINT driver_application_consents_id_scope_uq UNIQUE (id, application_id, organization_id),
    CONSTRAINT driver_application_consents_presentation_fk FOREIGN KEY (presentation_id, application_id, organization_id)
        REFERENCES public.driver_application_consent_presentations (id, application_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_consents_action_valid CHECK (acceptance_action = 'AFFIRMATIVE_CHECKBOX_WITH_TYPED_SIGNATURE'),
    CONSTRAINT driver_application_consents_signature_valid CHECK (btrim(signature_name) <> '' AND char_length(signature_name) <= 200),
    CONSTRAINT driver_application_consents_sha_valid CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT driver_application_consents_json_valid CHECK (jsonb_typeof(scope) = 'object' AND jsonb_typeof(authorized_parties) = 'array')
);
CREATE INDEX driver_application_consents_application_idx ON public.driver_application_consents (application_id, accepted_at);

CREATE TABLE public.driver_application_consent_revocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consent_id uuid NOT NULL,
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    reason text,
    CONSTRAINT driver_application_consent_revocations_consent_uq UNIQUE (consent_id),
    CONSTRAINT driver_application_consent_revocations_consent_fk FOREIGN KEY (consent_id, application_id, organization_id)
        REFERENCES public.driver_application_consents (id, application_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_consent_revocations_reason_valid CHECK (reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 500))
);

-- ============================================================
-- 4. Uploads (evidence pipeline) and sensitive values (vault)
-- ============================================================

CREATE TABLE public.driver_application_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    field_id text NOT NULL,
    slot text NOT NULL DEFAULT '',
    evidence_document_id uuid NOT NULL REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
    document_class text NOT NULL,
    sensitivity text NOT NULL,
    uploaded_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    superseded_at timestamptz,
    CONSTRAINT driver_application_uploads_document_uq UNIQUE (evidence_document_id),
    CONSTRAINT driver_application_uploads_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_uploads_field_valid CHECK (field_id ~ '^[a-z][a-z0-9_.]{1,80}$'),
    CONSTRAINT driver_application_uploads_sensitivity_valid CHECK (sensitivity IN ('standard', 'sensitive', 'restricted'))
);
CREATE UNIQUE INDEX driver_application_uploads_current_uq ON public.driver_application_uploads (application_id, field_id, slot) WHERE superseded_at IS NULL;

CREATE TABLE public.driver_sensitive_values (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    field_id text NOT NULL,
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL,
    key_id text NOT NULL,
    algorithm text NOT NULL DEFAULT 'AES-256-GCM',
    masked_display text NOT NULL,
    created_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    superseded_at timestamptz,
    CONSTRAINT driver_sensitive_values_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_sensitive_values_field_valid CHECK (field_id ~ '^[a-z][a-z0-9_.]{1,80}$'),
    CONSTRAINT driver_sensitive_values_algorithm_valid CHECK (algorithm = 'AES-256-GCM'),
    CONSTRAINT driver_sensitive_values_nonce_valid CHECK (octet_length(nonce) = 12),
    CONSTRAINT driver_sensitive_values_cipher_valid CHECK (octet_length(ciphertext) BETWEEN 17 AND 4096),
    CONSTRAINT driver_sensitive_values_mask_valid CHECK (char_length(masked_display) <= 40)
);
CREATE UNIQUE INDEX driver_sensitive_values_current_uq ON public.driver_sensitive_values (application_id, field_id) WHERE superseded_at IS NULL;

CREATE TABLE public.driver_sensitive_access_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    value_id uuid NOT NULL REFERENCES public.driver_sensitive_values(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    purpose text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_sensitive_access_events_purpose_valid CHECK (btrim(purpose) <> '' AND char_length(purpose) <= 300)
);

-- ============================================================
-- 5. Employer review, qualification, corrections, carrier HR profile
-- ============================================================

CREATE TABLE public.driver_application_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    requirement_key text NOT NULL,
    verification_type text NOT NULL,
    status text NOT NULL,
    consent_id uuid,
    evidence_document_id uuid REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
    note text,
    recorded_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_application_verifications_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_verifications_consent_fk FOREIGN KEY (consent_id, application_id, organization_id)
        REFERENCES public.driver_application_consents (id, application_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_verifications_key_valid CHECK (requirement_key ~ '^[a-z][a-z0-9_.]{1,80}$'),
    CONSTRAINT driver_application_verifications_status_valid CHECK (status IN ('DECLARED', 'EVIDENCE_RECEIVED', 'PENDING', 'VERIFIED', 'EXCEPTION', 'REJECTED')),
    CONSTRAINT driver_application_verifications_note_valid CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 1000)),
    -- A verified or exception outcome must rest on evidence or a documented note: "verified" is never an unsupported assertion.
    CONSTRAINT driver_application_verifications_outcome_supported CHECK (status NOT IN ('VERIFIED', 'EXCEPTION', 'REJECTED') OR evidence_document_id IS NOT NULL OR note IS NOT NULL)
);
CREATE INDEX driver_application_verifications_application_idx ON public.driver_application_verifications (application_id, requirement_key, recorded_at DESC);

CREATE TABLE public.driver_application_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    decision text NOT NULL,
    reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    snapshot_sha256 text NOT NULL,
    decided_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_application_decisions_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_decisions_decision_valid CHECK (decision IN ('QUALIFIED', 'NOT_QUALIFIED', 'NEEDS_INFORMATION')),
    CONSTRAINT driver_application_decisions_reasons_array CHECK (jsonb_typeof(reasons) = 'array'),
    CONSTRAINT driver_application_decisions_sha_valid CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX driver_application_decisions_application_idx ON public.driver_application_decisions (application_id, decided_at DESC);

CREATE TABLE public.driver_application_corrections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    field_id text NOT NULL,
    previous_value jsonb,
    corrected_value jsonb,
    reason text NOT NULL,
    evidence_document_id uuid REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
    recorded_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_application_corrections_application_fk FOREIGN KEY (application_id, organization_id)
        REFERENCES public.driver_applications (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_corrections_field_valid CHECK (field_id ~ '^[a-z][a-z0-9_.]{1,80}$'),
    CONSTRAINT driver_application_corrections_reason_valid CHECK (btrim(reason) <> '' AND char_length(reason) <= 1000)
);

CREATE TABLE public.organization_hr_screening_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    version integer NOT NULL,
    catalogue_version text NOT NULL,
    selections jsonb NOT NULL,
    created_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    superseded_at timestamptz,
    CONSTRAINT organization_hr_screening_profiles_version_uq UNIQUE (organization_id, version),
    CONSTRAINT organization_hr_screening_profiles_version_valid CHECK (version >= 1),
    CONSTRAINT organization_hr_screening_profiles_selections_object CHECK (jsonb_typeof(selections) = 'object')
);
CREATE UNIQUE INDEX organization_hr_screening_profiles_current_uq ON public.organization_hr_screening_profiles (organization_id) WHERE superseded_at IS NULL;

-- ============================================================
-- 6. Guards: immutability and append-only history
-- ============================================================

-- The plan, its hash and the invitation link of an application never change; a draft becomes submitted exactly once; the PDF is attached exactly once.
CREATE FUNCTION tes_security.guard_driver_application_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.applicant_actor_id IS DISTINCT FROM OLD.applicant_actor_id
       OR NEW.collection_stage IS DISTINCT FROM OLD.collection_stage OR NEW.supplements_application_id IS DISTINCT FROM OLD.supplements_application_id OR NEW.catalogue_version IS DISTINCT FROM OLD.catalogue_version
       OR NEW.plan IS DISTINCT FROM OLD.plan OR NEW.plan_sha256 IS DISTINCT FROM OLD.plan_sha256 OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'An application keeps its invitation, plan and plan version' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'SUBMITTED' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256) THEN
        RAISE EXCEPTION 'A submitted application is never changed' USING ERRCODE = '23514';
    END IF;
    IF OLD.pdf_evidence_document_id IS NOT NULL AND (NEW.pdf_evidence_document_id IS DISTINCT FROM OLD.pdf_evidence_document_id
       OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 OR NEW.pdf_generated_at IS DISTINCT FROM OLD.pdf_generated_at) THEN
        RAISE EXCEPTION 'The signed application document is never replaced' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_application_update() FROM PUBLIC;
CREATE TRIGGER driver_applications_guard_update BEFORE UPDATE ON public.driver_applications
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_application_update();

-- A draft can only change while its application is a draft.
CREATE FUNCTION tes_security.guard_driver_draft_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.application_id IS DISTINCT FROM OLD.application_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'A draft belongs to one application' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.driver_applications a WHERE a.id = NEW.application_id AND a.status = 'DRAFT') THEN
        RAISE EXCEPTION 'A submitted application has no editable draft' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_draft_update() FROM PUBLIC;
CREATE TRIGGER driver_application_drafts_guard_update BEFORE UPDATE ON public.driver_application_drafts
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_draft_update();

-- Uploads, vault rows and sessions are only ever closed (superseded / revoked), never rewritten.
CREATE FUNCTION tes_security.guard_driver_closable_row_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    closer text := TG_ARGV[0];
BEGIN
    IF to_jsonb(NEW) - closer - 'last_seen_at' IS DISTINCT FROM to_jsonb(OLD) - closer - 'last_seen_at' THEN
        RAISE EXCEPTION 'A recorded row can only be closed, never changed' USING ERRCODE = '23514';
    END IF;
    IF to_jsonb(OLD) ->> closer IS NOT NULL AND to_jsonb(NEW) ->> closer IS DISTINCT FROM to_jsonb(OLD) ->> closer THEN
        RAISE EXCEPTION 'A closed row stays closed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_closable_row_update() FROM PUBLIC;
CREATE TRIGGER driver_application_uploads_guard_update BEFORE UPDATE ON public.driver_application_uploads FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_closable_row_update('superseded_at');
CREATE TRIGGER driver_sensitive_values_guard_update BEFORE UPDATE ON public.driver_sensitive_values FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_closable_row_update('superseded_at');
CREATE TRIGGER driver_application_sessions_guard_update BEFORE UPDATE ON public.driver_application_sessions FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_closable_row_update('revoked_at');
CREATE TRIGGER organization_hr_screening_profiles_guard_update BEFORE UPDATE ON public.organization_hr_screening_profiles FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_closable_row_update('superseded_at');

-- No delete or truncate anywhere; immutable history tables also refuse updates.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'driver_applications', 'driver_application_sessions', 'driver_application_drafts', 'driver_application_snapshots',
        'driver_application_consent_presentations', 'driver_application_consents', 'driver_application_consent_revocations',
        'driver_application_uploads', 'driver_sensitive_values', 'driver_sensitive_access_events', 'driver_application_verifications',
        'driver_application_decisions', 'driver_application_corrections', 'organization_hr_screening_profiles'
    ] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation()', t || '_no_delete', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation()', t || '_no_truncate', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY[
        'driver_application_snapshots', 'driver_application_consent_presentations', 'driver_application_consents', 'driver_application_consent_revocations',
        'driver_sensitive_access_events', 'driver_application_verifications', 'driver_application_decisions', 'driver_application_corrections'
    ] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation()', t || '_no_update', t);
    END LOOP;
END;
$$;

-- ============================================================
-- 7. Staff access (SYSTEM scope RLS) and grants. The applicant never touches a table.
-- ============================================================

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'driver_applications', 'driver_application_sessions', 'driver_application_drafts', 'driver_application_snapshots',
        'driver_application_consent_presentations', 'driver_application_consents', 'driver_application_consent_revocations',
        'driver_application_uploads', 'driver_sensitive_values', 'driver_sensitive_access_events', 'driver_application_verifications',
        'driver_application_decisions', 'driver_application_corrections', 'organization_hr_screening_profiles'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    END LOOP;
END;
$$;

-- Reads: driver staff. Sessions are never readable by staff (only the hash exists, and it is the credential).
CREATE POLICY driver_applications_system_read ON public.driver_applications FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']));
CREATE POLICY driver_application_drafts_system_read ON public.driver_application_drafts FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']));
CREATE POLICY driver_application_snapshots_system_read ON public.driver_application_snapshots FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']));
CREATE POLICY driver_application_consent_presentations_system_read ON public.driver_application_consent_presentations FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']));
CREATE POLICY driver_application_consents_system_read ON public.driver_application_consents FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']));
CREATE POLICY driver_application_consent_revocations_system ON public.driver_application_consent_revocations FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY driver_application_uploads_system_read ON public.driver_application_uploads FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']));
CREATE POLICY driver_application_verifications_system ON public.driver_application_verifications FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY driver_application_decisions_system ON public.driver_application_decisions FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY driver_application_corrections_system ON public.driver_application_corrections FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY organization_hr_screening_profiles_system ON public.organization_hr_screening_profiles FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
-- Sensitive values: ONLY the dedicated capability reads them; DRIVER_READ / DRIVER_MANAGE do not.
CREATE POLICY driver_sensitive_values_system_read ON public.driver_sensitive_values FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_SENSITIVE_READ']));
CREATE POLICY driver_sensitive_access_events_system ON public.driver_sensitive_access_events FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_SENSITIVE_READ']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_SENSITIVE_READ']));
-- Sessions: no policy for any role, so no row is ever visible outside the SECURITY DEFINER functions.

GRANT SELECT ON TABLE
    public.driver_applications, public.driver_application_drafts, public.driver_application_snapshots, public.driver_application_consent_presentations,
    public.driver_application_consents, public.driver_application_consent_revocations, public.driver_application_uploads, public.driver_sensitive_values,
    public.driver_sensitive_access_events, public.driver_application_verifications, public.driver_application_decisions, public.driver_application_corrections,
    public.organization_hr_screening_profiles
    TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, application_id, organization_id, requirement_key, verification_type, status, consent_id, evidence_document_id, note, recorded_by_actor_id)
    ON public.driver_application_verifications TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, application_id, organization_id, decision, reasons, snapshot_sha256, decided_by_actor_id)
    ON public.driver_application_decisions TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, application_id, organization_id, field_id, previous_value, corrected_value, reason, evidence_document_id, recorded_by_actor_id)
    ON public.driver_application_corrections TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, consent_id, application_id, organization_id, revoked_by_actor_id, reason)
    ON public.driver_application_consent_revocations TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, organization_id, version, catalogue_version, selections, created_by_actor_id)
    ON public.organization_hr_screening_profiles TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (superseded_at) ON public.organization_hr_screening_profiles TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (value_id, organization_id, actor_id, purpose) ON public.driver_sensitive_access_events TO "tes-backend@tes-production-510007.iam";

-- ============================================================
-- 8. Applicant context: validation helpers and the Master Register insert path
-- ============================================================

-- The applicant session this transaction was opened for, re-proved from the table on every call (transaction-local setting = context, never authority).
CREATE FUNCTION tes_security.applicant_session()
RETURNS TABLE (session_id uuid, application_id uuid, organization_id uuid, invitation_id uuid, prospect_id uuid, actor_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT s.id, s.application_id, s.organization_id, s.invitation_id, s.prospect_id, s.applicant_actor_id
      FROM public.driver_application_sessions s
      JOIN public.driver_application_invitations i ON i.id = s.invitation_id
     WHERE s.id = NULLIF(current_setting('tes.applicant_session_id', true), '')::uuid
       AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
       AND i.status IN ('PENDING', 'SENT', 'OPENED', 'SUBMITTED')
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_session() TO "tes-backend@tes-production-510007.iam";

CREATE FUNCTION tes_security.applicant_context_actor() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$ SELECT actor_id FROM tes_security.applicant_session() $$;
CREATE FUNCTION tes_security.applicant_context_organization() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$ SELECT organization_id FROM tes_security.applicant_session() $$;
REVOKE ALL ON FUNCTION tes_security.applicant_context_actor(), tes_security.applicant_context_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_context_actor(), tes_security.applicant_context_organization() TO "tes-backend@tes-production-510007.iam";

-- An applicant's own material actions may be written to the Master Register: only as THEIR actor, only for THEIR company, only these event types.
CREATE POLICY master_register_applicant_insert ON public.master_register_events FOR INSERT
    WITH CHECK (
        tes_security.applicant_context_actor() IS NOT NULL
        AND actor_id = tes_security.applicant_context_actor()
        AND (target ->> 'companyId') = tes_security.applicant_context_organization()::text
        AND event_type IN ('RECORD_CREATED', 'RECORD_UPDATED', 'DOCUMENT_INGESTED', 'RECORD_LINK_ESTABLISHED')
    );

-- ============================================================
-- 9. Applicant functions (the only way an applicant reads or writes anything)
-- ============================================================

-- Opens a session from the invitation secret (hash). Creates, once per invitation, the applicant's own ACTOR and the canonical application with the
-- plan frozen on the invitation at issuance. Returns nothing for an unknown, expired, revoked or superseded invitation (the reasons are not distinguished).
CREATE FUNCTION tes_security.open_applicant_session(p_secret_hash text, p_session_hash text, p_csrf_hash text, p_ttl_seconds integer, p_client_hash text)
RETURNS TABLE (session_id uuid, application_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    inv public.driver_application_invitations%ROWTYPE;
    prospect public.driver_prospects%ROWTYPE;
    app public.driver_applications%ROWTYPE;
    actor uuid;
    sid uuid := gen_random_uuid();
    exp timestamptz;
    plan jsonb;
BEGIN
    IF p_secret_hash IS NULL OR p_secret_hash !~ '^[0-9a-f]{64}$' OR p_session_hash !~ '^[0-9a-f]{64}$' OR p_csrf_hash !~ '^[0-9a-f]{64}$'
       OR p_ttl_seconds IS NULL OR p_ttl_seconds < 300 OR p_ttl_seconds > 86400 THEN
        RETURN;
    END IF;
    SELECT * INTO inv FROM public.driver_application_invitations i
     WHERE i.token_hash = p_secret_hash AND i.status IN ('PENDING', 'SENT', 'OPENED', 'SUBMITTED') AND i.expires_at > clock_timestamp()
       AND i.requirements_profile IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT * INTO prospect FROM public.driver_prospects p WHERE p.id = inv.prospect_id AND p.organization_id = inv.organization_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF inv.status <> 'SUBMITTED' THEN
        -- A first application is open while the prospect is still a prospect; a later-stage SUPPLEMENT is open after the first one was submitted.
        IF prospect.status NOT IN (CASE WHEN coalesce(inv.requirements_profile -> 'plan' ->> 'collectionStage', 'PRE_OFFER') = 'PRE_OFFER' THEN 'PROSPECT' ELSE 'APPLICATION_SUBMITTED' END,
                                   CASE WHEN coalesce(inv.requirements_profile -> 'plan' ->> 'collectionStage', 'PRE_OFFER') = 'PRE_OFFER' THEN 'INVITED' ELSE 'UNDER_REVIEW' END)
           OR NOT EXISTS (
            SELECT 1 FROM public.driver_prospect_operating_scopes s
             WHERE s.id = inv.operating_scope_id AND s.prospect_id = inv.prospect_id AND s.organization_id = inv.organization_id AND s.superseded_at IS NULL
        ) THEN
            RETURN;
        END IF;
    END IF;

    SELECT * INTO app FROM public.driver_applications a WHERE a.invitation_id = inv.id;
    IF NOT FOUND THEN
        IF inv.status = 'SUBMITTED' THEN
            RETURN;
        END IF;
        plan := inv.requirements_profile -> 'plan';
        IF plan IS NULL OR jsonb_typeof(plan) <> 'object' OR (inv.requirements_profile ->> 'planSha256') !~ '^[0-9a-f]{64}$' THEN
            RETURN; -- an invitation issued without a frozen application plan is not honoured
        END IF;
        INSERT INTO public.actors (actor_type) VALUES ('HUMAN') RETURNING id INTO actor;
        INSERT INTO public.authentication_identities (actor_id, provider, provider_subject) VALUES (actor, 'tes-driver-invitation', inv.id::text);
        INSERT INTO public.driver_applications (invitation_id, prospect_id, organization_id, applicant_actor_id, collection_stage, supplements_application_id, catalogue_version, plan, plan_sha256)
        VALUES (inv.id, inv.prospect_id, inv.organization_id, actor, coalesce(plan ->> 'collectionStage', 'PRE_OFFER'),
                CASE WHEN (inv.requirements_profile ->> 'supplementsApplicationId') ~ '^[0-9a-f-]{36}$' THEN (inv.requirements_profile ->> 'supplementsApplicationId')::uuid END,
                plan ->> 'catalogueVersion', plan, inv.requirements_profile ->> 'planSha256')
        RETURNING * INTO app;
        INSERT INTO public.driver_application_drafts (application_id, organization_id) VALUES (app.id, app.organization_id);
    END IF;

    IF inv.status IN ('PENDING', 'SENT') THEN
        UPDATE public.driver_application_invitations SET status = 'OPENED', opened_at = clock_timestamp() WHERE id = inv.id;
        INSERT INTO public.driver_prospect_events (prospect_id, organization_id, event_type, invitation_id, source)
        VALUES (inv.prospect_id, inv.organization_id, 'APPLICATION_OPENED', inv.id, 'APPLICANT_LINK');
    END IF;

    exp := least(clock_timestamp() + make_interval(secs => p_ttl_seconds), inv.expires_at);
    INSERT INTO public.driver_application_sessions (id, application_id, invitation_id, prospect_id, organization_id, applicant_actor_id, session_hash, csrf_hash, client_hash, expires_at)
    VALUES (sid, app.id, inv.id, inv.prospect_id, inv.organization_id, app.applicant_actor_id, p_session_hash, p_csrf_hash, p_client_hash, exp);
    RETURN QUERY SELECT sid, app.id, exp;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.open_applicant_session(text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.open_applicant_session(text, text, text, integer, text) TO "tes-backend@tes-production-510007.iam";

-- Establishes the applicant context for THIS transaction from a session hash (and returns the stored CSRF hash for the caller to compare).
CREATE FUNCTION tes_security.enter_applicant_context(p_session_hash text)
RETURNS TABLE (session_id uuid, application_id uuid, organization_id uuid, actor_id uuid, csrf_hash text, application_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    s public.driver_application_sessions%ROWTYPE;
    st text;
BEGIN
    IF p_session_hash IS NULL OR p_session_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN;
    END IF;
    SELECT s2.* INTO s FROM public.driver_application_sessions s2
      JOIN public.driver_application_invitations i ON i.id = s2.invitation_id
     WHERE s2.session_hash = p_session_hash AND s2.revoked_at IS NULL AND s2.expires_at > clock_timestamp()
       AND i.status IN ('PENDING', 'SENT', 'OPENED', 'SUBMITTED');
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM set_config('tes.applicant_session_id', s.id::text, true);
    IF s.last_seen_at < clock_timestamp() - interval '60 seconds' THEN
        UPDATE public.driver_application_sessions SET last_seen_at = clock_timestamp() WHERE id = s.id;
    END IF;
    SELECT a.status INTO st FROM public.driver_applications a WHERE a.id = s.application_id;
    RETURN QUERY SELECT s.id, s.application_id, s.organization_id, s.applicant_actor_id, s.csrf_hash, st;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.enter_applicant_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.enter_applicant_context(text) TO "tes-backend@tes-production-510007.iam";

-- Everything the applicant's page needs, in one document: the frozen plan, the draft, accepted authorizations and the status of every upload.
CREATE FUNCTION tes_security.applicant_get_application()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sess record;
    app public.driver_applications%ROWTYPE;
    draft public.driver_application_drafts%ROWTYPE;
BEGIN
    SELECT * INTO sess FROM tes_security.applicant_session();
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO app FROM public.driver_applications WHERE id = sess.application_id;
    SELECT * INTO draft FROM public.driver_application_drafts WHERE application_id = sess.application_id;
    RETURN jsonb_build_object(
        'application', jsonb_build_object('id', app.id, 'status', app.status, 'collectionStage', app.collection_stage, 'catalogueVersion', app.catalogue_version,
                                          'receiptId', app.receipt_id, 'submittedAt', app.submitted_at, 'planSha256', app.plan_sha256,
                                          'pdfDocumentId', app.pdf_evidence_document_id, 'pdfSha256', app.pdf_sha256),
        'snapshot', (SELECT jsonb_build_object('payload', s.payload, 'payloadSha256', s.payload_sha256) FROM public.driver_application_snapshots s WHERE s.application_id = app.id),
        'plan', app.plan,
        'answers', coalesce(draft.answers, '{}'::jsonb),
        'answersVersion', coalesce(draft.version, 0),
        'companyName', (SELECT coalesce(o.display_name, o.legal_name) FROM public.organizations o WHERE o.id = app.organization_id),
        'applicantGivenName', (SELECT n.given_name FROM public.driver_prospects p JOIN public.person_name_versions n ON n.person_id = p.person_id AND n.record_status = 'active' AND n.effective_to IS NULL WHERE p.id = app.prospect_id LIMIT 1),
        'applicantFamilyName', (SELECT n.family_name FROM public.driver_prospects p JOIN public.person_name_versions n ON n.person_id = p.person_id AND n.record_status = 'active' AND n.effective_to IS NULL WHERE p.id = app.prospect_id LIMIT 1),
        'applicantEmail', (SELECT i.recipient_email_normalized FROM public.driver_application_invitations i WHERE i.id = app.invitation_id),
        'consents', coalesce((SELECT jsonb_agg(jsonb_build_object('key', c.consent_key, 'version', c.consent_version, 'textSha256', c.text_sha256, 'acceptedAt', c.accepted_at, 'signatureName', c.signature_name,
                                                                 'legalStatus', c.legal_status, 'jurisdiction', c.jurisdiction, 'purpose', c.purpose) ORDER BY c.accepted_at)
                                FROM public.driver_application_consents c WHERE c.application_id = app.id), '[]'::jsonb),
        'presentations', coalesce((SELECT jsonb_agg(jsonb_build_object('key', p.consent_key, 'version', p.consent_version, 'textSha256', p.text_sha256, 'presentedAt', p.presented_at) ORDER BY p.presented_at)
                                FROM public.driver_application_consent_presentations p WHERE p.application_id = app.id), '[]'::jsonb),
        'uploads', coalesce((SELECT jsonb_agg(jsonb_build_object('fieldId', u.field_id, 'slot', u.slot, 'documentId', u.evidence_document_id, 'documentClass', u.document_class,
                                                                 'state', pl.lifecycle_state, 'filename', pl.original_filename, 'byteSize', pl.byte_size, 'uploadedAt', u.created_at) ORDER BY u.created_at)
                                FROM public.driver_application_uploads u JOIN public.evidence_payloads pl ON pl.evidence_document_id = u.evidence_document_id
                               WHERE u.application_id = app.id AND u.superseded_at IS NULL), '[]'::jsonb),
        'sensitiveCollected', coalesce((SELECT jsonb_agg(v.field_id ORDER BY v.field_id) FROM public.driver_sensitive_values v WHERE v.application_id = app.id AND v.superseded_at IS NULL), '[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_get_application() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_get_application() TO "tes-backend@tes-production-510007.iam";

-- Autosave with optimistic concurrency. The patch replaces whole top-level answers; hidden answers are kept (they are simply not applicable).
CREATE FUNCTION tes_security.applicant_save_draft(p_expected_version integer, p_patch jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sess record;
    v integer;
BEGIN
    SELECT * INTO sess FROM tes_security.applicant_session();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The application session is not valid' USING ERRCODE = '28000';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION 'The draft patch must be an object' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.driver_applications a WHERE a.id = sess.application_id AND a.status = 'DRAFT') THEN
        RAISE EXCEPTION 'A submitted application cannot be edited' USING ERRCODE = '55000';
    END IF;
    UPDATE public.driver_application_drafts SET answers = answers || p_patch, version = version + 1
     WHERE application_id = sess.application_id AND version = p_expected_version
     RETURNING version INTO v;
    IF v IS NULL THEN
        RAISE EXCEPTION 'The draft was changed elsewhere' USING ERRCODE = '40001';
    END IF;
    RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_save_draft(integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_save_draft(integer, jsonb) TO "tes-backend@tes-production-510007.iam";

-- Records that an exact disclosure text was shown to this applicant (the text and its SHA-256 are kept verbatim). Idempotent.
CREATE FUNCTION tes_security.applicant_present_consent(p_key text, p_version text, p_text text, p_text_sha256 text, p_legal_status text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sess record;
    pid uuid;
BEGIN
    SELECT * INTO sess FROM tes_security.applicant_session();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The application session is not valid' USING ERRCODE = '28000';
    END IF;
    IF encode(sha256(convert_to(p_text, 'UTF8')), 'hex') <> p_text_sha256 THEN
        RAISE EXCEPTION 'The disclosure text does not match its hash' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.driver_application_consent_presentations (application_id, organization_id, consent_key, consent_version, text_snapshot, text_sha256, legal_status)
    VALUES (sess.application_id, sess.organization_id, p_key, p_version, p_text, p_text_sha256, p_legal_status)
    ON CONFLICT (application_id, consent_key, consent_version, text_sha256) DO NOTHING;
    SELECT id INTO pid FROM public.driver_application_consent_presentations
     WHERE application_id = sess.application_id AND consent_key = p_key AND consent_version = p_version AND text_sha256 = p_text_sha256;
    RETURN pid;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_present_consent(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_present_consent(text, text, text, text, text) TO "tes-backend@tes-production-510007.iam";

-- Records the applicant's affirmative acceptance of a PRESENTED disclosure. Idempotent per presentation.
CREATE FUNCTION tes_security.applicant_accept_consent(p_presentation_id uuid, p_signature_name text, p_purpose text, p_scope jsonb, p_parties jsonb, p_jurisdiction text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sess record;
    pres public.driver_application_consent_presentations%ROWTYPE;
    cid uuid;
BEGIN
    SELECT * INTO sess FROM tes_security.applicant_session();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The application session is not valid' USING ERRCODE = '28000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.driver_applications a WHERE a.id = sess.application_id AND a.status = 'DRAFT') THEN
        RAISE EXCEPTION 'A submitted application cannot be changed' USING ERRCODE = '55000';
    END IF;
    SELECT * INTO pres FROM public.driver_application_consent_presentations WHERE id = p_presentation_id AND application_id = sess.application_id AND organization_id = sess.organization_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That disclosure was not presented to this applicant' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.driver_application_consents (application_id, organization_id, presentation_id, consent_key, consent_version, text_sha256, legal_status, purpose, scope,
                                                    authorized_parties, jurisdiction, presented_at, acceptance_action, signature_name, applicant_actor_id)
    VALUES (sess.application_id, sess.organization_id, pres.id, pres.consent_key, pres.consent_version, pres.text_sha256, pres.legal_status, p_purpose, coalesce(p_scope, '{}'::jsonb),
            coalesce(p_parties, '[]'::jsonb), p_jurisdiction, pres.presented_at, 'AFFIRMATIVE_CHECKBOX_WITH_TYPED_SIGNATURE', p_signature_name, sess.actor_id)
    ON CONFLICT (presentation_id) DO NOTHING;
    SELECT id INTO cid FROM public.driver_application_consents WHERE presentation_id = pres.id;
    RETURN cid;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_accept_consent(uuid, text, text, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_accept_consent(uuid, text, text, jsonb, jsonb, text) TO "tes-backend@tes-production-510007.iam";

-- Registers an applicant document that the server has ALREADY written, create-only, to quarantine: the evidence document + payload (the existing
-- lifecycle, quarantined) and the upload link, all owned by THIS application, applicant and company. The earlier upload in the same slot is superseded.
CREATE FUNCTION tes_security.applicant_register_upload(
    p_field_id text, p_slot text, p_document_class text, p_sensitivity text, p_document_type text, p_document_title text,
    p_document_id uuid, p_batch_id uuid, p_source_file_id uuid, p_bucket text, p_object_name text, p_generation text,
    p_sha256 text, p_mime text, p_size bigint, p_filename text, p_source_channel text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sess record;
BEGIN
    SELECT * INTO sess FROM tes_security.applicant_session();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The application session is not valid' USING ERRCODE = '28000';
    END IF;
    IF p_source_channel NOT IN ('client_upload', 'system_generated') OR p_sensitivity NOT IN ('standard', 'sensitive', 'restricted') THEN
        RAISE EXCEPTION 'Invalid upload registration' USING ERRCODE = '22023';
    END IF;
    -- The stored object must live under THIS company's tenant-scoped key; the applicant's session decides the company, never the caller's arguments.
    IF position(sess.organization_id::text IN coalesce(p_object_name, '')) = 0 THEN
        RAISE EXCEPTION 'The document location does not belong to this application' USING ERRCODE = '22023';
    END IF;
    IF p_source_channel = 'client_upload' AND NOT EXISTS (SELECT 1 FROM public.driver_applications a WHERE a.id = sess.application_id AND a.status = 'DRAFT') THEN
        RAISE EXCEPTION 'A submitted application cannot be changed' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.evidence_documents (id, organization_id, document_type, document_title, sensitivity, gcs_bucket, gcs_object_name, gcs_generation, sha256, mime_type, byte_size, source_channel)
    VALUES (p_document_id, sess.organization_id, p_document_type, p_document_title, p_sensitivity, p_bucket, p_object_name, p_generation, p_sha256, p_mime, p_size, p_source_channel);
    INSERT INTO public.evidence_payloads (evidence_document_id, organization_id, batch_id, source_file_id, quarantine_bucket, quarantine_object_name, quarantine_generation,
                                          declared_sha256, mime_type, byte_size, original_filename, uploaded_by_actor_id)
    VALUES (p_document_id, sess.organization_id, p_batch_id, p_source_file_id, p_bucket, p_object_name, p_generation, p_sha256, p_mime, p_size, p_filename, sess.actor_id);
    UPDATE public.driver_application_uploads SET superseded_at = clock_timestamp()
     WHERE application_id = sess.application_id AND field_id = p_field_id AND slot = p_slot AND superseded_at IS NULL;
    INSERT INTO public.driver_application_uploads (application_id, organization_id, field_id, slot, evidence_document_id, document_class, sensitivity, uploaded_by_actor_id)
    VALUES (sess.application_id, sess.organization_id, p_field_id, p_slot, p_document_id, p_document_class, p_sensitivity, sess.actor_id);
    RETURN p_document_id;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_register_upload(text, text, text, text, text, text, uuid, uuid, uuid, text, text, text, text, text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_register_upload(text, text, text, text, text, text, uuid, uuid, uuid, text, text, text, text, text, bigint, text, text) TO "tes-backend@tes-production-510007.iam";

-- Stores an already-encrypted sensitive identifier. Write-only: nothing in the applicant's reach returns it.
CREATE FUNCTION tes_security.applicant_save_sensitive(p_field_id text, p_ciphertext bytea, p_nonce bytea, p_key_id text, p_masked text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sess record;
    vid uuid;
BEGIN
    SELECT * INTO sess FROM tes_security.applicant_session();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The application session is not valid' USING ERRCODE = '28000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.driver_applications a WHERE a.id = sess.application_id AND a.status = 'DRAFT') THEN
        RAISE EXCEPTION 'A submitted application cannot be changed' USING ERRCODE = '55000';
    END IF;
    UPDATE public.driver_sensitive_values SET superseded_at = clock_timestamp() WHERE application_id = sess.application_id AND field_id = p_field_id AND superseded_at IS NULL;
    INSERT INTO public.driver_sensitive_values (application_id, organization_id, field_id, ciphertext, nonce, key_id, masked_display, created_by_actor_id)
    VALUES (sess.application_id, sess.organization_id, p_field_id, p_ciphertext, p_nonce, p_key_id, p_masked, sess.actor_id) RETURNING id INTO vid;
    RETURN vid;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_save_sensitive(text, bytea, bytea, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_save_sensitive(text, bytea, bytea, text, text) TO "tes-backend@tes-production-510007.iam";

-- Submits. The receipt and the timestamp are generated HERE, never by the browser; the snapshot is immutable; a repeat call returns the original receipt.
-- The prospect lifecycle moves exactly as for any application (the existing definer function), and no person or driver is created.
CREATE FUNCTION tes_security.applicant_finalize(p_payload jsonb, p_payload_sha256 text, p_expected_draft_version integer)
RETURNS TABLE (receipt_id text, submitted_at timestamptz, already_submitted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sess record;
    app public.driver_applications%ROWTYPE;
    rcpt text;
    at timestamptz;
BEGIN
    SELECT * INTO sess FROM tes_security.applicant_session();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The application session is not valid' USING ERRCODE = '28000';
    END IF;
    SELECT * INTO app FROM public.driver_applications WHERE id = sess.application_id FOR UPDATE;
    IF app.status = 'SUBMITTED' THEN
        RETURN QUERY SELECT app.receipt_id, app.submitted_at, true;
        RETURN;
    END IF;
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid submission' USING ERRCODE = '22023';
    END IF;
    -- The submission is exactly what was validated: the draft must not have changed since it was read.
    IF NOT EXISTS (SELECT 1 FROM public.driver_application_drafts d WHERE d.application_id = app.id AND d.version = p_expected_draft_version FOR SHARE) THEN
        RAISE EXCEPTION 'The draft was changed elsewhere' USING ERRCODE = '40001';
    END IF;
    rcpt := 'TES-' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    at := clock_timestamp();
    INSERT INTO public.driver_application_snapshots (application_id, organization_id, payload, payload_sha256, submitted_at)
    VALUES (app.id, app.organization_id, p_payload, p_payload_sha256, at);
    UPDATE public.driver_applications SET status = 'SUBMITTED', receipt_id = rcpt, submitted_at = at, snapshot_sha256 = p_payload_sha256 WHERE id = app.id;
    PERFORM tes_security.submit_driver_application(app.invitation_id, rcpt, jsonb_build_object('applicationId', app.id, 'snapshotSha256', p_payload_sha256, 'catalogueVersion', app.catalogue_version));
    RETURN QUERY SELECT rcpt, at, false;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_finalize(jsonb, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_finalize(jsonb, text, integer) TO "tes-backend@tes-production-510007.iam";

-- Attaches the signed application PDF (already registered as evidence through applicant_register_upload) to its application, exactly once.
CREATE FUNCTION tes_security.applicant_attach_pdf(p_document_id uuid, p_sha256 text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sess record;
BEGIN
    SELECT * INTO sess FROM tes_security.applicant_session();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The application session is not valid' USING ERRCODE = '28000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.evidence_documents d WHERE d.id = p_document_id AND d.organization_id = sess.organization_id AND d.sha256 = p_sha256 AND d.document_type = 'DRIVER_APPLICATION_PDF') THEN
        RAISE EXCEPTION 'That document is not this application''s signed PDF' USING ERRCODE = '22023';
    END IF;
    UPDATE public.driver_applications SET pdf_evidence_document_id = p_document_id, pdf_sha256 = p_sha256, pdf_generated_at = clock_timestamp()
     WHERE id = sess.application_id AND status = 'SUBMITTED' AND pdf_evidence_document_id IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.applicant_attach_pdf(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.applicant_attach_pdf(uuid, text) TO "tes-backend@tes-production-510007.iam";

-- The 0039 lifecycle function, extended for later-stage supplements. A first application moves the prospect to APPLICATION_SUBMITTED exactly as before; a supplement
-- (collection stage after PRE_OFFER) is accepted while the prospect is APPLICATION_SUBMITTED or UNDER_REVIEW and does NOT move the prospect's status.
CREATE OR REPLACE FUNCTION tes_security.submit_driver_application(p_invitation_id uuid, p_receipt_id text, p_payload jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    inv public.driver_application_invitations%ROWTYPE;
    prospect public.driver_prospects%ROWTYPE;
    submitted timestamptz := clock_timestamp();
    supplement boolean;
BEGIN
    SELECT * INTO inv FROM public.driver_application_invitations i WHERE i.id = p_invitation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown application invitation' USING ERRCODE = 'P0002';
    END IF;
    IF inv.status NOT IN ('PENDING', 'SENT', 'OPENED') OR inv.expires_at <= submitted THEN
        RAISE EXCEPTION 'This application invitation is not open' USING ERRCODE = '55000';
    END IF;
    supplement := coalesce((SELECT a.collection_stage FROM public.driver_applications a WHERE a.invitation_id = inv.id), 'PRE_OFFER') <> 'PRE_OFFER';
    SELECT * INTO prospect FROM public.driver_prospects p WHERE p.id = inv.prospect_id AND p.organization_id = inv.organization_id FOR UPDATE;
    IF NOT FOUND OR (NOT supplement AND prospect.status NOT IN ('PROSPECT', 'INVITED')) OR (supplement AND prospect.status NOT IN ('APPLICATION_SUBMITTED', 'UNDER_REVIEW')) THEN
        RAISE EXCEPTION 'This application invitation is not open' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.driver_application_submissions (invitation_id, prospect_id, organization_id, receipt_id, payload, submitted_at)
    VALUES (inv.id, inv.prospect_id, inv.organization_id, p_receipt_id, p_payload, submitted);
    UPDATE public.driver_application_invitations SET status = 'SUBMITTED', submitted_at = submitted WHERE id = inv.id;
    IF supplement THEN
        INSERT INTO public.driver_prospect_events (prospect_id, organization_id, event_type, from_status, to_status, invitation_id, source)
        VALUES (inv.prospect_id, inv.organization_id, 'APPLICATION_SUBMITTED', prospect.status, prospect.status, inv.id, 'APPLICANT_LINK');
        RETURN submitted;
    END IF;
    IF prospect.status = 'PROSPECT' THEN
        UPDATE public.driver_prospects SET status = 'INVITED' WHERE id = prospect.id;
    END IF;
    UPDATE public.driver_prospects SET status = 'APPLICATION_SUBMITTED' WHERE id = prospect.id;
    INSERT INTO public.driver_prospect_events (prospect_id, organization_id, event_type, from_status, to_status, invitation_id, source)
    VALUES (inv.prospect_id, inv.organization_id, 'APPLICATION_SUBMITTED', 'INVITED', 'APPLICATION_SUBMITTED', inv.id, 'APPLICANT_LINK');
    RETURN submitted;
END;
$$;

-- The superseded 0039 applicant function is replaced by the session-based flow above; it must not remain as a second, weaker way in.
DROP FUNCTION tes_security.open_driver_application_invitation(text);
