-- TES actor and authentication identity foundation
-- Migration: 0005
--
-- Scope:
--   - establish permanent TES actor identities
--   - link external authentication-provider identities to TES actors
--   - preserve provider independence for TES authorization and accountability
--
-- This migration intentionally does NOT introduce:
--   - passwords, MFA secrets, passkeys, biometrics, or session tokens
--   - email addresses as identity anchors
--   - customer assignments or customer authorization
--   - employee roles, departments, teams, positions, or capabilities
--   - driver workflow permissions
--   - tenant-owned operational records or RLS policies
--   - Master Register persistence
--
-- Contract:
--   - actors.id is the permanent opaque TES actor identifier
--   - authentication provider identities are adapters to TES actors, not TES identity itself
--   - provider + provider_subject identifies one external authentication identity
--   - normal runtime code cannot rewrite actor_id, provider, or provider_subject after creation
--   - authentication does not itself establish customer scope or action authorization
--   - MFA/authentication assurance is proven by the authenticated server session, not by a
--     mutable boolean stored in these tables

CREATE TABLE public.actors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    CONSTRAINT actors_actor_type_not_blank CHECK (btrim(actor_type) <> ''),
    CONSTRAINT actors_actor_type_valid CHECK (actor_type IN ('HUMAN','SYSTEM','AUTOMATION','INTEGRATION','SERVICE_ACCOUNT')),
    CONSTRAINT actors_status_valid CHECK (status IN ('active','suspended','disabled')),
    CONSTRAINT actors_disabled_state_consistent CHECK ((status = 'disabled' AND disabled_at IS NOT NULL) OR (status <> 'disabled' AND disabled_at IS NULL))
);

CREATE INDEX actors_actor_type_idx ON public.actors (actor_type);
CREATE INDEX actors_status_idx ON public.actors (status);

CREATE TABLE public.authentication_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    provider_subject text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    linked_at timestamptz NOT NULL DEFAULT now(),
    last_authenticated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    CONSTRAINT authentication_identities_provider_not_blank CHECK (btrim(provider) <> ''),
    CONSTRAINT authentication_identities_provider_normalized CHECK (provider = lower(btrim(provider))),
    CONSTRAINT authentication_identities_provider_subject_not_blank CHECK (btrim(provider_subject) <> ''),
    CONSTRAINT authentication_identities_provider_subject_trimmed CHECK (provider_subject = btrim(provider_subject)),
    CONSTRAINT authentication_identities_status_valid CHECK (status IN ('active','disabled')),
    CONSTRAINT authentication_identities_disabled_state_consistent CHECK ((status = 'disabled' AND disabled_at IS NOT NULL) OR (status = 'active' AND disabled_at IS NULL))
);

CREATE UNIQUE INDEX authentication_identities_provider_subject_uq
    ON public.authentication_identities (provider, provider_subject);
CREATE INDEX authentication_identities_actor_idx ON public.authentication_identities (actor_id);
CREATE INDEX authentication_identities_status_idx ON public.authentication_identities (status);

-- Migration 0002 removed automatic runtime privileges. Every grant below is deliberate.
-- Runtime receives no DELETE/TRUNCATE and cannot update permanent identity anchors.
GRANT SELECT ON TABLE public.actors, public.authentication_identities
TO "tes-backend@tes-production-510007.iam";

-- Database controls UUID, status and timestamps at creation.
GRANT INSERT (actor_type) ON public.actors
TO "tes-backend@tes-production-510007.iam";

-- Provider link is established once; actor_id/provider/provider_subject are not runtime-updatable.
GRANT INSERT (actor_id, provider, provider_subject) ON public.authentication_identities
TO "tes-backend@tes-production-510007.iam";

-- Operational metadata only; never authoritative proof of MFA/authentication assurance.
GRANT UPDATE (last_authenticated_at, updated_at) ON public.authentication_identities
TO "tes-backend@tes-production-510007.iam";
