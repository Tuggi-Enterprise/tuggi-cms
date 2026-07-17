/**
 * POST /api/admin/clients/[clientId]/team/create-login
 *
 * Cria um login de acesso ao CMS para uma pessoa e o vincula a ESTE cliente na
 * core.client_cms_users (o vínculo VIVO). Admin-only.
 *
 * Por que um endpoint dedicado em vez de encadear POST /api/admin/users + link-client
 * no frontend:
 *   1. POST /api/admin/users exige client_id e grava o cms_users.client_id LEGADO (morto).
 *      Aqui o vínculo vai só para client_cms_users, que é o que o escopo realmente usa.
 *   2. Faz auth.users + cms_users + client_cms_users numa chamada, com rollback do auth
 *      user se o vínculo falhar — sem deixar login órfão.
 *
 * Serve para qualquer membro de equipe; no fluxo de afiliados é como se dá login ao
 * coordenador (client_role = 'owner').
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSupabaseRouteHandler, getSupabaseService } from '@/lib/core/supabase-client'

const CLIENT_ROLES = ['owner', 'manager', 'viewer'] as const
type ClientRole = (typeof CLIENT_ROLES)[number]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)

    // getUser() (não getSession) revalida o JWT no servidor de auth.
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const service = getSupabaseService()

    const { data: adminUser } = await service
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', user.email)
      .eq('is_active', true)
      .maybeSingle()

    if (!adminUser || adminUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }

    const body = await request.json()
    const email: string = (body.email ?? '').trim().toLowerCase()
    const fullName: string = (body.full_name ?? '').trim()
    const password: string = body.password ?? ''
    const clientRole: ClientRole = CLIENT_ROLES.includes(body.client_role)
      ? body.client_role
      : 'owner'

    if (!email || !fullName) {
      return NextResponse.json({ error: 'email e full_name são obrigatórios' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'A senha precisa ter ao menos 8 caracteres' }, { status: 400 })
    }

    // Confirma que o cliente existe (o vínculo aponta para ele).
    const { data: client } = await service
      .schema('core')
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }

    // 1. Conta de auth. email_confirm=true: acesso imediato, sem e-mail de confirmação.
    const { data: authCreated, error: createErr } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr || !authCreated?.user) {
      if (createErr?.message?.includes('already') ) {
        return NextResponse.json({ error: 'E-mail já registrado' }, { status: 409 })
      }
      return NextResponse.json({ error: createErr?.message ?? 'Falha ao criar login' }, { status: 500 })
    }
    const newUserId = authCreated.user.id

    // 2. cms_users (role 'client'). cms_users.id = auth.users.id é o elo entre os dois.
    //    NÃO seta client_id (coluna morta) — o vínculo é o client_cms_users abaixo.
    const { error: cmsErr } = await service
      .schema('core')
      .from('cms_users')
      .insert([{ id: newUserId, email, full_name: fullName, role: 'client', is_active: true }])

    if (cmsErr) {
      await service.auth.admin.deleteUser(newUserId).catch(() => {})   // rollback
      if (cmsErr.code === '23505') {
        return NextResponse.json({ error: 'E-mail já registrado no CMS' }, { status: 409 })
      }
      return NextResponse.json({ error: cmsErr.message }, { status: 500 })
    }

    // 3. Vínculo VIVO usuário↔cliente.
    const { error: linkErr } = await service
      .schema('core')
      .from('client_cms_users')
      .insert([{ client_id: clientId, cms_user_id: newUserId, client_role: clientRole, linked_by: adminUser.id }])

    if (linkErr) {
      // rollback total: sem o vínculo, o login não teria escopo (fail-closed) — não deixar lixo.
      try { await service.schema('core').from('cms_users').delete().eq('id', newUserId) } catch { /* best-effort */ }
      await service.auth.admin.deleteUser(newUserId).catch(() => {})
      return NextResponse.json({ error: linkErr.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      user: { id: newUserId, email, full_name: fullName, client_role: clientRole },
    }, { status: 201 })
  } catch (error) {
    console.error('❌ POST create-login:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
