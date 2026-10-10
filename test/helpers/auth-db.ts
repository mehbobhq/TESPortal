// Database harness for the authorization tests.
//
// Two connections to a DISPOSABLE PostgreSQL that already has migrations 0001-0011 applied:
//   - admin:   the migration identity (table owner). Used ONLY to create and remove fixtures.
//   - runtime: the application's runtime role. The code under test runs as this role, so the tests also prove the
//              authorization queries need nothing beyond the runtime's real privileges.
//
// Never point these at a shared or production database. scripts/test/run-auth-tests.sh builds a throwaway cluster.

import { randomUUID } from "node:crypto";
import pg from "pg";

export const DB_ENV = {
  admin: "TES_TEST_ADMIN_DATABASE_URL",
  runtime: "TES_TEST_RUNTIME_DATABASE_URL",
} as const;

export const DB_CONFIGURED = Boolean(process.env[DB_ENV.admin] && process.env[DB_ENV.runtime]);

/**
 * DB-backed tests run when a disposable database is configured. When TES_REQUIRE_DB_TESTS=1 (set by the test:auth
 * script) a missing database is a hard failure, so security tests can never be silently skipped.
 */
export function dbTestsEnabled(): boolean {
  if (DB_CONFIGURED) return true;
  if (process.env.TES_REQUIRE_DB_TESTS === "1") {
    throw new Error(`Authorization DB tests require ${DB_ENV.admin} and ${DB_ENV.runtime}.`);
  }
  return false;
}

export type Pools = { admin: pg.Pool; runtime: pg.Pool };

let pools: Pools | null = null;

export function openPools(): Pools {
  if (pools) return pools;
  const admin = new pg.Pool({ connectionString: process.env[DB_ENV.admin], max: 4 });
  const runtime = new pg.Pool({ connectionString: process.env[DB_ENV.runtime], max: 6 });
  pools = { admin, runtime };
  // The real lib/database/postgres.ts is replaced by test/helpers/auth-stubs/postgres.mjs, which returns this pool.
  (globalThis as Record<string, unknown>).__tesTestRuntimePool = runtime;
  return pools;
}

export async function closePools(): Promise<void> {
  if (!pools) return;
  const current = pools;
  pools = null;
  delete (globalThis as Record<string, unknown>).__tesTestRuntimePool;
  await current.admin.end();
  await current.runtime.end();
}

