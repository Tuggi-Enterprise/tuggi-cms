'use client';

/**
 * THE NEWSLETTER COMPOSER.
 *
 * What changed here, and each one is a way the screen used to lose work or spend the base:
 *
 *  · NOTHING LEAVES WITHOUT A CONFIRMATION. `disabled={!canEdit || busy !== null}` was the whole
 *    guard: an empty subject, zero blocks and `audience_filters: {}` fired at the whole base.
 *    `SendConfirmDialog` is now between the button and the Edge Function, for `send` and for
 *    `schedule` alike.
 *
 *  · A SECOND CLICK NO LONGER CREATES A SECOND CAMPAIGN. `persist()` called `createCampaign`
 *    every time, so scheduling twice meant two campaigns and a base that receives twice. The id
 *    is held now: create once, `updateCampaign` after that.
 *
 *  · A SENT CAMPAIGN IS NOT AN EDITABLE DRAFT. `sending`/`sent` locks the composer and offers
 *    `Duplicate`, because editing what already went out changes the record of what went out.
 *
 *  · AUTOMATIC TRANSLATION IS MARKED. `handleTranslate` replaced four languages at once with no
 *    diff and no trace; the tabs it wrote are flagged unreviewed until somebody edits them, and
 *    the confirmation dialog lists them. It warns, it does not block.
 *
 * TODO(#marketing-correcoes): DS-COPY-013 (the AI-tic copy ruler) is NOT enforced here. The rule
 * exists as code in the team — `copy-ruler`, in `tests/e2e/support/copy-ruler.ts` — but that file
 * is not in this repository (searched 2026-09-10). Writing a second implementation of one rule is
 * the defect CLAUDE.md §6 names, so this composer does not measure copy. Porting the module here
 * is a card of its own, and its owner is the `design`.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { CharCount } from '@/components/ui/CharCount';
import { Mail, Languages, Send, Clock, Eye, Pencil, History, Loader2, Save, Copy, Lock, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import { AudienceFilter, type AudienceEstimateState } from '@/components/marketing/shared/AudienceFilter';
import { NewsletterService } from '@/lib/services/newsletter-service';
import type { AudienceFilters } from '@/lib/services/marketing/audience-types';
import {
  NEWSLETTER_LANGUAGES,
  type NewsletterContent,
  type NewsletterContentByLanguage,
  type NewsletterLanguage,
  type NewsletterStatus,
} from '@/types/newsletter';
import { NewsletterPreview } from './NewsletterPreview';
import { NewsletterHistory } from './NewsletterHistory';
import { BlockEditor } from './BlockEditor';
import { SendConfirmDialog } from './SendConfirmDialog';

type Tab = 'compose' | 'preview' | 'history';

const emptyContent = (): NewsletterContent => ({
  subject: '',
  preheader: '',
  blocks: [],
});

/** A language "has content" when the e-mail would not arrive blank in it. */
const hasContent = (content: NewsletterContent | undefined) =>
  Boolean(content && ((content.subject && content.subject.trim()) || (content.blocks && content.blocks.length > 0)));

