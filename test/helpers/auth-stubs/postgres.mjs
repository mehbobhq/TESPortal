// Test stand-in for lib/database/postgres.ts (Cloud SQL Connector + IAM). The tests supply a pg Pool that connects to a
// disposable local PostgreSQL AS THE RUNTIME ROLE, so the real wrappers run with exactly the runtime's privileges.
export async function getPostgresPool() {
  const pool = globalThis.__tesTestRuntimePool;
  if (!pool) throw new Error("Test runtime pool is not initialised (see test/helpers/auth-db.ts).");
  return pool;
}
