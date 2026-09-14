export const AUTO_SAVE_THRESHOLD = 0.98

export interface IngestionDecision {
  action: "AUTO_SAVE" | "REVIEW_REQUIRED"
  reason: string
  lowestConfidenceField?: string
  lowestConfidence?: number
}

export function evaluateIngestionConfidence(
  observations: Array<{
    dataPointId: string
    confidence?: number
    value: unknown
  }>,
  requiredFields: string[]
): IngestionDecision {
  // Check that all required fields are present
  // and every observation meets the threshold

  const missing = requiredFields.filter(
    (field) => !observations.find((o) => o.dataPointId === field)
  )

  if (missing.length > 0) {
    return {
      action: "REVIEW_REQUIRED",
      reason: `Required fields missing: ${missing.join(", ")}`,
    }
  }

  // Find the lowest confidence among required fields
  let lowest = 1.0
  let lowestField = ""

  for (const field of requiredFields) {
    const obs = observations.find((o) => o.dataPointId === field)
    if (obs?.confidence !== undefined && obs.confidence < lowest) {
      lowest = obs.confidence
      lowestField = field
    }
  }

  if (lowest < AUTO_SAVE_THRESHOLD) {
    return {
      action: "REVIEW_REQUIRED",
      reason: `Confidence ${(lowest * 100).toFixed(1)}% below threshold on ${lowestField}`,
      lowestConfidenceField: lowestField,
      lowestConfidence: lowest,
    }
  }

  return {
    action: "AUTO_SAVE",
    reason: `All required fields meet ${AUTO_SAVE_THRESHOLD * 100}% confidence threshold`,
    lowestConfidence: lowest,
  }
}
