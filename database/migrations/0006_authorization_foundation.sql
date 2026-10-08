-- TES authorization foundation
-- Migration: 0006
--
-- Scope:
--   - establish the centralized TES Master Account authority designation
--   - establish temporal actor relationships
--   - establish relationship assignments / authorization scopes
--   - establish an extensible capability catalogue
--   - establish explicit capability grants to relationships
--
-- This migration intentionally does NOT introduce:
--   - person/profile records or identity evidence
--   - job titles, departments, teams, or organization hierarchy
--   - Clerk/provider-specific authorization claims
--   - Master Register persistence or security-event persistence
--   - tenant-owned operational tables or RLS policies
--   - credential secret storage or KMS/vault structures
--   - behavioral/product/marketing intelligence
--   - ordinary application procedures for Master Account recovery
--
-- Contract:
--   - authentication resolves an active permanent TES actor before authorization
--   - one active Master Account may exist at a time
--   - Master Account is authorization authority, not an actor_type or job title
--   - Master Account has system-wide administrative authority but no exemption from
--     authentication, Master Register accountability, or integrity controls
--   - Master Account does NOT receive PostgreSQL BYPASSRLS; authorized server code
--     may establish any valid customer context for it and RLS remains in force
--   - ordinary actors are default-deny and require an active relationship,
--     applicable active assignment/scope, and applicable active capability grant
--   - relationships, assignments, and grants are temporal and are ended rather
--     than deleted/re-written during normal operation
--   - authentication-provider identities remain adapters to actors; authorization
--     never depends on email, title, provider claims, or provider-specific roles
--   - Master Account recovery must preserve the same permanent actor and use a
--     separately controlled break-glass procedure; this migration does not weaken
--     the immutable authentication-identity contract established by migration 0005

