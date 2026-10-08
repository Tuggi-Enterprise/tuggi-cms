'use client'

/**
 * Client-side content of /admin/clients/cancellations — card #913, BR-B2B-060 item 7, spec
 * `docs/design/spec-cancelamento-places-2026-10.md` §5. Shell, table, pagination and states copy
 * `AdminCouponRedemptionsPageContent`.
 *
 * Every portal cancellation, including the ones that skipped the question: that is what measures
 * the answer rate. The filter lives in the URL (`?contact=pending|done|declined&reason=<code>`).
 */

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/Container'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { formatDate } from '@/lib/contract/snapshot'
import {
  CANCEL_REASONS,
  CONTACT_STATES,
  isCancelReason,
  isContactState,
  type Cancellation,
} from '@/lib/clients/cancellations'
import { CancellationContact, useContactToggle } from '@/components/admin/clients/CancellationContact'

const PAGE_SIZE = 20

export interface CancellationsViewProps {
  rows: Cancellation[]
  loading: boolean
  error: string | null
  unavailable: boolean
  filtered: boolean
  busyId: string | null
  onToggle: (row: Cancellation, mark: boolean) => void
  onClearFilters: () => void
}

/** The table, without data fetching or routing. */
export function CancellationsView({ rows, loading, error, unavailable, filtered, busyId, onToggle, onClearFilters }: CancellationsViewProps) {
  const t = useTranslations('Clients.cancellations')
  return (
    <>
      {error && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">{t('headers.place')}</th>
              <th className="px-4 py-3 text-left">{t('headers.canceledAt')}</th>
              <th className="px-4 py-3 text-left">{t('headers.reason')}</th>
              <th className="px-4 py-3 text-left">{t('headers.comment')}</th>
              <th className="px-4 py-3 text-left">{t('headers.contact')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  {t('loading')}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  {unavailable ? t('unavailable') : filtered ? t('emptyFiltered') : t('empty')}
                  {filtered && !unavailable && (
                    <button type="button" onClick={onClearFilters} className="ml-2 font-semibold text-tuggi-blue hover:underline">
                      {t('clearFilters')}
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.feedbackId} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {r.clientId ? (
                      <Link href={`/admin/clients?clientId=${r.clientId}&tab=fiscal`} className="hover:text-tuggi-blue hover:underline">
                        {r.placeName ?? '—'}
                      </Link>
                    ) : (
                      (r.placeName ?? '—')
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(r.canceledAt)}</td>
                  <td className="px-4 py-3 text-gray-700">{t(`reasons.${r.reason ?? 'none'}`)}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-[320px]">
                    <p className="line-clamp-2" title={r.comment ?? undefined}>
                      {r.comment ?? '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <CancellationContact row={r} busy={busyId === r.feedbackId} onToggle={onToggle} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AdminCancellationsContent() {
  const t = useTranslations('Clients.cancellations')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Same gate as the route: admin only.
  const { isAdmin, isLoading: authChecking } = useCmsUser()
  const isAuthorized = !authChecking && isAdmin

  const rawContact = searchParams.get('contact')
  const rawReason = searchParams.get('reason')
  const contact = isContactState(rawContact) ? rawContact : ''
  const reason = isCancelReason(rawReason) ? rawReason : ''
  const filtered = Boolean(contact || reason)

  const [rows, setRows] = useState<Cancellation[]>([])
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!authChecking && !isAdmin) router.push('/unauthorized')
  }, [authChecking, isAdmin, router])

  const setFilter = (next: { contact?: string; reason?: string }) => {
    const params = new URLSearchParams()
    const c = next.contact ?? contact
    const r = next.reason ?? reason
    if (c) params.set('contact', c)
    if (r) params.set('reason', r)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  /** `quiet`: a reread after a save keeps the table on screen. */
  const fetchPage = async (target: number, quiet = false) => {
    try {
      if (!quiet) setLoading(true)
      setUnavailable(false)
      const params = new URLSearchParams({ page: String(target), limit: String(PAGE_SIZE) })
      if (contact) params.set('contact', contact)
      if (reason) params.set('reason', reason)
      const res = await fetch(`/api/admin/clients/cancellations?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setRows([])
        if (data.code === 'not_available') setUnavailable(true)
        else setError(t('loadFailed'))
        return
      }
      setError(null)
      setRows(data.cancellations || [])
      setPagination(data.pagination)
      setPage(target)
    } catch {
      setError(t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const { busy, toggle } = useContactToggle(
    setRows,
    (failed) => setError(failed ? t('saveFailed') : null),
    () => void fetchPage(page, true)
  )

  useEffect(() => {
    if (!isAuthorized) return
    fetchPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, contact, reason])

  if (authChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
      </div>
    )
  }
  if (!isAuthorized) return null

  const clearFilters = () => router.push(pathname)

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <div className="mb-6">
          <Link href="/admin/clients" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft size={14} /> {t('backToClients')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks size={22} className="text-tuggi-orange" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500">{t('subtitle')}</p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
          <select
            aria-label={t('headers.contact')}
            value={contact}
            onChange={(e) => setFilter({ contact: e.target.value })}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
          >
            <option value="">{t('filters.contactAll')}</option>
            {CONTACT_STATES.map((c) => (
              <option key={c} value={c}>
                {t(`filters.${c}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('headers.reason')}
            value={reason}
            onChange={(e) => setFilter({ reason: e.target.value })}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
          >
            <option value="">{t('filters.reasonAll')}</option>
            {CANCEL_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reasons.${r}`)}
              </option>
            ))}
          </select>
          {filtered && (
            <button type="button" onClick={clearFilters} className="text-sm font-semibold text-tuggi-blue hover:underline">
              {t('clearFilters')}
            </button>
          )}
        </div>

        <CancellationsView
          rows={rows}
          loading={loading}
          error={error}
          unavailable={unavailable}
          filtered={filtered}
          busyId={busy}
          onToggle={toggle}
          onClearFilters={clearFilters}
        />

        {pagination.pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>{t('pagination', { current: pagination.page, total: pagination.pages, count: pagination.total })}</span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => fetchPage(page - 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40"
              >
                <ChevronLeft size={14} /> {t('prev')}
              </button>
              <button
                disabled={page >= pagination.pages || loading}
                onClick={() => fetchPage(page + 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40"
              >
                {t('next')} <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </Container>
    </div>
  )
}

export function AdminCancellationsPageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue mx-auto" />
        </div>
      }
    >
      <AdminCancellationsContent />
    </Suspense>
  )
}
