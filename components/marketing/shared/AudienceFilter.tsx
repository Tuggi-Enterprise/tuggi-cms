'use client';

/**
 * THE AUDIENCE SEGMENTER, mounted by the newsletter and by push.
 *
 * Four defects fixed at once, and three of them lied to the operator:
 *
 *  1. `Premium Plan` sent the literal `'pro'` to a `uuid` column. The RPC does
 *     `(p_filters->>'subscription_tier_id')::uuid` and raises 22P02 — the paying segment NEVER
 *     worked, here or in push. The list now comes from `drive.subscription_tiers`
 *     (`lib/services/marketing/subscription-tiers.ts`), which owns the fact (CLAUDE.md §6,
 *     SSOT); the uuid pasted into the JSX was the second owner.
 *
 *  2. `catch { setEstimate(null) }` painted `UNKNOWN` both for "still counting" and for "the RPC
 *     answered 400". The two look alike on screen and are opposites as a decision: one asks for
 *     patience, the other asks that nobody fires. An error is now a red band carrying the
 *     literal PostgREST message, and the host hears about it through `onEstimateChange` so it
 *     can lock the send.
 *
 *  3. `PUSH BASE` was on the newsletter screen. The `estimateFn` was swapped and the label was
 *     not — a name that lies (§6). The caller now names the base in `baseLabel`; the default is
 *     the e-mail one.
 *
 *  4. `Active Users Only` filtered `onboarding_completed`, which is a signup completion flag and
 *     not a sign of use. The label now says what the filter does, and what the old label
 *     promised exists for real in the Activity group.
 *
 * And the whole screen left hardcoded English for `messages/{pt,en,es}.json`, under
 * `Pages.Marketing.Audience`.
 */

import { useState, useEffect, useCallback, useId } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Target, Users, Smartphone, Globe, ShieldCheck, Database, Activity, AlertTriangle, Info } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { AudienceFilters, NotificationService } from '@/lib/services/notification-service';
import { listSubscriptionTiers, tierLabel, type SubscriptionTierOption } from '@/lib/services/marketing/subscription-tiers';
import { cn } from '@/lib/utils';

/** What the host needs in order to decide whether it may fire. */
export interface AudienceEstimateState {
  estimate: number | null;
  loading: boolean;
  /** The literal PostgREST message. `null` = no error. */
  error: string | null;
}

interface AudienceFilterProps {
  filters: AudienceFilters;
  onChange: (filters: AudienceFilters) => void;
  /**
   * Audience estimate function. Default = push (NotificationService).
   * The newsletter passes NewsletterService.estimateAudience (which excludes opt-outs).
   */
  estimateFn?: (filters: AudienceFilters) => Promise<number>;
  /**
   * Name of the base `estimateFn` counts. Defaults to e-mail, because the component counts
   * campaign recipients and push is the caller that swaps the function. Without it the card
   * said "PUSH BASE" on the newsletter screen.
   */
  baseLabel?: string;
  /**
   * The estimate state, so the host can lock the send. Optional on purpose: push mounts the
   * component without it and keeps behaving exactly as before.
   */
  onEstimateChange?: (state: AudienceEstimateState) => void;
}

