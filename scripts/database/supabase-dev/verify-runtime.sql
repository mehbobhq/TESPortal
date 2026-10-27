-- READ-ONLY runtime checks, run as tes-backend (the application's role) through the endpoint the application will use.
-- Emits `check|PASS/FAIL/UNVERIFIED|detail`. No row data.
SELECT 'identity|'||CASE WHEN current_user = 'tes-backend@tes-production-510007.iam'
                          AND NOT (SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = current_user)
                         THEN 'PASS' ELSE 'FAIL' END||'|current_user is the runtime role with no elevated attribute';
SELECT 'role_statement_timeout|'||CASE WHEN current_setting('statement_timeout') = '30s' THEN 'PASS' ELSE 'FAIL' END||'|statement_timeout='||current_setting('statement_timeout')||' (role-level, so it needs no startup parameter)';
SELECT 'tls|'||CASE WHEN coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) THEN 'PASS' ELSE 'UNVERIFIED' END||'|server reports an encrypted session (through a pooler this describes the last hop only)';