/** Sets the authenticated Clerk subject seen by lib/auth/tes-actor.ts (null = no session). */
export function setClerkUser(subject: string | null): void {
  (globalThis as Record<string, unknown>).__tesTestClerkUserId = subject;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

type Status = "active" | "suspended" | "ended";

export type TestActor = { actorId: string; clerkSubject: string };

/**
 * Fixture builder. Every id is a fresh random UUID, and cleanup() removes exactly what this instance created, in
 * foreign-key order, so tests are independent of each other and of any data already in the disposable database.
 */
export class AuthFixtures {
  private grants: string[] = [];
  private assignments: string[] = [];
  private relationships: string[] = [];
  private masters: string[] = [];
  private identities: string[] = [];
  private actors: string[] = [];
  private customers: string[] = [];
  private organizations: string[] = [];
  private capabilityRestores: Array<{ code: string; isActive: boolean }> = [];
  private removedCapabilities: Array<Record<string, unknown>> = [];

  private readonly admin: pg.Pool;

  constructor(admin: pg.Pool) {
    this.admin = admin;
  }

  async organizationAndCustomer(label = "Fixture"): Promise<{ organizationId: string; customerId: string }> {
    const organizationId = randomUUID();
    const customerId = randomUUID();
    const name = `${label} ${organizationId.slice(0, 8)}`;
    await this.admin.query(
      `INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`,
      [organizationId, name],
    );
    this.organizations.push(organizationId);
    await this.admin.query(`INSERT INTO public.customers (id, organization_id) VALUES ($1, $2)`, [
      customerId,
      organizationId,
    ]);
    this.customers.push(customerId);
    return { organizationId, customerId };
  }

  async actor(options: { status?: "active" | "suspended" | "disabled" } = {}): Promise<TestActor> {
    const actorId = randomUUID();
    const clerkSubject = `user_test_${actorId}`;
    const status = options.status ?? "active";
    await this.admin.query(
      `INSERT INTO public.actors (id, actor_type, status, disabled_at)
       VALUES ($1, 'HUMAN', $2, CASE WHEN $2 = 'disabled' THEN now() ELSE NULL END)`,
      [actorId, status],
    );
    this.actors.push(actorId);
    const identityId = randomUUID();
    await this.admin.query(
      `INSERT INTO public.authentication_identities (id, actor_id, provider, provider_subject)
       VALUES ($1, $2, 'clerk', $3)`,
      [identityId, actorId, clerkSubject],
    );
    this.identities.push(identityId);
    return { actorId, clerkSubject };
  }

  async master(actorId: string, options: { designatedAt?: string; status?: "active" | "ended" } = {}): Promise<string> {
    const id = randomUUID();
    const status = options.status ?? "active";
    await this.admin.query(
      `INSERT INTO public.master_account_authority (id, actor_id, status, designated_at, ended_at)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now() - interval '1 day'),
               CASE WHEN $3 = 'ended' THEN now() ELSE NULL END)`,
      [id, actorId, status, options.designatedAt ?? null],
    );
    this.masters.push(id);
    return id;
  }

  async relationship(
    actorId: string,
    type: "TES_STAFF" | "CUSTOMER_USER" | "DRIVER",
    options: { status?: Status; startsAt?: string; endsAt?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    const status = options.status ?? "active";
    await this.admin.query(
      `INSERT INTO public.actor_relationships (id, actor_id, relationship_type, status, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now() - interval '1 day'),
               CASE WHEN $4 = 'ended' THEN COALESCE($6::timestamptz, now()) ELSE NULL END)`,
      [id, actorId, type, status, options.startsAt ?? null, options.endsAt ?? null],
    );
    this.relationships.push(id);
    return id;
  }

  async assignment(
    relationshipId: string,
    scope: { type: "SYSTEM" } | { type: "CUSTOMER"; customerId: string },
    options: { status?: Status; startsAt?: string; endsAt?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    const status = options.status ?? "active";
    await this.admin.query(
      `INSERT INTO public.relationship_assignments
         (id, relationship_id, scope_type, customer_id, status, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now() - interval '1 day'),
               CASE WHEN $5 = 'ended' THEN COALESCE($7::timestamptz, now()) ELSE NULL END)`,
      [
        id,
        relationshipId,
        scope.type,
        scope.type === "CUSTOMER" ? scope.customerId : null,
        status,
        options.startsAt ?? null,
        options.endsAt ?? null,
      ],
    );
    this.assignments.push(id);
    return id;
  }

  async grant(
    relationshipId: string,
    capabilityCode: string,
    options: { assignmentId?: string; status?: Status; grantedAt?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    const status = options.status ?? "active";
    const result = await this.admin.query(
      `INSERT INTO public.relationship_capability_grants
         (id, relationship_id, capability_id, assignment_id, status, granted_at, ended_at)
       SELECT $1, $2, c.id, $3, $4, COALESCE($5::timestamptz, now() - interval '1 day'),
              CASE WHEN $4 = 'ended' THEN now() ELSE NULL END
         FROM public.capabilities c WHERE c.code = $6
       RETURNING id`,
      [id, relationshipId, options.assignmentId ?? null, status, options.grantedAt ?? null, capabilityCode],
    );
    if (result.rowCount !== 1) throw new Error(`Test fixture: capability ${capabilityCode} is not seeded.`);
    this.grants.push(id);
    return id;
  }

  /** Temporarily toggles a seeded capability; cleanup() restores it. */
  async setCapabilityActive(code: string, isActive: boolean): Promise<void> {
    const before = await this.admin.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.capabilities WHERE code = $1`,
      [code],
    );
    if (before.rows.length !== 1) throw new Error(`Test fixture: capability ${code} is not seeded.`);
    this.capabilityRestores.push({ code, isActive: before.rows[0].is_active });
    await this.admin.query(`UPDATE public.capabilities SET is_active = $2 WHERE code = $1`, [code, isActive]);
  }

  /** Temporarily deletes a seeded capability row (none may be granted); cleanup() re-inserts it unchanged. */
  async removeCapability(code: string): Promise<void> {
    const row = await this.admin.query(`SELECT * FROM public.capabilities WHERE code = $1`, [code]);
    if (row.rows.length !== 1) throw new Error(`Test fixture: capability ${code} is not seeded.`);
    this.removedCapabilities.push(row.rows[0]);
    await this.admin.query(`DELETE FROM public.capabilities WHERE code = $1`, [code]);
  }

  async cleanup(): Promise<void> {
    for (const row of this.removedCapabilities.reverse()) {
      await this.admin.query(
        `INSERT INTO public.capabilities (id, code, display_name, description, is_active, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.id, row.code, row.display_name, row.description, row.is_active, row.sort_order, row.created_at, row.updated_at],
      );
    }
    this.removedCapabilities = [];
    for (const { code, isActive } of this.capabilityRestores.reverse()) {
      await this.admin.query(`UPDATE public.capabilities SET is_active = $2 WHERE code = $1`, [code, isActive]);
    }
    this.capabilityRestores = [];
    const steps: Array<[string, string[]]> = [
      ["public.relationship_capability_grants", this.grants],
      ["public.relationship_assignments", this.assignments],
      ["public.actor_relationships", this.relationships],
      ["public.master_account_authority", this.masters],
      ["public.authentication_identities", this.identities],
      ["public.customers", this.customers],
      ["public.organizations", this.organizations],
    ];
    // Actors are deleted in FK order after identities, but an actor that appears in the append-only Master Register can
    // never be deleted (master_register_events.actor_id references it). Such actors are deliberately left behind: their
    // grants, relationships and identities are gone, so they are inert, and the disposable database is discarded anyway.
    const actorStepIndex = steps.findIndex(([table]) => table === "public.authentication_identities") + 1;
    steps.splice(actorStepIndex, 0, ["public.actors", this.actors]);
    for (const [table, ids] of steps) {
      if (ids.length > 0) {
        if (table === "public.actors") {
          await this.admin.query(
            `DELETE FROM public.actors a WHERE a.id = ANY($1::uuid[])
               AND NOT EXISTS (SELECT 1 FROM public.master_register_events e WHERE e.actor_id = a.id)`,
            [ids],
          );
        } else {
          await this.admin.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
        }
      }
      ids.length = 0;
    }
  }
}
