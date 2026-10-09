-- TES legacy company identity continuity foundation
-- Migration: 0010
--
-- Scope:
--   - public.legacy_record_map: permanent, source-scoped resolution of a
--     legacy (browser-prototype) company identity to a canonical organization
--   - public.legacy_record_snapshots: lossless, immutable record of the legacy
--     company record as it was imported, for staged migration and reconciliation
--   - tes_security.resolve_legacy_company(): the ONLY runtime read path to the map
--   - immutability, privilege and indexing controls for all of the above
--
-- Contract:
--   - A legacy ID such as CMP-12345 was only locally unique inside the browser
--     environment that generated it. It is NOT a real-world organization
--     identifier and is NOT a canonical TES identity. Canonical identity remains
--     UUID based:
--
--         legacy company ID -> legacy_record_map -> organizations.id
--                                                       -> customers.id (where applicable,
--                                                          resolved through customers.organization_id)
--
--   - Uniqueness of an ACTIVE mapping is scoped by
--         (source_system, source_namespace, legacy_entity_type, legacy_id)
--     so identical legacy IDs originating from different source datasets never
--     collide or merge. Whether two organizations are the same organization is
--     decided only through canonical organization merge mechanisms, never here.
--   - Mapping rows record a RESOLVED outcome only. Unresolved collisions and
--     duplicate candidates are handled by the controlled import/reconciliation
--     workflow and do not become mapping rows until a human decision exists.
--   - A mapping row is immutable. The single permitted change is the one-way
--     lifecycle transition active -> superseded (recording superseded_at), so a
--     mistaken mapping can be replaced by a new row while history stays
--     preserved. No row can be deleted or truncated.
--   - Snapshots are immutable and are migration/reconciliation evidence only.
--     They are NOT a production source of truth and must never be an application
--     fallback. The application runtime has no access to them.
--   - These are migration/control structures, not tenant-owned business tables.
--     A legacy ID must be resolvable BEFORE a canonical customer context exists,
--     so customer_id = tes_security.current_customer_id() row level security
--     does not apply.
--
-- Runtime access model:
--   - The runtime identity has NO privilege on either table.
--   - The runtime may only call tes_security.resolve_legacy_company(), an exact
--     key lookup (source_system, source_namespace, legacy_id) that returns the
--     canonical organization_id and customer_id of the ACTIVE mapping, or no row.
--     It cannot list, search, count or enumerate the map. Global canonical
--     organization identity is not global tenant visibility.
--   - The function is the first SECURITY DEFINER function in the TES schema, so
--     it is deliberately minimal: a single read-only SQL statement, no dynamic
--     SQL, STABLE (cannot write), STRICT, fixed search_path with pg_temp last,
--     every relation schema-qualified, EXECUTE revoked from PUBLIC.
--   - Its output is a REQUESTED SCOPE, never proof of access. Callers must still
--     authorize the resolved customer (for example through withAuthorizedCustomer)
--     before any tenant context is established. The function sets no context and
--     performs no authorization.
--
-- This migration intentionally does NOT:
--   - import any data, create any organization/customer, or define any source namespace
--   - store legacy IDs in organization_identifiers
--   - migrate authority, customs, tax or operating-account identifiers
--   - model prospects, customer lifecycle, operational area or contact data
--   - change classification vocabulary
--   - add capabilities, a compatibility projection, or any application behavior
--   - touch Google Cloud Storage objects


-- ============================================================
-- 1. Legacy record map
-- ============================================================

