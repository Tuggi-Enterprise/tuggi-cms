/**
 * GET   /api/finance/fixed-costs — o custo de estrutura, e o ponto de equilíbrio que ele exige.
 * POST  /api/finance/fixed-costs — registra a impressora, a assinatura, o que não é do cliente.
 * PATCH /api/finance/fixed-costs — corrige, encerra, remove ou restaura uma linha.
 *
 * ESTA ROTA NÃO ACEITA `clientId`, E ISSO É O DESENHO INTEIRO. A impressora não fica mais barata
 * se cortarmos um parceiro; um rateio dela por cliente produziria um número que não serve para
 * decidir sobre cliente nenhum, e faria um parceiro pequeno parecer caro só porque a estrutura
 * existe. O custo fixo cobre contra a SOMA das margens, na camada MC II
 * (`lib/finance/structure.ts`). Custo que É do cliente tem outra porta: `/api/finance/entries`.
 *
 * `one_off` E `recurring` SÃO DUAS COISAS E O CHECK DO BANCO EXIGE A DIFERENÇA. Um `recurring`
 * sem período seria uma conta que ninguém sabe se chega todo mês ou todo ano — e lida como
 * mensal, multiplicaria por doze o que a operação precisa cobrir.
 *
 * SÃO QUATRO EIXOS, E CADA UM RESPONDE UMA PERGUNTA (ver `lib/finance/cost-taxonomy.ts`):
 * `category` (para onde o dinheiro vai), `nature` (fixo ou variável — só o fixo entra no ponto
 * de equilíbrio), `kind` (cadência) e `entryType` (custo ou crédito). Um crédito é lançado com
 * valor POSITIVO e `entryType: 'credit'` — o sinal é coluna, nunca o valor, porque um total que
 * soma tudo cru acerta por acidente e erra na pergunta que importa: quanto isto custa a preço
 * cheio, no dia em que o crédito promocional acabar.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  amendFixedCost,
  createFixedCost,
  endFixedCost,
  loadFixedCosts,
  restoreFixedCost,
  voidFixedCost,
  type FixedCostAmendment,
} from '@/lib/services/finance-service'
import { CURRENCY, text, toAmountCents, toCurrency, toInteger, toIsoDate, UUID } from '@/lib/finance/input'
import { isCostCategory, isCostEntryType, isCostNature } from '@/lib/finance/cost-taxonomy'

/**
 * ENCERRAR, REMOVER E RESTAURAR — três verbos, e os dois primeiros NÃO são sinônimos.
 *
 *   `amend`    a linha está certa, o CONTEÚDO dela não: valor trocado, data errada, categoria
 *              errada. Corrige, e o log guarda de → para de cada campo que mudou.
 *   `end`      a assinatura acabou. O custo existiu, foi pago, e segue contando em todo mês em
 *              que valeu. Grava `ends_at`, e só ele.
 *   `void`     a linha foi um erro — valor trocado, item duplicado, mês errado. Ela sai de toda
 *              conta, em todo mês, e a razão é obrigatória.
 *   `restore`  desfaz o `void`, para remover não ser porta de mão única.
 *
 * Um botão só para "encerrar ou deletar" destruiria um dos dois: remover uma assinatura que de
 * fato acabou apagaria custo real do histórico; encerrar uma linha digitada errada a deixaria
 * cobrando até a data do encerramento, um custo fantasma dentro do ponto de equilíbrio.
 *
 * NÃO EXISTE `DELETE` NESTA ROTA, e não é esquecimento: o schema não concede `delete` em tabela
 * de lançamento nenhuma. Uma linha de dinheiro que some sem rastro é indistinguível de uma
 * leitura que falhou pela metade.
 */
const ACTIONS = ['amend', 'end', 'void', 'restore'] as const

/** O motivo de uma remoção. Curto por teto de coluna, obrigatório por decisão. */
const REASON_MAX = 200

/** Cento e vinte meses. Uma assinatura com período maior que isso é erro de digitação. */
const PERIOD_MAX = 120

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async () => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const fixedCosts = await loadFixedCosts()
    // Mesma regra da rota da tela: lista vazia por erro afirmaria que não há custo nenhum.
    if (fixedCosts === null) {
      return NextResponse.json({ error: 'fixed_costs_unavailable' }, { status: 503 })
    }
    return NextResponse.json({ fixedCosts })
  })
)

