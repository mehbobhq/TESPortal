import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logger } from "./logger.js";
import type { ScanOutcome } from "./types.js";

/**
 * ClamAV execution model - Phase 2.
 *
 * Uses `clamdscan` against the persistent `clamd` daemon (see clamd.conf,
 * entrypoint.sh) over the Unix domain socket configured there, instead of
 * spawning standalone `clamscan` and reloading the full signature database
 * on every single scan (Phase 1's engine, and README's "Signature update /
 * scan latency strategy" section for why that was a known, deliberate,
 * temporary tradeoff, not a design goal). `clamd`'s own startup - gated by
 * entrypoint.sh's PING/PONG readiness check before Node ever starts - is
 * what pays the one-time database-load cost per container instance; every
 * individual scan through this module is now a lightweight daemon request.
 *
 * `clamdscan --config-file=/etc/clamav/clamd.conf <file>` is the exact
 * command pattern proven against the real running daemon (clean scans in
 * ~0.04s, EICAR detection in ~0.01s, per direct runtime measurement) -
 * matched here exactly rather than guessed at.
 *
 * Every call goes through node:child_process.execFile with an argument
 * array - never a shell string - so no user- or event-derived value is ever
 * capable of command injection or shell interpolation. Nothing in this
 * module accepts or constructs a shell command string. No TCP networking, no
 * new npm dependency, and no second service were introduced for this -
 * `clamdscan` is invoked exactly like `clamscan` was, as a child process,
 * just pointed at the daemon's configured socket instead of scanning
 * standalone.
 */

/**
 * The same explicit, TES-authored clamd configuration clamd.conf/entrypoint.sh
 * already use (see clamd.conf's own `LocalSocket` directive for the actual
 * Unix socket path) - clamdscan reads this file itself to find the socket,
 * exactly as proven in runtime validation. Not read from an environment
 * variable: this is a fixed container-internal path, not a per-deployment
 * value, matching how entrypoint.sh already references it.
 */
const CLAMD_CONFIG_FILE = "/etc/clamav/clamd.conf";

/**
 * Absolute path to the ClamAV 1.4.6 clamdscan binary, copied from the
 * official Cisco Talos `clamav/clamav-debian` Docker image into /usr/bin -
 * see Dockerfile. Never resolved via a bare "clamdscan" command name/PATH
 * lookup, so this never depends on PATH contents or ordering, matching the
 * same explicit-path approach entrypoint.sh uses for clamd/clamdscan/
 * freshclam.
 */
const CLAMDSCAN_BIN = "/usr/bin/clamdscan";

export interface ClamAvResult {
  outcome: ScanOutcome;
  threatName?: string;
  scannerVersion?: string;
  signatureVersion?: string;
  rawExitCode?: number;
}

const THREAT_LINE_PATTERN = /:\s*(.+?)\s+FOUND\s*$/m;

/**
 * Pure mapping from a clamscan/clamdscan process outcome (exit code + stdout)
 * to a ClamAvResult. Isolated from process execution so it can be unit
 * tested without a real ClamAV installation.
 *
 * `exitCode` is `undefined` for a spawn failure (e.g. ENOENT if clamdscan is
 * not installed) or a timeout-induced kill - neither has a meaningful exit
 * code, and both must map to SCAN_ERROR, never CLEAN. Only a confirmed
 * exit code of 0 is CLEAN; only a confirmed exit code of 1 is
 * THREAT_DETECTED. Every other value (2, or anything unexpected) is
 * SCAN_ERROR - this function never returns CLEAN for a non-zero/unknown
 * outcome, per the fail-closed requirement. This mapping is unchanged from
 * Phase 1: clamdscan shares the exact same 0/1/2 exit-code convention as
 * clamscan (confirmed by direct runtime evidence - a clean scan and an
 * EICAR detection through the real daemon produced the same codes/output
 * shape this function already expected), and a daemon-connection failure or
 * unavailable socket surfaces as just another non-zero/spawn-failure case
 * clamdscan itself reports - already covered here without any new branch.
 */
