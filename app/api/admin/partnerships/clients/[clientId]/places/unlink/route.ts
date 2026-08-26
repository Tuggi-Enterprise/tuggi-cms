/**
 * POST /api/admin/partnerships/clients/{clientId}/places/unlink — soltar o local do parceiro.
 *
 * A PORTA QUE FALTAVA NA PAREDE. `../link` recusa vincular o local que já é de outro cliente
 * (`other_owner`, BR-B2B-033, item 3) e escreve `partner_client_id` com uma trava de corrida
 * (`.is('partner_client_id', null)`). As duas coisas estão certas e juntas produziam um beco:
 * quem vinculou o registro errado — a duplicata vazia em vez do estabelecimento publicado, que é
 * o defeito de 3 em 3 clientes medido em `lib/partnerships/place-link` — não tinha ato nenhum
 * para desfazer. O operador pediu isto em 2026-08-26: *"precisa ser necessário tirar um local
 * vinculado ao parceiro e vincular outro"*.
 *
 * ELE ESCREVE UMA COLUNA, E É A MESMA QUE `../link` ESCREVE. `partner_client_id = NULL`. Não
 * apaga o local, não mexe em `approved`, `is_active` ou `priority_level`, e não despublica nada:
 * `core.app_get_nearby_places` e `core.app_poi_read` não leem essa coluna, então o local
 * continua no app exatamente como estava — o que ele perde é o dono. Apagar é outro ato, com
 * outra porta e outra guarda (`PlaceDeleteControl`, BR-POI-005: o registro carrega visita e
 * feedback de turista).
 *
 * O POI DE BOAS-VINDAS SEGUE O VÍNCULO, na mesma medida em que o segue na ida. `../link` adota
 * `partner.clients.welcome_poi_id` quando ele está vazio; aqui ele é limpo quando aponta para o
 * local que está sendo solto — deixá-lo apontando para um local que não é mais do cliente
 * recriaria exatamente a divergência que a adoção existe para fechar (10 de 10 clientes em
 * 2026-08-23). Se o cliente tem outros locais, quem escolhe o próximo é o operador, na tela.
 *
 * A ESCRITA EM `partner` VAI POR `service_role`, e tem de ir: `authenticated` não tem `USAGE` no
 * schema (`42501`). A rota está atrás de `withAuth({ roles: ['admin'] })`.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { unlinkVerdictFor, type LinkCandidate } from '@/lib/partnerships/place-link'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withRateLimit(20, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    const body = (await req.json().catch(() => null)) as { attractionId?: string } | null
    const attractionId = body?.attractionId
    if (!attractionId || !UUID_PATTERN.test(attractionId)) {
      return NextResponse.json({ error: 'invalid_attraction_id' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, entity_kind, approved, partner_client_id')
      .eq('id', attractionId)
      .maybeSingle()

    if (error) {
      console.error('[partnerships] unlink lookup failed:', error.message)
      return NextResponse.json({ error: 'lookup_failed' }, { status: 503 })
    }
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const row = data as {
      id: string
      name: string
      city: string | null
      state: string | null
      country: string | null
      entity_kind: string
      approved: boolean | null
      partner_client_id: string | null
    }

    const candidate: LinkCandidate = {
      attractionId: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      country: row.country,
      entityKind: row.entity_kind,
      approved: row.approved === true,
      // Não é lido por `unlinkVerdictFor`: soltar não pergunta se o local está bom, só de quem
      // ele é. Está aqui porque o candidato é o mesmo tipo que a ida usa.
      hasCoordinate: true,
      partnerClientId: row.partner_client_id,
    }

    if (unlinkVerdictFor(candidate, clientId).kind !== 'ok') {
      // Cobre o local que não é de ninguém e o que é de outro cliente. Um duplo clique cai aqui
      // com o vínculo já desfeito, então a resposta é 200 e não erro.
      if (row.partner_client_id === null) {
        return NextResponse.json({ ok: true, unlinked: false, place: candidate })
      }
      return NextResponse.json({ error: 'other_owner', place: candidate }, { status: 409 })
    }

    // `.eq('partner_client_id', clientId)` é a trava de corrida, espelho do `.is(..., null)` da
    // ida: dois operadores em duas abas não podem soltar o vínculo que o outro acabou de mover.
    const { data: updated, error: writeError } = await auth.supabase
      .schema('core')
      .from('attractions')
      .update({ partner_client_id: null })
      .eq('id', attractionId)
      .eq('partner_client_id', clientId)
      .select('id')

    if (writeError) {
      console.error('[partnerships] unlink failed:', writeError.message)
      return NextResponse.json({ error: 'unlink_failed' }, { status: 503 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'other_owner', place: candidate }, { status: 409 })
    }

    // O boas-vindas segue — ver o cabeçalho. Falhar aqui não derruba o ato: o local JÁ está
    // solto, e é `partner_client_id` que a esteira lê.
    let welcomeCleared = false
    const { data: cleared, error: welcomeError } = await getSupabaseService()
      .schema('partner')
      .from('clients')
      .update({ welcome_poi_id: null })
      .eq('id', clientId)
      .eq('welcome_poi_id', attractionId)
      .select('id')

    if (welcomeError) {
      console.error('[partnerships] welcome poi not cleared:', welcomeError.message)
    } else {
      welcomeCleared = (cleared ?? []).length > 0
    }

    await logAuditEvent({
      request: req,
      action: 'UNLINK_PARTNER_PLACE',
      entity: 'POI',
      entityId: attractionId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      description:
        `${row.entity_kind} ${attractionId} (${row.name}) unlinked from client ${clientId}; ` +
        `the record stays in the catalogue` +
        (welcomeCleared ? ', and its welcome POI pointer was cleared' : ''),
    })

    return NextResponse.json({
      ok: true,
      unlinked: true,
      welcomeCleared,
      place: { ...candidate, partnerClientId: null },
    })
  })
)