CREATE TABLE public.legacy_record_map (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    source_system text NOT NULL,
    source_namespace text NOT NULL,
    legacy_entity_type text NOT NULL,
    legacy_id text NOT NULL,

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    mapping_status text NOT NULL DEFAULT 'active',
    superseded_at timestamptz,

    import_batch_id uuid NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT legacy_record_map_source_system_valid
        CHECK (source_system ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

    CONSTRAINT legacy_record_map_source_namespace_valid
        CHECK (
            btrim(source_namespace) <> ''
            AND source_namespace = btrim(source_namespace)
            AND char_length(source_namespace) <= 200
            AND source_namespace !~ '[\x01-\x1F\x7F]'
        ),

    CONSTRAINT legacy_record_map_entity_type_valid
        CHECK (legacy_entity_type IN ('COMPANY')),

    CONSTRAINT legacy_record_map_legacy_id_valid
        CHECK (legacy_id ~ '^[A-Za-z0-9_-]{1,128}$'),

    CONSTRAINT legacy_record_map_mapping_status_valid
        CHECK (mapping_status IN ('active', 'superseded')),

    CONSTRAINT legacy_record_map_supersede_state_consistent
        CHECK (
            (mapping_status = 'active' AND superseded_at IS NULL)
            OR
            (mapping_status = 'superseded' AND superseded_at IS NOT NULL)
        ),

    CONSTRAINT legacy_record_map_supersede_not_before_import
        CHECK (superseded_at IS NULL OR superseded_at >= imported_at)
);

-- At most one active mapping per legacy identity within one source dataset.
-- Identical legacy IDs from different source_system/source_namespace values do
-- not conflict. This index also serves the exact-key resolver lookup.
CREATE UNIQUE INDEX legacy_record_map_active_source_key_uq
    ON public.legacy_record_map (
        source_system,
        source_namespace,
        legacy_entity_type,
        legacy_id
    )
    WHERE mapping_status = 'active';

-- Owner-side search by legacy ID across all sources and statuses (reconciliation
-- and historical lookup). Not reachable by the runtime identity.
CREATE INDEX legacy_record_map_legacy_lookup_idx
    ON public.legacy_record_map (legacy_entity_type, legacy_id);

-- Reverse lookup, and supports the RESTRICT foreign key check.
CREATE INDEX legacy_record_map_organization_idx
    ON public.legacy_record_map (organization_id);


-- ============================================================
-- 2. Legacy record snapshots
-- ============================================================

CREATE TABLE public.legacy_record_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    legacy_record_map_id uuid NOT NULL
        REFERENCES public.legacy_record_map(id)
        ON DELETE RESTRICT,

    -- Lowercase hex SHA-256 of the snapshot, computed by the import workflow
    -- over the stored snapshot::text value. It is not recomputed by a table
    -- constraint (see the verification plan for the recomputation check).
    source_sha256 text NOT NULL,

    snapshot jsonb NOT NULL,

    import_batch_id uuid NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT legacy_record_snapshots_sha256_valid
        CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),

    CONSTRAINT legacy_record_snapshots_snapshot_is_object
        CHECK (jsonb_typeof(snapshot) = 'object' AND snapshot <> '{}'::jsonb),

    -- Re-importing byte-identical content for the same mapping is idempotent;
    -- changed content becomes an additional snapshot version.
    CONSTRAINT legacy_record_snapshots_map_content_uq
        UNIQUE (legacy_record_map_id, source_sha256)
);


-- ============================================================
-- 3. Immutability enforcement
--
-- Enforced in the database so it does not depend on application code and
-- applies to the table owner as well. Truncation is blocked by statement-level
-- triggers (including TRUNCATE ... CASCADE reaching these tables).
-- ============================================================

CREATE FUNCTION tes_security.prevent_legacy_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Legacy record continuity data is immutable (% on %.%)',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- The only permitted change to a map row: active -> superseded with
-- superseded_at set, every other column unchanged.
CREATE FUNCTION tes_security.guard_legacy_record_map_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.mapping_status = 'active'
       AND NEW.mapping_status = 'superseded'
       AND NEW.superseded_at IS NOT NULL
       AND NEW.id = OLD.id
       AND NEW.source_system = OLD.source_system
       AND NEW.source_namespace = OLD.source_namespace
       AND NEW.legacy_entity_type = OLD.legacy_entity_type
       AND NEW.legacy_id = OLD.legacy_id
       AND NEW.organization_id = OLD.organization_id
       AND NEW.import_batch_id = OLD.import_batch_id
       AND NEW.imported_at = OLD.imported_at
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Legacy record map rows are immutable except the one-way active to superseded transition'
        USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_legacy_record_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_legacy_record_map_update() FROM PUBLIC;

CREATE TRIGGER legacy_record_map_guard_update
BEFORE UPDATE ON public.legacy_record_map
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_legacy_record_map_update();

CREATE TRIGGER legacy_record_map_no_delete
BEFORE DELETE ON public.legacy_record_map
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_legacy_record_mutation();

CREATE TRIGGER legacy_record_map_no_truncate
BEFORE TRUNCATE ON public.legacy_record_map
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_legacy_record_mutation();

CREATE TRIGGER legacy_record_snapshots_no_update_delete
BEFORE UPDATE OR DELETE ON public.legacy_record_snapshots
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_legacy_record_mutation();

