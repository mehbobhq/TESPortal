-- TES Drivers: intended operating scope, conditional application requirements, and company presentation jurisdiction
-- Migration: 0040 (forward-only, additive; migrations 0001-0039 are not edited)
--
-- WHY. TES serves U.S. and Canadian carriers equally. A prospective driver is not automatically a cross-border applicant, and the hiring
-- application a person receives must follow what THAT driver will actually do, not where the employer is registered or what authorities it holds.
--
--   driver_prospect_operating_scopes     the driver's INTENDED operating scope, versioned and append-only (one current version per prospect):
--                                        U.S. intrastate / interstate, Canadian intraprovincial / interprovincial, cross-border, mixed, undetermined,
--                                        with the states/provinces and the characteristics that decide which requirements apply.
--   driver_application_invitations       gains the scope it was issued for and the requirements profile (sections, consents, verification) that
--                                        applied, frozen at issuance. A changed scope revokes live invitations, so an outdated or mismatched
--                                        application can no longer be opened.
--   organization_presentation_jurisdictions   the company's explicitly established primary PRESENTATION jurisdiction (U.S. or Canada), used only to
--                                        order and word what staff see. It never decides regulatory applicability.
--
-- A prospect may exist with an undetermined scope; no application can be issued until a supported, sufficiently classified scope is established
-- (enforced in the service and, for the invitation row itself, here). Nothing is deleted: history is append-only.

-- ============================================================
-- 1. Operating scope versions
-- ============================================================

