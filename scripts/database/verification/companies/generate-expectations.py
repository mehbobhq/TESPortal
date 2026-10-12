#!/usr/bin/env python3
"""
Generates the production verification fragments for the Companies foundation migrations 0016-0019 and the Core Operational
Identity additions 0025 (insurance scheduled vehicles), 0026 (vehicle merge ledger) and 0027 (organization access policies).

0027 is POLICY-ONLY: it creates no table, function, trigger, capability or seed row and only ALTERs the USING expression of
existing policies. Its fragment therefore has no table sections; it verifies the exact policy sets of the tables whose policies
it alters. The PRE phase compares them with the pre-0027 (0024) definitions, the POST phase with the post-0027 definitions.
The pre-0027 expressions are produced by running the very same catalogue query on a database migrated only through 0026
(PRE_PGPORT, same host / database / user as the main connection); the post-0027 ones on the fully migrated database.

Migrations 0020-0024 (Core Operational Identity and the system-wide RLS closure) are verified by their own scripts and get no
fragment here. Their tables, tes_security functions and capabilities are still parsed from the migration SQL so they are known
"external later objects": the cumulative exact-set sections of 0016-0019 exclude them (the 0016-0019 slice still verifies on a
pre-0020 database) while a through=0025 / through=0026 run verifies the full current catalogue.

The expected catalogue is NOT hand-written. It is produced by running, against a LOCAL disposable database migrated with the
repository's migrations, the very same catalogue queries the production verifier runs, and embedding the results. The
production verifier then compares production's catalogue to them EXACTLY. Which objects belong to which migration is derived
from the migration SQL text itself (CREATE TABLE / CREATE FUNCTION / INSERT INTO), so a migration cannot add an object this
generator does not notice.

Usage:  PGHOST=... PGPORT=... PGDATABASE=tes_prod PGUSER=<migrator> PRE_PGPORT=<port of a database migrated through 0026 only> \
          generate-expectations.py <migrations-dir> <output-dir>
The main database must have every migration in <migrations-dir> applied.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

MIGRATIONS = {
    "0016": "0016_tax_registration_foundation.sql",
    "0017": "0017_insurance_foundation.sql",
    "0018": "0018_company_credentials_foundation.sql",
    "0019": "0019_company_operating_profile_foundation.sql",
    "0025": "0025_insurance_scheduled_vehicles_foundation.sql",
    "0026": "0026_vehicle_merge_ledger.sql",
    "0027": "0027_operational_identity_organization_access_policies.sql",
}
POLICY_ONLY = ("0027",)
RT = "tes-backend@tes-production-510007.iam"
MIGRATOR = "tes-database-migrator@tes-production-510007.iam"

mig_dir = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)


def run(sql, port=None):
    env = dict(os.environ)
    if port:
        env["PGPORT"] = port
    result = subprocess.run(
        ["psql", "--no-psqlrc", "--no-password", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise SystemExit(result.stderr)
    return [line for line in result.stdout.split("\n") if line != ""]


def strip_comments(text):
    return "\n".join(line for line in text.split("\n") if not line.lstrip().startswith("--"))


ALL_FILES = {p.name.split("_")[0]: p.name for p in sorted(mig_dir.glob("[0-9][0-9][0-9][0-9]_*.sql"))}
for _v, _f in MIGRATIONS.items():
    assert ALL_FILES.get(_v) == _f, f"migration {_v} ({_f}) not found in {mig_dir}"
FUNC_RE = re.compile(r"^CREATE (?:OR REPLACE )?FUNCTION ([a-z_0-9]+)\.([a-z_0-9]+)", re.M)

# first migration that creates each schema.function (CREATE OR REPLACE in a later migration does not make it "later")
FIRST_FUNC_VERSION = {}
for _v in sorted(ALL_FILES):
    for _schema, _name in FUNC_RE.findall(strip_comments((mig_dir / ALL_FILES[_v]).read_text())):
        FIRST_FUNC_VERSION.setdefault(f"{_schema}.{_name}", _v)


def objects(version):
    sql = strip_comments((mig_dir / ALL_FILES[version]).read_text())
    tables = re.findall(r"^CREATE TABLE (?:IF NOT EXISTS )?public\.([a-z_0-9]+)", sql, re.M)
    functions = [n for s_, n in FUNC_RE.findall(sql) if s_ == "tes_security" and FIRST_FUNC_VERSION[f"{s_}.{n}"] == version]
    seeds = [t for t in dict.fromkeys(re.findall(r"^INSERT INTO public\.([a-z_0-9]+)", sql, re.M)) if t != "capabilities"]
    caps = []
    for stmt in re.findall(r"INSERT INTO public\.capabilities.*?;", sql, re.S):
        caps += re.findall(r"\(\s*'([A-Z_]+)'\s*,", stmt)
    # triggers this migration puts on tables it does not create (0026 -> public.vehicles)
    ext_triggers = {}
    for tname, table in re.findall(r"^CREATE (?:CONSTRAINT )?TRIGGER ([a-z_0-9]+)\s[^;]*?\bON public\.([a-z_0-9]+)", sql, re.M | re.S):
        if table not in tables:
            ext_triggers.setdefault(table, []).append(tname)
    altered = re.findall(r"^ALTER POLICY ([a-z_0-9]+) ON public\.([a-z_0-9]+)", sql, re.M)
    return {"tables": tables, "functions": functions, "seeds": seeds, "caps": caps, "ext_triggers": ext_triggers,
            "rls": bool(re.search(r"ENABLE ROW LEVEL SECURITY", sql)), "altered_policies": altered, "sql": sql}


ALL_OBJ = {v: objects(v) for v in ALL_FILES}
OBJ = {v: ALL_OBJ[v] for v in MIGRATIONS}
# objects of migrations NOT verified by a fragment of this generator but above a given version ("external later objects"),
# plus those of later fragment migrations: everything created after `v`
ALL_TABLES_AFTER = {v: {t for w in ALL_OBJ if w > v for t in ALL_OBJ[w]["tables"]} for v in MIGRATIONS}
ALL_FUNCS_AFTER = {v: {t for w in ALL_OBJ if w > v for t in ALL_OBJ[w]["functions"]} for v in MIGRATIONS}
ALL_CAPS_AFTER = {v: {t for w in ALL_OBJ if w > v for t in ALL_OBJ[w]["caps"]} for v in MIGRATIONS}


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


def q_triggers(tables, only=None):
    return ("SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text "
            "|| ' args=' || replace(encode(tgargs, 'escape'), E'\\\\000', ',') "
            "|| ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred "
            f"FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ({regclasses(tables)})" + (f" AND tgname IN ({names(only)})" if only else ""))


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


def q_owner(tables, rls=True):
    flags = " || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity" if rls else ""
    return ("SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner)" + flags + " "
            f"FROM pg_class c WHERE c.oid IN ({regclasses(tables)})")


def q_policies(tables):
    return ("SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive "
            "|| ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END "
            "|| ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\\\s+', ' ', 'g'), '-') "
            "|| ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\\\s+', ' ', 'g'), '-') "
            f"FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ({regclasses(tables)})")


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
"0025": """
  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s JOIN public.insurance_coverages c ON c.id = s.coverage_id
   WHERE s.record_status = 'active' AND (NOT c.scheduled_vehicles_only OR c.record_status <> 'active');
  IF bad <> 0 THEN RAISE EXCEPTION '% active schedule row(s) on a coverage that is not an active scheduled_vehicles_only coverage', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s JOIN public.insurance_coverages c ON c.id = s.coverage_id
   WHERE s.record_status = 'active' AND s.organization_id <> c.organization_id;
  IF bad <> 0 THEN RAISE EXCEPTION '% active schedule row(s) whose Organization is not the insured Organization of the coverage', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s JOIN public.insurance_coverages c ON c.id = s.coverage_id
    JOIN public.insurance_policy_terms t ON t.id = c.term_id
   WHERE s.record_status = 'active'
     AND (s.effective_from < c.effective_from
          OR (LEAST(c.effective_to, t.term_end, t.cancelled_on) IS NOT NULL
              AND (s.effective_from >= LEAST(c.effective_to, t.term_end, t.cancelled_on)
                   OR (s.effective_to IS NOT NULL AND s.effective_to > LEAST(c.effective_to, t.term_end, t.cancelled_on)))));
  IF bad <> 0 THEN RAISE EXCEPTION '% active schedule row(s) outside their coverage / term window', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s
   WHERE s.record_status = 'active' AND NOT EXISTS (
     SELECT 1 FROM public.organization_vehicle_relationships r
      WHERE r.vehicle_id = s.vehicle_id AND r.organization_id = s.organization_id AND r.relationship_type = 'OPERATES'
        AND r.record_status = 'active' AND tstzrange(r.effective_from, r.effective_to, '[)') @> s.effective_from::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% active schedule row(s) for a vehicle the Organization did not operate on the first day', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles a JOIN public.insurance_coverage_vehicles b
    ON a.coverage_id = b.coverage_id AND a.vehicle_id = b.vehicle_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)');
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping active schedule windows for one vehicle on one coverage', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s
   WHERE s.record_status = 'corrected' AND NOT EXISTS (
     SELECT 1 FROM public.insurance_coverage_vehicles n WHERE n.id = s.superseded_by_schedule_id AND n.coverage_id = s.coverage_id);
  IF bad <> 0 THEN RAISE EXCEPTION '% corrected schedule row(s) without a successor in the same coverage', bad; END IF;