export function AudienceFilter({ filters, onChange, estimateFn, baseLabel, onEstimateChange }: AudienceFilterProps) {
  const t = useTranslations('Pages.Marketing.Audience');
  const locale = useLocale();
  const estimateAudience = estimateFn ?? NotificationService.estimateAudience;
  const [estimate, setEstimate] = useState<number | null>(null);
  const [totalBase, setTotalBase] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<SubscriptionTierOption[]>([]);
  const [tiersFailed, setTiersFailed] = useState(false);
  const [tiersLoading, setTiersLoading] = useState(true);

  /**
   * `toLocaleString()` with no argument uses the BROWSER locale, not the screen's: an operator
   * running Chrome in English read `12,873` inside a Portuguese interface. The next-intl locale
   * is the one the rest of the screen already uses.
   */
  const fmt = useCallback((n: number) => new Intl.NumberFormat(locale).format(n), [locale]);

  const platformId = useId();
  const tierId = useId();
  const languageId = useId();
  const createdAfterId = useId();
  const createdBeforeId = useId();
  const lastActiveAfterId = useId();
  const appVersionId = useId();
  const onboardingId = useId();

  useEffect(() => {
    onEstimateChange?.({ estimate, loading, error });
    // The host rebuilds `onEstimateChange` on every render; listing it here is a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, loading, error]);

  // The subscription tiers, once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listSubscriptionTiers();
        if (!cancelled) setTiers(rows);
      } catch {
        if (!cancelled) setTiersFailed(true);
      } finally {
        if (!cancelled) setTiersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch Total Base on mount
  useEffect(() => {
    const fetchTotalBase = async () => {
      try {
        const count = await estimateAudience({});
        setTotalBase(count);
      } catch (e) {
        console.error('Failed to fetch total base', e);
      }
    };
    fetchTotalBase();
  }, []);

  // Debounce estimate calculation
  useEffect(() => {
    let cancelled = false;
    const fetchEstimate = async () => {
      setLoading(true);
      try {
        const count = await estimateAudience(filters);
        if (cancelled) return;
        setEstimate(count);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        // The PostgREST message IS the diagnosis: `invalid input syntax for type uuid` is what
        // stayed invisible for months behind an `UNKNOWN`.
        setError(err?.message || err?.details || String(err));
        setEstimate(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timer = setTimeout(fetchEstimate, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filters]);

  const updateFilter = (key: keyof AudienceFilters, value: any) => {
    const newFilters = { ...filters, [key]: value };
    if (value === 'all' || value === '' || value === undefined) {
      delete newFilters[key];
    }
    onChange(newFilters);
  };

  const badge = loading
    ? t('estimate.calculating')
    : error
      ? t('estimate.failed')
      : estimate !== null
        ? t('estimate.recipients', { count: fmt(estimate) })
        : t('estimate.calculating');

  return (
    <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-purple overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-bold flex justify-between items-center gap-3 group">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-tuggi-purple" />
            {t('title')}
          </div>
          <div
            aria-live="polite"
            className={cn(
              'px-3 py-1 rounded-full text-[10px] font-bold transition-all duration-300 tracking-widest text-right',
              loading && 'bg-gray-100 text-gray-500 animate-pulse',
              !loading && error && 'bg-red-100 text-red-800',
              !loading && !error && 'bg-tuggi-purple/10 text-tuggi-purple'
            )}
          >
            {badge}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">

        {/*
          AN ERROR IS A STATE OF ITS OWN, not the absence of a number. Both used to draw
          `UNKNOWN`, so a broken RPC looked like a slow one and the operator moved on to the
          send button.
        */}
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-red-800">
            <p className="flex items-center gap-2 text-xs font-bold">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t('error.title')}
            </p>
            <p className="mt-1 break-words font-mono text-[11px] leading-snug">{error}</p>
            <p className="mt-1 text-[11px]">{t('error.hint')}</p>
          </div>
        )}

        {/* Statistics Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700">
             <div className="flex items-center gap-2 mb-1">
                <Database className="h-3 w-3 text-gray-400" />
                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest leading-none">
                  {baseLabel ?? t('emailBase')}
                </p>
             </div>
             <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                {totalBase !== null ? fmt(totalBase) : '---'}
             </p>
          </div>
          <div className="p-4 bg-tuggi-purple/5 rounded-2xl border border-tuggi-purple/10">
             <div className="flex items-center gap-2 mb-1">
                <Users className="h-3 w-3 text-tuggi-purple" />
                <p className="text-[9px] font-bold text-tuggi-purple uppercase tracking-widest leading-none">{t('targeted')}</p>
             </div>
             <p className="text-lg font-bold text-tuggi-purple leading-tight">
                {estimate !== null ? fmt(estimate) : '---'}
             </p>
          </div>
        </div>

        {/* Filters */}
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor={platformId} className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
              <Smartphone className="h-3 w-3" />
              {t('platform.label')}
            </Label>
            <Select
              id={platformId}
              value={filters.last_platform || 'all'}
              onValueChange={(val) => updateFilter('last_platform', val)}
            >
              <SelectItem value="all">{t('platform.all')}</SelectItem>
              <SelectItem value="ios">{t('platform.ios')}</SelectItem>
              <SelectItem value="android">{t('platform.android')}</SelectItem>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={tierId} className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
              <ShieldCheck className="h-3 w-3" />
              {t('tier.label')}
            </Label>
            <Select
              id={tierId}
              value={filters.subscription_tier_id || 'all'}
              onValueChange={(val) => updateFilter('subscription_tier_id', val)}
              disabled={tiersLoading || tiersFailed}
            >
              <SelectItem value="all">{tiersLoading ? t('tier.loading') : t('tier.all')}</SelectItem>
              {/* `value` is always the tier uuid — the RPC casts `::uuid`, anything else is 22P02. */}
              {tiers.map((tier) => (
                <SelectItem key={tier.id} value={tier.id}>{tierLabel(tier)}</SelectItem>
              ))}
            </Select>
            {tiersFailed && <p className="text-[11px] text-red-700">{t('tier.failed')}</p>}
          </div>

          <div className="space-y-2">
              <Label htmlFor={languageId} className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <Globe className="h-3 w-3" />
                {t('language.label')}
              </Label>
              <Select
                id={languageId}
                value={filters.language || 'all'}
                onValueChange={(val) => updateFilter('language', val)}
              >
                <SelectItem value="all">{t('language.all')}</SelectItem>
                {/* Values are the 2-letter code (the app's languageCode). The SQL match is a
                    case-insensitive prefix, so "pt" covers pt / pt-br / pt-BR / pt-PT.
                    SSOT: core.build_audience_filter. */}
                <SelectItem value="pt">{t('language.pt')}</SelectItem>
                <SelectItem value="en">{t('language.en')}</SelectItem>
                <SelectItem value="es">{t('language.es')}</SelectItem>
                <SelectItem value="it">{t('language.it')}</SelectItem>
                <SelectItem value="fr">{t('language.fr')}</SelectItem>
              </Select>
          </div>

          <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-950 rounded-xl border border-gray-100 dark:border-gray-800 transition-all hover:bg-gray-50">
            <Checkbox
              id={onboardingId}
              className="h-5 w-5 rounded-md border-tuggi-purple"
              checked={filters.onboarding_completed === true}
              onCheckedChange={(checked) => updateFilter('onboarding_completed', checked === true ? true : undefined)}
            />
            <Label htmlFor={onboardingId} className="text-sm font-bold text-gray-700 dark:text-gray-300 cursor-pointer">
              {t('onboarding.label')}
              <span className="block text-[10px] font-normal text-gray-500">{t('onboarding.help')}</span>
            </Label>
          </div>

          {/*
            ACTIVITY — four keys `core.build_audience_filter` already implements and the screen
            never exposed. No new SQL: `created_after`, `created_before`, `last_active_after` and
            `app_version_lt` have been declared in `lib/services/marketing/audience-types.ts`
            since the module was born, and the screen showed 4 of the 8 filters that existed.

            TODO(#marketing-correcoes): `last_active_before` — the winback filter, "who went
            away" — is missing. The key does NOT exist in the builder; the migration that creates
            it is being written in parallel. Inventing the name here would trade a missing field
            for a silent 400, so no control is drawn and the absence is stated in
            `activity.pending`.
          */}
          <div className="space-y-3 rounded-xl border border-gray-100 dark:border-gray-800 p-3">
            <p className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
              <Activity className="h-3 w-3" />
              {t('activity.title')}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={createdAfterId} className="text-[11px] font-semibold text-gray-500">
                  {t('activity.createdAfter')}
                </Label>
                <Input
                  id={createdAfterId}
                  type="date"
                  value={filters.created_after || ''}
                  onChange={(e) => updateFilter('created_after', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={createdBeforeId} className="text-[11px] font-semibold text-gray-500">
                  {t('activity.createdBefore')}
                </Label>
                <Input
                  id={createdBeforeId}
                  type="date"
                  value={filters.created_before || ''}
                  onChange={(e) => updateFilter('created_before', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={lastActiveAfterId} className="text-[11px] font-semibold text-gray-500">
                  {t('activity.lastActiveAfter')}
                </Label>
                <Input
                  id={lastActiveAfterId}
                  type="date"
                  value={filters.last_active_after || ''}
                  onChange={(e) => updateFilter('last_active_after', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={appVersionId} className="text-[11px] font-semibold text-gray-500">
                  {t('activity.appVersionLt')}
                </Label>
                <Input
                  id={appVersionId}
                  type="text"
                  inputMode="decimal"
                  placeholder={t('activity.appVersionPlaceholder')}
                  value={filters.app_version_lt || ''}
                  onChange={(e) => updateFilter('app_version_lt', e.target.value)}
                />
              </div>
            </div>

            <p className="text-[11px] leading-snug text-gray-500">{t('activity.pending')}</p>
          </div>

          {/*
            WHAT CANNOT BE DONE, SAID ON THE SCREEN. The "Brazil only" request comes back every
            month because the refusal lives in a business rule nobody opens mid-send.
            BR-USUARIO-043 item 5b: the profile survey exists to decide what to produce, and that
            purpose does not authorize campaign targeting. `core.build_audience_filter` raises
            TGU43 (400) — a recorded product decision, not a screen limitation.
          */}
          <p className="flex items-start gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            {t('demographicsBlocked')}
          </p>
        </div>

      </CardContent>
    </Card>
  );
}
