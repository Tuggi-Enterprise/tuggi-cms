'use client';

/**
 * THE PUSH COMPOSER.
 *
 * What changed here, and why each one was a defect rather than a preference:
 *
 *  1. NOTHING CONFIRMED THE SEND. `handleSend` went straight to the Edge Function with the
 *     whole base as its default audience, and `core.broadcast_persist_inbox` writes one
 *     PERMANENT row into every recipient's app inbox — there is no path in the product that
 *     removes it. `SendConfirmDialog` is the gate, and it follows DS-COMPONENTE-013: the
 *     sentence carries the verb and the number, the button repeats them, and the initial
 *     focus is not on the button. The operator has to TYPE the recipient count.
 *  2. `data.type` WAS NEVER SENT, so every campaign landed on `generic` — one line in the
 *     report for all of them (`docs/contracts/notificacoes.md` §2.3). The campaign key is a
 *     required field now.
 *  3. `alert()` ATE THE ERROR. Five of them, including a generic one in the `catch`. A modal
 *     alert blocks the tab, cannot be copied and disappears — precisely when the operator
 *     needs to read the `22P02` from a broken tier filter or the `FCM_PAYLOAD_REJECTED` the
 *     EF answers with. The banner is the newsletter's, one folder over, and it prints
 *     `e.message`.
 *  4. HIGH PRIORITY WAS ON BY DEFAULT and its card came FIRST. Firebase's own documentation
 *     ("Set and manage Android message priority") says to keep high priority for messages
 *     that result in user interaction and to use normal delivery for the rest, and it
 *     deprioritises an app instance that does not honour that — a penalty the daily push
 *     pays too. Default is `false`, and the card is a closed `<details>` after the content.
 *  5. THE PREVIEW LIED ABOUT THE CUT. It wrapped freely while iOS collapses to ~1 line of
 *     title and ~2 of body — where the call to action usually is. `line-clamp` plus a note
 *     that says the cut is real, and `CharCount` on both fields.
 *  6. ONE LANGUAGE FOR A FIVE-LANGUAGE APP (BR-IDIOMA-001 item 3). The composer holds one
 *     title/body per language and hands the Edge Function a `localized` map; the function is
 *     what fans a broadcast out into one narrowed pass per language, and logs a row per pass.
 *     Scheduling is per-language ROWS instead — see `handleSend`.
 */

