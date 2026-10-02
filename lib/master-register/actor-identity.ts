/**
 * TES Master Register — actor identity contract.
 *
 * This phase does NOT implement authentication/authorization or an actor
 * directory. It only fixes how an actor is represented once identified
 * elsewhere, so later phases don't need to change every event's shape.
 *
 * actorId is an immutable, opaque TES identifier. It must never be a
 * display name, email, job title, or any other human-readable label, and
 * it must never be inferred from one — two different people named "J.
 * Smith" (or one person renamed) must never collapse to or split from the
 * same actorId. Today, TES has exactly one implicit actor for the whole
 * portal (see lib/current-user.ts) and no real actor directory; this
 * contract is intentionally satisfied by that single hardcoded actor for
 * now, and is not itself a claim that real identity exists yet.
 *
 * Non-human actors (SYSTEM, AUTOMATION, INTEGRATION, SERVICE_ACCOUNT) carry
 * their own specific actorId exactly like a human actor does — "the
 * system" is never an acceptable actorId on its own.
 */

import { IDENTIFIER_MAX_LENGTH } from "./limits.ts";
import type { ActorType, EventActor } from "./types.ts";

export class InvalidActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidActorError";
  }
}

const VALID_ACTOR_TYPES: readonly ActorType[] = ["HUMAN", "SYSTEM", "AUTOMATION", "INTEGRATION", "SERVICE_ACCOUNT"];

export function validateActor(actor: EventActor): void {
  if (!VALID_ACTOR_TYPES.includes(actor.actorType)) {
    throw new InvalidActorError(`"${String(actor.actorType)}" is not a recognized actor type.`);
  }
  if (typeof actor.actorId !== "string" || actor.actorId.trim().length === 0) {
    throw new InvalidActorError("actorId is required and must be a non-empty opaque identifier (never a display name).");
  }
  if (actor.actorId.length > IDENTIFIER_MAX_LENGTH) {
    throw new InvalidActorError(`actorId must not exceed ${IDENTIFIER_MAX_LENGTH} characters (got ${actor.actorId.length}).`);
  }
}
