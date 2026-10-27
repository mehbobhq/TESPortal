// READ-ONLY end-to-end check of the application's customer-list path (Clerk user -> TES actor -> authorization -> query) against the
// configured database, using the real application modules and (unless TES_APP_PATH_LOCAL_URL is set) the real Supabase adapter.
// Output is limited to fixed words, counts and error classes: never a message, id, name, address or secret.
//   TES_APP_PATH_CLERK_USER_ID   the Clerk user id to act as (an identifier)
import pg from "pg";

const safe = (e) => {
  const out = { name: typeof e?.name === "string" && /^[A-Za-z0-9_]{1,60}$/.test(e.name) ? e.name : "Error" };
  if (typeof e?.code === "string" && /^[A-Za-z0-9_]{3,60}$/.test(e.code)) out.code = e.code;
  return JSON.stringify(out);
};
const userId = process.env.TES_APP_PATH_CLERK_USER_ID;
if (!/^user_[A-Za-z0-9]+$/.test(userId ?? "")) { console.log("app_path: REFUSED invalid Clerk user id"); process.exit(2); }
globalThis.__tesTestClerkUserId = userId;
if (process.env.TES_APP_PATH_LOCAL_URL) globalThis.__tesTestRuntimePool = new pg.Pool({ connectionString: process.env.TES_APP_PATH_LOCAL_URL, max: 2 });

let code = 0;
try {
  const { listCustomerDirectory } = await import("@/lib/company-directory/service.ts");
  const rows = await listCustomerDirectory();
  console.log(`app_path: OK customers=${rows.length}`);
} catch (e) {
  console.log(`app_path: FAIL ${safe(e)}`);
  code = 1;
}
try { await globalThis.__tesTestRuntimePool?.end(); } catch {}
process.exit(code);
