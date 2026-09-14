/**
 * TES Audit Log — PIN gate.
 *
 * The PIN value itself is never stored anywhere — only its SHA-256 hash,
 * in localStorage. This is a second factor layered on top of the
 * role-based access check (role === "SYSTEM_ADMIN") that gates the
 * Audit Log section in Settings; it is not a substitute for that check.
 */

import { logAuditEvent } from "./audit-log"

const PIN_HASH_KEY = "tes_audit_pin_hash"
const ATTEMPTS_KEY = "tes_audit_attempts"
const LOCKOUT_KEY = "tes_audit_lockout"
const VERIFIED_KEY = "tes_audit_verified"
const MAX_ATTEMPTS = 3
const LOCKOUT_MS = 30 * 60 * 1000

export async function hashPIN(pin: string): Promise<string> {
  const encoded = new TextEncoder().encode(pin)
  const buffer = await crypto.subtle.digest("SHA-256", encoded)
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function verifyPIN(input: string): Promise<boolean> {
  const stored = localStorage.getItem(PIN_HASH_KEY)
  if (!stored) return false

  const inputHash = await hashPIN(input)
  const match = inputHash === stored

  if (!match) {
    const attempts = Number(sessionStorage.getItem(ATTEMPTS_KEY) || "0") + 1
    sessionStorage.setItem(ATTEMPTS_KEY, String(attempts))
    logAuditEvent({ e: "ADMIN_PIN_FAILED", det: `Attempt ${attempts} of ${MAX_ATTEMPTS}` })
    if (attempts >= MAX_ATTEMPTS) {
      sessionStorage.setItem(LOCKOUT_KEY, String(Date.now() + LOCKOUT_MS))
      logAuditEvent({ e: "ADMIN_PIN_LOCKOUT", det: "30 minute lockout" })
    }
  } else {
    sessionStorage.removeItem(ATTEMPTS_KEY)
  }

  return match
}

export function isLockedOut(): boolean {
  const until = Number(sessionStorage.getItem(LOCKOUT_KEY) || "0")
  return Date.now() < until
}

export function lockoutRemainingMinutes(): number {
  const until = Number(sessionStorage.getItem(LOCKOUT_KEY) || "0")
  return Math.ceil((until - Date.now()) / 60000)
}

export function remainingAttempts(): number {
  const attempts = Number(sessionStorage.getItem(ATTEMPTS_KEY) || "0")
  return Math.max(0, MAX_ATTEMPTS - attempts)
}

export async function setPIN(pin: string): Promise<void> {
  const hash = await hashPIN(pin)
  localStorage.setItem(PIN_HASH_KEY, hash)
  logAuditEvent({ e: "ADMIN_PIN_SET", det: "Audit log PIN configured" })
}

export function isPINConfigured(): boolean {
  return !!localStorage.getItem(PIN_HASH_KEY)
}

export function isAuditSessionVerified(): boolean {
  return sessionStorage.getItem(VERIFIED_KEY) === "true"
}

export function setAuditSessionVerified(): void {
  sessionStorage.setItem(VERIFIED_KEY, "true")
}
