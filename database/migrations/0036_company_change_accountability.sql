-- TES Companies: change accountability, registered legal-name gate and communication-channel verification
-- Migration: 0036
--
-- Scope (additive only; migrations 0001-0035 are not edited, no existing row is read, rewritten or removed). Requires 0035
-- (it uses the evidence_documents(id, organization_id) unique index that 0035 adds).
--   1. capability COMPANY_LEGAL_NAME_CHANGE                              (SYSTEM only)
--   2. public.company_change_records                                     the business-operation ledger shown as Company Activity
--   3. public.company_change_record_evidence                             links a business change to the evidence that supports it
--   4. public.company_legal_name_change_requests                         the durable request + approval record of a registered legal-name change
--   5. public.company_channel_change_requests                            durable pending / confirmed state of a sensitive company channel replacement
--   6. integrity triggers, row-level security policies and column-level runtime grants for the new tables
--
-- WHY. The Master Register keeps every technical event; it cannot answer "who asked, on what authority, with what evidence" for a
-- business change, and nothing stopped a registered legal name being overwritten by any user who could update a company. Three rules
-- are therefore made STRUCTURAL (enforced by the service AND backstopped by the database):
--
--  * Registered legal name. A change is APPLIED only when (1) a government-issued document establishing the new name and (2) a written
--    request from an AUTHORIZED company representative are both linked to the exact request, and (3) it is executed by a TES user holding
--    COMPANY_LEGAL_NAME_CHANGE (the Onboarding Team grant; the founder-level Master Account always satisfies a capability). An authorized
--    representative is either the holder of an ACTIVE customer authority (Service Decision Authority or Contract Signatory, established by
--    the existing contract-authority process with its notice evidence; recorded here as requester_authority_assignment_id and bound by
--    foreign key to the same company and the same person) or a Director whose authority is evidenced by a linked, verified document. A
--    Primary Contact designation is an operational routing choice and NEVER authorizes a legal-name change. A request without that evidence
--    stays PENDING and the canonical legal name is untouched. The CHECK constraints below make an APPLIED row without both evidence links,
--    an authority basis, an executing actor and a decision time impossible, so a path that bypassed the service could still not mark one
--    applied. A Director's TITLE is never proof: a Director must be backed by a linked, verified document (director_evidence_document_id).
--  * Sensitive channel change. REPLACING or REMOVING an established company website, phone or email is recorded as a request in
--    PENDING_CONFIRMATION and changes nothing until it is confirmed. A confirmation needs (1) an ESTABLISHED trusted channel (one that
--    existed before the request, is not the requested value and is not the sender of the request), (2) a linked evidence document that the
--    existing evidence process has VERIFIED, created after the request, and used for no other request, and (3) a TES user who is NOT the
--    one who recorded the request. A free-text reference is only a note and proves nothing. The sender address is stored but never trusted.
--    An APPLIED request cannot exist without all of that. Company-level channels stay separate from person-level channels, and a website
--    change never implies an email-domain change.
--  * Accountability. Every real company change appends one company_change_records row (actor, effective and recorded time, request
--    source, previous / new value, Master Register event) with its evidence links. Append-only: no UPDATE, no DELETE.
--
-- Evidence is never stored here: only references to public.evidence_documents (the existing GCS-backed lifecycle). Verification of the
-- documents (document_status = verified, payload stored and integrity checked) is checked by the service at apply time; the foreign keys
-- guarantee every referenced document belongs to the SAME company. All functions are SECURITY INVOKER with a fixed search_path.

-- ============================================================
-- 1. Capability
-- ============================================================

INSERT INTO public.capabilities(code, display_name, description, is_active, sort_order)
VALUES
    (
        'COMPANY_LEGAL_NAME_CHANGE',
        'Company legal-name change',
        'Execute a registered legal-name change once the government document and the company''s written request are linked. Granted to the Onboarding Team; the founder-level Master Account always satisfies it. Intended scope: SYSTEM only.',
        true,
        264
    );

-- ============================================================
-- 1b. Additive index on the existing customer authority table (lets a request be bound to the SAME company and the SAME person by foreign key)
-- ============================================================

CREATE UNIQUE INDEX customer_authority_assignments_id_org_person_uq
    ON public.customer_authority_assignments (id, organization_id, person_id);

-- ============================================================
-- 2. Change ledger and its evidence links
-- ============================================================

