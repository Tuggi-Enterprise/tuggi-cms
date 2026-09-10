'use client';

/**
 * WHAT WAS SENT, AND WHAT IS ABOUT TO BE.
 *
 * Three defects, and the first two were the same mistake seen from opposite ends:
 *
 *  1. A SCHEDULED CAMPAIGN WAS INVISIBLE AND UNCANCELLABLE. `/schedule` writes
 *     `marketing.scheduled_notifications`; this screen reads `marketing.notification_logs`.
 *     DIFFERENT TABLES — so the `status === 'scheduled'` branch that used to paint an orange
 *     badge here was decoration for a row that cannot exist (§6, code nobody calls). The queue
 *     has its own section now, with the operator's own time zone, the audience that was frozen
 *     with it, and a `Cancelar` that writes `status = 'cancelled'` — never a DELETE (§3).
 *  2. NO NUMBER, EVER. Every broadcast printed "All Users", segmented or not, because the Edge
 *     Function counted `success`/`failure` token by token and threw the result at
 *     `console.log`. The card is built for the columns; a row logged before they existed shows
 *     "no count recorded" rather than a fabricated zero.
 *  3. THE SEARCH STOPPED AT THE 50th CAMPAIGN. `p_limit: 50` with the box filtering in the
 *     browser: campaign 51 was unreachable and the box said nothing. Paging and search are the
 *     RPC's now — see `NotificationService.getLogs`.
 *
 * THE CAVEAT ON THE CARD IS NOT DECORATION. FCM `success` means ACCEPTED BY FCM. It is not
 * delivered and it is not opened — `docs/contracts/notificacoes.md` §2.4 spells out why
 * `delivered_at` is structurally unreachable for a broadcast. Labelling this "entregues" would
 * be a number that lies, and the report is the reason the number exists.
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  History,
  Send,
  Users,
  Hash,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCcw,
  Search,
  Filter,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import {
  NotificationService,
  type NotificationLog,
  type ScheduledNotification,
} from '@/lib/services/notification-service';
import { listSubscriptionTiers, tierLabel } from '@/lib/services/marketing/subscription-tiers';
import { describeFilters } from '@/components/marketing/shared/audience-description';
import { cn } from '@/lib/utils';
import { useLocale, useTranslations } from 'next-intl';

const PAGE_SIZE = 25;

export function NotificationHistory() {
  const t = useTranslations('Pages.Notifications');
  const tAudience = useTranslations('Pages.Marketing.Audience');
  const locale = useLocale();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const [queue, setQueue] = useState<ScheduledNotification[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);

  const [tierNames, setTierNames] = useState<Record<string, string>>({});

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await NotificationService.getLogs({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search,
      });
      setLogs(data);
    } catch (error: any) {
      setLoadError(error?.message || String(error));
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const fetchQueue = useCallback(async () => {
    setQueueError(null);
    try {
      const rows = await NotificationService.getScheduled();
      setQueue(rows.filter((r) => r.status === 'pending'));
    } catch (error: any) {
      // The queue is a section, not the screen. A missing RPC must not take the history down
      // with it — TODO(dev): remove this tolerance once core.get_scheduled_notifications ships.
      setQueueError(error?.message || String(error));
      setQueue([]);
    }
  }, []);

  // The search goes to the database, so it is debounced and it resets the page: a term typed
  // on page 3 that matches four rows would otherwise show an empty page 3 of 1.
  useEffect(() => {
    const timer = setTimeout(() => { void fetchLogs(); }, search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [fetchLogs, search]);

  useEffect(() => { void fetchQueue(); }, [fetchQueue]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listSubscriptionTiers();
        if (!cancelled) setTierNames(Object.fromEntries(rows.map((r) => [r.id, tierLabel(r)])));
      } catch {
        /* the uuid still prints; a missing plan name is not worth an error band */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  const handleCancel = async (item: ScheduledNotification) => {
    setCancelling(item.id);
    setQueueNotice(null);
    try {
      await NotificationService.cancelScheduled(item.id);
      setQueue((prev) => prev.filter((q) => q.id !== item.id));
      setQueueNotice(t('scheduled.cancelled'));
    } catch (e: any) {
      setQueueNotice(t('scheduled.cancel_failed', { error: e?.message || String(e) }));
    } finally {
      setCancelling(null);
    }
  };

  const formatWhen = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const audienceChips = (filters: NotificationLog['audience_filters']) =>
    describeFilters(filters ?? {}, tAudience, tierNames);

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      {/* ------------------------------- THE QUEUE ------------------------------- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="h-6 w-6 text-tuggi-orange" />
            {t('scheduled.title')}
          </h2>
          <p className="text-sm text-gray-500 font-medium">
            {t('scheduled.subtitle', { count: queue.length })} {t('scheduled.tz_note', { tz })}
          </p>
        </div>

        {queueNotice && (
          <div role="status" className="rounded-xl bg-gray-50 dark:bg-gray-800/50 px-4 py-2 text-sm">
            {queueNotice}
          </div>
        )}

        {queueError ? (
          <div role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 break-words">
            {t('scheduled.unavailable', { error: queueError })}
          </div>
        ) : queue.length === 0 ? (
          <p className="text-sm text-gray-400 italic">{t('scheduled.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {queue.map((item) => {
              const overdue = new Date(item.scheduled_for).getTime() < Date.now();
              const chips = audienceChips(item.audience_filters);
              return (
                <li key={item.id}>
                  <Card
                    className={cn(
                      'rounded-2xl border-gray-100 dark:border-gray-800',
                      overdue && 'border-red-300 bg-red-50/40 dark:bg-red-900/10'
                    )}
                  >
                    <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-tuggi-orange">
                          {formatWhen(item.scheduled_for)}
                        </p>
                        <p className="font-bold text-gray-900 dark:text-white line-clamp-1">{item.title}</p>
                        <p className="text-sm text-gray-500 line-clamp-1">{item.body}</p>
                        <p className="text-xs text-gray-400">
                          {t('scheduled.audience')}:{' '}
                          {chips.length === 0 ? (
                            <span className="font-bold text-amber-700">{t('scheduled.whole_base')}</span>
                          ) : (
                            chips.join(' · ')
                          )}
                        </p>
                        {overdue && (
                          <p className="flex items-center gap-1.5 text-xs font-bold text-red-600">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {t('scheduled.overdue')}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        className="shrink-0 rounded-xl"
                        onClick={() => handleCancel(item)}
                        disabled={cancelling === item.id}
                      >
                        <Ban className="h-4 w-4 mr-2" />
                        {cancelling === item.id ? t('scheduled.cancelling') : t('scheduled.cancel')}
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------ THE HISTORY ------------------------------ */}
      <section className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <History className="h-6 w-6 text-tuggi-blue" />
              {t('history.title')}
            </h2>
            <p className="text-sm text-gray-500 font-medium">{t('history.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="search"
                placeholder={t('history.search_placeholder')}
                aria-label={t('history.search_placeholder')}
                className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue/20 outline-none"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="rounded-xl border-gray-200"
              onClick={() => void fetchLogs()}
              disabled={loading}
              aria-label={t('history.refresh')}
            >
              <RefreshCcw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <p className="text-xs text-gray-400 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-tuggi-orange" />
          {t('history.fcm_caveat')}
        </p>

        {loadError && (
          <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 break-words">
            {t('history.load_failed', { error: loadError })}
          </div>
        )}

        <div className="space-y-4">
          {loading && logs.length === 0 ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl" />
            ))
          ) : logs.length > 0 ? (
            logs.map((log) => {
              const chips = audienceChips(log.audience_filters);
              const hasCounts = typeof log.success_count === 'number' || typeof log.failure_count === 'number';
              const campaignType = typeof log.data?.type === 'string' ? log.data.type : null;
              return (
                <Card
                  key={log.id}
                  className="rounded-2xl border-gray-100 dark:border-gray-800 hover:border-tuggi-blue/30 transition-all overflow-hidden"
                >
                  <CardContent className="p-0">
                    <div className="flex flex-col md:flex-row md:items-center">
                      <div
                        className={cn(
                          'w-2 hidden md:block self-stretch',
                          log.status === 'sent'
                            ? 'bg-tuggi-green'
                            : log.status === 'partial'
                              ? 'bg-tuggi-orange'
                              : 'bg-red-500'
                        )}
                      />

                      <div className="flex-1 p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        {/* Main Info */}
                        <div className="lg:col-span-4 space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {log.type === 'user' && <Users className="h-3.5 w-3.5 text-tuggi-purple" />}
                            {log.type === 'broadcast' && <Send className="h-3.5 w-3.5 text-tuggi-blue" />}
                            {log.type === 'topic' && <Hash className="h-3.5 w-3.5 text-tuggi-green" />}
                            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                              {log.type}
                            </span>
                            <div className="h-1 w-1 rounded-full bg-gray-300" />
                            <span className="text-[10px] font-bold text-gray-400">
                              {formatWhen(log.sent_at || log.created_at)}
                            </span>
                          </div>
                          <h3 className="font-bold text-gray-900 dark:text-white line-clamp-1">{log.title}</h3>
                          <p className="text-sm text-gray-500 line-clamp-1">{log.body}</p>
                          {campaignType && (
                            <p className="text-[10px] font-mono text-gray-400">
                              {t('history.campaign_type')}: {campaignType}
                            </p>
                          )}
                        </div>

                        {/* Numbers, where "All Users" used to be for every single row. */}
                        <div className="lg:col-span-5 flex flex-wrap gap-4">
                          <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2 rounded-xl border border-gray-100 dark:border-gray-700 flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                              <Users className="h-4 w-4 text-gray-400" />
                            </div>
                            <div>
                              <p className="text-[9px] font-bold text-gray-400 uppercase leading-none">
                                {t('history.results')}
                              </p>
                              <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                {hasCounts
                                  ? t('history.accepted', {
                                      accepted: log.success_count ?? 0,
                                      failed: log.failure_count ?? 0,
                                    })
                                  : t('history.no_counts')}
                              </p>
                              <p className="text-[10px] text-gray-400">
                                {log.type === 'topic'
                                  ? t('history.topic', { topic: log.topic ?? '—' })
                                  : log.type === 'user'
                                    ? t('history.direct_clients', { count: log.user_ids?.length || 0 })
                                    : typeof log.recipient_count === 'number'
                                      ? t('history.recipients') + ': ' + log.recipient_count
                                      : ''}
                              </p>
                            </div>
                          </div>

                          {log.type === 'broadcast' && (
                            <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2 rounded-xl border border-gray-100 dark:border-gray-700 flex items-start gap-3 max-w-full">
                              <div className="h-8 w-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0">
                                <Filter className="h-4 w-4 text-gray-400" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold text-gray-400 uppercase leading-none">
                                  {t('history.recipients')}
                                </p>
                                {chips.length === 0 ? (
                                  <span className="text-sm font-bold text-amber-700">{t('history.whole_base')}</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {chips.map((chip) => (
                                      <span
                                        key={chip}
                                        className="rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[10px] font-bold text-gray-600 dark:text-gray-300"
                                      >
                                        {chip}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Status */}
                        <div className="lg:col-span-3 flex items-center justify-end gap-3">
                          <div
                            className={cn(
                              'flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                              log.status === 'sent'
                                ? 'bg-tuggi-green/10 text-tuggi-green'
                                : log.status === 'partial'
                                  ? 'bg-tuggi-orange/10 text-tuggi-orange'
                                  : 'bg-red-500/10 text-red-500'
                            )}
                          >
                            {log.status === 'sent' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : log.status === 'partial' ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : (
                              <XCircle className="h-3 w-3" />
                            )}
                            {t(`history.status.${log.status}`)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <div className="text-center py-20 bg-gray-50 dark:bg-gray-900/50 rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
              <div className="p-4 bg-white dark:bg-gray-900 rounded-full w-fit mx-auto shadow-sm mb-4">
                <History className="h-12 w-12 text-gray-200" />
              </div>
              <p className="text-gray-900 dark:text-white font-bold text-xl">{t('history.empty_title')}</p>
              <p className="text-gray-500 max-w-xs mx-auto mt-1 font-medium">{t('history.empty_body')}</p>
            </div>
          )}
        </div>

        {/*
          A CURSOR THIS SCREEN DOES NOT HAVE: the RPC returns rows, not a total, so the next
          page is offered whenever the current one came back full. Guessing a page count from a
          full page would print a number nobody can trust.
        */}
        <div className="flex items-center justify-between">
          <Button variant="outline" className="rounded-xl" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading}>
            {t('history.prev')}
          </Button>
          <span className="text-xs font-bold text-gray-400">{t('history.page', { page: page + 1 })}</span>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => setPage((p) => p + 1)}
            disabled={logs.length < PAGE_SIZE || loading}
          >
            {t('history.next')}
          </Button>
        </div>
      </section>
    </div>
  );
}
