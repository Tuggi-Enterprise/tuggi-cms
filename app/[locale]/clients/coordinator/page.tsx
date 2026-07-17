import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getSupabaseServerComponent, getSupabaseService } from '@/lib/core/supabase-client'
import { getCallerRootClientIds, filterCoordinatorClientIds } from '@/lib/services/coordinator-service'
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

  // Admin da Tuggi entra sempre (dá suporte a qualquer guarda-chuva). Demais: precisam ser
  // coordenador (capacidade is_coordinator). Resolução via SSOT do coordinator-service.
  if (cmsUser.role !== 'admin') {
    const clientIds = await getCallerRootClientIds(cmsUser.id)
    if (clientIds.length === 0) redirect('/unauthorized')
    const coordinatorIds = await filterCoordinatorClientIds(clientIds)
    if (coordinatorIds.length === 0) redirect('/clients/dashboard')
  }

  return <CoordinatorOverview />
}
