/**
 * #1182: the founder's welcome, `_shared/account-welcome-push.ts`. BR-COMUNICACAO-019 item 3.r.
 * Copy: `docs/design/copy/boas-vindas-do-fundador-2026-11.md`; contract `docs/contracts/notificacoes.md` §18.
 *
 * The module gets a fake client (the profile read and the row insert) and a fake `send`. The path
 * `/account-welcome`, end to end through the gate and FCM, is in `firebase-push-notification.test.ts`.
 */
import { assert, assertEquals } from './assert.ts';
import { PUSH_KINDS } from '../_shared/push-gate.ts';
import { ACCOUNT_WELCOME_COPY } from '../_shared/account-welcome-i18n.ts';
import {
  type AccountWelcomeDb,
  type AccountWelcomeDeps,
  type AccountWelcomeQuery,
  runAccountWelcomePush,
} from '../_shared/account-welcome-push.ts';

const USER = '33333333-4444-4555-8666-777777777777';
const ROW = '44444444-5555-4666-8777-888888888888';

type Answer = { data: unknown; error: { code?: string } | null };

interface Rows {
  /** `drive.profiles.language`; `undefined` is no profile row. */
  language?: unknown;
  profileError?: string;
  insertError?: string;
}

function fakeDb(rows: Rows, inserts: Array<Record<string, unknown>>): AccountWelcomeDb {
  const query = (table: string): AccountWelcomeQuery => {
    let inserting = false;
    const answer = (): Answer => {
      if (table === 'profiles') {
        if (rows.profileError) return { data: null, error: { code: rows.profileError } };
        return { data: rows.language === undefined ? null : { language: rows.language }, error: null };
      }
      if (table === 'user_notifications' && inserting) {
        return rows.insertError ? { data: null, error: { code: rows.insertError } } : { data: { id: ROW }, error: null };
      }
      return { data: null, error: { code: 'unexpected' } };
    };
    const q: AccountWelcomeQuery = {
      select: () => q,
      insert: (values) => (inserting = true, inserts.push(values), q),
      eq: () => q,
      maybeSingle: () => Promise.resolve(answer()),
      single: () => Promise.resolve(answer()),
      then: (ok, ko) => Promise.resolve(answer()).then(ok, ko),
    };
    return q;
  };
  return { schema: () => ({ from: (table) => query(table) }) };
}

function gateAnswer(outcome: string, status = 200) {
  return { status, body: { success: true, gate: { [outcome]: 1 } } };
}

function run(rows: Rows, reply: () => Promise<{ status: number; body: unknown }> = async () => gateAnswer('sent')) {
  const sends: Array<{ body: Record<string, unknown>; inboxRowId: string }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  const deps: AccountWelcomeDeps = {
    db: fakeDb(rows, inserts),
    send: async (body, internal) => {
      sends.push({ body, inboxRowId: internal.inboxRowId });
      return await reply();
    },
    log: (line) => logs.push(line),
  };
  return { deps, sends, inserts, logs };
}

const notification = (body: Record<string, unknown>) =>
  body.notification as { title: string; body: string; data: Record<string, string> };

// ---- policy and copy ----

Deno.test('BR-COMUNICACAO-019 3.r.4, 3.r.5: account_welcome is outside every cap, consent only, Correio row always', () => {
  assertEquals(PUSH_KINDS.account_welcome, {
    requested: false,
    requiresActive: false,
    vacancyPriority: 4,
    outsideCaps: true,
    inboxAlways: true,
  });
});

Deno.test('BR-COMUNICACAO-019 3.r.7, item 11: six languages, push within 40/110, Correio title within 30, no dash, no number', () => {
  assertEquals(Object.keys(ACCOUNT_WELCOME_COPY).sort(), ['de', 'en', 'es', 'fr', 'it', 'pt']);
  for (const [lang, copy] of Object.entries(ACCOUNT_WELCOME_COPY)) {
    assert([...copy.push.title].length <= 40, `${lang} push title`);
    assert([...copy.push.body].length <= 110, `${lang} push body`);
    assert([...copy.inbox.title].length <= 30, `${lang} inbox title`);
    assert(copy.inbox.body.includes('\n\n') && copy.inbox.body.endsWith('@leandroramos'), `${lang} letter`);
    for (const s of [copy.push.title, copy.push.body, copy.inbox.title, copy.inbox.body]) {
      assert(!/[–—!?]/.test(s), `${lang} punctuation: ${s}`);
      // 3.r.7: no hour, price or deadline is promised.
      assert(!/\d/.test(s), `${lang} number: ${s}`);
    }
  }
});

// ---- the row, then the push ----

