/**
 * Single source of truth for the three CARD-CMS-01 test personas — read by
 * seed, cleanup and the harness so the three scripts can never disagree
 * about who "admin", "client" and "no-cms-user" are (CLAUDE.md §6, SSOT).
 *
 * Domain `qa-test.tuggi.app` does not resolve and receives no mail. Every
 * account is created with `email_confirm: true`, so no confirmation email is
 * ever sent to it. The `card-cms-01-` prefix on the local-part is what lets
 * `cleanup-test-accounts.ts` (and any future audit of `auth.users`) find and
 * remove exactly these rows with one `ilike` — see scripts/qa/README.md.
 */

export type Persona = 'admin' | 'client' | 'no-cms-user'

export const TEST_ACCOUNT_DOMAIN = 'qa-test.tuggi.app'
export const TEST_ACCOUNT_PREFIX = 'card-cms-01-'

export const PERSONAS: Persona[] = ['admin', 'client', 'no-cms-user']

export function emailFor(persona: Persona): string {
  return `${TEST_ACCOUNT_PREFIX}${persona}@${TEST_ACCOUNT_DOMAIN}`
}

/** Matches every email this suite could have created — used by cleanup. */
export function isTestAccountEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return email.toLowerCase().endsWith(`@${TEST_ACCOUNT_DOMAIN}`)
}

export const LOCAL_CREDENTIALS_PATH = 'scripts/qa/.test-accounts.local.json'

export interface StoredAccount {
  persona: Persona
  email: string
  userId: string
  password: string
  createdAt: string
}
