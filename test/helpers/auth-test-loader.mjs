// Test-only module-resolution hook for the authorization tests. It swaps three server-runtime dependencies for local
// stand-ins so the REAL lib/auth modules can run under `node --test` against a real PostgreSQL. It changes no
// application behaviour and is registered only by register-auth-test-loader.mjs.
const stub = (name) => new URL(`./auth-stubs/${name}`, import.meta.url).href;

const REPLACEMENTS = new Map([
  ["server-only", stub("server-only.mjs")],
  ["@clerk/nextjs/server", stub("clerk.mjs")],
  ["@/lib/database/postgres", stub("postgres.mjs")],
]);

export async function resolve(specifier, context, next) {
  const replacement = REPLACEMENTS.get(specifier);
  if (replacement) return { url: replacement, shortCircuit: true };
  return next(specifier, context);
}
