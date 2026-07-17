/**
 * GET /api/coordinator/roots — guarda-chuvas que o caller pode visualizar.
 *
 * - Coordenador (não-admin): os próprios clients-raiz (normalmente 1).
 * - Admin da Tuggi: todos os clients com is_coordinator = true, para dar suporte.
 *
 * Alimenta o seletor de guarda-chuva na página do coordenador. Sem isto, um admin
 * não teria como escolher QUAL rede ver, e a página nasceria sem root (400).
 */

import { NextResponse } from 'next/server'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { resolveCoordinator } from '@/lib/services/coordinator-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await resolveCoordinator()
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    const { ctx } = res

    const service = getSupabaseService()

    if (ctx.isAdmin) {
      const { data, error } = await service
        .schema('core')
        .from('clients')
        .select('id, company_name, slug')
        .eq('is_coordinator', true)
        .order('company_name')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ isAdmin: true, roots: data ?? [] })
    }

    // Coordenador: só as próprias raízes (as que são de fato coordenador).
    const { data, error } = await service
      .schema('core')
      .from('clients')
      .select('id, company_name, slug')
      .in('id', ctx.rootClientIds.length ? ctx.rootClientIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('is_coordinator', true)
      .order('company_name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ isAdmin: false, roots: data ?? [] })
  } catch (error) {
    console.error('❌ GET /api/coordinator/roots:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