export function mapExitCodeToResult(exitCode: number | undefined, stdout: string): ClamAvResult {
  if (exitCode === 0) {
    return { outcome: "CLEAN", rawExitCode: 0 };
  }
  if (exitCode === 1) {
    const match = THREAT_LINE_PATTERN.exec(stdout);
    return { outcome: "THREAT_DETECTED", threatName: match?.[1], rawExitCode: 1 };
  }
  return { outcome: "SCAN_ERROR", rawExitCode: exitCode };
}

const DIAGNOSTIC_TEXT_MAX_LENGTH = 200;

/**
 * Redacts anything that looks like a filesystem path from ClamAV's stderr
 * before it is ever logged, and truncates the remainder to a small fixed
 * length. The only paths that can ever appear in this scanner's own
 * `clamdscan` invocation are container-internal (e.g. /var/lib/clamav/...,
 * /etc/clamav/clamd.conf, or this service's own per-invocation temp file
 * path under /tmp) - never a customer filename, a GCS object name, or
 * anything request-derived - but this errs on the side of never logging a
 * path at all regardless, since doing so costs nothing here. Exported for
 * testing.
 */
export function sanitizeClamavDiagnosticText(text: string): string {
  const withoutPaths = text.replace(/\/[^\s:]+/g, "<path>");
  return withoutPaths.replace(/\s+/g, " ").trim().slice(0, DIAGNOSTIC_TEXT_MAX_LENGTH);
}

export type ClamavFailureClassification = "EXIT_CODE" | "TIMEOUT_OR_SIGNAL" | "SPAWN_FAILURE";

export interface ExecFileFailureInfo {
  code?: unknown;
  signal?: unknown;
}

/**
 * Pure classification of an execFile failure into one of three mutually
 * exclusive categories - used only to decide what diagnostic detail to log;
 * it never influences the returned ClamAvResult/ScanOutcome, which continues
 * to come exclusively from mapExitCodeToResult, unchanged. A signal (set by
 * execFile's own `timeout` kill, which defaults to SIGTERM) always indicates
 * a timeout/signal termination even if a numeric code is also present, since
 * a signal-killed process's "exit code" is not a real ClamAV result. A
 * genuine numeric code with no signal is a real ClamAV process exit (e.g. 2
 * for an internal error, including a daemon-connection failure clamdscan
 * itself reports as a non-zero exit). Anything else (e.g. a string errno
 * code such as "ENOENT") is a spawn failure - clamdscan never started at
 * all. Exported for testing.
 */
export function classifyExecFileFailure(info: ExecFileFailureInfo): ClamavFailureClassification {
  if (info.signal) return "TIMEOUT_OR_SIGNAL";
  if (typeof info.code === "number") return "EXIT_CODE";
  return "SPAWN_FAILURE";
}

/**
 * Logs sanitized diagnostic metadata for a SCAN_ERROR outcome only - never
 * for CLEAN or THREAT_DETECTED. Deliberately logs ONLY: the failure
 * classification, the raw code/signal values (small fixed enums/integers,
 * not sensitive), and a path-redacted, truncated stderr excerpt. Never logs
 * the scanned file's path, document contents, GCS object information,
 * credentials, tokens, environment variables, or any other request/customer-
 * controlled text - none of those are ever read by this function in the
 * first place, so none can leak through it.
 */
function logScanErrorDiagnostic(info: ExecFileFailureInfo, stderr: string): void {
  const classification = classifyExecFileFailure(info);
  const sanitizedStderr = sanitizeClamavDiagnosticText(stderr);
  logger.error({
    message: `clamdscan SCAN_ERROR classification=${classification} code=${String(info.code ?? "none")} signal=${String(info.signal ?? "none")} stderr="${sanitizedStderr}"`,
  });
}

/**
 * Scans a single file already on local disk by asking the persistent `clamd`
 * daemon to scan it, via `clamdscan` - never treats a spawn failure, daemon-
 * connection failure, timeout, or unexpected exit code as CLEAN - fail
 * closed. Does not throw; every failure mode maps to outcome "SCAN_ERROR"
 * instead, so callers always get a result to reason about rather than
 * having to separately catch.
 */
