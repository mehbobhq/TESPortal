/**
 * Pure Generic Duplicate Comparison Primitives for TES Portal.
 * Compares normalized identity keys, emails, phones, and compound identity elements.
 * Returns match classification only (ExactIdentifierConflict, StrongIdentityMatch, PossibleMatch, NoMatch).
 * The consuming business module decides whether to BLOCK, REUSE, REVIEW, or WARN.
 * RULE: Name alone NEVER triggers an automatic person identity match.
 */

export type MatchClassification =
  | "ExactIdentifierConflict"
  | "StrongIdentityMatch"
  | "PossibleMatch"
  | "NoMatch";

export interface DuplicateFinding {
  classification: MatchClassification;
  matchedField: string;
  matchedValue: string;
  conflictEntityId: string;
  conflictEntityLabel?: string;
  confidenceScore: number; // 0 to 100
  notes: string;
}

/**
 * Compare two single regulatory/system identifiers (e.g., VIN, USDOT, MC, Tax ID).
 */
export function compareExactIdentifier(
  targetValue: string | undefined | null,
  candidateValue: string | undefined | null,
  fieldLabel: string,
  candidateEntityId: string,
  candidateEntityLabel?: string
): DuplicateFinding | null {
  if (!targetValue || !candidateValue) return null;

  const cleanTarget = targetValue.trim().toUpperCase();
  const cleanCandidate = candidateValue.trim().toUpperCase();

  if (!cleanTarget || !cleanCandidate) return null;

  if (cleanTarget === cleanCandidate) {
    return {
      classification: "ExactIdentifierConflict",
      matchedField: fieldLabel,
      matchedValue: cleanTarget,
      conflictEntityId: candidateEntityId,
      conflictEntityLabel: candidateEntityLabel,
      confidenceScore: 100,
      notes: `Exact regulatory identifier collision on ${fieldLabel}: "${cleanTarget}".`,
    };
  }

  return null;
}

/**
 * Compare person identities using compound verification.
 * MANDATE: Full name alone is strictly insufficient for StrongIdentityMatch.
 * Requires Name + DOB or Name + Phone or Name + Licence.
 */
export function comparePersonIdentity(
  target: { name?: string; dob?: string; phone?: string; email?: string; licenseNumber?: string },
  candidate: { id: string; label?: string; name?: string; dob?: string; phone?: string; email?: string; licenseNumber?: string }
): DuplicateFinding | null {
  const norm = (s?: string) => s?.trim().toLowerCase() ?? "";

  const nameMatch = norm(target.name) && norm(target.name) === norm(candidate.name);
  const dobMatch = target.dob && candidate.dob && target.dob === candidate.dob;
  const phoneMatch = norm(target.phone) && norm(target.phone) === norm(candidate.phone);
  const emailMatch = norm(target.email) && norm(target.email) === norm(candidate.email);
  const licMatch = norm(target.licenseNumber) && norm(target.licenseNumber) === norm(candidate.licenseNumber);

  // 1. Direct Unique Identifier Collision
  if (licMatch) {
    return {
      classification: "ExactIdentifierConflict",
      matchedField: "Driver License",
      matchedValue: target.licenseNumber!,
      conflictEntityId: candidate.id,
      conflictEntityLabel: candidate.label || candidate.name,
      confidenceScore: 100,
      notes: "Exact driver license collision.",
    };
  }

  // 2. Strong Compound Identity Match (Name + DOB or Name + Phone/Email)
  if (nameMatch && dobMatch) {
    return {
      classification: "StrongIdentityMatch",
      matchedField: "Name + Date of Birth",
      matchedValue: `${target.name} (${target.dob})`,
      conflictEntityId: candidate.id,
      conflictEntityLabel: candidate.label || candidate.name,
      confidenceScore: 95,
      notes: "Verified full name and date of birth match.",
    };
  }

  if (nameMatch && (phoneMatch || emailMatch)) {
    return {
      classification: "StrongIdentityMatch",
      matchedField: "Name + Contact Point",
      matchedValue: `${target.name} (${target.email || target.phone})`,
      conflictEntityId: candidate.id,
      conflictEntityLabel: candidate.label || candidate.name,
      confidenceScore: 90,
      notes: "Full name and direct contact endpoint match.",
    };
  }

  // 3. Possible Match (Email or Phone match without name match, or Name match alone)
  if (emailMatch || phoneMatch) {
    return {
      classification: "PossibleMatch",
      matchedField: emailMatch ? "Email Address" : "Phone Number",
      matchedValue: (target.email || target.phone)!,
      conflictEntityId: candidate.id,
      conflictEntityLabel: candidate.label || candidate.name,
      confidenceScore: 60,
      notes: "Shared contact endpoint across differing entity names.",
    };
  }

  if (nameMatch) {
    return {
      classification: "PossibleMatch",
      matchedField: "Name Only",
      matchedValue: target.name!,
      conflictEntityId: candidate.id,
      conflictEntityLabel: candidate.label || candidate.name,
      confidenceScore: 35,
      notes: "Identical name found without corroborating date of birth or direct contact point. Requires manual disambiguation.",
    };
  }

  return null;
}
