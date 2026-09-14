/**
 * TES has no standing authentication system yet — every page in the
 * portal currently attributes actions to a single hardcoded
 * "System Administrator" actor (see components/app-sidebar.tsx footer).
 *
 * This helper centralizes that same implicit identity so role-gated UI
 * (like the Audit Log section in Settings) has one place to read from
 * instead of re-hardcoding the role check everywhere. When TES gains real
 * authentication, this is the only place that needs to change.
 */

export type UserRole = "SYSTEM_ADMIN" | "STANDARD_USER"

export interface CurrentUser {
  id: string
  name: string
  role: UserRole
}

export function getCurrentUser(): CurrentUser {
  return {
    id: "USR-SYSADMIN",
    name: "System Administrator",
    role: "SYSTEM_ADMIN",
  }
}
