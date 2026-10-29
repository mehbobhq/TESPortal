-- 0044: Driver onboarding - intended operation without state/province lists.
--
-- Add Driver no longer asks which states or provinces a driver will work in: the intended operation (Canada wide, Cross border, US wide, Canada
-- Intraprovince, US Intrastate, Not yet decided) selects the regulatory scope, and jurisdiction-specific details are handled by the application's
-- personalization rules. The shape constraint on driver_prospect_operating_scopes therefore must not DEMAND jurisdiction lists any more.
--
-- The constraint is only RELAXED: every row that satisfied the old shape satisfies the new one (earlier prospects keep their stored scope unchanged).
-- Mutually exclusive countries are still enforced (a US-only kind never carries Canadian jurisdictions and vice versa). No table, column, index,
-- policy or grant changes.

ALTER TABLE public.driver_prospect_operating_scopes DROP CONSTRAINT driver_prospect_operating_scopes_shape;
ALTER TABLE public.driver_prospect_operating_scopes ADD CONSTRAINT driver_prospect_operating_scopes_shape CHECK (
    CASE scope_kind
        WHEN 'US_INTRASTATE' THEN cardinality(us_jurisdictions) <= 1 AND cardinality(ca_jurisdictions) = 0 AND cardinality(components) = 0
        WHEN 'US_INTERSTATE' THEN cardinality(ca_jurisdictions) = 0 AND cardinality(components) = 0
        WHEN 'CA_INTRAPROVINCIAL' THEN cardinality(ca_jurisdictions) <= 1 AND cardinality(us_jurisdictions) = 0 AND cardinality(components) = 0
        WHEN 'CA_INTERPROVINCIAL' THEN cardinality(us_jurisdictions) = 0 AND cardinality(components) = 0
        WHEN 'CROSS_BORDER' THEN cardinality(components) = 0
        WHEN 'MIXED' THEN cardinality(components) >= 2
            AND components <@ ARRAY['US_INTRASTATE', 'US_INTERSTATE', 'CA_INTRAPROVINCIAL', 'CA_INTERPROVINCIAL', 'CROSS_BORDER']::text[]
            AND cardinality(us_jurisdictions) + cardinality(ca_jurisdictions) >= 1
        WHEN 'UNDETERMINED' THEN cardinality(us_jurisdictions) = 0 AND cardinality(ca_jurisdictions) = 0 AND cardinality(components) = 0
    END
);
