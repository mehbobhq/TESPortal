// Pure helpers copied from lib/audit-logger.ts (the browser-held audit log itself is deliberately not used here).

/** A short, human-readable view reference (for example VW-8F42C910) from secure randomness. */
export function generateViewRef(): string {
  try {
    if (typeof globalThis !== "undefined" && globalThis.crypto) {
      if (typeof globalThis.crypto.getRandomValues === "function") {
        const buffer = new Uint8Array(4);
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
    // fall through to the non-crypto fallback
  }
  const timestampHex = Date.now().toString(16).slice(-4).toUpperCase();
  const hexPart = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0").toUpperCase();
  return `VW-${timestampHex}${hexPart}`;
}

/** Eastern Time timestamp: YYYY-MM-DD HH:MM:SS [EST|EDT|ET]. */
export function formatEasternTimestamp(dateInput?: Date | string | number): string {
  let date: Date;
  if (!dateInput) date = new Date();
  else if (typeof dateInput === "string" || typeof dateInput === "number") date = new Date(dateInput);
  else date = dateInput;
  if (isNaN(date.getTime())) date = new Date();

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
  const partMap: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) partMap[part.type] = part.value;

  let tz = partMap["timeZoneName"] || "";
  if (tz === "GMT-4" || tz === "EDT" || tz === "Eastern Daylight Time") tz = "EDT";
  else if (tz === "GMT-5" || tz === "EST" || tz === "Eastern Standard Time") tz = "EST";
  else tz = "ET";

  const year = partMap["year"] || String(date.getFullYear());
  const month = partMap["month"] || String(date.getMonth() + 1).padStart(2, "0");
  const day = partMap["day"] || String(date.getDate()).padStart(2, "0");
  const hour = partMap["hour"] || String(date.getHours()).padStart(2, "0");
  const minute = partMap["minute"] || String(date.getMinutes()).padStart(2, "0");
  const second = partMap["second"] || String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${tz}`;
}