CREATE TABLE public.driver_prospect_operating_scopes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    scope_kind text NOT NULL,
    components text[] NOT NULL DEFAULT '{}',
    us_jurisdictions text[] NOT NULL DEFAULT '{}',
    ca_jurisdictions text[] NOT NULL DEFAULT '{}',
    characteristics jsonb NOT NULL DEFAULT '{}'::jsonb,
    rules_version text NOT NULL,
    established_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    established_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    superseded_at timestamptz,
    CONSTRAINT driver_prospect_operating_scopes_prospect_fk
        FOREIGN KEY (prospect_id, organization_id) REFERENCES public.driver_prospects (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_prospect_operating_scopes_id_scope_uq UNIQUE (id, prospect_id, organization_id),
    CONSTRAINT driver_prospect_operating_scopes_kind_valid
        CHECK (scope_kind IN ('US_INTRASTATE', 'US_INTERSTATE', 'CA_INTRAPROVINCIAL', 'CA_INTERPROVINCIAL', 'CROSS_BORDER', 'MIXED', 'UNDETERMINED')),
    CONSTRAINT driver_prospect_operating_scopes_codes_valid
        CHECK (array_to_string(us_jurisdictions, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$' AND array_to_string(ca_jurisdictions, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
    CONSTRAINT driver_prospect_operating_scopes_characteristics_object CHECK (jsonb_typeof(characteristics) = 'object'),
    CONSTRAINT driver_prospect_operating_scopes_rules_version_not_blank CHECK (btrim(rules_version) <> ''),
    -- The shape each kind needs to be a meaningful classification. (Whether the kind is ISSUABLE is decided by the rules in the service.)
    CONSTRAINT driver_prospect_operating_scopes_shape CHECK (
        CASE scope_kind
            WHEN 'US_INTRASTATE' THEN cardinality(us_jurisdictions) = 1 AND cardinality(ca_jurisdictions) = 0 AND cardinality(components) = 0
            WHEN 'US_INTERSTATE' THEN cardinality(us_jurisdictions) >= 2 AND cardinality(ca_jurisdictions) = 0 AND cardinality(components) = 0
            WHEN 'CA_INTRAPROVINCIAL' THEN cardinality(ca_jurisdictions) = 1 AND cardinality(us_jurisdictions) = 0 AND cardinality(components) = 0
            WHEN 'CA_INTERPROVINCIAL' THEN cardinality(ca_jurisdictions) >= 2 AND cardinality(us_jurisdictions) = 0 AND cardinality(components) = 0
            WHEN 'CROSS_BORDER' THEN cardinality(ca_jurisdictions) >= 1 AND cardinality(us_jurisdictions) >= 1 AND cardinality(components) = 0
            WHEN 'MIXED' THEN cardinality(components) >= 2
                AND components <@ ARRAY['US_INTRASTATE', 'US_INTERSTATE', 'CA_INTRAPROVINCIAL', 'CA_INTERPROVINCIAL', 'CROSS_BORDER']::text[]
                AND cardinality(us_jurisdictions) + cardinality(ca_jurisdictions) >= 1
            WHEN 'UNDETERMINED' THEN cardinality(us_jurisdictions) = 0 AND cardinality(ca_jurisdictions) = 0 AND cardinality(components) = 0
        END
    )
);
CREATE UNIQUE INDEX driver_prospect_operating_scopes_current_uq ON public.driver_prospect_operating_scopes (prospect_id) WHERE superseded_at IS NULL;
CREATE INDEX driver_prospect_operating_scopes_prospect_idx ON public.driver_prospect_operating_scopes (prospect_id, established_at DESC);

-- ============================================================
-- 2. Company presentation jurisdiction (explicit; presentation only)
-- ============================================================

CREATE TABLE public.organization_presentation_jurisdictions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    country_code text NOT NULL,
    established_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    established_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    superseded_at timestamptz,
    CONSTRAINT organization_presentation_jurisdictions_country_valid CHECK (country_code IN ('US', 'CA'))
);
CREATE UNIQUE INDEX organization_presentation_jurisdictions_current_uq ON public.organization_presentation_jurisdictions (organization_id) WHERE superseded_at IS NULL;

-- ============================================================
-- 3. The invitation records the scope and requirements it was issued for
-- ============================================================

ALTER TABLE public.driver_application_invitations
    ADD COLUMN operating_scope_id uuid,
    ADD COLUMN requirements_profile jsonb,
    ADD COLUMN requirements_rules_version text,
    ADD CONSTRAINT driver_application_invitations_scope_fk
        FOREIGN KEY (operating_scope_id, prospect_id, organization_id)
        REFERENCES public.driver_prospect_operating_scopes (id, prospect_id, organization_id) ON DELETE RESTRICT,
    ADD CONSTRAINT driver_application_invitations_requirements_together
        CHECK ((operating_scope_id IS NULL) = (requirements_profile IS NULL) AND (requirements_profile IS NULL) = (requirements_rules_version IS NULL)),
    ADD CONSTRAINT driver_application_invitations_requirements_object
        CHECK (requirements_profile IS NULL OR jsonb_typeof(requirements_profile) = 'object');

ALTER TABLE public.driver_prospect_events DROP CONSTRAINT driver_prospect_events_type_valid;
ALTER TABLE public.driver_prospect_events ADD CONSTRAINT driver_prospect_events_type_valid
    CHECK (event_type IN ('PROSPECT_CREATED', 'INVITATION_CREATED', 'INVITATION_SENT', 'INVITATION_FAILED', 'INVITATION_REVOKED', 'APPLICATION_OPENED', 'APPLICATION_SUBMITTED', 'STATUS_CHANGED', 'CONVERTED_TO_DRIVER', 'OPERATING_SCOPE_ESTABLISHED'));

-- ============================================================
-- 4. Guards
-- ============================================================

-- Scope versions and presentation rows are immutable except for being superseded, and are never deleted.
CREATE FUNCTION tes_security.guard_driver_versioned_row_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL OR to_jsonb(NEW) - 'superseded_at' IS DISTINCT FROM to_jsonb(OLD) - 'superseded_at' THEN
        RAISE EXCEPTION 'A recorded version can only be superseded, never changed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_versioned_row_update() FROM PUBLIC;

CREATE TRIGGER driver_prospect_operating_scopes_guard_update BEFORE UPDATE ON public.driver_prospect_operating_scopes
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_versioned_row_update();
CREATE TRIGGER organization_presentation_jurisdictions_guard_update BEFORE UPDATE ON public.organization_presentation_jurisdictions
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_versioned_row_update();
CREATE TRIGGER driver_prospect_operating_scopes_no_delete BEFORE DELETE ON public.driver_prospect_operating_scopes FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER driver_prospect_operating_scopes_no_truncate BEFORE TRUNCATE ON public.driver_prospect_operating_scopes FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER organization_presentation_jurisdictions_no_delete BEFORE DELETE ON public.organization_presentation_jurisdictions FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();
CREATE TRIGGER organization_presentation_jurisdictions_no_truncate BEFORE TRUNCATE ON public.organization_presentation_jurisdictions FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_prospect_history_mutation();

-- An invitation row must name the CURRENT operating scope of its own prospect (so an application is never issued without a classification,
-- nor for a superseded one), and the requirements it freezes must be present.
CREATE FUNCTION tes_security.guard_driver_invitation_scope_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.operating_scope_id IS NULL OR NEW.requirements_profile IS NULL THEN
        RAISE EXCEPTION 'An application cannot be issued without an established operating scope' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.driver_prospect_operating_scopes s
         WHERE s.id = NEW.operating_scope_id AND s.prospect_id = NEW.prospect_id AND s.organization_id = NEW.organization_id
           AND s.superseded_at IS NULL AND s.scope_kind <> 'UNDETERMINED'
    ) THEN
        RAISE EXCEPTION 'An application can be issued only for the prospect''s current, determined operating scope' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_invitation_scope_insert() FROM PUBLIC;
