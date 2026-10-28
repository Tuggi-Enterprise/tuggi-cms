/**
 * Loads an Edge Function's `index.ts` with the fakes of `import_map.json` and drives its handler
 * as the platform would: a Request in, a Response out, no network and no database.
 *
 * `fetchCalls` is the proof that nothing paid ran. With the database faked, the only way out of
 * the process is `fetch`, and Gemini and Google TTS are reached through it.
 */
import { capturedHandlers, type Handler } from './fakes/std-http-server.ts';
import { type FakeUser, scenario } from './fakes/supabase-js.ts';

export { scenario };

export const fetchCalls: string[] = [];

/** What every `fetch` answers, by URL. Defaults to a 400, so a paid call fails; a test may script it. */
export const network: { reply: (url: string) => Response } = {
  reply: () => new Response('{}', { status: 400 }),
};

const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  GEMINI_API_KEY: 'test-gemini-key',
  GOOGLE_TTS_API_KEY: 'test-tts-key',
};

export async function loadHandler(functionDir: string): Promise<Handler> {
  for (const [name, value] of Object.entries(TEST_ENV)) Deno.env.set(name, value);
  globalThis.fetch = (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchCalls.push(url);
    return Promise.resolve(network.reply(url));
  };
  const before = capturedHandlers.length;
  // A function on `Deno.serve` instead of std's `serve` is captured the same way.
  const realServe = Deno.serve;
  (Deno as { serve: unknown }).serve = (handler: Handler) => {
    capturedHandlers.push(handler);
  };
  try {
    await import(new URL(`../${functionDir}/index.ts`, import.meta.url).href);
  } finally {
    (Deno as { serve: unknown }).serve = realServe;
  }
  if (capturedHandlers.length !== before + 1) throw new Error(`${functionDir} did not call serve once`);
  return capturedHandlers[before];
}

export const GUEST: FakeUser = { id: '11111111-1111-4111-8111-111111111111', is_anonymous: true };
export const PERMANENT: FakeUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'tourist@example.test',
  is_anonymous: false,
};

let ipCounter = 0;

/** Resets the trail and returns a fresh request; each one gets its own IP so the rate limiter stays out. */
export function request(body: unknown): Request {
  scenario.calls.length = 0;
  scenario.writes.length = 0;
  fetchCalls.length = 0;
  ipCounter += 1;
  return new Request('http://edge.test/fn', {
    method: 'POST',
    headers: {
      authorization: 'Bearer user-session-token',
      'content-type': 'application/json',
      'x-forwarded-for': `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
    },
    body: JSON.stringify(body),
  });
}

/** Calls that may happen before the gate decides: token check, operator lookup, the state read. */
const BEFORE_THE_GATE = new Set(['auth:getUser', 'from:cms_users', 'rpc:get_entitlement']);

/** What the code touched once the gate had answered. Empty means it stopped at the gate. */
export function callsPastTheGate(): string[] {
  return scenario.calls.filter((call) => !BEFORE_THE_GATE.has(call));
}
