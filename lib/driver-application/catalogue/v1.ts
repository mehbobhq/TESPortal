import type { Catalogue } from "./types"
import { FIELDS_V1 } from "./v1-fields"
import { CONSENTS_V1, HR_ITEMS_V1, LEGAL_SOURCES_V1, REQUIREMENTS_V1, SECTIONS_V1 } from "./v1-rules"

export const CATALOGUE_V1: Catalogue = {
  version: "driver-application/1",
  rulesVersion: "2026-10-r1",
  sections: SECTIONS_V1,
  fields: FIELDS_V1,
  consents: CONSENTS_V1,
  requirements: REQUIREMENTS_V1,
  hrItems: HR_ITEMS_V1,
  legalSources: LEGAL_SOURCES_V1,
}
