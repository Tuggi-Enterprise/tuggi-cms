/**
 * The founder's welcome when a permanent account is born or a guest converts: BR-COMUNICACAO-019
 * item 3.r (#1182). Contract: `docs/contracts/notificacoes.md` §18.
 *
 * The database decides when (a trigger on `auth.users`, owned by `data`) and posts
 * `{ "user_id": "<uuid>" }` to `firebase-push-notification/account-welcome` with the machine key.
 * That path calls `runAccountWelcomePush`, which:
 *
 * 1. writes the Correio row first, with push on or off (3.r.4). A plain insert: the unique partial
 *    index `drive.user_notifications (user_id) where type = 'account_welcome'` is the once-in-a-life
 *    guard (3.r.2), and PostgREST cannot name a partial index in `on conflict`, so `23505` reads
 *    "already welcomed" and nothing is pushed;
 * 2. pushes through the one sender (`send`, item 9) with the id of that row, so push and row stay
 *    one message: consent only, outside every cap and the quiet hours (3.r.5).
 *
 * The push carries no `data.deeplink`: the app opens the Correio, where the letter is. The row
 * carries `tuggi://map`, which the reading screen shows as its button (3.r.7).
 *
 * A failed push keeps the row (3.r.6): `send` marks it in `delivery_failed_at`/`delivery_error`
 * and writes `marketing.notification_logs`. Never throws. Logs carry outcomes and error codes,
 * never the user id.
 *
 * Pure: no remote import and no `Deno` global, so `_tests/account-welcome-push.test.ts` drives it.
 */
import { singleGateOutcome } from './push-gate.ts';
import { normalizeCopyLang } from './ranking-comm-i18n.ts';
import { ACCOUNT_WELCOME_COPY } from './account-welcome-i18n.ts';

/** `push_kind` of the gate and `type` of the row and of `data.type` (BR-COMUNICACAO-016). */
export const ACCOUNT_WELCOME_KIND = 'account_welcome';

/** The row's button: the map, free in every tier (BR-MONETIZACAO-056). */
export const ACCOUNT_WELCOME_INBOX_DEEPLINK = 'tuggi://map';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

type Answer = { data: unknown; error: { code?: string } | null };

/** The slice of a supabase-js query builder this module uses. */
export interface AccountWelcomeQuery extends PromiseLike<Answer> {
  select(columns: string): AccountWelcomeQuery;
  insert(values: Record<string, unknown>): AccountWelcomeQuery;
  eq(column: string, value: unknown): AccountWelcomeQuery;
  maybeSingle(): PromiseLike<Answer>;
  single(): PromiseLike<Answer>;
}

/** A supabase-js client holding the machine key: the row is written past RLS. */
export interface AccountWelcomeDb {
  schema(name: string): { from(table: string): AccountWelcomeQuery };
}

export interface AccountWelcomeDeps {
  db: AccountWelcomeDb;
  /** `createPushSender(...).send` with the row handed over, or a stand-in in the tests. */
  send: (body: Record<string, unknown>, internal: { inboxRowId: string }) => Promise<{ status: number; body: unknown }>;
  log: (line: string) => void;
}

/**
 * - `sent`, `denied`, `not_delivered`, `failed`: the row was written; what happened to the push.
 * - `already_welcomed`: the row existed (`23505`); nothing written, nothing pushed.
 * - `no_user`: no such person (`23503`, the row's foreign key).
 * - `inbox_failed`: the row could not be written; nothing pushed, so a push never stands alone.
 */
export type AccountWelcomeOutcome =
  | 'sent'
  | 'denied'
  | 'not_delivered'
  | 'failed'
  | 'already_welcomed'
  | 'no_user'
  | 'inbox_failed';

/** The two texts in the person's language (item 11). A failed read is English, never a lost row. */
export async function readWelcomeLanguage(db: AccountWelcomeDb, userId: string): Promise<keyof typeof ACCOUNT_WELCOME_COPY> {
  try {
    const { data, error } = await db.schema('drive').from('profiles').select('language').eq('id', userId).maybeSingle();
    const language = error ? null : (data as { language?: unknown } | null)?.language;
    return normalizeCopyLang(typeof language === 'string' ? language : null);
  } catch {
    return 'en';
  }
}

/** The one-person `/send` body. No `deeplink` in `data`: the tap opens the Correio. */
export function accountWelcomeSendBody(userId: string, lang: keyof typeof ACCOUNT_WELCOME_COPY): Record<string, unknown> {
  const { push } = ACCOUNT_WELCOME_COPY[lang];
  return {
    type: 'user',
    userIds: [userId],
    push_kind: ACCOUNT_WELCOME_KIND,
    notification: { title: push.title, body: push.body, data: { type: ACCOUNT_WELCOME_KIND } },
    priority: 'high',
    // A phone switched off for the night still gets it in the morning.
    ttl: 86400,
  };
}

/** Writes the row once in a life and pushes the welcome. Never throws. */
export async function runAccountWelcomePush(deps: AccountWelcomeDeps, userId: string): Promise<AccountWelcomeOutcome> {
  const lang = await readWelcomeLanguage(deps.db, userId);
  const { inbox } = ACCOUNT_WELCOME_COPY[lang];

  let rowId: string;
  try {
    const { data, error } = await deps.db
      .schema('drive')
      .from('user_notifications')
      .insert({
        user_id: userId,
        type: ACCOUNT_WELCOME_KIND,
        title: inbox.title,
        body: inbox.body,
        data: { type: ACCOUNT_WELCOME_KIND },
        deeplink: ACCOUNT_WELCOME_INBOX_DEEPLINK,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') {
        deps.log('[account-welcome] not sent: already_welcomed');
        return 'already_welcomed';
      }
      if (error.code === '23503') {
        deps.log('[account-welcome] not sent: no_user');
        return 'no_user';
      }
      deps.log(`[account-welcome] not sent: inbox_failed code=${error.code ?? 'unknown'}`);
      return 'inbox_failed';
    }
    const id = (data as { id?: unknown } | null)?.id;
    if (!isUuid(id)) {
      deps.log('[account-welcome] not sent: inbox_failed code=no_id');
      return 'inbox_failed';
    }
    rowId = id;
  } catch (error) {
    deps.log(`[account-welcome] not sent: inbox_failed threw=${(error as Error)?.name ?? 'Error'}`);
    return 'inbox_failed';
  }

  let outcome: AccountWelcomeOutcome;
  try {
    const { status, body } = await deps.send(accountWelcomeSendBody(userId, lang), { inboxRowId: rowId });
    const gate = singleGateOutcome(body);
    if (status < 200 || status >= 300) outcome = 'failed';
    else if (gate === 'sent') outcome = 'sent';
    else if (gate === 'denied' || gate === 'inactive') outcome = 'denied';
    else if (gate === 'not_delivered') outcome = 'not_delivered';
    else outcome = 'failed';
    if (outcome === 'failed') deps.log(`[account-welcome] push failed: status=${status} gate=${gate ?? 'none'}`);
  } catch (error) {
    deps.log(`[account-welcome] push failed: ${(error as Error)?.name ?? 'Error'}`);
    outcome = 'failed';
  }
  deps.log(`[account-welcome] ${lang}: row written, push ${outcome}`);
  return outcome;
}
