/**
 * Pure helpers (view reference, Eastern timestamp) used by the document viewer and watermark. Copied from lib/audit-logger.ts,
 * whose event buffer lives in browser storage; these two functions touch no storage.
 */

/**
 * Generate a short, human-readable forensic View Reference (e.g. VW-8F42C910)
 * Uses cryptographically secure browser-supported randomness (crypto.getRandomValues / crypto.randomUUID).
 */
export function generateViewRef(): string {
  try {
    if (typeof globalThis !== "undefined" && globalThis.crypto) {
      if (typeof globalThis.crypto.getRandomValues === "function") {
        const buffer = new Uint8Array(4); // 4 bytes = 8 hex characters
        globalThis.crypto.getRandomValues(buffer);
        const hex = Array.from(buffer)
          .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
          .join("");
        return `VW-${hex}`;
      }
      if (typeof globalThis.crypto.randomUUID === "function") {
        const uuid = globalThis.crypto.randomUUID().replace(/-/g, "").toUpperCase();
        return `VW-${uuid.slice(0, 8)}`;
      }
    }
  } catch {
    // Fallback if crypto access fails
  }

  // Graceful fallback for non-crypto runtime environments
  const timestampHex = Date.now().toString(16).slice(-4).toUpperCase();
  const hexPart = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0").toUpperCase();
  return `VW-${timestampHex}${hexPart}`;
}

/**
 * Format timestamp in America/New_York (Eastern Time).
 * Dynamically resolves "EST" (Eastern Standard Time, UTC-5) or "EDT" (Eastern Daylight Time, UTC-4)
 * based on daylight saving rules.
 * If abbreviation resolution unexpectedly fails, uses the truthful neutral fallback "ET" (never guesses).
 * Output format: YYYY-MM-DD HH:MM:SS [EST|EDT|ET]
 */
export function formatEasternTimestamp(dateInput?: Date | string | number): string {
  let date: Date;
  if (!dateInput) {
    date = new Date();
  } else if (typeof dateInput === "string" || typeof dateInput === "number") {
    date = new Date(dateInput);
  } else {
    date = dateInput;
  }

  if (isNaN(date.getTime())) {
    date = new Date();
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  let tz = partMap["timeZoneName"] || "";
  if (tz === "GMT-4" || tz === "EDT" || tz === "Eastern Daylight Time") {
    tz = "EDT";
  } else if (tz === "GMT-5" || tz === "EST" || tz === "Eastern Standard Time") {
    tz = "EST";
  } else {
    // Truthful neutral fallback if timeZoneName is unresolvable
    tz = "ET";
  }

  const year = partMap["year"] || String(date.getFullYear());
  const month = partMap["month"] || String(date.getMonth() + 1).padStart(2, "0");
  const day = partMap["day"] || String(date.getDate()).padStart(2, "0");
  const hour = partMap["hour"] || String(date.getHours()).padStart(2, "0");
  const minute = partMap["minute"] || String(date.getMinutes()).padStart(2, "0");
  const second = partMap["second"] || String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${tz}`;
}
