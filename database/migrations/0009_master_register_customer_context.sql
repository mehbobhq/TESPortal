-- TES Master Register canonical customer-context reconciliation
-- Migration: 0009
--
-- Master Register events identify four independent dimensions:
-- actor (who/what acted), customer (tenant/business context), resource
-- (the exact affected record), and subject references (who/what it concerns).
--
-- Earlier Phase-1 events used target.companyId. PostgreSQL's canonical tenant
-- identity is customers.id, so new events use target.customerId. The database
-- projects that value itself into customer_id and enforces the customers FK;
-- callers cannot provide a different relational customer_id than the JSON
-- event contract says.
--
-- Historical immutable events are not rewritten.

ALTER TABLE public.master_register_events
    RENAME COLUMN company_id TO legacy_company_id;

ALTER INDEX public.master_register_events_company_idx
    RENAME TO master_register_events_legacy_company_idx;

ALTER TABLE public.master_register_events
    ADD COLUMN customer_id uuid
    GENERATED ALWAYS AS ((target ->> 'customerId')::uuid) STORED;

ALTER TABLE public.master_register_events
    ADD CONSTRAINT master_register_events_customer_fk
    FOREIGN KEY (customer_id)
    REFERENCES public.customers(id)
    ON DELETE RESTRICT;

CREATE INDEX master_register_events_customer_idx
    ON public.master_register_events (customer_id, recorded_at DESC)
    WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.master_register_events.customer_id IS
    'Canonical TES tenant/customer context projected from target.customerId and constrained to customers.id.';

COMMENT ON COLUMN public.master_register_events.legacy_company_id IS
    'Legacy immutable Phase-1 projection from target.companyId. New events use target.customerId/customer_id.';

GRANT SELECT, INSERT ON TABLE public.master_register_events
TO "tes-backend@tes-production-510007.iam";

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.master_register_events
FROM "tes-backend@tes-production-510007.iam";