export const POST = withRateLimit(20, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const label = text(body.label)
    if (!label) return NextResponse.json({ error: 'invalid_label' }, { status: 400 })

    if (body.kind !== 'one_off' && body.kind !== 'recurring') {
      return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
    }
    const kind = body.kind

    const amountCents = toAmountCents(body.amountCents)
    if (amountCents === null) {
      return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
    }

    const currency = toCurrency(body.currency)
    if (currency === null) {
      return NextResponse.json({ error: 'invalid_currency' }, { status: 400 })
    }

    const incurredAt = toIsoDate(body.incurredAt)
    if (incurredAt === null) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
    }

    // Exigido em `recurring` e recusado em `one_off` — o mesmo par que o CHECK do banco impõe.
    // Assumir 1 quando ninguém informou leria uma conta anual como mensal.
    let periodMonths: number | null = null
    if (kind === 'recurring') {
      periodMonths = toInteger(body.periodMonths)
      if (periodMonths === null || periodMonths < 1 || periodMonths > PERIOD_MAX) {
        return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
      }
    } else if (body.periodMonths !== undefined && body.periodMonths !== null) {
      return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
    }

    // AUSENTE CAI NO DEFAULT, ERRADO É 400. São dois casos diferentes: um cliente antigo que não
    // conhece a coluna manda ausente e recebe o mesmo default do banco; um cliente que manda
    // `nature: "fixo"` errou, e aceitar isso em silêncio como `fixed` gravaria uma classificação
    // que ninguém escolheu — a mesma razão de `toCurrency` recusar em vez de normalizar.
    const category = body.category === undefined ? 'other' : body.category
    if (!isCostCategory(category)) {
      return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
    }

    const nature = body.nature === undefined ? 'fixed' : body.nature
    if (!isCostNature(nature)) {
      return NextResponse.json({ error: 'invalid_nature' }, { status: 400 })
    }

    const entryType = body.entryType === undefined ? 'cost' : body.entryType
    if (!isCostEntryType(entryType)) {
      return NextResponse.json({ error: 'invalid_entry_type' }, { status: 400 })
    }

    // A FOLHA É BASE DO FATOR R, E CRÉDITO NÃO CONSTRÓI BASE. Um desconto de plano marcado como
    // folha inflaria o índice que decide o anexo do Simples — e o inflaria para cima, na direção
    // que faz a empresa se planejar para uma alíquota que ela não alcançou.
    if (body.isPayroll !== undefined && typeof body.isPayroll !== 'boolean') {
      return NextResponse.json({ error: 'invalid_payroll' }, { status: 400 })
    }
    const isPayroll = body.isPayroll === true
    if (isPayroll && entryType === 'credit') {
      return NextResponse.json({ error: 'invalid_payroll' }, { status: 400 })
    }

    // A VIGÊNCIA SÓ EXISTE NO RECORRENTE. Um desembolso de uma vez só não tem "até quando" — ele
    // aconteceu num dia — e aceitar a data ali gravaria um campo que nenhuma leitura consulta.
    let endsAt: string | null = null
    if (body.endsAt !== undefined && body.endsAt !== null && body.endsAt !== '') {
      endsAt = toIsoDate(body.endsAt)
      if (endsAt === null || endsAt < incurredAt || kind !== 'recurring') {
        return NextResponse.json({ error: 'invalid_ends_at' }, { status: 400 })
      }
    }

    const outcome = await createFixedCost({
      label,
      kind,
      amountCents,
      currency,
      incurredAt,
      periodMonths,
      category,
      nature,
      entryType,
      isPayroll,
      endsAt,
      notes: text(body.notes),
      createdBy: auth.user.id,
    })

    if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'CREATE_FINANCE_FIXED_COST',
      entity: 'FINANCE',
      entityId: outcome.id,
      description:
        `${entryType === 'credit' ? 'Crédito' : 'Custo'} ${nature} ${kind} "${label}" ` +
        `[${category}]: ${amountCents} centavos em ${currency}, ${incurredAt}` +
        (periodMonths ? `, a cada ${periodMonths} mês(es)` : '') +
        (endsAt ? `, até ${endsAt}` : '') +
        (isPayroll ? ', na base do fator R' : ''),
      request: req,
    })

    return NextResponse.json({ id: outcome.id }, { status: 201 })
  })
)

