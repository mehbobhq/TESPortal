import "server-only"

import {
  configuredBucketNames,
  copyIntakeToEvidenceCreateOnly,
  listStorageObjects,
  readStorageObject,
  statStorageObject,
  uploadQuarantineObject,
} from "@/lib/google/storage"
import type { EvidenceStoragePort } from "@/lib/evidence-payload/ports"

/** The production storage port: keyless GCS access (Workload Identity Federation), create-only writes, no deletes. */
export function createGcsEvidenceStoragePort(): EvidenceStoragePort {
  return {
    async putQuarantine(objectName, bytes, options) {
      await uploadQuarantineObject(objectName, bytes, options)
      // The portal holds create-only rights on quarantine and never reads it back; the scanned generation is pinned from intake.
      return { generation: null }
    },
    statIntake: (objectName) => statStorageObject("intake", objectName),
    readIntake: (objectName, generation) => readStorageObject("intake", objectName, generation),
    copyIntakeToEvidence: async (intakeObjectName, intakeGeneration, evidenceObjectName) => {
      const result = await copyIntakeToEvidenceCreateOnly(intakeObjectName, intakeGeneration, evidenceObjectName)
      return { created: result.created, generation: result.generation }
    },
    statEvidence: (objectName) => statStorageObject("evidence", objectName),
    readEvidence: (objectName, generation) => readStorageObject("evidence", objectName, generation),
    listObjects: (stage, prefix, pageToken) => listStorageObjects(stage, prefix, pageToken),
    bucketNames: () => configuredBucketNames(),
  }
}
