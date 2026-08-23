/**
 * DELETE /api/admin/places/{attractionId} — apagar um local do catálogo.
 *
 * ELE SE RECUSA A APAGAR HISTÓRIA, e é isso que o separa do `deletePoi` da tela de POIs. O
 * `DELETE` em `core.attractions` propaga em cascata para 17 tabelas, e cinco delas guardam o que
 * turistas fizeram — visitas, feedback, sessões de viagem. `partner.partner_triage_refusals` é
 * append-only por decisão (BR-B2B-011, item 5). Nada disso volta.
 *
 * O que motiva o card é o outro grupo: as duplicatas que `Criar o local a partir da proposta`
 * gerou ao lado de estabelecimentos já publicados, com zero de tudo. Essas somem; as demais
 * saem do ar por `is_active` (BR-POI-005), que preserva a história.
 *
 * A DECISÃO É DE `lib/core/place-delete`, e esta rota levanta os fatos e obedece — a régua é
 * pura para poder ser lida e testada sem banco.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { verdictFor, type PlaceHistory } from '@/lib/core/place-delete'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { attractionId: string }

/** Uma contagem, sem trazer as linhas — o head do PostgREST. */
async function countOf(
  supabase: any,
  schema: string,
  table: string,
  column: string,
  id: string
): Promise<number> {
  const { count, error } = await supabase
    .schema(schema)
    .from(table)
    .select(column, { count: 'exact', head: true })
    .eq(column, id)
  // Falha fechada: apagar em cima de uma leitura que não respondeu é apagar sem saber.
  if (error) throw new Error(`${schema}.${table}: ${error.message}`)
  return count ?? 0
}

export const DELETE = withRateLimit(10, 60_000)(
  withAuth<Params>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const attractionId = params?.attractionId
    if (!attractionId || !UUID_PATTERN.test(attractionId)) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .schema('core')
      .from('attractions')
      .select('id, name, entity_kind, partner_client_id')
      .eq('id', attractionId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 503 })
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const row = data as {
      name: string
      entity_kind: string
      partner_client_id: string | null
    }

    let history: PlaceHistory
    try {
      const [visits, feedback, sessions, triageRefusals, welcomeFor] = await Promise.all([
        countOf(auth.supabase, 'drive', 'poi_visits', 'poi_id', attractionId),
        countOf(auth.supabase, 'drive', 'attraction_feedback', 'attraction_id', attractionId),
        countOf(auth.supabase, 'drive', 'trip_session_attractions', 'attraction_id', attractionId),
        countOf(auth.supabase, 'partner', 'partner_triage_refusals', 'attraction_id', attractionId),
        countOf(auth.supabase, 'partner', 'clients', 'welcome_poi_id', attractionId),
      ])
      history = {
        visits,
        feedback,
        sessions,
        triageRefusals,
        welcomeFor,
        partnerClientId: row.partner_client_id,
      }
    } catch (lookupError) {
      console.error('[places] history lookup failed:', lookupError)
      return NextResponse.json({ error: 'lookup_failed' }, { status: 503 })
    }

    const verdict = verdictFor(history)
    if (verdict.kind === 'blocked') {
      // 409 e a lista inteira: cada motivo é uma coisa diferente a fazer, e devolver um por vez
      // faz o operador tentar de novo para descobrir o seguinte.
      return NextResponse.json({ error: 'has_history', reasons: verdict.reasons, history }, { status: 409 })
    }

    const { error: deleteError } = await auth.supabase
      .schema('core')
      .from('attractions')
      .delete()
      .eq('id', attractionId)

    if (deleteError) {
      console.error('[places] delete failed:', deleteError.message)
      return NextResponse.json({ error: 'delete_failed' }, { status: 503 })
    }

    await logAuditEvent({
      request: req,
      action: 'DELETE_PLACE',
      entity: 'POI',
      entityId: attractionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description: `Place ${attractionId} (${row.name}, ${row.entity_kind}) deleted from the catalogue with no visits, feedback, sessions, triage refusals or partner link`,
    })

    return NextResponse.json({ ok: true })
  })
)
