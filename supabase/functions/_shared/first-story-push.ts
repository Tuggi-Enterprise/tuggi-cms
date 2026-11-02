/**
 * The first story push: once in a life, after the first narration of a POI the person heard.
 * BR-COMUNICACAO-019 item 3.n (#1072), BR-VIAGEM-018, BR-COMUNICACAO-008, BR-IDIOMA-001 item 3.
 * Contract: `docs/contracts/notificacoes.md` §14.
 *
 * The database decides who and when: `drive.get_first_story_push_candidates(p_now)` answers the
 * people whose first story fell in the last 24 h, with the guide off, never sent before, with push
 * on and outside the quiet hours (item 5). This module FIRST records every valid candidate with
 * `drive.mark_first_story_push_sent`, and only after that write sends each one through the one push
 * path (the `send` of `_shared/push-send.ts`, in process, #1046). The kind is outside every cap
 * (`PUSH_KINDS.first_story.outsideCaps`), so the gate asks consent and nothing else.
 *
 * Mark before send is the decision of #1072 (item 3.n.3, once in a life by the person's id): at most
 * once. Sending first and marking after repeated the push every hour, up to the end of the 24 h
 * window, whenever the mark failed. Now a failed mark sends nothing and the run reports the failure;
 * a person whose send fails stays marked and does not get the push again. Losing one push costs less
 * than repeating it.
 *
 * Once in a life also needs two runs never to overlap: the cron is hourly and a run ends inside the
 * wall clock of an Edge Function, far below the hour.
 *
 * The copy is `copy`'s, transcribed from `docs/design/copy/push-2026-11.md`, section B: the same
 * text for the guest and the new account, no variable, no hours, no order to turn the guide on.
 *
 * Pure: no remote import and no `Deno` global, so `_tests/first-story-push.test.ts` drives it.
 * Logs carry counts and error codes, never a user id or the text.
 */
import { type DriveRpc, singleGateOutcome } from './push-gate.ts';
import { normalizeCopyLang, type RankingCopyLang } from './ranking-comm-i18n.ts';

/** `data.type` of the piece, and the kind the gate knows. */
export const FIRST_STORY_TYPE = 'first_story';

/** Free in every tier (BR-COMUNICACAO-008 item 4). */
export const FIRST_STORY_DEEPLINK = 'tuggi://map';