export function NewsletterManager() {
  const t = useTranslations('Pages.Marketing.Newsletter');
  const tAudience = useTranslations('Pages.Marketing.Audience');
  const { canEdit } = useCmsUser();

  const [tab, setTab] = useState<Tab>('compose');
  const [name, setName] = useState('');
  const [defaultLang, setDefaultLang] = useState<NewsletterLanguage>('pt');
  const [activeLang, setActiveLang] = useState<NewsletterLanguage>('pt');
  const [contentByLang, setContentByLang] = useState<NewsletterContentByLanguage>({ pt: emptyContent() });
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [scheduleAt, setScheduleAt] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  /**
   * THE ID OF THE CAMPAIGN BEING EDITED. A ref and not state, because nothing in the render
   * depends on it and `persist()` does: two clicks inside one React batch would both read a
   * stale `null` from state and both create a campaign — which is the exact defect this holds
   * shut. Reschedule and resend now UPDATE the campaign that already exists.
   */
  const campaignIdRef = useRef<string | null>(null);
  const [campaignStatus, setCampaignStatus] = useState<NewsletterStatus>('draft');

  /** Languages `handleTranslate` wrote and nobody has edited since. */
  const [autoTranslated, setAutoTranslated] = useState<NewsletterLanguage[]>([]);

  const [audience, setAudience] = useState<AudienceEstimateState>({ estimate: null, loading: true, error: null });
  const [confirm, setConfirm] = useState<{ mode: 'send' | 'schedule'; fallbackCount: number | null } | null>(null);

  const defaultLangId = useId();
  const activeLangId = useId();
  const scheduleId = useId();
  const nameId = useId();
  const subjectId = useId();
  const preheaderId = useId();
  const composeHeadingId = useId();
  const deliveryHeadingId = useId();

  const active = contentByLang[activeLang] || emptyContent();
  const locked = campaignStatus === 'sending' || campaignStatus === 'sent';

  /** The base-language content is what every fallback recipient gets; without it there is no e-mail. */
  const baseContent = contentByLang[defaultLang];
  const contentReady = Boolean(
    baseContent?.subject?.trim() && baseContent.blocks && baseContent.blocks.length > 0
  );
  const audienceReady = audience.error === null && audience.estimate !== null && audience.estimate > 0;

  const setActiveField = (field: keyof NewsletterContent, value: any) => {
    setContentByLang((prev) => ({
      ...prev,
      [activeLang]: { ...(prev[activeLang] || emptyContent()), [field]: value },
    }));
    // Editing IS the review. The badge exists to say "no human read this", and a human just did.
    setAutoTranslated((prev) => prev.filter((l) => l !== activeLang));
  };

  const onEstimateChange = useCallback((state: AudienceEstimateState) => setAudience(state), []);

  const handleTranslate = async () => {
    const source = contentByLang[defaultLang];
    if (!source) return;
    setBusy('translate');
    setMessage(null);
    try {
      const targets = NEWSLETTER_LANGUAGES.filter((l) => l !== defaultLang);
      const translations = await NewsletterService.translate(source, targets);
      setContentByLang((prev) => ({ ...prev, [defaultLang]: source, ...translations }));
      setAutoTranslated(Object.keys(translations) as NewsletterLanguage[]);
      setMessage({ type: 'ok', text: t('messages.translated') });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const persist = async () => {
    const input = {
      name: name || t('untitled'),
      default_language: defaultLang,
      content: contentByLang,
      audience_filters: filters,
    };
    const existing = campaignIdRef.current;
    if (existing) return NewsletterService.updateCampaign(existing, input);

    const created = await NewsletterService.createCampaign(input);
    campaignIdRef.current = created.id;
    return created;
  };

  const handleSaveDraft = async () => {
    setBusy('draft');
    setMessage(null);
    try {
      await persist();
      setMessage({ type: 'ok', text: t('messages.draftSaved') });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  /**
   * How many recipients have no content in their own language.
   *
   * It is EXACT and not an estimate of an estimate: the language filter matches by 2-letter
   * prefix and the prefixes are disjoint, so the people covered by the languages that do have
   * content, subtracted from the total, is precisely the set that falls back to
   * `default_language`. Costs one RPC per written language, once, when the dialog opens.
   *
   * `null` means it could not be measured, and the dialog then says the generic sentence instead
   * of inventing a number.
   */
  const computeFallbackCount = async (total: number | null): Promise<number | null> => {
    if (total === null) return null;
    const written = NEWSLETTER_LANGUAGES.filter((l) => hasContent(contentByLang[l]));
    if (written.length === 0) return total;
    // A language filter already narrows the audience to one language: no RPC can say more.
    if (filters.language) {
      return written.some((l) => filters.language === l) ? 0 : total;
    }
    try {
      const counts = await Promise.all(
        written.map((l) => NewsletterService.estimateAudience({ ...filters, language: l }))
      );
      return Math.max(0, total - counts.reduce((sum, n) => sum + n, 0));
    } catch {
      return null;
    }
  };

  const openConfirm = async (mode: 'send' | 'schedule') => {
    setMessage(null);
    setConfirm({ mode, fallbackCount: null });
    const fallbackCount = await computeFallbackCount(audience.estimate);
    setConfirm((prev) => (prev && prev.mode === mode ? { ...prev, fallbackCount } : prev));
  };

  const handleSend = async () => {
    setBusy('send');
    setMessage(null);
    try {
      const campaign = await persist();
      const res = await NewsletterService.send(campaign.id);
      setCampaignStatus('sending');
      setConfirm(null);
      setMessage({ type: 'ok', text: t('messages.sent', { count: res.sent ?? 0 }) });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleSendTest = async () => {
    if (!testEmail) return;
    setBusy('test');
    setMessage(null);
    try {
      await NewsletterService.sendTest(active, testEmail, activeLang);
      setMessage({ type: 'ok', text: t('messages.testSent', { email: testEmail }) });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleAt) return;
    setBusy('schedule');
    setMessage(null);
    try {
      const campaign = await persist();
      await NewsletterService.schedule(campaign.id, new Date(scheduleAt).toISOString());
      setCampaignStatus('scheduled');
      setConfirm(null);
      setMessage({ type: 'ok', text: t('messages.scheduled') });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  /** Start a new draft from this content. The id is what is dropped, not the work. */
  const handleDuplicate = () => {
    campaignIdRef.current = null;
    setCampaignStatus('draft');
    setMessage(null);
  };

  const tabs: { id: Tab; label: string; icon: typeof Mail }[] = [
    { id: 'compose', label: t('tabs.compose'), icon: Pencil },
    { id: 'preview', label: t('tabs.preview'), icon: Eye },
    { id: 'history', label: t('tabs.history'), icon: History },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3 tracking-tight">
          <div className="p-2 bg-tuggi-blue/10 rounded-xl">
            <Mail className="h-8 w-8 text-tuggi-blue" />
          </div>
          {t('title')}
        </h1>
        <p className="text-gray-500 mt-1 font-medium">{t('subtitle')}</p>
      </div>

      {/* Tabs (estilo pílula, consistente com Push) */}
      <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800/50 p-1.5 rounded-2xl w-fit border border-gray-200 dark:border-gray-700">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={cn(
                'flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl transition-all duration-300',
                tab === tb.id
                  ? 'bg-white dark:bg-gray-700 shadow-lg text-tuggi-blue scale-105'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
              )}
            >
              <Icon className={cn('h-4 w-4', tab === tb.id ? 'text-tuggi-blue' : 'text-gray-400')} />
              {tb.label}
            </button>
          );
        })}
      </div>

      {message && (
        <div
          role={message.type === 'err' ? 'alert' : 'status'}
          className={cn(
            'rounded-lg px-4 py-3 text-sm',
            message.type === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          )}
        >
          {message.text}
        </div>
      )}

      {tab === 'compose' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/*
            THE TWO `h2`s BELOW ARE WHAT MAKES THE OUTLINE LEGAL. The page's `h1` jumped straight
            to the `h3` every `CardTitle` renders — `heading-order`, a `critical` in axe, and for
            a screen-reader user the reason the outline of this screen has a hole in it. They are
            `sr-only` because the card titles already say the same thing on screen; what was
            missing was the level, not the words.

            `CardTitle` renders a hardcoded `<h3>` (`components/ui/card.tsx`) with no `as` prop,
            so the level cannot be set at the card. Giving it one is a change to a shared UI
            primitive that this branch does not own.
          */}
          <section aria-labelledby={composeHeadingId} className="lg:col-span-2 space-y-4">
            <h2 id={composeHeadingId} className="sr-only">{t('sections.content')}</h2>

            {locked && (
              <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                <Lock className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{t('locked.title')}</p>
                  <p className="text-xs">{t('locked.body')}</p>
                </div>
                <Button variant="outline" onClick={handleDuplicate}>
                  <Copy size={16} />
                  <span className="ml-2">{t('locked.duplicate')}</span>
                </Button>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail size={18} /> {t('compose.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* `fieldset` because the lock is one decision over the whole form, and a
                    `disabled` on each control is that decision copied nine times. */}
                <fieldset disabled={locked} className="space-y-4 border-0 p-0">
                  <legend className="sr-only">{t('sections.content')}</legend>
                  <div>
                    <Label htmlFor={nameId}>{t('compose.name')}</Label>
                    <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('compose.namePlaceholder')} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor={defaultLangId}>{t('compose.defaultLanguage')}</Label>
                      <Select
                        id={defaultLangId}
                        value={defaultLang}
                        onChange={(e: any) => { setDefaultLang(e.target.value); setActiveLang(e.target.value); }}
                      >
                        {NEWSLETTER_LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={activeLangId}>{t('compose.editingLanguage')}</Label>
                      <Select id={activeLangId} value={activeLang} onChange={(e: any) => setActiveLang(e.target.value)}>
                        {NEWSLETTER_LANGUAGES.map((l) => (
                          <SelectItem key={l} value={l}>
                            {autoTranslated.includes(l) ? `${l.toUpperCase()} · ${t('compose.autoTranslatedBadge')}` : l.toUpperCase()}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  </div>

                  {autoTranslated.includes(activeLang) && (
                    <p role="status" className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {t('compose.autoTranslated')}
                    </p>
                  )}

                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor={subjectId}>{t('compose.subject')}</Label>
                      <CharCount value={active.subject} max={50} />
                    </div>
                    <Input id={subjectId} value={active.subject || ''} onChange={(e) => setActiveField('subject', e.target.value)} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor={preheaderId}>{t('compose.preheader')}</Label>
                      <CharCount value={active.preheader} max={90} />
                    </div>
                    <Input id={preheaderId} value={active.preheader || ''} onChange={(e) => setActiveField('preheader', e.target.value)} placeholder={t('compose.preheaderPlaceholder')} />
                    <p className="text-xs text-gray-500 mt-1">{t('compose.preheaderHelp')}</p>
                  </div>
                  <p className="text-xs text-tuggi-blue bg-tuggi-blue/5 rounded-lg px-3 py-2">
                    {t('compose.tokensHint')}
                  </p>
                  <div>
                    <Label>{t('compose.content')}</Label>
                    <BlockEditor blocks={active.blocks || []} onChange={(blocks) => setActiveField('blocks', blocks)} />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={handleTranslate} disabled={busy !== null}>
                      {busy === 'translate' ? <Loader2 className="animate-spin" size={16} /> : <Languages size={16} />}
                      <span className="ml-2">{t('compose.translate')}</span>
                    </Button>
                    <Button variant="outline" onClick={handleSaveDraft} disabled={!canEdit || busy !== null}>
                      {busy === 'draft' ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                      <span className="ml-2">{t('compose.saveDraft')}</span>
                    </Button>
                  </div>
                </fieldset>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby={deliveryHeadingId} className="space-y-4">
            <h2 id={deliveryHeadingId} className="sr-only">{t('sections.delivery')}</h2>

            <AudienceFilter
              filters={filters}
              onChange={setFilters}
              estimateFn={NewsletterService.estimateAudience}
              baseLabel={tAudience('emailBase')}
              onEstimateChange={onEstimateChange}
            />

            <Card>
              <CardHeader>
                <CardTitle>{t('compose.deliver')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2 pb-3 border-b border-gray-100 dark:border-gray-800">
                  <Label htmlFor="newsletter-test-email">{t('compose.testEmail')}</Label>
                  <Input
                    id="newsletter-test-email"
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="voce@exemplo.com"
                  />
                  <Button variant="outline" className="w-full" onClick={handleSendTest} disabled={!testEmail || busy !== null}>
                    {busy === 'test' ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                    <span className="ml-2">{t('compose.sendTest')}</span>
                  </Button>
                </div>

                {!contentReady && <p className="text-xs text-gray-500">{t('compose.requiresSubject')}</p>}

                <Button
                  variant="cta"
                  className="w-full"
                  onClick={() => openConfirm('send')}
                  disabled={!canEdit || locked || busy !== null || !contentReady || !audienceReady}
                >
                  <Send size={16} />
                  <span className="ml-2">{t('compose.sendNow')}</span>
                </Button>

                <div className="space-y-2">
                  <Label htmlFor={scheduleId}>{t('compose.scheduleLabel')}</Label>
                  <Input id={scheduleId} type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                  <p className="text-xs text-gray-500">
                    {t('compose.scheduleTzHint', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => openConfirm('schedule')}
                    disabled={!canEdit || locked || !scheduleAt || busy !== null || !contentReady || !audienceReady}
                  >
                    <Clock size={16} />
                    <span className="ml-2">{t('compose.schedule')}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      )}

      {tab === 'preview' && <NewsletterPreview contentByLang={contentByLang} />}

      {tab === 'history' && <NewsletterHistory />}

      <SendConfirmDialog
        open={confirm !== null}
        mode={confirm?.mode ?? 'send'}
        campaignName={name || t('untitled')}
        subject={baseContent?.subject || ''}
        filters={filters}
        estimate={audience.estimate}
        estimateError={audience.error}
        defaultLanguage={defaultLang}
        fallbackCount={confirm?.fallbackCount ?? null}
        unreviewedLanguages={autoTranslated}
        scheduledFor={scheduleAt || undefined}
        busy={busy === 'send' || busy === 'schedule'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm?.mode === 'schedule' ? handleSchedule() : handleSend())}
      />
    </div>
  );
}
