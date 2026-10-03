/**
 * Family registration for the generic Performance Workflow Engine. A category adopts the engine by contributing a provider here;
 * categories without one keep the generic providers only (Roadside and Collision are intentionally not registered).
 */

import type { FoundationEvent, PerformanceFoundationState } from "@/lib/performance-foundation-state"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { DEFAULT_WORKFLOW_PROVIDERS, deriveWorkflow } from "./performance-workflow.ts"
import type { WorkflowProvider } from "@/lib/performance-workflow"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { nearMissWorkflowProvider } from "./performance-near-miss.ts"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { collisionWorkflowProvider } from "./performance-collision.ts"

const FAMILY_PROVIDERS: Readonly<Record<string, WorkflowProvider>> = {
  "Near Miss": nearMissWorkflowProvider,
  "Collision": collisionWorkflowProvider,
}

export const getWorkflowProvidersForEventType = (eventType: string): readonly WorkflowProvider[] => {
  const family = FAMILY_PROVIDERS[eventType]
  return family ? [...DEFAULT_WORKFLOW_PROVIDERS, family] : DEFAULT_WORKFLOW_PROVIDERS
}

export const isWorkflowEngineEvent = (eventType: string) => Object.prototype.hasOwnProperty.call(FAMILY_PROVIDERS, eventType)

export const deriveEventWorkflow = (event: FoundationEvent, state: PerformanceFoundationState) => deriveWorkflow(event, state, getWorkflowProvidersForEventType(event.eventType))
