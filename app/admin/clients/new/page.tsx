'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Legacy create URL → /admin/clients?mode=new. Creation now happens in
 * the ClientEditorModal on the listing page.
 */
export default function LegacyClientNewRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/clients?mode=new') }, [router])
  return null
}
