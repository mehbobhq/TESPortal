import type { ScanRequest } from "./assessment.js";

/**
 * Pure parsing/validation of one Eventarc/CloudEvent GCS object-finalized
 * delivery, extracted from server.ts so every rejection path is unit
 * testable without starting an HTTP server. Behavior (status codes and error
 * messages) is identical to the inline logic it replaced.
 *
 * Handles both Eventarc delivery modes:
 *  - binary content mode: CloudEvent attributes in `ce-*` headers, the GCS
 *    object resource itself as the raw JSON body.
 *  - structured content mode: the entire CloudEvent (GCS object resource
 *    under `data`) as one JSON body.
 */

interface GcsFinalizePayload {
  bucket?: unknown;
  name?: unknown;
  generation?: unknown;
  contentType?: unknown;
  size?: unknown;
}

export type EventParseResult =
  | { ok: true; request: ScanRequest }
  | { ok: false; status: 400; error: string };

function extractGcsPayload(parsedBody: unknown, isBinaryMode: boolean): GcsFinalizePayload | null {
  if (!parsedBody || typeof parsedBody !== "object") return null;
  if (isBinaryMode) return parsedBody as GcsFinalizePayload;
  const structured = parsedBody as { data?: unknown };
  if (!structured.data || typeof structured.data !== "object") return null;
  return structured.data as GcsFinalizePayload;
}

function toScanRequest(payload: GcsFinalizePayload): ScanRequest | null {
  if (typeof payload.bucket !== "string" || typeof payload.name !== "string") return null;
  return {
    bucket: payload.bucket,
    objectName: payload.name,
    generation: payload.generation !== undefined ? String(payload.generation) : undefined,
    contentType: typeof payload.contentType === "string" ? payload.contentType : undefined,
    size: typeof payload.size === "string" || typeof payload.size === "number" ? Number(payload.size) : undefined,
  };
}

/**
 * @param rawBody the raw request body text
 * @param isBinaryMode true when a `ce-type` header is present
 * @param configuredQuarantineBucket the bucket from trusted server environment
 *   configuration - the event's own bucket field is only ever compared against
 *   this, never used to pick a source or destination.
 */
export function parseGcsFinalizeEvent(
  rawBody: string,
  isBinaryMode: boolean,
  configuredQuarantineBucket: string,
): EventParseResult {
  let parsedBody: unknown;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return { ok: false, status: 400, error: "Malformed event payload." };
  }

  const payload = extractGcsPayload(parsedBody, isBinaryMode);
  if (!payload) return { ok: false, status: 400, error: "Unrecognized event payload shape." };

  const request = toScanRequest(payload);
  if (!request) return { ok: false, status: 400, error: "Event payload is missing required fields." };

  // STRICT bucket validation - a mismatch is refused outright; no assessment
  // is created and no GCS call is made for a bucket this service is not
  // responsible for.
  if (request.bucket !== configuredQuarantineBucket) {
    return { ok: false, status: 400, error: "Event does not reference the configured quarantine bucket." };
  }

  return { ok: true, request };
}
