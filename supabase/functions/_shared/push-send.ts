/**
 * The one push sender of the CMS functions: what `firebase-push-notification/send` does, as a
 * function (BR-COMUNICACAO-019 item 9, #955; #1046).
 *
 * `/send` answers HTTP with what `send` returns, and `weekly-local-push` calls `send` in its own
 * process. Calling `/send` over HTTP from another function spent the Supabase budget of
 * function-to-function calls per trace, which threw `RateLimitError` from the 62nd person of a
 * weekly run on (https://supabase.com/docs/guides/functions/recursive-functions). Both callers go
 * through the same gate (`sendThroughPushGate`), inbox row, `delivery_error`, `notification_logs`
 * row and token deactivation, because there is one copy of the code.
 *
 * No remote import: the caller passes its own supabase client, already holding the machine key.
 * `FIREBASE_*` are read from the environment when a sender is created.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { partnerStrings, type PartnerEvent } from './partner-i18n.ts';
import { resolveDeeplink } from './notification-deeplink.ts';
import {
  fcmErrorCode,
  isDeadRegistration,
  isSenderPayloadError,
  isUnclassifiedNotFound,
  sampledSendOrder,
  shouldAbortForBadPayload,
} from './fcm-errors.ts';
import {
  emptyGateTally,
  parsePushKind,
  PUSH_KINDS,
  pushGateRequest,
  readActiveWindowDays,
  sendThroughPushGate,
  type PushGateOutcome,
  type PushKind,
} from './push-gate.ts';

/**
 * PER-LANGUAGE COPY — the payload this function accepts, and what it promises.
 *
 * `notification.title`/`body` stay the single-language form and are unchanged. When the caller
 * ALSO sends `localized`, it is a map of language code to copy:
 *
 *   {
 *     type: 'broadcast',
 *     filters: { ...AudienceFilters },              // `language` is set by us, per pass
 *     notification: { title, body, data: { type: '…' } },
 *     localized: { pt: { title, body }, en: { title, body }, it: { title, body } }
 *   }
 *
 * What it does depends on the send type, and the difference is structural, not a choice:
 *
 *  - `type: 'user'` — ONE message, so `lang` picks one entry: `localized[lang] ?? notification`.
 *  - `type: 'broadcast'` — a broadcast is one FCM message per token but one COPY per message, so
 *    a mixed-language audience cannot be served by a single pass. The function runs ONE PASS PER
 *    KEY of `localized`, each narrowing `filters.language` to that key
 *    (`core.build_audience_filter` allowlists `language`), and logs one row per pass.
 *
 * A LANGUAGE THAT IS NOT A KEY RECEIVES NOTHING. There is deliberately no silent fallback to
 * `notification`: `core.build_audience_filter` has no "everything else" operator, so a fallback
 * pass could only be "the whole base again", which would double-send everyone already covered.
 * Which languages go out is the composer's decision and it is visible in the result.
 *
 * The copy itself is the `design`'s (§1) — this function only carries it.
 */
interface LocalizedCopy {
  title: string;
  body?: string;
}

function pickLocalized(
  notification: any,
  localized: Record<string, LocalizedCopy> | undefined,
  lang: string | undefined
): any {
  const key = (lang || '').slice(0, 2).toLowerCase();
  const copy = key && localized ? localized[key] : undefined;
  if (!copy?.title) return notification;
  return { ...notification, title: copy.title, body: copy.body ?? notification?.body };
}

/**
 * FCM's `data` map is `map<string, string>` — every value must be a string.
 *
 * A number or a boolean in there makes FCM answer INVALID_ARGUMENT for EVERY token, which is the
 * failure `shouldAbortForBadPayload` exists to stop after a sample. The CMS composer is now
 * sending `data.type` along with whatever else the operator typed, so the coercion happens here,
 * once, instead of being a class of outage waiting on a composer field.
 */
function stringifyData(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data || typeof data !== 'object') return out;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/** `delivery_error` when the person had no active device, so FCM was never asked (#1052). */
const NO_ACTIVE_TOKEN = 'NO_ACTIVE_TOKEN';
/** `delivery_error` when the send threw before or around FCM (OAuth exchange, network). */
const SEND_EXCEPTION = 'SEND_EXCEPTION';

