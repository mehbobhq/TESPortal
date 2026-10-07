-- TES tenant isolation foundation
-- Migration: 0004
--
-- Scope:
--   - establish the protected database namespace for tenant-security helpers
--   - expose the current transaction-local customer context safely to RLS
--   - grant the runtime identity only the minimum privilege required to evaluate
--     tenant context
--
-- This migration intentionally does NOT introduce:
--   - authentication or actor authorization
--   - tenant-owned operational tables
--   - RLS policies on global canonical organization/customer tables
--   - application roles, employee roles, teams, or capabilities
--   - Master Register
--
-- Contract:
--   - authorized server code establishes `tes.customer_id` transaction-locally
--     on the same checked-out PostgreSQL connection used for tenant queries
--   - missing, blank, or malformed tenant context resolves to NULL
--   - future tenant-owned RLS policies compare their customer_id against
--     tes_security.current_customer_id()
--   - NULL tenant context therefore matches no NOT NULL customer_id
--   - application authorization remains responsible for deciding whether an
--     authenticated actor is entitled to establish a particular customer scope


-- ============================================================
-- 1. Protected tenant-security namespace
-- ============================================================

CREATE SCHEMA tes_security
    AUTHORIZATION "tes-database-migrator@tes-production-510007.iam";

REVOKE ALL ON SCHEMA tes_security FROM PUBLIC;

GRANT USAGE ON SCHEMA tes_security
TO "tes-backend@tes-production-510007.iam";


-- ============================================================
-- 2. Current customer / tenant context
--
-- PostgreSQL custom settings are text values. This helper is the single
-- database contract future RLS policies use to resolve `tes.customer_id`.
--
-- Missing setting:
--     NULL
--
-- Blank setting:
--     NULL
--
-- Valid UUID:
--     UUID
--
-- Malformed value:
--     NULL
--
-- Returning NULL for every unusable state is deliberately fail-closed:
-- future tenant-owned customer_id columns are NOT NULL, so an absent or
-- invalid context cannot match a tenant row.
-- ============================================================

CREATE FUNCTION tes_security.current_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
    SELECT CASE
        WHEN btrim(current_setting('tes.customer_id', true))
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN btrim(current_setting('tes.customer_id', true))::uuid
        ELSE NULL
    END;
$$;


-- Function execution is never public.
REVOKE ALL
ON FUNCTION tes_security.current_customer_id()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION tes_security.current_customer_id()
TO "tes-backend@tes-production-510007.iam";


-- ============================================================
-- 3. Security contract for future tenant-owned tables
--
-- This section creates no business objects. It records the invariant that
-- subsequent migrations must implement.
--
-- Every tenant-owned root table must:
--
--   1. contain:
--
--        customer_id uuid NOT NULL
--            REFERENCES public.customers(id)
--            ON DELETE RESTRICT
--
--   2. ENABLE ROW LEVEL SECURITY
--
--   3. FORCE ROW LEVEL SECURITY
--
--   4. define explicit policies whose USING and WITH CHECK expressions bind
--      customer_id to:
--
--        tes_security.current_customer_id()
--
--   5. receive runtime privileges explicitly because migration 0002 removed
--      automatic runtime privileges
--
--   6. protect tenant-consistency across references where applicable, normally
--      through customer-scoped composite foreign keys rather than permitting a
--      row owned by one customer to reference another customer's resource
--
-- RLS is defense in depth. It does not replace application authorization,
-- action-level permissions, sensitive-access controls, or Master Register
-- accountability.
-- ============================================================
