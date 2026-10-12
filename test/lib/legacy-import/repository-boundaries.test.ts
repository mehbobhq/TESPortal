import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const REPOSITORY = path.join(ROOT, "lib/legacy-import/repository.ts")

function source(): string {
  return readFileSync(REPOSITORY, "utf8")
}

describe("legacy import repository boundaries", () => {
  it("only replays staged records when source content is unchanged", () => {
    const code = source()

    assert.match(code, /ON CONFLICT \(import_batch_id, source_key\) DO UPDATE/)
    assert.match(code, /WHERE public\.legacy_import_records\.source_sha256 = EXCLUDED\.source_sha256/)
    assert.match(code, /source key already exists with different source content/i)
  })

  it("checkpoints staged imports before processing and after failures", () => {
    const code = source()

    assert.match(code, /checkpointStatus: "running"/)
    assert.match(code, /checkpointStatus: "failed"/)
    assert.match(code, /checkpointStatus: failedCount > 0 \? "failed" : "completed"/)
  })
})
