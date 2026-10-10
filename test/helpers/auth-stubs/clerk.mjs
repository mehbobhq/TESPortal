// Test stand-in for @clerk/nextjs/server. The authenticated Clerk subject is whatever the current test sets;
// null means "no authenticated session". It exercises the real lib/auth/tes-actor.ts resolution against the database.
export async function auth() {
  return { userId: globalThis.__tesTestClerkUserId ?? null };
}
