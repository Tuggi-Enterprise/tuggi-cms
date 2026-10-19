
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey } from '../_shared/supabase-client.ts';
// #747 — esta funcao e publicada com `verify_jwt: false` e, ate 2026-09-17, nao lia
// `Authorization` nenhum: um chamador anonimo disparava o push diario da coorte 07-22 local na
// hora que escolhesse, e o e-mail de ranking no dia em que ele subir. O portao e o mesmo que o
// #346 poz na `send-newsletter`, e o unico chamador legitimo — o cron job 31,
// `drive.trigger_fomo_orchestrator()` — ja manda o `ef_secret_key` do Vault, que e exatamente o
// que `isOwnMachineKey` aceita. BR-COMUNICACAO-012, BR-USUARIO-043.
import { requireAdmin } from '../_shared/auth-middleware.ts';
// #955: the daily retrospective (`daily_fomo`) left the push — BR-COMUNICACAO-019 item 3.i moves
// it to the first opening of the day. What this window still pushes is the ranking piece, and it
// passes the one gate of `firebase-push-notification` (`_shared/push-gate.ts`).
import { readActiveWindowDays, readUserActive, singleGateOutcome } from '../_shared/push-gate.ts';
// The ranking pieces of #747 ride THIS daily window and never schedule one of their own —
// BR-COMUNICACAO-012 item 1.4.e. The decision of who gets what lives in `_shared`, pure and
// tested (`tests/api/ranking-communication.test.ts`); this file only reads, dispatches and logs.
import {
  buildRankingDispatch,
  dailyWindowStep,
  RANKING_PUSH_TYPE,
  RANKING_PUSH_TYPES,
  type RankingDecision,
  type RankingPiece,
  type RecipientConsent,
  type ScoreboardWeekRow,
} from '../_shared/ranking-communication.ts';
import {
  normalizeCopyLang,
  rankingCopyVars,
  resolveRankingPushCopy,
} from '../_shared/ranking-comm-i18n.ts';
// The e-mail plan — the four gates of BR-COMUNICACAO-017, pure and tested in
// `tests/api/ranking-email.test.ts`. This file resolves the audience and delivers; it decides
// nothing about who is mailable.
import {
  claimRankingEmailSlots,
  planRankingEmails,
  rankingEmailAuditLine,
  type RankingEmailAudienceRow,
} from '../_shared/ranking-email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Where each ranking push lands when it is tapped — and it is NOT one destination for the three.
 *
 * `rank_at_risk` says the hours ran out, so its tap belongs on the paywall, carrying the funnel
 * origin of BR-MONETIZACAO-081 item 6.4. That route already exists in the app (`DeepLinkService`,
 * `case '/plans'`, which reads `params.source`), so this costs no store build and recovers the
 * conversion the piece exists for — sending it to the scoreboard instead would have been a push
 * about money landing on a table.
 *
 * The other two land on the scoreboard screen of #745, which the app does NOT register yet;
 * until it does, the app's destination cascade falls back to the inbox, which is the same
 * behaviour every unknown deeplink already has. Declared in `docs/contracts/notificacoes.md` §6.3.
 */
const RANKING_DEEPLINK: Record<RankingPiece, string> = {
  streak_at_risk: 'tuggi://ranking',
  rank_at_risk: 'tuggi://plans?source=rank_at_risk',
  rank_drop: 'tuggi://ranking',
};

/**
 * Collects the ranking dispatch for the accounts this daily window is evaluating.
 *
 * Reads only: the current weekly scoreboard, the three consents, whether a live push token
 * exists, the rank we last told each person, and who has hit a zero balance. Every one of those
 * is an existing object; this function creates nothing and writes nothing.
 *
 * Returns an empty dispatch on any read failure. A ranking piece is worth less than the daily
 * retrospective it would displace, so the failure mode is "the ranking is quiet today", never
 * "the whole daily window is down".
 */
