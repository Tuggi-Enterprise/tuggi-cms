'use client'

/**
 * The tourist's record: a drawer from the right with four tabs, opened from every surface that
 * prints a nickname (#976). It was a centered modal (`UserDetailModal`) plus a page of its own for
 * the Passaporte; both are this now, built on the chrome every record of the CMS shares
 * (`RecordShell`, `RecordTabs`, `useDialogShell`, as `ClientEditorModal` mounts them).
 *
 * **Who the person is: `nickname`, falling back to the first 8 characters of the `user_id`**
 * (**BR-USUARIO-042**), through `appUserLabel`. Neither the full name nor the e-mail is in
 * `UserDetail`; the founder's nominal exception (the manual grant confirmation) is fed by
 * `core.dashboard_app_users_detailed` on the app users list and does not reach this RPC, so
 * `CreditPanel` gets `email={null}` here, on purpose. The title comes from the identity the
 * trigger already has, so the header does not wait on the RPC.
 *
 * **The hours block reads the RPC and computes nothing** (**BR-MONETIZACAO-046**). State, balance
 * and the two totals arrive resolved by `drive.get_entitlement`. While the migration is unapplied
 * the nine columns are absent, and absent prints as an em dash: `0` would be an assertion nobody
 * made.
 *
 * The overlap is named rather than hidden: for a platform admin, `CreditPanel` shows state and
 * balance again, from its own door (`/api/admin/users/:id/credit`). Removing that header is a
 * change to `DS-COMPONENTE-015`, which belongs to `design`; `onChanged` re-runs this read so the
 * two cannot drift apart on screen. For everyone who is not an admin, `CreditPanel` answers 403
 * and the hours block is the only place the hours exist.
 *
 * Tabs (design spec on #976): there is no History tab. Its only content would be
 * `subscription_history`, which goes under the credit tab and disappears when empty.
 */

import { useCallback, useEffect, useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Activity, CreditCard, Gift, Hourglass, Infinity as InfinityIcon,
  Link2, Plane, Smartphone, Timer, User, Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SubscriptionBadge, ProviderIcon } from '@/components/ui/SubscriptionBadge'
import { CreditPanel } from '@/components/admin/credit/CreditPanel'
import { RoutePublishingToggle } from '@/components/admin/RoutePublishingToggle'
import { RecordShell } from '@/components/admin/clients/shared/RecordShell'
import { RecordTabs } from '@/components/admin/clients/shared/RecordTabs'
import { UserPassportTab, usePassport } from '@/components/admin/passport/UserPassportTab'
import { LinkedClientSection } from '@/components/dashboard/LinkedClientSection'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { useDialogShell } from '@/lib/hooks/use-dialog-shell'
import { dashboardService, type UserDetail } from '@/lib/services/dashboard-service'
import { GRANT_SOURCES, grantOrigin } from '@/lib/credit/entitlement'
import { formatDurationOrDash } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { appUserLabel, type AppUserIdentity } from '@/lib/format/user-identity'
import type { AppUserTab } from '@/lib/users/app-user-href'

/** The actions `drive.subscription_history` records; anything else prints as it came. */
const HISTORY_ACTIONS = ['subscribe', 'renew', 'upgrade', 'downgrade', 'cancel'] as const

const ACTION_TONE: Record<string, string> = {
  subscribe: 'bg-green-100 text-green-700',
  renew: 'bg-blue-100 text-blue-700',
  upgrade: 'bg-purple-100 text-purple-700',
  downgrade: 'bg-yellow-100 text-yellow-700',
}

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 dark:text-white text-right">{children}</span>
    </div>
  )
}