""",
"0026": """
  SELECT count(*) INTO bad FROM public.vehicles v
   WHERE CASE WHEN v.record_status = 'merged'
              THEN (SELECT count(*) FROM public.vehicle_merges m WHERE m.source_vehicle_id = v.id AND m.record_status = 'active') <> 1
                OR (SELECT count(*) FROM public.vehicle_merges m WHERE m.source_vehicle_id = v.id AND m.record_status = 'active'
                       AND m.target_vehicle_id = v.merged_into_vehicle_id) <> 1
              ELSE EXISTS (SELECT 1 FROM public.vehicle_merges m WHERE m.source_vehicle_id = v.id AND m.record_status = 'active')
         END;
  IF bad <> 0 THEN RAISE EXCEPTION '% vehicle(s) whose merged state and active merge-ledger row disagree', bad; END IF;

  WITH RECURSIVE walk(start_id, cur_id, path) AS (
    SELECT v.id, v.merged_into_vehicle_id, ARRAY[v.id] FROM public.vehicles v WHERE v.merged_into_vehicle_id IS NOT NULL
    UNION ALL
    SELECT w.start_id, v.merged_into_vehicle_id, w.path || v.id
      FROM walk w JOIN public.vehicles v ON v.id = w.cur_id
     WHERE v.merged_into_vehicle_id IS NOT NULL AND NOT v.id = ANY (w.path)
  )
  SELECT count(DISTINCT start_id) INTO bad FROM walk WHERE cur_id = start_id;
  IF bad <> 0 THEN RAISE EXCEPTION '% vehicle(s) on a merge cycle through merged_into_vehicle_id', bad; END IF;

  SELECT count(*) INTO bad FROM public.vehicle_merges
   WHERE (record_status = 'reversed' AND (reversed_at IS NULL OR reversed_at < merged_at)) OR (record_status = 'active' AND reversed_at IS NOT NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% merge-ledger row(s) with an inconsistent reversal (reversed_at must be set and >= merged_at only on reversed rows)', bad; END IF;

  SELECT count(*) INTO bad FROM public.vehicle_merges m JOIN public.vehicles t ON t.id = m.target_vehicle_id
   WHERE m.record_status = 'active' AND t.record_status = 'merged';
  IF bad <> 0 THEN RAISE EXCEPTION '% active merge-ledger row(s) whose survivor is itself merged away', bad; END IF;
""",
}


def cumulative_sections(version):
    """Exact-set sections evaluated only when `version` is the highest migration being verified."""
    parts = []

    def add(text):
        parts.append(text)

    later_tables = ALL_TABLES_AFTER[version]
    rel_expected = [l for l in run(q_relations) if l not in later_tables]
    add(section(f"public relations through {version}", q_relations + (f" AND c.relname NOT IN ({names(sorted(later_tables))})" if later_tables else ""), rel_expected, through=version))
    cap_rows = run(q_caps + " ORDER BY sort_order")
    later_caps = ALL_CAPS_AFTER[version]
    cap_expected = [l for l in cap_rows if l.split("|")[0] not in later_caps]
    add(section(f"capability catalogue through {version} (full rows)", q_caps + (f" WHERE code NOT IN ({names(sorted(later_caps))})" if later_caps else ""), cap_expected, through=version))
    later_funcs = ALL_FUNCS_AFTER[version]
    fn_expected = [l for l in run(q_tesfn) if l not in later_funcs]
    add(section(f"tes_security function set through {version}", q_tesfn + (f" AND p.proname NOT IN ({names(sorted(later_funcs))})" if later_funcs else ""), fn_expected, through=version))
    later_secdef = {k for k, w in FIRST_FUNC_VERSION.items() if w > version}
    secdef_expected = [l for l in run(q_secdef) if l not in later_secdef]
    add(section(f"SECURITY DEFINER function set through {version}", q_secdef + (f" AND n.nspname || '.' || pp.proname NOT IN ({names(sorted(later_secdef))})" if later_secdef else ""), secdef_expected, through=version))
    return "".join(parts)


def ledger_section(version):
    name = MIGRATIONS[version]
    return f"""
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '{version}' AND filename = '{name}') THEN
    RAISE EXCEPTION 'ledger has no {version} entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records {name}';
