import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Behavioral (not string-matching) regression tests for entrypoint.sh's
 * post-startup process-supervision contract. Each test runs the REAL
 * entrypoint.sh via test/lifecycle/run-scenario.sh, against controlled stub
 * `clamd`/`clamdscan`/`freshclam`/`node` executables - never a real ClamAV
 * installation or real Node server - and asserts on the actual observed
 * outcome (the entrypoint's real exit code, and whether the stub processes
 * are actually still running afterward), not on what the script's source
 * text merely says it does. See run-scenario.sh's own header comment for
 * the full harness design.
 *
 * Runs via `sh`/`dash`, which is present in this environment - if `sh` is
 * ever unavailable in a future test environment, these tests would need a
 * different execution strategy, but the production image's own `/bin/sh`
 * (dash) is exactly what is being exercised here, so this is testing the
 * real runtime, not an approximation of it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serviceRoot = join(here, "..", "..");
const harnessPath = join(serviceRoot, "test", "lifecycle", "run-scenario.sh");
const entrypointPath = join(serviceRoot, "entrypoint.sh");

interface ScenarioResult {
  entrypointExitCode?: number;
  clamdAliveAfter?: boolean;
  nodeAliveAfter?: boolean;
  nodeEverStarted?: boolean;
  setupFailed?: string;
}

function runScenario(scenario: string): Promise<ScenarioResult> {
  return new Promise((resolve, reject) => {
    execFile("sh", [harnessPath, scenario, entrypointPath], { timeout: 30_000 }, (error, stdout) => {
      if (error && !stdout) {
        reject(error);
        return;
      }
      const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
      const result: ScenarioResult = {};
      for (const line of lines) {
        const [key, value] = line.split("=");
        if (key === "SETUP_FAILED") result.setupFailed = value;
        if (key === "ENTRYPOINT_EXIT_CODE") result.entrypointExitCode = Number(value);
        if (key === "CLAMD_ALIVE_AFTER") result.clamdAliveAfter = value === "yes";
        if (key === "NODE_ALIVE_AFTER") result.nodeAliveAfter = value === "yes";
        if (key === "NODE_EVER_STARTED") result.nodeEverStarted = value === "yes";
      }
      resolve(result);
    });
  });
}

test("clamd dying unexpectedly after startup stops Node and makes the container exit non-zero (the exact defect a real pkill -TERM clamd exposed)", async () => {
  const result = await runScenario("clamd-dies");
  assert.equal(result.setupFailed, undefined, `harness setup failed: ${result.setupFailed}`);
  assert.notEqual(result.entrypointExitCode, 0, "entrypoint.sh must not exit 0 when a required process died unexpectedly");
  assert.equal(result.nodeAliveAfter, false, "Node must be stopped once clamd has died");
  assert.equal(result.clamdAliveAfter, false);
});

test("Node dying unexpectedly after startup stops clamd, and the container's exit code reflects Node's real failure code", async () => {
  const result = await runScenario("node-dies");
  assert.equal(result.setupFailed, undefined, `harness setup failed: ${result.setupFailed}`);
  assert.equal(result.entrypointExitCode, 7, "entrypoint.sh should propagate the stub Node's real exit code (7)");
  assert.equal(result.clamdAliveAfter, false, "clamd must be stopped once Node has died");
  assert.equal(result.nodeAliveAfter, false);
});

test("the startup readiness gate itself remains intact: clamd dying before it ever becomes ready still fails closed and Node is never started", async () => {
  const result = await runScenario("clamd-dies-during-startup");
  assert.equal(result.setupFailed, undefined, `harness setup failed: ${result.setupFailed}`);
  assert.notEqual(result.entrypointExitCode, 0, "a startup-time clamd failure must not exit 0");
  assert.equal(result.nodeEverStarted, false, "Node must never start if clamd never became ready");
});

test("external SIGTERM performs a coordinated, intentional shutdown and exits 0", async () => {
  const result = await runScenario("sigterm");
  assert.equal(result.setupFailed, undefined, `harness setup failed: ${result.setupFailed}`);
  assert.equal(result.entrypointExitCode, 0, "an intentional platform shutdown must exit 0, not be treated as a failure");
  assert.equal(result.clamdAliveAfter, false);
  assert.equal(result.nodeAliveAfter, false);
});
