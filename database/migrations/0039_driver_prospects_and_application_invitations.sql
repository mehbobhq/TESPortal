-- TES Drivers: driver prospects and secure application invitations
-- Migration: 0039 (forward-only, additive; migrations 0001-0038 are not edited; requires 0037 and 0038 of PR #30 to be applied first)
--
-- WHY. A carrier can give TES only a prospective driver's name, phone and email. Until now the only place to save that was a browser-only
-- prototype, and the only way to invite the person was an unauthenticated endpoint that took the company identity from the request body.
-- This migration adds the durable, tenant-scoped records for that workflow. It does NOT create a driver registry: a prospect is a LINK between a
-- canonical person (public.persons) and a company, with a lifecycle, and it is deliberately NOT an organization_driver_relationships row, so a
-- prospect is never an open assignment, never holds the driver exclusively, and never appears in a company's driver roster. Becoming a driver is a
-- separate, explicit, qualified step (an ONBOARDING relationship created through the existing assignment rules).
--
--   driver_prospects                 person <-> company, lifecycle PROSPECT -> INVITED -> APPLICATION_SUBMITTED -> UNDER_REVIEW -> APPROVED
--                                    (or REJECTED / WITHDRAWN). Transitions are enforced here, so no writer can skip a step.
--   driver_application_invitations   one row per invitation sent: only a SHA-256 hash of the secret token is stored, never the token. Delivery
--                                    outcome and status are recorded. At most one live invitation per prospect.
--   driver_application_submissions   the submitted application, append-only, one per invitation.
--   driver_prospect_events           append-only status history (also for the applicant's own steps, which have no staff actor).
--
-- Access. All four tables are SYSTEM-scope under the existing capabilities (read: DRIVER_READ / DRIVER_MANAGE; write: DRIVER_MANAGE); there is no
-- customer policy, so no customer can see a prospect or an application. The applicant has no database identity: the two applicant steps
-- (opening the invitation, submitting the application) go through two narrow SECURITY DEFINER functions that act ONLY on the invitation proven by
-- the secret token (or by the server-signed token derived from it), return the minimum, and change only that invitation's own state.
-- Nothing is deleted: DELETE and TRUNCATE are blocked on every table.

-- ============================================================
-- 1. Tables
-- ============================================================

CREATE TABLE public.driver_prospects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'PROSPECT',
    created_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    converted_relationship_id uuid REFERENCES public.organization_driver_relationships(id) ON DELETE RESTRICT,
    status_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_prospects_status_valid
        CHECK (status IN ('PROSPECT', 'INVITED', 'APPLICATION_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    CONSTRAINT driver_prospects_converted_only_when_approved
        CHECK (converted_relationship_id IS NULL OR status = 'APPROVED'),
    CONSTRAINT driver_prospects_id_organization_uq UNIQUE (id, organization_id)
);
-- One live prospect per company and person: a second prospect for the same person at the same company would be a duplicate record.
CREATE UNIQUE INDEX driver_prospects_live_uq
    ON public.driver_prospects (organization_id, person_id)
    WHERE status IN ('PROSPECT', 'INVITED', 'APPLICATION_SUBMITTED', 'UNDER_REVIEW');
CREATE INDEX driver_prospects_organization_idx ON public.driver_prospects (organization_id, status, created_at DESC);
CREATE INDEX driver_prospects_person_idx ON public.driver_prospects (person_id);

CREATE TABLE public.driver_application_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    token_hash text NOT NULL,
    recipient_email_normalized text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    expires_at timestamptz NOT NULL,
    sent_at timestamptz,
    provider_message_id text,
    delivery_error_code text,
    opened_at timestamptz,
    submitted_at timestamptz,
    created_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_application_invitations_prospect_fk
        FOREIGN KEY (prospect_id, organization_id) REFERENCES public.driver_prospects (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_invitations_token_hash_valid CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT driver_application_invitations_status_valid
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'OPENED', 'SUBMITTED', 'REVOKED')),
    CONSTRAINT driver_application_invitations_email_valid CHECK (recipient_email_normalized = lower(btrim(recipient_email_normalized)) AND position('@' IN recipient_email_normalized) > 1),
    CONSTRAINT driver_application_invitations_token_hash_uq UNIQUE (token_hash),
    CONSTRAINT driver_application_invitations_id_scope_uq UNIQUE (id, prospect_id, organization_id)
);
-- At most one LIVE invitation per prospect: sending again first revokes the earlier one.
CREATE UNIQUE INDEX driver_application_invitations_live_uq
    ON public.driver_application_invitations (prospect_id)
    WHERE status IN ('PENDING', 'SENT', 'OPENED');
CREATE INDEX driver_application_invitations_prospect_idx ON public.driver_application_invitations (prospect_id, created_at DESC);

CREATE TABLE public.driver_application_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invitation_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    receipt_id text NOT NULL,
    payload jsonb NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_application_submissions_invitation_fk
        FOREIGN KEY (invitation_id, prospect_id, organization_id) REFERENCES public.driver_application_invitations (id, prospect_id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_application_submissions_payload_object CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT driver_application_submissions_receipt_not_blank CHECK (btrim(receipt_id) <> ''),
    CONSTRAINT driver_application_submissions_invitation_uq UNIQUE (invitation_id)
);

CREATE TABLE public.driver_prospect_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    event_type text NOT NULL,
    from_status text,
    to_status text,
    invitation_id uuid REFERENCES public.driver_application_invitations(id) ON DELETE RESTRICT,
    actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    source text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_prospect_events_prospect_fk
        FOREIGN KEY (prospect_id, organization_id) REFERENCES public.driver_prospects (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_prospect_events_type_valid
        CHECK (event_type IN ('PROSPECT_CREATED', 'INVITATION_CREATED', 'INVITATION_SENT', 'INVITATION_FAILED', 'INVITATION_REVOKED', 'APPLICATION_OPENED', 'APPLICATION_SUBMITTED', 'STATUS_CHANGED', 'CONVERTED_TO_DRIVER')),
    CONSTRAINT driver_prospect_events_source_valid CHECK (source IN ('STAFF', 'APPLICANT_LINK')),
    -- a staff event names its actor; an applicant event has none
    CONSTRAINT driver_prospect_events_actor_matches_source CHECK ((source = 'STAFF') = (actor_id IS NOT NULL))
);
CREATE INDEX driver_prospect_events_prospect_idx ON public.driver_prospect_events (prospect_id, occurred_at, id);

-- ============================================================
-- 2. Guards: transitions, immutability, no delete
-- ============================================================

CREATE FUNCTION tes_security.guard_driver_prospect_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.person_id IS DISTINCT FROM OLD.person_id
       OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'A driver prospect keeps its company, person and creator' USING ERRCODE = '23514';
    END IF;
    IF NEW.converted_relationship_id IS DISTINCT FROM OLD.converted_relationship_id AND OLD.converted_relationship_id IS NOT NULL THEN
        RAISE EXCEPTION 'A converted prospect keeps its driver relationship' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'PROSPECT' AND NEW.status IN ('INVITED', 'WITHDRAWN'))
        OR (OLD.status = 'INVITED' AND NEW.status IN ('APPLICATION_SUBMITTED', 'WITHDRAWN'))
        OR (OLD.status = 'APPLICATION_SUBMITTED' AND NEW.status IN ('UNDER_REVIEW', 'REJECTED', 'WITHDRAWN'))
        OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('APPROVED', 'REJECTED', 'WITHDRAWN'))
    ) THEN
        RAISE EXCEPTION 'A driver prospect cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.status_changed_at := clock_timestamp();
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_prospect_update() FROM PUBLIC;
CREATE TRIGGER driver_prospects_guard_update BEFORE UPDATE ON public.driver_prospects
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_prospect_update();