CREATE TRIGGER legacy_record_snapshots_no_truncate
BEFORE TRUNCATE ON public.legacy_record_snapshots
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_legacy_record_mutation();


-- ============================================================
-- 4. Runtime resolver (the only runtime read path)
--
-- Exact-key lookup of the ACTIVE mapping. All three key parts are required
-- (STRICT: any NULL argument returns no row). There is intentionally no
-- "bare" lookup by legacy_id alone: a legacy ID is only meaningful within the
-- source dataset that generated it, so a bare match could silently resolve to
-- another source's organization. Owner-side reconciliation uses the lookup
-- index above.
--
-- Returns no row (never an error) for an unknown key, a wrong source scope, or
-- a superseded-only mapping, so these cases are indistinguishable to a caller.
--
-- SECURITY DEFINER hardening:
--   - single read-only SQL statement, no dynamic SQL, STABLE
--   - search_path fixed to pg_catalog, pg_temp (pg_temp last) and every relation
--     schema-qualified, so a caller cannot shadow tables with temp objects
--   - EXECUTE revoked from PUBLIC, granted only to the runtime identity
--   - returns only canonical identifiers, never provenance
-- ============================================================

CREATE FUNCTION tes_security.resolve_legacy_company(
    p_source_system text,
    p_source_namespace text,
    p_legacy_id text
)
RETURNS TABLE (
    resolved_organization_id uuid,
    resolved_customer_id uuid
)
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT m.organization_id, c.id
      FROM public.legacy_record_map AS m
      LEFT JOIN public.customers AS c
        ON c.organization_id = m.organization_id
     WHERE m.source_system = p_source_system
       AND m.source_namespace = p_source_namespace
       AND m.legacy_entity_type = 'COMPANY'
       AND m.legacy_id = p_legacy_id
       AND m.mapping_status = 'active'
$$;

REVOKE ALL
ON FUNCTION tes_security.resolve_legacy_company(text, text, text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION tes_security.resolve_legacy_company(text, text, text)
TO "tes-backend@tes-production-510007.iam";


-- ============================================================
-- 5. Table privileges
--
-- Migration 0002 removed automatic runtime privileges, so a newly created table
-- grants the runtime identity nothing. The REVOKEs below are explicit
-- documentation of intent and a guard against any future blanket grant.
--
-- Migration/import writes are performed by the table owner (the migration
-- identity), which needs no grant. The runtime identity has no privilege of any
-- kind on either table; legacy resolution goes only through the function above.
-- ============================================================

REVOKE ALL
ON TABLE
    public.legacy_record_map,
    public.legacy_record_snapshots
FROM PUBLIC;

REVOKE ALL
ON TABLE
    public.legacy_record_map,
    public.legacy_record_snapshots
FROM "tes-backend@tes-production-510007.iam";


-- ============================================================
-- 6. Documentation
-- ============================================================

COMMENT ON TABLE public.legacy_record_map IS
    'Source-scoped resolution of legacy (browser prototype) company IDs to canonical organizations. Migration/control data: not tenant-owned, no customer RLS, no runtime table privileges (runtime resolves only through tes_security.resolve_legacy_company). Rows are immutable except the one-way active to superseded transition. Legacy IDs are never canonical identities and never organization identifiers.';

COMMENT ON COLUMN public.legacy_record_map.source_namespace IS
    'Provenance of the source dataset (for example a specific browser/profile export). A legacy ID is only unique within one source dataset.';

COMMENT ON COLUMN public.legacy_record_map.mapping_status IS
    'active: current mapping. superseded: replaced by a corrected mapping; retained for history and owner-side reconciliation.';

COMMENT ON TABLE public.legacy_record_snapshots IS
    'Immutable lossless copy of an imported legacy company record, for staged migration and reconciliation only. Not a production source of truth and never an application fallback. The runtime identity has no access.';

COMMENT ON COLUMN public.legacy_record_snapshots.source_sha256 IS
    'Lowercase hex SHA-256 of snapshot::text computed by the import workflow; verified by the verification plan, not by a table constraint.';

COMMENT ON FUNCTION tes_security.resolve_legacy_company(text, text, text) IS
    'Exact-key lookup of the active legacy company mapping. Returns canonical organization/customer identifiers only. The result is a requested scope, not proof of access: callers must authorize the resolved customer before establishing tenant context.';
