import "server-only"

import type { PoolClient, QueryResultRow } from "pg"
import { getPostgresPool } from "@/lib/database/postgres"
import {
  DuplicateEventError,
  type MasterRegisterRepository,
} from "@/lib/master-register/repository"
import type { MasterRegisterEvent } from "@/lib/master-register/types"

type MasterRegisterRow = QueryResultRow & {
  event_id: string
  event_type: string
  event_family: string
  schema_version: number
  catalogue_version: number
  actor_type: MasterRegisterEvent["actor"]["actorType"]
  actor_id: string
  occurred_at: Date
  recorded_at: Date
  action: MasterRegisterEvent["action"] | null
  target: MasterRegisterEvent["target"] | null
  source: MasterRegisterEvent["source"]
  classification: MasterRegisterEvent["classification"] | null
  change_set: MasterRegisterEvent["change"] | null
  evidence: MasterRegisterEvent["evidence"] | null
  relationships: MasterRegisterEvent["relationships"] | null
  outcome: MasterRegisterEvent["outcome"] | null
  coverage: MasterRegisterEvent["coverage"] | null
  governance: MasterRegisterEvent["governance"] | null
  integrity: MasterRegisterEvent["integrity"] | null
}

const SELECT_COLUMNS = `
  event_id, event_type, event_family, schema_version, catalogue_version,
  actor_type, actor_id, occurred_at, recorded_at,
  action, target, source, classification, change_set, evidence,
  relationships, outcome, coverage, governance, integrity
`

function rowToEvent(row: MasterRegisterRow): MasterRegisterEvent {
  const event: MasterRegisterEvent = {
    eventId: row.event_id,
    eventType: row.event_type,
    eventFamily: row.event_family,
    schemaVersion: row.schema_version,
    catalogueVersion: row.catalogue_version,
    actor: { actorType: row.actor_type, actorId: row.actor_id },
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
    source: row.source,
  }

  if (row.action !== null) event.action = row.action
  if (row.target !== null) event.target = row.target
  if (row.classification !== null) event.classification = row.classification
  if (row.change_set !== null) event.change = row.change_set
  if (row.evidence !== null) event.evidence = row.evidence
  if (row.relationships !== null) event.relationships = row.relationships
  if (row.outcome !== null) event.outcome = row.outcome
  if (row.coverage !== null) event.coverage = row.coverage
  if (row.governance !== null) event.governance = row.governance
  if (row.integrity !== null) event.integrity = row.integrity

  return event
}

function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  )
}

async function queryRows(
  executor: Pick<PoolClient, "query">,
  where: string,
  value: string,
): Promise<MasterRegisterEvent[]> {
  const result = await executor.query<MasterRegisterRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM public.master_register_events
      WHERE ${where}
      ORDER BY recorded_at ASC, event_id ASC`,
    [value],
  )
  return result.rows.map(rowToEvent)
}

export class PostgresMasterRegisterRepository implements MasterRegisterRepository {
  constructor(private readonly client?: PoolClient) {}

  private async executor(): Promise<Pick<PoolClient, "query">> {
    return this.client ?? (await getPostgresPool())
  }

  async append(event: MasterRegisterEvent): Promise<MasterRegisterEvent> {
    const executor = await this.executor()

    try {
      const result = await executor.query<MasterRegisterRow>(
        `INSERT INTO public.master_register_events (
          event_id, event_type, event_family, schema_version, catalogue_version,
          actor_type, actor_id, occurred_at, recorded_at,
          action, target, source, classification, change_set, evidence,
          relationships, outcome, coverage, governance, integrity
        ) VALUES (
          $1::uuid, $2, $3, $4, $5,
          $6, $7::uuid, $8::timestamptz, $9::timestamptz,
          $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb,
          $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb
        )
        RETURNING ${SELECT_COLUMNS}`,
        [
          event.eventId, event.eventType, event.eventFamily,
          event.schemaVersion, event.catalogueVersion,
          event.actor.actorType, event.actor.actorId,
          event.occurredAt, event.recordedAt,
          json(event.action), json(event.target), json(event.source),
          json(event.classification), json(event.change), json(event.evidence),
          json(event.relationships), json(event.outcome), json(event.coverage),
          json(event.governance), json(event.integrity),
        ],
      )

      const row = result.rows[0]
      if (!row) throw new Error("Master Register append returned no row.")
      return rowToEvent(row)
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateEventError(event.eventId)
      throw error
    }
  }

  async getById(eventId: string): Promise<MasterRegisterEvent | undefined> {
    const executor = await this.executor()
    const result = await executor.query<MasterRegisterRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM public.master_register_events
        WHERE event_id = $1::uuid`,
      [eventId],
    )
    return result.rows[0] ? rowToEvent(result.rows[0]) : undefined
  }

  async queryByCorrelationId(value: string) {
    return queryRows(await this.executor(), "correlation_id = $1", value)
  }

  async queryByCompanyId(value: string) {
    return queryRows(await this.executor(), "company_id = $1", value)
  }

  async queryByActorId(value: string) {
    return queryRows(await this.executor(), "actor_id = $1::uuid", value)
  }

  async queryByAssessmentId(value: string) {
    return queryRows(await this.executor(), "assessment_id = $1", value)
  }

  async queryByAutomationRunId(value: string) {
    return queryRows(await this.executor(), "automation_run_id = $1", value)
  }

  async queryByIntegrationOperationId(value: string) {
    return queryRows(await this.executor(), "integration_operation_id = $1", value)
  }
}
