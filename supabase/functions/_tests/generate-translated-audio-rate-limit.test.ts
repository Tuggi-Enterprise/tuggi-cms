/**
 * #1112: the per-request limit of `generate-translated-audio` counts the app user only. The CMS
 * curator approves routes in a row and the platform drains in batch: neither is counted nor
 * refused. The tourist is told apart from the operator by the same classification the production
 * gate uses (BR-CONTEUDO-003, "Não se aplica a: a produção pedida por um humano").
 *
 * Run: deno test --allow-env --allow-read --import-map=supabase/functions/_tests/import_map.json \
 *   supabase/functions/_tests/
 */
import { assert, assertEquals } from './assert.ts';
import { loadHandler, PERMANENT, scenario } from './harness.ts';
import { RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';

const handler = await loadHandler('generate-translated-audio');
const LIMIT = RATE_LIMIT_CONFIG['generate-translated-audio'].maxRequests;
const BODY = {
  attractionId: '33333333-3333-4333-8333-333333333333',
  targetLanguage: 'fr-fr',
  voiceGender: 'female',
};

/**
 * One call from a fixed address. The token is not a JWT, so the limiter keys on the IP: every
 * call of a test shares it, and each test has its own so they never count for one another.
 */
async function callFrom(ip: string, token: string): Promise<number> {
  scenario.calls.length = 0;
  scenario.writes.length = 0;
  const response = await handler(new Request('http://edge.test/fn', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(BODY),
  }));
  await response.body?.cancel();
  return response.status;
}

async function statusesOf(calls: number, ip: string, token: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < calls; i += 1) statuses.push(await callFrom(ip, token));
  return statuses;
}

function metered(cmsRole?: string) {
  scenario.user = PERMANENT;
  scenario.entitlement = { data: [{ state: 'metered' }], error: null };
  scenario.tables = {
    ...(cmsRole ? { cms_users: { role: cmsRole } } : {}),
    attraction_descriptions: { description: 'Texto de origem.', language: 'pt-br' },
    attractions: { name: 'Praia' },
  };
}

Deno.test('#1112: the app user past the limit in the same hour gets 429', async () => {
  metered();
  const statuses = await statusesOf(LIMIT + 1, '192.0.2.10', 'user-session-token');
  scenario.tables = {};

  assertEquals(statuses.slice(0, LIMIT).filter((s) => s === 429), [], `refused inside the limit: ${statuses}`);
  assertEquals(statuses[LIMIT], 429);
});

Deno.test('#1112: the CMS admin past the limit in the same hour is not refused', async () => {
  metered('admin');
  const statuses = await statusesOf(LIMIT + 1, '192.0.2.20', 'user-session-token');
  scenario.tables = {};

  assertEquals(statuses.filter((s) => s === 429), [], `admin refused: ${statuses}`);
  assert(scenario.calls.includes('from:cms_users'), 'the operator was not looked up');
  assert(!scenario.calls.includes('rpc:get_entitlement'), 'the operator is out of the production gate');
});

Deno.test('#1112: the machine key past the limit in the same hour is not refused', async () => {
  metered();
  const statuses = await statusesOf(LIMIT + 1, '192.0.2.30', 'test-service-role-key');
  scenario.tables = {};

  assertEquals(statuses.filter((s) => s === 429), [], `machine refused: ${statuses}`);
});
