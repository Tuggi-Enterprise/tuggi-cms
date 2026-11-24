'use client'

/**
 * The lists the public name filter reads (#1144): the reserved names (BR-USUARIO-050 item 7), the
 * own blocked and allowed terms (BR-USUARIO-051 items 2 and 2.d), and the LDNOOBW, read only
 * (item 2: written only by migrations, with the source commit on every row).
 *
 * The database owns the normalization and the match: the CMS sends the term as the curator typed
 * it and shows back how the filter reads it (`normalized`). A term that normalizes to one already
 * in the list answers 409 and the screen says it is already there.
 *
 * Two components, one module: `FilterListsView` only draws, `FilterListsPanel` reads and writes.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  OWN_TERM_KINDS,
  OWN_TERM_MAX,
  RESERVED_MATCHES,
  ownTermInputOf,
  reservedNameInputOf,
  type FilterLists,
  type OwnTerm,
  type OwnTermInput,
  type OwnTermKind,
  type ReservedMatch,
  type ReservedName,
  type ReservedNameInput,
} from '@/lib/public-identity/moderation'
import type { QueueNotice } from './ReportsQueue'

export interface FilterListsViewProps {
  lists: FilterLists | null
  status: 'loading' | 'failed' | 'ready'
  busy: boolean
  notice: QueueNotice | null
  onAddReserved: (input: ReservedNameInput) => void
  onRemoveReserved: (nameKey: string) => void
  onAddTerm: (input: OwnTermInput) => void
  onRemoveTerm: (id: number) => void
  onRetry: () => void
}

const BOX = 'rounded-2xl border border-gray-200 p-3 dark:border-gray-800'
const INPUT =
  'w-full rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-0.5 text-gray-600 hover:bg-red-50 hover:text-red-800 disabled:opacity-50 dark:text-gray-300"
    >
      <X size={14} aria-hidden="true" />
    </button>
  )
}

function ReservedBox({ rows, busy, onAdd, onRemove }: {
  rows: ReservedName[]
  busy: boolean
  onAdd: (input: ReservedNameInput) => void
  onRemove: (nameKey: string) => void
}) {
  const t = useTranslations('Pages.PublicNames.lists')
  const [name, setName] = useState('')
  const [match, setMatch] = useState<ReservedMatch>('exact')
  const [displayName, setDisplayName] = useState(false)
  const input = reservedNameInputOf({ name, match, appliesToDisplayName: displayName })

  return (
    <div className={BOX}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('reserved.title', { count: rows.length })}</h3>
      <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{t('reserved.body')}</p>
      <form
        className="mt-2 space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!input) return
          onAdd(input)
          setName('')
        }}
      >
        <label className="block text-xs font-semibold text-gray-800 dark:text-gray-200" htmlFor="reserved-name">
          {t('reserved.nameLabel')}
        </label>
        <input id="reserved-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} className={INPUT} />
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-800 dark:text-gray-200">
          <label className="flex items-center gap-1">
            <span>{t('reserved.matchLabel')}</span>
            <select
              value={match}
              onChange={(e) => setMatch(e.target.value as ReservedMatch)}
              className="rounded border border-gray-300 bg-white px-1 py-0.5 dark:border-gray-700 dark:bg-gray-800"
            >
              {RESERVED_MATCHES.map((m) => (
                <option key={m} value={m}>{t(`reserved.match.${m}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={displayName} onChange={(e) => setDisplayName(e.target.checked)} />
            {t('reserved.displayName')}
          </label>
        </div>
        {name.trim() !== '' && !input && <p className="text-xs text-red-800 dark:text-red-300">{t('reserved.invalid')}</p>}
        <Button type="submit" variant="cta" size="sm" disabled={busy || !input}>{t('reserved.add')}</Button>
      </form>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {rows.map((row) => (
          <li
            key={row.nameKey}
            className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          >
            <span className="font-mono">{row.name}</span>
            {row.match === 'contains' && <span className="text-gray-700 dark:text-gray-300">{t('reserved.match.contains')}</span>}
            {row.appliesToDisplayName && <span className="text-gray-700 dark:text-gray-300">{t('reserved.displayNameShort')}</span>}
            <RemoveButton label={t('reserved.remove', { name: row.name })} disabled={busy} onClick={() => onRemove(row.nameKey)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function OwnTermsBox({ kind, rows, busy, onAdd, onRemove }: {
  kind: OwnTermKind
  rows: OwnTerm[]
  busy: boolean
  onAdd: (input: OwnTermInput) => void
  onRemove: (id: number) => void
}) {
  const t = useTranslations('Pages.PublicNames.lists')
  const [term, setTerm] = useState('')
  const input = ownTermInputOf({ kind, term })
  const inputId = `own-term-${kind}`

  return (
    <div className={BOX}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t(`${kind}.title`, { count: rows.length })}</h3>
      <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{t(`${kind}.body`)}</p>
      <form
        className="mt-2 space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!input) return
          onAdd(input)
          setTerm('')
        }}
      >
        <label className="block text-xs font-semibold text-gray-800 dark:text-gray-200" htmlFor={inputId}>
          {t('termLabel')}
        </label>
        <input id={inputId} value={term} maxLength={OWN_TERM_MAX} onChange={(e) => setTerm(e.target.value)} className={INPUT} />
        <Button type="submit" variant="cta" size="sm" disabled={busy || !input}>{t(`${kind}.add`)}</Button>
      </form>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-gray-700 dark:text-gray-300">{t('emptyList')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-1 text-sm">
              <span className="min-w-0">
                <span className="break-words text-gray-900 dark:text-gray-100">{row.term}</span>
                {row.normalized && row.normalized !== row.term && (
                  <span className="ml-2 font-mono text-xs text-gray-700 dark:text-gray-300">{t('normalized', { value: row.normalized })}</span>
                )}
              </span>
              <RemoveButton label={t('removeTerm', { term: row.term })} disabled={busy} onClick={() => onRemove(row.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LdnoobwBox({ ldnoobw }: { ldnoobw: FilterLists['ldnoobw'] }) {
  const t = useTranslations('Pages.PublicNames.lists.ldnoobw')
  const read = ldnoobw.languages.reduce((sum, l) => sum + l.terms.length, 0)
  return (
    <div className={BOX}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('title')}</h3>
      <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{t('body')}</p>
      <p className="mt-1 text-xs text-gray-800 dark:text-gray-200">
        {t('summary', { count: ldnoobw.total, commit: ldnoobw.commits.map((c) => c.slice(0, 7)).join(', ') || '—' })}
      </p>
      {ldnoobw.total > read && <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{t('truncated', { shown: read, total: ldnoobw.total })}</p>}
      <div className="mt-2 space-y-1">
        {ldnoobw.languages.map((l) => (
          <details key={l.language} className="text-sm">
            <summary className="cursor-pointer text-gray-900 dark:text-gray-100">
              {t('language', { language: l.language, count: l.terms.length })}
            </summary>
            <p className="mt-1 break-words font-mono text-xs leading-relaxed text-gray-800 dark:text-gray-200">{l.terms.join(' · ')}</p>
          </details>
        ))}
      </div>
    </div>
  )
}

export function FilterListsView({
  lists,
  status,
  busy,
  notice,
  onAddReserved,
  onRemoveReserved,
  onAddTerm,
  onRemoveTerm,
  onRetry,
}: FilterListsViewProps) {
  const t = useTranslations('Pages.PublicNames.lists')
  return (
    <section
      aria-labelledby="filter-lists-title"
      className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <h2 id="filter-lists-title" className="text-sm font-semibold text-gray-900 dark:text-white">{t('title')}</h2>
      <p className="mt-1 text-xs text-gray-800 dark:text-gray-300">{t('body')}</p>

      {notice && (
        <p
          role="status"
          className={`mt-3 rounded-xl px-3 py-2 text-sm ${
            notice.tone === 'ok'
              ? 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100'
              : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
          }`}
        >
          {notice.text}
        </p>
      )}

      {status === 'loading' && <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{t('loading')}</p>}
      {status === 'failed' && (
        <p role="alert" className="mt-3 text-sm text-red-800 dark:text-red-300">
          {t('failed')}{' '}
          <button type="button" onClick={onRetry} className="font-semibold text-primary-800 underline-offset-4 hover:underline">
            {t('retry')}
          </button>
        </p>
      )}

      {status === 'ready' && lists && (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ReservedBox rows={lists.reserved} busy={busy} onAdd={onAddReserved} onRemove={onRemoveReserved} />
          {OWN_TERM_KINDS.map((kind) => (
            <OwnTermsBox
              key={kind}
              kind={kind}
              rows={lists.own.filter((row) => row.kind === kind)}
              busy={busy}
              onAdd={onAddTerm}
              onRemove={onRemoveTerm}
            />
          ))}
          <div className="lg:col-span-3">
            <LdnoobwBox ldnoobw={lists.ldnoobw} />
          </div>
        </div>
      )}
    </section>
  )
}

type WriteError = 'invalid' | 'duplicate' | 'not_found' | 'failed'

function writeErrorOf(value: unknown): WriteError {
  return value === 'invalid' || value === 'duplicate' || value === 'not_found' ? value : 'failed'
}

export function FilterListsPanel() {
  const t = useTranslations('Pages.PublicNames.lists')
  const [lists, setLists] = useState<FilterLists | null>(null)
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<QueueNotice | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/public-identity/lists', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setLists((await res.json()) as FilterLists)
      setStatus('ready')
    } catch {
      setStatus('failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const write = useCallback(
    async (url: string, init: RequestInit, done: string) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch(url, init)
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          const error = writeErrorOf(body.error)
          setNotice({ tone: 'error', text: t(`errors.${error}`) })
          if (error === 'not_found') await load()
          return
        }
        setNotice({ tone: 'ok', text: done })
        await load()
      } catch {
        setNotice({ tone: 'error', text: t('errors.failed') })
      } finally {
        setBusy(false)
      }
    },
    [load, t]
  )

  const post = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  return (
    <FilterListsView
      lists={lists}
      status={status}
      busy={busy}
      notice={notice}
      onAddReserved={(input) => void write('/api/admin/public-identity/reserved-names', post(input), t('saved'))}
      onRemoveReserved={(key) =>
        void write(`/api/admin/public-identity/reserved-names?key=${encodeURIComponent(key)}`, { method: 'DELETE' }, t('removed'))
      }
      onAddTerm={(input) => void write('/api/admin/public-identity/own-terms', post(input), t('saved'))}
      onRemoveTerm={(id) => void write(`/api/admin/public-identity/own-terms?id=${id}`, { method: 'DELETE' }, t('removed'))}
      onRetry={() => void load()}
    />
  )
}
