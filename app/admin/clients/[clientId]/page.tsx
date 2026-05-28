'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

/**
 * Legacy deep-link → /admin/clients?clientId={id}. The standalone client
 * details page no longer exists; everything happens in the ClientEditorModal
 * on the listing page. Kept as a redirect so old bookmarks keep working.
 */
export default function LegacyClientDetailsRedirect() {
  const router = useRouter()
  const params = useParams()
  const clientId = typeof params?.clientId === 'string'
    ? params.clientId
    : Array.isArray(params?.clientId) ? params.clientId[0] : undefined

  useEffect(() => {
    if (clientId) router.replace(`/admin/clients?clientId=${clientId}`)
    else router.replace('/admin/clients')
  }, [clientId, router])

  return null
}
