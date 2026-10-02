import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { assessQuarantineObject, scannerEngineReady } from "./assessment.js";
import { port, quarantineBucketName } from "./config.js";
import { parseGcsFinalizeEvent } from "./event.js";
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

  // Parsing, shape checks, and the STRICT bucket validation (the event's own
  // bucket field is only ever compared against trusted server configuration,
  // never used to pick a source or destination) live in event.ts so every
  // rejection path is unit tested. A rejected event creates no assessment and
  // makes no GCS call.
  const isBinaryMode = typeof req.headers["ce-type"] === "string";
  const parsed = parseGcsFinalizeEvent(rawBody, isBinaryMode, quarantineBucketName());
  if (!parsed.ok) {
    logger.warn({ message: `event rejected: ${parsed.error}` });
    sendJson(res, parsed.status, { error: parsed.error });
    return;
  }

  const assessment = await assessQuarantineObject(parsed.request);
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
