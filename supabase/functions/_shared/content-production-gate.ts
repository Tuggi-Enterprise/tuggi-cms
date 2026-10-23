/**
 * BR-CONTEUDO-003 — produzir conteúdo é direito de quem tem direito de ligar o
 * guia, e **a recusa é da plataforma, não da tela** (item 5).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Producing content spends money per request: one LLM call plus one TTS call,
 * per POI × language. From 2026-08-05 to 2026-08-31 anyone in any state could
 * spend it; since 2026-08-31 only whoever may turn the guide on can. A gate
 * that lives only in the app is not a gate — the published 2.0 build has no
 * OTA (BR-OPERACAO-002), a forged request never runs our JavaScript, and
 * `verify_jwt` answers "who", never "may". So the two functions that spend the
 * money ask here, in their own body, before the first token is bought.
 *
 * THE LIST IS NOT NEW, AND IT IS NOT COPIED (CLAUDE.md §6)
 * -------------------------------------------------------
 * `metered`, `unlimited` — the second condition of BR-MONETIZACAO-049 item 2,
 * which is the same list as BR-MONETIZACAO-055. The resolution of that state
 * has ONE implementation and it is `drive.get_entitlement`
 * (BR-MONETIZACAO-046, `docs/contracts/entitlement.md`): this module calls it
 * and reads `state`. It does not rank, recompute or derive anything, and it
 * never reads the tier label — `free`/`premium`/`pro` decide nothing.
 *
 * THE THIRD CONDITION IS NOT VISIBLE FROM HERE, AND THAT IS WRITTEN DOWN
 * ---------------------------------------------------------------------
 * Item 1 also admits an **open receipt window** (BR-MONETIZACAO-075). That
 * window is a fact OF THE DEVICE that witnessed the store receipt: item 5 of
 * that rule says it produces no state, writes nothing and is not a fourth
 * value of `get_entitlement`, and its edge case says it does not even
 * propagate to a second device of the same account. So the server cannot
 * observe it, and this gate refuses a tourist who paid seconds ago and whose
 * grant has not landed yet. Measured window in production is ~4 s (the app
 * calls `validate-apple-purchase` / `validate-google-purchase` itself, which
 * writes the grant), and the 24 h ceiling only covers a lost webhook. The app
 * gate DOES see the receipt and lets him through, so what he loses is the
 * production, not the access. Registered in `docs/contracts/edge-functions.md`
 * and in the #630 card — do not "fix" it by trusting a receipt sent in the
 * body: a receipt the client asserts is not a receipt the server witnessed.
 *
 * THE GUEST IS ASKED THE SAME QUESTION AS ANY TOURIST (#1021)
 * ------------------------------------------------------------
 * From #1007 to #1021 a guest (Anonymous Sign-Ins, `is_anonymous`) was
 * refused with its own `account_required` before the state was read. On
 * 2026-10-23 the operator decided the guest buys hours and turns the guide on
 * without creating an account, so item 1 of BR-CONTEUDO-003 is read for him
 * like for anyone: `get_entitlement` answers, and `state` decides. A guest with
 * purchased balance is `metered` and produces; a guest without it is `free`
 * and gets the same `not_entitled` as a permanent account. The account is not
 * a condition here, the paid state is. What survives from #1007 is that a
 * guest is never the CMS operator nor the platform, whatever role the request
 * carries: he is always the tourist whose state is read.

 * AN UNRESOLVED STATE REFUSES, AND THE REFUSAL SAYS IT FAILED (#1007)
 * ------------------------------------------------------------------
 * Until 2026-10-22 an unreachable `get_entitlement` ALLOWED the production,
 * read from the entitlement contract's "não trata erro como `free`". That line
 * protects the tourist's STATE on the device, and nothing here touches it: the
 * answer is 503 `entitlement_unavailable`, a failure the caller retries, never
 * the 403 that says "you may not". So nobody is downgraded, and an outage of
 * the database no longer opens the paid generators to every token. Error,
 * timeout, a row without `state`, missing env and a thrown exception are the
 * same answer. Decided by the Tech Lead on the #1007 card.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { getSecretKey } from './secret-key.ts';
import type { AuthResult } from './auth-middleware.ts';

/**
 * Who is asking. The names are the ones `generate-description` already stamps
 * on `generated_by.source`, and they live here now so the two functions do not
 * classify the same caller twice with two different spellings.
 */
export type ProductionRequesterSource = 'system' | 'cms_admin' | 'app_user';

/** CMS roles that authorise a human-requested production (BR-CONTEUDO-004 item 2.b). */
const CMS_ROLES = ['admin', 'super_admin', 'editor'];

export function classifyProductionRequester(
  role: string | undefined,
): ProductionRequesterSource {
  if (role === 'service_role') return 'system';
  if (role && CMS_ROLES.includes(role)) return 'cms_admin';
  return 'app_user';
}

/** Why a production was refused. Each one is a distinct answer to the app (see the response). */
export type ProductionRefusal = 'not_entitled' | 'entitlement_unavailable';

export interface ProductionGateDecision {
  /** May this request spend LLM or TTS? */
  allowed: boolean;
  source: ProductionRequesterSource;
  /**
   * The state `drive.get_entitlement` answered, or `'unresolved'` when the
   * call failed (which is NOT `free` and never becomes it).
   */
  state: 'unlimited' | 'metered' | 'free' | 'unresolved' | 'not_applicable';
  /** Present exactly when `allowed` is false. */
  refusal?: ProductionRefusal;
}

/** The states that carry the right to turn the guide on, hence to produce. */
const PAID_STATES = ['unlimited', 'metered'];

