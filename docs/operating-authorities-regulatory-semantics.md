# Operating Authorities: regulatory semantics (migration 0013)

Records what the 0013 schema asserts about each kind and what it deliberately does not. Evidence was gathered from
regulator pages through search excerpts (direct page fetches were not possible in the build environment); anything not
confirmed is marked and encoded conservatively.

| Kind | Issuer / meaning | Scope | Concurrent per Organization | Jurisdiction | Collision namespace | Format rule |
|---|---|---|---|---|---|---|
| USDOT | FMCSA safety registration number, assigned once to a legal person, non-transferable | US national | **One** (FMCSA: one per legal person, kept forever) - database enforced | none | kind | PERMISSIVE `usdot.numeric_permissive.v1` |
| MC | FMCSA MC-prefixed docket of an operating authority registration (FF / MX are other prefixes, not modelled) | US national | Not claimed (an entity may need several operating authorities) | none | kind | PERMISSIVE `mc.numeric_permissive.v1` |
| MVID | Provincial motor-vehicle client identifier (Alberta Registries uses MVID; other issuers unconfirmed) | provincial | Not claimed | issuing province: version attribute + namespace | kind + province | PERMISSIVE `authority_identifier.permissive.v1` |
| RIN | Ontario MTO / ServiceOntario Registrant Identification Number (businesses and individuals registering vehicles) | Ontario | Not claimed (ServiceOntario can merge duplicate RINs) | fixed ON | kind + ON | AUTHORITATIVE `rin.ontario_nine_digit.v1` (nine digits) |
| CVOR | Ontario operator registration; certificate carries a unique nine-digit number | Ontario | Not claimed (one certificate per operator is implied, not stated) | fixed ON | kind + ON | AUTHORITATIVE `cvor.ontario_nine_digit.v1` (nine digits) |
| SAFETY_FITNESS | National Safety Code carrier number / safety fitness certificate assigned by the carrier's home province or territory (Ontario's equivalent is the CVOR) | provincial | Not claimed | issuing province: version attribute + namespace | kind + province | PERMISSIVE `authority_identifier.permissive.v1` |
| IRP | International Registration Plan account issued by the registrant's base jurisdiction; fleets are separate applications | program (base jurisdiction) | Not claimed (multiple fleets / accounts are legitimate) | base jurisdiction: effective-dated version attribute; a move is a real transition, a wrong value a correction | kind + base jurisdiction | PERMISSIVE `authority_identifier.permissive.v1` |

Jurisdiction is never part of Organization identity. It is a version attribute and part of the number's collision
namespace. Only IRP supports an in-place jurisdiction change; for every other kind a different issuer is a different
identifier (record a separate authority); a wrong value is corrected.

Status history stores observed regulatory status. No universal transition matrix is enforced (legality differs by
regulator and kind and belongs to the Rules / authority-policy layer). A return to ACTIVE after the authority was ACTIVE
before is recorded as a REACTIVATION of the same authority. Archive is TES record lifecycle, allowed in any regulatory
status; an archived authority keeps holding its number (and, for USDOT, its identity).

Sources: FMCSA (USDOT number, operating authority / docket FAQs, registration modernization FAQs, Motus changes);
Ontario MTO (Commercial Vehicle Operators' Safety Manual; ServiceOntario RIN forms on00453 / on00267); CCMTA National
Safety Code and Transport Canada safety-fitness material; Alberta Registries / Alberta Transportation (MVID, NSC carrier
profile); IRP Inc. plan definitions as quoted by state IRP offices (base jurisdiction, fleets, account number).
