'use client'

/**
 * The tourist's file — **one** modal, opened from every surface that prints a nickname.
 *
 * Until #659 there were two components with this name and overlapping purpose: this one, fed
 * by `dashboardService.getUserDetail`, and a fuller copy declared inline inside
 * `app/[locale]/users/app/page.tsx` (admin state, `onUpdate`, its own Supabase client, the
 * credit panel, the linked client). Second implementation of the same decision is a defect,
 * not a variant (CLAUDE.md §6) — the inline one is gone and what it had that this one did not
 * is here.
 *
 * Nothing was lost in the move. The page-bound copy needed the page for exactly two things,
 * and neither is a page: the Supabase client came from `useSupabaseClient()` and is the same
 * cookie-bound browser client `getSupabaseClient()` hands `dashboardService`, and `isAdmin`
 * came from `useCmsUser()`, which is a hook and works wherever it is mounted.
 *
 * **Who the person is: `nickname`, falling back to the first 8 characters of the `user_id`**
 * — **BR-USUARIO-042**, and the chain lives in `lib/format/user-identity.ts`. Neither the
 * full name nor the e-mail is in `UserDetail` any more; the migration of #659 drops both
 * columns from `core.dashboard_user_detail`. The founder's nominal exception (the manual
 * grant confirmation) is fed by `core.dashboard_app_users_detailed` on the app users screen
 * and does not reach this RPC — so `CreditPanel` gets `email={null}` here, on purpose.
 *
 * **The hours block reads the RPC and computes nothing** — **BR-MONETIZACAO-046**. State,
 * balance and the two totals arrive resolved by `drive.get_entitlement`; this file neither
 * re-implements the `unlimited` → `metered` → `free` order nor re-adds the ledger. While the
 * migration is unapplied the nine columns are absent, and absent prints as an em dash: `0`
 * would be an assertion ("consumed nothing", "never bought") that nobody made.
 *
 * The overlap is real and named rather than hidden: for a platform admin, `CreditPanel` shows
 * state and balance again, from its own door (`/api/admin/users/:id/credit`). Removing that
 * header is a change to `DS-COMPONENTE-015`, which belongs to `design` — so both stay, both
 * read the database, and `onChanged` re-runs this read so the two cannot drift apart on
 * screen. For everyone who is not an admin, `CreditPanel` answers 403 and this block is the
 * only place the hours exist.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Activity, CreditCard, Gift, Hourglass, Infinity as InfinityIcon,
  RefreshCw, Smartphone, Timer, User, Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SubscriptionBadge } from '@/components/ui/SubscriptionBadge'
import { CreditPanel } from '@/components/admin/credit/CreditPanel'
import { LinkedClientSection } from '@/components/dashboard/LinkedClientSection'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { dashboardService, type UserDetail } from '@/lib/services/dashboard-service'
import { GRANT_SOURCES, grantOrigin } from '@/lib/credit/entitlement'
import { formatDurationOrDash } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { appUserInitial, appUserLabel } from '@/lib/format/user-identity'

const DIALOG_TITLE_ID = 'user-detail-modal-title'

/**
 * Hours, as the RPC answered them — spec of #659, and the six facts the founder asked for.
 *
 * With no `state` the migration has not landed and none of the nine columns exist: the block
 * renders the same empty state `PaidAccessCard` does for a missing aggregate, because a grid
 * of six em dashes reads like six measurements of nothing.
 */