/**
 * How long the gate waits for `drive.get_entitlement`. The routine reads one
 * profile and the ledger of one account, so a healthy answer is milliseconds;
 * past this, the database is in trouble and the caller is told to retry
 * instead of holding the request until the platform kills it.
 */
export const ENTITLEMENT_TIMEOUT_MS = 5000;

/** The PostgREST envelope, reduced to what the gate reads. */
export interface EntitlementReadResult {
  data: unknown;
  error: { code?: string } | null;
}

export type EntitlementReader = (
  userId: string,
  signal: AbortSignal,
) => Promise<EntitlementReadResult>;

export interface ProductionGateOptions {
  /** Replaces the database call. Tests only; production uses the default. */
  readEntitlement?: EntitlementReader;
  timeoutMs?: number;
}

/** `null` when the env to reach the database is missing. */
function defaultEntitlementReader(): EntitlementReader | null {
  const projectUrl = Deno.env.get('PROJECT_URL') ||
    Deno.env.get('SUPABASE_URL') || '';
  const secretKey = getSecretKey();
  if (!projectUrl || !secretKey) return null;

  const admin = createClient(projectUrl, secretKey);
  return async (userId, signal) => {
    const { data, error } = await admin
      .schema('drive')
      .rpc('get_entitlement', { p_user_id: userId })
      .abortSignal(signal);
    return { data, error };
  };
}

const TIMED_OUT = Symbol('timed-out');

function unresolved(
  functionName: string,
  source: ProductionRequesterSource,
  why: string,
): ProductionGateDecision {
  // No PII and no message: the routine writes it and may interpolate its own
  // arguments back (`docs/contracts/entitlement.md`, "Erros").
  console.error(
    `[${functionName}] BR-CONTEUDO-003: drive.get_entitlement unresolved (${why}), refusing with entitlement_unavailable`,
  );
  return {
    allowed: false,
    source,
    state: 'unresolved',
    refusal: 'entitlement_unavailable',
  };
}

/**
 * Answers BR-CONTEUDO-003 item 1 for the caller behind this request, guest or
 * permanent account alike.
 *
 * The CMS operator and the platform itself are OUT OF SCOPE of the rule, not
 * exceptions to it: "Não se aplica a: a produção pedida por um humano — o ato
 * do operador do CMS ou da curadoria sobre um POI nomeado". There is no tourist
 * and no tier there, and the authorising role is the CMS one.
 */
export async function decideContentProduction(
  auth: AuthResult,
  functionName: string,
  options: ProductionGateOptions = {},
): Promise<ProductionGateDecision> {
  // A guest is never an operator nor the platform: his state is always read.
  const source: ProductionRequesterSource = auth.isAnonymous === true
    ? 'app_user'
    : classifyProductionRequester(auth.role);

  if (source !== 'app_user') {
    return { allowed: true, source, state: 'not_applicable' };
  }

  const userId = auth.userId;
  if (!userId) return unresolved(functionName, source, 'no user id');

  const readEntitlement = options.readEntitlement ?? defaultEntitlementReader();
  if (!readEntitlement) return unresolved(functionName, source, 'missing env');

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMED_OUT);
    }, options.timeoutMs ?? ENTITLEMENT_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([
      readEntitlement(userId, controller.signal),
      timedOut,
    ]);
    if (outcome === TIMED_OUT) return unresolved(functionName, source, 'timeout');

    if (outcome.error) {
      return unresolved(
        functionName,
        source,
        `sqlstate ${outcome.error.code ?? 'unknown'}`,
      );
    }

    // PostgREST returns the single row as an array of one.
    const row = Array.isArray(outcome.data) ? outcome.data[0] : outcome.data;
    const state = typeof (row as { state?: unknown } | null)?.state === 'string'
      ? (row as { state: string }).state
      : null;
    if (!state) return unresolved(functionName, source, 'no state in the row');

    const allowed = PAID_STATES.includes(state);
    return {
      allowed,
      source,
      state: state as ProductionGateDecision['state'],
      ...(allowed ? {} : { refusal: 'not_entitled' as const }),
    };
  } catch (unexpected) {
    return unresolved(
      functionName,
      source,
      `threw ${unexpected instanceof Error ? unexpected.name : 'unknown'}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The typed refusal. Two bodies, one per `ProductionRefusal`:
 *
 * - `not_entitled`: **403 `content_production_not_entitled`, never 402 and
 *   never 200 with an empty payload.** The caller has to tell "you may not"
 *   from "it failed", because a failure is retried and this is not: item 3 of
 *   BR-CONTEUDO-003 refuses *in the instant*, with no queue and nothing to
 *   announce later.
 * - `entitlement_unavailable`: **503**, the gate could not read the state.
 *   This one IS a failure, and it is the only one worth retrying.
 *
 * None is 401: the app renews the session on 401, and a refusal returned as
 * 401 would drop the session of someone correctly signed in. The bodies carry
 * no sentence for the tourist. The screen owns the wording (spec
 * `docs/design/spec-audio-sem-idioma-2026-08.md`), and a sentence shipped from
 * here would be a second copy of it, untranslated and outside the "teto do
 * afirmável" of BR-CONTEUDO-003.
 */
export const CONTENT_PRODUCTION_REFUSED = 'content_production_not_entitled';
export const ENTITLEMENT_UNAVAILABLE = 'entitlement_unavailable';

export function createProductionRefusedResponse(
  decision: ProductionGateDecision,
  headers: Record<string, string>,
): Response {
  const [status, body] = decision.refusal === 'entitlement_unavailable'
    ? [503, { error: ENTITLEMENT_UNAVAILABLE, rule: 'BR-CONTEUDO-003' }]
    : [403, {
      error: CONTENT_PRODUCTION_REFUSED,
      rule: 'BR-CONTEUDO-003',
      state: decision.state,
    }];
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
