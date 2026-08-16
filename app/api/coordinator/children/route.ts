/**
 * GET  /api/coordinator/children — empresas do guarda-chuva do caller, com métricas
 * POST /api/coordinator/children — cadastra uma empresa-filha
 *
 * Coordenador = client com is_coordinator = true. Admin da Tuggi também usa (informando
 * ?root=<client>). Escopo SEMPRE resolvido da sessão — nunca do body.
 *
 * NÃO expõe POI: por decisão de produto, coordenadores e empresas não têm acesso a POIs.
 * NÃO expõe PII: as métricas vêm de core.coordinator_child_breakdown (só agregados).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  resolveCoordinator,
  resolveParentForNewChild,
  canTouchClient,
} from '@/lib/services/coordinator-service'
import { describeClientUniqueViolation } from '@/lib/services/client-unique-conflicts'
import { DEFAULT_CLIENT_TYPE, isClientType } from '@/types/clients'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const res = await resolveCoordinator()
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    const { ctx } = res

    // Admin precisa dizer de qual guarda-chuva quer ver; coordenador usa a própria raiz.
    const requestedRoot = request.nextUrl.searchParams.get('root')
    const root = requestedRoot ?? ctx.rootClientIds[0]

    if (!root) {
      return NextResponse.json({ error: 'root is required' }, { status: 400 })
    }
    if (!canTouchClient(ctx, root)) {
      return NextResponse.json({ error: 'Forbidden: root out of scope' }, { status: 403 })
    }

    const service = getSupabaseService()

    // O RPC revalida o escopo no banco (resolve_dashboard_scope) — defesa em profundidade:
    // mesmo que o gate acima falhasse, o banco recusa com 42501.
    const { data: breakdown, error: rpcError } = await service
      .schema('core')
      .rpc('coordinator_child_breakdown', { p_root: root })

    if (rpcError) {
      // 42501 = fora de escopo (a trava do banco). Traduz para 403 em vez de 500.
      const status = rpcError.code === '42501' ? 403 : 500
      return NextResponse.json({ error: rpcError.message }, { status })
    }

    const { data: series, error: seriesError } = await service
      .schema('core')
      .rpc('coordinator_signup_timeseries', { p_root: root, p_months: 12 })

    if (seriesError) console.warn('coordinator_signup_timeseries:', seriesError.message)

    return NextResponse.json({
      success: true,
      root,
      children: breakdown ?? [],
      timeseries: series ?? [],
    })
  } catch (error) {
    console.error('❌ GET /api/coordinator/children:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const res = await resolveCoordinator()
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    const { ctx } = res

    const body = await request.json()
    const {
      name, email, phone, company_name, address, city, state, country,
      postal_code, industry, website, client_type,
      parent_client_id: requestedParent,
    } = body

    if (!name || !email) {
      return NextResponse.json({ error: 'Missing required fields: name, email' }, { status: 400 })
    }

    // Um tipo que o CHECK recusa é 400 com o nome do campo, não o 500 da constraint: esta
    // rota carrega `service_role`, que ignora RLS, e é a única barreira que sobra.
    if (client_type != null && client_type !== '' && !isClientType(client_type)) {
      return NextResponse.json({ error: 'Invalid client_type' }, { status: 400 })
    }

    // O pai vem do SERVIDOR. Um não-admin nunca consegue pendurar uma filha em
    // guarda-chuva alheio, mesmo mandando parent_client_id no body.
    const parent = resolveParentForNewChild(ctx, requestedParent)
    if (!parent.ok) return NextResponse.json({ error: parent.error }, { status: parent.status })

    const service = getSupabaseService()

    const { data: client, error: insertError } = await service
      .schema('core')
      .from('clients')
      .insert([{
        name,
        email,
        phone: phone || null,
        company_name: company_name || null,
        address: address || null,
        city: city || null,
        state: state || null,
        country: country || null,
        postal_code: postal_code || null,
        industry: industry || null,
        website: website || null,
        // O default é declarado uma vez, em `types/clients.ts`, e lido aqui.
        client_type: client_type || DEFAULT_CLIENT_TYPE,
        parent_client_id: parent.parentId,
        // Filha de coordenador nasce APPROVED (decisão de produto): o QR precisa funcionar
        // no ato. A landing /d/<slug> não filtra status — uma filha 'pending' captaria
        // cadastros na mesma, então 'pending' aqui seria só uma etiqueta enganosa.
        status: 'approved',
        // slug é gerado pelo trigger core.ensure_client_slug a partir do company_name/name.
        // É ele que faz o QR (tuggi.app/d/<slug>) existir sem código nenhum.
      }])
      .select()
      .single()

    if (insertError) {
      // A child sharing the parent's e-mail is the point of this screen, not a conflict:
      // several places, one owner. Only a real unique constraint answers 409 here.
      const conflict = describeClientUniqueViolation(insertError)
      if (conflict) {
        return NextResponse.json({ error: conflict }, { status: 409 })
      }
      // 23514 = trigger core.enforce_client_hierarchy_depth (2 níveis / ciclo)
      if (insertError.code === '23514') {
        return NextResponse.json({ error: insertError.message }, { status: 409 })
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, client }, { status: 201 })
  } catch (error) {
    console.error('❌ POST /api/coordinator/children:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
