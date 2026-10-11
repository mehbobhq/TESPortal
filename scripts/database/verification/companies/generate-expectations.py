#!/usr/bin/env python3
"""
Generates the production verification fragments for Companies foundation migrations 0016-0019.

The expected catalogue is NOT hand-written. It is produced by running, against a LOCAL disposable database migrated with the
repository's migrations, the very same catalogue queries the production verifier runs, and embedding the results. The
production verifier then compares production's catalogue to them EXACTLY. Which objects belong to which migration is derived
from the migration SQL text itself (CREATE TABLE / CREATE FUNCTION / INSERT INTO), so a migration cannot add an object this
generator does not notice.

Usage:  PGHOST=... PGPORT=... PGDATABASE=tes_prod PGUSER=<migrator> generate-expectations.py <migrations-dir> <output-dir>
The database must have every migration in <migrations-dir> applied.
"""
import re
import subprocess
import sys
from pathlib import Path

MIGRATIONS = {
    "0016": "0016_tax_registration_foundation.sql",
    "0017": "0017_insurance_foundation.sql",
    "0018": "0018_company_credentials_foundation.sql",
    "0019": "0019_company_operating_profile_foundation.sql",
}
RT = "tes-backend@tes-production-510007.iam"
MIGRATOR = "tes-database-migrator@tes-production-510007.iam"

mig_dir = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)


