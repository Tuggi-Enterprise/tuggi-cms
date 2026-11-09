'use client'

/**
 * The queue of requests of partners without a place from the app, above the partners board
 * (#1139, BR-B2B-066 items 2 and 5, BR-USUARIO-052 item 4.d).
 *
 * Only requests with the acceptance reach it (the database filters). The repeated document is
 * NOT refused (5.a): it arrives marked, and the curator sees the mark before deciding. Approving
 * and refusing are the RPCs of the contract, through the admin routes; the rate the approval
 * writes is read back from the database and never declared here (BR-MONETIZACAO-039 item 6.c).
 *
 * Two components, one module: `PartnerRequestsQueue` only draws (the bench mounts it with
 * fixtures), `PartnerRequestsBand` reads and decides.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/components/admin/partner-proposals/format'
import {
  REFUSAL_REASON_MAX,
  formatDocument,
  publishesHref,
  refusalReasonOf,
  whatsappHref,
  type ApprovalOutcome,
  type PartnerRequestRow,
  type RefusalOutcome,
} from '@/lib/partner-requests/queue'

export interface QueueNotice {
  tone: 'ok' | 'error'
  text: string
}

export interface PartnerRequestsQueueProps {
  requests: PartnerRequestRow[]
  status: 'loading' | 'failed' | 'ready'
  /** The request whose decision is in flight; its buttons wait. */
  busyId: number | null
  notice: QueueNotice | null
  onApprove: (requestId: number) => void
  onRefuse: (requestId: number, reason: string) => void
}

const CELL = 'px-3 py-2 align-top'

