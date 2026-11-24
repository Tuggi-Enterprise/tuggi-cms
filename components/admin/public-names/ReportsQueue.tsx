'use client'

/**
 * The queue of reports of display name, @ and bio (#1144, BR-USUARIO-051 item 5). Same shape as
 * the queue of app partner requests (#1139, `PartnerRequests.tsx`): a band with title, count,
 * notice and a dense table, one decision per row, an inline confirmation for the irreversible one.
 *
 * A report changes nothing by itself. The curator decides field by field: remove sends the field
 * back to a generated name (an empty bio) through `drive.decide_public_identity_report_as`, and a
 * removed @ is blocked forever, which is why remove asks twice; keep closes the report.
 *
 * Two components, one module: `IdentityReportsQueue` only draws (the bench mounts it with
 * fixtures), `IdentityReportsBand` reads and decides.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import { formatDate } from '@/components/admin/partner-proposals/format'
import type { IdentityReportRow, ReportDecision, ReportOutcome } from '@/lib/public-identity/moderation'

export interface QueueNotice {
  tone: 'ok' | 'error'
  text: string
}

export interface IdentityReportsQueueProps {
  reports: IdentityReportRow[]
  /** Open reports in the table, which may be more than the rows read. */
  total: number
  status: 'loading' | 'failed' | 'ready'
  /** The report whose decision is in flight; its buttons wait. */
  busyId: number | null
  notice: QueueNotice | null
  onDecide: (reportId: number, decision: ReportDecision) => void
  onRetry: () => void
}

const CELL = 'px-3 py-2 align-top'

export function IdentityReportsQueue({ reports, total, status, busyId, notice, onDecide, onRetry }: IdentityReportsQueueProps) {
  const t = useTranslations('Pages.PublicNames.reports')
  const [confirming, setConfirming] = useState<number | null>(null)

  return (
    <section
      aria-labelledby="identity-reports-title"
      className="mb-6 rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="identity-reports-title" className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('title')}
        </h2>
        {status === 'ready' && (
          <span className="text-xs text-gray-700 dark:text-gray-300">{t('count', { count: total })}</span>
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
          {t('failed')}{' '}
          <button type="button" onClick={onRetry} className="font-semibold text-primary-800 underline-offset-4 hover:underline">
            {t('retry')}
          </button>
        </p>
      )}
      {status === 'ready' && reports.length === 0 && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{t('empty')}</p>
      )}
      {status === 'ready' && reports.length > 0 && total > reports.length && (
        <p className="mt-3 text-xs text-gray-700 dark:text-gray-300">{t('more', { shown: reports.length, total })}</p>
      )}

      {status === 'ready' && reports.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm text-gray-900 dark:text-gray-100">
            <thead className="text-[11px] uppercase tracking-wide text-gray-600 dark:text-gray-400">
              <tr>
                <th scope="col" className={CELL}>{t('columns.value')}</th>
                <th scope="col" className={CELL}>{t('columns.field')}</th>
                <th scope="col" className={CELL}>{t('columns.account')}</th>
                <th scope="col" className={CELL}>{t('columns.surface')}</th>
                <th scope="col" className={CELL}>{t('columns.reports')}</th>
                <th scope="col" className={CELL}>{t('columns.decision')}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const busy = busyId === report.reportId
                const open = confirming === report.reportId
                const hintId = `identity-report-hint-${report.reportId}`
                return (
                  <tr key={report.reportId} className="border-t border-gray-200 dark:border-gray-800">
                    <td className={CELL}>
                      <p className="max-w-[22rem] whitespace-pre-line break-words font-semibold">{report.reportedValue}</p>
                    </td>
                    <td className={CELL}>{t(`fields.${report.field}`)}</td>
                    <td className={CELL}>
                      <AppUserLink
                        user={{ user_id: report.userId, nickname: report.nickname }}
                        className="text-sm"
                        onUpdate={onRetry}
                      />
                    </td>
                    <td className={CELL}>{t(`surfaces.${report.surface}`)}</td>
                    <td className={CELL}>
                      <p className="whitespace-nowrap">{t('times', { count: report.reportsCount })}</p>
                      <p className="whitespace-nowrap text-xs text-gray-700 dark:text-gray-300">
                        {t('last', { date: formatDate(report.lastReportedAt) })}
                      </p>
                    </td>
                    <td className={CELL}>
                      {open ? (
                        <div className="max-w-[18rem]">
                          <p id={hintId} className="text-xs text-gray-800 dark:text-gray-200">
                            {t(`removeHint.${report.field}`)}
                          </p>
                          <div className="mt-2 flex flex-nowrap gap-2">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={busy}
                              aria-describedby={hintId}
                              onClick={() => {
                                setConfirming(null)
                                onDecide(report.reportId, 'remove')
                              }}
                            >
                              {t('confirmRemove')}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                              {t('cancel')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-nowrap gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(report.reportId)}>
                            {t('remove')}
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onDecide(report.reportId, 'dismiss')}>
                            {t('keep')}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** The band: reads the queue, decides, and reads again (a removal closes every report of the field). */
export function IdentityReportsBand() {
  const t = useTranslations('Pages.PublicNames.reports')
  const [reports, setReports] = useState<IdentityReportRow[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [notice, setNotice] = useState<QueueNotice | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/public-identity/reports', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { reports?: IdentityReportRow[]; total?: number }
      setReports(body.reports ?? [])
      setTotal(body.total ?? body.reports?.length ?? 0)
      setStatus('ready')
    } catch {
      setStatus('failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    async (reportId: number, decision: ReportDecision) => {
      setBusyId(reportId)
      setNotice(null)
      try {
        const res = await fetch(`/api/admin/public-identity/reports/${reportId}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        })
        const body = (await res.json().catch(() => ({}))) as { outcome?: ReportOutcome; error?: string }
        if (!res.ok || !body.outcome) {
          setNotice({ tone: 'error', text: t(body.error === 'not_found' ? 'outcomes.not_found' : 'outcomes.failed') })
          if (body.error === 'not_found') await load()
          return
        }
        const outcome = body.outcome
        if (outcome.kind === 'removed') {
          setNotice({
            tone: 'ok',
            text: outcome.value ? t('outcomes.removed', { value: outcome.value }) : t('outcomes.removedEmpty'),
          })
        } else if (outcome.kind === 'dismissed') {
          setNotice({ tone: 'ok', text: t('outcomes.dismissed') })
        } else {
          setNotice({ tone: 'error', text: t('outcomes.already_decided') })
        }
        await load()
      } catch {
        setNotice({ tone: 'error', text: t('outcomes.failed') })
      } finally {
        setBusyId(null)
      }
    },
    [load, t]
  )

  return (
    <IdentityReportsQueue
      reports={reports}
      total={total}
      status={status}
      busyId={busyId}
      notice={notice}
      onDecide={(id, decision) => void decide(id, decision)}
      onRetry={() => void load()}
    />
  )
}
