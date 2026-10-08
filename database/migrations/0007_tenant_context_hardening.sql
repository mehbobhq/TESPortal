-- TES tenant context hardening
-- Migration: 0007
--
-- Scope:
--   - preserve the tenant-context contract established by migration 0004
--   - remove the unnecessary UUID version 1-5 restriction
--   - accept canonical RFC-variant UUIDs without coupling tenant isolation to a
--     particular UUID version
--
-- This migration intentionally does NOT:
--   - create tenant-owned business tables
--   - create RLS policies
--   - change authentication or authorization
--   - grant PostgreSQL BYPASSRLS
--   - modify runtime privileges beyond preserving the existing helper grant


-- ============================================================
-- 1. Harden current customer / tenant context
--
-- PostgreSQL custom settings remain text values.
--
-- Missing, blank, or malformed context resolves to NULL.
-- Canonical UUID text is accepted without restricting the UUID version nibble.
-- The RFC variant nibble remains constrained to 8, 9, a, or b.
--
-- This preserves the fail-closed contract established by migration 0004:
-- tenant-owned customer_id columns are NOT NULL, so unusable context cannot
-- match a tenant row.
-- ============================================================

CREATE OR REPLACE FUNCTION tes_security.current_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
    SELECT CASE
        WHEN btrim(current_setting('tes.customer_id', true))
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN btrim(current_setting('tes.customer_id', true))::uuid
        ELSE NULL
    END;
$$;


-- ============================================================
-- 2. Preserve protected execution boundary
-- ============================================================

REVOKE ALL
ON FUNCTION tes_security.current_customer_id()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION tes_security.current_customer_id()
TO "tes-backend@tes-production-510007.iam";
