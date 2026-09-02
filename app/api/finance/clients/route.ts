/**
 * GET /api/finance/clients — o quadro de rentabilidade: um parceiro por linha.
 *
 * SÓ LEITURA, E É O DESENHO. Custo entra por `finance.material_consumption`, e quem escreve ali
 * é a esteira (`setMaterialOrderStatus`), num ato só. Uma escrita de custo aqui seria um segundo
 * caminho para a mesma linha — e o `unique (order_id, product_id)` só protege contra duplicata,
 * não contra dois números diferentes de origens diferentes.
 *
 * OS DOIS PORTÕES, E POR QUE SÃO DOIS. `withAuth` prova quem é (obrigatório em toda rota —
 * `scripts/check-route-policies.ts` falha o build sem ele) e `requireModule` prova que o módulo
 * está ligado para esta pessoa. O role aceito é `['admin','editor']` de propósito: com só
 * `admin`, o segundo portão nunca decidiria nada, porque admin ignora `enabled_modules` por
 * código — e a ativação viraria uma chave que não liga nada. Hoje nenhum editor tem `finance`
 * marcado, então o efeito é "só admin", que é o pedido; ampliar é uma checkbox em `/admin/users`.
 *
 * 503 E NÃO UM QUADRO PELA METADE. `loadFinanceOverview` devolve `null` quando o lado do usuário
 * do app não responde, e é ele quem separa `não paga e não trouxe ninguém` de `não paga mas
 * trouxe quem comprou`. Um quadro renderizado sem essa leitura acusaria de prejuízo todo parceiro
 * não pagante por causa de uma falha de rede.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { loadFinanceOverview } from '@/lib/services/finance-service'
import { summarizeCohorts } from '@/lib/finance/cohort'
import { summarizeFinance } from '@/lib/finance/summary'
import { loadFixedCosts } from '@/lib/services/finance-service'
import { summarizeStructure } from '@/lib/finance/structure'

/**
 * O teto, e a tela é AVISADA quando ele foi atingido. 12 parceiros existem hoje, então 500 está
 * longe — mas um total impresso sobre um conjunto cortado é um piso vestido de fato.
 */
const CAP = 500

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async () => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const today = new Date().toISOString().slice(0, 10)
    const result = await loadFinanceOverview(CAP, today)
    // O motivo sobe junto: `finance_unavailable` e `app_users_unavailable` mandam o operador para
    // dois lugares diferentes — o schema exposto no painel, ou a leitura de perfis.
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 503 })

    const overview = result.overview
    const fixedCosts = await loadFixedCosts()
    // O ano corrente é a janela dos desembolsos de uma vez só. Os recorrentes não dependem dela:
    // eles entram por serem recorrentes, desde que já tenham começado.
    const window = { from: `${today.slice(0, 4)}-01-01`, to: today }

    return NextResponse.json({
      clients: overview.clients,
      // As linhas de consumo, reduzidas ao que o KPI de estoque precisa. Elas sobem com o resto
      // para que `comprado − consumido` seja calculado sobre a MESMA lista que alimentou os
      // totais por parceiro — um segundo `count()` no servidor seria um segundo número.
      consumption: overview.consumption.map((row) => ({
        productId: row.productId,
        quantity: row.quantity,
        components: row.components ?? [],
      })),
      summary: summarizeFinance(overview.clients),
      cohorts: summarizeCohorts(overview.clients),
      structure: summarizeStructure(fixedCosts, overview.clients, window),
      fixedCosts,
      truncated: overview.truncated,
      purchasesAnswered: overview.purchasesAnswered,
    })
  })
)
