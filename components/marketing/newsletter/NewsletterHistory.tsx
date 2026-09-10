'use client';

/**
 * THE HISTORY, and the one window in which a send can still be called off.
 *
 * `scheduled` was rendered here as one more badge in a list ordered by `created_at` — no way to
 * see WHEN it goes out, no way to see WHO it goes out to, and no button at all.
 * `NewsletterService.deleteCampaign` existed and no screen ever called it. So the schedule, which
 * is the only undo this module has, had no undo of its own.
 *
 * Now the scheduled campaigns come first, in their own section, each with its time in the
 * operator's own zone, the audience it was saved with, and a `Cancel`. Cancelling writes
 * `status='cancelled'`; it NEVER deletes (CLAUDE.md §3) — a row that disappears takes with it
 * what was going to be sent and who stopped it.
 *
 * A row whose time has passed and is STILL `scheduled` is highlighted, because that combination
 * does not describe the campaign — it describes the cron.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronDown, AlertTriangle, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NewsletterService } from '@/lib/services/newsletter-service';
import { describeFilters } from '@/components/marketing/shared/audience-description';
import type { NewsletterCampaign, NewsletterCampaignStats } from '@/types/newsletter';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-amber-100 text-amber-800',
  sending: 'bg-blue-100 text-blue-800',
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-200 text-gray-700',
};

export function NewsletterHistory() {
  const t = useTranslations('Pages.Marketing.Newsletter');
  const tAudience = useTranslations('Pages.Marketing.Audience');
  const locale = useLocale();
  const [campaigns, setCampaigns] = useState<NewsletterCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, NewsletterCampaignStats>>({});
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    NewsletterService.listCampaigns()
      .then(setCampaigns)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  /**
   * The scheduled ones, soonest first — the opposite of the rest of the list. History is read
   * newest-first because the last send is the interesting one; a queue is read by what happens
   * next, because that is the one still worth stopping.
   */
  const scheduled = useMemo(
    () =>
      campaigns
        .filter((c) => c.status === 'scheduled')
        .sort((a, b) => (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? '')),
    [campaigns]
  );
  const rest = useMemo(() => campaigns.filter((c) => c.status !== 'scheduled'), [campaigns]);

  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale]
  );

  const toggle = async (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!stats[id]) {
      try {
        const { stats: s } = await NewsletterService.getCampaign(id);
        setStats((prev) => ({ ...prev, [id]: s }));
      } catch (e) {
        console.error(e);
      }
    }
  };

  const cancel = async (id: string) => {
    setCancelling(id);
    setError(null);
    try {
      const updated = await NewsletterService.cancelCampaign(id);
      setCampaigns((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (e: any) {
      setError(t('history.cancelFailed', { reason: e?.message ?? String(e) }));
    } finally {
      setCancelling(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-gray-400"><Loader2 className="animate-spin" /></div>;
  }

  if (campaigns.length === 0) {
    return <div className="text-center text-sm text-gray-500 py-12">{t('history.empty')}</div>;
  }

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500">{t('history.scheduledTitle')}</h2>
        {scheduled.length === 0 ? (
          <p className="text-sm text-gray-500">{t('history.scheduledEmpty')}</p>
        ) : (
          scheduled.map((c) => {
            const when = c.scheduled_for ? new Date(c.scheduled_for) : null;
            const overdue = when !== null && when.getTime() < Date.now();
            const lines = describeFilters(c.audience_filters ?? {}, tAudience, {});
            return (
              <Card key={c.id} className={cn(overdue && 'border-red-300 bg-red-50/40')}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-white">{c.name}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {when ? dateTime.format(when) : '—'}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      <span className="font-semibold">{t('history.audience')}: </span>
                      {lines.length === 0 ? (
                        <span className="font-bold text-amber-700">{t('history.wholeBase')}</span>
                      ) : (
                        lines.join(' · ')
                      )}
                    </div>
                    {overdue && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-red-800">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {t('history.overdue')}
                      </p>
                    )}
                  </div>
                  <Button variant="outline" onClick={() => cancel(c.id)} disabled={cancelling !== null}>
                    {cancelling === c.id ? <Loader2 className="animate-spin" size={16} /> : <Ban size={16} />}
                    <span className="ml-2">{cancelling === c.id ? t('history.cancelling') : t('history.cancel')}</span>
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500">{t('history.sentTitle')}</h2>
        {rest.map((c) => {
          const s = stats[c.id];
          const open = openId === c.id;
          return (
            <Card key={c.id}>
              <CardContent className="p-0">
                <button onClick={() => toggle(c.id)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">{c.name}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {dateTime.format(new Date(c.sent_at ?? c.created_at))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn('text-xs font-semibold px-2 py-1 rounded-full', STATUS_STYLES[c.status] || STATUS_STYLES.draft)}>
                      {t(`status.${c.status}`)}
                    </span>
                    <ChevronDown size={16} className={cn('text-gray-400 transition-transform', open && 'rotate-180')} />
                  </div>
                </button>

                {open && (
                  <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {s ? (
                      <>
                        <Metric label={t('history.total')} value={s.total} />
                        <Metric label={t('history.delivered')} value={s.delivered} />
                        <Metric label={t('history.opened')} value={s.opened} />
                        <Metric label={t('history.clicked')} value={s.clicked} />
                        <Metric label={t('history.openRate')} value={`${Math.round(s.open_rate * 100)}%`} highlight />
                      </>
                    ) : (
                      <div className="col-span-full flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="animate-spin" size={14} /> {t('history.loading')}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-lg p-3 text-center', highlight ? 'bg-tuggi-blue/5' : 'bg-gray-50 dark:bg-gray-800/50')}>
      <div className={cn('text-lg font-bold', highlight ? 'text-tuggi-blue' : 'text-gray-900 dark:text-white')}>{value}</div>
      <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
    </div>
  );
}
