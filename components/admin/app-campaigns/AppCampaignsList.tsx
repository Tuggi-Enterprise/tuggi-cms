'use client'

/**
 * The table of /admin/app-campaigns (#1192), in the order the app shows them (priority, then the
 * newest). The status column is `campaignStatus`, the CMS reading of
 * `drive.in_app_campaign_is_running`; the switch of each row is a PATCH with `is_active` only.
 */

import { AlertCircle, Megaphone, Plus, Power, PowerOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  campaignStatus,
  destinationKey,
  parseActionPath,
  type AppCampaign,
  type CampaignStatus,
} from '@/lib/campaigns/app-campaigns'
import { formatCouponGrant } from '@/lib/coupons/grant'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'

interface AppCampaignsListProps {
  campaigns: AppCampaign[]
  loading: boolean
  error: string | null
  togglingId: string | null
  onCreate: () => void
  onEdit: (campaign: AppCampaign) => void
  onToggle: (campaign: AppCampaign) => void
}

const STATUS_STYLE: Record<CampaignStatus, string> = {
  running: 'bg-green-100 text-green-700',
  scheduled: 'bg-tuggi-blue/10 text-tuggi-blue',
  ended: 'bg-amber-100 text-amber-800',
  off: 'bg-gray-100 text-gray-500',
}

const COLUMNS = 8

function formatDateTime(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : null
}

export function AppCampaignsList({
  campaigns,
  loading,
  error,
  togglingId,
  onCreate,
  onEdit,
  onToggle,
}: AppCampaignsListProps) {
  const t = useTranslations('AppCampaigns')

  const actionText = (c: AppCampaign): string => {
    if (c.action_type === 'redeem_coupon') {
      const coupon = c.coupon
      const label = coupon ? `${coupon.code} · ${formatCouponGrant(coupon, t('form.days'))}` : UNKNOWN_VALUE
      return t('actionGift', { coupon: label })
    }
    const parsed = parseActionPath(c.action_path)
    if (!parsed) return t('destinations.other', { path: c.action_path ?? UNKNOWN_VALUE })
    return t(`destinations.${destinationKey(parsed.destination)}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone size={22} className="text-tuggi-orange" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500">{t('subtitle')}</p>
        </div>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-tuggi-blue px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-tuggi-blue/90">
          <Plus size={16} />
          {t('newCampaign')}
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">{t('headers.name')}</th>
              <th className="px-4 py-3 text-left">{t('headers.format')}</th>
              <th className="px-4 py-3 text-left">{t('headers.status')}</th>
              <th className="px-4 py-3 text-left">{t('headers.window')}</th>
              <th className="px-4 py-3 text-left">{t('headers.countries')}</th>
              <th className="px-4 py-3 text-left">{t('headers.action')}</th>
              <th className="px-4 py-3 text-right">{t('headers.priority')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && campaigns.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS} className="px-4 py-10 text-center text-gray-400">
                  {t('loading')}
                </td>
              </tr>
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS} className="px-4 py-10 text-center text-gray-400">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              campaigns.map((c) => {
                const status = campaignStatus(c)
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer hover:bg-gray-50/50"
                    onClick={() => onEdit(c)}
                    title={t('clickToEdit')}>
                    <td className="px-4 py-3 font-semibold text-gray-900">{c.internal_name}</td>
                    <td className="px-4 py-3 text-gray-700">{t(`formats.${c.format}`)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
                        {t(`status.${status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {formatDateTime(c.starts_at) ?? t('noDate')} → {formatDateTime(c.ends_at) ?? t('noDate')}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      {c.countries.length === 0 ? t('allCountries') : c.countries.join(', ')}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{actionText(c)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{c.priority}</td>
                    <td className="px-4 py-3 text-right">
                      {/* stopPropagation: the switch must not open the drawer of the row. */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggle(c)
                        }}
                        disabled={togglingId === c.id}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40">
                        {c.is_active ? (
                          <>
                            <PowerOff size={14} /> {t('deactivate')}
                          </>
                        ) : (
                          <>
                            <Power size={14} /> {t('activate')}
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