CREATE TRIGGER driver_application_invitations_scope_insert BEFORE INSERT ON public.driver_application_invitations
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_invitation_scope_insert();

-- The scope, requirements and rules version an invitation was issued for are frozen with it.
CREATE OR REPLACE FUNCTION tes_security.guard_driver_invitation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.recipient_email_normalized IS DISTINCT FROM OLD.recipient_email_normalized
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.operating_scope_id IS DISTINCT FROM OLD.operating_scope_id OR NEW.requirements_profile IS DISTINCT FROM OLD.requirements_profile
       OR NEW.requirements_rules_version IS DISTINCT FROM OLD.requirements_rules_version THEN
        RAISE EXCEPTION 'An invitation keeps its prospect, recipient, token, expiry, operating scope and requirements' USING ERRCODE = '23514';
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

-- Backstop: establishing a new scope version closes any invitation still open for the old one (the service revokes first and records the events;
-- this guarantees the same outcome for any other writer).
CREATE FUNCTION tes_security.revoke_invitations_on_scope_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE public.driver_application_invitations
       SET status = 'REVOKED'
     WHERE prospect_id = NEW.prospect_id AND organization_id = NEW.organization_id AND status IN ('PENDING', 'SENT', 'OPENED')
       AND operating_scope_id IS DISTINCT FROM NEW.id;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.revoke_invitations_on_scope_change() FROM PUBLIC;
CREATE TRIGGER driver_prospect_operating_scopes_revoke_invitations AFTER INSERT ON public.driver_prospect_operating_scopes
    FOR EACH ROW EXECUTE FUNCTION tes_security.revoke_invitations_on_scope_change();

-- ============================================================
-- 5. Row-level security and grants
-- ============================================================

ALTER TABLE public.driver_prospect_operating_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_presentation_jurisdictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_prospect_operating_scopes_system ON public.driver_prospect_operating_scopes FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY organization_presentation_jurisdictions_system ON public.organization_presentation_jurisdictions FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE', 'COMPANY_PROFILE_READ', 'COMPANY_PROFILE_MANAGE']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_MANAGE']));

REVOKE ALL ON TABLE public.driver_prospect_operating_scopes, public.organization_presentation_jurisdictions FROM PUBLIC;
GRANT SELECT ON TABLE public.driver_prospect_operating_scopes, public.organization_presentation_jurisdictions TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, prospect_id, organization_id, scope_kind, components, us_jurisdictions, ca_jurisdictions, characteristics, rules_version, established_by_actor_id)
    ON public.driver_prospect_operating_scopes TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (superseded_at) ON public.driver_prospect_operating_scopes TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, organization_id, country_code, established_by_actor_id) ON public.organization_presentation_jurisdictions TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (superseded_at) ON public.organization_presentation_jurisdictions TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (operating_scope_id, requirements_profile, requirements_rules_version) ON public.driver_application_invitations TO "tes-backend@tes-production-510007.iam";

-- ============================================================
-- 6. The applicant's invitation step now returns the requirements it was issued for
-- ============================================================

-- Replaces the 0039 function (its result gains requirements_profile). An invitation opens only while it is live AND the scope it was issued for
-- is still the prospect's current scope, so an application issued for an old scope can never be completed.
DROP FUNCTION tes_security.open_driver_application_invitation(text);
CREATE FUNCTION tes_security.open_driver_application_invitation(p_token_hash text)
RETURNS TABLE (
    invitation_id uuid,
    prospect_id uuid,
    organization_id uuid,
    company_name text,
    given_name text,
    family_name text,
    recipient_email text,
    expires_at timestamptz,
    requirements_profile jsonb
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
     WHERE i.token_hash = p_token_hash AND i.status IN ('PENDING', 'SENT', 'OPENED') AND i.expires_at > clock_timestamp()
       AND i.requirements_profile IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.driver_prospect_operating_scopes s
         WHERE s.id = inv.operating_scope_id AND s.prospect_id = inv.prospect_id AND s.organization_id = inv.organization_id AND s.superseded_at IS NULL
    ) THEN
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
           inv.expires_at,
           inv.requirements_profile;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.open_driver_application_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.open_driver_application_invitation(text) TO "tes-backend@tes-production-510007.iam";
