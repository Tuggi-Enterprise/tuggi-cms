
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey } from '../_shared/supabase-client.ts';
// The copy of this push lives in _shared/daily-push-i18n.ts, outside this file,
// because this one imports a remote URL and therefore cannot be loaded by a
// test. Spec: docs/design/copy-push-diario-2026-08.md.
import { getTranslation } from '../_shared/daily-push-i18n.ts';
// The ranking pieces of #747 ride THIS daily window and never schedule one of their own —
// BR-COMUNICACAO-012 item 1.4.e. The decision of who gets what lives in `_shared`, pure and
// tested (`tests/api/ranking-communication.test.ts`); this file only reads, dispatches and logs.
import {
  buildRankingDispatch,
  RANKING_PUSH_TYPE,
  RANKING_PUSH_TYPES,
  type RankingDecision,
  type RankingPiece,
  type RecipientConsent,
  type ScoreboardWeekRow,
} from '../_shared/ranking-communication.ts';
import {
  mailableEmailLang,
  normalizeCopyLang,
  rankingCopyVars,
  resolveRankingPushCopy,
} from '../_shared/ranking-comm-i18n.ts';

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
    });
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
 * It resolves the address through the audience resolver that already exists, so
 * `marketing.email_unsubscribes` keeps being the single unsubscribe list (item 5), and it refuses
 * `@privaterelay.appleid.com` while the sending domain is unverified (item 6.a — "not verified
 * equals not sent").
 *
 * **The send itself is not wired, and the reason is a missing database object, not a decision**:
 * `marketing.get_newsletter_audience` takes only the allowlisted filter keys of
 * `core.build_audience_filter`, which has no list-of-ids and no `ranking_opt_in`, and
 * `send-newsletter` carries ONE content for a whole campaign — neither can express "this piece,
 * to these accounts". What it needs is in the final report of #747. Until then this logs the
 * audience it would have mailed, which is what makes the gap countable instead of invisible.
 */
async function reportRankingEmailAudience(
  client: ReturnType<typeof createClient>,
  requestId: string,
  decisions: RankingDecision[]
): Promise<number> {
  if (decisions.length === 0) return 0;

  const { data, error } = await client
    .schema('marketing')
    .rpc('get_ranking_email_audience', { p_user_ids: decisions.map((d) => d.user_id) });

  if (error) {
    console.warn(
      `[${requestId}] 📭 ranking e-mail: ${decisions.length} recipient(s) resolved by the ` +
      `mechanism, but marketing.get_ranking_email_audience is unavailable (${error.code ?? '?'}). ` +
      'No e-mail sent. See #747 for the object this needs.'
    );
    return 0;
  }

  const relayVerified = String(Deno.env.get('APPLE_PRIVATE_RELAY_DOMAIN_VERIFIED') ?? '').trim().toLowerCase() === 'true';
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const relay = rows.filter((r) => String(r.email ?? '').toLowerCase().endsWith('@privaterelay.appleid.com'));
  // `fr` is NOT in this audience — spec §2.1. The promotional sender publishes four languages in
  // its three dictionaries (`FOOTER_LABELS`, `FALLBACK_NAME`, `SITE_LOCALE`) and French is in
  // none of them, so a French recipient would read a Portuguese footer and be called `traveler`,
  // in English. Turning it on is three lines in two files and it is a card of its own (spec §8
  // item 4). Counting them as mailable is how a whole language gets sent by accident.
  const unservedLang = rows.filter((r) => mailableEmailLang(r.language as string | null) === null);
  const excluded = new Set<Record<string, unknown>>([...(relayVerified ? [] : relay), ...unservedLang]);
  const mailable = rows.length - excluded.size;

  console.log(
    `[${requestId}] 📭 ranking e-mail: ${mailable} mailable, ${relay.length} on Apple relay ` +
    `(domain verified: ${relayVerified}), ${unservedLang.length} in a language the sender does ` +
    'not publish.'
  );
  return mailable;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  console.log(`[${requestId}] 🚀 Daily Gamification Orchestrator session started`);

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
    const userIdsNotified = [];
    const results = [];

    // 1b. The ranking pieces of #747 ride this same window — BR-COMUNICACAO-012 item 1.4.e.
    const candidateIds = candidates.map((c: { user_id: string }) => c.user_id);
    const ranking = await collectRankingDispatch(driveClient, requestId, candidateIds);
    await reportRankingEmailAudience(driveClient, requestId, ranking.emailDecisions);

    // 2. Send Push directly via firebase-push-notification/send (EF-to-EF)
    const pushUrl = `${supabaseUrl}/functions/v1/firebase-push-notification/send`;
    let rankingSent = 0;

    for (const user of candidates) {
      const i18n = getTranslation(user.language);

      const messageBody = user.heard_count > 0
        ? i18n.body(user.nickname || i18n.fallback, user.heard_count, user.missed_count)
        : i18n.body_zero_heard(user.nickname || i18n.fallback, user.missed_count);

      // THE DAILY SLOT IS ONE, AND THE RANKING TAKES IT — BR-COMUNICACAO-014 item 4: a ranking
      // piece is a service push (item 2.2) and `daily_fomo` is promotional (item 2.3), so the
      // retrospective is the one that yields. This is not a second send: it is the same slot,
      // carrying the more urgent of the two.
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

      // Copy missing = the piece does NOT leave, and the slot goes back to the retrospective.
      // The catalogue in `_shared/ranking-comm-i18n.ts` is empty until `design` fills it, so this
      // is today's normal path and not an error.
      if (decision && !rankingCopy) {
        console.log(
          `[${requestId}] 🔇 ranking: '${decision.piece}' has no copy in ` +
          `'${rankingLang}' — piece withheld.`
        );
      }

      // The ranking piece, when there is one AND it has copy. Built beside the retrospective and
      // not in place of it: `payload` below stays a plain literal so the source ruler of
      // `tests/api/edge-daily-push-copy.test.ts` keeps reading the `daily_fomo` data bag.
      const rankingPayload = rankingCopy && decision ? {
        type: 'user',
        userIds: [user.user_id],
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

      try {
        const payload = {
          type: 'user',
          userIds: [user.user_id],
          notification: {
            title: i18n.title,
            body: messageBody,
            // `type` is NOT decoration. The app only records an open when
            // `data.type` is present (firebaseMessaging.ts, both
            // onNotificationOpenedApp and getInitialNotification), so without it
            // this push produced zero open events since it shipped; and
            // firebase-push-notification writes `data.type ?? 'generic'` into
            // drive.user_notifications.type, so every daily row landed in the
            // inbox as `generic`. snake_case, like `partner_approved`.
            // deeplink → app opens the Explore/Discover sheet on nearby
            // attractions so the tap lands somewhere actionable (was: no
            // deeplink → fell into the inbox and went nowhere on tap).
            data: {
              type: 'daily_fomo',
              source: 'daily-fomo',
              date: new Date().toISOString().split('T')[0],
              deeplink: 'tuggi://map',
            }
          },
          priority: 'high',
          ttl: 86400
        };

        const pushResponse = await fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey
          },
          body: JSON.stringify(rankingPayload ?? payload)
        });

        if (!pushResponse.ok) {
          const errText = await pushResponse.text();
          throw new Error(`Edge Function returned a non-2xx status code: ${pushResponse.status} ${pushResponse.statusText} - ${errText}`);
        }

        const pushResult = await pushResponse.json();

        const kind = rankingPayload && decision ? decision.piece : 'daily_fomo';
        if (rankingPayload) rankingSent += 1;
        console.log(`[${requestId}] 📲 Push (${kind}) to ${user.nickname}: Success`, JSON.stringify(pushResult));
        results.push({ user_id: user.user_id, status: 'sent', kind });
        userIdsNotified.push(user.user_id);

      } catch (pushErr: any) {
        console.error(`[${requestId}] ⚠️ Push failed for ${user.user_id}:`, pushErr.message);
        results.push({ user_id: user.user_id, status: 'error', error: pushErr.message });
        await driveClient.rpc('increment_fomo_attempt', { p_user_id: user.user_id, p_date: yesterdayDate });
      }
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
    console.log(`[${requestId}] ✅ Orchestration finished in ${duration}ms. Sent: ${userIdsNotified.length}/${candidates.length}`);

    return new Response(JSON.stringify({
      success: true,
      sent: userIdsNotified.length,
      total: candidates.length,
      ranking_sent: rankingSent,
      results
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
