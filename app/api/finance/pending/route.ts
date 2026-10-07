/**
 * GET /api/finance/pending — as pendências financeiras do Com história (#902), lidas da view
 * `partner.finance_pending_items` (#900, `places-pagamento.md` §3.5). Só leitura.
 *
 * 503 E NUNCA LISTA VAZIA quando a view não responde — antes da migration `20261007160000` ela
 * não existe. "Nada pendente" por erro é o pior erro possível desta tela (spec do #902, §2).
 *
 * `viewerIsAdmin` sobe junto porque a ação de repasse é só de admin (§3.5, B1): o editor vê
 * "Só admin" no lugar do botão. A tela não decide papel; o servidor diz.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { loadFinancePendingItems } from '@/lib/services/finance-service'
import { sortPendingItems } from '@/lib/finance/place-billing'

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (_req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const items = await loadFinancePendingItems()
    if (items === null) return NextResponse.json({ error: 'pending_unavailable' }, { status: 503 })

    return NextResponse.json({
      items: sortPendingItems(items),
      checkedAt: new Date().toISOString(),
      viewerIsAdmin: auth.cmsUser.role === 'admin',
    })
  })
)
