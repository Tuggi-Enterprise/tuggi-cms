'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { ClientsListAdmin } from '@/components/admin/ClientsListAdmin'
import { ClientDrawer } from '@/components/admin/ClientDrawer'
import { ClientCreateDrawer } from '@/components/admin/ClientCreateDrawer'
import { ClientEditorModal, type ClientEditorTab } from '@/components/admin/clients/ClientEditorModal'
import { useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react'
import { Container } from '@/components/ui/Container'

function AdminClientsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session, isLoading: sessionLoading } = useSessionContext()
  const supabase = useSupabaseClient()
  const clientId = searchParams.get('clientId')
  const isCreateNew = searchParams.get('new') === 'true' || searchParams.get('mode') === 'new'
  // Feature flag — ?v=2 opts into the new ClientEditorModal (drawer + sidebar
  // of tabs, matching POI/Routes). Without it the legacy ClientDrawer /
  // ClientCreateDrawer keep serving everyone, so a regression in the new
  // modal cannot break the live admin flow.
  const useNewEditor = searchParams.get('v') === '2'
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
    if (useNewEditor) {
      params.set('mode', 'new')
    } else {
      params.set('new', 'true')
    }
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

      {useNewEditor ? (
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
      ) : (
        <>
          <ClientDrawer
            clientId={clientId}
            isOpen={!!clientId}
            onClose={closeDrawers}
          />
          <ClientCreateDrawer
            isOpen={isCreateNew}
            onClose={closeDrawers}
            onSuccess={() => {
              setReloadKey((prev) => prev + 1)
            }}
          />
        </>
      )}
    </div>
  )
}

export default function AdminClientsPage() {
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
