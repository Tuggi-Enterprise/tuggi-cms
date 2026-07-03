import { redirect } from 'next/navigation'
import { getSupabaseServerComponent } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { ClientApprovalPanel } from '@/components/clients/ClientApprovalPanel'

export const metadata = {
  title: 'Client Approvals - Tuggi CMS'
}

export default async function ClientApprovalsPage() {
  const supabase = getSupabaseServerComponent(await cookies())
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Verify admin role
  const { data: cmsUser } = await supabase
    .schema('core')
    .from('cms_users')
    .select('role')
    .eq('email', user.email)
    .single()

  if (cmsUser?.role !== 'admin') {
    redirect('/unauthorized')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Client Registrations</h1>
        <p className="text-gray-600 mt-2">Review and approve pending client registrations</p>
      </div>

      <ClientApprovalPanel
        onApprove={(clientId) => {
          console.log('Client approved:', clientId)
        }}
        onReject={(clientId) => {
          console.log('Client rejected:', clientId)
        }}
      />
    </div>
  )
}