/** `first_story.push.title` and `first_story.push.body`. */
export const FIRST_STORY_COPY: Readonly<Record<RankingCopyLang, { title: string; body: string }>> = {
  pt: {
    title: 'Sua primeira história no Tuggi',
    body: 'Parabéns, a descoberta começou. Continue explorando: o mapa mostra o que mais tem na sua região.',
  },
  en: {
    title: 'Your first story on Tuggi',
    body: 'Congrats, your discoveries start here. Keep exploring: the map shows what else is in your area.',
  },
  es: {
    title: 'Tu primera historia en Tuggi',
    body: 'Felicidades, empezaste a descubrir. Sigue explorando: el mapa te muestra qué más hay en tu región.',
  },
  fr: {
    title: 'Ta première histoire avec Tuggi',
    body: "Bravo, la découverte commence. Continue d'explorer, la carte montre ce qu'il y a d'autre dans ta région.",
  },
  it: {
    title: 'La tua prima storia con Tuggi',
    body: "Complimenti, la scoperta è iniziata. Continua a esplorare: la mappa mostra cos'altro c'è nella tua zona.",
  },
  de: {
    title: 'Deine erste Geschichte mit Tuggi',
    body: 'Glückwunsch, es geht los. Entdecke weiter: Die Karte zeigt, was es in deiner Region noch gibt.',
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** People sent to at the same time, the width of the weekly sender. */
export const SEND_CONCURRENCY = 10;

/** The copy for `drive.profiles.language` as stored; outside the six it reads English (item 11). */
export function firstStoryCopy(language: unknown): { title: string; body: string } {
  return FIRST_STORY_COPY[normalizeCopyLang(typeof language === 'string' ? language : null)];
}

/** The one-person `/send` body, the same body `firebase-push-notification/send` takes. */
export function firstStorySendBody(userId: string, language: unknown): Record<string, unknown> {
  const copy = firstStoryCopy(language);
  return {
    type: 'user',
    userIds: [userId],
    push_kind: FIRST_STORY_TYPE,
    notification: {
      title: copy.title,
      body: copy.body,
      data: { type: FIRST_STORY_TYPE, deeplink: FIRST_STORY_DEEPLINK },
    },
    priority: 'high',
    // The candidate query checked the quiet hours for this hour; a push held longer by a phone
    // switched off could land inside them.
    ttl: 3600,
  };
}

export type FirstStoryOutcome = 'sent' | 'denied' | 'not_delivered' | 'failed';

export interface FirstStoryDeps {
  /** A client already pinned to the `drive` schema, with the machine key. */
  drive: DriveRpc;
  /** `createPushSender(...).send`, or a stand-in in the tests. */
  send: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
  log: (line: string) => void;
  /** `now()` when absent; the tests pin the instant. */
  now?: Date;
}

export interface FirstStoryReport {
  candidates: number;
  outcomes: Record<FirstStoryOutcome, number>;
  /** Rows without a valid `user_id`: not sent. */
  invalid: number;
  /** Rows `mark_first_story_push_sent` wrote, before any send. */
  marked: number;
  /**
   * Valid candidates the mark did not record after one retry. Nobody was sent to, and these people
   * come back next hour. Above zero means the run failed: `firstStoryRunFailed`.
   */
  unmarked: number;
}

export class FirstStoryCandidatesError extends Error {
  constructor(readonly code: string) {
    super(`get_first_story_push_candidates failed: ${code}`);
  }
}

function outcomeOf(status: number, answer: unknown): FirstStoryOutcome {
  if (status < 200 || status >= 300) return 'failed';
  switch (singleGateOutcome(answer)) {
    case 'sent':
      return 'sent';
    case 'denied':
    case 'inactive':
      return 'denied';
    case 'not_delivered':
      return 'not_delivered';
    default:
      return 'failed';
  }
}

async function deliver(deps: FirstStoryDeps, userId: string, language: unknown): Promise<FirstStoryOutcome> {
  try {
    const { status, body } = await deps.send(firstStorySendBody(userId, language));
    const outcome = outcomeOf(status, body);
    if (outcome === 'failed') {
      deps.log(`[first-story-push] send failed: status=${status} gate=${singleGateOutcome(body) ?? 'none'}`);
    }
    return outcome;
  } catch (error) {
    deps.log(`[first-story-push] send failed: ${(error as Error)?.name ?? 'Error'}`);
    return 'failed';
  }
}

/** Records the people about to be sent to, once more on an error. `null` when both attempts failed. */
async function mark(deps: FirstStoryDeps, userIds: string[]): Promise<number | null> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { data, error } = await deps.drive.rpc('mark_first_story_push_sent', { p_user_ids: userIds });
    if (!error) return Number.isInteger(data) ? (data as number) : 0;
    deps.log(`[first-story-push] mark attempt ${attempt} failed: ${error.code ?? 'unknown'}`);
  }
  return null;
}

/** A run whose mark failed sent nothing; the caller answers 500 with the report. */
export function firstStoryRunFailed(report: FirstStoryReport): boolean {
  return report.unmarked > 0;
}

/**
 * One run: candidates, one mark with every valid one, then one send per person, only if the mark
 * held. Throws `FirstStoryCandidatesError` when the candidate query fails, so the caller answers
 * 500; the mark failure is counted in `unmarked`, never thrown.
 */
export async function runFirstStoryPush(deps: FirstStoryDeps): Promise<FirstStoryReport> {
  const now = deps.now ?? new Date();
  const { data, error } = await deps.drive.rpc('get_first_story_push_candidates', { p_now: now.toISOString() });
  if (error) throw new FirstStoryCandidatesError(error.code ?? 'unknown');

  const rows: unknown[] = Array.isArray(data) ? data : [];
  const report: FirstStoryReport = {
    candidates: rows.length,
    outcomes: { sent: 0, denied: 0, not_delivered: 0, failed: 0 },
    invalid: 0,
    marked: 0,
    unmarked: 0,
  };

  // One send per person, even if a row repeats.
  const people = new Map<string, unknown>();
  for (const raw of rows) {
    const row = (raw ?? {}) as Record<string, unknown>;
    if (typeof row.user_id !== 'string' || !UUID_RE.test(row.user_id)) {
      report.invalid += 1;
      continue;
    }
    if (!people.has(row.user_id)) people.set(row.user_id, row.language);
  }

  const entries = [...people.entries()];
  if (entries.length > 0) {
    const marked = await mark(deps, entries.map(([userId]) => userId));
    if (marked === null) {
      report.unmarked = entries.length;
      deps.log(`[first-story-push] ${JSON.stringify(report)}`);
      return report;
    }
    report.marked = marked;
  }

  for (let i = 0; i < entries.length; i += SEND_CONCURRENCY) {
    await Promise.all(
      entries.slice(i, i + SEND_CONCURRENCY).map(async ([userId, language]) => {
        report.outcomes[await deliver(deps, userId, language)] += 1;
      })
    );
  }

  deps.log(`[first-story-push] ${JSON.stringify(report)}`);
  return report;
}