CREATE TABLE public.company_change_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    operation_code text NOT NULL,
    summary text NOT NULL,
    previous_value text,
    new_value text,

    effective_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),

    actor_id uuid NOT NULL
        REFERENCES public.actors(id)
        ON DELETE RESTRICT,

    -- Where the instruction came from, and (for a gated change) the request record that authorised it.
    request_source text,
    request_table text,
    request_id uuid,

    -- Business confirmation behind a trade-name change (never required to be evidence, but recorded when given).
    basis text,
    basis_reference text,

    master_register_event_id uuid,

    CONSTRAINT company_change_records_operation_valid
        CHECK (operation_code IN (
            'LEGAL_NAME_CHANGED', 'LEGAL_NAME_CHANGE_REQUESTED',
            'DBA_ADDED', 'DBA_UPDATED', 'DBA_REMOVED',
            'WEBSITE_ADDED', 'WEBSITE_UPDATED', 'WEBSITE_REMOVED',
            'COMPANY_EMAIL_ADDED', 'COMPANY_EMAIL_CHANGED', 'COMPANY_EMAIL_REMOVED',
            'COMPANY_PHONE_ADDED', 'COMPANY_PHONE_CHANGED', 'COMPANY_PHONE_REMOVED',
            'CHANNEL_CHANGE_REQUESTED', 'CHANNEL_CHANGE_REJECTED',
            'ADDRESS_UPDATED', 'OPERATING_REGION_UPDATED', 'BUSINESS_DETAILS_UPDATED', 'PAYMENT_METHOD_UPDATED'
        )),

    CONSTRAINT company_change_records_summary_valid
        CHECK (btrim(summary) <> '' AND char_length(summary) <= 400),

    CONSTRAINT company_change_records_values_valid
        CHECK (
            (previous_value IS NULL OR char_length(previous_value) <= 500)
            AND (new_value IS NULL OR char_length(new_value) <= 500)
        ),

    CONSTRAINT company_change_records_source_valid
        CHECK (request_source IS NULL OR request_source IN ('COMPANY_WRITTEN_REQUEST', 'COMPANY_VERBAL_CONFIRMED', 'VERIFIED_CHANNEL_CONFIRMATION', 'STAFF_ENTRY')),

    CONSTRAINT company_change_records_request_pair_valid
        CHECK (
            (request_table IS NULL AND request_id IS NULL)
            OR (request_table IN ('company_legal_name_change_requests', 'company_channel_change_requests') AND request_id IS NOT NULL)
        ),

    CONSTRAINT company_change_records_basis_valid
        CHECK (
            (basis IS NULL AND basis_reference IS NULL)
            OR (basis IN ('BUSINESS_CONFIRMATION', 'REGISTRATION_EVIDENCE') AND basis_reference IS NOT NULL AND char_length(btrim(basis_reference)) BETWEEN 3 AND 500)
        ),

    CONSTRAINT company_change_records_id_organization_uq
        UNIQUE (id, organization_id)
);

CREATE INDEX company_change_records_activity_idx
    ON public.company_change_records (organization_id, recorded_at DESC, id);

