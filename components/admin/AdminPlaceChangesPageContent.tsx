'use client'

/**
 * Client-side content of /admin/clients/changes (#922, BR-B2B-061 item 2; contract
 * `docs/contracts/portal-fotos-e-texto.md` §5): the photo and text changes partners sent through
 * the portal, each with what is on the air and the proposal side by side, Approve, and Refuse with
 * a short reason the partner reads. Shell and states copy `AdminCancellationsPageContent`, its
 * sibling beside the client board.
 *
 * A decided card leaves the list only after the server answered; a failed approval keeps the card
 * and its button, because approving again is how every step of the approval is retried.
 */

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Images } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/Container'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { formatDate } from '@/lib/contract/snapshot'
import { PLACE_CHANGE_NOTE_MAX, type PlaceChange } from '@/lib/partnerships/place-changes'

type Decision = { decision: 'approved' } | { decision: 'rejected'; note: string }

/** What the card shows after the server answered: done (the card goes), or the error, kept. */
type CardState = { busy: boolean; error: string | null }

export interface PlaceChangesViewProps {
  rows: PlaceChange[]
  loading: boolean
  error: string | null
  unavailable: boolean
  notice: string | null
  cards: Record<string, CardState>
  onDecide: (row: PlaceChange, d: Decision) => void
}

/** The queue, without fetching or routing. */
export function PlaceChangesView({ rows, loading, error, unavailable, notice, cards, onDecide }: PlaceChangesViewProps) {
  const t = useTranslations('Clients.placeChanges')
  return (
    <>
      {error && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}
      {loading ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">{unavailable ? t('unavailable') : t('empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {rows.map((r) => (
            <ChangeCard key={r.requestId} row={r} state={cards[r.requestId] ?? { busy: false, error: null }} onDecide={onDecide} />
          ))}
        </ul>
      )}
    </>
  )
}