import { useState, useEffect, useId, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { CharCount } from '@/components/ui/CharCount';
import { Bell, Send, Layout, History, Sparkles, Clock, Eye, User, Search, CheckCircle2, Zap, AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { AudienceFilter } from '../shared/AudienceFilter';
import { TemplateManager } from './TemplateManager';
import { NotificationHistory } from './NotificationHistory';
import { SendConfirmDialog } from './SendConfirmDialog';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import {
  NotificationService,
  PUSH_LANGUAGES,
  toCampaignType,
  type AudienceFilters,
  type PushContentByLanguage,
  type PushLanguage,
} from '@/lib/services/notification-service';
import { dashboardService } from '@/lib/services/dashboard-service';

/**
 * WHAT THE DEVICE ACTUALLY SHOWS, and the reason the counters are these numbers.
 *
 * iOS collapses a banner to one line of title and two of body; Android's collapsed
 * notification is the same shape. These are the point where the text starts being hidden,
 * not a maximum — `CharCount` never blocks (see the component).
 */
const TITLE_SOFT_LIMIT = 40;
const BODY_SOFT_LIMIT = 110;

const emptyContent = () => ({ title: '', body: '' });

export function NotificationManager() {
  const t = useTranslations('Pages.Notifications');
  const tAudience = useTranslations('Pages.Marketing.Audience');
  const locale = useLocale();

  const [activeTab, setActiveTab] = useState('broadcast');
  const [contentByLang, setContentByLang] = useState<PushContentByLanguage>({ pt: emptyContent() });
  const [defaultLang, setDefaultLang] = useState<PushLanguage>('pt');
  const [activeLang, setActiveLang] = useState<PushLanguage>('pt');
  const [campaignType, setCampaignType] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [badge, setBadge] = useState<number | undefined>(undefined);
  const [deepLink, setDeepLink] = useState('');
  const [isHighPriority, setIsHighPriority] = useState(false);
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [scheduleAt, setScheduleAt] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Direct Push State
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const { canEdit } = useCmsUser();

  const priorityId = useId();
  const campaignTypeId = useId();
  const titleFieldId = useId();
  const bodyFieldId = useId();
  const imageFieldId = useId();
  const badgeFieldId = useId();
  const deepLinkId = useId();
  const scheduleId = useId();
  const defaultLangId = useId();
  const activeLangId = useId();

  const isDirect = activeTab === 'direct';
  const active = contentByLang[activeLang] || emptyContent();

  const setActiveField = (field: 'title' | 'body', value: string) => {
    setContentByLang((prev) => ({
      ...prev,
      [activeLang]: { ...(prev[activeLang] || emptyContent()), [field]: value },
    }));
  };

  /** A language counts as composed only when BOTH halves exist — a push with no body is not a push. */
  const filledLanguages = useMemo(
    () =>
      PUSH_LANGUAGES.filter(
        (l) => (contentByLang[l]?.title || '').trim() && (contentByLang[l]?.body || '').trim()
      ),
    [contentByLang]
  );

  /**
   * A broadcast fans out one send per composed language. When the operator ALSO picked a
   * language in the audience filter, that pick wins — narrowing an audience is what the
   * filter is for, and sending Italian to a Portuguese-only segment would ignore it.
   */
  const targetLanguages = useMemo(() => {
    if (isDirect) return filledLanguages.filter((l) => l === defaultLang);
    const picked = filters.language as PushLanguage | undefined;
    return picked ? filledLanguages.filter((l) => l === picked) : filledLanguages;
  }, [filledLanguages, filters.language, isDirect, defaultLang]);

  const normalizedType = toCampaignType(campaignType);
  const canOpenConfirm =
    canEdit &&
    !isSending &&
    normalizedType.length > 0 &&
    targetLanguages.length > 0 &&
    (!isDirect || selectedUsers.length > 0);

  // Load users for Direct Push. A busca vai ao banco: a lista sem termo traz só
  // os logins mais recentes, e filtrar no cliente escondia quem está fora dela.
  useEffect(() => {
    if (!isDirect) return;
    let cancelled = false;
    const fetchUsers = async () => {
      setIsLoadingUsers(true);
      try {
        const result = await dashboardService.searchProfiles(userSearch, 50);
        if (!cancelled && result.success) setUsers(result.data || []);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setIsLoadingUsers(false);
      }
    };
    const timer = setTimeout(fetchUsers, userSearch ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isDirect, userSearch]);

  const toggleUserSelection = (user: any) => {
    setSelectedUsers((prev) =>
      prev.find((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]
    );
  };

  /**
   * The single-language shape the Edge Function has always accepted. `localized` rides beside
   * it for a broadcast; a direct push is one message, so it is this and nothing else.
   */
  const notificationFor = (lang: PushLanguage) => {
    const content = contentByLang[lang] || emptyContent();
    return {
      title: content.title,
      body: content.body,
      imageUrl: imageUrl || undefined,
      badge,
      data: {
        /**
         * THE KEY THAT MAKES THE CAMPAIGN MEASURABLE — `docs/contracts/notificacoes.md` §2.3.
         * The Edge Function writes `data.type ?? 'generic'` into the inbox row and the app
         * reports the same literal as the GA4 `push_type`; without it every campaign is one
         * line. The language is NOT in here: a localized broadcast is one pass per language
         * and each pass logs its own `audience_filters.language`, which is where the report
         * tells the slices apart. A `data.lang` would be frozen at whatever the first pass
         * carried, because the function swaps title and body and leaves `data` alone.
         */
        type: normalizedType,
        ...(deepLink ? { url: deepLink } : {}),
      },
    };
  };

  /** `{ pt: {title, body}, en: {...} }` — the map the Edge Function fans out over. */
  const localizedMap = () =>
    Object.fromEntries(
      targetLanguages.map((lang) => {
        const content = contentByLang[lang] || emptyContent();
        return [lang, { title: content.title, body: content.body }];
      })
    );

  const resetComposer = () => {
    setContentByLang({ pt: emptyContent() });
    setDefaultLang('pt');
    setActiveLang('pt');
    setCampaignType('');
    setImageUrl('');
    setBadge(undefined);
    setDeepLink('');
    setIsHighPriority(false);
    setScheduleAt('');
  };

  /**
   * Only ever reached from the confirmation dialog — the button opens the dialog, never this.
   *
   * WHO FANS OUT OVER LANGUAGES, AND WHY IT IS NOT THIS FILE. A broadcast carries ONE copy per
   * FCM message, so a mixed-language audience needs one narrowed pass per language. The Edge
   * Function does that from `localized` and logs a row per pass with that pass's own filters and
   * counts — which is what lets the history say what went where. Repeating the loop here would be
   * a second implementation of one decision (§6) and would log nothing.
   *
   * SCHEDULING IS THE EXCEPTION, and structurally so: `marketing.scheduled_notifications` holds
   * ONE title and ONE body per row, so a per-language campaign is per-language ROWS. That is also
   * the better queue — each language can be cancelled on its own.
   */
  const handleSend = async () => {
    setConfirmOpen(false);
    setIsSending(true);
    setBanner(null);

    const isScheduled = !!scheduleAt && !isDirect;

    try {
      if (isScheduled) {
        const failures: string[] = [];
        let ok = 0;
        for (const lang of targetLanguages) {
          try {
            await NotificationService.schedule({
              type: 'broadcast',
              notification: notificationFor(lang),
              filters: { ...filters, language: lang },
              priority: isHighPriority ? 'high' : 'normal',
              scheduleAt: new Date(scheduleAt).toISOString(),
            });
            ok += 1;
          } catch (e: any) {
            failures.push(`${lang}: ${e?.message || String(e)}`);
          }
        }
        if (failures.length) {
          setBanner({
            type: 'err',
            text: ok === 0
              ? failures.join(' · ')
              : t('messages.partial', { ok, total: targetLanguages.length, errors: failures.join(' · ') }),
          });
        } else {
          setBanner({ type: 'ok', text: t('messages.scheduled') });
          resetComposer();
        }
        return;
      }

      if (isDirect) {
        const response = await NotificationService.sendImmediate({
          type: 'user',
          notification: notificationFor(defaultLang),
          userIds: selectedUsers.map((u) => u.id),
          priority: isHighPriority ? 'high' : 'normal',
        });
        const accepted = response?.result?.success ?? 0;
        const rejected = response?.result?.failure ?? 0;
        if (accepted === 0 && rejected === 0) {
          setBanner({ type: 'err', text: t('messages.no_tokens') });
        } else {
          setBanner({
            type: 'ok',
            text: t('messages.sent_direct', { count: selectedUsers.length, accepted, failed: rejected }),
          });
          setSelectedUsers([]);
        }
        return;
      }

      const response = await NotificationService.sendImmediate({
        type: 'broadcast',
        notification: notificationFor(targetLanguages[0]),
        localized: localizedMap(),
        // No `language` here on purpose: the function sets it per pass. Sending one would
        // narrow every pass to the same slice.
        filters,
        priority: isHighPriority ? 'high' : 'normal',
      });

      const passes: any[] = Array.isArray(response?.passes) ? response.passes : [];
      const accepted = passes.reduce((n, p) => n + (p.success ?? 0), 0);
      const rejected = passes.reduce((n, p) => n + (p.failure ?? 0), 0);
      const failed = passes.filter((p) => p.status === 'failed').map((p) => String(p.language));

      if (failed.length && failed.length === passes.length) {
        setBanner({ type: 'err', text: t('messages.partial', { ok: 0, total: passes.length, errors: failed.join(', ') }) });
      } else if (failed.length) {
        setBanner({
          type: 'err',
          text: t('messages.partial', {
            ok: passes.length - failed.length,
            total: passes.length,
            errors: failed.join(', '),
          }),
        });
      } else {
        setBanner({ type: 'ok', text: t('messages.sent_broadcast', { accepted, failed: rejected }) });
        resetComposer();
      }
    } catch (e: any) {
      // The Edge Function's own words — `FCM_PAYLOAD_REJECTED` and the message beside it.
      setBanner({ type: 'err', text: e?.message || String(e) });
    } finally {
      setIsSending(false);
    }
  };

  // A filtragem é feita no servidor (searchProfiles); selecionados ficam sempre
  // visíveis para não sumirem da lista ao trocar o termo de busca.
  const filteredUsers = [
    ...selectedUsers.filter((su) => !users.some((u) => u.id === su.id)),
    ...users,
  ];

  const tabs = [
    { id: 'broadcast', label: t('tabs.broadcast'), icon: Send },
    { id: 'direct', label: t('tabs.direct'), icon: User },
    { id: 'templates', label: t('tabs.templates'), icon: Layout },
    { id: 'history', label: t('tabs.history'), icon: History },
  ];

  const languageName = (l: PushLanguage) => tAudience(`language.${l}`);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3 tracking-tight">
            <div className="p-2 bg-tuggi-blue/10 rounded-xl">
              <Bell className="h-8 w-8 text-tuggi-blue" />
            </div>
            {t('title')}
          </h1>
          <p className="text-gray-500 mt-1 font-medium">{t('subtitle')}</p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800/50 p-1.5 rounded-2xl w-fit border border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl transition-all duration-300',
                activeTab === tab.id
                  ? 'bg-white dark:bg-gray-700 shadow-lg text-tuggi-blue scale-105'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
              )}
            >
              <Icon className={cn('h-4 w-4', activeTab === tab.id ? 'text-tuggi-blue' : 'text-gray-400')} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/*
        THE ERROR, IN THE PAGE, IN THE OPERATOR'S OWN WORDS TO COPY. Same band the newsletter
        uses one folder over. `alert()` is gone from this screen.
      */}
      {banner && (
        <div
          role={banner.type === 'err' ? 'alert' : 'status'}
          className={cn(
            'rounded-xl px-4 py-3 text-sm font-medium break-words',
            banner.type === 'ok'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          )}
        >
          {banner.text}
        </div>
      )}

      <div className="mt-2 text-gray-900 dark:text-gray-100">
        {(activeTab === 'broadcast' || activeTab === 'direct') && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-bottom-4 duration-500">
            {/* Left Column: Compose */}
            <div className="lg:col-span-2 space-y-6">

              {/* User Selector for Direct Push */}
              {isDirect && (
                <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-purple">
                  <CardHeader className="pb-4">
                    <CardTitle as="h2" className="text-lg font-bold flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Search className="h-5 w-5 text-tuggi-purple" />
                        {t('direct.title')}
                      </div>
                      {selectedUsers.length > 0 && (
                        <div className="px-3 py-1 bg-tuggi-purple text-white text-[10px] rounded-full font-bold animate-in zoom-in">
                          {selectedUsers.length} {t('direct.selected')}
                        </div>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder={t('direct.search_placeholder')}
                        aria-label={t('direct.search_placeholder')}
                        className="pl-10 rounded-xl"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {isLoadingUsers
                        ? [1, 2, 3, 4].map((i) => (
                            <div key={i} className="h-16 bg-gray-50 dark:bg-gray-800 animate-pulse rounded-xl" />
                          ))
                        : filteredUsers.map((user) => {
                            const isSelected = selectedUsers.some((u) => u.id === user.id);
                            return (
                              <button
                                key={user.id}
                                onClick={() => toggleUserSelection(user)}
                                aria-pressed={isSelected}
                                className={cn(
                                  'flex items-center gap-3 p-3 rounded-xl border transition-all text-left group',
                                  isSelected
                                    ? 'bg-tuggi-purple/10 border-tuggi-purple shadow-sm'
                                    : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 hover:border-tuggi-purple/30'
                                )}
                              >
                                <div
                                  className={cn(
                                    'h-10 w-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm transition-transform group-hover:scale-110',
                                    isSelected ? 'bg-tuggi-purple' : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                                  )}
                                >
                                  {(user.nickname || user.full_name || '?')[0].toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-sm truncate">{user.nickname || user.full_name || '—'}</p>
                                  <p className="text-[10px] text-gray-400 truncate uppercase tracking-tighter">
                                    {user.last_platform || '—'} • {user.language || '---'}
                                  </p>
                                </div>
                                {isSelected && <CheckCircle2 className="h-5 w-5 text-tuggi-purple shrink-0" />}
                              </button>
                            );
                          })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* CONTENT FIRST. The advanced card used to sit above this one, which put deep
                  link and badge in front of the work. */}
              <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden border-t-4 border-t-tuggi-blue">
                <CardHeader className="pb-4">
                  <CardTitle as="h2" className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
                    <Sparkles className="h-5 w-5 text-tuggi-blue" />
                    {t('content.title')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-2">
                    <Label htmlFor={campaignTypeId} className="font-bold text-gray-700 dark:text-gray-300">
                      {t('content.campaign_type_label')}
                    </Label>
                    <Input
                      id={campaignTypeId}
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                      value={campaignType}
                      onChange={(e) => setCampaignType(e.target.value)}
                      placeholder={t('content.campaign_type_placeholder')}
                    />
                    <p className="text-xs text-gray-500">
                      {t('content.campaign_type_hint')}
                      {normalizedType && normalizedType !== campaignType && (
                        <span className="ml-1 font-bold text-tuggi-blue">→ {normalizedType}</span>
                      )}
                    </p>
                  </div>

                  {/* The five languages of the app's interface (BR-IDIOMA-001 item 3). */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor={defaultLangId} className="font-bold text-gray-700 dark:text-gray-300">
                        {t('content.default_language')}
                      </Label>
                      <Select
                        id={defaultLangId}
                        value={defaultLang}
                        onValueChange={(v) => {
                          setDefaultLang(v as PushLanguage);
                          setActiveLang(v as PushLanguage);
                        }}
                      >
                        {PUSH_LANGUAGES.map((l) => (
                          <SelectItem key={l} value={l}>
                            {languageName(l)}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={activeLangId} className="font-bold text-gray-700 dark:text-gray-300">
                        {t('content.editing_language')}
                      </Label>
                      <Select
                        id={activeLangId}
                        value={activeLang}
                        onValueChange={(v) => setActiveLang(v as PushLanguage)}
                      >
                        {PUSH_LANGUAGES.map((l) => (
                          <SelectItem key={l} value={l}>
                            {`${languageName(l)} — ${
                              filledLanguages.includes(l) ? t('content.language_filled') : t('content.language_empty')
                            }`}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">{t('content.default_language_hint')}</p>

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={titleFieldId} className="font-bold text-gray-700 dark:text-gray-300">
                        {t('content.label_title')}
                      </Label>
                      <CharCount value={active.title} max={TITLE_SOFT_LIMIT} />
                    </div>
                    <Input
                      id={titleFieldId}
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                      value={active.title}
                      onChange={(e) => setActiveField('title', e.target.value)}
                      placeholder={t('content.placeholder_title')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={bodyFieldId} className="font-bold text-gray-700 dark:text-gray-300">
                        {t('content.label_body')}
                      </Label>
                      <CharCount value={active.body} max={BODY_SOFT_LIMIT} />
                    </div>
                    <Textarea
                      id={bodyFieldId}
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue min-h-[120px]"
                      value={active.body}
                      onChange={(e) => setActiveField('body', e.target.value)}
                      placeholder={t('content.placeholder_body')}
                    />
                  </div>
                </CardContent>
              </Card>

              {!isDirect && (
                <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-orange">
                  <CardHeader className="pb-4">
                    <CardTitle as="h2" className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
                      <Clock className="h-5 w-5 text-tuggi-orange" />
                      {t('scheduling.title')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                      <div className="grid gap-2 w-full md:w-auto">
                        <Label htmlFor={scheduleId} className="font-bold text-gray-700 dark:text-gray-300">
                          {t('scheduling.label_date')}
                        </Label>
                        <Input
                          id={scheduleId}
                          type="datetime-local"
                          className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-orange focus:border-tuggi-orange w-full"
                          value={scheduleAt}
                          onChange={(e) => setScheduleAt(e.target.value)}
                        />
                        <p className="text-xs text-gray-400">
                          {t('scheduling.tz_hint', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                        </p>
                      </div>
                      <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700 flex-1 w-full">
                        <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                          <span className={cn('ml-1', scheduleAt ? 'text-tuggi-orange' : 'text-tuggi-green')}>
                            {scheduleAt
                              ? t('scheduling.status_scheduled') + new Date(scheduleAt).toLocaleString(locale)
                              : t('scheduling.status_immediate')}
                          </span>
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/*
                ADVANCED, AFTER THE WORK AND CLOSED. Deep link, badge and priority are the
                exception, not the beginning — and priority in particular is a setting that
                costs the whole app when it is used as a default.
              */}
              <details className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                <summary className="cursor-pointer list-none px-6 py-4 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-gray-100">
                  <Zap className="h-5 w-5 text-tuggi-blue" />
                  {t('advanced.title')}
                  <span className="ml-2 text-xs font-normal text-gray-400">{t('advanced.hint')}</span>
                </summary>
                <div className="px-6 pb-6 space-y-6">
                  <div className="grid gap-2">
                    <Label htmlFor={deepLinkId} className="font-bold text-gray-700 dark:text-gray-300">
                      {t('advanced.label_link')}
                    </Label>
                    <Input
                      id={deepLinkId}
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                      value={deepLink}
                      onChange={(e) => setDeepLink(e.target.value)}
                      placeholder={t('advanced.placeholder_link')}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor={imageFieldId} className="font-bold text-gray-700 dark:text-gray-300">
                        {t('content.label_image')}
                      </Label>
                      <Input
                        id={imageFieldId}
                        className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="https://example.com/image.png"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={badgeFieldId} className="font-bold text-gray-700 dark:text-gray-300">
                        {t('content.label_badge')}
                      </Label>
                      <Input
                        id={badgeFieldId}
                        type="number"
                        className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                        value={badge !== undefined ? badge : ''}
                        onChange={(e) => setBadge(e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
                        placeholder={t('content.placeholder_badge')}
                        min="0"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                    <div className="space-y-0.5 pr-4">
                      {/*
                        `htmlFor` + `id`, and that pair IS the accessible name: `Checkbox` is a
                        Radix `<button role="checkbox">` with no text inside it, so axe-core
                        reported `button-name` (critical) here.
                      */}
                      <Label htmlFor={priorityId} className="font-bold text-gray-700 dark:text-gray-300">
                        {t('advanced.label_priority')}
                      </Label>
                      <p className="text-sm text-gray-500">{t('advanced.priority_hint')}</p>
                    </div>
                    <Checkbox
                      id={priorityId}
                      checked={isHighPriority}
                      onCheckedChange={(checked) => setIsHighPriority(!!checked)}
                      className="h-6 w-6 rounded-md border-gray-300 text-tuggi-blue focus:ring-tuggi-blue shrink-0"
                    />
                  </div>
                </div>
              </details>
            </div>

            {/* Right Column */}
            <div className="space-y-8">
              {!isDirect ? (
                <AudienceFilter
                  filters={filters}
                  onChange={setFilters}
                  baseLabel={tAudience('pushBase')}
                />
              ) : (
                <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-purple overflow-hidden">
                  <CardHeader>
                    <CardTitle as="h2" className="text-lg font-bold flex items-center gap-2">
                      <User className="h-5 w-5 text-tuggi-purple" />
                      {t('direct.target_summary')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        {t('direct.recipients_label')}
                      </p>
                      {selectedUsers.length > 0 ? (
                        <div className="space-y-3">
                          {selectedUsers.slice(0, 3).map((user) => (
                            <div key={user.id} className="flex items-center gap-3">
                              <div className="h-8 w-8 bg-tuggi-purple rounded-lg flex items-center justify-center text-white font-bold text-xs">
                                {(user.nickname || user.full_name || '?')[0].toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-gray-900 dark:text-white leading-none text-sm">
                                  {user.nickname || user.full_name}
                                </p>
                              </div>
                            </div>
                          ))}
                          {selectedUsers.length > 3 && (
                            <p className="text-xs font-bold text-gray-400 pl-11">
                              {t('direct.more_clients', { count: selectedUsers.length - 3 })}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm font-bold text-gray-400 italic">{t('direct.no_clients')}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase px-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-tuggi-purple animate-pulse" />
                      {t('direct.bypass_hint')}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-lg border-t-4 border-t-tuggi-green">
                <CardHeader className="pb-2">
                  <CardTitle as="h2" className="text-lg font-bold flex items-center gap-2">
                    <Eye className="h-5 w-5 text-tuggi-green" />
                    {t('preview.title')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="border border-gray-100 dark:border-gray-800 rounded-3xl p-5 bg-white dark:bg-gray-950 shadow-inner">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-10 w-10 bg-tuggi-blue rounded-xl flex items-center justify-center text-white font-bold text-xl">
                        T
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('preview.app_name')}</p>
                        <p className="text-[10px] text-gray-400 uppercase">{t('preview.now')}</p>
                      </div>
                    </div>
                    {/*
                      THE CUT IS THE POINT. A free-wrapping preview showed a call to action the
                      phone hides — `line-clamp-1` / `line-clamp-2` is what the tray does.
                    */}
                    <div className="space-y-2">
                      <p
                        data-testid="preview-title"
                        className="font-bold text-gray-900 dark:text-white text-base leading-tight line-clamp-1"
                      >
                        {active.title || t('preview.placeholder_title')}
                      </p>
                      <p
                        data-testid="preview-body"
                        className="text-sm text-gray-600 dark:text-gray-400 leading-snug line-clamp-2"
                      >
                        {active.body || t('preview.placeholder_body')}
                      </p>
                    </div>
                    {imageUrl && (
                      <div className="mt-4 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800">
                        <img src={imageUrl} alt="" className="w-full h-40 object-cover bg-gray-100" />
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-tuggi-orange shrink-0 mt-0.5" />
                    <span>
                      {t('preview.truncated')} {t('preview.language_note', { lang: languageName(activeLang) })}
                    </span>
                  </p>

                  {canEdit && (
                    <Button
                      size="lg"
                      className={cn(
                        'w-full rounded-2xl font-bold text-lg py-6 shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]',
                        isDirect
                          ? 'bg-tuggi-purple hover:bg-purple-600'
                          : scheduleAt
                            ? 'bg-tuggi-orange hover:bg-orange-600'
                            : 'bg-tuggi-blue hover:bg-blue-600'
                      )}
                      onClick={() => setConfirmOpen(true)}
                      disabled={!canOpenConfirm}
                    >
                      {isSending ? (
                        <div className="flex items-center gap-2">
                          <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          {t('actions.sending')}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Send className="h-5 w-5" />
                          {isDirect
                            ? t('actions.send_direct')
                            : scheduleAt
                              ? t('actions.schedule')
                              : t('actions.send_now')}
                        </div>
                      )}
                    </Button>
                  )}
                  {!normalizedType && canEdit && (
                    <p className="text-xs text-amber-600 text-center">{t('content.campaign_type_required')}</p>
                  )}
                  <p className="text-[10px] text-center text-gray-400 uppercase tracking-widest font-bold">
                    {t('actions.footer')}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <TemplateManager
              onLoadTemplate={(tpl) => {
                setContentByLang((prev) => ({
                  ...prev,
                  [defaultLang]: { title: tpl.title, body: tpl.body },
                }));
                setActiveLang(defaultLang);
                setImageUrl(tpl.image_url || '');
                setActiveTab('broadcast');
              }}
            />
          </div>
        )}

        {activeTab === 'history' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <NotificationHistory />
          </div>
        )}
      </div>

      <SendConfirmDialog
        open={confirmOpen}
        isDirect={isDirect}
        isScheduled={!!scheduleAt && !isDirect}
        scheduleAt={scheduleAt}
        directCount={selectedUsers.length}
        filters={filters}
        targetLanguages={targetLanguages}
        contentByLang={contentByLang}
        campaignType={normalizedType}
        highPriority={isHighPriority}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleSend}
      />
    </div>
  );
}
