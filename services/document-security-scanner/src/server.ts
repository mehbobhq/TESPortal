import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { assessQuarantineObject, scannerEngineReady, type ScanRequest } from "./assessment.js";
import { port, quarantineBucketName } from "./config.js";
import { logger } from "./logger.js";

/**
 * HTTP entry point for the scanner. This service must be deployed as a
 * PRIVATE Cloud Run service (--no-allow-unauthenticated) with an Eventarc
 * trigger configured to invoke it using a dedicated invoker service account
 * - access control for this endpoint is enforced by the Cloud Run/Eventarc
 * platform layer (IAM-verified OIDC push), not by any code in this file.
 * This service does not implement its own request authentication, per the
 * task boundary against building fake auth; deploying it without
 * --no-allow-unauthenticated would expose it publicly and is a deployment
 * configuration error, not something this code can prevent.
 *
 * Handles both Eventarc CloudEvent delivery modes for a GCS
 * object-finalized event:
 *  - binary content mode: CloudEvent attributes in `ce-*` headers, the GCS
 *    object resource itself as the raw JSON body.
 *  - structured content mode: the entire CloudEvent (including the GCS
 *    object resource under `data`) as one JSON body.
 */

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

interface GcsFinalizePayload {
  bucket?: unknown;
  name?: unknown;
  generation?: unknown;
  contentType?: unknown;
  size?: unknown;
}

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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Could not read request body." });
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    sendJson(res, 400, { error: "Malformed event payload." });
    return;
  }

  const isBinaryMode = typeof req.headers["ce-type"] === "string";
  const payload = extractGcsPayload(parsedBody, isBinaryMode);
  if (!payload) {
    sendJson(res, 400, { error: "Unrecognized event payload shape." });
    return;
  }

  const scanRequest = toScanRequest(payload);
  if (!scanRequest) {
    sendJson(res, 400, { error: "Event payload is missing required fields." });
    return;
  }

  // STRICT bucket validation - this must come from trusted server
  // environment configuration, never from the event payload's own field
  // being used to pick a destination. A mismatch is refused outright; no
  // assessment is created and no GCS call is made for a bucket this service
  // is not responsible for.
  const configuredQuarantineBucket = quarantineBucketName();
  if (scanRequest.bucket !== configuredQuarantineBucket) {
    logger.warn({ message: "event referenced an unexpected bucket, declining" });
    sendJson(res, 400, { error: "Event does not reference the configured quarantine bucket." });
    return;
  }

  const assessment = await assessQuarantineObject(scanRequest);
  // Acknowledge the event (2xx) once a decision has been reached, regardless
  // of the security decision itself - THREAT_DETECTED/REVIEW_REQUIRED/
  // UNABLE_TO_SCAN are all valid, handled outcomes for Eventarc's purposes,
  // not delivery failures. Returning a non-2xx here would cause Eventarc to
  // retry-redeliver the same event, which is unrelated to whether the
  // document itself was clean.
  sendJson(res, 200, {
    securityAssessmentId: assessment.securityAssessmentId,
    securityDecision: assessment.securityDecision,
    promotionStatus: assessment.promotionStatus,
  });
}

async function handleHealth(res: ServerResponse): Promise<void> {
  sendJson(res, 200, { status: "ok" });
}

async function handleReadiness(res: ServerResponse): Promise<void> {
  const readiness = await scannerEngineReady();
  sendJson(res, readiness.ready ? 200 : 503, readiness);
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/health") {
    void handleHealth(res);
    return;
  }
  if (req.method === "GET" && url === "/health/ready") {
    void handleReadiness(res);
    return;
  }
  if (req.method === "POST" && url === "/") {
    void handleEvent(req, res).catch((error) => {
      logger.error({ message: error instanceof Error ? error.message : "unhandled event error" });
      sendJson(res, 500, { error: "Internal error." });
    });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
});

server.listen(port(), () => {
  logger.info({ message: `TES document security scanner listening on port ${port()}` });
});
