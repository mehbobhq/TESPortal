import assert from "node:assert/strict";
import { test } from "node:test";

import { scannerReadiness } from "../src/clamav.js";

test("readiness reports not-ready with a sanitized reason when ClamAV cannot complete a real scan (e.g. not installed, or no signature database)", async () => {
  // This dev/test environment does not have ClamAV installed, which is
  // exactly the "signatures unavailable" scenario this check exists to
  // catch - scannerReadiness() must fail closed here, not throw and not
  // report ready:true.
  const result = await scannerReadiness();
  assert.equal(result.ready, false);
  assert.equal(result.reason, "SCANNER_SIGNATURES_UNAVAILABLE");
  // Sanitized shape only - no filesystem paths or raw command output.
  assert.deepEqual(Object.keys(result).sort(), ["ready", "reason"]);
});