async function collectRankingDispatch(
  client: ReturnType<typeof createClient>,
  requestId: string,
  candidateIds: string[]
): Promise<{
  byUserId: Map<string, RankingDecision>;
  emailDecisions: RankingDecision[];
  streakDaysByUserId: Map<string, number>;
}> {
  const empty = {
    byUserId: new Map<string, RankingDecision>(),
    emailDecisions: [] as RankingDecision[],
    streakDaysByUserId: new Map<string, number>(),
  };
  if (candidateIds.length === 0) return empty;

  const nowIso = new Date().toISOString();

  // The current weekly cycle, WHOLE: the dispute predicate of BR-MONETIZACAO-081 needs the
  // neighbours, not only the candidates. `period_start`/`period_end` come from the row, so the
  // Monday-UTC boundary of BR-RANKING-005 is never recomputed here.
  const { data: weekRowsRaw, error: weekErr } = await client
    .schema('core')
    .from('ranking_scoreboard')
    .select('user_id, rank_official, points_official, story_days, in_roster, period_start')
    .eq('period_kind', 'week')
    .lte('period_start', nowIso)
    .gt('period_end', nowIso);

  if (weekErr || !weekRowsRaw || weekRowsRaw.length === 0) {
    if (weekErr) console.error(`[${requestId}] ⚠️ ranking: scoreboard read failed:`, weekErr.message);
    else console.log(`[${requestId}] ℹ️ ranking: the current cycle has no rows — nothing to say.`);
    return empty;
  }

  const weekRows: ScoreboardWeekRow[] = weekRowsRaw.map((r: Record<string, unknown>) => ({
    user_id: String(r.user_id),
    rank_official: r.rank_official === null ? null : Number(r.rank_official),
    points_official: Number(r.points_official ?? 0),
    story_days: Number(r.story_days ?? 0),
    in_roster: r.in_roster === true,
  }));
  const cycleStart = new Date(String(weekRowsRaw[0].period_start));

  // The three consents. `NULL` is "never answered" and is NOT `false` for the product — but for
  // sending, neither is permission, and `resolveRankingChannel` is where that is decided.
  const [profileRes, tokenRes, lastRes] = await Promise.all([
    client
      .from('profiles')
      .select('id, ranking_opt_in, email_opt_in, push_notifications_enabled, push_token')
      .in('id', candidateIds),
    client.from('fcm_tokens').select('user_id').in('user_id', candidateIds).eq('is_active', true),
    client
      .from('user_notifications')
      .select('user_id, data, created_at')
      .in('user_id', candidateIds)
      .in('type', RANKING_PUSH_TYPES)
      .order('created_at', { ascending: false }),
  ]);

  if (profileRes.error) {
    console.error(`[${requestId}] ⚠️ ranking: consent read failed:`, profileRes.error.message);
    return empty;
  }

  const liveTokenUserIds = new Set<string>((tokenRes.data ?? []).map((t: Record<string, unknown>) => String(t.user_id)));
  const consentByUserId = new Map<string, RecipientConsent>();
  for (const p of profileRes.data ?? []) {
    const row = p as Record<string, unknown>;
    const id = String(row.id);
    consentByUserId.set(id, {
      user_id: id,
      ranking_opt_in: (row.ranking_opt_in as boolean | null) ?? null,
      email_opt_in: (row.email_opt_in as boolean | null) ?? null,
      push_notifications_enabled: (row.push_notifications_enabled as boolean | null) ?? null,
      has_live_push_token: liveTokenUserIds.has(id) || Boolean(row.push_token),
      active_recently: null,
    });
  }

  // "Using the app" — BR-COMUNICACAO-019 item 2, decided by `drive.user_active_within_days` with
  // the window of `drive.unrequested_push_policy()` and never a 7 written here. Asked only for
  // whoever push could reach: for anybody else the answer changes nothing. A failed read stays
  // `null`, and `resolveRankingChannel` sends `null` nowhere.
  const activeWindowDays = await readActiveWindowDays(client);
  const pushReachable = [...consentByUserId.values()].filter(
    (c) => c.ranking_opt_in === true && c.push_notifications_enabled === true && c.has_live_push_token
  );
  if (activeWindowDays === null && pushReachable.length > 0) {
    console.warn(
      `[${requestId}] ⚠️ ranking: "using the app" not measurable — no ranking push today. ` +
      'Expected until db-tuggiApp migration 20261019200200 is applied.'
    );
  } else if (activeWindowDays !== null) {
    for (let i = 0; i < pushReachable.length; i += 10) {
      await Promise.all(pushReachable.slice(i, i + 10).map(async (c) => {
        c.active_recently = await readUserActive(client, c.user_id, activeWindowDays);
      }));
    }
  }

  // The rank we last TOLD them. Ordered newest first, so the first row per user wins.
  const lastCommunicatedRankByUserId = new Map<string, number>();
  for (const n of lastRes.data ?? []) {
    const row = n as Record<string, unknown>;
    const id = String(row.user_id);
    if (lastCommunicatedRankByUserId.has(id)) continue;
    const rank = Number((row.data as Record<string, unknown> | null)?.rank);
    if (Number.isFinite(rank) && rank > 0) lastCommunicatedRankByUserId.set(id, rank);
  }

  // Condition (c) of BR-MONETIZACAO-081 item 6.2. `null` means NOT MEASURED, and not measured is
  // not zero: the `rank_at_risk` piece then does not leave for anybody. The gate of this RPC is
  // `core.assert_platform_admin()` and it has never been exercised with the Edge Function key, so
  // a `42501` here is a known unknown, not a surprise.
  let zeroBalanceUserIds: Set<string> | null = null;
  const { data: metered, error: meteredErr } = await client
    .schema('core')
    .rpc('dashboard_metered_users', { limit_count: 1000, max_balance_minutes: 0 });
  if (meteredErr) {
    console.warn(
      `[${requestId}] ⚠️ ranking: balance not measurable (${meteredErr.code ?? '?'}) — ` +
      'rank_at_risk suppressed for everybody today.'
    );
  } else {
    zeroBalanceUserIds = new Set<string>((metered ?? []).map((m: Record<string, unknown>) => String(m.user_id)));
  }

  // THE LENGTH OF THE STREAK — and it is a READ of the only counter there is, not a second one.
  //
  // `core.account_streak` is the relation migration `20260917120000` of `db-tuggiApp` creates
  // (#746): consecutive UTC calendar days with at least one story delivered, per account, over
  // `core.ranking_story_day`. It is `GRANT SELECT` to `service_role` and to nobody else, which is
  // exactly this function's key. The sibling RPC `drive.get_streak_v1()` is useless here — it
  // takes no arguments and identifies the caller by `auth.uid()`, so it can only ever answer
  // about the holder of the JWT, and this window has none.
  //
  // **This is the piece's precondition, and it fails CLOSED.** While the migration is not
  // applied the read errors, the map stays empty, `rankingCopyVars` supplies no `{{count}}`, and
  // `ranking.push.streak_at_risk.title` — a plural pair — does not resolve. The streak piece then
  // simply does not leave, and the daily retrospective keeps the slot.
  //
  // Only a run that is ALIVE and NOT YET completed today is carried: `today_completed = true`
  // means the person already did their part, and `isStreakAtRisk` would not have chosen the piece
  // for them anyway. Reading both columns here keeps the number the push states and the state the
  // push claims from ever disagreeing.
  const streakDaysByUserId = new Map<string, number>();
  const { data: streakRows, error: streakErr } = await client
    .schema('core')
    .from('account_streak')
    .select('user_id, current_streak_days, today_completed')
    .in('user_id', candidateIds);
  if (streakErr) {
    console.warn(
      `[${requestId}] ⚠️ ranking: streak not measurable (${streakErr.code ?? '?'}) — ` +
      'streak_at_risk has no day count and is withheld for everybody today. ' +
      'Expected until db-tuggiApp migration 20260917120000 is applied.'
    );
  } else {
    for (const s of (streakRows ?? []) as Array<Record<string, unknown>>) {
      if (s.today_completed === true) continue;
      const days = Number(s.current_streak_days ?? 0);
      if (Number.isFinite(days) && days >= 1) streakDaysByUserId.set(String(s.user_id), days);
    }
  }

  const { decisions, skipped } = buildRankingDispatch({
    now: new Date(),
    cycleStart,
    weekRows,
    evaluatedUserIds: candidateIds,
    consentByUserId,
    lastCommunicatedRankByUserId,
    zeroBalanceUserIds,
  });

  console.log(
    `[${requestId}] 🏁 ranking: ${decisions.length} piece(s) due, skipped=${JSON.stringify(skipped)}`
  );

  const byUserId = new Map<string, RankingDecision>();
  const emailDecisions: RankingDecision[] = [];
  for (const d of decisions) {
    if (d.channel === 'push') byUserId.set(d.user_id, d);
    else emailDecisions.push(d);
  }
  return { byUserId, emailDecisions, streakDaysByUserId };
}

