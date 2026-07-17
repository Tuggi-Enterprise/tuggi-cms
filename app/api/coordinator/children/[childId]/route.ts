/**
 * GET   /api/coordinator/children/[childId] — dados de uma empresa do guarda-chuva
 * PATCH /api/coordinator/children/[childId] — edita uma empresa do guarda-chuva
 *
 * Espelha /api/admin/clients/[clientId] para que o ClientEditorModal possa ser reusado
 * apenas trocando a prop `apiBase` — mas com escopo de coordenador em vez de admin-only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { resolveCoordinator, canTouchClient } from '@/lib/services/coordinator-service'

export const dynamic = 'force-dynamic'

// Campos que o coordenador pode editar numa filha.
// Deliberadamente FORA da lista:
//   parent_client_id  → mover uma filha de guarda-chuva não é edição de perfil
//   is_coordinator    → promover alguém a coordenador é decisão comercial da Tuggi
//   is_platform_owner → só a Tuggi é dona da plataforma
//   commission_rate   → dinheiro; a Tuggi define (a aba Fiscal é admin-only)
//   status            → nasce 'approved' e só a Tuggi rebaixa
//   slug              → muda a URL do QR já impresso/distribuído; exige decisão explícita
const EDITABLE_FIELDS = [
  'name', 'email', 'phone', 'company_name', 'address', 'city', 'state',
  'country', 'postal_code', 'industry', 'website', 'client_type',
  'avatar_url', 'social_handle', 'bio_one_line',
] as const

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ childId: string }> }
) {
  try {
    const { childId } = await params
    const res = await resolveCoordinator()
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

    if (!canTouchClient(res.ctx, childId)) {
      return NextResponse.json({ error: 'Forbidden: client out of scope' }, { status: 403 })
    }

    const service = getSupabaseService()
    const { data: client, error } = await service
      .schema('core')
      .from('clients')
      .select('*')
      .eq('id', childId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true, client })
  } catch (error) {
    console.error('❌ GET /api/coordinator/children/[childId]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ childId: string }> }
) {
  try {
    const { childId } = await params
    const res = await resolveCoordinator()
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

    // Escopo checado ANTES de olhar o body: o id vem da URL e é tão não-confiável quanto ele.
    if (!canTouchClient(res.ctx, childId)) {
      return NextResponse.json({ error: 'Forbidden: client out of scope' }, { status: 403 })
    }

    const body = await request.json()

    // Allowlist, não denylist: campo novo em core.clients não vira editável por acidente.
    const updates: Record<string, any> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in body) updates[field] = body[field] ?? null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
    }
    updates.updated_at = new Date().toISOString()

    const service = getSupabaseService()
    const { data: client, error } = await service
      .schema('core')
      .from('clients')
      .update(updates)
      .eq('id', childId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, client })
  } catch (error) {
    console.error('❌ PATCH /api/coordinator/children/[childId]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
