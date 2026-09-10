/**
 * Stand-in for `https://esm.sh/@supabase/supabase-js@2` while an Edge Function is loaded in
 * Node — see the `registerHooks` block in `edge-transactional-links.test.ts` for why the
 * redirect exists at all. Node cannot resolve a remote specifier and `mock.module` does not
 * intercept one (measured 2026-08-23 and again 2026-09-10).
 *
 * `auth.getUser` answers exactly what GoTrue answers for anything that is not a session JWT:
 * no user, and an error. That is the production path for a publishable key, for a secret key
 * that is not ours, and for an expired token alike — `validateAuthHeader` turns all three into
 * 401. Nothing here talks to a network, and the client is only ever built for tokens the
 * machine-key bypass already refused.
 *
 * Not a `.test.ts`, so `npm run test:api` (`tests/api/*.test.ts`) does not collect it.
 */
export function createClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: { message: 'invalid claim: missing sub claim' },
      }),
    },
    schema: () => {
      throw new Error(
        'the role lookup ran for a token that never produced a user'
      )
    },
  }
}