function OverviewTab({ user, isAdmin }: { user: UserDetail; isAdmin: boolean }) {
  const t = useTranslations('Pages.AppUsers')
  const locale = useLocale()
  const date = (iso: string | null | undefined, empty: string) =>
    iso ? new Date(iso).toLocaleDateString(locale) : empty
  const hasDevice = Boolean(user.last_platform || user.last_device_model || user.last_app_version)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="text-center p-4 bg-tuggi-blue/10 rounded-xl">
          <p className="text-2xl font-bold text-tuggi-blue">{user.trip_count || 0}</p>
          <p className="text-xs text-gray-600">{t('modal.trips')}</p>
        </div>
        <div className="text-center p-4 bg-green-500/10 rounded-xl">
          <p className="text-2xl font-bold text-green-700">{user.poi_visits_count || 0}</p>
          <p className="text-xs text-gray-600">{t('modal.poi_visits')}</p>
        </div>
        <div className="text-center p-4 bg-purple-500/10 rounded-xl">
          <p className="text-2xl font-bold text-purple-700">{Math.round(user.total_km || 0)}</p>
          <p className="text-xs text-gray-600">{t('modal.km')}</p>
        </div>
        <div className="text-center p-4 bg-orange-500/10 rounded-xl">
          <p className="text-2xl font-bold text-orange-700">{user.unique_cities_visited || 0}</p>
          <p className="text-xs text-gray-600">{t('modal.cities')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
            <User className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('modal.profile')}
          </h3>
          <div className="space-y-2 text-sm">
            <Row label={t('modal.country')}>{user.country || UNKNOWN_VALUE}</Row>
            <Row label={t('modal.language')}>{user.language || UNKNOWN_VALUE}</Row>
            <Row label={t('modal.driver_type')}>{user.driver_type || UNKNOWN_VALUE}</Row>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
            <Smartphone className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('modal.device')}
          </h3>
          {hasDevice ? (
            <div className="space-y-2 text-sm">
              <Row label={t('modal.platform')}>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-bold',
                    user.last_platform === 'ios'
                      ? 'bg-blue-100 text-blue-700'
                      : user.last_platform === 'android'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-700'
                  )}
                >
                  {user.last_platform || UNKNOWN_VALUE}
                </span>
              </Row>
              <Row label={t('modal.model')}>{user.last_device_model || UNKNOWN_VALUE}</Row>
              <Row label={t('modal.app_version')}>{user.last_app_version || UNKNOWN_VALUE}</Row>
              <Row label={t('modal.logins')}>{user.login_count || 0}</Row>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('overview.no_device')}</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-gray-600 border-t border-gray-200 dark:border-gray-700 pt-4">
        <div>
          <p className="text-xs">{t('modal.created_at')}</p>
          <p className="font-medium text-gray-800 dark:text-gray-300">{date(user.created_at, UNKNOWN_VALUE)}</p>
        </div>
        <div>
          <p className="text-xs">{t('modal.last_login')}</p>
          <p className="font-medium text-gray-800 dark:text-gray-300">{date(user.last_sign_in_at, t('modal.never'))}</p>
        </div>
        <div>
          <p className="text-xs">{t('modal.last_trip')}</p>
          <p className="font-medium text-gray-800 dark:text-gray-300">{date(user.last_trip_at, t('modal.never'))}</p>
        </div>
      </div>

      {/* #945: route publishing, on and off (BR-ROTA-006, App Store 1.2). Admin only. */}
      {isAdmin && <RoutePublishingToggle userId={user.user_id} />}
    </div>
  )
}

