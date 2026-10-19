/**
 * The "define your password" e-mail of the CMS, one implementation for both senders (#941, #969):
 * the invite to an address that already has an Auth account, and the "send password link" action
 * of the user editor.
 *
 * An admin never sets someone else's password. The CMS row is tied to the Auth account only by
 * e-mail, and that account may be a tourist of the app; the link goes to the owner of the
 * address, who is the only one who can use it.
 */

import type { NextRequest } from 'next/server'
import type { getSupabaseService } from '@/lib/core/supabase-client'

/** The CMS page where the person defines the password. Public in `lib/roles.ts`. */
export const SET_PASSWORD_PATH = '/pt/set-password'

type ServiceClient = ReturnType<typeof getSupabaseService>

/** Where the e-mail link lands: the configured public URL, or the origin of this request. */
export function setPasswordRedirectTo(req: NextRequest): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin
  return `${origin}${SET_PASSWORD_PATH}`
}

/**
 * Sends the password link to `email`. Implicit flow, like the invite: the service client is built
 * without PKCE. Returns the GoTrue error code on failure, `null` on success; the address is never
 * logged.
 */
export async function sendSetPasswordLink(
  service: ServiceClient,
  email: string,
  redirectTo: string
): Promise<string | null> {
  const { error } = await service.auth.resetPasswordForEmail(email, { redirectTo })
  if (!error) return null
  const code = String(error.code ?? error.status ?? 'unknown')
  console.error('[cms password link] send failed:', code)
  return code
}
