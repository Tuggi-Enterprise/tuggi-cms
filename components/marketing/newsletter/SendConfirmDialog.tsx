'use client';

/**
 * THE DOOR BETWEEN THE COMPOSER AND THE BASE.
 *
 * Until now there was no door: `disabled={!canEdit || busy !== null}` was all that stood between
 * a click and a broadcast. An empty subject, zero blocks and `audience_filters: {}` went out to
 * the whole base without a question — and did: six campaigns, 921 recipients, the two largest
 * with no filter at all.
 *
 * The dialog shows what is about to happen, in the words that describe what is about to happen:
 *
 *  · the NUMBER, large, because it is what the operator is about to multiply a mistake by;
 *  · the LITERAL subject, not "the campaign", because the subject is what lands in the inbox;
 *  · the active filters spelled out and, when there are none, **"whole base"** in those words —
 *    the absence of a filter is the most expensive decision on the screen and was the only one
 *    that never appeared;
 *  · how many recipients have no content in their own language (the `design` team's finding 9).
 *    This does NOT block: it makes visible a choice that was already being made in silence;
 *  · which languages were machine-translated and never reread. Also does not block.
 *
 * And confirm only lights up once the operator TYPES the recipient count. That is not ceremony:
 * it is the only way to know the number was read. An `Are you sure?` with a `Yes` button gets
 * clicked by reflex — which is what failed to stop any of the six sends.
 *
 * The shell (overlay, `role="dialog"`, `aria-modal`, Escape, focus returned) is the one
 * `components/admin/clients/ClientEditorModal.tsx` uses, through the same `useDialogShell` hook —
 * a second overlay pattern would be the duplication §6 names.
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Send, Clock, X, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDialogShell } from '@/lib/hooks/use-dialog-shell';
import { listSubscriptionTiers, tierLabel } from '@/lib/services/marketing/subscription-tiers';
import type { AudienceFilters } from '@/lib/services/marketing/audience-types';
import { describeFilters } from '@/components/marketing/shared/audience-description';
import type { NewsletterLanguage } from '@/types/newsletter';

export interface SendConfirmDialogProps {
  open: boolean;
  mode: 'send' | 'schedule';
  campaignName: string;
  subject: string;
  filters: AudienceFilters;
  estimate: number | null;
  estimateError: string | null;
  defaultLanguage: NewsletterLanguage;
  /** Recipients with no content in their own language. `null` = it could not be measured. */
  fallbackCount: number | null;
  unreviewedLanguages: NewsletterLanguage[];
  /** The local ISO string from the `datetime-local` input; `schedule` mode only. */
  scheduledFor?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SendConfirmDialog({
  open,
  mode,
  campaignName,
  subject,
  filters,
  estimate,
  estimateError,
  defaultLanguage,
  fallbackCount,
  unreviewedLanguages,
  scheduledFor,
  busy,
  onCancel,
  onConfirm,
}: SendConfirmDialogProps) {
  const t = useTranslations('Pages.Marketing.Newsletter.confirm');
  const tAudience = useTranslations('Pages.Marketing.Audience');
  const locale = useLocale();
  const titleId = useId();
  const typedId = useId();
  const closeRef = useDialogShell(open, onCancel) as React.RefObject<HTMLButtonElement | null>;
  const [typed, setTyped] = useState('');
  const [tierNames, setTierNames] = useState<Record<string, string>>({});

  /**
   * The typed confirmation is cleared whenever the dialog opens or closes, DURING RENDER and not
   * in an effect: an effect here is a second render pass for a value the first one already knows,
   * and React names this exact case as the way to reset state when a prop changes.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setTyped('');
  }

  // The plan name comes from whoever owns it. Without this the filter line would print a uuid,
  // which is not a sentence anybody can check before firing.
  useEffect(() => {
    if (!open || !filters.subscription_tier_id) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listSubscriptionTiers();
        if (!cancelled) setTierNames(Object.fromEntries(rows.map((r) => [r.id, tierLabel(r)])));
      } catch {
        /* the raw uuid is still shown; a missing name must not stop the check */
      }
    })();
    return () => { cancelled = true; };
  }, [open, filters.subscription_tier_id]);

  const fmt = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const lines = useMemo(() => describeFilters(filters, tAudience, tierNames), [filters, tAudience, tierNames]);

  if (!open) return null;

  const blocked = estimate === null || estimate === 0 || Boolean(estimateError);
  // Digits only: the number is displayed formatted (`12,873`), and refusing a typed separator
  // would punish the operator for copying what is on screen.
  const digitsMatch = estimate !== null && typed.replace(/\D/g, '') === String(estimate);
  const canConfirm = !blocked && digitsMatch && !busy;

  const scheduledLabel = scheduledFor
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scheduledFor))
    : '';

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white">
              {mode === 'send' ? t('title') : t('scheduleTitle')}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {mode === 'send' ? t('subtitle') : t('scheduleSubtitle', { when: scheduledLabel })}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onCancel}
            aria-label={t('cancel')}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {/* The number, and it is the largest element in the box on purpose. */}
          <div className="rounded-2xl bg-tuggi-purple/5 px-4 py-3 text-center">
            <p className="flex items-center justify-center gap-2 text-4xl font-bold leading-none text-tuggi-purple">
              <Users className="h-6 w-6" />
              {estimate !== null ? fmt.format(estimate) : '—'}
            </p>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-tuggi-purple">{t('recipients')}</p>
          </div>

          {estimateError && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
              {t('blocked')}
            </p>
          )}
          {!estimateError && estimate === 0 && (
            <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              {t('blockedZero')}
            </p>
          )}

          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-gray-500">{t('campaign')}</dt>
              <dd className="min-w-0 break-words text-gray-900 dark:text-gray-100">{campaignName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-gray-500">{t('subject')}</dt>
              <dd className="min-w-0 break-words font-medium text-gray-900 dark:text-gray-100">
                {subject.trim() || t('noSubject')}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-gray-500">{t('filters')}</dt>
              <dd className="min-w-0 text-gray-900 dark:text-gray-100">
                {lines.length === 0 ? (
                  /* The absence of a filter spelled out — it is what sent the two largest
                     campaigns to the whole base with nobody noticing. */
                  <span className="font-bold text-amber-700">{t('wholeBase')}</span>
                ) : (
                  <ul className="list-inside list-disc space-y-0.5">
                    {lines.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
              </dd>
            </div>
          </dl>

          {/*
            WARNS, DOES NOT BLOCK — both blocks below. Sending English to a French reader is a
            legitimate decision when it is a conscious one; the defect was that it was invisible.
          */}
          <div className="space-y-2">
            <p className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-snug text-gray-600 dark:bg-gray-800/50 dark:text-gray-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              {fallbackCount === null
                ? t('languageFallbackUnknown', { language: defaultLanguage.toUpperCase() })
                : t('languageFallback', {
                    count: fmt.format(fallbackCount),
                    language: defaultLanguage.toUpperCase(),
                  })}
            </p>
            {unreviewedLanguages.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('unreviewed', { languages: unreviewedLanguages.map((l) => l.toUpperCase()).join(', ') })}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={typedId} className="text-sm font-bold text-gray-700 dark:text-gray-300">
              {t('typeToConfirm', { count: estimate !== null ? fmt.format(estimate) : '—' })}
            </Label>
            <Input
              id={typedId}
              inputMode="numeric"
              autoComplete="off"
              value={typed}
              disabled={blocked}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
          <Button variant="outline" onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
          <Button variant="cta" onClick={onConfirm} disabled={!canConfirm}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : mode === 'send' ? <Send size={16} /> : <Clock size={16} />}
            <span className="ml-2">{mode === 'send' ? t('send') : t('schedule')}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