export async function scanFile(filePath: string, timeoutMs: number): Promise<ClamAvResult> {
  return new Promise((resolve) => {
    execFile(
      CLAMDSCAN_BIN,
      [`--config-file=${CLAMD_CONFIG_FILE}`, filePath],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        // execFile's `error` carries a numeric `code` for a normal non-zero
        // exit; a killed-by-timeout or spawn failure has no meaningful exit
        // code at all - mapExitCodeToResult treats undefined as SCAN_ERROR.
        // This derivation, and the ClamAvResult it produces, are completely
        // unchanged from before this diagnostic logging was added.
        const failureInfo: ExecFileFailureInfo = { code: (error as ExecFileFailureInfo | null)?.code, signal: (error as ExecFileFailureInfo | null)?.signal };
        const exitCode = error && typeof failureInfo.code === "number"
          ? failureInfo.code
          : error
            ? undefined
            : 0;
        const result = mapExitCodeToResult(exitCode, stdout ?? "");

        if (result.outcome === "SCAN_ERROR") {
          logScanErrorDiagnostic(failureInfo, stderr ?? "");
        }

        resolve(result);
      },
    );
  });
}

export interface ScannerReadinessResult {
  ready: boolean;
  reason?: "SCANNER_SIGNATURES_UNAVAILABLE";
}

/**
 * This value was set to 30s during Phase 1, when readiness ran through
 * standalone `clamscan` and had to cover a full main/daily/bytecode
 * database reload on every check - Cloud Run production testing (revision
 * document-security-scanner-00003-95v) proved that could exceed 10 seconds
 * under real Cloud Run resource allocation (the diagnostic logging added in
 * ca54efa captured this directly: `classification=TIMEOUT_OR_SIGNAL
 * code=none signal=SIGTERM`).
 *
 * As of Phase 2, `scanFile()` (and therefore this readiness check, which
 * calls it) goes through the already-warm, already-loaded `clamd` daemon -
 * direct runtime measurement against the real daemon showed a clean scan
 * completing in ~0.04s and an EICAR detection in ~0.01s, so this readiness
 * check should now complete in well under a second in practice. The 30s
 * value is being kept as a generous safety ceiling rather than tuned down:
 * it only bounds the worst case (e.g. a daemon that is unexpectedly slow or
 * stuck) and does not add any latency to the normal, fast path, so there is
 * no correctness or performance reason to change it in this phase.
 */
export const READINESS_SCAN_TIMEOUT_MS = 30_000;

/**
 * Readiness check for the scanner engine itself (distinct from the HTTP
 * process being alive, which the plain /health endpoint already covers).
 * This validates the exact same daemon-backed path production scans depend
 * on: it calls the same `scanFile()` used by the real scanning flow
 * (src/assessment.ts), so there is no separate/duplicated engine
 * initialization here, and readiness can never pass while the actual scan
 * path is unable to scan.
 *
 * A bare "is clamd reachable" check would only prove the daemon process and
 * socket exist - it says nothing about whether a usable signature database
 * is loaded, or whether a scan actually completes correctly end to end. To
 * establish that, this performs one real scan (through the daemon) of a
 * small, harmless, locally generated temp file (never a document from
 * storage, never anything derived from a request). If ClamAV cannot even
 * scan that trivial file (SCAN_ERROR - e.g. no signature database loaded, a
 * corrupted one, or the daemon itself being unreachable), the scanner is
 * reported not-ready: it would fail closed on every real request today, so
 * it should not be reported healthy. A CLEAN or THREAT_DETECTED result both
 * prove the scan pipeline (daemon connection + loaded database) actually
 * works.
 *
 * This does NOT establish that the database is up to date - only that one
 * is present and usable right now. Periodic signature-freshness monitoring
 * for long-lived Cloud Run instances remains a future production-hardening
 * item; see README.md "Signature update strategy".
 *
 * Exposes only a sanitized {ready, reason} pair - no filesystem paths, no
 * raw ClamAV output, no internal detail of any kind.
 */
export async function scannerReadiness(): Promise<ScannerReadinessResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "tes-scan-readiness-"));
  const tempFilePath = join(tempDir, "readiness-check.bin");
  try {
    await writeFile(tempFilePath, "TES scanner readiness check - not a real document.");
    const result = await scanFile(tempFilePath, READINESS_SCAN_TIMEOUT_MS);
    return result.outcome === "SCAN_ERROR" ? { ready: false, reason: "SCANNER_SIGNATURES_UNAVAILABLE" } : { ready: true };
  } catch {
    return { ready: false, reason: "SCANNER_SIGNATURES_UNAVAILABLE" };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
