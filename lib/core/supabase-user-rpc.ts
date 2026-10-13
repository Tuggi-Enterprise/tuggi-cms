/**
 * An RPC in the `core` schema run AS A USER who is not a CMS user: the publishable key plus that
 * user's JWT, so the database applies its own checks (`auth.uid()`, session, owner) exactly as it
 * would for the browser. First caller: the partner portal's Contract section (#919,
 * `lib/services/portal-contract-service.ts`). No `service_role` here, ever.
 */

import { createClient } from '@supabase/supabase-js'

export type RpcError = { code?: string; message?: string; details?: string | null }
export type UserRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>

export function userRpc(jwt: string): UserRpc {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '', {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return async (fn, args) => {
    const { data, error } = await client.schema('core').rpc(fn, args)
    return { data, error: error as RpcError | null }
  }
}
