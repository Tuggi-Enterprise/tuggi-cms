'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

/**
 * Legacy deep-link → /admin/clients?clientId={id}. Edit and view now share
 * the same ClientEditorModal — there is no separate edit page anymore.
 */
export default function LegacyClientEditRedirect() {
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
