/**
 * send-newsletter: what the request log may carry. The query of `/unsubscribe` holds the address
 * (`e=`, base64 of the e-mail), so the log line names the path only (CLAUDE.md §6, log without PII;
 * #1264 security review).
 */
import { assert, assertEquals } from './assert.ts';
import { loadHandler } from './harness.ts';
import { encodeEmail } from '../_shared/unsubscribe-link.ts';

const handler = await loadHandler('send-newsletter');

async function logged(fn: () => Promise<Response>): Promise<{ res: Response; lines: string[] }> {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const keep = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.log = keep;
  console.warn = keep;
  console.error = keep;
  try {
    return { res: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

Deno.test('#1264 security, CLAUDE.md §6: the request log names the path of /unsubscribe, never its query with the address', async () => {
  const email = 'ana@example.com';
  const e = encodeEmail(email);
  for (const method of ['GET', 'POST']) {
    const { res, lines } = await logged(() =>
      handler(new Request(`http://edge.test/send-newsletter/unsubscribe?e=${e}&s=not-signed`, { method }))
    );
    await res.body?.cancel();
    assert(lines.some((l) => l.includes(`send-newsletter: ${method} /send-newsletter/unsubscribe`)), lines.join('\n'));
    for (const line of lines) {
      assertEquals([e, email, 'e=', 's=not-signed'].filter((x) => line.includes(x)), [], line);
    }
  }
});
