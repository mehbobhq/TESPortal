import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(".github/workflows/production-0037-0038-readonly-verification.yml", "utf8");
const script = readFileSync("scripts/database/verify-production-baseline-0039-readonly.sh", "utf8");
const executable = (text: string) => text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("production read-only verification: baseline 0039 mode", () => {
  it("keeps the three earlier phases and adds baseline-0039", () => {
    for (const phase of ["pre-0037", "post-0037", "post-0038", "baseline-0039"]) assert.match(workflow, new RegExp(`- ${phase}\\b`), phase);
    assert.match(workflow, /if: \$\{\{ inputs\.phase != 'baseline-0039' \}\}[\s\S]*?verify-production-0037-0038-readonly\.sh/, "the earlier verifier still runs for the earlier phases, unchanged");
    assert.match(workflow, /if: \$\{\{ inputs\.phase == 'baseline-0039' \}\}[\s\S]*?verify-production-baseline-0039-readonly\.sh/, "the new verifier runs only for the new phase");
  });

  it("keeps the same trigger, environment, branch restriction, authentication path and variables (no new credential or permission)", () => {
    assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
    assert.doesNotMatch(workflow, /\n\s*(push|pull_request|schedule):/);
    assert.match(workflow, /environment: production-database/);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n\s*id-token: write/);
    assert.match(workflow, /google-github-actions\/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093/);
    assert.match(workflow, /--auto-iam-authn/);
    assert.deepEqual([...new Set([...workflow.matchAll(/\$\{\{\s*(vars|secrets)\.([A-Z_]+)/g)].map((m) => `${m[1]}.${m[2]}`))].sort(), ["vars.GCP_SERVICE_ACCOUNT", "vars.GCP_WORKLOAD_IDENTITY_PROVIDER", "vars.TES_CLOUD_SQL_INSTANCE", "vars.TES_POSTGRES_DATABASE", "vars.TES_POSTGRES_IAM_USER"]);
  });

  it("can never invoke the migration runner", () => {
    for (const [name, text] of [["workflow", executable(workflow)], ["script", executable(script)]] as const) {
      assert.doesNotMatch(text, /migrate\.sh|schema_migrations\s+SET|psql[^\n]*-f\s+database\/migrations/, `${name} must not run migrations`);
      assert.doesNotMatch(text, /MIGRATIONS_DIR\s*=.*\bmigrate\b/, name);
    }
  });

  it("contains no mutating SQL: the only DDL is the refused write probe, and every query is in a READ ONLY transaction", () => {
    const code = executable(script).replace(/CREATE TEMP TABLE _tes_read_only_probe \(x int\);/, "");
    assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|REINDEX|CREATE)\b/i);
    assert.match(script, /export PGOPTIONS="-c default_transaction_read_only=on"/);
    assert.match(script, /BEGIN TRANSACTION READ ONLY;\\n%s;\\nROLLBACK;/);
    assert.match(script, /read_only_enforcement FAIL/, "it refuses to read anything when the database does not enforce read-only");
    assert.equal([...script.matchAll(/psql -X/g)].length, [...script.matchAll(/psql -X -At -q --no-password/g)].length, "every psql call is non-interactive and uses the same flags");
  });

  it("prints no applicant data: invitations are only counted", () => {
    const query = script.match(/SELECT count\(\*\) FROM public\.driver_application_invitations[^"]*/)?.[0] ?? "";
    assert.match(query, /status IN \('SENT', 'OPENED'\) AND expires_at > now\(\)/);
    assert.doesNotMatch(executable(script), /SELECT[^;"]*\b(recipient_email|token_hash|given_name|family_name)\b[^;"]*FROM public\.driver_application_invitations/i);
  });
});
