/**
 * GET  /api/finance/catalog — produtos, receitas e taxas padrão.
 * POST /api/finance/catalog — cadastra um produto.
 * PUT  /api/finance/catalog — cadastra uma vigência de receita, de embalagem ou de taxa padrão.
 * DELETE /api/finance/catalog — apaga uma vigência de receita ou de embalagem.
 *
 * O PRODUTO SE CADASTRA E NÃO SE EDITA, E ISSO DESDE 2026-09-01. A única
 * coisa editável dele era o rendimento, e ele deixou de existir: rendimento é fato da COMPRA
 * (`purchases.units_yield`), congelado no dia. O que sobrou no produto é identidade — `id`,
 * `role`, `material_kind` —, e identidade não se edita: um produto novo é um produto novo.
 *
 * PUT E NÃO POST NA VIGÊNCIA, e a escolha diz o que acontece: cadastrar `display_mesa leva 3 QR
 * a partir de 01/09` duas vezes tem de dar o mesmo resultado que uma. O `unique` de
 * `(parent, component, effective_from)` torna o ato idempotente, e o verbo devia dizer isso.
 *
 * NÃO EXISTE ROTA QUE APAGUE UMA VIGÊNCIA, nem que edite a anterior. Trocar 2 QR por 3 é um fato
 * novo a partir de uma data, não uma correção do passado: o custo já congelado nas linhas de
 * consumo continua valendo, e apagar a vigência antiga destruiria a única prova de quanto o
 * display custava em agosto. Errou a data? Cadastre a data certa; a errada fica no histórico.
 *
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  addPackagingRule,
  addRecipeVersion,
  addStandardRate,
  createProduct,
  deletePackagingRule,
  deleteRecipeVersion,
  loadCatalog,
} from '@/lib/services/finance-service'
import { MATERIAL_KINDS } from '@/lib/partner-form/fields'
import { unmappedMaterialKinds } from '@/lib/finance/catalog'
import {
  slugify,
  text,
  toInteger,
  toAmountCents,
  toCurrency,
  toIsoDate,
  toPositiveNumber,
} from '@/lib/finance/input'

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async () => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const catalog = await loadCatalog()
    // Catálogo vazio por erro faria toda a esteira parecer sem produto, e a tela apontaria um
    // cadastro pendente que já existe. 503 diz a verdade: não deu para ler.
    if (!catalog) return NextResponse.json({ error: 'finance_unavailable' }, { status: 503 })

    return NextResponse.json({
      ...catalog,
      // O que a esteira sabe pedir e o catálogo ainda não sabe custear. Uma pendência de
      // cadastro, e não uma lista vazia — um pedido desse tipo entra sem custo e a tela precisa
      // dizer por quê antes de o operador ler um parceiro barato por engano.
      unmappedMaterialKinds: unmappedMaterialKinds(catalog.products),
    })
  })
)

/**
 * Cadastra um produto. Não existe rota que o edite: o `id` é derivado do nome e aparece em toda
 * linha de custo já congelada, então mudá-lo quebraria o elo com o que já foi apurado.
 */
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

    const name = text(body.name)
    if (!name) return NextResponse.json({ error: 'invalid_name' }, { status: 400 })

    const id = slugify(name)
    if (!id) return NextResponse.json({ error: 'invalid_name' }, { status: 400 })

    if (body.role !== 'deliverable' && body.role !== 'component') {
      return NextResponse.json({ error: 'invalid_role' }, { status: 400 })
    }
    const role = body.role

    const purchaseUnit = text(body.purchaseUnit) ?? 'unidade'

    // O tipo da esteira só existe em entregável, e tem de ser um dos que o parceiro pode pedir.
    // `MATERIAL_KINDS` é o dono do vocabulário — esta rota o lê, não o repete.
    let materialKind: string | null = null
    if (role === 'deliverable' && body.materialKind !== undefined && body.materialKind !== null) {
      const kind = String(body.materialKind)
      if (!(MATERIAL_KINDS as readonly string[]).includes(kind)) {
        return NextResponse.json({ error: 'invalid_material_kind' }, { status: 400 })
      }
      materialKind = kind
    }

    const outcome = await createProduct({
      id,
      name,
      role,
      materialKind,
      purchaseUnit,
      createdBy: auth.user.id,
    })

    if (!outcome.ok) {
      // 409 e não 400: o corpo estava certo, o nome é que já está em uso — ou pelo id, ou porque
      // outro produto já responde por aquele tipo da esteira.
      const status = outcome.reason === 'taken' ? 409 : 503
      return NextResponse.json({ error: outcome.reason }, { status })
    }

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'UPDATE_FINANCE_CATALOG',
      entity: 'FINANCE',
      entityId: id,
      description: `Produto ${id} ("${name}") cadastrado como ${role}, comprado por ${purchaseUnit}`,
      request: req,
    })

    return NextResponse.json({ id }, { status: 201 })
  })
)