export const PATCH = withRateLimit(20, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null
    if (!id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

    const action = body.action
    if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
    }

    if (action === 'amend') {
      const raw = body.patch
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return NextResponse.json({ error: 'invalid_patch' }, { status: 400 })
      }
      const fields = raw as Record<string, unknown>

      // CADA CAMPO PASSA PELA MESMA GUARDA DO CADASTRO. Uma rota de correção mais permissiva que
      // a de criação é a porta pela qual entra o que a de criação recusou: R$ 1.000 como `1`,
      // uma moeda que não é ISO, uma categoria que o vocabulário não tem.
      const patch: FixedCostAmendment = {}

      if (fields.label !== undefined) {
        const label = text(fields.label)
        if (!label) return NextResponse.json({ error: 'invalid_label' }, { status: 400 })
        patch.label = label
      }

      if (fields.amountCents !== undefined) {
        const amountCents = toAmountCents(fields.amountCents)
        if (amountCents === null) {
          return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
        }
        patch.amountCents = amountCents
      }

      if (fields.currency !== undefined) {
        // `toCurrency('')` DEVOLVE `'BRL'`, e numa CORREÇÃO isso é um defeito. Ali o vazio é o
        // default de quem cadastra sem informar moeda; aqui ele viria de um operador que apagou
        // o campo para redigitar e confirmou antes de terminar — e a linha da Supabase viraria
        // R$ 40,99 com o valor intacto, encolhendo o custo estrutural em ~R$ 180/mês sem erro
        // nenhum na tela. Corrigir tem de ser explícito. Apontado pelo QA em 2026-09-03.
        const currency = typeof fields.currency === 'string' && CURRENCY.test(fields.currency.toUpperCase())
          ? fields.currency.toUpperCase()
          : null
        if (currency === null) return NextResponse.json({ error: 'invalid_currency' }, { status: 400 })
        patch.currency = currency
      }

      if (fields.incurredAt !== undefined) {
        const incurredAt = toIsoDate(fields.incurredAt)
        if (incurredAt === null) return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
        patch.incurredAt = incurredAt
      }

      if (fields.category !== undefined) {
        if (!isCostCategory(fields.category)) {
          return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
        }
        patch.category = fields.category
      }

      if (fields.nature !== undefined) {
        if (!isCostNature(fields.nature)) {
          return NextResponse.json({ error: 'invalid_nature' }, { status: 400 })
        }
        patch.nature = fields.nature
      }

      if (fields.isPayroll !== undefined) {
        if (typeof fields.isPayroll !== 'boolean') {
          return NextResponse.json({ error: 'invalid_payroll' }, { status: 400 })
        }
        patch.isPayroll = fields.isPayroll
      }

      if (fields.periodMonths !== undefined) {
        const periodMonths = toInteger(fields.periodMonths)
        if (periodMonths === null || periodMonths < 1 || periodMonths > PERIOD_MAX) {
          return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
        }
        patch.periodMonths = periodMonths
      }

      if (fields.endsAt !== undefined) {
        // `null` e `''` significam "tirar a vigência", e são um pedido legítimo: uma assinatura
        // encerrada por engano volta a valer sem precisar ser recadastrada.
        if (fields.endsAt === null || fields.endsAt === '') {
          patch.endsAt = null
        } else {
          const endsAt = toIsoDate(fields.endsAt)
          if (endsAt === null) return NextResponse.json({ error: 'invalid_ends_at' }, { status: 400 })
          patch.endsAt = endsAt
        }
      }

      if (fields.notes !== undefined) patch.notes = text(fields.notes)

      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'empty_patch' }, { status: 400 })
      }

      const outcome = await amendFixedCost(id, patch)
      if (!outcome.ok) {
        // TRÊS MOTIVOS, TRÊS FAIXAS. `not_found` é 404 — a linha não existe ou já foi removida.
        // `invalid_ends_at` é 400: o pedido é incoerente (vigência antes do início), e só o
        // servidor podia saber, porque o campo que falta para a comparação está na linha e não
        // no formulário. Só o resto é 503. Devolver 503 para os dois primeiros mandaria o
        // operador procurar uma falha de banco que não houve.
        const status =
          outcome.reason === 'not_found' ? 404 : outcome.reason === 'invalid_ends_at' ? 400 : 503
        return NextResponse.json({ error: outcome.reason }, { status })
      }

      // O LOG SÓ EXISTE SE ALGO MUDOU. Uma correção que reenviou os mesmos valores não é um fato,
      // e registrá-la encheria o log de linhas que não dizem nada — que é como um log de
      // auditoria deixa de ser lido.
      if (outcome.diff.length > 0) {
        await logAuditEvent({
          userId: auth.user.id,
          userEmail: auth.user.email,
          action: 'AMEND_FINANCE_FIXED_COST',
          entity: 'FINANCE',
          entityId: id,
          description:
            'Custo corrigido: ' +
            outcome.diff.map((one) => `${one.field} de "${one.from}" para "${one.to}"`).join('; '),
          request: req,
        })
      }

      return NextResponse.json({ id, changed: outcome.diff.length })
    }

    // QUEM RECUSA `ends_at` NUM `one_off` É A PRÓPRIA ESCRITA, com `.eq('kind','recurring')` no
    // `update` — e não um CHECK do banco, que este comentário afirmava existir até o QA conferir
    // as migrações em 2026-09-03 e mostrar que não existe. A guarda na escrita não é uma segunda
    // cópia da regra: é a única, e ela devolve zero linha, que a rota traduz em 404.
    if (action === 'end') {
      const endsAt = toIsoDate(body.endsAt)
      if (endsAt === null) return NextResponse.json({ error: 'invalid_ends_at' }, { status: 400 })

      const outcome = await endFixedCost(id, endsAt)
      if (!outcome.ok) {
        // `not_found` cobre três casos e todos são 404: o id não existe, a linha já foi removida,
        // ou ela é um `one_off` — e desembolso de uma vez só não tem "até quando".
        return NextResponse.json(
          { error: outcome.reason },
          { status: outcome.reason === 'not_found' ? 404 : 503 }
        )
      }

      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'END_FINANCE_FIXED_COST',
        entity: 'FINANCE',
        entityId: id,
        description: `Custo encerrado em ${endsAt}`,
        request: req,
      })
      return NextResponse.json({ id })
    }

    if (action === 'void') {
      // O MOTIVO É EXIGIDO AQUI E NO BANCO. "Por que esta linha não conta" é a informação que
      // torna a remoção auditável — sem ela, um total que mudou entre duas leituras não tem
      // explicação para quem o reabrir no mês que vem.
      const reason = text(body.reason)?.slice(0, REASON_MAX)
      if (!reason) return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })

      const outcome = await voidFixedCost(id, reason, auth.user.id)
      if (!outcome.ok) {
        return NextResponse.json(
          { error: outcome.reason },
          { status: outcome.reason === 'not_found' ? 404 : 503 }
        )
      }

      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'VOID_FINANCE_FIXED_COST',
        entity: 'FINANCE',
        entityId: id,
        description: `Custo removido de toda conta: ${reason}`,
        request: req,
      })
      return NextResponse.json({ id })
    }

    const outcome = await restoreFixedCost(id)
    if (!outcome.ok) {
      // Aqui `not_found` também quer dizer "esta linha não estava removida" — e responder 404 a
      // isso é honesto: não há remoção a desfazer.
      return NextResponse.json(
        { error: outcome.reason },
        { status: outcome.reason === 'not_found' ? 404 : 503 }
      )
    }

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'RESTORE_FINANCE_FIXED_COST',
      entity: 'FINANCE',
      entityId: id,
      description: 'Remocao desfeita: a linha volta a contar',
      request: req,
    })
    return NextResponse.json({ id })
  })
)