/**
 * The e-mail half — BR-COMUNICACAO-017, the channel of the 105 accounts that uninstalled.
 *
 * It resolves the address through `marketing.get_ranking_email_audience`, which asks for the two
 * consents and applies `marketing.email_unsubscribes` — the single unsubscribe list (item 5) —,
 * plans the send with `planRankingEmails` (the four gates, one implementation), leaves the audit
 * line item 8.c asks of an automatic dispatch, and hands the recipients to
 * `send-newsletter/ranking`, which is where a Tuggi e-mail leaves.
 *
 * **It fails closed on a missing audience resolver, and that is the correct behaviour, not a
 * degradation.** The RPC lives in migration `20260917140000` of `db-tuggiApp`, which is WRITTEN
 * and NOT APPLIED (CLAUDE.md §3 — the operator applies). Until it is, the call errors, the warn
 * below is the whole record, and no e-mail leaves for anybody.
 *
 * **Two ceilings of BR-COMUNICACAO-017 are absent and are LOGGED instead of assumed** — the
 * 7-day bucket shared with the newsletter (item 4.b) and the one-per-cycle cap (item 8.b). Both
 * need a database object that does not exist; see the header of `_shared/ranking-email.ts`.
 *
 * **One divergence from item 8.b is deliberate and is not silent.** The rule says the e-mail goes
 * out "depois de o ciclo fechar", citing the settled position. This dispatch rides the OPEN
 * cycle, for a reason that is structural: `isStreakAtRisk` and `isPositionInDispute` are both
 * false once the cycle is over — the streak has no tomorrow and the dispute died with the cycle —
 * so a strict reading silences two of the three pieces by construction and publishes six of the
 * nine sentences `design` wrote as dead code. The position the piece states is `rank_official`,
 * never a figure computed here. Reported to `produto` on #747 against BR-COMUNICACAO-017 item
 * 8.b; whichever way it is arbitrated, it is arbitrated in the rule and not here.
 */
