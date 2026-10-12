
-- ============================================================
-- Post phase: baseline data unchanged (optional, from the PRE run's ROWCOUNT lines)
-- ============================================================
DO $verify$
DECLARE
  pair text;
  tbl text;
  expected bigint;
  actual bigint;
  checked integer := 0;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' OR current_setting('tes.verify_baseline') = '' THEN RETURN; END IF;

  FOREACH pair IN ARRAY string_to_array(current_setting('tes.verify_baseline'), ',') LOOP
    tbl := split_part(pair, '=', 1);
    expected := split_part(pair, '=', 2)::bigint;
    IF tbl IN ('registration_programs','registrations','registration_versions','registration_status_periods','insurance_coverage_types','insurance_policies','insurance_policy_terms','insurance_endorsements','insurance_coverages','insurance_broker_periods','credential_categories','credential_systems','credential_system_aliases','company_credentials','credential_status_periods','credential_verifications','credential_secret_slots','company_profile_rules','company_operating_scope_periods','company_rule_applicability_periods','company_driver_requirement_periods','insurance_coverage_vehicles','vehicle_merges') THEN
      RAISE EXCEPTION 'baseline list names a generator-verified foundation table (0016-0019, 0025-0028): %', tbl;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO actual;
    IF actual <> expected THEN
      RAISE EXCEPTION 'baseline row count changed for %: expected %, found %', tbl, expected, actual;
    END IF;
    checked := checked + 1;
  END LOOP;
  RAISE NOTICE 'OK baseline row counts unchanged for % table(s)', checked;
END
$verify$;