function UserHours({ detail }: { detail: UserDetail }) {
  const t = useTranslations('Pages.AppUsers')
  const tLabels = useTranslations('Pages.Dashboard.labels')
  const tCommon = useTranslations('Common.labels')
  const locale = useLocale()

  if (!detail.state) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-6 flex flex-col items-center justify-center text-center opacity-40">
        <Wallet className="h-8 w-8 mb-2" />
        <p className="text-[10px] font-black uppercase tracking-widest">
          {tLabels('no_paid_access_data')}
        </p>
      </div>
    )
  }

  const source = detail.last_grant_source
  const sourceLabel = source
    ? (GRANT_SOURCES as readonly string[]).includes(source)
      ? t(`credit.grants.source_${source}`)
      : source
    : UNKNOWN_VALUE

  const cells: Array<{ key: string; label: string; value: string; icon: typeof Wallet }> = [
    {
      key: 'state',
      label: t('credit.panel.state'),
      value: t(`credit.panel.state_${detail.state}`),
      icon: detail.state === 'unlimited' ? InfinityIcon : Hourglass,
    },
    {
      key: 'balance',
      label: t('credit.panel.balance'),
      value: formatDurationOrDash(detail.balance_minutes),
      icon: Timer,
    },
    {
      key: 'granted',
      label: tLabels('granted_total'),
      value: formatDurationOrDash(detail.minutes_granted_total),
      icon: Gift,
    },
    {
      key: 'consumed',
      label: tLabels('consumed_total'),
      value: formatDurationOrDash(detail.minutes_consumed_total),
      icon: Wallet,
    },
    {
      key: 'source',
      label: t('credit.grants.col_source'),
      value: detail.last_grant_at
        ? `${sourceLabel} · ${new Date(detail.last_grant_at).toLocaleDateString(locale)}`
        : sourceLabel,
      icon: grantOrigin(source) === 'purchase' ? CreditCard : Gift,
    },
    {
      key: 'purchase',
      label: t('modal.has_purchase'),
      // `null` is "the column did not come back"; `false` is "this person never bought".
      value:
        detail.has_purchase == null
          ? UNKNOWN_VALUE
          : detail.has_purchase
            ? tCommon('yes')
            : tCommon('no'),
      icon: CreditCard,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cells.map((cell) => (
        <div key={cell.key} className="bg-gray-50 dark:bg-gray-800/40 rounded-xl p-3 flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
            <cell.icon className="h-3.5 w-3.5" />
            {cell.label}
          </span>
          <span className="text-sm font-black text-gray-900 dark:text-white leading-tight break-words">
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function UserDetailModal({
  userId,
  onClose,
  onUpdate,
}: {
  userId: string
  onClose: () => void
  onUpdate?: () => void
}) {
  const t = useTranslations('Pages.AppUsers.modal')
  const locale = useLocale()
  const { isAdmin } = useCmsUser()
  const [user, setUser] = useState<UserDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const dialogRef = useRef<HTMLDivElement>(null)

  const fetchDetail = useCallback(async () => {
    setIsLoading(true)
    const res = await dashboardService.getUserDetail(userId)
    setUser(res.success && res.data ? res.data : null)
    setIsLoading(false)
  }, [userId])

  useEffect(() => { void fetchDetail() }, [fetchDetail])

  // Esc closes, and the dialog takes focus when it opens: a modal that leaves the keyboard
  // behind on the row it came from is a modal only a mouse can use.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={DIALOG_TITLE_ID}
          tabIndex={-1}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl relative animate-in zoom-in-95 duration-300 outline-none"
          onClick={(event) => event.stopPropagation()}
        >
          {isLoading ? (
            <div className="p-12 flex items-center justify-center">
              <RefreshCw className="h-8 w-8 animate-spin text-tuggi-blue" />
              <span id={DIALOG_TITLE_ID} className="sr-only">{t('profile')}</span>
            </div>
          ) : !user ? (
            <div className="p-12 text-center text-gray-500" id={DIALOG_TITLE_ID}>
              {t('not_found')}
            </div>
          ) : (
            <>
              {/* Header — the identity, and only the identity */}
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center">
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-tuggi-blue to-purple-500 flex items-center justify-center text-white text-2xl font-bold mr-4 shrink-0">
                    {appUserInitial(user)}
                  </div>
                  <div className="min-w-0">
                    <h2
                      id={DIALOG_TITLE_ID}
                      className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2 flex-wrap"
                    >
                      {appUserLabel(user)}
                      <SubscriptionBadge isPremium={user.is_premium} tierName={user.subscription_tier_display_name} />
                    </h2>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Quick stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-tuggi-blue/10 rounded-xl">
                    <p className="text-2xl font-bold text-tuggi-blue">{user.trip_count || 0}</p>
                    <p className="text-xs text-gray-500">{t('trips')}</p>
                  </div>
                  <div className="text-center p-4 bg-green-500/10 rounded-xl">
                    <p className="text-2xl font-bold text-green-600">{user.poi_visits_count || 0}</p>
                    <p className="text-xs text-gray-500">{t('poi_visits')}</p>
                  </div>
                  <div className="text-center p-4 bg-purple-500/10 rounded-xl">
                    <p className="text-2xl font-bold text-purple-600">{Math.round(user.total_km || 0)}</p>
                    <p className="text-xs text-gray-500">{t('km')}</p>
                  </div>
                  <div className="text-center p-4 bg-orange-500/10 rounded-xl">
                    <p className="text-2xl font-bold text-orange-600">{user.unique_cities_visited || 0}</p>
                    <p className="text-xs text-gray-500">{t('cities')}</p>
                  </div>
                </div>

                {/* Hours — #659 */}
                <div>
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                    <Hourglass className="h-4 w-4 mr-2" />
                    {t('hours')}
                  </h3>
                  <UserHours detail={user} />
                </div>

                {/* Profile / device */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
                      <User className="h-4 w-4 mr-2" />
                      {t('profile')}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('country')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">{user.country || UNKNOWN_VALUE}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('language')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">{user.language || UNKNOWN_VALUE}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('driver_type')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">{user.driver_type || UNKNOWN_VALUE}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
                      <Smartphone className="h-4 w-4 mr-2" />
                      {t('device')}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('platform')}</span>
                        <span className={cn(
                          'px-2 py-0.5 rounded text-xs font-bold',
                          user.last_platform === 'ios' ? 'bg-blue-100 text-blue-700' :
                          user.last_platform === 'android' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                        )}>
                          {user.last_platform || UNKNOWN_VALUE}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('model')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">{user.last_device_model || UNKNOWN_VALUE}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('app_version')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">{user.last_app_version || UNKNOWN_VALUE}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('logins')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">{user.login_count || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Access and balance — card #310. It replaced the Subscription block, which
                    edited tier + date and wrote drive.profiles through a service-role route: a
                    second writer of both the balance and subscription_end_date, where
                    BR-MONETIZACAO-047 allows one door.

                    `email={null}`: the RPC behind this modal does not return one, and the
                    founder's exception (BR-USUARIO-042, 4th edge case) is the app users list,
                    not this file. */}
                <CreditPanel
                  userId={user.user_id}
                  nickname={user.nickname}
                  email={null}
                  isAdmin={isAdmin}
                  licenseLabel={user.subscription_tier_display_name}
                  providerLabel={user.subscription_provider}
                  onChanged={() => { void fetchDetail(); onUpdate?.() }}
                />

                {/* Linked Client (partner QR) */}
                <LinkedClientSection
                  userId={user.user_id}
                  linked={user.linked_client}
                  onChanged={() => { void fetchDetail(); onUpdate?.() }}
                />

                {/* Subscription history */}
                {user.subscription_history && user.subscription_history.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
                      <Activity className="h-4 w-4 mr-2" />
                      {t('history')}
                    </h3>
                    <div className="space-y-2">
                      {user.subscription_history.map((h, i) => (
                        <div key={h.id || i} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'px-2 py-0.5 rounded text-xs font-bold uppercase',
                              h.action === 'subscribe' ? 'bg-green-100 text-green-700' :
                              h.action === 'renew' ? 'bg-blue-100 text-blue-700' :
                              h.action === 'upgrade' ? 'bg-purple-100 text-purple-700' :
                              h.action === 'downgrade' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            )}>
                              {h.action}
                            </span>
                            <span className="text-gray-600 dark:text-gray-400">{h.tier_name}</span>
                            {h.previous_tier_name && (
                              <span className="text-gray-400">← {h.previous_tier_name}</span>
                            )}
                          </div>
                          <span className="text-gray-400 text-xs">
                            {new Date(h.created_at).toLocaleDateString(locale)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timestamps */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div>
                    <p className="text-xs">{t('created_at')}</p>
                    <p className="font-medium text-gray-700 dark:text-gray-300">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString(locale) : UNKNOWN_VALUE}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs">{t('last_login')}</p>
                    <p className="font-medium text-gray-700 dark:text-gray-300">
                      {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString(locale) : t('never')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs">{t('last_trip')}</p>
                    <p className="font-medium text-gray-700 dark:text-gray-300">
                      {user.last_trip_at ? new Date(user.last_trip_at).toLocaleDateString(locale) : t('never')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  {t('close')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default UserDetailModal