CREATE TABLE public.master_account_authority (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    designated_at timestamptz NOT NULL DEFAULT now(),
    designated_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    ended_at timestamptz,
    ended_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT master_account_authority_status_valid CHECK (status IN ('active','ended')),
    CONSTRAINT master_account_authority_end_state_consistent CHECK (
        (status = 'active' AND ended_at IS NULL AND ended_by_actor_id IS NULL)
        OR (status = 'ended' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT master_account_authority_end_not_before_designation
        CHECK (ended_at IS NULL OR ended_at >= designated_at)
);

CREATE UNIQUE INDEX master_account_authority_one_active_uq
    ON public.master_account_authority ((1)) WHERE status = 'active';
CREATE INDEX master_account_authority_actor_idx
    ON public.master_account_authority (actor_id);

CREATE TABLE public.actor_relationships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    relationship_type text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT actor_relationships_type_not_blank CHECK (btrim(relationship_type) <> ''),
    CONSTRAINT actor_relationships_type_normalized CHECK (relationship_type = upper(btrim(relationship_type))),
    CONSTRAINT actor_relationships_type_valid CHECK (relationship_type IN ('TES_STAFF','CUSTOMER_USER','DRIVER')),
    CONSTRAINT actor_relationships_status_valid CHECK (status IN ('active','suspended','ended')),
    CONSTRAINT actor_relationships_end_state_consistent CHECK (
        (status IN ('active','suspended') AND ends_at IS NULL)
        OR (status = 'ended' AND ends_at IS NOT NULL)
    ),
    CONSTRAINT actor_relationships_end_not_before_start CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX actor_relationships_actor_idx ON public.actor_relationships (actor_id);
CREATE INDEX actor_relationships_type_status_idx ON public.actor_relationships (relationship_type,status);
CREATE UNIQUE INDEX actor_relationships_actor_type_open_uq
    ON public.actor_relationships (actor_id,relationship_type)
    WHERE status IN ('active','suspended');

CREATE TABLE public.relationship_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES public.actor_relationships(id) ON DELETE RESTRICT,
    scope_type text NOT NULL,
    customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT relationship_assignments_scope_type_valid CHECK (scope_type IN ('SYSTEM','CUSTOMER')),
    CONSTRAINT relationship_assignments_scope_shape_valid CHECK (
        (scope_type = 'SYSTEM' AND customer_id IS NULL)
        OR (scope_type = 'CUSTOMER' AND customer_id IS NOT NULL)
    ),
    CONSTRAINT relationship_assignments_status_valid CHECK (status IN ('active','suspended','ended')),
    CONSTRAINT relationship_assignments_end_state_consistent CHECK (
        (status IN ('active','suspended') AND ends_at IS NULL)
        OR (status = 'ended' AND ends_at IS NOT NULL)
    ),
    CONSTRAINT relationship_assignments_end_not_before_start CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX relationship_assignments_relationship_idx ON public.relationship_assignments (relationship_id);
CREATE INDEX relationship_assignments_customer_idx ON public.relationship_assignments (customer_id)
    WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX relationship_assignments_system_open_uq
    ON public.relationship_assignments (relationship_id)
    WHERE scope_type = 'SYSTEM' AND status IN ('active','suspended');
CREATE UNIQUE INDEX relationship_assignments_customer_open_uq
    ON public.relationship_assignments (relationship_id,customer_id)
    WHERE scope_type = 'CUSTOMER' AND status IN ('active','suspended');

CREATE TABLE public.capabilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL,
    display_name text NOT NULL,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT capabilities_code_not_blank CHECK (btrim(code) <> ''),
    CONSTRAINT capabilities_code_normalized CHECK (code = upper(btrim(code))),
    CONSTRAINT capabilities_display_name_not_blank CHECK (btrim(display_name) <> '')
);
CREATE UNIQUE INDEX capabilities_code_uq ON public.capabilities (code);
CREATE INDEX capabilities_active_sort_idx ON public.capabilities (is_active,sort_order,code);

CREATE TABLE public.relationship_capability_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES public.actor_relationships(id) ON DELETE RESTRICT,
    capability_id uuid NOT NULL REFERENCES public.capabilities(id) ON DELETE RESTRICT,
    assignment_id uuid REFERENCES public.relationship_assignments(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    granted_at timestamptz NOT NULL DEFAULT now(),
    granted_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    ended_at timestamptz,
    ended_by_actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT relationship_capability_grants_status_valid CHECK (status IN ('active','suspended','ended')),
    CONSTRAINT relationship_capability_grants_end_state_consistent CHECK (
        (status IN ('active','suspended') AND ended_at IS NULL AND ended_by_actor_id IS NULL)
        OR (status = 'ended' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT relationship_capability_grants_end_not_before_grant CHECK (ended_at IS NULL OR ended_at >= granted_at)
);
CREATE INDEX relationship_capability_grants_relationship_idx ON public.relationship_capability_grants (relationship_id);
CREATE INDEX relationship_capability_grants_capability_idx ON public.relationship_capability_grants (capability_id);
CREATE INDEX relationship_capability_grants_assignment_idx ON public.relationship_capability_grants (assignment_id)
    WHERE assignment_id IS NOT NULL;
CREATE UNIQUE INDEX relationship_capability_grants_broad_open_uq
    ON public.relationship_capability_grants (relationship_id,capability_id)
    WHERE assignment_id IS NULL AND status IN ('active','suspended');
CREATE UNIQUE INDEX relationship_capability_grants_assignment_open_uq
    ON public.relationship_capability_grants (relationship_id,capability_id,assignment_id)
    WHERE assignment_id IS NOT NULL AND status IN ('active','suspended');

-- Runtime is evaluation-only at this foundation stage. Mutation will be exposed
-- later only through controlled server administration paths plus Master Register events.
GRANT SELECT ON TABLE
    public.master_account_authority,
    public.actor_relationships,
    public.relationship_assignments,
    public.capabilities,
    public.relationship_capability_grants
TO "tes-backend@tes-production-510007.iam";
