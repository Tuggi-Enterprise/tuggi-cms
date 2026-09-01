/**
 * GET /api/dashboard/entitlement — o acesso pago depois da virada para horas.
 *
 * Duas leituras, uma tela: o agregado (`dashboard_entitlement_overview`) e a lista
 * de quem tem saldo (`dashboard_metered_users`), ordenada por saldo crescente. Vêm
 * juntas pelo mesmo motivo que a Overview junta doze: é um `Promise.all` de uma
 * tela só, e separar custaria uma volta a mais para não provar nada.
 *
 * SEC-37. A lista carrega `user_id`, `full_name` e `email` — é leitura sobre
 * pessoas. `admin` apenas, com o JWT do próprio operador; `core.is_caller_platform_admin()`
 * guarda o outro lado.
 *
 * **Formato de erro, e por que não é 502.** A migration que cria as duas RPCs é do
 * `data` e pode não estar aplicada quando esta rota subir. Uma RPC ausente aqui não
 * pode derrubar a Overview inteira, então cada chave responde o seu `{ data, error }`
 * dentro de um 200 — mesmo contrato de `app/api/dashboard/overview/route.ts`. O
 * serviço traduz erro em lista vazia, e a tela mostra estado vazio.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readBoundedInt, readOptionalBoundedInt } from '@/lib/api/query-params'
import { BALANCE_BAND_FLOOR } from '@/lib/credit/entitlement'

export const dynamic = 'force-dynamic'

const LIMIT = { fallback: 100, min: 1, max: 1000 }

/**
 * Teto do filtro de saldo. Um dia inteiro de escuta (24 h) já é ordem de grandeza
 * acima do maior passe do catálogo, então acima disso o filtro não seleciona nada
 * — é só um número grande virando argumento de RPC.
 */
const MAX_BALANCE = { min: BALANCE_BAND_FLOOR.critical, max: 24 * 60 }

/** `{ data, error }` como o PostgREST devolve, com o erro reduzido à mensagem. */
function result(res: { data: unknown; error: { message: string } | null }) {
  return { data: res.data ?? null, error: res.error ? { message: res.error.message } : null }
}

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const params = new URL(req.url).searchParams
  const limit = readBoundedInt(params, 'limit', LIMIT)
  const maxBalanceMinutes = readOptionalBoundedInt(params, 'maxBalanceMinutes', MAX_BALANCE)

  const core = auth.supabase.schema('core')

  const [overview, meteredUsers] = await Promise.all([
    core.rpc('dashboard_entitlement_overview'),
    core.rpc('dashboard_metered_users', {
      limit_count: limit,
      max_balance_minutes: maxBalanceMinutes,
    }),
  ])

  return NextResponse.json({
    data: {
      overview: result(overview),
      meteredUsers: result(meteredUsers),
    },
  })
})
