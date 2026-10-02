/**
 * TES Master Register — server-authoritative write path.
 *
 * Application/Next.js code recording an event must import from HERE, never
 * directly from "./record-event.ts" and never via "./index.ts" (index.ts
 * deliberately does not re-export record-event.ts — see its own header
 * comment). This file is guarded by the `server-only` marker package:
 * importing it from client-bundled code throws immediately rather than
 * silently shipping the write path to the browser.
 *
 * record-event.ts itself does not import `server-only` directly — see that
 * file's own header comment for why (it would break the test suite, which
 * imports it directly under plain Node, where `server-only` is not a no-op).
 * Guarding it here, at the one path real server code is expected to use,
 * achieves the same boundary without that conflict.
 */
import "server-only";

export * from "./record-event.ts";
