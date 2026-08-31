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
 * FAILING OPEN IS A DECISION, NOT AN OVERSIGHT
 * --------------------------------------------
 * `docs/contracts/entitlement.md`, "O que nenhum consumidor faz": *não trata
 * erro como `free`* — "rebaixar por falha nossa é o único desfecho
 * inaceitável" (BR-MONETIZACAO-025, 026 e 046). An unreachable database is our
 * failure, so an unresolved state ALLOWS and logs. The ceiling on what that
 * can cost is the rate limiter each function already applies; the ceiling on
 * who can even try is the JWT each one already validates.
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

export interface ProductionGateDecision {
  /** May this request spend LLM or TTS? */
  allowed: boolean;
  source: ProductionRequesterSource;
  /**
   * The state `drive.get_entitlement` answered, or `'unresolved'` when the call
   * failed — which is NOT `free` and never becomes it (see the header).
   */
  state: 'unlimited' | 'metered' | 'free' | 'unresolved' | 'not_applicable';
}

/** The states that carry the right to turn the guide on, hence to produce. */
const PAID_STATES = ['unlimited', 'metered'];

/**
 * Answers BR-CONTEUDO-003 item 1 for the caller behind this request.
 *
 * The CMS operator and the platform itself are OUT OF SCOPE of the rule, not
 * exceptions to it: "Não se aplica a: a produção pedida por um humano — o ato
 * do operador do CMS ou da curadoria sobre um POI nomeado". There is no tourist
 * and no tier there, and the authorising role is the CMS one.
 */
export async function decideContentProduction(
  auth: AuthResult,
  functionName: string,
): Promise<ProductionGateDecision> {
  const source = classifyProductionRequester(auth.role);

  if (source !== 'app_user') {
    return { allowed: true, source, state: 'not_applicable' };
  }

  const userId = auth.userId;
  if (!userId) {
    // Authenticated with no subject: cannot resolve, does not downgrade.
    console.warn(
      `[${functionName}] BR-CONTEUDO-003: authenticated request with no user id — allowing (unresolved)`,
    );
    return { allowed: true, source, state: 'unresolved' };
  }

  const projectUrl = Deno.env.get('PROJECT_URL') ||
    Deno.env.get('SUPABASE_URL') || '';
  const secretKey = getSecretKey();

  if (!projectUrl || !secretKey) {
    console.error(
      `[${functionName}] BR-CONTEUDO-003: cannot reach drive.get_entitlement (missing env) — allowing (unresolved)`,
    );
    return { allowed: true, source, state: 'unresolved' };
  }

  try {
    const admin = createClient(projectUrl, secretKey);
    const { data, error } = await admin
      .schema('drive')
      .rpc('get_entitlement', { p_user_id: userId });

    if (error) {
      // No PII and no message: the routine writes it and may interpolate its
      // own arguments back (`docs/contracts/entitlement.md`, "Erros").
      console.warn(
        `[${functionName}] BR-CONTEUDO-003: drive.get_entitlement failed (sqlstate: ${
          error.code ?? 'unknown'
        }) — allowing (unresolved)`,
      );
      return { allowed: true, source, state: 'unresolved' };
    }

    // PostgREST returns the single row as an array of one.
    const row = Array.isArray(data) ? data[0] : data;
    const state = typeof row?.state === 'string' ? row.state : null;

    if (!state) {
      console.warn(
        `[${functionName}] BR-CONTEUDO-003: drive.get_entitlement returned no state — allowing (unresolved)`,
      );
      return { allowed: true, source, state: 'unresolved' };
    }

    return {
      allowed: PAID_STATES.includes(state),
      source,
      state: state as ProductionGateDecision['state'],
    };
  } catch (unexpected) {
    console.warn(
      `[${functionName}] BR-CONTEUDO-003: drive.get_entitlement threw — allowing (unresolved)`,
      unexpected instanceof Error ? unexpected.name : 'unknown',
    );
    return { allowed: true, source, state: 'unresolved' };
  }
}

/**
 * The typed refusal. **403, never 402 and never 200 with an empty payload:**
 * the caller has to be able to tell "you may not" from "it failed", because a
 * failure is retried and this is not — item 3 of the rule refuses *in the
 * instant*, with no queue, no wait and nothing to announce later.
 *
 * The body carries no sentence for the tourist. The screen owns the wording
 * (spec `docs/design/spec-audio-sem-idioma-2026-08.md`), and a sentence
 * shipped from here would be a second copy of it, untranslated and outside the
 * "teto do afirmável" of BR-CONTEUDO-003.
 */
export const CONTENT_PRODUCTION_REFUSED = 'content_production_not_entitled';

export function createProductionRefusedResponse(
  decision: ProductionGateDecision,
  headers: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: CONTENT_PRODUCTION_REFUSED,
      rule: 'BR-CONTEUDO-003',
      state: decision.state,
    }),
    { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
  );
}