CREATE FUNCTION tes_security.guard_driver_invitation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.recipient_email_normalized IS DISTINCT FROM OLD.recipient_email_normalized
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'An invitation keeps its prospect, recipient, token and expiry' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'PENDING' AND NEW.status IN ('SENT', 'FAILED', 'OPENED', 'SUBMITTED', 'REVOKED'))
        OR (OLD.status = 'SENT' AND NEW.status IN ('OPENED', 'SUBMITTED', 'REVOKED'))
        OR (OLD.status = 'OPENED' AND NEW.status IN ('SUBMITTED', 'REVOKED'))
    ) THEN
        RAISE EXCEPTION 'An invitation cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_invitation_update() FROM PUBLIC;
CREATE TRIGGER driver_application_invitations_guard_update BEFORE UPDATE ON public.driver_application_invitations
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_invitation_update();

CREATE FUNCTION tes_security.prevent_driver_prospect_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Driver prospect records are never deleted, and submissions and events are append-only' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION tes_security.prevent_driver_prospect_history_mutation() FROM PUBLIC;

CREATE TRIGGER driver_prospects_no_delete BEFORE DELETE ON public.driver_prospects FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_prospects_no_truncate BEFORE TRUNCATE ON public.driver_prospects FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_application_invitations_no_delete BEFORE DELETE ON public.driver_application_invitations FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_application_invitations_no_truncate BEFORE TRUNCATE ON public.driver_application_invitations FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_application_submissions_no_update BEFORE UPDATE ON public.driver_application_submissions FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_application_submissions_no_delete BEFORE DELETE ON public.driver_application_submissions FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_application_submissions_no_truncate BEFORE TRUNCATE ON public.driver_application_submissions FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_prospect_events_no_update BEFORE UPDATE ON public.driver_prospect_events FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_prospect_events_no_delete BEFORE DELETE ON public.driver_prospect_events FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_prospect_events_no_truncate BEFORE TRUNCATE ON public.driver_prospect_events FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();