/**
 * `drive.user_notifications.delivery_error` (#1052): the distinct codes, sorted, comma separated.
 * Anything that is not an upper-case code reads UNKNOWN, so no token, message or id reaches the
 * column whatever FCM answers.
 */
function deliveryErrorOf(codes: string[]): string {
  const clean = new Set(codes.map((c) => (/^[A-Z_]{1,64}$/.test(c) ? c : 'UNKNOWN')));
  return [...clean].sort().join(',') || 'UNKNOWN';
}

/** What `/send` answers: the HTTP status and the JSON body, the same for both callers. */
export interface PushSendAnswer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * One sender per request (or per weekly run). It holds the OAuth token of the run and the active
 * window read, so a run with many people pays each of them once.
 */
export function createPushSender(supabase: any, requestId: string) {
  const FIREBASE_PROJECT_ID = (Deno.env.get('FIREBASE_PROJECT_ID') ?? '').trim();
  const FIREBASE_PRIVATE_KEY = (Deno.env.get('FIREBASE_PRIVATE_KEY') ?? '').trim();
  const FIREBASE_CLIENT_EMAIL = (Deno.env.get('FIREBASE_CLIENT_EMAIL') ?? '').trim();

  // Diagnostics
  if (!FIREBASE_PRIVATE_KEY) console.error(`[${requestId}] ❌ FIREBASE_PRIVATE_KEY is missing`);
  if (!FIREBASE_PROJECT_ID) console.error(`[${requestId}] ❌ FIREBASE_PROJECT_ID is missing`);

  // Helper: JWT Creation
  const createAccessToken = async () => {
    console.log(`[${requestId}] 🔑 Generating Firebase Access Token...`);
    
    if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
      throw new Error('Firebase credentials not configured');
    }

    // 1. Clean up private key aggressively
    console.log(`[${requestId}] 🧹 Cleaning PEM key...`);
    let pemContents = FIREBASE_PRIVATE_KEY
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\\n/g, '\n') // Maintain internal newlines if escaped
      .replace(/[\s]/g, '') // Remove all whitespaces (important for Base64)
      .trim();

    // 2. Fix padding if necessary
    while (pemContents.length % 4 !== 0) {
      pemContents += '=';
    }

    console.log(`[${requestId}] 🛠 Cleaned length: ${pemContents.length}`);

    // 3. Decode Base64 to Binary
    let binaryDer;
    try {
      const binaryDerString = atob(pemContents);
      binaryDer = new Uint8Array(binaryDerString.length);
      for (let i = 0; i < binaryDerString.length; i++) {
        binaryDer[i] = binaryDerString.charCodeAt(i);
      }
    } catch (e) {
      console.error(`[${requestId}] ❌ Final atob failure:`, (e as Error).message);
      throw new Error(`Invalid FIREBASE_PRIVATE_KEY format: ${(e as Error).message}`);
    }

    // 3. Import Key
    const key = await crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // 4. Create JWT Payload
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: FIREBASE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

    const encodeBase64Url = (str: string) => btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const headerPart = encodeBase64Url(JSON.stringify(header));
    const payloadPart = encodeBase64Url(JSON.stringify(payload));
    
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      encoder.encode(`${headerPart}.${payloadPart}`)
    );

    const signatureArray = new Uint8Array(signature);
    let binarySignature = '';
    for (let i = 0; i < signatureArray.length; i++) {
      binarySignature += String.fromCharCode(signatureArray[i]);
    }
    const signaturePart = btoa(binarySignature).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const jwt = `${headerPart}.${payloadPart}.${signaturePart}`;

    // 5. Exchange JWT for Access Token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`[${requestId}] ⚠️ Google Auth token exchange failed:`, JSON.stringify(data));
      throw new Error(`Firebase Auth Failed: ${JSON.stringify(data)}`);
    }
    
    console.log(`[${requestId}] 🔑 Google Access Token generated successfully.`);
    return data.access_token;
  };

  // Helper: Construct Multi-platform Message
  const constructMessage = (notification: any, priority: string, ttl: number) => {
    return {
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.imageUrl && { image: notification.imageUrl }),
      },
      // Coerced, because FCM's data map takes strings only — see `stringifyData`.
      data: stringifyData(notification.data),
      android: {
        priority: priority === 'high' ? 'high' : 'normal',
        ttl: `${ttl}s`,
        notification: {
          sound: 'default',
          ...(notification.badge !== undefined && { notificationCount: notification.badge }),
        },
      },
      apns: {
        headers: { 
          'apns-priority': priority === 'high' ? '10' : '5',
          'apns-push-type': 'alert'
        },
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            'mutable-content': 1,
            sound: 'default',
            ...(notification.badge !== undefined && { badge: notification.badge }),
          },
        },
      },
    };
  };

  // One OAuth exchange per run. The gated send calls `sendNotification` once per person, and a
  // token exchange per person would cost one Google round trip for each of them.
  let accessTokenPromise: Promise<string> | null = null;
  // A failed exchange is not kept: the next person asks again instead of inheriting the failure.
  const getAccessToken = () =>
    (accessTokenPromise ??= createAccessToken().catch((e) => {
      accessTokenPromise = null;
      throw e;
    }));

  // Helper: Send Notification
  // `brake` is shared by every call of one run: a gated send calls this once per person, and a
  // brake that reset per person would never see the 50-attempt sample of `shouldAbortForBadPayload`.
  const sendNotification = async (
    tokens: string[],
    notification: any,
    priority: string,
    ttl: number,
    brake: { invalid: number; attempted: number } = { invalid: 0, attempted: 0 }
  ) => {
    if (tokens.length === 0) return { success: 0, failure: 0, errors: [], codes: [], aborted: null };
    
    const accessToken = await getAccessToken();
    const results = {
      success: 0,
      failure: 0,
      errors: [] as string[],
      // One FCM code per refused token, for `recordDeliveryFailure`. Codes only, never the token.
      codes: [] as string[],
      // Set only when the loop gave up on a payload FCM keeps rejecting; the
      // routes turn it into a non-2xx so the caller does not record a send.
      aborted: null as string | null,
    };
    const baseMessage = constructMessage(notification, priority, ttl);

    // A payload FCM rejects fails EVERY token with the same INVALID_ARGUMENT,
    // so the loop has to be able to stop itself instead of hammering FCM with
    // a request it already answered. See _shared/fcm-errors.ts for the number.

    // Walk the audience in random order. Any list built in SQL with
    // `array_agg(DISTINCT …)` comes back sorted, so its head is whatever sorts
    // first — rows anyone signed in can plant. Shuffling (here and over the
    // people in `gatedSendToUsers`) is what turns the window the brake measures
    // into a sample of the audience. See ABORT_MIN_SAMPLE.
    for (const token of sampledSendOrder(tokens)) {
      const message = { message: { ...baseMessage, token } };
      brake.attempted++;

      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        });

        const data = await res.json();
        if (res.ok) {
          results.success++;
        } else {
          const error = data.error?.message || 'Unknown';
          // The FCM code is in `details[].errorCode` / `status`, never in the
          // prose `message` — the old `message.includes(...)` matched neither.
          const code = fcmErrorCode(data);
          results.failure++;
          results.codes.push(code || 'UNKNOWN');
          results.errors.push(`Token ${token.substring(0, 8)}...: ${code || 'UNKNOWN'} ${error}`);
          console.error(`[${requestId}] ⚠️ FCM error for token ${token.substring(0, 8)}:`, JSON.stringify(data));

          if (isDeadRegistration(code)) {
            // The registration is gone (uninstall, revoked permission, 270
            // idle days) and will never be valid again: stop sending to it.
            await supabase.schema('drive').from('fcm_tokens').update({ is_active: false }).eq('fcm_token', token);
            console.log(`[${requestId}] 🧹 token ${token.substring(0, 8)} deactivated (${code})`);
          } else if (isUnclassifiedNotFound(code)) {
            // 404 with no `details[].errorCode`: NOT_FOUND is a google.rpc
            // status, not an FCM error code, and it is what a wrong
            // FIREBASE_PROJECT_ID or a deleted project answers for EVERY
            // token. Nothing is written to the token; the run is loud instead.
            console.error(
              `[${requestId}] 🚨 FCM 404 without an FCM errorCode — treated as systemic (project/endpoint), token KEPT ACTIVE — token=${token.substring(0, 8)} reason=${error}`
            );
          } else if (isSenderPayloadError(code)) {
            // INVALID_ARGUMENT indicts the REQUEST, not the token. Firebase:
            // it "signals an invalid registration only if the payload is
            // completely valid" — which we cannot prove from here. So the
            // token stays active and the failure is loud instead of silent.
            brake.invalid++;
            console.error(
              `[${requestId}] 🚨 FCM INVALID_ARGUMENT — sender-side payload error, token KEPT ACTIVE — token=${token.substring(0, 8)} reason=${error} count=${brake.invalid}/${brake.attempted}`
            );
            if (shouldAbortForBadPayload(brake.invalid, brake.attempted)) {
              results.aborted = `FCM rejected the payload: INVALID_ARGUMENT on ${brake.invalid} of ${brake.attempted} tokens. Send aborted, the rest of the audience not attempted, no token deactivated.`;
              results.errors.push(results.aborted);
              console.error(`[${requestId}] ⛔ ${results.aborted}`);
              break;
            }
          }
        }
      } catch (e) {
        results.failure++;
        results.codes.push(SEND_EXCEPTION);
        results.errors.push(`Token ${token.substring(0, 8)}...: ${(e as Error).message}`);
      }
    }
    return results;
  };

  // Logging helper
  //
  // `stats.success` and `stats.failure` are counted token by token in `sendNotification` and,
  // until 2026-09-10, went nowhere but `console.log`; the audience `filters` were dropped too.
  // The consequence was a history that showed "All Users" for EVERY broadcast, segmented or
  // not, with no counts beside it — a log that cannot answer "did it arrive?" is decoration.
  //
  // ⚠️ The four columns below are NEW and belong to the `data` agent (§2). Until that
  //    migration runs, `notification_logs` has no `success_count`, `failure_count`,
  //    `recipient_count` or `audience_filters`, and PostgREST rejects the WHOLE insert with
  //    PGRST204 — which would lose the log row that exists today. So the insert falls back to
  //    the old shape when it sees that code, loudly, instead of failing the send.
  const logResult = async (
    type: string,
    notification: any,
    userIds: string[],
    topic: string | undefined,
    status: string,
    stats: any,
    audienceFilters?: Record<string, unknown> | null,
    recipientCount?: number
  ) => {
    console.log(`[${requestId}] 📝 Logging result to marketing.notification_logs...`);
    try {
      // Ensure userIds are valid UUIDs to avoid DB errors
      const validUserIds = (userIds || []).filter(id => 
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      );

      const logData: any = {
        type,
        title: notification.title || 'No Title',
        body: notification.body || 'No Body',
        data: notification.data || {},
        user_ids: validUserIds,
        topic: topic || null,
        status,
        success_count: stats?.success ?? 0,
        failure_count: stats?.failure ?? 0,
        // How many devices the audience resolved to — NOT `user_ids.length`, which counts
        // inbox rows and is empty for a topic send.
        recipient_count: recipientCount ?? null,
        audience_filters: audienceFilters ?? null,
        sent_at: new Date().toISOString()
      };


      let { data: insertData, error } = await supabase
        .schema('marketing')
        .from('notification_logs')
        .insert(logData)
        .select();

      if (error?.code === 'PGRST204') {
        console.error(
          `[${requestId}] 🚨 notification_logs is missing the count columns — the migration for ` +
          'success_count/failure_count/recipient_count/audience_filters has not run. ' +
          `Logging without them. counts=${logData.success_count}/${logData.failure_count}`
        );
        const {
          success_count: _s,
          failure_count: _f,
          recipient_count: _r,
          audience_filters: _a,
          ...legacy
        } = logData;
        ({ data: insertData, error } = await supabase
          .schema('marketing')
          .from('notification_logs')
          .insert(legacy)
          .select());
      }

      if (error) {
        console.error(`[${requestId}] ❌ Supabase log error:`, error?.code ?? 'unknown');
      } else {
        console.log(`[${requestId}] ✅ Log created:`, insertData?.[0]?.id);
      }
    } catch (e) {
      console.error(`[${requestId}] 📝 Log function crashed:`, (e as Error).message);
    }
  };

  /**
   * BR-COMUNICACAO-019 items 4, 5 and 9 (#955): the push goes person by person through
   * `sendThroughPushGate`, so the cap counts people and `record_push_sent` follows what the
   * provider accepted for that person. `kind = null` is the partner push, which the rule does
   * not reach ("Não se aplica a: push ao parceiro").
   *
   * `persistInbox`: the inbox row is written only after the gate said yes, because the inbox
   * mirrors the pushes that left; a piece the gate held back goes to the opening notice
   * (item 6). A broadcast persists its inbox for the whole audience first (#858) and passes
   * `false`, with `skipWithoutDevice` so nobody without a device costs a gate call.
   */
  /**
   * #1052, BR-COMUNICACAO-022: the inbox row of a push nobody received says so, in
   * `delivery_failed_at` and `delivery_error`. "Not received" is the gate's `not_delivered`
   * (`deliverTo` resolved false: no active device, or FCM refused every token), the same
   * predicate the weekly sender writes to `weekly_push_sends`, so the two columns of the report
   * measure the same thing. Only rows this run wrote and holds the id of: a broadcast's inbox is
   * written in SQL by `broadcast_persist_inbox`, which answers people, not rows.
   *
   * A failed write is logged and the send goes on: the push already left (or did not), and the
   * report losing one row is cheaper than the caller retrying a send that went out.
   */
  const recordDeliveryFailure = async (notificationId: string, codes: string[]) => {
    const deliveryError = deliveryErrorOf(codes);
    const { error } = await supabase
      .schema('drive')
      .from('user_notifications')
      .update({ delivery_failed_at: new Date().toISOString(), delivery_error: deliveryError })
      .eq('id', notificationId);
    if (error) {
      console.error(`[${requestId}] ⚠️ delivery failure not recorded: ${error.code ?? '?'} (${deliveryError})`);
    }
  };

  const driveRpc = supabase.schema('drive');
  let activeWindowDays: number | null | undefined;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const gatedSendToUsers = async (
    userIds: string[],
    notification: any,
    kind: PushKind | null,
    priority: string,
    ttl: number,
    opts: { persistInbox: boolean; inboxType?: string; deeplink?: string | null; skipWithoutDevice: boolean }
  ) => {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).filter((id) => typeof id === 'string' && UUID_RE.test(id)))];
    const tally = emptyGateTally();
    const stats = { success: 0, failure: 0, errors: [] as string[], aborted: null as string | null };
    let tokenCount = 0;
    let unrecorded = 0;
    if (ids.length === 0) return { stats, tally, tokenCount };

    if (kind && PUSH_KINDS[kind].requiresActive && activeWindowDays === undefined) {
      activeWindowDays = await readActiveWindowDays(driveRpc);
    }

    // The devices of the whole audience, 200 people per read instead of two reads per person.
    const tokensByUser = new Map<string, Set<string>>();
    const addToken = (uid: unknown, tok: unknown) => {
      if (typeof uid !== 'string' || typeof tok !== 'string' || tok === '') return;
      if (!tokensByUser.has(uid)) tokensByUser.set(uid, new Set());
      tokensByUser.get(uid)!.add(tok);
    };
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const [fcmResult, profileResult] = await Promise.all([
        supabase.schema('drive').from('fcm_tokens').select('user_id, fcm_token').in('user_id', chunk).eq('is_active', true),
        supabase.schema('drive').from('profiles').select('id, push_token').in('id', chunk),
      ]);
      for (const t of fcmResult.data ?? []) addToken(t.user_id, t.fcm_token);
      for (const p of profileResult.data ?? []) addToken(p.id, p.push_token);
    }

    const brake = { invalid: 0, attempted: 0 };
    const deliverTo = async (uid: string): Promise<boolean> => {
      let notif = notification;
      let inboxId: string | null = null;
      if (opts.persistInbox) {
        const { data: inserted, error: insErr } = await supabase
          .schema('drive')
          .from('user_notifications')
          .insert({
            user_id: uid,
            type: opts.inboxType ?? 'generic',
            title: notification.title,
            body: notification.body ?? null,
            data: notification.data ?? {},
            deeplink: opts.deeplink ?? null,
          })
          .select('id')
          .single();
        if (insErr) {
          console.error(`[${requestId}] ⚠️ inbox persist failed:`, insErr.code ?? '?');
        } else if (inserted?.id) {
          inboxId = inserted.id;
          // The device acks delivery with this id (ack_notification_delivered).
          notif = { ...notif, data: { ...(notif.data || {}), notification_id: inserted.id } };
        }
      }
      // BADGE (SSOT = inbox): a single recipient gets the unread count on the app icon. A
      // multi-user send would pay one count per person, so it keeps the badge off.
      if (ids.length === 1 && notif && notif.badge === undefined) {
        const { count, error: cErr } = await supabase
          .schema('drive')
          .from('user_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', uid)
          .is('read_at', null);
        if (!cErr && typeof count === 'number' && count > 0) notif = { ...notif, badge: count };
      }
      const tokens = [...(tokensByUser.get(uid) ?? [])];
      if (tokens.length === 0) {
        if (inboxId) await recordDeliveryFailure(inboxId, [NO_ACTIVE_TOKEN]);
        return false;
      }
      tokenCount += tokens.length;
      let s: Awaited<ReturnType<typeof sendNotification>>;
      try {
        s = await sendNotification(tokens, notif, priority, ttl, brake);
      } catch (e) {
        if (inboxId) await recordDeliveryFailure(inboxId, [SEND_EXCEPTION]);
        throw e;
      }
      stats.success += s.success;
      stats.failure += s.failure;
      stats.errors.push(...s.errors);
      if (s.aborted) stats.aborted = s.aborted;
      if (s.success === 0 && inboxId) await recordDeliveryFailure(inboxId, s.codes);
      return s.success > 0;
    };

    // Random order for the same reason as the tokens (`sampledSendOrder`), and 10 people at a
    // time so a broadcast to the whole base fits the function's wall clock.
    const order = sampledSendOrder(ids);
    for (let i = 0; i < order.length && !stats.aborted; i += 10) {
      await Promise.all(order.slice(i, i + 10).map(async (uid) => {
        if (opts.skipWithoutDevice && !tokensByUser.has(uid)) {
          tally.not_delivered += 1;
          return;
        }
        if (!kind) {
          tally[(await deliverTo(uid)) ? 'sent' : 'not_delivered'] += 1;
          return;
        }
        const result = await sendThroughPushGate(
          driveRpc,
          pushGateRequest(uid, kind),
          activeWindowDays ?? null,
          () => deliverTo(uid)
        );
        tally[result.outcome] += 1;
        if (result.outcome === 'sent' && !result.recorded) unrecorded += 1;
      }));
    }

    // Counts only, never an id (BR-USUARIO-043). `denied` is consent, cap or quiet hours: the
    // SQL answers a boolean (BR-COMUNICACAO-019 item 6 wants the reason; asked of `data` on #955).
    console.log(
      `[${requestId}] 🚦 push gate kind=${kind ?? 'partner'} ${JSON.stringify(tally)}` +
      (unrecorded > 0 ? ` unrecorded=${unrecorded}` : '')
    );
    if (tally.gate_missing > 0) {
      console.warn(
        `[${requestId}] 🚧 drive.push_allowed is missing: ${tally.gate_missing} unrequested push(es) withheld. ` +
        'Expected until db-tuggiApp migration 20261019200200 is applied.'
      );
    }
    return { stats, tally, tokenCount };
  };

  /** The `/send` route: the body it receives, the answer it gives. Throws what `/send` threw (500). */
  const send = async (body: any): Promise<PushSendAnswer> => {
    let { notification } = body;
    const { type, userIds, topic, priority = 'normal', ttl = 3600, template, lang, data, filters } = body;

    // The partner push is the one push BR-COMUNICACAO-019 does not reach. It is recognised by
    // the template rendering its own copy: a caller that brings its own title is not a partner
    // template and goes through the gate like everybody else.
    const isPartnerTemplate = Boolean(template) && !notification?.title;

    // Localized partner-flow templates: when `template` is given and no explicit
    // notification.title was passed, render title/body from the shared i18n map.
    if (template && !notification?.title) {
      const event = String(template).replace(/^partner_/, '') as PartnerEvent;
      const s = partnerStrings(event, lang);
      notification = {
        title: s.push.title,
        body: s.push.body,
        data: notification?.data ?? data ?? {},
      };
      console.log(`[${requestId}] 🌐 Localized push template=${event} lang=${lang}`);
    }

    // Caller-supplied per-language copy, for the sends that are not a partner template. One
    // message, so `lang` picks one entry; a missing entry keeps `notification` as written.
    // A broadcast does NOT come through here — see the per-language pass loop below.
    if (body.localized && type !== 'broadcast') {
      notification = pickLocalized(notification, body.localized, lang);
    }

    const localized: Record<string, LocalizedCopy> | undefined = body.localized;
    const localizedLangs = localized ? Object.keys(localized) : [];

    // BR-COMUNICACAO-019 item 9 (#955): a push that does not pass the gate is a defect. A topic
    // reaches whoever subscribed with nobody counted, and a broadcast without its inbox has no
    // list of people to count — both are refused instead of sent around the cap.
    const refuse = (error: string, message: string): PushSendAnswer =>
      ({ status: 400, body: { success: false, error, message, requestId } });
    if (type === 'topic') {
      return refuse('TOPIC_NOT_GATED', 'A topic send cannot pass the per-person push cap.');
    }
    if (type === 'broadcast' && body.persist === false) {
      return refuse('BROADCAST_NEEDS_INBOX', 'A broadcast is capped person by person through its inbox rows.');
    }
    let userKind: PushKind | null = null;
    if (type === 'user' && !isPartnerTemplate) {
      userKind = body.push_kind === undefined ? 'cms_direct' : parsePushKind(body.push_kind);
      if (!userKind) return refuse('INVALID_PUSH_KIND', 'push_kind is not a known kind.');
    }

    let recipientCount = 0;
    let stats: { success: number; failure: number; errors: string[]; aborted: string | null } =
      { success: 0, failure: 0, errors: [], aborted: null };
    let gateTally: Record<PushGateOutcome, number> = emptyGateTally();
    let broadcastUserIds: string[] = [];

    /**
     * One broadcast pass: resolve the audience for `passFilters`, mirror it into the inbox,
     * and send. Extracted so the per-language loop and the single-copy path are the SAME code
     * — a second copy of the audience/inbox/send sequence is exactly the kind of drift §6
     * warns about.
     */
    const runBroadcastPass = async (passFilters: Record<string, unknown>, notif: any) => {
      // #955: the people of the audience are the inbox rows `broadcast_persist_inbox` writes for
      // every profile of the filter (#858); the push then goes person by person through the
      // gate, which also applies the consent `get_audience_push_tokens` used to apply in SQL.
      let passUserIds: string[] = [];
      if (notif?.title) {
        const notifType = notif?.data?.type ?? data?.type ?? 'generic';
        const deeplink = resolveDeeplink(notif?.data, data);
        const { data: inboxIds, error: inboxErr } = await supabase
          .schema('core')
          .rpc('broadcast_persist_inbox', {
            p_filters: passFilters,
            p_type: notifType,
            p_title: notif.title,
            p_body: notif.body ?? null,
            p_data: notif.data ?? {},
            p_deeplink: deeplink,
          });
        // Without the inbox there is nobody to count, so there is no push either.
        if (inboxErr) throw inboxErr;
        passUserIds = inboxIds || [];
        console.log(`[${requestId}] 📥 ${passUserIds.length} broadcast inbox rows persisted filters=${JSON.stringify(passFilters)}`);
      }

      const pass = await gatedSendToUsers(passUserIds, notif, 'cms_broadcast', priority, ttl, {
        persistInbox: false,
        skipWithoutDevice: true,
      });
      return { tokenCount: pass.tokenCount, userIds: passUserIds, stats: pass.stats, tally: pass.tally };
    };

    // ---- Per-language broadcast: one pass per key of `localized` ----
    //
    // See the `LocalizedCopy` note at the top for why this is N passes and not one message:
    // a broadcast carries ONE copy, so a mixed-language audience needs one narrowed pass per
    // language. Each pass logs its own `notification_logs` row, with its own filters and its
    // own counts — which is the only way the history can say what actually went where.
    if (type === 'broadcast' && localizedLangs.length > 0) {
      const passes: any[] = [];
      let aborted: string | null = null;

      for (const lang of localizedLangs) {
        const passFilters = { ...(filters ?? {}), language: lang };
        const notif = pickLocalized(notification, localized, lang);
        const pass = await runBroadcastPass(passFilters, notif);

        const passStatus = pass.stats.aborted
          ? 'failed'
          : pass.stats.success > 0
            ? (pass.stats.failure > 0 ? 'partial' : 'sent')
            : 'failed';
        await logResult(
          type, notif, pass.userIds, topic, passStatus, pass.stats, passFilters, pass.tokenCount
        );
        passes.push({
          language: lang,
          recipients: pass.tokenCount,
          gate: pass.tally,
          success: pass.stats.success,
          failure: pass.stats.failure,
          status: passStatus,
          ...(pass.stats.aborted ? { aborted: pass.stats.aborted } : {}),
        });
        // A payload FCM refuses is refused in every language: stop instead of repeating it.
        if (pass.stats.aborted) { aborted = pass.stats.aborted; break; }
      }

      if (aborted) {
        return {
          status: 400,
          body: { success: false, error: 'FCM_PAYLOAD_REJECTED', message: aborted, requestId, passes },
        };
      }
      return { status: 200, body: { success: true, passes } };
    }

    if (type === 'user') {
      // One inbox row per recipient the gate let through — the Notification Center mirrors
      // every user-targeted push that left. `persist` defaults true; routes never reach this
      // EF (in-app toasts) so they're naturally excluded. Each row id rides in the FCM data so
      // the device can ack delivery (ack_notification_delivered).
      const notifType = template
        ? `partner_${String(template).replace(/^partner_/, '')}`
        : (notification?.data?.type ?? data?.type ?? 'generic');
      // Same resolver as the two broadcast paths below — this one used to
      // read `deeplink` only, so a link typed in the CMS composer (which
      // emits `data.url`) reached the device but never the inbox row.
      const deeplink = resolveDeeplink(notification?.data, data);
      const sent = await gatedSendToUsers(userIds, notification, userKind, priority, ttl, {
        persistInbox: body.persist !== false && Boolean(notification?.title),
        inboxType: notifType,
        deeplink,
        skipWithoutDevice: false,
      });
      stats = sent.stats;
      gateTally = sent.tally;
      recipientCount = sent.tokenCount;
    } else if (type === 'broadcast') {
      // Audience is resolved in SQL (core.build_audience_filter, through
      // broadcast_persist_inbox) so platform/language/tier filters are applied via the
      // profiles table. Empty filters → whole base.
      const pass = await runBroadcastPass(filters ?? {}, notification);
      recipientCount = pass.tokenCount;
      broadcastUserIds = pass.userIds;
      stats = pass.stats;
      gateTally = pass.tally;
    }

    const logUserIds = type === 'broadcast' ? broadcastUserIds : userIds;
    // An aborted run is a failure even if the first tokens went through: the
    // audience was NOT reached and the log must not claim it was.
    // `partial` is new in `20260910_02_notification_logs_counters.sql`, and it exists because
    // "some devices got it" is neither `sent` nor `failed`. An ABORTED run is never partial:
    // the audience was not reached and the log must not suggest a judgement call about it.
    const sendStatus = stats.aborted
      ? 'failed'
      : stats.success > 0
        ? (stats.failure > 0 ? 'partial' : 'sent')
        : 'failed';
    await logResult(
      type,
      notification,
      logUserIds,
      topic,
      sendStatus,
      stats,
      // The history showed "All Users" for every broadcast because the segment was never
      // written down. A `user`/`topic` send has no audience filter, and null says so.
      type === 'broadcast' ? (filters ?? {}) : null,
      recipientCount
    );

    if (stats.aborted) {
      // 400, not 500: the request is what FCM refused, so retrying it
      // unchanged will fail the same way. The daily orchestrator keys off
      // `response.ok`, so a non-2xx also stops it from marking users notified.
      return {
        status: 400,
        body: {
          success: false,
          error: 'FCM_PAYLOAD_REJECTED',
          message: stats.aborted,
          requestId,
          result: stats,
        },
      };
    }

    return { status: 200, body: { success: true, result: stats, gate: gateTally } };
  };

  return { send, gatedSendToUsers, logResult };
}

export type PushSender = ReturnType<typeof createPushSender>;