CREATE TABLE public.company_change_record_evidence (
    change_record_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    evidence_document_id uuid NOT NULL,
    role text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (change_record_id, evidence_document_id, role),

    CONSTRAINT company_change_record_evidence_change_fk
        FOREIGN KEY (change_record_id, organization_id)
        REFERENCES public.company_change_records (id, organization_id)
        ON DELETE RESTRICT,

    -- The evidence must belong to the SAME company as the change.
    CONSTRAINT company_change_record_evidence_document_fk
        FOREIGN KEY (evidence_document_id, organization_id)
        REFERENCES public.evidence_documents (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT company_change_record_evidence_role_valid
        CHECK (role IN ('GOVERNMENT_DOCUMENT', 'WRITTEN_REQUEST', 'DIRECTOR_VERIFICATION', 'REGISTRATION', 'CONFIRMATION'))
);

CREATE INDEX company_change_record_evidence_document_idx
    ON public.company_change_record_evidence (evidence_document_id);

-- ============================================================
-- 3. Registered legal-name change requests
-- ============================================================

CREATE TABLE public.company_legal_name_change_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    previous_legal_name text NOT NULL,
    requested_legal_name text NOT NULL,

    status text NOT NULL DEFAULT 'PENDING',

    -- Who asked, and in what capacity. A relationship is the person's association with THIS company; a title never decides the basis.
    requested_by_person_id uuid NOT NULL
        REFERENCES public.persons(id)
        ON DELETE RESTRICT,
    requester_relationship_id uuid NOT NULL,
    requester_basis text NOT NULL,
    -- The customer authority (Service Decision Authority / Contract Signatory) the requester held when asking; null for a Director.
    requester_authority_assignment_id uuid,

    -- How the written request was received.
    request_source text NOT NULL,
    request_reference text NOT NULL,
    request_received_at timestamptz NOT NULL,

    -- Linked evidence (each must belong to this company; the service additionally requires it to be verified and stored).
    government_evidence_document_id uuid,
    written_request_evidence_document_id uuid,
    director_evidence_document_id uuid,

    effective_at timestamptz,

    recorded_by_actor_id uuid NOT NULL
        REFERENCES public.actors(id)
        ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT now(),

    decided_by_actor_id uuid
        REFERENCES public.actors(id)
        ON DELETE RESTRICT,
    decided_at timestamptz,
    decision_reason text,

    change_record_id uuid,

    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT legal_name_requests_requester_relationship_fk
        FOREIGN KEY (requester_relationship_id, organization_id, requested_by_person_id)
        REFERENCES public.organization_person_relationships (id, organization_id, person_id)
        ON DELETE RESTRICT,

    CONSTRAINT legal_name_requests_authority_fk
        FOREIGN KEY (requester_authority_assignment_id, organization_id, requested_by_person_id)
        REFERENCES public.customer_authority_assignments (id, organization_id, person_id)
        ON DELETE RESTRICT,

    CONSTRAINT legal_name_requests_government_evidence_fk
        FOREIGN KEY (government_evidence_document_id, organization_id)
        REFERENCES public.evidence_documents (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT legal_name_requests_written_evidence_fk
        FOREIGN KEY (written_request_evidence_document_id, organization_id)
        REFERENCES public.evidence_documents (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT legal_name_requests_director_evidence_fk
        FOREIGN KEY (director_evidence_document_id, organization_id)
        REFERENCES public.evidence_documents (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT legal_name_requests_change_record_fk
        FOREIGN KEY (change_record_id, organization_id)
        REFERENCES public.company_change_records (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT legal_name_requests_names_valid
        CHECK (
            btrim(previous_legal_name) <> '' AND btrim(requested_legal_name) <> ''
            AND char_length(requested_legal_name) <= 240
            AND requested_legal_name = btrim(requested_legal_name)
            AND requested_legal_name <> previous_legal_name
        ),

    CONSTRAINT legal_name_requests_status_valid
        CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN')),

    CONSTRAINT legal_name_requests_basis_valid
        CHECK (requester_basis IN ('CUSTOMER_AUTHORITY', 'VERIFIED_DIRECTOR')),

    -- A requester is an authorized representative: the holder of a recorded customer authority, or a Director (never both, never neither).
    CONSTRAINT legal_name_requests_authority_consistent
        CHECK (
            (requester_basis = 'CUSTOMER_AUTHORITY' AND requester_authority_assignment_id IS NOT NULL)
            OR (requester_basis = 'VERIFIED_DIRECTOR' AND requester_authority_assignment_id IS NULL)
        ),

    CONSTRAINT legal_name_requests_source_valid
        CHECK (request_source IN ('EMAIL', 'LETTER', 'PORTAL', 'OTHER')),

    CONSTRAINT legal_name_requests_reference_valid
        CHECK (char_length(btrim(request_reference)) BETWEEN 3 AND 500),

    -- THE STRUCTURAL GATE. An applied request cannot exist without both evidence links, a Director's evidenced authority (when the
    -- requester is a Director), the executing TES user, the decision time and the effective date.
    CONSTRAINT legal_name_requests_applied_requires_evidence
        CHECK (
            status <> 'APPLIED'
            OR (
                government_evidence_document_id IS NOT NULL
                AND written_request_evidence_document_id IS NOT NULL
                AND (requester_basis <> 'VERIFIED_DIRECTOR' OR director_evidence_document_id IS NOT NULL)
                AND decided_by_actor_id IS NOT NULL
                AND decided_at IS NOT NULL
                AND effective_at IS NOT NULL
                AND change_record_id IS NOT NULL
            )
        ),

    CONSTRAINT legal_name_requests_decision_state_consistent
        CHECK (
            (status = 'PENDING' AND decided_by_actor_id IS NULL AND decided_at IS NULL)
            OR (status <> 'PENDING' AND decided_by_actor_id IS NOT NULL AND decided_at IS NOT NULL)
        ),

    CONSTRAINT legal_name_requests_id_organization_uq
        UNIQUE (id, organization_id)
);

-- One open request per company at a time.
CREATE UNIQUE INDEX legal_name_requests_one_pending_uq
    ON public.company_legal_name_change_requests (organization_id)
    WHERE status = 'PENDING';

CREATE INDEX legal_name_requests_history_idx
    ON public.company_legal_name_change_requests (organization_id, recorded_at DESC);

-- ============================================================
-- 4. Sensitive company channel replacement requests
-- ============================================================

CREATE TABLE public.company_channel_change_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    channel_type text NOT NULL,
    usage text NOT NULL,

    -- The established value being replaced (a snapshot), and the replacement asked for.
    -- REPLACE: the established value becomes requested_value. REMOVE: the established value is ended (no requested value).
    change_kind text NOT NULL DEFAULT 'REPLACE',
    previous_channel_id uuid,
    previous_value text,
    requested_value text,
    requested_value_normalized text,

    status text NOT NULL DEFAULT 'PENDING_CONFIRMATION',

    request_source text NOT NULL,
    request_reference text NOT NULL,
    requested_by_person_id uuid
        REFERENCES public.persons(id)
        ON DELETE RESTRICT,
    -- The address the request came from, recorded for review. It is NEVER treated as trusted.
    sender_address text,

    -- Confirmation through an ESTABLISHED trusted channel (one that already existed when the request was recorded).
    confirmation_channel_kind text,
    confirmation_channel_id uuid,
    confirmation_contact_person_id uuid
        REFERENCES public.persons(id)
        ON DELETE RESTRICT,
    confirmation_method text,
    -- A free-text note. It is NOT proof of anything: the proof is the verified evidence document below.
    confirmation_reference text,
    -- The evidence that the confirmation took place (verified by the existing evidence process, of this company, created after the request).
    confirmation_evidence_document_id uuid,
    confirmed_by_actor_id uuid
        REFERENCES public.actors(id)
        ON DELETE RESTRICT,
    confirmed_at timestamptz,

    applied_channel_id uuid,
    applied_at timestamptz,
    decision_reason text,

    recorded_by_actor_id uuid NOT NULL
        REFERENCES public.actors(id)
        ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    change_record_id uuid,

    CONSTRAINT channel_requests_confirmation_evidence_fk
        FOREIGN KEY (confirmation_evidence_document_id, organization_id)
        REFERENCES public.evidence_documents (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT channel_requests_change_record_fk
        FOREIGN KEY (change_record_id, organization_id)
        REFERENCES public.company_change_records (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT channel_requests_type_valid
        CHECK (channel_type IN ('WEBSITE', 'PHONE', 'EMAIL')),

    CONSTRAINT channel_requests_usage_valid
        CHECK (usage IN ('GENERAL', 'DISPATCH', 'OFFICE', 'ACCOUNTING', 'SAFETY')),

    CONSTRAINT channel_requests_kind_valid
        CHECK (change_kind IN ('REPLACE', 'REMOVE')),

    CONSTRAINT channel_requests_value_valid
        CHECK (
            (change_kind = 'REPLACE' AND requested_value IS NOT NULL AND btrim(requested_value) <> '' AND char_length(requested_value) <= 254
                AND requested_value_normalized IS NOT NULL AND btrim(requested_value_normalized) <> '')
            OR (change_kind = 'REMOVE' AND requested_value IS NULL AND requested_value_normalized IS NULL AND previous_channel_id IS NOT NULL)
        ),

    CONSTRAINT channel_requests_status_valid
        CHECK (status IN ('PENDING_CONFIRMATION', 'APPLIED', 'REJECTED', 'WITHDRAWN')),

    CONSTRAINT channel_requests_source_valid
        CHECK (request_source IN ('COMPANY_WRITTEN_REQUEST', 'COMPANY_VERBAL_CONFIRMED', 'PORTAL', 'STAFF_ENTRY')),

    CONSTRAINT channel_requests_reference_valid
        CHECK (char_length(btrim(request_reference)) BETWEEN 3 AND 500),

    CONSTRAINT channel_requests_confirmation_kind_valid
        CHECK (confirmation_channel_kind IS NULL OR confirmation_channel_kind IN ('PERSON_CHANNEL', 'COMPANY_CHANNEL')),

    CONSTRAINT channel_requests_confirmation_method_valid
        CHECK (confirmation_method IS NULL OR confirmation_method IN ('CALL_BACK', 'EMAIL_REPLY', 'IN_PERSON', 'OTHER')),

    -- THE STRUCTURAL GATE. A request is not APPLIED without a confirmation through an ESTABLISHED channel, backed by a linked evidence
    -- document, by a named TES user who is NOT the one who recorded the request, at a time. (The service additionally requires the document
    -- to be verified, stored and created after the request.) A free-text reference alone never satisfies it.
    CONSTRAINT channel_requests_applied_requires_confirmation
        CHECK (
            status <> 'APPLIED'
            OR (
                confirmation_channel_kind IS NOT NULL
                AND confirmation_channel_id IS NOT NULL
                AND confirmation_method IS NOT NULL
                AND confirmation_evidence_document_id IS NOT NULL
                AND confirmed_by_actor_id IS NOT NULL
                AND confirmed_at IS NOT NULL
                AND confirmed_by_actor_id <> recorded_by_actor_id
            )
        ),

    CONSTRAINT channel_requests_applied_state_consistent
        CHECK (
            (status = 'APPLIED' AND applied_at IS NOT NULL AND change_record_id IS NOT NULL)
            OR (status <> 'APPLIED' AND applied_at IS NULL AND applied_channel_id IS NULL)
        ),

    CONSTRAINT channel_requests_id_organization_uq
        UNIQUE (id, organization_id)
);

-- One open replacement per company, channel type and usage.
CREATE UNIQUE INDEX channel_requests_one_pending_uq
    ON public.company_channel_change_requests (organization_id, channel_type, usage)
    WHERE status = 'PENDING_CONFIRMATION';

-- One confirmation document confirms one request, once.
CREATE UNIQUE INDEX channel_requests_confirmation_evidence_uq
    ON public.company_channel_change_requests (confirmation_evidence_document_id)
    WHERE confirmation_evidence_document_id IS NOT NULL;

CREATE INDEX channel_requests_history_idx
    ON public.company_channel_change_requests (organization_id, recorded_at DESC);

-- ============================================================
-- 5. Integrity triggers
-- ============================================================

-- Append-only ledger: no UPDATE, no DELETE, no TRUNCATE.
CREATE FUNCTION tes_security.prevent_company_change_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Company change records are append-only'
        USING ERRCODE = '23514';
END;
$$;

-- A decided request is frozen; recorded facts never change; only the decision / evidence-link columns move.
CREATE FUNCTION tes_security.guard_company_change_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    column_name text;
BEGIN
    IF OLD.status <> 'PENDING' AND OLD.status <> 'PENDING_CONFIRMATION' THEN
        RAISE EXCEPTION 'A decided % row is frozen', TG_TABLE_NAME
            USING ERRCODE = '55000';
    END IF;

    FOREACH column_name IN ARRAY TG_ARGV LOOP
        IF to_jsonb(NEW) -> column_name IS DISTINCT FROM to_jsonb(OLD) -> column_name THEN
            RAISE EXCEPTION '% recorded content is immutable', TG_TABLE_NAME
                USING ERRCODE = '55000';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_company_change_record_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_change_request_update() FROM PUBLIC;

CREATE TRIGGER company_change_records_no_update
BEFORE UPDATE ON public.company_change_records
FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER company_change_records_no_delete
BEFORE DELETE ON public.company_change_records
FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER company_change_records_no_truncate
BEFORE TRUNCATE ON public.company_change_records
FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER company_change_record_evidence_no_update
BEFORE UPDATE ON public.company_change_record_evidence
FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER company_change_record_evidence_no_delete
BEFORE DELETE ON public.company_change_record_evidence
FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER company_change_record_evidence_no_truncate
BEFORE TRUNCATE ON public.company_change_record_evidence
FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER legal_name_requests_guard_active_organization
BEFORE INSERT ON public.company_legal_name_change_requests
FOR EACH ROW EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER legal_name_requests_guard_update
BEFORE UPDATE ON public.company_legal_name_change_requests
FOR EACH ROW EXECUTE FUNCTION tes_security.guard_company_change_request_update(
    'organization_id', 'previous_legal_name', 'requested_legal_name', 'requested_by_person_id', 'requester_relationship_id',
    'requester_basis', 'requester_authority_assignment_id', 'request_source', 'request_reference', 'request_received_at', 'recorded_by_actor_id', 'recorded_at'
);

CREATE TRIGGER legal_name_requests_no_delete
BEFORE DELETE ON public.company_legal_name_change_requests
FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER legal_name_requests_no_truncate
BEFORE TRUNCATE ON public.company_legal_name_change_requests
FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER channel_requests_guard_active_organization
BEFORE INSERT ON public.company_channel_change_requests
FOR EACH ROW EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER channel_requests_guard_update
BEFORE UPDATE ON public.company_channel_change_requests
FOR EACH ROW EXECUTE FUNCTION tes_security.guard_company_change_request_update(
    'organization_id', 'channel_type', 'usage', 'change_kind', 'previous_channel_id', 'previous_value', 'requested_value', 'requested_value_normalized',
    'request_source', 'request_reference', 'requested_by_person_id', 'sender_address', 'recorded_by_actor_id', 'recorded_at'
);

CREATE TRIGGER channel_requests_no_delete
BEFORE DELETE ON public.company_channel_change_requests
FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

CREATE TRIGGER channel_requests_no_truncate
BEFORE TRUNCATE ON public.company_channel_change_requests
FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_company_change_record_mutation();

-- ============================================================
-- 6. Row-level security (SYSTEM only; no CUSTOMER-facing read)
-- ============================================================

ALTER TABLE public.company_change_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_change_record_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_legal_name_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_channel_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_change_records_system ON public.company_change_records FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ', 'ORGANIZATION_UPDATE', 'COMPANY_LEGAL_NAME_CHANGE', 'CONTACT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE', 'COMPANY_LEGAL_NAME_CHANGE', 'CONTACT_MANAGE']));

CREATE POLICY company_change_record_evidence_system ON public.company_change_record_evidence FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ', 'ORGANIZATION_UPDATE', 'COMPANY_LEGAL_NAME_CHANGE', 'CONTACT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE', 'COMPANY_LEGAL_NAME_CHANGE', 'CONTACT_MANAGE']));

CREATE POLICY company_legal_name_change_requests_system ON public.company_legal_name_change_requests FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ', 'ORGANIZATION_UPDATE', 'COMPANY_LEGAL_NAME_CHANGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE', 'COMPANY_LEGAL_NAME_CHANGE']));

CREATE POLICY company_channel_change_requests_system ON public.company_channel_change_requests FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ', 'ORGANIZATION_UPDATE', 'CONTACT_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE', 'CONTACT_MANAGE']));

-- ============================================================
-- 7. Runtime privileges (no DELETE, no TRUNCATE, ledger append-only)
-- ============================================================

REVOKE ALL
ON TABLE
    public.company_change_records,
    public.company_change_record_evidence,
    public.company_legal_name_change_requests,
    public.company_channel_change_requests
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.company_change_records,
    public.company_change_record_evidence,
    public.company_legal_name_change_requests,
    public.company_channel_change_requests
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id, organization_id, operation_code, summary, previous_value, new_value, effective_at, actor_id,
    request_source, request_table, request_id, basis, basis_reference, master_register_event_id
)
ON public.company_change_records
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (change_record_id, organization_id, evidence_document_id, role)
ON public.company_change_record_evidence
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id, organization_id, previous_legal_name, requested_legal_name, requested_by_person_id, requester_relationship_id, requester_basis,
    requester_authority_assignment_id, request_source, request_reference, request_received_at, government_evidence_document_id, written_request_evidence_document_id,
    director_evidence_document_id, recorded_by_actor_id
)
ON public.company_legal_name_change_requests
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (
    status, government_evidence_document_id, written_request_evidence_document_id, director_evidence_document_id, effective_at,
    decided_by_actor_id, decided_at, decision_reason, change_record_id, updated_at
)
ON public.company_legal_name_change_requests
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id, organization_id, channel_type, usage, change_kind, previous_channel_id, previous_value, requested_value, requested_value_normalized,
    request_source, request_reference, requested_by_person_id, sender_address, recorded_by_actor_id
)
ON public.company_channel_change_requests
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (
    status, confirmation_channel_kind, confirmation_channel_id, confirmation_contact_person_id, confirmation_method, confirmation_reference,
    confirmation_evidence_document_id, confirmed_by_actor_id, confirmed_at, applied_channel_id, applied_at, decision_reason, change_record_id, updated_at
)
ON public.company_channel_change_requests
TO "tes-backend@tes-production-510007.iam";
