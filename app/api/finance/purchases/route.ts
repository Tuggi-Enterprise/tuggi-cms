/**
 * GET    /api/finance/purchases — as compras, e o custo por peça que sai delas.
 * POST   /api/finance/purchases — registra uma compra.
 * PATCH  /api/finance/purchases — corrige uma nota digitada errada.
 * DELETE /api/finance/purchases — apaga uma nota que não devia existir.
 *
 * ESTA É A ÚNICA SUPERFÍCIE DE `finance` QUE EDITA E APAGA, e a exceção tem razão. As tabelas de
 * LANÇAMENTO não aceitam `delete` porque apagar um custo já apurado faz o total de um parceiro
 * mudar sem nada explicar. Uma compra não é isso: é o registro de uma nota, ela não tem oposto
 * (não se compra menos uma bobina), e uma nota errada não erra uma linha — ela envenena TODA
 * derivação futura do custo por peça. Ver `20260901_04_finance_purchase_edit.sql`.
 *
 * O QUE CORRIGIR UMA COMPRA **NÃO** FAZ: mexer no custo já congelado em
 * `finance.material_consumption`. Aquilo é o preço que valia no dia, e é história.
 *
 * A COMPRA É A ÚNICA ENTRADA DE PREÇO DO MÓDULO, e por isso não existe rota que grave um custo
 * unitário. O operador tem a nota — "2 bobinas por R$ 180" — e o custo por etiqueta é uma conta
 * (`lib/finance/unit-cost.ts`), feita com o rendimento do produto. Um campo de preço unitário ao
 * lado da nota seria a promessa de que um dia os dois vão discordar.
 *
 * O GET DEVOLVE O CUSTO JÁ CALCULADO porque a tela e a gravação do consumo precisam ser o mesmo
 * número. Ele é calculado pela mesma função que a esteira usa, sobre as mesmas compras — não há
 * uma segunda conta aqui para sair de sincronia com aquela.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  createPurchase,
  deletePurchase,
  loadCatalog,
  loadPurchases,
  updatePurchase,
} from '@/lib/services/finance-service'
import { unitCost } from '@/lib/finance/unit-cost'
import {
  UNITS_MAX,
  UUID,
  text,
  toAmountCents,
  toCurrency,
  toInteger,
  toIsoDate,
} from '@/lib/finance/input'

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async () => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const [purchases, catalog] = await Promise.all([loadPurchases(), loadCatalog()])
    if (!purchases || !catalog) {
      return NextResponse.json({ error: 'finance_unavailable' }, { status: 503 })
    }
    const today = new Date().toISOString().slice(0, 10)

    const unitCosts = catalog.products.map((product) => {
      const cost = unitCost(purchases, product, today)
      return {
        productId: product.id,
        // `null` e não zero: sem compra não há custo, e a tela precisa dizer isso.
        centsExact: cost ? cost.centsExact : null,
        currency: cost?.currency ?? null,
        pieces: cost?.pieces ?? 0,
        ignoredCurrencies: cost?.ignoredCurrencies ?? [],
      }
    })

    return NextResponse.json({ purchases, products: catalog.products, unitCosts })
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
    if (!productId) return NextResponse.json({ error: 'invalid_product' }, { status: 400 })

    // O produto tem de existir ANTES da compra: uma compra de um id inventado passaria pela FK
    // com erro 500, e o operador leria "falha ao gravar" sobre um produto que ele só digitou errado.
    const catalog = await loadCatalog()
    if (!catalog) return NextResponse.json({ error: 'finance_unavailable' }, { status: 503 })
    if (!catalog.products.some((product) => product.id === productId)) {
      return NextResponse.json({ error: 'unknown_product' }, { status: 400 })
    }

    const units = toInteger(body.units)
    if (units === null || units < 1 || units > UNITS_MAX) {
      return NextResponse.json({ error: 'invalid_quantity', field: 'units' }, { status: 400 })
    }

    // Quantas peças CADA unidade rendeu. Ausente é 1, que é o caso da esmagadora maioria dos
    // produtos — o rolo é a exceção. Ele vem da COMPRA e não do produto: o rolo de 150 de hoje
    // não pode reinterpretar o rolo de 200 de amanhã.
    const unitsYield = body.unitsYield === undefined ? 1 : toInteger(body.unitsYield)
    if (unitsYield === null || unitsYield < 1 || unitsYield > UNITS_MAX) {
      return NextResponse.json({ error: 'invalid_quantity', field: 'unitsYield' }, { status: 400 })
    }

    const totalCents = toAmountCents(body.totalCents)
    if (totalCents === null) {
      return NextResponse.json({ error: 'invalid_amount', field: 'totalCents' }, { status: 400 })
    }

    const freightCents = body.freightCents === undefined ? 0 : toAmountCents(body.freightCents)
    if (freightCents === null) {
      return NextResponse.json({ error: 'invalid_amount', field: 'freightCents' }, { status: 400 })
    }

    const currency = toCurrency(body.currency)
    if (currency === null) {
      return NextResponse.json({ error: 'invalid_currency' }, { status: 400 })
    }

    const purchasedAt = toIsoDate(body.purchasedAt)
    if (purchasedAt === null) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
    }

    const outcome = await createPurchase({
      productId,
      units,
      unitsYield,
      totalCents,
      freightCents,
      currency,
      purchasedAt,
      supplier: text(body.supplier),
      invoiceRef: text(body.invoiceRef),
      notes: text(body.notes),
      createdBy: auth.user.id,
    })

    if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'CREATE_FINANCE_PURCHASE',
      entity: 'FINANCE',
      entityId: outcome.id,
      description:
        `Compra de ${units} × ${unitsYield} ${productId} por ${totalCents} centavos ` +
        `(frete ${freightCents}) em ${currency}, ${purchasedAt}`,
      request: req,
    })

    return NextResponse.json({ id: outcome.id }, { status: 201 })
  })
)

/**
 * Corrige uma nota. Campo ausente do corpo é campo não tocado — nada é zerado por omissão.
 *
 * `productId` NÃO é aceito: trocar o produto de uma compra moveria peças de um estoque para
 * outro sem nada registrar a saída, e o KPI de comprado-menos-consumido passaria a mentir nos
 * dois produtos. Errou o produto, apague e cadastre.
 */
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

    const id = typeof body.id === 'string' ? body.id : ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

    const patch: Parameters<typeof updatePurchase>[1] = {}

    if (body.units !== undefined) {
      const units = toInteger(body.units)
      if (units === null || units < 1 || units > UNITS_MAX) {
        return NextResponse.json({ error: 'invalid_quantity', field: 'units' }, { status: 400 })
      }
      patch.units = units
    }
    if (body.unitsYield !== undefined) {
      const unitsYield = toInteger(body.unitsYield)
      if (unitsYield === null || unitsYield < 1 || unitsYield > UNITS_MAX) {
        return NextResponse.json({ error: 'invalid_quantity', field: 'unitsYield' }, { status: 400 })
      }
      patch.unitsYield = unitsYield
    }
    if (body.totalCents !== undefined) {
      const total = toAmountCents(body.totalCents)
      if (total === null) {
        return NextResponse.json({ error: 'invalid_amount', field: 'totalCents' }, { status: 400 })
      }
      patch.totalCents = total
    }
    if (body.freightCents !== undefined) {
      const freight = toAmountCents(body.freightCents)
      if (freight === null) {
        return NextResponse.json({ error: 'invalid_amount', field: 'freightCents' }, { status: 400 })
      }
      patch.freightCents = freight
    }
    if (body.currency !== undefined) {
      const currency = toCurrency(body.currency)
      if (currency === null) return NextResponse.json({ error: 'invalid_currency' }, { status: 400 })
      patch.currency = currency
    }
    if (body.purchasedAt !== undefined) {
      const date = toIsoDate(body.purchasedAt)
      if (date === null) return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
      patch.purchasedAt = date
    }
    if (body.supplier !== undefined) patch.supplier = text(body.supplier)
    if (body.invoiceRef !== undefined) patch.invoiceRef = text(body.invoiceRef)
    if (body.notes !== undefined) patch.notes = text(body.notes)

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const changed = await updatePurchase(id, patch)
    // 404 e não 400: o corpo estava certo; a compra é que não existe mais.
    if (!changed) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'UPDATE_FINANCE_PURCHASE',
      entity: 'FINANCE',
      entityId: id,
      description: `Compra ${id} corrigida: ${JSON.stringify(patch)}`,
      request: req,
    })

    return NextResponse.json({ ok: true })
  })
)

/**
 * Apaga uma nota.
 *
 * O CUSTO JÁ LANÇADO NÃO É DESFEITO. As linhas de `material_consumption` congelaram o preço do
 * dia e permanecem — apagar a nota muda o que será derivado daqui para frente, não o que já foi
 * apurado. Se aquelas linhas estiverem erradas porque esta nota estava errada, o conserto é
 * outro ato, e ele ainda não existe: está registrado como limitação conhecida.
 */
export const DELETE = withRateLimit(20, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

    const removed = await deletePurchase(id)
    if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'DELETE_FINANCE_PURCHASE',
      entity: 'FINANCE',
      entityId: id,
      description: `Compra ${id} apagada`,
      request: req,
    })

    return NextResponse.json({ ok: true })
  })
)
