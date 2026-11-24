/**
 * #931 — the e-mail that calls the partners to complete their place in the portal
 * (`_shared/places-profile-update-campaign.ts`): the approved text, the `test_to` guard and the
 * once-per-client run.
 *
 * Deno source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHARED = resolve(import.meta.dirname, '../../supabase/functions/_shared')

// Untyped on purpose: a `typeof import` would pull the `.ts` sibling imports into `tsc` (TS5097).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any
let c: Mod

before(async () => {
  c = await import(pathToFileURL(resolve(SHARED, 'places-profile-update-campaign.ts')).href)
})

const ORIGIN = 'https://partner.tuggi.app'
const SUB = '99999999-8888-4777-8666-555555555555'

test('profileUpdateEmail: the approved text, word for word, with the place name', () => {
  const m = c.profileUpdateEmail(`${ORIGIN}/entrar`, ORIGIN, 'Bar do Zé')
  assert.equal(m.subject, 'Novidade para parceiros Tuggi')
  assert.ok(m.html.includes('Agora você pode deixar o seu local mais completo.'))
  assert.ok(m.text.startsWith('Olá,\n\nTemos uma novidade: agora, como parceiro Tuggi, você pode atualizar os dados de Bar do Zé com fotos, prato principal, horário de funcionamento e outras opções.\n\nPara conferir tudo o que dá para mudar, é só entrar no painel.'))
  assert.ok(m.text.includes(`Atualizar meu local: ${ORIGIN}/entrar`))
  assert.ok(m.text.includes('Se o botão não abrir, entre em partner.tuggi.app com este e-mail.'))
  assert.ok(m.html.includes(`href="${ORIGIN}/entrar"`))
})

test('profileUpdateEmail: no name falls back to "o seu local"; the name is escaped in the HTML', () => {
  assert.ok(c.profileUpdateEmail(`${ORIGIN}/entrar`, ORIGIN, '  ').text.includes('os dados de o seu local com fotos'))
  assert.ok(c.profileUpdateEmail(`${ORIGIN}/entrar`, ORIGIN, '<b>X</b>').html.includes('&lt;b&gt;X&lt;/b&gt;'))
})

test('parseCampaignBody: dry run by default, real run only with dry_run false', () => {
  assert.deepEqual(c.parseCampaignBody(null), { mode: 'dry_run' })
  assert.deepEqual(c.parseCampaignBody({ dry_run: true }), { mode: 'dry_run' })
  assert.deepEqual(c.parseCampaignBody({ dry_run: 'false' }), { mode: 'dry_run' })
  assert.deepEqual(c.parseCampaignBody({ dry_run: false }), { mode: 'send' })
})

test('parseCampaignBody: test_to only to @tuggi.app, and a bad one never falls through to the real run', () => {
  assert.deepEqual(c.parseCampaignBody({ test_to: ' Suporte@Tuggi.app ' }), { mode: 'test', to: 'suporte@tuggi.app' })
  for (const to of ['x@gmail.com', 'x@tuggi.app.evil.com', 'x@nottuggi.app', '', 42, null]) {
    assert.deepEqual(c.parseCampaignBody({ test_to: to, dry_run: false }), { error: 'invalid', field: 'test_to' }, String(to))
  }
})

test('testMail: a real name, the plain sign-in URL, no claim', () => {
  const t = c.testMail([{ id: 'a', name: null }, { id: 'b', name: 'Pousada Sol' }], ORIGIN)
  assert.equal(t.clientId, 'b')
  assert.ok(t.mail.text.includes('os dados de Pousada Sol com'))
  assert.ok(t.mail.text.includes(`Atualizar meu local: ${ORIGIN}/entrar`))
})

test('campaignAudience: counts by plan with place and e-mail', () => {
  const a = c.campaignAudience([
    { id: '1', name: 'A', email: 'A@x.com', monthly_fee_cents: 5000, is_courtesy: false },
    { id: '2', name: 'B', email: null, monthly_fee_cents: 5000, is_courtesy: true },
    { id: '3', name: 'C', email: 'c@x.com', monthly_fee_cents: 0 },
  ])
  assert.deepEqual(a.counts, { paying: 1, free: 2 })
  assert.deepEqual(a.recipients[0], { client_id: '1', place: 'A', email: 'a@x.com', plan: 'paying' })
  assert.equal(a.recipients[1].email, null)
})

function deps(over: Record<string, unknown> = {}) {
  const sent: { to: string; text: string }[] = []
  const d = {
    links: {
      origin: ORIGIN,
      randomToken: () => 'A'.repeat(43),
      sha256Hex: async () => 'f'.repeat(64),
      issueClaim: async () => ({ data: [{ email: 'owner@x.com' }], error: null }),
      auth: { ensureUser: async () => true, magicLink: async () => ({ tokenHash: 'h', type: 'magiclink' }) },
      sendEmail: async (to: string, _s: string, _h: string, text: string) => (sent.push({ to, text }), true),
    },
    seed: async () => ({ data: SUB, error: null }),
    recordNotice: async () => ({ data: true, error: null }),
    pause: async () => {},
    ...over,
  }
  return { d, sent }
}

const ROW = { id: 'c1', name: 'Bar do Zé', email: 'ze@x.com', monthly_fee_cents: 0 }

test('runCampaign: records the notice, then sends the claim link with the campaign text', async () => {
  const kinds: string[] = []
  const { d, sent } = deps({ recordNotice: async (_s: string, k: string) => (kinds.push(k), { data: true, error: null }) })
  const r = await c.runCampaign(d, [ROW])
  assert.deepEqual(r, [{ client_id: 'c1', plan: 'free', submission_id: SUB, status: 'sent' }])
  assert.deepEqual(kinds, ['profile_update_campaign'])
  assert.equal(sent.length, 1)
  assert.ok(sent[0].text.includes('os dados de Bar do Zé com'))
})

test('runCampaign: an already recorded client gets nothing on a rerun', async () => {
  const { d, sent } = deps({ recordNotice: async () => ({ data: false, error: null }) })
  assert.equal((await c.runCampaign(d, [ROW]))[0].status, 'already_sent')
  assert.equal(sent.length, 0)
})

test('runCampaign: a notice the database refuses sends nothing', async () => {
  const { d, sent } = deps({ recordNotice: async () => ({ data: null, error: { code: '23514' } }) })
  const r = await c.runCampaign(d, [ROW])
  assert.equal(r[0].status, 'failed')
  assert.equal(r[0].code, '23514')
  assert.equal(sent.length, 0)
})

test('runCampaign: a claimed submission gets the sign-in URL at the client e-mail', async () => {
  const { d, sent } = deps()
  d.links.issueClaim = async () => ({ data: null, error: { code: 'TGP10', details: 'draft_claimed' } }) as never
  const r = await c.runCampaign(d, [ROW])
  assert.equal(r[0].status, 'sent')
  assert.equal(sent[0].to, 'ze@x.com')
  assert.ok(sent[0].text.includes(`Atualizar meu local: ${ORIGIN}/entrar`))
})

test('runCampaign: a refused seed is reported and the next client still runs', async () => {
  let n = 0
  const { d, sent } = deps({ seed: async () => (n++ === 0 ? { data: null, error: { code: 'TGP22', details: 'email' } } : { data: SUB, error: null }) })
  const r = await c.runCampaign(d, [ROW, { ...ROW, id: 'c2' }])
  assert.deepEqual(r.map((x: { status: string }) => x.status), ['refused', 'sent'])
  assert.equal(sent.length, 1)
})
