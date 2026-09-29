import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ScanOutcome } from "./types.js";

/**
 * ClamAV execution model - Phase 1.
 *
 * Uses standalone `clamscan` (not a clamd daemon/socket) for the simplest
 * reliable first implementation: no daemon process to supervise, no
 * Unix-socket permission surface inside the container. The tradeoff is that
 * `clamscan` reloads the full signature database on every invocation, which
 * is measurably slower than a warm `clamdscan` client call - see this
 * service's README "Signature update / scan latency strategy" section for
 * why this is flagged as a documented future improvement, not a defect.
 *
 * Every call goes through node:child_process.execFile with an argument
 * array - never a shell string - so no user- or event-derived value is ever
 * capable of command injection or shell interpolation. Nothing in this
 * module accepts or constructs a shell command string.
 */

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
 * `exitCode` is `undefined` for a spawn failure (e.g. ENOENT if clamscan is
 * not installed) or a timeout-induced kill - neither has a meaningful exit
 * code, and both must map to SCAN_ERROR, never CLEAN. Only a confirmed
 * exit code of 0 is CLEAN; only a confirmed exit code of 1 is
 * THREAT_DETECTED. Every other value (2, or anything unexpected) is
 * SCAN_ERROR - this function never returns CLEAN for a non-zero/unknown
 * outcome, per the fail-closed requirement.
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

/**
 * Scans a single file already on local disk. Never treats a spawn failure,
 * timeout, or unexpected exit code as CLEAN - fail closed. Does not throw;
 * every failure mode maps to outcome "SCAN_ERROR" instead, so callers always
 * get a result to reason about rather than having to separately catch.
 */
export async function scanFile(filePath: string, timeoutMs: number): Promise<ClamAvResult> {
  return new Promise((resolve) => {
    execFile(
      "clamscan",
      ["--no-summary", filePath],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        // execFile's `error` carries a numeric `code` for a normal non-zero
        // exit; a killed-by-timeout or spawn failure has no meaningful exit
        // code at all - mapExitCodeToResult treats undefined as SCAN_ERROR.
        const exitCode = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
          ? (error as unknown as { code: number }).code
          : error
            ? undefined
            : 0;
        resolve(mapExitCodeToResult(exitCode, stdout ?? ""));
      },
    );
  });
}

export interface ScannerReadinessResult {
  ready: boolean;
  reason?: "SCANNER_SIGNATURES_UNAVAILABLE";
}

/**
 * Readiness check for the scanner engine itself (distinct from the HTTP
 * process being alive, which the plain /health endpoint already covers).
 *
 * A `clamscan --version` response only proves the binary exists and runs -
 * it says nothing about whether a usable signature database is loaded. To
 * actually establish that, this performs one real scan of a small, harmless,
 * locally generated temp file (never a document from storage, never
 * anything derived from a request). If ClamAV cannot even scan that trivial
 * file (SCAN_ERROR - e.g. no signature database present, or a corrupted
 * one), the scanner is reported not-ready: it would fail closed on every
 * real request today, so it should not be reported healthy. A CLEAN or
 * THREAT_DETECTED result both prove the scan pipeline (binary + loaded
 * database) actually works.
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
    const result = await scanFile(tempFilePath, 10_000);
    return result.outcome === "SCAN_ERROR" ? { ready: false, reason: "SCANNER_SIGNATURES_UNAVAILABLE" } : { ready: true };
  } catch {
    return { ready: false, reason: "SCANNER_SIGNATURES_UNAVAILABLE" };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