Deno.test('BR-COMUNICACAO-019 3.r.4: the first call writes the Correio row and pushes once with its id', async () => {
  const { deps, sends, inserts } = run({ language: 'pt-BR' });
  assertEquals(await runAccountWelcomePush(deps, USER), 'sent');

  assertEquals(inserts, [{
    user_id: USER,
    type: 'account_welcome',
    title: 'Boas-vindas ao Tuggi',
    body: ACCOUNT_WELCOME_COPY.pt.inbox.body,
    data: { type: 'account_welcome' },
    deeplink: 'tuggi://map',
  }]);
  assertEquals(sends.length, 1);
  assertEquals(sends[0].inboxRowId, ROW);
  assertEquals(sends[0].body.type, 'user');
  assertEquals(sends[0].body.userIds, [USER]);
  assertEquals(sends[0].body.push_kind, 'account_welcome');
  const n = notification(sends[0].body);
  assertEquals(n.title, 'Boas-vindas ao Tuggi');
  assertEquals(n.body, 'Leandro Ramos, fundador do Tuggi, deixou uma mensagem para você. Toque para ler.');
});

Deno.test('BR-COMUNICACAO-019 3.r.7: the push carries no deeplink (the tap opens the Correio), the row carries tuggi://map', async () => {
  const { deps, sends, inserts } = run({ language: 'en' });
  await runAccountWelcomePush(deps, USER);
  assertEquals(notification(sends[0].body).data, { type: 'account_welcome' });
  assert(!('deeplink' in notification(sends[0].body).data), 'no data.deeplink');
  assertEquals(inserts[0].deeplink, 'tuggi://map');
});

Deno.test('BR-COMUNICACAO-019 3.r.4: push off still leaves the row, and answers denied', async () => {
  const { deps, inserts, sends } = run({ language: 'pt' }, async () => gateAnswer('denied'));
  assertEquals(await runAccountWelcomePush(deps, USER), 'denied');
  assertEquals(inserts.length, 1);
  assertEquals(sends.length, 1, 'the gate decides, inside send');
});

Deno.test('BR-COMUNICACAO-019 3.r.2: 23505 is "already welcomed", and nothing is pushed', async () => {
  const { deps, inserts, sends, logs } = run({ language: 'pt', insertError: '23505' });
  assertEquals(await runAccountWelcomePush(deps, USER), 'already_welcomed');
  assertEquals(inserts.length, 1);
  assertEquals(sends, []);
  assert(logs.some((l) => l.includes('already_welcomed')), logs.join('\n'));
});

Deno.test('BR-COMUNICACAO-019 3.r.6: a row that cannot be written pushes nothing, and says why without the id', async () => {
  for (const [code, outcome] of [['23503', 'no_user'], ['57014', 'inbox_failed']] as const) {
    const { deps, sends, logs } = run({ language: 'pt', insertError: code });
    assertEquals(await runAccountWelcomePush(deps, USER), outcome, code);
    assertEquals(sends, [], code);
    assert(logs.every((l) => !l.includes(USER)), logs.join('\n'));
  }
});

Deno.test('BR-COMUNICACAO-019 3.r.6: a failed push keeps the row and answers failed', async () => {
  for (const reply of [
    async () => gateAnswer('sent', 500),
    async () => gateAnswer('gate_error'),
    async () => { throw new TypeError('network'); },
  ]) {
    const { deps, inserts, logs } = run({ language: 'pt' }, reply);
    assertEquals(await runAccountWelcomePush(deps, USER), 'failed');
    assertEquals(inserts.length, 1);
    assert(logs.some((l) => l.includes('push failed')), logs.join('\n'));
    assert(logs.every((l) => !l.includes(USER)), logs.join('\n'));
  }
});

Deno.test('BR-COMUNICACAO-019 3.r.4: no device is not_delivered, row kept', async () => {
  const { deps, inserts } = run({ language: 'pt' }, async () => gateAnswer('not_delivered'));
  assertEquals(await runAccountWelcomePush(deps, USER), 'not_delivered');
  assertEquals(inserts.length, 1);
});

// ---- the language: item 11 ----

Deno.test('BR-COMUNICACAO-019 3.r.7, item 11: de is German in the push and in the row', async () => {
  const { deps, sends, inserts } = run({ language: 'de-AT' });
  await runAccountWelcomePush(deps, USER);
  assertEquals(notification(sends[0].body).title, 'Willkommen bei Tuggi');
  assertEquals(notification(sends[0].body).body, ACCOUNT_WELCOME_COPY.de.push.body);
  assertEquals(inserts[0].title, 'Willkommen bei Tuggi');
  assertEquals(inserts[0].body, ACCOUNT_WELCOME_COPY.de.inbox.body);
});

Deno.test('BR-COMUNICACAO-019 item 11: a language outside the catalogue, no profile or a failed read is English', async () => {
  for (const rows of [{ language: 'ja' }, { language: null }, {}, { profileError: '57014' }] as Rows[]) {
    const { deps, sends, inserts } = run(rows);
    assertEquals(await runAccountWelcomePush(deps, USER), 'sent', JSON.stringify(rows));
    assertEquals(notification(sends[0].body).title, 'Welcome to Tuggi', JSON.stringify(rows));
    assertEquals(inserts[0].body, ACCOUNT_WELCOME_COPY.en.inbox.body, JSON.stringify(rows));
  }
});
