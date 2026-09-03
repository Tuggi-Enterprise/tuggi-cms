/**
 * GET   /api/finance/exclusions — as contas que não entram na conta.
 * POST  /api/finance/exclusions — marca uma como teste.
 * PATCH /api/finance/exclusions — desfaz a marca.
 *
 * O PEDIDO, 2026-09-02: *"podemos marcar usuários como testes e esses não entram na conta"*.
 *
 * O MOTIVO É OBRIGATÓRIO, e não é burocracia: "por que esta conta não conta" é a informação
 * inteira. Uma lista de ids sem motivo, seis meses depois, é indistinguível de uma lista de
 * parceiros que alguém escondeu — e quem lê o total não tem como julgar se a exclusão foi justa.
 *
 * DESFAZER É `PATCH`, NUNCA `DELETE`. A tabela nem tem `grant delete`: uma conta que volta a
 * contar sem deixar rastro muda um número financeiro e ninguém consegue dizer por quê. É a mesma
 * decisão que mantém `finance.client_cost_entries` sem `delete` — corrigir um lançamento é
 * lançar o oposto, não apagar a linha.
 *
 * O QUE A EXCLUSÃO ALCANÇA, E A ROTA NÃO ESCONDE O RESTO. Parceiro sai de tudo que o CMS conta
 * sozinho (base, MRR, CAC, coorte), porque `loadFinanceOverview` filtra ANTES de somar. Usuário
 * do app sai das listas que trazem `user_id`; os agregados que chegam somados do banco continuam
 * incluindo-o, e `/api/finance/app-credit` devolve `aggregateIncludesExcluded` para a tela
 * dizer isso em vez de fingir que alcançou.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  excludeAccount,
  listExcludedAccounts,
  restoreAccount,
} from '@/lib/services/finance-service'
import { UUID, text } from '@/lib/finance/input'

export const dynamic = 'force-dynamic'

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async () => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const accounts = await listExcludedAccounts()
    // Lista vazia por erro diria "nenhuma conta excluída" a quem abriu a tela exatamente para
    // conferir quais estão. Nenhum total muda, e mesmo assim a resposta seria falsa.
    if (accounts === null) {
      return NextResponse.json({ error: 'finance_unavailable' }, { status: 503 })
    }
    return NextResponse.json({ accounts })
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

    if (body.kind !== 'app_user' && body.kind !== 'client') {
      return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
    }
    const kind = body.kind

    const subjectId = text(body.subjectId)
    // Os dois lados guardam um uuid — `partner.clients.id` e o id do usuário do app. A coluna é
    // texto porque a FK só valeria para metade das linhas, mas o formato se confere aqui.
    if (!subjectId || !UUID.test(subjectId)) {
      return NextResponse.json({ error: 'invalid_subject_id' }, { status: 400 })
    }

    const reason = text(body.reason)
    if (!reason) return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })

    const created = await excludeAccount({ kind, subjectId, reason, createdBy: auth.user.id })
    if (!created.ok) {
      // 409: já está marcada. Marcar de novo não é erro do servidor, é a lista já estar certa.
      return created.conflict
        ? NextResponse.json({ error: 'already_excluded' }, { status: 409 })
        : NextResponse.json({ error: 'write_failed' }, { status: 503 })
    }

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'CREATE_FINANCE_EXCLUSION',
      entity: 'FINANCE',
      entityId: subjectId,
      description: `Conta de teste marcada (${kind}): ${reason}`,
      request: req,
    })

    return NextResponse.json({ ok: true }, { status: 201 })
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

    const id = text(body.id)
    if (!id || !UUID.test(id)) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
    }

    // `restoreAccount` só escreve sobre marca VIVA. Falso aqui significa "não existe" ou "já foi
    // desfeita", e as duas respondem 404: em nenhuma delas há o que desfazer.
    const restored = await restoreAccount(id, auth.user.id)
    if (!restored) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'RESTORE_FINANCE_EXCLUSION',
      entity: 'FINANCE',
      entityId: id,
      description: `Marca de conta de teste desfeita: a conta volta a contar`,
      request: req,
    })

    return NextResponse.json({ ok: true })
  })
)