-- ============================================================
-- 3. Row-level security (SYSTEM scope; no customer access) and grants
-- ============================================================

ALTER TABLE public.driver_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_application_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_application_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_prospect_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_prospects_system ON public.driver_prospects FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY driver_application_invitations_system ON public.driver_application_invitations FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY driver_application_submissions_system ON public.driver_application_submissions FOR SELECT
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']));
CREATE POLICY driver_prospect_events_system ON public.driver_prospect_events FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));

REVOKE ALL ON TABLE public.driver_prospects, public.driver_application_invitations, public.driver_application_submissions, public.driver_prospect_events FROM PUBLIC;
GRANT SELECT ON TABLE public.driver_prospects, public.driver_application_invitations, public.driver_application_submissions, public.driver_prospect_events TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, organization_id, person_id, created_by_actor_id) ON public.driver_prospects TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (status, converted_relationship_id) ON public.driver_prospects TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, prospect_id, organization_id, token_hash, recipient_email_normalized, expires_at, created_by_actor_id) ON public.driver_application_invitations TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (status, sent_at, provider_message_id, delivery_error_code) ON public.driver_application_invitations TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (prospect_id, organization_id, event_type, from_status, to_status, invitation_id, actor_id, source) ON public.driver_prospect_events TO "tes-backend@tes-production-510007.iam";

-- ============================================================
-- 4. The two applicant steps (no database identity: acts only on the invitation the secret proves)
-- ============================================================

