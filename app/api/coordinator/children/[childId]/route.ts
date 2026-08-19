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
import {
  CLIENT_COORDINATOR_EDITABLE_FIELDS,
  pickEditableFields,
  validateAvatarUrl,
} from '@/lib/services/client-editable-fields'
import { describeClientUniqueViolation } from '@/lib/services/client-unique-conflicts'

export const dynamic = 'force-dynamic'

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
      .schema('partner')
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

    // Escopo de coordenador = só o bloco de perfil; dinheiro, hierarquia e slug
    // ficam com o admin (ver lib/services/client-editable-fields.ts).
    const updates = pickEditableFields(body, CLIENT_COORDINATOR_EDITABLE_FIELDS)

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
    }

    if ('avatar_url' in updates) {
      const avatarUrl = validateAvatarUrl(updates.avatar_url)
      if (!avatarUrl.ok) {
        return NextResponse.json({ error: avatarUrl.error }, { status: 400 })
      }
      updates.avatar_url = avatarUrl.value
    }

    updates.updated_at = new Date().toISOString()

    const service = getSupabaseService()
    const { data: client, error } = await service
      .schema('partner')
      .from('clients')
      .update(updates)
      .eq('id', childId)
      .select()
      .single()

    if (error) {
      const conflict = describeClientUniqueViolation(error)
      if (conflict) {
        return NextResponse.json({ error: conflict }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, client })
  } catch (error) {
    console.error('❌ PATCH /api/coordinator/children/[childId]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
