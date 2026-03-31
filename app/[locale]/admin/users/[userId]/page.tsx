'use client'

import AdminUserPassportPage from '@/app/admin/users/[userId]/page'

export default function LocalizedAdminUserPassportPage({ 
  params 
}: { 
  params: Promise<{ locale: string; userId: string }> 
}) {
  return <AdminUserPassportPage params={params} />
}
