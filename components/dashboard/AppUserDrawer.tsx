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
 * **One block of state and balance** (#977). The hours row is the only place the state, the
 * balance and the period are printed; `CreditPanel` underneath keeps the grant button and the two
 * ledgers and no summary of its own, so the tab no longer says the same thing twice. `onChanged`
 * re-runs this read after a grant or a revoke, so the row follows the ledger. During `unlimited` the
 * balance stays on the row with the sentence that says why it is idle (`DS-COMPONENTE-015`).
 *
 * Tabs (design spec on #976, #977): Overview, Passaporte, Access and balance. There is no History
 * tab, because `subscription_history` goes under the credit tab and disappears when empty; and the
 * linked client sits on the overview, beside route publishing, instead of on a tab of its own.
 */

import { useCallback, useEffect, useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Activity, BadgeCheck, Building2, CalendarClock, CreditCard, Gift, Hourglass, Infinity as InfinityIcon,
  Map as MapIcon, MapPin, Navigation, Plane, Store, Timer, User, Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
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
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale)
  const unlimited = detail.state === 'unlimited'

  // The row is the tab's one summary (#977). Access until only while the period runs; licence
  // and provider only when the profile has them, because a card of an em dash says nothing.
  const cards: Array<{ key: string; label: string; value: string; subtitle?: string; icon: typeof Wallet }> = [
    {
      key: 'state',
      label: t('credit.panel.state'),
      value: t(`credit.panel.state_${detail.state}`),
      icon: unlimited ? InfinityIcon : Hourglass,
    },
    {
      key: 'balance',
      label: t('credit.panel.balance'),
      value: formatDurationOrDash(detail.balance_minutes),
      subtitle:
        detail.balance_minutes == null
          ? undefined
          : t('credit.panel.balance_minutes', { minutes: detail.balance_minutes }),
      icon: Timer,
    },
    ...(unlimited
      ? [{
          key: 'ends_at',
          label: t('credit.panel.ends_at'),
          value: detail.ends_at ? day(detail.ends_at) : UNKNOWN_VALUE,
          icon: CalendarClock,
        }]
      : []),
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
      key: 'last_grant',
      label: t('credit.panel.last_grant'),
      value: sourceLabel,
      subtitle: detail.last_grant_at ? day(detail.last_grant_at) : undefined,
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
    ...(detail.subscription_tier_display_name
      ? [{ key: 'license', label: t('credit.panel.license'), value: detail.subscription_tier_display_name, icon: BadgeCheck }]
      : []),
    ...(detail.subscription_provider
      ? [{ key: 'provider', label: t('credit.panel.provider'), value: detail.subscription_provider, icon: Store }]
      : []),
  ]

  // DS-COMPONENTE-015, BR-MONETIZACAO-051: during the period the balance is idle, and the row
  // says so instead of hiding it.
  const inertUntil = unlimited && (detail.balance_minutes ?? 0) > 0 ? detail.ends_at : null

  return (
    <div className="space-y-3">
      <StatCardRow columns={6} className="gap-3">
        {cards.map((card) => (
          <StatCard
            key={card.key}
            size="compact"
            glow={false}
            icon={card.icon}
            label={card.label}
            value={card.value}
            subtitle={card.subtitle}
          />
        ))}
      </StatCardRow>
      {inertUntil ? (
        <p className="text-xs text-gray-700 dark:text-gray-400">
          {t('credit.panel.inert_notice', { date: day(inertUntil) })}
        </p>
      ) : null}
    </div>
  )
}

/** Label on top, value under it: the shape of every field on the overview (#977). */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-600 dark:text-gray-400">{label}</p>
      <p className="font-medium text-gray-900 dark:text-white break-words">{children}</p>
    </div>
  )
}

/** The same badge the app users list prints in its Language column. */
const LANGUAGE_BADGE =
  'inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs font-bold text-gray-600 dark:text-gray-400 uppercase'

function OverviewTab({
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
  const date = (iso: string | null | undefined, empty: string) =>
    iso ? new Date(iso).toLocaleDateString(locale) : empty

  const stats = [
    { key: 'trips', label: t('modal.trips'), value: user.trip_count || 0, icon: MapIcon },
    { key: 'poi_visits', label: t('modal.poi_visits'), value: user.poi_visits_count || 0, icon: MapPin },
    { key: 'km', label: t('modal.km'), value: Math.round(user.total_km || 0), icon: Navigation },
    { key: 'cities', label: t('modal.cities'), value: user.unique_cities_visited || 0, icon: Building2 },
  ]

  return (
    <div className="space-y-6">
      <StatCardRow columns={4} className="gap-3">
        {stats.map((s) => (
          <StatCard key={s.key} size="compact" glow={false} icon={s.icon} label={s.label} value={s.value} />
        ))}
      </StatCardRow>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 text-sm">
        <Field label={t('modal.country')}>{user.country || UNKNOWN_VALUE}</Field>
        <Field label={t('modal.language')}>
          {user.language ? <span className={LANGUAGE_BADGE}>{user.language}</span> : UNKNOWN_VALUE}
        </Field>
        <Field label={t('modal.driver_type')}>{user.driver_type || UNKNOWN_VALUE}</Field>
        <Field label={t('modal.platform')}>
          {user.last_platform ? (
            <span
              className={cn(
                'inline-block px-2 py-0.5 rounded text-xs font-bold',
                user.last_platform === 'ios'
                  ? 'bg-blue-100 text-blue-700'
                  : user.last_platform === 'android'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700'
              )}
            >
              {user.last_platform}
            </span>
          ) : (
            UNKNOWN_VALUE
          )}
        </Field>
        <Field label={t('modal.model')}>{user.last_device_model || UNKNOWN_VALUE}</Field>
        <Field label={t('modal.app_version')}>{user.last_app_version || UNKNOWN_VALUE}</Field>
        <Field label={t('modal.logins')}>{user.login_count || 0}</Field>
        <Field label={t('modal.created_at')}>{date(user.created_at, UNKNOWN_VALUE)}</Field>
        <Field label={t('modal.last_login')}>{date(user.last_sign_in_at, t('modal.never'))}</Field>
        <Field label={t('modal.last_trip')}>{date(user.last_trip_at, t('modal.never'))}</Field>
      </div>

      {/* #977: the linked client and route publishing side by side; the client had a tab of its
          own for one card. Route publishing is admin only (#945, BR-ROTA-006, App Store 1.2). */}
      <div className={cn('grid grid-cols-1 gap-6', isAdmin && 'lg:grid-cols-2')}>
        <LinkedClientSection userId={user.user_id} linked={user.linked_client} onChanged={onChanged} />
        {isAdmin && <RoutePublishingToggle userId={user.user_id} />}
      </div>
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
              {user && shown === 'overview' && <OverviewTab user={user} isAdmin={isAdmin} onChanged={changed} />}
              {shown === 'passport' && (isAdmin ? <UserPassportTab passport={passport} /> : spinner)}
              {user && shown === 'credit' && <CreditTab user={user} isAdmin={isAdmin} onChanged={changed} />}
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
