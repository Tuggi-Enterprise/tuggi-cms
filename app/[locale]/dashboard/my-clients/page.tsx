import { redirect } from 'next/navigation'
import { getSupabaseServerComponent } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { ClientDashboard } from '@/components/clients/ClientDashboard'

export const metadata = {
  title: 'My Clients - Tuggi CMS'
}

export default async function MyClientsPage() {
  const supabase = getSupabaseServerComponent(await cookies())
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Verify client or admin role
  const { data: cmsUser } = await supabase
    .schema('core')
    .from('cms_users')
    .select('role')
    .eq('email', user.email)
    .single()

  if (cmsUser?.role !== 'client' && cmsUser?.role !== 'admin') {
    redirect('/unauthorized')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">My Clients</h1>
        <p className="text-gray-600 mt-2">Manage your clients and linked users</p>
      </div>

      <ClientDashboard />
    </div>
  )
}
