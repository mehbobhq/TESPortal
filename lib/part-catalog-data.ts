/**
 * Part catalog + fuzzy description matching.
 *
 * This project has no SQL database (no Postgres/pg_trgm, no ORM — every
 * existing data model in this app, e.g. lib/vehicle-data.ts, is persisted to
 * localStorage). Per product direction, this stays localStorage-backed for
 * now; documents will move to Google Storage later, and this module can be
 * swapped for real API calls without changing its call sites, since every
 * function here is already async-free and pure/storage-isolated.
 *
 * Trigram similarity below is a pure-JS reimplementation of Postgres'
 * pg_trgm `similarity()` (3-character n-grams, Dice coefficient) so the
 * matching behavior is the closest available equivalent on this stack.
 */

import { createId, isoNow } from "./vehicle-data";

export interface PartCatalogEntry {
  id: string;
  canonicalName: string;
  category: string;
  synonyms: string[];
  createdAt: string;
}

export const PART_CATALOG_STORAGE_KEY = "tes_part_catalog";

/** Below this similarity score, a description is left unmatched. */
export const PART_MATCH_MIN_CONFIDENCE = 0.35;
/** Below this (but at/above the min), a match is kept but flagged for manual review. */
export const PART_MATCH_REVIEW_CONFIDENCE = 0.6;

export interface PartMatchResult {
  matchedPartId: string;
  confidence: number;
  needsReview: boolean;
}

const SEED_PART_CATALOG: Omit<PartCatalogEntry, "id" | "createdAt">[] = [
  { canonicalName: "Alternator", category: "Electrical", synonyms: ["alt", "alternator assy", "alternator assembly"] },
  { canonicalName: "Starter Motor", category: "Electrical", synonyms: ["starter", "starter motor assy"] },
  { canonicalName: "Battery", category: "Electrical", synonyms: ["batt", "12v battery", "truck battery"] },
  { canonicalName: "Serpentine Belt", category: "Belts", synonyms: ["drive belt", "fan belt", "accessory belt", "serp belt"] },
  { canonicalName: "Timing Belt", category: "Belts", synonyms: ["cam belt"] },
  { canonicalName: "Brake Pads", category: "Brakes", synonyms: ["pads", "brake pad set", "front pads", "rear pads"] },
  { canonicalName: "Brake Rotor", category: "Brakes", synonyms: ["rotor", "disc rotor", "brake disc"] },
  { canonicalName: "Brake Drum", category: "Brakes", synonyms: ["drum", "brake drum assy"] },
  { canonicalName: "Brake Chamber", category: "Brakes", synonyms: ["air chamber", "brake booster chamber"] },
  { canonicalName: "Air Filter", category: "Filters", synonyms: ["air cleaner element", "engine air filter"] },
  { canonicalName: "Oil Filter", category: "Filters", synonyms: ["engine oil filter", "lube filter"] },
  { canonicalName: "Fuel Filter", category: "Filters", synonyms: ["fuel water separator filter"] },
  { canonicalName: "Engine Oil", category: "Fluids", synonyms: ["motor oil", "15w40", "lube oil"] },
  { canonicalName: "Coolant", category: "Fluids", synonyms: ["antifreeze", "engine coolant"] },
  { canonicalName: "Tire", category: "Tires", synonyms: ["tyre", "steer tire", "drive tire", "trailer tire"] },
  { canonicalName: "Wheel Seal", category: "Wheel End", synonyms: ["hub seal", "axle seal"] },
  { canonicalName: "Wheel Bearing", category: "Wheel End", synonyms: ["hub bearing", "bearing kit"] },
  { canonicalName: "Shock Absorber", category: "Suspension", synonyms: ["shock", "shock strut"] },
  { canonicalName: "Air Bag Suspension", category: "Suspension", synonyms: ["air spring", "air bag", "suspension bag"] },
  { canonicalName: "Reefer Unit Service", category: "Reefer", synonyms: ["reefer pm", "refrigeration unit service"] },
  { canonicalName: "Labor", category: "Labor", synonyms: ["shop labor", "labour", "diagnostic labor"] },
];

export function loadPartCatalog(): PartCatalogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PART_CATALOG_STORAGE_KEY);
    if (!raw) {
      const seeded = seedPartCatalog();
      return seeded;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PartCatalogEntry[]) : [];
  } catch {
    return [];
  }
}

export function savePartCatalog(catalog: PartCatalogEntry[]): void {
  try {
    localStorage.setItem(PART_CATALOG_STORAGE_KEY, JSON.stringify(catalog));
  } catch {}
}

function seedPartCatalog(): PartCatalogEntry[] {
  const now = isoNow();
  const catalog: PartCatalogEntry[] = SEED_PART_CATALOG.map((entry) => ({
    ...entry,
    id: createId("PART"),
    createdAt: now,
  }));
  savePartCatalog(catalog);
  return catalog;
}

/** Lowercase, strip qty/unit tokens and punctuation, collapse whitespace. */
export function normalizePartDescription(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(x|qty|ea|each|pcs?|units?|mm|cm|in|inch(es)?|ft|"|')\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value}  `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** pg_trgm-equivalent similarity: Dice coefficient over 3-character n-grams, in [0, 1]. */
export function trigramSimilarity(a: string, b: string): number {
  const left = normalizePartDescription(a);
  const right = normalizePartDescription(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const gramsA = trigrams(left);
  const gramsB = trigrams(right);
  if (gramsA.size === 0 || gramsB.size === 0) return 0;
  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (gramsA.size + gramsB.size);
}

/**
 * Fuzzy-match a raw invoice-line description against the part catalog.
 * Returns null when the best score is below PART_MATCH_MIN_CONFIDENCE.
 * Scores at/above PART_MATCH_MIN_CONFIDENCE but below
 * PART_MATCH_REVIEW_CONFIDENCE are still returned, flagged `needsReview`.
 */
export function matchPartToCatalog(
  rawDescription: string,
  catalog: PartCatalogEntry[] = loadPartCatalog()
): PartMatchResult | null {
  const normalized = normalizePartDescription(rawDescription);
  if (!normalized) return null;

  let best: { id: string; score: number } | null = null;
  for (const entry of catalog) {
    const candidates = [entry.canonicalName, ...entry.synonyms];
    for (const candidate of candidates) {
      const score = trigramSimilarity(normalized, candidate);
      if (!best || score > best.score) {
        best = { id: entry.id, score };
      }
    }
  }

  if (!best || best.score < PART_MATCH_MIN_CONFIDENCE) return null;

  return {
    matchedPartId: best.id,
    confidence: Math.round(best.score * 1000) / 1000,
    needsReview: best.score < PART_MATCH_REVIEW_CONFIDENCE,
  };
}
