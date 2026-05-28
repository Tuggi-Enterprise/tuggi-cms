'use client'

/**
 * Client-side content of the /admin/clients page. Lives in components/
 * (rather than directly under app/) so the non-locale app/admin/clients
 * route can stay a tiny Server Component redirect — that way the build
 * doesn't try to prerender this tree without a next-intl provider, which
 * crashes when ClientEditorModal calls useTranslations().
 *
 * Imported by app/[locale]/admin/clients/page.tsx where the provider
 * (and the user's actual session) does exist.
 */

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ClientsListAdmin } from '@/components/admin/ClientsListAdmin'
import { ClientEditorModal, type ClientEditorTab } from '@/components/admin/clients/ClientEditorModal'
import { useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react'
import { Container } from '@/components/ui/Container'

function AdminClientsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session, isLoading: sessionLoading } = useSessionContext()
  const supabase = useSupabaseClient()
  const clientId = searchParams.get('clientId')
  // Backwards compat — old links use ?new=true, the new editor reads ?mode=new.
  const isCreateNew = searchParams.get('mode') === 'new' || searchParams.get('new') === 'true'
  const initialTab = (searchParams.get('tab') as ClientEditorTab | null) ?? 'profile'
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Reload key to trigger refresh on list
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const checkAuth = async () => {
      if (sessionLoading) return
      if (!session) {
        router.push('/login')
        return
      }

      try {
        const { data: cmsUser } = await supabase
          .schema('core')
          .from('cms_users')
          .select('role')
          .eq('email', session.user.email)
          .single()

        if (cmsUser?.role !== 'admin') {
          router.push('/unauthorized')
          return
        }

        setIsAuthorized(true)
      } catch (error) {
        console.error('Auth error:', error)
        router.push('/unauthorized')
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [session, sessionLoading, router, supabase])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthorized) {
    return null
  }

  const closeDrawers = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('clientId')
    params.delete('new')
    params.delete('mode')
    params.delete('tab')
    const query = params.toString()
    router.push(`/admin/clients${query ? `?${query}` : ''}`, { scroll: false })
  }

  const startCreateNew = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('new')
    params.set('mode', 'new')
    router.push(`/admin/clients?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <ClientsListAdmin
          key={reloadKey}
          onCreateNew={startCreateNew}
        />
      </Container>

      <ClientEditorModal
        clientId={clientId ?? undefined}
        isOpen={Boolean(clientId) || isCreateNew}
        mode={clientId ? 'edit' : 'new'}
        initialTab={initialTab}
        onClose={closeDrawers}
        onSaved={(savedId) => {
          // After a successful create, update the URL to ?clientId={savedId}
          // so the modal flips to edit mode without losing the user's place.
          const params = new URLSearchParams(searchParams.toString())
          params.delete('mode')
          params.delete('new')
          params.set('clientId', savedId)
          router.push(`/admin/clients?${params.toString()}`, { scroll: false })
          setReloadKey((prev) => prev + 1)
        }}
      />
    </div>
  )
}

export function AdminClientsPageContent() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
      </div>
    }>
      <AdminClientsContent />
    </Suspense>
  )
}
