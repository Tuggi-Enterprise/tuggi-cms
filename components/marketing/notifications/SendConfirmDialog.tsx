'use client';

/**
 * THE DOOR BETWEEN THE PUSH COMPOSER AND THE BASE.
 *
 * There was no door. `handleSend` went straight to the Edge Function, and a push is worse than
 * an e-mail in one specific way: `core.broadcast_persist_inbox` writes a PERMANENT row into
 * every recipient's inbox inside the app, and the product has no screen — operator's or
 * tourist's — that removes it. A wrong send is not "an e-mail people delete"; it is a line that
 * stays in the app of everyone who was targeted.
 *
 * DS-COMPONENTE-013 is the shape: the confirmation carries the verb and the number, the button
 * repeats both, the initial focus is NOT on the button, and the dialog states what will be
 * ASKED, never what happened. On top of that the operator has to TYPE the recipient count — an
 * `Are you sure? / Yes` gets clicked by reflex, and reflex is what this is here to interrupt.
 *
 * The number is fetched HERE and per language, not read from the audience card. The composer
 * fans out one broadcast per composed language (`filters.language`), so the audience card's
 * single figure — the whole filter, every language — is NOT who receives this campaign. Asking
 * the operator to type a number that is not the number would be worse than asking for nothing.
 *
 * The shell (overlay, `role="dialog"`, `aria-modal`, Escape, focus returned) is the one
 * `components/admin/clients/ClientEditorModal.tsx` uses, through `useDialogShell` — DS-A11Y-013.
 * `describeFilters` comes from `components/marketing/shared/audience-description.ts` — the same
 * sentences the history lists show, so a filter never reads one way before the send and another
 * way after it (§6 DRY).
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Loader2, Send, Users, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDialogShell } from '@/lib/hooks/use-dialog-shell';
import { listSubscriptionTiers, tierLabel } from '@/lib/services/marketing/subscription-tiers';
import { describeFilters } from '@/components/marketing/shared/audience-description';
import {
  NotificationService,
  type AudienceFilters,
  type PushContentByLanguage,
  type PushLanguage,
} from '@/lib/services/notification-service';

export interface SendConfirmDialogProps {
  open: boolean;
  isDirect: boolean;
  isScheduled: boolean;
  /** The local string from the `datetime-local` input; only read when `isScheduled`. */
  scheduleAt: string;
  /** Direct push targets explicit users, so the count is known without asking the database. */
  directCount: number;
  filters: AudienceFilters;
  targetLanguages: PushLanguage[];
  contentByLang: PushContentByLanguage;
  campaignType: string;
  highPriority: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SendConfirmDialog({
  open,
  isDirect,
  isScheduled,
  scheduleAt,
  directCount,
  filters,
  targetLanguages,
  contentByLang,
  campaignType,
  highPriority,
  onCancel,
  onConfirm,
}: SendConfirmDialogProps) {
  const t = useTranslations('Pages.Notifications.confirm');
  const tAudience = useTranslations('Pages.Marketing.Audience');
  const locale = useLocale();

  const titleId = useId();
  const typedId = useId();
  const closeRef = useDialogShell(open, onCancel) as React.RefObject<HTMLButtonElement | null>;

  const [typed, setTyped] = useState('');
  const [perLanguage, setPerLanguage] = useState<Partial<Record<PushLanguage, number>>>({});
  const [loading, setLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [tierNames, setTierNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  /**
   * ONE ESTIMATE PER LANGUAGE THE SEND WILL ACTUALLY USE. Their sum is the number the operator
   * types, because it is the number of people who will get a row in their inbox.
   */
  useEffect(() => {
    if (!open || isDirect) return;
    let cancelled = false;
    setLoading(true);
    setEstimateError(null);
    void (async () => {
      try {
        const counts = await Promise.all(
          targetLanguages.map(async (lang) => {
            const n = await NotificationService.estimateAudience({ ...filters, language: lang });
            return [lang, n] as const;
          })
        );
        if (!cancelled) setPerLanguage(Object.fromEntries(counts));
      } catch (e: any) {
        // The literal PostgREST message: `invalid input syntax for type uuid` is exactly the
        // diagnosis a generic "unknown" used to hide.
        if (!cancelled) {
          setEstimateError(e?.message || String(e));
          setPerLanguage({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // `filters` and `targetLanguages` are rebuilt every render by the host; the dialog only
    // opens once per decision, so `open` is the trigger that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDirect]);

  // The plan's name, so the filter line is a sentence and not a uuid.
  useEffect(() => {
    if (!open || !filters.subscription_tier_id) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listSubscriptionTiers();
        if (!cancelled) setTierNames(Object.fromEntries(rows.map((r) => [r.id, tierLabel(r)])));
      } catch {
        /* the raw uuid still prints; a missing name must not stop the check */
      }
    })();
    return () => { cancelled = true; };
  }, [open, filters.subscription_tier_id]);

  const fmt = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const filterLines = useMemo(
    () => describeFilters(filters, tAudience, tierNames),
    [filters, tAudience, tierNames]
  );

  if (!open) return null;

  const total = isDirect
    ? directCount
    : loading || estimateError
      ? null
      : targetLanguages.reduce((sum, l) => sum + (perLanguage[l] ?? 0), 0);

  const blocked = total === null || total === 0;
  // Digits only: the number is displayed formatted (`12.873`), and refusing a typed separator
  // would punish the operator for copying what is on the screen.
  const digitsMatch = total !== null && typed.replace(/\D/g, '') === String(total);
  const canConfirm = !blocked && digitsMatch;

  const scheduledLabel = isScheduled && scheduleAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scheduleAt))
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
              {isScheduled ? t('title_schedule') : t('title')}
            </h2>
            {scheduledLabel && <p className="mt-0.5 text-sm text-gray-500">{scheduledLabel}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onCancel}
            aria-label={t('close')}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {/* The number, the largest element in the box on purpose. */}
          <div className="rounded-2xl bg-tuggi-purple/5 px-4 py-3 text-center">
            <p
              data-testid="confirm-estimate"
              aria-live="polite"
              className="flex items-center justify-center gap-2 text-4xl font-bold leading-none text-tuggi-purple"
            >
              <Users className="h-6 w-6" />
              {loading ? <Loader2 className="h-7 w-7 animate-spin" /> : total !== null ? fmt.format(total) : '—'}
            </p>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-tuggi-purple">
              {t('recipients_label')}
            </p>
          </div>

          {/* The part that has no undo, said before anything else on the screen. */}
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-snug text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {t('irreversible')}
          </p>

          {estimateError && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 break-words">
              {t('blocked_estimate')} {estimateError}
            </p>
          )}
          {!estimateError && !loading && total === 0 && (
            <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              {t('blocked_zero')}
            </p>
          )}

          <dl className="space-y-2 text-sm">
            {!isDirect && (
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 font-semibold text-gray-500">{t('filters_label')}</dt>
                <dd className="min-w-0 text-gray-900 dark:text-gray-100">
                  {filterLines.length === 0 ? (
                    /* The absence of a filter, in those words. It is the most expensive decision
                       on the screen and it was the only one that never appeared. */
                    <span data-testid="confirm-whole-base" className="font-bold text-amber-700">
                      {t('whole_base')}
                    </span>
                  ) : (
                    <ul className="list-inside list-disc space-y-0.5">
                      {filterLines.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  )}
                </dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 font-semibold text-gray-500">{t('type_label')}</dt>
              <dd className="min-w-0 break-words font-mono text-gray-900 dark:text-gray-100">{campaignType}</dd>
            </div>
          </dl>

          {/* The LITERAL text, per language — what lands on the phone, not "the campaign". */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400">{t('languages_label')}</p>
            {targetLanguages.map((lang) => {
              const content = contentByLang[lang];
              return (
                <div
                  key={lang}
                  data-testid={`confirm-language-${lang}`}
                  className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800"
                >
                  <p className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    <span>{tAudience(`language.${lang}`)}</span>
                    {!isDirect && perLanguage[lang] !== undefined && <span>{fmt.format(perLanguage[lang]!)}</span>}
                  </p>
                  <p className="mt-1 break-words font-bold text-gray-900 dark:text-white">{content?.title}</p>
                  <p className="break-words text-sm text-gray-600 dark:text-gray-400">{content?.body}</p>
                </div>
              );
            })}
          </div>

          {highPriority && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('priority_warning')}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={typedId} className="text-sm font-bold text-gray-700 dark:text-gray-300">
              {t('gate_label', { count: total !== null ? fmt.format(total) : '—' })}
            </Label>
            <Input
              id={typedId}
              inputMode="numeric"
              autoComplete="off"
              placeholder={t('gate_placeholder')}
              value={typed}
              disabled={blocked}
              onChange={(e) => setTyped(e.target.value)}
            />
            <p className="text-xs text-gray-400">{t('gate_hint')}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="cta" onClick={onConfirm} disabled={!canConfirm}>
            {isScheduled ? <Clock size={16} /> : <Send size={16} />}
            <span className="ml-2">
              {isScheduled
                ? t('schedule', { count: total !== null ? fmt.format(total) : '—' })
                : t('send', { count: total !== null ? fmt.format(total) : '—' })}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
