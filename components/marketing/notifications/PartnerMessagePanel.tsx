'use client';

/**
 * THE PARTNER MESSAGE TAB of the push composer (#1264, BR-COMUNICACAO-026 items 4, 6 and 7).
 *
 * The partner asks, the curator writes the six fields in each language, approves or refuses with a
 * reason, schedules a wall-clock hour (9h to 20h in each person's zone), unschedules or cancels.
 * The list and the detail carry the exact numbers (6.e, 9). Every rule is the database's: this
 * panel shows the counters of the copy and turns each refusal into a sentence that says what to do
 * (`PartnerMessages.errors`). Routes: `app/api/admin/partner-messages`.
 *
 * Out of this slice: uploading the one e-mail image (7.g). The Edge Function sends it when a message
 * has `image_path`; the CMS does not write one yet.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, CalendarClock, Check, Plus, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CharCount } from '@/components/ui/CharCount';
import { cn } from '@/lib/utils';
import {
  ACTIONS_BY_STATUS,
  buttonNeedsRef,
  PARTNER_MESSAGE_BUTTON_KINDS,
  PARTNER_MESSAGE_FIELDS,
  PARTNER_MESSAGE_LANGS,
  PARTNER_MESSAGE_STATUSES,
  REASON_MAX,
  REQUESTED_BY_MAX,
  type PartnerMessage,
  type PartnerMessageAction,
  type PartnerMessageButtonKind,
  type PartnerMessageError,
  type PartnerMessageLang,
  type PartnerMessageNumbers,
  type PartnerMessageRow,
  type PartnerMessageSender,
  type PartnerMessageText,
} from '@/lib/partner-message/message';

type Notice = { ok: boolean; text: string };
type View = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'edit'; message: PartnerMessage | null };

const API = '/api/admin/partner-messages';
const NUMBER_KEYS: (keyof PartnerMessageNumbers)[] = [
  'reach', 'queued', 'capped', 'no_language', 'push_sent', 'push_failed',
  'email_sent', 'email_failed', 'opened', 'app_opened', 'email_clicked', 'opted_out_7d',
];

/** One sentence per refusal, saying what to do. */
function useErrorText() {
  const t = useTranslations('PartnerMessages');
  const tLang = useTranslations('Pages.Marketing.Audience.language');
  const tField = useTranslations('PartnerMessages.editor.fields');
  return useCallback(
    (error: PartnerMessageError | undefined): string => {
      if (!error) return t('errors.write_failed');
      if (error.code === 'invalid_field') {
        const rule = error.field?.rule ?? 'unknown';
        const known = ['length', 'push_marks', 'no_link', 'missing', 'image_alt', 'language', 'button', 'image_path', 'requested_by', 'texts', 'client_id'];
        const lang = error.field?.lang && (PARTNER_MESSAGE_LANGS as readonly string[]).includes(error.field.lang) ? tLang(error.field.lang) : (error.field?.lang ?? '');
        const key = error.field?.key;
        const field = key && PARTNER_MESSAGE_FIELDS.some((f) => f.key === key) ? tField(key) : (key ?? '');
        return t(`errors.field.${known.includes(rule) ? rule : 'unknown'}`, { lang, field });
      }
      if (error.code === 'wrong_state') {
        const state = error.state && (PARTNER_MESSAGE_STATUSES as readonly string[]).includes(error.state) ? t(`status.${error.state}`) : (error.state ?? '');
        return t('errors.wrong_state', { state });
      }
      if (error.code === 'monthly_cap') return error.cap ? t('errors.monthly_cap', { cap: error.cap }) : t('errors.monthly_cap_plain');
      return t(`errors.${error.code}`);
    },
    [t, tLang, tField]
  );
}

async function call(path: string, init?: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, init);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: { code: 'read_failed' } } };
  }
}

/** A wall clock `2026-12-01T10:00:00` as written, in the reader's locale, without any zone shift. */
function wallClock(value: string | null, locale: string): string {
  if (!value) return '';
  const [d, time = ''] = value.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, day, hh, mm)));
}