async function dispatchRankingEmail(
  client: ReturnType<typeof createClient>,
  requestId: string,
  supabaseUrl: string,
  supabaseKey: string,
  decisions: RankingDecision[],
  streakDaysByUserId: Map<string, number>
): Promise<number> {
  if (decisions.length === 0) return 0;

  const { data, error } = await client
    .schema('marketing')
    .rpc('get_ranking_email_audience', { p_user_ids: decisions.map((d) => d.user_id) });

  if (error) {
    console.warn(
      `[${requestId}] 📭 ranking e-mail: ${decisions.length} recipient(s) resolved by the ` +
      `mechanism, but marketing.get_ranking_email_audience is unavailable (${error.code ?? '?'}). ` +
      'No e-mail sent. Expected until db-tuggiApp migration 20260917140000 is applied.'
    );
    return 0;
  }

  const relayVerifiedRaw = Deno.env.get('APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED');
  const plan = planRankingEmails({
    audience: (data ?? []) as RankingEmailAudienceRow[],
    decisions,
    streakDaysByUserId,
    relayDomainVerifiedRaw: relayVerifiedRaw,
  });

  // BR-COMUNICACAO-017 item 8.e — the ceiling is ONE piece per address per weekly cycle, and
  // this window evaluates every day, so without this the same person is reachable on every day
  // of the same cycle. The count is not readable and does not need to be: the only way to know
  // is to WIN the row, and `marketing.claim_ranking_email_slot` reserves and answers in one act
  // (db-tuggiApp `20260917160000`).
  //
  // The reservation is written BEFORE the send and is NEVER given back. A provider failure after
  // it costs one e-mail that does not leave; releasing the slot in the `catch` below would cost
  // two e-mails to the same person, and e-mail cannot be recalled.
  const claimErrorCodes = new Set<string>();
  const claimed = await claimRankingEmailSlots(plan, async (recipient) => {
    const { data, error } = await client.schema('marketing').rpc('claim_ranking_email_slot', {
      p_email: recipient.email,
      p_piece: recipient.piece,
      p_user_id: recipient.user_id,
    });
    // No proof of the reservation is no e-mail — item 8.e fails closed. Only the SQLSTATE is
    // kept: the message of an RPC error quotes the arguments, and the argument here is an
    // address. 55000 = no cycle in the snapshot, 22023 = missing argument, 23514 = unknown piece.
    if (error) {
      claimErrorCodes.add(String(error.code ?? '?'));
      return 'claim_failed';
    }
    return (data as { reserved?: boolean } | null)?.reserved === true
      ? 'reserved'
      : 'cycle_already_claimed';
  });

  if (claimErrorCodes.size > 0) {
    console.warn(
      `[${requestId}] 📭 ranking e-mail: the cycle slot could not be reserved, SQLSTATE ` +
      `${[...claimErrorCodes].sort().join(',')} — those recipients get nothing today.`
    );
  }

  // BR-COMUNICACAO-017 item 8.c — the log IS the act of confirmation of BR-COMUNICACAO-014 item
  // 9. That act exists for the CMS path, where a person presses a button; here there is no
  // button, and an automatic send with no trace is a send nobody can explain afterwards. It is
  // printed AFTER the reservation because the two ceilings of item 8.e are counted in it.
  console.log(`[${requestId}] 📭 ranking e-mail: ${rankingEmailAuditLine(claimed, relayVerifiedRaw)}`);

  if (claimed.recipients.length === 0) return 0;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-newsletter/ranking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
      },
      body: JSON.stringify({ recipients: claimed.recipients }),
    });
    if (!res.ok) {
      console.error(
        `[${requestId}] ❌ ranking e-mail: send-newsletter/ranking returned ${res.status} — ` +
        `${(await res.text()).slice(0, 300)}`
      );
      return 0;
    }
    const body = await res.json().catch(() => ({}));
    console.log(
      `[${requestId}] 📧 ranking e-mail: sent=${body.sent ?? 0} failed=${body.failed ?? 0} ` +
      `of ${claimed.recipients.length}`
    );
    return Number(body.sent ?? 0);
  } catch (err) {
    console.error(`[${requestId}] 💥 ranking e-mail: send failed:`, (err as Error).message);
    return 0;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  console.log(`[${requestId}] 🚀 Daily Gamification Orchestrator session started`);

  // Nada abaixo desta linha roda para chamador anonimo. Tudo o que esta funcao faz e efeito no
  // telefone ou na caixa de entrada de outra pessoa, entao o portao fica acima da PRIMEIRA
  // leitura — nao ha rota publica aqui para manter na frente dele, so o `OPTIONS` acima.
  const auth = await requireAdmin(req, { ...corsHeaders, 'Content-Type': 'application/json' });
  if (auth instanceof Response) {
    console.warn(`[${requestId}] ⛔ refused: ${auth.status}`);
    return auth;
  }

  try {
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
    const supabaseKey = (getSecretKey() ?? '').trim();
    
    // Every read and write of this function is in the `drive` schema.
    const driveClient = createClient(supabaseUrl, supabaseKey, {
      db: { schema: 'drive' }
    });

    // 1. Get Candidates (those at 07:00 AM local time)
    const { data: candidates, error: candidateError } = await driveClient
      .rpc('get_morning_push_candidates');

    if (candidateError) throw candidateError;
    if (!candidates || candidates.length === 0) {
      console.log(`[${requestId}] ℹ️ No candidates found for the current hour (7:00 AM local time check).`);
      return new Response(JSON.stringify({ success: true, message: 'No candidates for current hour' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${requestId}] 🎯 Found ${candidates.length} candidates to notify.`);

    // Calculate 'yesterday' to match the summary_date logic (CURRENT_DATE - 1)
    const yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    // Accounts whose day is closed: marked notified below, so the next hourly run skips them.
    const userIdsNotified: string[] = [];
    // Accounts that come back on the next hourly run: the one deferral of BR-COMUNICACAO-019
    // item 5, or a retry after a failed delivery. Both spend one `attempt_count`.
    const userIdsAgain: string[] = [];
    // O que volta ao chamador e CONTAGEM, nunca identidade: `results[]` devolvia o `user_id` real
    // de cada conta da janela mais o estado de ranking dela — dado pessoal pseudonimizado saindo
    // num corpo HTTP (BR-USUARIO-043). O detalhe por conta e do log, e la tambem sem apelido.
    const resultsByKind: Record<string, Record<string, number>> = {};
    const tally = (kind: string, outcome: string) => {
      const row = (resultsByKind[kind] ??= {});
      row[outcome] = (row[outcome] ?? 0) + 1;
    };

    // 1b. The ranking pieces of #747 ride this same window — BR-COMUNICACAO-012 item 1.4.e.
    const candidateIds = candidates.map((c: { user_id: string }) => c.user_id);
    const ranking = await collectRankingDispatch(driveClient, requestId, candidateIds);
    const rankingEmailSent = await dispatchRankingEmail(
      driveClient,
      requestId,
      supabaseUrl,
      supabaseKey,
      ranking.emailDecisions,
      ranking.streakDaysByUserId
    );

    // 1c. The attempts already spent on yesterday's row: the deferral happens once, never twice.
    const attemptsByUserId = new Map<string, number>();
    const { data: attemptRows, error: attemptErr } = await driveClient
      .from('daily_user_fomo_stats')
      .select('user_id, attempt_count')
      .in('user_id', candidateIds)
      .eq('summary_date', yesterdayDate);
    if (attemptErr) console.warn(`[${requestId}] ⚠️ attempt count read failed (${attemptErr.code ?? '?'}) — no deferral this run.`);
    for (const r of (attemptRows ?? []) as Array<Record<string, unknown>>) {
      attemptsByUserId.set(String(r.user_id), Number(r.attempt_count ?? 0));
    }

    // 2. Send Push directly via firebase-push-notification/send (EF-to-EF)
    const pushUrl = `${supabaseUrl}/functions/v1/firebase-push-notification/send`;
    let rankingSent = 0;

    for (const user of candidates) {
      // One piece per person per day, the most perishable (BR-COMUNICACAO-012 item 1.4.e), and
      // whether it may leave NOW is the gate's: cap, quiet hours, consent (BR-COMUNICACAO-019).
      const decision = ranking.byUserId.get(user.user_id);
      const rankingLang = normalizeCopyLang(user.language);
      const rankingCopy = decision
        ? resolveRankingPushCopy(
            decision.piece,
            rankingLang,
            // `{{rank}}` arrives already formatted as the ordinal of `rankingLang`, and
            // `{{count}}` only exists for whoever has a measured live streak — see
            // `rankingCopyVars`. Both are facts about this recipient and nobody else.
            rankingCopyVars(decision.piece, rankingLang, {
              rank: decision.rank,
              points: decision.points,
              streakDays: ranking.streakDaysByUserId.get(user.user_id) ?? null,
            })
          )
        : null;

      // Copy missing = the piece does NOT leave. Nothing else takes the slot any more.
      if (decision && !rankingCopy) {
        console.log(
          `[${requestId}] 🔇 ranking: '${decision.piece}' has no copy in ` +
          `'${rankingLang}' — piece withheld.`
        );
      }

      const rankingPayload = rankingCopy && decision ? {
        type: 'user',
        userIds: [user.user_id],
        // The kind the gate counts (`_shared/push-gate.ts`, `PUSH_KINDS`).
        push_kind: RANKING_PUSH_TYPE[decision.piece],
        notification: {
          title: rankingCopy.title,
          body: rankingCopy.body,
          // `data.rank` is what the NEXT evaluation reads back to know whether this account
          // dropped — a drop is measured against what the recipient was told. It is the
          // recipient's own position and nothing else: no total, no neighbour, no denominator
          // (BR-RANKING-002).
          data: {
            type: RANKING_PUSH_TYPE[decision.piece],
            source: 'ranking',
            date: new Date().toISOString().split('T')[0],
            deeplink: RANKING_DEEPLINK[decision.piece],
            ...(decision.rank === null ? {} : { rank: decision.rank }),
          },
        },
        priority: 'high',
        ttl: 86400,
      } : null;

      // Nothing to push today: the day is closed for this account.
      if (!rankingPayload || !decision) {
        userIdsNotified.push(user.user_id);
        continue;
      }
      const kind = decision.piece;

      let outcome: string;
      try {
        const pushResponse = await fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey
          },
          body: JSON.stringify(rankingPayload)
        });

        if (!pushResponse.ok) {
          const errText = await pushResponse.text();
          throw new Error(`Edge Function returned a non-2xx status code: ${pushResponse.status} ${pushResponse.statusText} - ${errText.slice(0, 300)}`);
        }
        // A `/send` deployed before #955 answers without `gate`; a 2xx from it was a send.
        outcome = singleGateOutcome(await pushResponse.json()) ?? 'sent';
      } catch (pushErr) {
        // Sem user_id no log (BR-USUARIO-043).
        console.error(`[${requestId}] ⚠️ Push (${kind}) failed:`, (pushErr as Error).message);
        outcome = 'error';
      }

      tally(kind, outcome);
      if (outcome === 'sent') rankingSent += 1;
      // The gate answered "denied" at the first evaluation of the day — 07:00 local, inside the
      // quiet hours — so the piece is evaluated once more on the next hourly run, from scratch:
      // a streak that stopped being true by then is not chosen again (BR-COMUNICACAO-019 item 5).
      const step = dailyWindowStep(outcome, attemptsByUserId.get(user.user_id) ?? (attemptErr ? 1 : 0));
      if (step === 'close') userIdsNotified.push(user.user_id);
      else userIdsAgain.push(user.user_id);
    }

    for (const userId of userIdsAgain) {
      await driveClient.rpc('increment_fomo_attempt', { p_user_id: userId, p_date: yesterdayDate });
    }

    // 3. Mark cache as notified to avoid double-send
    if (userIdsNotified.length > 0) {
      console.log(`[${requestId}] 📝 Marking ${userIdsNotified.length} users notified for ${yesterdayDate}`);
      
      const { error: updateError } = await driveClient
        .from('daily_user_fomo_stats')
        .update({ notified_at: new Date().toISOString() })
        .in('user_id', userIdsNotified)
        .eq('summary_date', yesterdayDate);
      
      if (updateError) {
        console.error(`[${requestId}] ❌ Error marking notified candidates:`, updateError.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[${requestId}] ✅ Orchestration finished in ${duration}ms. Ranking pushes sent: ${rankingSent}, ` +
      `closed: ${userIdsNotified.length}, again next hour: ${userIdsAgain.length}, of ${candidates.length}`
    );

    return new Response(JSON.stringify({
      success: true,
      sent: rankingSent,
      closed: userIdsNotified.length,
      again: userIdsAgain.length,
      total: candidates.length,
      ranking_sent: rankingSent,
      ranking_email_sent: rankingEmailSent,
      results_by_kind: resultsByKind
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error(`[${requestId}] 💥 Error:`, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
