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
import { ClientBoard } from '@/components/admin/clients/ClientBoard'
import { useClientDirectory } from '@/lib/hooks/use-client-directory'
import { useBoardActs } from '@/lib/hooks/use-board-acts'
import { ViewSwitch, isBoardView, VIEW_PARAM } from '@/components/admin/clients/ViewSwitch'
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
  /**
   * WHICH VIEW, and the board is the default.
   *
   * The screen is read to WORK the queue far more often than to look a partner up, so the shape
   * that answers `where is each one stuck` is what a clean URL opens. Only `?view=table` is ever
   * written, which keeps `Limpar filtros` able to empty the address bar and keeps every link
   * already out there — none of which carries `view` — landing on the board.
   */
  const board = isBoardView(searchParams.get(VIEW_PARAM))

  const directory = useClientDirectory()

  /**
   * Where an act takes the operator back to — this list, with its filters and its view intact.
   * Same contract as `parseReturnTo`, so the panel it opens knows the way home.
   */
  const boardHref = useMemo(() => {
    const query = searchParams.toString()
    return `/admin/clients${query ? `?${query}` : ''}`
  }, [searchParams])

  const navigate = useCallback((href: string) => router.push(href), [router])

  const openRecord = useCallback(
    (id: string, tab: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('clientId', id)
      params.set('tab', tab)
      router.push(`/admin/clients?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  const acts = useBoardActs({
    locale,
    returnTo: boardHref,
    navigate,
    openRecord,
    reload: directory.reload,
  })

  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

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

  /** Switching views keeps every filter: it is the same list, read a different way. */
  const switchView = (toBoard: boolean) => {
    const params = new URLSearchParams(searchParams.toString())
    if (toBoard) params.delete(VIEW_PARAM)
    else params.set(VIEW_PARAM, 'table')
    const query = params.toString()
    router.replace(`/admin/clients${query ? `?${query}` : ''}`, { scroll: false })
  }

  const viewSwitch = <ViewSwitch board={board} onChange={switchView} />

  return (
    <>
      {/*
        ONE LIST, TWO READINGS. `ClientsListAdmin` read `partner.clients` and `PartnershipsQueue`
        read `partner.partner_form_submissions`, so the same establishment was two rows in two
        screens. There is one set of rows now, and the operator chooses the shape: the board for
        working the queue, the table for looking things up.

        THE WHOLE ESTEIRA IS PORTUGUESE, and the seam is between SCREENS rather than inside a
        sentence. Decision #408 made the pipeline vocabulary pt-only; the first cut of this
        screen applied that to `Partnerships` alone and left `Clients.directory` translated, so
        one card read `Proposta recebida` over `Proposal, not registered yet` over `Abrir` —
        three languages in four lines. A costura that falls in the middle of a card is not a
        translation, it is a defect.

        So the three namespaces the esteira speaks — `Partnerships`, `Clients.directory` and
        `Clients.board` — are overlaid in Portuguese, whatever locale the operator is on. The
        rest of `Clients` (the editor, the fiscal tab, the team) stays translated, because those
        are the CLIENT's record and not the pipeline. `Clients.directory` and `Clients.board`
        have no reader outside these four components, which is what makes the overlay total
        rather than a fallback with holes in it.
      */}
      <NextIntlClientProvider
        locale={locale}
        messages={{
          ...messages,
          Partnerships: ptMessages.Partnerships,
          Clients: {
            ...(messages.Clients ?? {}),
            directory: ptMessages.Clients.directory,
            board: ptMessages.Clients.board,
          },
        }}
      >
        {board ? (
          <ClientBoard
            locale={locale}
            filters={filters}
            onFiltersChange={writeFilters}
            onCreateNew={startCreateNew}
            rows={directory.rows}
            truncated={directory.truncated}
            loading={directory.loading}
            failed={directory.failed}
            onAct={(row, act) => void acts.run(row, act)}
            viewSwitch={viewSwitch}
          />
        ) : (
          <ClientDirectory
            locale={locale}
            filters={filters}
            onFiltersChange={writeFilters}
            onCreateNew={startCreateNew}
            rows={directory.rows}
            truncated={directory.truncated}
            loading={directory.loading}
            failed={directory.failed}
            viewSwitch={viewSwitch}
          />
        )}
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
          // One read behind both views: saving the record re-reads the list rather than
          // remounting it, so the board keeps its scroll and its expanded columns.
          directory.reload()
        }}
      />
    </>
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