function ChangeCard({ row, state, onDecide }: { row: PlaceChange; state: CardState; onDecide: (row: PlaceChange, d: Decision) => void }) {
  const t = useTranslations('Clients.placeChanges')
  const [refusing, setRefusing] = useState(false)
  const [note, setNote] = useState('')
  const [noteMissing, setNoteMissing] = useState(false)
  const label = row.kind === 'text' ? t('text') : row.slot === 0 ? t('facade') : t('photo', { n: (row.slot ?? 0) + 1 })
  const noteId = `note-${row.requestId}`

  const refuse = () => {
    if (!note.trim()) return setNoteMissing(true)
    onDecide(row, { decision: 'rejected', note: note.trim() })
  }

  return (
    <li data-change={row.requestId} className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-base font-semibold text-gray-900">{row.placeName ?? '—'}</h2>
          {row.city && <span className="text-sm text-gray-500">{row.city}</span>}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">{label}</span>
        </div>
        {row.requestedAt && <span className="text-xs text-gray-500">{t('requestedAt', { date: formatDate(row.requestedAt) })}</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Side title={t('live')}>
          {row.kind === 'photo' ? <Photo src={row.currentValue} alt={`${label}, ${t('live')}`} empty={t('nothingLive')} /> : <Text value={row.currentValue} empty={t('nothingLive')} />}
        </Side>
        <Side title={t('proposed')} accent>
          {row.kind === 'photo' ? <Photo src={row.photoUrl} alt={`${label}, ${t('proposed')}`} empty="—" /> : <Text value={row.proposedText} empty="—" />}
        </Side>
      </div>
      {row.kind === 'text' && <p className="mt-3 text-xs text-gray-500">{t('textNote')}</p>}

      {refusing && (
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-sm font-semibold text-gray-800">
            {t('noteLabel')}
          </label>
          <textarea
            id={noteId}
            autoFocus
            rows={2}
            maxLength={PLACE_CHANGE_NOTE_MAX}
            value={note}
            placeholder={t('notePlaceholder')}
            aria-invalid={noteMissing || undefined}
            aria-describedby={noteMissing ? `${noteId}-error` : undefined}
            onChange={(e) => {
              setNote(e.target.value)
              setNoteMissing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setRefusing(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) refuse()
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40 aria-[invalid=true]:border-red-500"
          />
          {noteMissing && (
            <span id={`${noteId}-error`} className="text-xs text-red-700">
              {t('errors.note_required')}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {refusing ? (
          <>
            <button
              type="button"
              disabled={state.busy}
              onClick={refuse}
              className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {t('refuseConfirm')}
            </button>
            <button type="button" disabled={state.busy} onClick={() => setRefusing(false)} className="rounded-md px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100">
              {t('cancel')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={state.busy}
              aria-busy={state.busy || undefined}
              onClick={() => onDecide(row, { decision: 'approved' })}
              className="rounded-md bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
            >
              {state.busy ? t('approving') : t('approve')}
            </button>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => setRefusing(true)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('refuse')}
            </button>
          </>
        )}
        {state.error && (
          <span role="alert" className="text-sm text-red-700">
            {state.error}
          </span>
        )}
      </div>
    </li>
  )
}

function Side({ title, accent, children }: { title: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <section className={`flex flex-col gap-2 rounded-md p-3 ${accent ? 'bg-blue-50/60 ring-1 ring-blue-100' : 'bg-gray-50'}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">{title}</h3>
      {children}
    </section>
  )
}

function Photo({ src, alt, empty }: { src: string | null; alt: string; empty: string }) {
  if (!src) return <span className="flex aspect-[4/3] w-full max-w-[320px] items-center justify-center rounded bg-gray-100 text-sm text-gray-500">{empty}</span>
  // URL pública do app (ou hotlink antigo) e URL assinada do bucket privado: o otimizador não serve nenhuma.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="aspect-[4/3] w-full max-w-[320px] rounded object-cover" />
}

function Text({ value, empty }: { value: string | null; empty: string }) {
  return value ? <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">{value}</p> : <p className="text-sm text-gray-500">{empty}</p>
}

async function fetchQueue(): Promise<{ kind: 'ok'; rows: PlaceChange[] } | { kind: 'unavailable' } | { kind: 'failed' }> {
  try {
    const res = await fetch('/api/admin/clients/changes')
    const data = await res.json()
    if (res.ok) return { kind: 'ok', rows: data.changes || [] }
    return data.code === 'not_available' ? { kind: 'unavailable' } : { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}

function AdminPlaceChangesContent() {
  const t = useTranslations('Clients.placeChanges')
  const router = useRouter()
  // The page is the admin area (`resolveAccess`); the routes accept admin and editor.
  const { isAdmin, isLoading: authChecking } = useCmsUser()
  const isAuthorized = !authChecking && isAdmin

  const [rows, setRows] = useState<PlaceChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({})

  useEffect(() => {
    if (!authChecking && !isAdmin) router.push('/unauthorized')
  }, [authChecking, isAdmin, router])

  useEffect(() => {
    if (!isAuthorized) return
    let gone = false
    void fetchQueue().then((r) => {
      if (gone) return
      setLoading(false)
      setRows(r.kind === 'ok' ? r.rows : [])
      setUnavailable(r.kind === 'unavailable')
      setError(r.kind === 'failed' ? t('loadFailed') : null)
    })
    return () => {
      gone = true
    }
  }, [isAuthorized, t])

  const decide = async (row: PlaceChange, d: Decision) => {
    const id = row.requestId
    setNotice(null)
    setCards((c) => ({ ...c, [id]: { busy: true, error: null } }))
    let msg: string | null = null
    try {
      const res = await fetch(`/api/admin/clients/changes/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setRows((rs) => rs.filter((r) => r.requestId !== id))
        setNotice(d.decision === 'approved' ? t('approved') : t('refused'))
        return
      }
      const known = ['not_found', 'not_pending', 'not_live', 'note_required', 'publish_failed', 'audio_cleanup_failed']
      msg = t(`errors.${known.indexOf(data.error) >= 0 ? data.error : 'failed'}`)
    } catch {
      msg = t('errors.failed')
    } finally {
      setCards((c) => ({ ...c, [id]: { busy: false, error: msg } }))
    }
  }

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-tuggi-blue" />
      </div>
    )
  }
  if (!isAuthorized) return null

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <div className="mb-6">
          <Link href="/admin/clients" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft size={14} /> {t('backToClients')}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Images size={22} className="text-tuggi-orange" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500">{t('subtitle')}</p>
        </div>
        <PlaceChangesView rows={rows} loading={loading} error={error} unavailable={unavailable} notice={notice} cards={cards} onDecide={(r, d) => void decide(r, d)} />
      </Container>
    </div>
  )
}

export function AdminPlaceChangesPageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-tuggi-blue" />
        </div>
      }
    >
      <AdminPlaceChangesContent />
    </Suspense>
  )
}