function CreditTab({
  user,
  isAdmin,
  onChanged,
}: {
  user: UserDetail
  isAdmin: boolean
  onChanged: () => void
}) {
  const t = useTranslations('Pages.AppUsers')
  const locale = useLocale()
  const history = user.subscription_history ?? []

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
          <Hourglass className="h-4 w-4 mr-2" aria-hidden="true" />
          {t('modal.hours')}
        </h3>
        <UserHours detail={user} />
      </section>

      {/* Card #310: the one door that writes the balance (BR-MONETIZACAO-047). `email={null}`:
          the RPC behind this drawer does not return one, and the founder's exception
          (BR-USUARIO-042, 4th edge case) is the app users list, not this file. */}
      <CreditPanel
        userId={user.user_id}
        nickname={user.nickname}
        email={null}
        isAdmin={isAdmin}
        licenseLabel={user.subscription_tier_display_name}
        providerLabel={user.subscription_provider}
        onChanged={onChanged}
      />

      {history.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
            <Activity className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('history.subscription')}
          </h3>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div
                key={h.id || i}
                className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-bold', ACTION_TONE[h.action] ?? 'bg-red-100 text-red-700')}>
                    {(HISTORY_ACTIONS as readonly string[]).includes(h.action) ? t(`history.action_${h.action}`) : h.action}
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">{h.tier_name}</span>
                  {h.previous_tier_name && <span className="text-gray-500">← {h.previous_tier_name}</span>}
                </div>
                <span className="text-gray-500 text-xs">{new Date(h.created_at).toLocaleDateString(locale)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function AppUserDrawer({
  userId,
  identity,
  initialTab = 'overview',
  onClose,
  onUpdate,
}: {
  userId: string
  /** What the trigger already knows, so the title does not wait on the RPC. */
  identity?: AppUserIdentity | null
  initialTab?: AppUserTab
  onClose: () => void
  onUpdate?: () => void
}) {
  const t = useTranslations('Pages.AppUsers')
  const { isAdmin, isLoading: roleLoading } = useCmsUser()
  const closeRef = useDialogShell(true, onClose) as React.RefObject<HTMLButtonElement | null>
  const titleId = useId()

  const [user, setUser] = useState<UserDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<AppUserTab>(initialTab)

  const fetchDetail = useCallback(async () => {
    setIsLoading(true)
    const res = await dashboardService.getUserDetail(userId)
    setUser(res.success && res.data ? res.data : null)
    setIsLoading(false)
  }, [userId])

  useEffect(() => { void fetchDetail() }, [fetchDetail])

  // The Passaporte is admin only, as its page was. A deep link to it for anyone else lands on the
  // overview; while the role is still loading the tab waits rather than flashing the overview.
  const passportBlocked = !roleLoading && !isAdmin
  const shown: AppUserTab = activeTab === 'passport' && passportBlocked ? 'overview' : activeTab
  const passport = usePassport(userId, shown === 'passport' && isAdmin)

  const changed = () => { void fetchDetail(); onUpdate?.() }
  const label = appUserLabel(user ?? identity ?? { user_id: userId })
  const found = isLoading || user !== null

  const tabs = [
    { id: 'overview' as const, label: t('drawer.tabs.overview'), icon: User },
    { id: 'passport' as const, label: t('drawer.tabs.passport'), icon: Plane, disabled: passportBlocked },
    { id: 'credit' as const, label: t('drawer.tabs.access'), icon: Wallet },
    { id: 'client' as const, label: t('drawer.tabs.client'), icon: Link2 },
  ]

  const spinner = (
    <div className="flex items-center justify-center py-24">
      <div className="w-10 h-10 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm transition-opacity duration-300"
      onClick={onClose}
    >
      <RecordShell
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full lg:w-[85vw] shadow-2xl animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
        icon={<User className="h-5 w-5 text-tuggi-blue" />}
        title={
          <>
            <span className="sr-only">{t('drawer.title')}: </span>
            {label}
          </>
        }
        titleId={titleId}
        controls={
          user ? (
            <div className="flex items-center gap-2">
              <SubscriptionBadge isPremium={user.is_premium} tierName={user.subscription_tier_display_name} />
              <ProviderIcon provider={user.subscription_provider} />
            </div>
          ) : null
        }
        closeLabel={t('modal.close')}
        onClose={onClose}
        closeRef={closeRef}
      >
        {isLoading && (
          <div className="absolute inset-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
              <p className="text-sm text-gray-500 font-medium animate-pulse">{t('drawer.loading')}</p>
            </div>
          </div>
        )}

        {found ? (
          <>
            <RecordTabs
              tabs={tabs}
              active={shown}
              onSelect={setActiveTab}
              heading={t('drawer.title')}
              disabledTitle={t('drawer.tabs.admin_only')}
            />

            <main className="flex-1 overflow-y-auto p-4 lg:p-8">
              {user && shown === 'overview' && <OverviewTab user={user} isAdmin={isAdmin} />}
              {shown === 'passport' && (isAdmin ? <UserPassportTab passport={passport} /> : spinner)}
              {user && shown === 'credit' && <CreditTab user={user} isAdmin={isAdmin} onChanged={changed} />}
              {user && shown === 'client' && (
                <LinkedClientSection userId={user.user_id} linked={user.linked_client} onChanged={changed} />
              )}
            </main>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-12 text-center text-gray-500">{t('modal.not_found')}</div>
        )}
      </RecordShell>
    </div>
  )
}

export default AppUserDrawer
