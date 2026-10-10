// Test stand-in for @clerk/nextjs/server. The authenticated Clerk subject is whatever the current test sets;
// null means "no authenticated session". It exercises the real lib/auth/tes-actor.ts resolution against the database.
// A subject bound with withClerkUser() (an AsyncLocalStorage on globalThis) takes precedence over the global one, so
// several actors can run concurrently in one test.
export async function auth() {
  const scoped = globalThis.__tesTestClerkUserScope?.getStore();
  return { userId: scoped !== undefined ? scoped : (globalThis.__tesTestClerkUserId ?? null) };
}
