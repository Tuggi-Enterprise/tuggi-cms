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

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import { ClientDirectory } from '@/components/admin/clients/ClientDirectory'
import { ClientEditorModal, type ClientEditorTab } from '@/components/admin/clients/ClientEditorModal'
import { useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react'
import { RETURN_TO_PARAM, parseReturnTo } from '@/lib/navigation/return-to'
import { applyFilters, parseFilters, type DirectoryFilters } from '@/lib/clients/directory-filter'

function AdminClientsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session, isLoading: sessionLoading } = useSessionContext()
  const supabase = useSupabaseClient()
  const locale = useLocale()
  const messages = useMessages()
  const clientId = searchParams.get('clientId')
  // Backwards compat — old links use ?new=true, the new editor reads ?mode=new.
  const isCreateNew = searchParams.get('mode') === 'new' || searchParams.get('new') === 'true'
  // `?tab=pois` is the old name of the places tab, kept working so links already out there
  // keep landing on the same panel.
  const requestedTab = searchParams.get('tab')
  const initialTab = ((requestedTab === 'pois' ? 'places' : requestedTab) as ClientEditorTab | null) ?? 'profile'
  /**
   * Where closing the record sends the operator — DS-LAYOUT-006, point 2.
   *
   * The partnership pipeline opens this record to have ONE field filled in and expects the
   * operator back in the band they left; without this, closing dropped them on the client list
   * and the way back was the browser's button. The rule of what may be trusted is
   * `lib/navigation/return-to`, shared with the POI screen.
   */
  const returnTo = parseReturnTo(searchParams.get(RETURN_TO_PARAM))

  /**
   * THE FILTERS OF THE LIST LIVE IN THE URL, and that is what let `/admin/partnerships` die:
   * its one distinct behaviour was opening on the working set, which is now
   * `/admin/clients?state=in_progress` — a filter that fits in a link does not need a screen
   * (DS-LAYOUT-003). It also buys the operator something neither list had: `Minas, sem
   * contrato` can be sent to somebody else instead of described as six clicks.
   *
   * `replace` and not `push`: narrowing a rail is not a place in history worth walking back
   * through one click at a time. The other parameters survive, because the client record opens
   * over this list through `?clientId=` and filtering must not close it.
   */
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString())),
    [searchParams]
  )

  const writeFilters = useCallback(
    (next: DirectoryFilters) => {
      const params = applyFilters(new URLSearchParams(searchParams.toString()), next)
      const query = params.toString()
      router.replace(`/admin/clients${query ? `?${query}` : ''}`, { scroll: false })
    },
    [router, searchParams]
  )
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
    // Whoever sent the operator here gets them back, in the state they left.
    if (returnTo) {
      router.push(returnTo)
      return
    }
    const params = new URLSearchParams(searchParams.toString())
    params.delete('clientId')
    params.delete('new')
    params.delete('mode')
    params.delete('tab')
    // A `returnTo` that did not survive `parseReturnTo` is not carried into the next URL: it
    // would sit in the address bar looking like a promise nothing keeps.
    params.delete(RETURN_TO_PARAM)
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
      {/*
        ONE LIST. `ClientsListAdmin` read `core.clients` and `PartnershipsQueue` read
        `core.partner_form_submissions`, so the same establishment was two rows in two screens.
        `ClientDirectory` renders the union, and the pipeline vocabulary — the states, `o que
        falta`, the triage clock — is Portuguese-only by decision (#408), so it is overlaid on
        the operator's messages rather than replacing them.
      */}
      <NextIntlClientProvider
        locale={locale}
        messages={{ ...messages, Partnerships: ptMessages.Partnerships }}
      >
        <ClientDirectory
          key={reloadKey}
          locale={locale}
          filters={filters}
          onFiltersChange={writeFilters}
          onCreateNew={startCreateNew}
        />
      </NextIntlClientProvider>

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
