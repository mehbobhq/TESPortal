import pg from "pg"
let pool
export async function getPostgresPool() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.E2E_RUNTIME_DATABASE_URL, max: 6 })
  return pool
}