END
$verify$;
"""


def policy_only_fragment(version):
    """A migration that only ALTERs existing policies (0027): no table / function / trigger / capability / seed of its own."""
    o = OBJ[version]
    name = MIGRATIONS[version]
    assert not (o["tables"] or o["functions"] or o["seeds"] or o["caps"] or o["ext_triggers"] or o["rls"]), f"{version} is not policy-only"
    altered = o["altered_policies"]
    assert altered, f"{version} alters no policy"
    # nothing but the ALTER POLICY statements may remain in the migration
    rest = re.sub(r"ALTER POLICY [a-z_0-9]+ ON public\.[a-z_0-9]+\s+USING \(.*?\);", "", o["sql"], flags=re.S)
    assert rest.strip() == "", f"{version} contains more than ALTER POLICY ... USING: {rest.strip()[:200]}"
    assert "WITH CHECK" not in o["sql"].upper(), f"{version} must not change WITH CHECK"
    tables = list(dict.fromkeys(t for _, t in altered))
    pre_port = os.environ.get("PRE_PGPORT")
    if not pre_port:
        raise SystemExit(f"PRE_PGPORT (a database migrated through {int(version) - 1:04d} only) is required to derive the pre-{version} policy definitions")
    pre_ledger = run("SELECT max(version) FROM tes_system.schema_migrations", pre_port)[0]
    assert pre_ledger == f"{int(version) - 1:04d}", f"PRE_PGPORT database is at {pre_ledger}, expected {int(version) - 1:04d}"
    pre_lines = run(q_policies(tables), pre_port)
    post_lines = run(q_policies(tables))
    pre_by = {l.split(" ", 2)[0] + " " + l.split(" ", 2)[1]: l for l in pre_lines}
    post_by = {l.split(" ", 2)[0] + " " + l.split(" ", 2)[1]: l for l in post_lines}
    assert set(pre_by) == set(post_by), f"the policy NAMES on {tables} differ between pre and post {version}"
    changed = sorted(k for k in post_by if pre_by[k] != post_by[k])
    assert changed == sorted(f"{t} {n}" for n, t in altered), f"policies changed {changed}, migration alters {altered}"
    for k in changed:  # only USING changed: everything else, WITH CHECK included, is identical
        a, b = pre_by[k], post_by[k]
        assert a.split(" using=")[0] == b.split(" using=")[0] and a.split(" check=")[1] == b.split(" check=")[1], f"{k}: more than USING changed"
        assert a.split(" using=")[1] != b.split(" using=")[1]
    # ROW LEVEL SECURITY flags are unchanged by this migration
    pre_flags = run(q_owner(tables), pre_port)
    post_flags = run(q_owner(tables))
    assert pre_flags == post_flags, "RLS flags / owners differ between pre and post"

    labels = ", ".join(tables)
    out = [f"""