export const PUT = withRateLimit(20, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const effectiveFrom = toIsoDate(body.effectiveFrom)
    if (effectiveFrom === null) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
    }

    const catalog = await loadCatalog()
    if (!catalog) return NextResponse.json({ error: 'finance_unavailable' }, { status: 503 })
    const { products } = catalog
    const known = (id: unknown) =>
      typeof id === 'string' && products.some((product) => product.id === id)

    if (body.kind === 'recipe') {
      if (!known(body.parentProductId) || !known(body.componentProductId)) {
        return NextResponse.json({ error: 'unknown_product' }, { status: 400 })
      }
      if (body.parentProductId === body.componentProductId) {
        return NextResponse.json({ error: 'invalid_recipe' }, { status: 400 })
      }
      const quantity = toPositiveNumber(body.quantity)
      if (quantity === null || quantity <= 0) {
        return NextResponse.json({ error: 'invalid_quantity' }, { status: 400 })
      }

      const outcome = await addRecipeVersion({
        parentProductId: String(body.parentProductId),
        componentProductId: String(body.componentProductId),
        quantity,
        effectiveFrom,
        createdBy: auth.user.id,
      })
      if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 })

      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'UPDATE_FINANCE_CATALOG',
        entity: 'FINANCE',
        entityId: outcome.id,
        description:
          `Receita: ${String(body.parentProductId)} leva ${quantity} × ` +
          `${String(body.componentProductId)} a partir de ${effectiveFrom}`,
        request: req,
      })
      return NextResponse.json({ id: outcome.id }, { status: 201 })
    }

    if (body.kind === 'packaging') {
      if (!known(body.productId)) {
        return NextResponse.json({ error: 'unknown_product' }, { status: 400 })
      }
      const capacity = toInteger(body.capacity)
      if (capacity === null || capacity < 1) {
        return NextResponse.json({ error: 'invalid_capacity' }, { status: 400 })
      }

      const outcome = await addPackagingRule({
        productId: String(body.productId),
        capacity,
        effectiveFrom,
        createdBy: auth.user.id,
      })
      if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 })

      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'UPDATE_FINANCE_CATALOG',
        entity: 'FINANCE',
        entityId: outcome.id,
        description:
          `Embalagem: 1 ${String(body.productId)} a cada ${capacity} peças ` +
          `a partir de ${effectiveFrom}`,
        request: req,
      })
      return NextResponse.json({ id: outcome.id }, { status: 201 })
    }

    if (body.kind === 'rate') {
      if (!known(body.appliesTo)) {
        return NextResponse.json({ error: 'unknown_product' }, { status: 400 })
      }
      const rateId = text(body.rateId)
      if (!rateId) return NextResponse.json({ error: 'invalid_rate' }, { status: 400 })

      const amountCents = toAmountCents(body.amountCents)
      if (amountCents === null) {
        return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
      }
      const currency = toCurrency(body.currency)
      if (currency === null) {
        return NextResponse.json({ error: 'invalid_currency' }, { status: 400 })
      }

      const outcome = await addStandardRate({
        rateId,
        appliesTo: String(body.appliesTo),
        amountCents,
        currency,
        effectiveFrom,
        createdBy: auth.user.id,
      })
      if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 })

      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'UPDATE_FINANCE_CATALOG',
        entity: 'FINANCE',
        entityId: outcome.id,
        description:
          `Taxa padrão ${rateId}: ${amountCents} centavos por ${String(body.appliesTo)} ` +
          `em ${currency} a partir de ${effectiveFrom}`,
        request: req,
      })
      return NextResponse.json({ id: outcome.id }, { status: 201 })
    }

    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  })
)

/**
 * Apaga uma vigência de receita ou de embalagem.
 *
 * PERMITIDO AQUI E PROIBIDO NAS TABELAS DE LANÇAMENTO, pela mesma razão da compra: isto é
 * cadastro de REGRA, não custo apurado contra um parceiro. Uma regra errada não tem oposto — em
 * 2026-09-01 "1 envelope a cada 50 displays" foi cadastrado como "cada display leva 50
 * envelopes", e sem esta rota o único caminho seria uma vigência de quantidade zero, que a rota
 * de cadastro recusa porque zero não é uma receita.
 *
 * O CUSTO JÁ CONGELADO NÃO SE DESFAZ. As linhas de `material_consumption` guardam o que a regra
 * dizia no dia. Para corrigi-las existe um ato explícito e separado:
 * `scripts/finance-backfill-consumption.ts --recompute`.
 */
export const DELETE = withRateLimit(20, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const params = new URL(req.url).searchParams
    const kind = params.get('kind')
    const effectiveFrom = toIsoDate(params.get('effectiveFrom'))
    if (effectiveFrom === null) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
    }

    if (kind === 'recipe') {
      const parentProductId = params.get('parentProductId') ?? ''
      const componentProductId = params.get('componentProductId') ?? ''
      if (!parentProductId || !componentProductId) {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
      }

      const removed = await deleteRecipeVersion({
        parentProductId,
        componentProductId,
        effectiveFrom,
      })
      if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'DELETE_FINANCE_RULE',
        entity: 'FINANCE',
        entityId: `${parentProductId}:${componentProductId}:${effectiveFrom}`,
        description:
          `Receita apagada: ${parentProductId} levava ${componentProductId} ` +
          `desde ${effectiveFrom}`,
        request: req,
      })
      return NextResponse.json({ ok: true })
    }

    if (kind === 'packaging') {
      const productId = params.get('productId') ?? ''
      if (!productId) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

      const removed = await deletePackagingRule({ productId, effectiveFrom })
      if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      await logAuditEvent({
        userId: auth.user.id,
        userEmail: auth.user.email,
        action: 'DELETE_FINANCE_RULE',
        entity: 'FINANCE',
        entityId: `${productId}:${effectiveFrom}`,
        description: `Embalagem apagada: ${productId} desde ${effectiveFrom}`,
        request: req,
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  })
)
