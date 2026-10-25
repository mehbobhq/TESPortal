// Regenerates docs/driver-events/field-reconciliation.{json,md}. Run from the repository root:
//   node --experimental-strip-types scripts/driver-events/build-reconciliation.mts
import { writeFileSync } from "node:fs"
await import("../../test/helpers/register-auth-test-loader.mjs")
const doc = await import("@/lib/driver-events/reconciliation-doc")
writeFileSync("docs/driver-events/field-reconciliation.json", JSON.stringify(doc.reconciliationJson(), null, 2) + "\n")
writeFileSync("docs/driver-events/field-reconciliation.md", doc.reconciliationMarkdown() + "\n")
console.log("written")