-- ============================================================================================================
-- Migration {version} ({name}) - policy-only: ALTER POLICY ... USING on {", ".join(f"{n}" for n, _ in altered)}
-- ============================================================================================================
"""]
    out.append(section(f"{version}: pre-{version} (0024) row-level security policies of {labels} (name, command, permissive, roles, USING, WITH CHECK)", q_policies(tables), pre_lines, phase="pre"))
    out.append(section(f"{version}: RLS flags and owners of {labels} (enabled, not forced)", q_owner(tables), pre_flags, phase="pre"))
    out.append(ledger_section(version))
    out.append(cumulative_sections(version))
    out.append(section(f"{version}: row-level security policies of {labels} - the complete policy set (name, command, permissive, roles, USING, WITH CHECK)", q_policies(tables), post_lines))
    out.append(section(f"{version}: RLS flags and owners of {labels} (enabled, not forced)", q_owner(tables), post_flags))
    out.append(f"""
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT (SELECT bool_and(relrowsecurity AND NOT relforcerowsecurity) FROM pg_class WHERE oid IN ({regclasses(tables)})) THEN
    RAISE EXCEPTION 'a {version} table does not have RLS enabled (and not forced)';
  END IF;
  RAISE NOTICE 'OK {version} policy-only: no table, function, trigger, capability or seed row of its own; RLS enabled (not forced) on {labels}';
