// Replaces ONLY what cannot run outside Next.js: the `server-only` marker and Clerk's session lookup (the Clerk user id is supplied by
// the caller). With TES_APP_PATH_LOCAL_URL (local tests only) the database module is replaced too; otherwise the REAL adapter is used.
const stub = (name) => new URL(`../../../../test/helpers/auth-stubs/${name}`, import.meta.url).href;
const R = new Map([["server-only", stub("server-only.mjs")], ["@clerk/nextjs/server", stub("clerk.mjs")]]);
if (process.env.TES_APP_PATH_LOCAL_URL) R.set("@/lib/database/postgres", stub("postgres.mjs"));
export async function resolve(specifier, context, next) {
  const r = R.get(specifier);
  if (r) return { url: r, shortCircuit: true };
  if (specifier === "next/server") return next("next/server.js", context);
  return next(specifier, context);
}
