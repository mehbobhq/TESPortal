\set ON_ERROR_STOP on
-- Row level security matrix for migration 0031 (Contracts foundation). Runs as the RUNTIME role; all rows roll back.
BEGIN;

INSERT INTO public.actors(actor_type,status) VALUES ('HUMAN','active') RETURNING id \gset actor_
INSERT INTO public.actor_relationships(actor_id,relationship_type,status) VALUES (:'actor_id','TES_STAFF','active') RETURNING id \gset rel_
INSERT INTO public.relationship_assignments(relationship_id,scope_type,status) VALUES (:'rel_id','SYSTEM','active') RETURNING id \gset sra_
INSERT INTO public.relationship_capability_grants(relationship_id,capability_id,assignment_id,status)
SELECT :'rel_id',id,:'sra_id','active' FROM public.capabilities WHERE code IN ('CONTRACT_READ','CONTRACT_MANAGE','VEHICLE_READ');

INSERT INTO public.contract_package_definitions(package_code,package_name,pricing_basis) VALUES ('RLS_PACKAGE','RLS package','monthly_package');

SET LOCAL ROLE "tes-backend@tes-production-510007.iam";

-- No context: nothing is visible and nothing can be written.
SELECT (SELECT count(*) FROM public.contract_package_definitions) = 0
   AND (SELECT count(*) FROM public.contract_evidence_rules) = 0
   AND (SELECT count(*) FROM public.customer_contract_line_pricing) = 0
   AND (SELECT count(*) FROM public.customer_contract_responsibility_matrix) = 0
   AND (SELECT count(*) FROM public.customer_contract_evidence_requirements) = 0
   AND (SELECT count(*) FROM public.customer_contract_status_events) = 0
   AND (SELECT count(*) FROM public.customer_authority_change_events) = 0 AS ok \gset
\if :ok
\else
  \echo 'contracts data visible without context'
  SELECT 1/0;
\endif

-- A SYSTEM capability that is not CONTRACT_* sees nothing.
SELECT set_config('tes.system_actor_id',:'actor_id',true);
SELECT set_config('tes.system_capability','VEHICLE_READ',true);
SELECT (SELECT count(*) FROM public.contract_package_definitions) = 0 AND (SELECT count(*) FROM public.contract_evidence_rules) = 0 AS ok \gset
\if :ok
\else
  \echo 'VEHICLE_READ crossed the contracts boundary'
  SELECT 1/0;
\endif

-- A CUSTOMER context never sees contracts data, even with a forged tenant id.
SELECT set_config('tes.system_actor_id','',true);
SELECT set_config('tes.system_capability','',true);
SELECT set_config('tes.customer_actor_id',:'actor_id',true);
SELECT set_config('tes.customer_capability','ORGANIZATION_READ',true);
SELECT (SELECT count(*) FROM public.contract_package_definitions) = 0 AND (SELECT count(*) FROM public.contract_evidence_rules) = 0 AS ok \gset
\if :ok
\else
  \echo 'customer context saw contracts data'
  SELECT 1/0;
\endif
SELECT set_config('tes.customer_actor_id','',true);
SELECT set_config('tes.customer_capability','',true);

-- CONTRACT_READ reads the package catalogue and the six seeded evidence rules, and writes nothing.
SELECT set_config('tes.system_actor_id',:'actor_id',true);
SELECT set_config('tes.system_capability','CONTRACT_READ',true);
SELECT (SELECT count(*) FROM public.contract_package_definitions WHERE package_code='RLS_PACKAGE') = 1
   AND (SELECT count(*) FROM public.contract_evidence_rules WHERE rule_status='active') = 6 AS ok \gset
\if :ok
\else
  \echo 'CONTRACT_READ cannot read the contracts catalogue'
  SELECT 1/0;
\endif

DO $$
BEGIN
  BEGIN
    INSERT INTO public.contract_package_definitions(package_code,package_name,pricing_basis) VALUES ('RLS_DENIED','denied','monthly_package');
    RAISE EXCEPTION 'CONTRACT_READ inserted a package';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.contract_package_definitions SET package_name = 'tampered' WHERE package_code = 'RLS_PACKAGE';
    IF FOUND THEN RAISE EXCEPTION 'CONTRACT_READ updated a package'; END IF;
  END;
END
$$;

-- The runtime role can never delete or truncate, with or without a capability.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract_package_definitions','contract_evidence_rules','customer_contract_line_pricing','customer_contract_responsibility_matrix',
                           'customer_contract_evidence_requirements','customer_contract_status_events','customer_authority_change_events'] LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I', t);
      RAISE EXCEPTION 'DELETE succeeded on %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('TRUNCATE public.%I', t);
      RAISE EXCEPTION 'TRUNCATE succeeded on %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  -- ledgers and the rule catalogue are not updatable by the runtime role at all
  FOREACH t IN ARRAY ARRAY['contract_evidence_rules','customer_contract_status_events','customer_authority_change_events'] LOOP
    BEGIN
      EXECUTE format('UPDATE public.%I SET created_at = created_at', t);
      RAISE EXCEPTION 'UPDATE succeeded on append-only %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END
$$;

-- CONTRACT_MANAGE may write the package catalogue.
SELECT set_config('tes.system_capability','CONTRACT_MANAGE',true);
INSERT INTO public.contract_package_definitions(package_code,package_name,pricing_basis) VALUES ('RLS_MANAGED','managed','one_time_service');
SELECT (SELECT count(*) FROM public.contract_package_definitions WHERE package_code IN ('RLS_PACKAGE','RLS_MANAGED')) = 2 AS ok \gset
\if :ok
\else
  \echo 'CONTRACT_MANAGE could not manage packages'
  SELECT 1/0;
\endif

RESET ROLE;
ROLLBACK;
\echo 'Contracts foundation RLS matrix passed.'