END
$verify$;
""")
    return "".join(out)


def fragment(version):
    o = OBJ[version]
    tables, funcs, seeds, caps = o["tables"], o["functions"], o["seeds"], o["caps"]
    business = [t for t in tables if t not in seeds]
    ext_triggers = o["ext_triggers"]
    rls = o["rls"]  # 0025 / 0026 enable RLS and add policies; 0016-0019 do not
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
{f"""  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ({names(caps)})) THEN
    RAISE EXCEPTION 'a {version} capability already exists before {version}';
  END IF;
""" if caps else ""}{"".join(f"""  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'public.{tbl}'::regclass AND tgname IN ({names(tn)})) THEN
    RAISE EXCEPTION 'a {version} trigger on {tbl} already exists before {version}';
  END IF;
""" for tbl, tn in ext_triggers.items())}  RAISE NOTICE 'OK no {version} table, function{", capability" if caps else ""}{" or added trigger" if ext_triggers else ""} exists before {version}';
END
$verify$;
""")
    if version == "0026":
        # 0026 has no backfill: a vehicle merged before the ledger existed would violate the ledger invariant, so the PRE run
        # must find none (otherwise the merge history has to be decided by a person, not invented by a migration).
        add("""
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE record_status = 'merged' OR merged_into_vehicle_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a vehicle is already merged before 0026; 0026 has no backfill for the merge ledger';
  END IF;
  RAISE NOTICE 'OK no vehicle is merged before 0026';
END
$verify$;
""")
    # post phase: ledger row
    add(ledger_section(version))
    add(cumulative_sections(version))
    # exact structure of this migration's objects
    for t in tables:
        add(section(f"{t} columns (name, data type, nullability, default)", q_columns(t), run(q_columns(t))))
    add(section(f"{version} constraints (definition, deferrability)", q_constraints(tables), run(q_constraints(tables))))
    add(section(f"{version} indexes (exact definitions)", q_indexes(tables), run(q_indexes(tables))))
    add(section(f"{version} triggers (enabled flag, type, function, arguments, deferral)", q_triggers(tables), run(q_triggers(tables))))
    for tbl, tn in ext_triggers.items():
        add(section(f"{version} triggers added to existing table {tbl}", q_triggers([tbl], tn), run(q_triggers([tbl], tn))))
    add(section(f"{version} functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute)", q_functions(funcs), run(q_functions(funcs))))
    add(section(f"{version} table ownership" + (" and RLS flags (enabled, not forced)" if rls else ""), q_owner(tables, rls), run(q_owner(tables, rls))))
    if rls:
        add(section(f"{version} row-level security policies (name, command, permissive, roles, USING, WITH CHECK)", q_policies(tables), run(q_policies(tables))))
    add(section(f"{version} table ACL (every non-owner grantee)", q_table_acl(tables), run(q_table_acl(tables))))
    add(section(f"{version} column ACL (every column-specific grant)", q_col_acl(tables), run(q_col_acl(tables))))
    for t in seeds:
        sq = seed_query(t)
        add(section(f"{t} seed rows", sq, run(sq)))
    # runtime privileges beyond the exact ACLs
    if rls:
        rls_block = f"""  IF NOT (SELECT bool_and(relrowsecurity AND NOT relforcerowsecurity) FROM pg_class WHERE oid IN ({regclasses(tables)})) THEN
    RAISE EXCEPTION 'a {version} table does not have RLS enabled (and not forced)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN ({regclasses(tables)}) AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)) THEN
    RAISE EXCEPTION 'a {version} table has RLS enabled but no policy';
  END IF;
"""
        rls_note = "RLS enabled on every table with policies (exact policy set verified separately)"
    else:
        # 0016-0019 enable no RLS themselves. Migration 0024 later closes RLS on some of these tables, so the "no RLS" fact
        # only holds (and is only checked) when the verification does not reach 0020 or later.
        rls_block = f"""  IF current_setting('tes.verify_through') < '0020' AND (
       EXISTS (SELECT 1 FROM pg_class WHERE oid IN ({regclasses(tables)}) AND (relrowsecurity OR relforcerowsecurity))
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ({regclasses(tables)}))) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a {version} table (not part of the approved design before 0020)';
  END IF;
"""
        rls_note = "no RLS / policy before 0020 (RLS closure of 0024 is verified by its own script)"
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

{rls_block}
  RAISE NOTICE 'OK {version} runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege; {rls_note}';
END
$verify$;
""")
    # row conditions
    biz_counts = " OR ".join(f"(SELECT count(*) FROM public.{t}) <> 0" for t in business)
    cap_check = f"""    IF EXISTS (SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id
               WHERE c.code IN ({names(caps)})) THEN
      RAISE EXCEPTION 'a {version} capability is granted to someone ({version} grants nothing; set TES_VERIFY_EXPECT_EMPTY=0 once grants are made deliberately)';
    END IF;
""" if caps else ""
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
{cap_check}  END IF;
{INVARIANTS[version]}
  RAISE NOTICE 'OK {version} row conditions hold ({", ".join(business)} counted separately in the ROWCOUNT lines)';
END
$verify$;
""")
    return "".join(parts)


for version in MIGRATIONS:
    (out_dir / f"{version}.sql").write_text(policy_only_fragment(version) if version in POLICY_ONLY else fragment(version))
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
      RAISE EXCEPTION 'baseline list names a generator-verified foundation table (0016-0019, 0025-0027): %', tbl;
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
