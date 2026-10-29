import type { Catalogue } from "./types"
import { CATALOGUE_V1 } from "./v1"
import { CATALOGUE_V2 } from "./v2"

export * from "./types"
export { CATALOGUE_V1, CATALOGUE_V2 }

const REGISTRY = new Map<string, Catalogue>([[CATALOGUE_V1.version, CATALOGUE_V1], [CATALOGUE_V2.version, CATALOGUE_V2]])

/** The catalogue a plan was resolved from. A frozen plan carries its version; later catalogue versions never change it. */
export function getCatalogue(version: string): Catalogue {
  const found = REGISTRY.get(version)
  if (!found) throw new Error(`Unknown application catalogue version: ${version}`)
  return found
}

export const CURRENT_CATALOGUE_VERSION = CATALOGUE_V2.version

/** Registers another catalogue version (new versions are added alongside; a published version is never edited). */
export function registerCatalogue(catalogue: Catalogue): void {
  if (REGISTRY.has(catalogue.version) && REGISTRY.get(catalogue.version) !== catalogue) throw new Error("A published catalogue version cannot be replaced.")
  REGISTRY.set(catalogue.version, catalogue)
}
