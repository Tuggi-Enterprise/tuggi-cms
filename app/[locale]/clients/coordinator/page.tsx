import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getSupabaseServerComponent, getSupabaseService } from '@/lib/core/supabase-client'
import { CoordinatorOverview } from '@/components/clients/coordinator/CoordinatorOverview'

export const metadata = { title: 'Minha rede - Tuggi CMS' }

/**
 * Painel do coordenador (afiliados).
 *
 * Mora sob /clients/ de propósito: o middleware libera não-admin por
 * startsWith('/clients') — uma página em /admin/* bounçaria o coordenador para
 * /unauthorized, por mais permissão que ele tivesse.
 *
 * O gate real dos DADOS é o banco (core.resolve_dashboard_scope, fail-closed). Este
 * check é de navegação: evita entregar uma tela vazia a quem não é coordenador.
 */
export default async function CoordinatorPage() {
  const supabase = getSupabaseServerComponent(await cookies())
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) redirect('/login')

  const service = getSupabaseService()

  const { data: cmsUser } = await service
    .schema('core')
    .from('cms_users')
    .select('id, role')
    .eq('email', user.email)
    .eq('is_active', true)
    .maybeSingle()

  if (!cmsUser) redirect('/unauthorized')

  // Admin da Tuggi entra sempre (dá suporte a qualquer guarda-chuva).
  if (cmsUser.role !== 'admin') {
    // Vínculo real: client_cms_users (+ clients.cms_user_id legado).
    // NUNCA cms_users.client_id — está NULL em 9/9 dos usuários role='client'.
    const [{ data: links }, { data: owned }] = await Promise.all([
      service.schema('core').from('client_cms_users').select('client_id').eq('cms_user_id', cmsUser.id),
      service.schema('core').from('clients').select('id').eq('cms_user_id', cmsUser.id),
    ])

    const clientIds = Array.from(new Set([
      ...(links ?? []).map((l: any) => l.client_id),
      ...(owned ?? []).map((c: any) => c.id),
    ].filter(Boolean)))

    if (clientIds.length === 0) redirect('/unauthorized')

    // Capacidade explícita (core.clients.is_coordinator), setada por admin Tuggi —
    // não derivada de "tem filhas", senão um coordenador novo (zero filhas) nunca entraria.
    const { data: coord } = await service
      .schema('core')
      .from('clients')
      .select('id')
      .in('id', clientIds)
      .eq('is_coordinator', true)
      .limit(1)

    if (!coord || coord.length === 0) redirect('/clients/dashboard')
  }

  return <CoordinatorOverview />
}