export function PartnerRequestsQueue({ requests, status, busyId, notice, onApprove, onRefuse }: PartnerRequestsQueueProps) {
  const t = useTranslations('Clients.board.requests')
  const [refusing, setRefusing] = useState<number | null>(null)
  const [reason, setReason] = useState('')

  const openRefusal = (requestId: number) => {
    setRefusing(requestId)
    setReason('')
  }

  return (
    <section
      aria-labelledby="partner-requests-title"
      className="mb-6 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="partner-requests-title" className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('title')}
        </h2>
        {status === 'ready' && (
          <span className="text-xs text-gray-700 dark:text-gray-300">{t('count', { count: requests.length })}</span>
        )}
      </div>
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
          {t('failed')}
        </p>
      )}
      {status === 'ready' && requests.length === 0 && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{t('empty')}</p>
      )}

      {status === 'ready' && requests.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm text-gray-900 dark:text-gray-100">
            <thead className="text-[11px] uppercase tracking-wide text-gray-600 dark:text-gray-400">
              <tr>
                <th scope="col" className={CELL}>{t('columns.type')}</th>
                <th scope="col" className={CELL}>{t('columns.person')}</th>
                <th scope="col" className={CELL}>{t('columns.document')}</th>
                <th scope="col" className={CELL}>{t('columns.contact')}</th>
                <th scope="col" className={CELL}>{t('columns.publishes')}</th>
                <th scope="col" className={CELL}>{t('columns.acceptance')}</th>
                <th scope="col" className={CELL}>{t('columns.decision')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const busy = busyId === request.requestId
                const wa = whatsappHref(request.whatsapp)
                const link = publishesHref(request.publishesAt)
                const cnpj = request.documentType === 'cnpj'
                return (
                  <RequestRows
                    key={request.requestId}
                    request={request}
                    busy={busy}
                    refusing={refusing === request.requestId}
                    reason={reason}
                    onReason={setReason}
                    onApprove={() => onApprove(request.requestId)}
                    onOpenRefusal={() => openRefusal(request.requestId)}
                    onCancelRefusal={() => setRefusing(null)}
                    onConfirmRefusal={() => {
                      const valid = refusalReasonOf(reason)
                      if (valid) onRefuse(request.requestId, valid)
                    }}
                    cells={
                      <>
                        <td className={CELL}>{t(`types.${request.partnerType}`)}</td>
                        <td className={CELL}>
                          <p className="font-semibold">{cnpj ? (request.legalName ?? request.fullName) : request.fullName}</p>
                          {cnpj && (
                            <p className="text-xs text-gray-700 dark:text-gray-300">
                              {t('representative', {
                                name: request.fullName,
                                cpf: request.representativeCpf ? formatDocument('cpf', request.representativeCpf) : '—',
                              })}
                            </p>
                          )}
                          {request.nickname && (
                            <p className="text-xs text-gray-700 dark:text-gray-300">{t('account', { nickname: request.nickname })}</p>
                          )}
                        </td>
                        <td className={CELL}>
                          <p className="whitespace-nowrap font-mono text-xs">
                            {t(`documentTypes.${request.documentType}`)} {formatDocument(request.documentType, request.document)}
                          </p>
                          {request.documentInUse && (
                            <p className="mt-1 inline-block rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                              {t('documentInUse')}
                            </p>
                          )}
                          {request.documentInUse && (
                            <p className="mt-1 max-w-[16rem] text-xs text-gray-700 dark:text-gray-300">{t('documentInUseHint')}</p>
                          )}
                          {request.existingClientId && (
                            <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">{t('completes')}</p>
                          )}
                        </td>
                        <td className={CELL}>
                          {wa ? (
                            <a href={wa} target="_blank" rel="noopener noreferrer" className="block text-primary-800 underline-offset-4 hover:underline dark:text-tuggi-blue">
                              {request.whatsapp}
                            </a>
                          ) : (
                            <p>{request.whatsapp || '—'}</p>
                          )}
                          <a href={`mailto:${request.contactEmail}`} className="block break-all text-xs text-primary-800 underline-offset-4 hover:underline dark:text-tuggi-blue">
                            {request.contactEmail}
                          </a>
                        </td>
                        <td className={CELL}>
                          {link ? (
                            <a href={link} target="_blank" rel="noopener noreferrer" className="block max-w-[14rem] truncate text-primary-800 underline-offset-4 hover:underline dark:text-tuggi-blue">
                              {request.publishesAt}
                            </a>
                          ) : (
                            <p>{request.publishesAt ?? '—'}</p>
                          )}
                          <p className="text-xs text-gray-700 dark:text-gray-300">{request.region}</p>
                        </td>
                        <td className={CELL}>
                          <p className="whitespace-nowrap">{formatDate(request.acceptedAt)}</p>
                          <p className="text-xs text-gray-700 dark:text-gray-300">{request.termsVersion ?? '—'}</p>
                        </td>
                      </>
                    }
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

interface RequestRowsProps {
  request: PartnerRequestRow
  cells: React.ReactNode
  busy: boolean
  refusing: boolean
  reason: string
  onReason: (value: string) => void
  onApprove: () => void
  onOpenRefusal: () => void
  onCancelRefusal: () => void
  onConfirmRefusal: () => void
}

function RequestRows({
  request,
  cells,
  busy,
  refusing,
  reason,
  onReason,
  onApprove,
  onOpenRefusal,
  onCancelRefusal,
  onConfirmRefusal,
}: RequestRowsProps) {
  const t = useTranslations('Clients.board.requests')
  const reasonId = `partner-request-reason-${request.requestId}`
  return (
    <>
      <tr className="border-t border-gray-200 dark:border-gray-800">
        {cells}
        <td className={CELL}>
          <div className="flex flex-nowrap gap-2">
            <Button type="button" variant="cta" size="sm" disabled={busy} onClick={onApprove}>
              {t('approve')}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} aria-expanded={refusing} aria-controls={reasonId} onClick={onOpenRefusal}>
              {t('refuse')}
            </Button>
          </div>
        </td>
      </tr>
      {refusing && (
        <tr>
          <td colSpan={7} className="px-3 pb-3">
            <label htmlFor={reasonId} className="block text-xs font-semibold text-gray-800 dark:text-gray-200">
              {t('reasonLabel')}
            </label>
            <textarea
              id={reasonId}
              value={reason}
              maxLength={REFUSAL_REASON_MAX}
              onChange={(event) => onReason(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 p-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" variant="destructive" size="sm" disabled={busy || refusalReasonOf(reason) === null} onClick={onConfirmRefusal}>
                {t('refuseConfirm')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelRefusal}>
                {t('cancel')}
              </Button>
              <span className="text-xs text-gray-700 dark:text-gray-300">
                {t('reasonCount', { count: reason.trim().length, max: REFUSAL_REASON_MAX })}
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/** The rate the database wrote, as the curator reads it: a percentage with at most one decimal. */
function percentOf(rate: number): string {
  return `${(rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

/**
 * The band: reads the queue, decides, and tells the board to read again after an approval (the
 * new partner record lands in `Publicado`).
 */
export function PartnerRequestsBand({ onDecided }: { onDecided?: () => void }) {
  const t = useTranslations('Clients.board.requests')
  const [requests, setRequests] = useState<PartnerRequestRow[]>([])
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [notice, setNotice] = useState<QueueNotice | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/partner-requests', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { requests?: PartnerRequestRow[] }
      setRequests(body.requests ?? [])
      setStatus('ready')
    } catch {
      setStatus('failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    async (requestId: number, path: 'approve' | 'refuse', reason?: string) => {
      setBusyId(requestId)
      setNotice(null)
      try {
        const res = await fetch(`/api/admin/partner-requests/${requestId}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(path === 'refuse' ? { reason } : {}),
        })
        const body = (await res.json().catch(() => ({}))) as {
          outcome?: ApprovalOutcome | RefusalOutcome
          error?: string
        }
        if (!res.ok || !body.outcome) {
          const key = body.error === 'not_found' || body.error === 'invalid_reason' ? body.error : 'failed'
          setNotice({ tone: 'error', text: t(`outcomes.${key}`) })
          if (key === 'not_found') await load()
          return
        }
        const outcome = body.outcome
        if (outcome.kind === 'approved') {
          setNotice({
            tone: 'ok',
            text:
              outcome.commissionRate === null
                ? t('outcomes.approvedNoRate', { code: outcome.partnerCode ?? '—' })
                : t('outcomes.approved', { code: outcome.partnerCode ?? '—', rate: percentOf(outcome.commissionRate) }),
          })
          onDecided?.()
        } else if (outcome.kind === 'refused') {
          setNotice({ tone: 'ok', text: t('outcomes.refused') })
        } else {
          setNotice({ tone: 'error', text: t(`outcomes.${outcome.kind}`) })
        }
        // `document_in_use` keeps the request in the queue; everything else left it.
        if (outcome.kind !== 'document_in_use') await load()
      } catch {
        setNotice({ tone: 'error', text: t('outcomes.failed') })
      } finally {
        setBusyId(null)
      }
    },
    [load, onDecided, t]
  )

  return (
    <PartnerRequestsQueue
      requests={requests}
      status={status}
      busyId={busyId}
      notice={notice}
      onApprove={(id) => void decide(id, 'approve')}
      onRefuse={(id, reason) => void decide(id, 'refuse', reason)}
    />
  )
}