def run(sql):
    result = subprocess.run(
        ["psql", "--no-psqlrc", "--no-password", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(result.stderr)
    return [line for line in result.stdout.split("\n") if line != ""]


def strip_comments(text):
    return "\n".join(line for line in text.split("\n") if not line.lstrip().startswith("--"))


def objects(version):
    sql = strip_comments((mig_dir / MIGRATIONS[version]).read_text())
    tables = re.findall(r"^CREATE TABLE public\.([a-z_0-9]+)", sql, re.M)
    functions = re.findall(r"^CREATE FUNCTION tes_security\.([a-z_0-9]+)", sql, re.M)
    seeds = [t for t in dict.fromkeys(re.findall(r"^INSERT INTO public\.([a-z_0-9]+)", sql, re.M)) if t != "capabilities"]
    caps = re.findall(r"^\s+\(\s*\n\s+'([A-Z_]+)',", sql, re.M) if "INSERT INTO public.capabilities" in sql else []
    return {"tables": tables, "functions": functions, "seeds": seeds, "caps": caps}


OBJ = {v: objects(v) for v in MIGRATIONS}
ALL_TABLES_AFTER = {v: {t for w in MIGRATIONS if w > v for t in OBJ[w]["tables"]} for v in MIGRATIONS}
ALL_FUNCS_AFTER = {v: {t for w in MIGRATIONS if w > v for t in OBJ[w]["functions"]} for v in MIGRATIONS}


def q(s):
    return s.replace("'", "''")


def section(label, actual_sql, expected_lines, phase="post", through=None):
    expected = "\n".join(expected_lines)
    assert "$exp$" not in expected
    gate = f"  IF current_setting('tes.verify_phase') <> '{phase}' THEN RETURN; END IF;\n"
    if through:
        gate += f"  IF current_setting('tes.verify_through') <> '{through}' THEN RETURN; END IF;\n"
    return f"""
DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
{gate}
  SELECT string_agg(l, E'\\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp${expected}$exp$, E'\\n')) AS l
    EXCEPT
    SELECT l FROM ({actual_sql}) AS a(l)
  ) d;
  SELECT string_agg(l, E'\\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM ({actual_sql}) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp${expected}$exp$, E'\\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '{q(label)} differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK {q(label)} ({len(expected_lines)} entries) match the design exactly';
END
$verify$;
"""


def names(items):
    return ",".join(f"'{i}'" for i in items)


def regclasses(tables):
    return ",".join(f"'public.{t}'::regclass" for t in tables)


def q_columns(t):
    return (f"SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') "
            f"FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum "
            f"WHERE a.attrelid = 'public.{t}'::regclass AND a.attnum > 0 AND NOT a.attisdropped")


def q_constraints(tables):
    return (f"SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred "
            f"FROM pg_constraint WHERE contype <> 't' AND conrelid IN ({regclasses(tables)})")


def q_indexes(tables):
    return ("SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' "
            f"AND tablename IN ({names(tables)})")


def q_triggers(tables):
    return ("SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text "
            "|| ' args=' || replace(encode(tgargs, 'escape'), E'\\\\000', ',') "
            "|| ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred "
            f"FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ({regclasses(tables)})")


def q_functions(funcs):
    return ("SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text "
            "|| ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) "
            "|| ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') "
            f"|| ' runtime_execute=' || has_function_privilege('{RT}', p.oid, 'EXECUTE') "
            "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang "
            f"WHERE n.nspname = 'tes_security' AND p.proname IN ({names(funcs)})")


def q_table_acl(tables):
    return ("SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable "
            f"FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ({regclasses(tables)}) AND x.grantee <> c.relowner")


def q_col_acl(tables):
    return ("SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable "
            f"FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ({regclasses(tables)}) AND a.attacl IS NOT NULL AND NOT a.attisdropped")


def q_owner(tables):
    return ("SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity "
            f"FROM pg_class c WHERE c.oid IN ({regclasses(tables)})")


def seed_query(table):
    cols = [c for c in run(f"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='{table}' ORDER BY ordinal_position")
            if c not in ("created_at", "updated_at")]
    return "SELECT " + " || '|' || ".join(f"COALESCE({c}::text, '-')" for c in cols) + f" FROM public.{table}"


q_caps = "SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities"
q_relations = "SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')"
q_tesfn = "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security'"
q_secdef = "SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')"

INVARIANTS = {
"0016": """
  SELECT count(*) INTO bad FROM public.registrations r
   WHERE (SELECT count(*) FROM public.registration_versions v WHERE v.registration_id = r.id AND v.record_status = 'active' AND v.effective_to IS NULL) <> 1
      OR (SELECT count(*) FROM public.registration_status_periods p WHERE p.registration_id = r.id AND p.record_status = 'active' AND p.effective_to IS NULL) <> 1;
  IF bad <> 0 THEN RAISE EXCEPTION '% registration(s) do not have exactly one current version and one current status period', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.registration_versions WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY program_code, jurisdiction_country, jurisdiction_region, number_normalized HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% registration number(s) held by more than one current version in their namespace', bad; END IF;

  SELECT count(*) INTO bad FROM public.registration_versions v JOIN public.registration_programs k ON k.code = v.program_code
   WHERE NOT ((k.jurisdiction_scope = 'GLOBAL' AND v.jurisdiction_country IS NULL AND v.jurisdiction_region IS NULL)
      OR (k.jurisdiction_scope = 'NATIONAL' AND v.jurisdiction_country = k.issuer_country AND v.jurisdiction_region IS NULL)
      OR (k.jurisdiction_scope = 'COUNTRY_REGION' AND v.jurisdiction_country = k.issuer_country AND v.jurisdiction_region IS NOT NULL AND (k.fixed_region IS NULL OR v.jurisdiction_region = k.fixed_region))
      OR (k.jurisdiction_scope = 'BASE_JURISDICTION' AND v.jurisdiction_country IS NOT NULL AND v.jurisdiction_region IS NOT NULL AND (k.issuer_country IS NULL OR v.jurisdiction_country = k.issuer_country)));
  IF bad <> 0 THEN RAISE EXCEPTION '% registration version(s) violate their program''s jurisdiction rules', bad; END IF;

  SELECT count(*) INTO bad FROM public.registration_versions a JOIN public.registration_versions b
    ON a.registration_id = b.registration_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping registration versions', bad; END IF;

  SELECT count(*) INTO bad FROM public.registration_status_periods a JOIN public.registration_status_periods b
    ON a.registration_id = b.registration_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping registration status periods', bad; END IF;
""",
"0017": """
  SELECT count(*) INTO bad FROM public.insurance_policies p
   WHERE NOT EXISTS (SELECT 1 FROM public.insurance_policy_terms t WHERE t.policy_id = p.id AND t.record_status = 'active');
  IF bad <> 0 THEN RAISE EXCEPTION '% insurance policy(ies) have no active term', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_policy_terms t
   WHERE t.record_status = 'active' AND NOT EXISTS (SELECT 1 FROM public.insurance_coverages c WHERE c.term_id = t.id AND c.record_status = 'active');
  IF bad <> 0 THEN RAISE EXCEPTION '% active insurance term(s) have no coverage', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_policy_terms a JOIN public.insurance_policy_terms b
    ON a.policy_id = b.policy_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND daterange(a.term_start, a.term_end, '[)') && daterange(b.term_start, b.term_end, '[)');
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping terms of one policy', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_policy_terms a JOIN public.insurance_policy_terms b
    ON a.insurer_organization_id = b.insurer_organization_id AND a.number_normalized = b.number_normalized
   AND a.policy_id < b.policy_id AND a.record_status = 'active' AND b.record_status = 'active';
  IF bad <> 0 THEN RAISE EXCEPTION '% policy number(s) held by more than one policy of the same insurer', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverages c JOIN public.insurance_policy_terms t ON t.id = c.term_id
   WHERE c.record_status = 'active' AND t.record_status = 'active'
     AND (c.effective_from < t.term_start OR (t.term_end IS NOT NULL AND c.effective_from >= t.term_end)
          OR (c.effective_to IS NOT NULL AND t.term_end IS NOT NULL AND c.effective_to > t.term_end));
  IF bad <> 0 THEN RAISE EXCEPTION '% coverage row(s) fall outside their term', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverages a JOIN public.insurance_coverages b
    ON a.term_id = b.term_id AND a.coverage_type = b.coverage_type AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)');
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping coverage rows of one type', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverages c JOIN public.insurance_coverage_types k ON k.code = c.coverage_type
   WHERE k.limit_required <> (c.limit_amount IS NOT NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% coverage row(s) violate their type''s limit rule', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_broker_periods a JOIN public.insurance_broker_periods b
    ON a.policy_id = b.policy_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping broker periods', bad; END IF;
""",
"0018": """
  SELECT count(*) INTO bad FROM public.company_credentials c
   WHERE (SELECT count(*) FROM public.credential_status_periods p WHERE p.credential_id = c.id AND p.record_status = 'active' AND p.effective_to IS NULL) <> 1;
  IF bad <> 0 THEN RAISE EXCEPTION '% credential(s) do not have exactly one current status period', bad; END IF;

  SELECT count(*) INTO bad FROM public.credential_status_periods a JOIN public.credential_status_periods b
    ON a.credential_id = b.credential_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping credential status periods', bad; END IF;

  SELECT count(*) INTO bad FROM public.credential_system_aliases a JOIN public.credential_systems s
    ON s.display_name_normalized = a.alias_normalized AND s.id <> a.system_id WHERE a.record_status = 'active';
  IF bad <> 0 THEN RAISE EXCEPTION '% alias(es) equal another system''s canonical name', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.company_credentials WHERE record_status = 'active'
    GROUP BY organization_id, system_id, username_normalized HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% duplicate active credential account(s)', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.credential_secret_slots WHERE secret_state <> 'RETIRED' AND slot_kind IN ('PASSWORD','MFA_SECRET')
    GROUP BY credential_id, slot_kind HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% credential(s) with more than one live PASSWORD / MFA_SECRET slot', bad; END IF;

  SELECT count(*) INTO bad FROM public.credential_secret_slots
   WHERE (secret_state = 'UNRESOLVED' AND secret_reference IS NOT NULL) OR (secret_state = 'STORED' AND secret_reference IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% secret slot(s) whose state and reference disagree', bad; END IF;
""",
"0019": """
  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.company_operating_scope_periods WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY organization_id HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization(s) with more than one current operating scope', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.company_rule_applicability_periods WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY organization_id, rule_code HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% rule assertion(s) with more than one current period', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.company_driver_requirement_periods WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY organization_id HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization(s) with more than one current driver requirement', bad; END IF;

  SELECT count(*) INTO bad FROM public.company_rule_applicability_periods a JOIN public.company_rule_applicability_periods b
    ON a.organization_id = b.organization_id AND a.rule_code = b.rule_code AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping rule applicability periods', bad; END IF;

  SELECT count(*) INTO bad FROM public.company_profile_rules r
   WHERE r.registration_program_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.registration_programs p WHERE p.code = r.registration_program_code);
  IF bad <> 0 THEN RAISE EXCEPTION '% rule(s) point at a missing registration program', bad; END IF;
""",
}


def fragment(version):
    o = OBJ[version]
    tables, funcs, seeds, caps = o["tables"], o["functions"], o["seeds"], o["caps"]
    business = [t for t in tables if t not in seeds]
    name = MIGRATIONS[version]
    parts = []

    def add(text):
        parts.append(text)

    add(f"""
-- ============================================================================================================
-- Migration {version} ({name})
-- ============================================================================================================
""")
    # pre phase: nothing of this migration exists
    add(f"""
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public' AND c.relname IN ({names(tables)})) THEN
    RAISE EXCEPTION 'a {version} table already exists before {version}';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security' AND p.proname IN ({names(funcs)})) THEN
    RAISE EXCEPTION 'a {version} trigger function already exists before {version}';
  END IF;
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ({names(caps)})) THEN
    RAISE EXCEPTION 'a {version} capability already exists before {version}';
  END IF;
  RAISE NOTICE 'OK no {version} table, function or capability exists before {version}';
END
$verify$;
""")
    # post phase: ledger row
    add(f"""
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '{version}' AND filename = '{name}') THEN
    RAISE EXCEPTION 'ledger has no {version} entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records {name}';
END
$verify$;
""")
    # cumulative sections, evaluated only when this is the highest migration being verified
    later_tables = ALL_TABLES_AFTER[version]
    rel_expected = [l for l in run(q_relations) if l not in later_tables]
    add(section(f"public relations through {version}", q_relations + (f" AND c.relname NOT IN ({names(sorted(later_tables))})" if later_tables else ""), rel_expected, through=version))
    cap_rows = run(q_caps + " ORDER BY sort_order")
    later_caps = {c for w in MIGRATIONS if w > version for c in OBJ[w]["caps"]}
    cap_expected = [l for l in cap_rows if l.split("|")[0] not in later_caps]
    add(section(f"capability catalogue through {version} (full rows)", q_caps + (f" WHERE code NOT IN ({names(sorted(later_caps))})" if later_caps else ""), cap_expected, through=version))
    later_funcs = ALL_FUNCS_AFTER[version]
    fn_expected = [l for l in run(q_tesfn) if l not in later_funcs]
    add(section(f"tes_security function set through {version}", q_tesfn + (f" AND p.proname NOT IN ({names(sorted(later_funcs))})" if later_funcs else ""), fn_expected, through=version))
    add(section("SECURITY DEFINER function set (nothing in the Companies foundation is SECURITY DEFINER)", q_secdef, run(q_secdef), through=version))
    # exact structure of this migration's objects
    for t in tables:
        add(section(f"{t} columns (name, data type, nullability, default)", q_columns(t), run(q_columns(t))))
    add(section(f"{version} constraints (definition, deferrability)", q_constraints(tables), run(q_constraints(tables))))
    add(section(f"{version} indexes (exact definitions)", q_indexes(tables), run(q_indexes(tables))))
    add(section(f"{version} triggers (enabled flag, type, function, arguments, deferral)", q_triggers(tables), run(q_triggers(tables))))
    add(section(f"{version} trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute)", q_functions(funcs), run(q_functions(funcs))))
    add(section(f"{version} table ownership and RLS flags", q_owner(tables), run(q_owner(tables))))
    add(section(f"{version} table ACL (every non-owner grantee)", q_table_acl(tables), run(q_table_acl(tables))))
    add(section(f"{version} column ACL (every column-specific grant)", q_col_acl(tables), run(q_col_acl(tables))))
    for t in seeds:
        sq = seed_query(t)
        add(section(f"{t} seed rows", sq, run(sq)))
    # runtime privileges beyond the exact ACLs
    add(f"""
DO $verify$
DECLARE
  runtime_role constant text := '{RT}';
  migrator_role constant text := '{MIGRATOR}';
  tbl text;
  priv text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  FOREACH tbl IN ARRAY ARRAY[{names(tables)}] LOOP
    IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = ('public.' || tbl)::regclass)) <> migrator_role THEN
      RAISE EXCEPTION '% is not owned by the migration identity', tbl;
    END IF;
    IF NOT has_table_privilege(runtime_role, 'public.' || tbl, 'SELECT') THEN
      RAISE EXCEPTION 'runtime lacks SELECT on %', tbl;
    END IF;
    FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(runtime_role, 'public.' || tbl, priv) THEN
        RAISE EXCEPTION 'runtime has table-level % on % (grants must be column-specific, and never DELETE / TRUNCATE)', priv, tbl;
      END IF;
    END LOOP;
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('public', 'public.' || tbl, priv) THEN
        RAISE EXCEPTION 'PUBLIC has % on %', priv, tbl;
      END IF;
    END LOOP;
  END LOOP;

  IF {"EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN (" + regclasses(seeds) + ") AND a.attnum > 0 AND NOT a.attisdropped AND (has_column_privilege(runtime_role, a.attrelid, a.attnum, 'INSERT') OR has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE')))" if seeds else "false"} THEN
    RAISE EXCEPTION 'runtime can write a {version} catalogue (changed only by migrations)';
  END IF;
  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ({regclasses(tables)}) AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ({regclasses(tables)})) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a {version} table (not part of the approved design)';
  END IF;

  RAISE NOTICE 'OK {version} runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege; no RLS / policy';
END
$verify$;
""")
    # row conditions
    biz_counts = " OR ".join(f"(SELECT count(*) FROM public.{t}) <> 0" for t in business)
    cap_list = names(caps)
    add(f"""
DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF {biz_counts} THEN
      RAISE EXCEPTION 'a {version} business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id
               WHERE c.code IN ({cap_list})) THEN
      RAISE EXCEPTION 'a {version} capability is granted to someone ({version} grants nothing; set TES_VERIFY_EXPECT_EMPTY=0 once grants are made deliberately)';
    END IF;
  END IF;
{INVARIANTS[version]}
  RAISE NOTICE 'OK {version} row conditions hold ({", ".join(business)} counted separately in the ROWCOUNT lines)';
END
$verify$;
""")
    return "".join(parts)


for version in MIGRATIONS:
    (out_dir / f"{version}.sql").write_text(fragment(version))
    print(version, (out_dir / f"{version}.sql").stat().st_size)

all_new_tables = [t for v in MIGRATIONS for t in OBJ[v]["tables"]]
(out_dir / "baseline.sql").write_text(f"""
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
    IF tbl IN ({names(all_new_tables)}) THEN
      RAISE EXCEPTION 'baseline list names a Companies foundation (0016-0019) table: %', tbl;
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
""")