function instant(value: string | null, locale: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/** `datetime-local` value of an instant, in the browser's zone. */
function toLocalInput(value: string | null): string {
  const date = value ? new Date(value) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const statusTone: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  approved: 'bg-blue-50 text-blue-700',
  scheduled: 'bg-amber-50 text-amber-800',
  sent: 'bg-green-50 text-green-700',
  refused: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

export function PartnerMessagePanel() {
  const t = useTranslations('PartnerMessages');
  const locale = useLocale();
  const errorText = useErrorText();
  const [senders, setSenders] = useState<PartnerMessageSender[]>([]);
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [rows, setRows] = useState<PartnerMessageRow[] | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadSenders = useCallback(async () => {
    const { ok, data } = await call(`${API}/senders`);
    if (ok) setSenders((data.senders as PartnerMessageSender[]) ?? []);
    else setNotice({ ok: false, text: errorText(data.error as PartnerMessageError) });
  }, [errorText]);

  const loadRows = useCallback(async () => {
    const q = new URLSearchParams();
    if (clientFilter) q.set('client_id', clientFilter);
    if (statusFilter) q.set('status', statusFilter);
    const { ok, data } = await call(`${API}${q.size ? `?${q.toString()}` : ''}`);
    if (ok) setRows((data.messages as PartnerMessageRow[]) ?? []);
    else setNotice({ ok: false, text: errorText(data.error as PartnerMessageError) });
  }, [clientFilter, statusFilter, errorText]);

  useEffect(() => {
    void loadSenders();
  }, [loadSenders]);
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const senderLabel = (s: PartnerMessageSender) =>
    `${t('senderOption', { name: s.partner_name ?? '', handle: s.partner_handle ?? '', yes: s.audience_yes, used: s.used_this_month, cap: s.monthly_cap })}${s.can_send ? '' : ` · ${t('cannotSend')}`}`;

  const backToList = (n?: Notice) => {
    if (n) setNotice(n);
    setView({ kind: 'list' });
    void loadRows();
    void loadSenders();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">{t('subtitle')}</p>
      </div>

      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={cn(
            'rounded-xl px-4 py-3 text-sm font-medium break-words border',
            notice.ok ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-800 border-red-200'
          )}
        >
          {notice.text}
        </p>
      )}

      {view.kind === 'list' && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem]">
                <Label htmlFor="pm-client">{t('partner')}</Label>
                <Select id="pm-client" value={clientFilter} onValueChange={setClientFilter}>
                  <SelectItem value="">{t('allPartners')}</SelectItem>
                  {senders.map((s) => (
                    <SelectItem key={s.client_id} value={s.client_id}>
                      {senderLabel(s)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="min-w-[10rem]">
                <Label htmlFor="pm-status">{t('col.status')}</Label>
                <Select id="pm-status" value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectItem value="">{t('allStatuses')}</SelectItem>
                  {PARTNER_MESSAGE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`status.${s}`)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <Button className="ml-auto" onClick={() => { setNotice(null); setView({ kind: 'edit', message: null }); }}>
                <Plus className="h-4 w-4 mr-1" />
                {t('newMessage')}
              </Button>
            </div>

            {rows === null ? (
              <p className="py-8 text-center text-sm text-gray-500">{t('loading')}</p>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">{t('empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
                      <th className="py-2 pr-3">{t('col.title')}</th>
                      <th className="py-2 pr-3">{t('col.partner')}</th>
                      <th className="py-2 pr-3">{t('col.status')}</th>
                      <th className="py-2 pr-3">{t('col.sendAt')}</th>
                      <th className="py-2 pr-3 text-right">{t('col.reach')}</th>
                      <th className="py-2 pr-3 text-right">{t('col.pushSent')}</th>
                      <th className="py-2 pr-3 text-right">{t('col.emailSent')}</th>
                      <th className="py-2 text-right">{t('col.opened')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="py-2 pr-3">
                          <button type="button" className="text-left font-medium text-tuggi-blue hover:underline" onClick={() => { setNotice(null); setView({ kind: 'detail', id: r.id }); }}>
                            {r.title || t('noTitle')}
                          </button>
                          <span className="ml-2 text-xs text-gray-400">{r.languages.join(' · ')}</span>
                        </td>
                        <td className="py-2 pr-3">{r.partner_name} <span className="text-gray-400">@{r.partner_handle}</span></td>
                        <td className="py-2 pr-3">
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', statusTone[r.status])}>{t(`status.${r.status}`)}</span>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{r.local_send_at ? wallClock(r.local_send_at, locale) : <span className="text-gray-400">{t('notScheduled')}</span>}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.reach}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.push_sent}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.email_sent}</td>
                        <td className="py-2 text-right tabular-nums">{r.opened}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {view.kind === 'detail' && (
        <PartnerMessageDetail
          id={view.id}
          onBack={backToList}
          onEdit={(message) => setView({ kind: 'edit', message })}
          onNotice={setNotice}
        />
      )}

      {view.kind === 'edit' && (
        <PartnerMessageEditor
          message={view.message}
          senders={senders}
          senderLabel={senderLabel}
          onClose={() => (view.message ? setView({ kind: 'detail', id: view.message.id }) : backToList())}
          onSaved={(message) => {
            setNotice({ ok: true, text: t('editor.saved') });
            setView({ kind: 'detail', id: message.id });
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the guide of item 7

function RefusalGuide() {
  const t = useTranslations('PartnerMessages.guide');
  const examples = t.raw('examples') as string[];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-gray-600">{t('intro')}</p>
        <ul className="list-disc pl-5 space-y-1 text-gray-700 dark:text-gray-300">
          {examples.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className="text-gray-600">{t('more')}</p>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ the editor

type Draft = Partial<Record<PartnerMessageLang, PartnerMessageText>>;

function PartnerMessageEditor({
  message,
  senders,
  senderLabel,
  onClose,
  onSaved,
}: {
  message: PartnerMessage | null;
  senders: PartnerMessageSender[];
  senderLabel: (s: PartnerMessageSender) => string;
  onClose: () => void;
  onSaved: (m: PartnerMessage) => void;
}) {
  const t = useTranslations('PartnerMessages');
  const tLang = useTranslations('Pages.Marketing.Audience.language');
  const errorText = useErrorText();
  const [clientId, setClientId] = useState(message?.client_id ?? '');
  const [requestedBy, setRequestedBy] = useState(message?.requested_by ?? '');
  const [requestedAt, setRequestedAt] = useState(toLocalInput(message?.requested_at ?? null));
  const [buttonKind, setButtonKind] = useState<PartnerMessageButtonKind>(message?.button_kind ?? 'partner_place');
  const [buttonRef, setButtonRef] = useState(message?.button_ref ?? '');
  const [texts, setTexts] = useState<Draft>(() => (message?.texts && Object.keys(message.texts).length ? message.texts : { pt: {} }));
  const langs = PARTNER_MESSAGE_LANGS.filter((l) => texts[l] !== undefined);
  const [active, setActive] = useState<PartnerMessageLang>(langs[0] ?? 'pt');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (lang: PartnerMessageLang, key: string, value: string) =>
    setTexts((prev) => ({ ...prev, [lang]: { ...(prev[lang] ?? {}), [key]: value } }));

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      ...(message ? {} : { client_id: clientId }),
      requested_by: requestedBy,
      requested_at: requestedAt ? new Date(requestedAt).toISOString() : '',
      button_kind: buttonKind,
      button_ref: buttonNeedsRef(buttonKind) ? buttonRef.trim() : null,
      image_path: message?.image_path ?? null,
      texts,
    };
    const { ok, data } = await call(message ? `${API}/${message.id}` : API, {
      method: message ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!ok) {
      const err = data.error as PartnerMessageError | undefined;
      if (err?.field?.lang && (PARTNER_MESSAGE_LANGS as readonly string[]).includes(err.field.lang)) setActive(err.field.lang as PartnerMessageLang);
      return setError(errorText(err));
    }
    onSaved(data.message as PartnerMessage);
  };

  const version = texts[active] ?? {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{message ? t('editor.editTitle') : t('editor.newTitle')}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-1" />
            {t('editor.close')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {!message && (
            <div>
              <Label htmlFor="pm-sender">{t('partner')}</Label>
              <Select id="pm-sender" value={clientId} onValueChange={setClientId}>
                <SelectItem value="" disabled>{t('partner')}</SelectItem>
                {senders.map((s) => (
                  <SelectItem key={s.client_id} value={s.client_id}>{senderLabel(s)}</SelectItem>
                ))}
              </Select>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="pm-requested-by">{t('editor.requestedBy')}</Label>
                <CharCount value={requestedBy} max={REQUESTED_BY_MAX} />
              </div>
              <Input id="pm-requested-by" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
              <p className="text-xs text-gray-500 mt-1">{t('editor.requestedByHint')}</p>
            </div>
            <div>
              <Label htmlFor="pm-requested-at">{t('editor.requestedAt')}</Label>
              <Input id="pm-requested-at" type="datetime-local" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pm-button-kind">{t('editor.buttonKind')}</Label>
              <Select id="pm-button-kind" value={buttonKind} onValueChange={(v) => setButtonKind(v as PartnerMessageButtonKind)}>
                {PARTNER_MESSAGE_BUTTON_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{t(`editor.buttonKinds.${k}`)}</SelectItem>
                ))}
              </Select>
            </div>
            {buttonNeedsRef(buttonKind) && (
              <div>
                <Label htmlFor="pm-button-ref">{t('editor.buttonRef')}</Label>
                <Input id="pm-button-ref" value={buttonRef} onChange={(e) => setButtonRef(e.target.value)} className="font-mono text-xs" />
              </div>
            )}
          </div>

          <div>
            <Label>{t('editor.languages')}</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {PARTNER_MESSAGE_LANGS.map((l) =>
                texts[l] !== undefined ? (
                  <span key={l} className={cn('inline-flex items-center rounded-full border text-sm', active === l ? 'border-tuggi-blue bg-tuggi-blue/10' : 'border-gray-200')}>
                    <button type="button" className="px-3 py-1 font-semibold" onClick={() => setActive(l)}>{tLang(l)}</button>
                    {langs.length > 1 && (
                      <button
                        type="button"
                        aria-label={t('editor.removeLanguage', { lang: tLang(l) })}
                        className="pr-2 text-gray-400 hover:text-red-600"
                        onClick={() => {
                          setTexts((prev) => {
                            const next = { ...prev };
                            delete next[l];
                            return next;
                          });
                          if (active === l) setActive(langs.find((x) => x !== l) ?? 'pt');
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ) : (
                  <button key={l} type="button" className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-500 hover:text-gray-800" onClick={() => { setTexts((prev) => ({ ...prev, [l]: {} })); setActive(l); }}>
                    {t('editor.addLanguage', { lang: tLang(l) })}
                  </button>
                )
              )}
            </div>
          </div>

          {PARTNER_MESSAGE_FIELDS.map((f) => {
            const id = `pm-${active}-${f.key}`;
            const value = (version[f.key] as string | undefined) ?? '';
            return (
              <div key={f.key}>
                <div className="flex items-center justify-between">
                  <Label htmlFor={id}>{t(`editor.fields.${f.key}`)}</Label>
                  <CharCount value={value} max={f.max} />
                </div>
                {f.multiline ? (
                  <Textarea id={id} rows={7} value={value} onChange={(e) => setField(active, f.key, e.target.value)} />
                ) : (
                  <Input id={id} value={value} onChange={(e) => setField(active, f.key, e.target.value)} />
                )}
                <p className="text-xs text-gray-500 mt-1">{t(`editor.hints.${f.key}`)}</p>
              </div>
            );
          })}

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving || (!message && !clientId)}>
              {saving ? t('editor.saving') : t('editor.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <RefusalGuide />
    </div>
  );
}

// ------------------------------------------------------------------ the detail

function PartnerMessageDetail({
  id,
  onBack,
  onEdit,
  onNotice,
}: {
  id: string;
  onBack: (n?: Notice) => void;
  onEdit: (m: PartnerMessage) => void;
  onNotice: (n: Notice | null) => void;
}) {
  const t = useTranslations('PartnerMessages');
  const tLang = useTranslations('Pages.Marketing.Audience.language');
  const locale = useLocale();
  const errorText = useErrorText();
  const [message, setMessage] = useState<PartnerMessage | null>(null);
  const [pending, setPending] = useState<PartnerMessageAction | null>(null);
  const [reason, setReason] = useState('');
  const [sendAt, setSendAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { ok, data } = await call(`${API}/${id}`);
    if (ok) setMessage(data.message as PartnerMessage);
    else setError(errorText(data.error as PartnerMessageError));
  }, [id, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: PartnerMessageAction) => {
    setBusy(true);
    setError(null);
    const body =
      action === 'refuse' || action === 'cancel' ? { action, reason } : action === 'schedule' ? { action, local_send_at: sendAt } : { action };
    const { ok, data } = await call(`${API}/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!ok) return setError(errorText(data.error as PartnerMessageError));
    setMessage(data.message as PartnerMessage);
    setPending(null);
    setReason('');
    onNotice({ ok: true, text: t(`actions.done.${action}`) });
  };

  const langs = useMemo(() => PARTNER_MESSAGE_LANGS.filter((l) => message?.texts?.[l]), [message]);

  if (!message) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Button variant="ghost" size="sm" onClick={() => onBack()}><ArrowLeft className="h-4 w-4 mr-1" />{t('detail.back')}</Button>
          {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : <p className="text-sm text-gray-500">{t('loading')}</p>}
        </CardContent>
      </Card>
    );
  }

  const actions = ACTIONS_BY_STATUS[message.status] ?? [];
  const needsInput = pending === 'refuse' || pending === 'cancel' || pending === 'schedule';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader className="space-y-2">
            <Button variant="ghost" size="sm" className="w-fit" onClick={() => onBack()}><ArrowLeft className="h-4 w-4 mr-1" />{t('detail.back')}</Button>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-lg">{message.texts?.pt?.title ?? message.texts?.en?.title ?? t('noTitle')}</CardTitle>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', statusTone[message.status])}>{t(`status.${message.status}`)}</span>
            </div>
            <p className="text-sm text-gray-500">
              {message.partner_name} @{message.partner_handle} · {t('detail.requested', { who: message.requested_by, when: instant(message.requested_at, locale) })}
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">{error}</p>}
            <div>
              <p className="font-semibold">{t('detail.buttonNow')}</p>
              {message.button_url ? (
                <p className="font-mono text-xs break-all">{message.button_url}</p>
              ) : (
                <p className="text-amber-700">{t('detail.buttonOff')}</p>
              )}
              {message.approved_button_url && message.approved_button_url !== message.button_url && (
                <p className="text-xs text-gray-500 mt-1">{t('detail.approvedButton')}: <span className="font-mono break-all">{message.approved_button_url}</span></p>
              )}
            </div>
            {message.local_send_at && <p><CalendarClock className="inline h-4 w-4 mr-1" />{t('detail.sendAt', { when: wallClock(message.local_send_at, locale) })}</p>}
            <p>{t('detail.audienceNow', { count: message.audience_yes_now })}</p>
            {message.refusal_reason && <p><span className="font-semibold">{t('detail.refusalReason')}:</span> {message.refusal_reason}</p>}
            {message.cancel_reason && <p><span className="font-semibold">{t('detail.cancelReason')}:</span> {message.cancel_reason}</p>}

            {actions.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex flex-wrap gap-2">
                  {message.status === 'draft' && (
                    <Button variant="outline" onClick={() => onEdit(message)}>{t('actions.edit')}</Button>
                  )}
                  {actions.map((a) => (
                    <Button
                      key={a}
                      variant={a === 'approve' || a === 'schedule' ? 'default' : 'outline'}
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        if (a === 'approve' || a === 'unschedule') return void act(a);
                        if (a === 'schedule' && !sendAt) setSendAt(`${toLocalInput(null).slice(0, 10)}T10:00`);
                        setPending(a);
                      }}
                    >
                      {a === 'approve' && <Check className="h-4 w-4 mr-1" />}
                      {a === 'unschedule' && <Undo2 className="h-4 w-4 mr-1" />}
                      {t(`actions.${a}`)}
                    </Button>
                  ))}
                </div>
                {needsInput && (
                  <div className="rounded-lg border p-3 space-y-2">
                    {pending === 'schedule' ? (
                      <>
                        <Label htmlFor="pm-send-at">{t('actions.sendAt')}</Label>
                        <Input id="pm-send-at" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
                        <p className="text-xs text-gray-500">{t('actions.sendAtHint')}</p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="pm-reason">{t('actions.reason')}</Label>
                          <CharCount value={reason} max={REASON_MAX} />
                        </div>
                        <Textarea id="pm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                        <p className="text-xs text-gray-500">{t('actions.reasonHint')}</p>
                      </>
                    )}
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" onClick={() => setPending(null)}>{t('actions.back')}</Button>
                      <Button disabled={busy} onClick={() => pending && void act(pending)}>{t('actions.confirm')}</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{t('detail.numbers')}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {NUMBER_KEYS.map((k) => (
                <div key={k} className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                  <dt className="text-xs text-gray-500">{t(`detail.numberLabels.${k}`)}</dt>
                  <dd className="text-lg font-bold tabular-nums">{message.numbers?.[k] ?? 0}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-gray-500 mt-3">{t('detail.numbersNote')}</p>
          </CardContent>
        </Card>

        {langs.map((l) => {
          const v = message.texts[l] ?? {};
          return (
            <Card key={l}>
              <CardHeader><CardTitle className="text-base">{tLang(l)}</CardTitle></CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {PARTNER_MESSAGE_FIELDS.filter((f) => v[f.key]).map((f) => (
                    <div key={f.key}>
                      <dt className="text-xs font-semibold text-gray-500">{t(`editor.fields.${f.key}`)}</dt>
                      <dd className="whitespace-pre-line">{v[f.key]}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {message.status === 'draft' ? <RefusalGuide /> : <div />}
    </div>
  );
}
