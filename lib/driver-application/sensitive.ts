import "server-only"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * Application-level envelope for sensitive identifiers (SSN, SIN, passport number).
 *
 *  - AES-256-GCM; the key never touches PostgreSQL or the browser. The ciphertext binds the application and field (AAD), so a value cannot be
 *    moved to another application or field.
 *  - Collection is OFF unless BOTH gates hold: a configured key (TES_SENSITIVE_DATA_KEY, 32 bytes base64, with TES_SENSITIVE_DATA_KEY_ID for rotation)
 *    and an explicit legal approval of that field (TES_SENSITIVE_FIELDS_APPROVED, comma-separated field ids). Neither is set by this code.
 *  - Only a masked display is ever stored beside the ciphertext. Plaintext is never logged, put in JSON, in the PDF or in an error.
 *  - Production note: the key is currently an environment secret. Moving it behind Cloud KMS (wrapping a per-record data key) is a deployment hardening
 *    step that does not change this interface.
 */

const ALGORITHM = "aes-256-gcm"

export function vaultKey(): { key: Buffer; id: string } | null {
  const raw = process.env.TES_SENSITIVE_DATA_KEY?.trim()
  if (!raw) return null
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) return null
  return { key, id: process.env.TES_SENSITIVE_DATA_KEY_ID?.trim() || "env-1" }
}

export const vaultReady = () => vaultKey() !== null
export const approvedSensitiveFields = () => (process.env.TES_SENSITIVE_FIELDS_APPROVED ?? "").split(",").map((s) => s.trim()).filter(Boolean)

export class SensitiveValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SensitiveValueError"
  }
}

const aad = (applicationId: string, fieldId: string) => Buffer.from(`tes-driver-application:${applicationId}:${fieldId}`, "utf8")

export function encryptSensitive(applicationId: string, fieldId: string, plaintext: string): { ciphertext: Buffer; nonce: Buffer; keyId: string } {
  const k = vaultKey()
  if (!k) throw new SensitiveValueError("Encrypted storage is not configured.")
  const nonce = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, k.key, nonce)
  cipher.setAAD(aad(applicationId, fieldId))
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce, keyId: k.id }
}

export function decryptSensitive(applicationId: string, fieldId: string, ciphertext: Buffer, nonce: Buffer): string {
  const k = vaultKey()
  if (!k) throw new SensitiveValueError("Encrypted storage is not configured.")
  const tag = ciphertext.subarray(ciphertext.length - 16)
  const body = ciphertext.subarray(0, ciphertext.length - 16)
  const decipher = createDecipheriv(ALGORITHM, k.key, nonce)
  decipher.setAAD(aad(applicationId, fieldId))
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")
  } catch {
    throw new SensitiveValueError("The stored value could not be verified.")
  }
}

const digits = (s: string) => s.replace(/\D/g, "")

function luhn(num: string) {
  let sum = 0
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** Format validation only (never lookup, never eligibility): returns the normalized value and the masked display, or throws. */
export function normalizeSensitive(fieldId: string, raw: string): { normalized: string; masked: string } {
  const text = raw.trim()
  if (fieldId === "eligibility.ssn") {
    const d = digits(text)
    if (!/^\d{9}$/.test(d) || /^(000|666|9)/.test(d) || d.slice(3, 5) === "00" || d.slice(5) === "0000") throw new SensitiveValueError("Enter a valid Social Security number.")
    return { normalized: d, masked: `***-**-${d.slice(5)}` }
  }
  if (fieldId === "eligibility.sin") {
    const d = digits(text)
    if (!/^\d{9}$/.test(d) || !luhn(d)) throw new SensitiveValueError("Enter a valid Social Insurance Number.")
    return { normalized: d, masked: `***-***-${d.slice(6)}` }
  }
  if (fieldId === "eligibility.passport_number") {
    const v = text.toUpperCase().replace(/\s+/g, "")
    if (!/^[A-Z0-9]{6,12}$/.test(v)) throw new SensitiveValueError("Enter a valid passport number.")
    return { normalized: v, masked: `${"*".repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` }
  }
  throw new SensitiveValueError("That information is not collected here.")
}