-- Opens an invitation by the SHA-256 of its secret token. Returns nothing unless the invitation is live (PENDING / SENT / OPENED and not
-- expired). Marks it OPENED once, records the event, and returns only what the applicant's own page needs. The caller must already hold the
-- 256-bit secret, so this answers nothing to anyone else.
CREATE FUNCTION tes_security.open_driver_application_invitation(p_token_hash text)
RETURNS TABLE (
    invitation_id uuid,
    prospect_id uuid,
    organization_id uuid,
    company_name text,
    given_name text,
    family_name text,
    recipient_email text,
    expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    inv public.driver_application_invitations%ROWTYPE;
    prospect public.driver_prospects%ROWTYPE;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN;
    END IF;
    SELECT * INTO inv FROM public.driver_application_invitations i
     WHERE i.token_hash = p_token_hash AND i.status IN ('PENDING', 'SENT', 'OPENED') AND i.expires_at > clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT * INTO prospect FROM public.driver_prospects p WHERE p.id = inv.prospect_id AND p.organization_id = inv.organization_id;
    IF NOT FOUND OR prospect.status NOT IN ('PROSPECT', 'INVITED') THEN
        RETURN;
    END IF;
    IF inv.status <> 'OPENED' THEN
        UPDATE public.driver_application_invitations SET status = 'OPENED', opened_at = clock_timestamp() WHERE id = inv.id;
        INSERT INTO public.driver_prospect_events (prospect_id, organization_id, event_type, invitation_id, source)
        VALUES (inv.prospect_id, inv.organization_id, 'APPLICATION_OPENED', inv.id, 'APPLICANT_LINK');
    END IF;
    RETURN QUERY
    SELECT inv.id, inv.prospect_id, inv.organization_id,
           (SELECT coalesce(o.display_name, o.legal_name) FROM public.organizations o WHERE o.id = inv.organization_id),
           (SELECT n.given_name FROM public.person_name_versions n WHERE n.person_id = prospect.person_id AND n.record_status = 'active' AND n.effective_to IS NULL LIMIT 1),
           (SELECT n.family_name FROM public.person_name_versions n WHERE n.person_id = prospect.person_id AND n.record_status = 'active' AND n.effective_to IS NULL LIMIT 1),
           inv.recipient_email_normalized,
           inv.expires_at;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.open_driver_application_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.open_driver_application_invitation(text) TO "tes-backend@tes-production-510007.iam";

-- Records the applicant's submission against ONE live invitation: stores it (append-only), closes the invitation as SUBMITTED, moves the
-- prospect to APPLICATION_SUBMITTED and writes the event. It creates no person and no driver: the application belongs to the existing prospect,
-- so completing an application can never create a duplicate person. A second submission, an expired, revoked or failed invitation is refused.
CREATE FUNCTION tes_security.submit_driver_application(p_invitation_id uuid, p_receipt_id text, p_payload jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    inv public.driver_application_invitations%ROWTYPE;
    prospect public.driver_prospects%ROWTYPE;
    submitted timestamptz := clock_timestamp();
BEGIN
    SELECT * INTO inv FROM public.driver_application_invitations i WHERE i.id = p_invitation_id FOR UPDATE;
    IF NOT FOUND THEN
        -- not a database invitation at all (the caller may then treat it as a legacy application)
        RAISE EXCEPTION 'Unknown application invitation' USING ERRCODE = 'P0002';
    END IF;
    IF inv.status NOT IN ('PENDING', 'SENT', 'OPENED') OR inv.expires_at <= submitted THEN
        RAISE EXCEPTION 'This application invitation is not open' USING ERRCODE = '55000';
    END IF;
    SELECT * INTO prospect FROM public.driver_prospects p WHERE p.id = inv.prospect_id AND p.organization_id = inv.organization_id FOR UPDATE;
    IF NOT FOUND OR prospect.status NOT IN ('PROSPECT', 'INVITED') THEN
        RAISE EXCEPTION 'This application invitation is not open' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.driver_application_submissions (invitation_id, prospect_id, organization_id, receipt_id, payload, submitted_at)
    VALUES (inv.id, inv.prospect_id, inv.organization_id, p_receipt_id, p_payload, submitted);
    UPDATE public.driver_application_invitations SET status = 'SUBMITTED', submitted_at = submitted WHERE id = inv.id;
    IF prospect.status = 'PROSPECT' THEN
        UPDATE public.driver_prospects SET status = 'INVITED' WHERE id = prospect.id;
    END IF;
    UPDATE public.driver_prospects SET status = 'APPLICATION_SUBMITTED' WHERE id = prospect.id;
    INSERT INTO public.driver_prospect_events (prospect_id, organization_id, event_type, from_status, to_status, invitation_id, source)
    VALUES (inv.prospect_id, inv.organization_id, 'APPLICATION_SUBMITTED', 'INVITED', 'APPLICATION_SUBMITTED', inv.id, 'APPLICANT_LINK');
    RETURN submitted;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.submit_driver_application(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.submit_driver_application(uuid, text, jsonb) TO "tes-backend@tes-production-510007.iam";
