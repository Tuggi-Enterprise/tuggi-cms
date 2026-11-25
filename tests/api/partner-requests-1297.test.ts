/**
 * #1297 — the queue of partner requests shows the content block of the new builds.
 * BR-USUARIO-052 item 4.a.i (channels with the follower band, languages, topics, country and
 * region) and item 4.a.ii (the request of the build in the field is shown as it came).
 * Contract `docs/contracts/parceiro-sem-local.md` §2.1.1 and §4.1.
 *
 * Mutations that turn this suite red:
 *  · a v1 request read as v2 (its "onde publica" would vanish from the queue);
 *  · a band kept on `site` or `other`, or a channel with an unknown network shown as a link;
 *  · `other` turned into a link, or `site` opened without `rel="noopener noreferrer"`;
 *  · a profile link that differs from the app's (`socialHandles.ts`).
 *
 * Run with: npx tsx --import ./tests/api/setup/console-to-stderr.mjs --test tests/api/partner-requests-1297.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'

import { PartnerRequestsQueue } from '@/components/admin/clients/board/PartnerRequests'
import {
  channelHref,
  countryName,
  isContentRequest,
  languageName,
  parsePartnerRequestRows,
  type PartnerRequestRow,
} from '@/lib/partner-requests/queue'
import { RPC_ROWS, V2_RPC_ROWS } from '../ct/partner-requests-fixtures'

const ROOT = resolve(import.meta.dirname, '../..')

function render(requests: PartnerRequestRow[]): string {
  const messages = JSON.parse(readFileSync(resolve(ROOT, 'messages/pt.json'), 'utf8'))
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: 'pt',
      messages: { Clients: { board: { requests: messages.Clients.board.requests } } },
      timeZone: 'America/Sao_Paulo',
      children: createElement(PartnerRequestsQueue, {
        requests,
        status: 'ready',
        busyId: null,
        notice: null,
        onApprove: () => {},
        onRefuse: () => {},
      }),
    })
  )
}

const [withBlock, withoutBlock] = parsePartnerRequestRows(V2_RPC_ROWS) ?? []

test('BR-USUARIO-052 4.a.i (#1297): the six channels are read in order, the band only on the 4 networks', () => {
  assert.equal(withBlock.country, 'BR')
  assert.equal(withBlock.createsContent, true)
  assert.deepEqual(
    withBlock.channels?.map((c) => [c.network, c.audience]),
    [
      ['instagram', '10k_100k'],
      ['tiktok', '1k_10k'],
      ['youtube', 'up_to_1k'],
      ['facebook', 'over_1m'],
      ['site', null],
      ['other', null],
    ]
  )
  assert.deepEqual(withBlock.contentLanguages, ['pt', 'en'])
  assert.deepEqual(withBlock.contentTopics, ['travel', 'food', 'budget_travel'])
  assert.ok(isContentRequest(withBlock))
})

test('BR-USUARIO-052 4.a.i (#1297): each channel links where the app links, and `other` never links', () => {
  const hrefs = withBlock.channels?.map(channelHref)
  assert.deepEqual(hrefs, [
    'https://www.instagram.com/carla.viaja',
    'https://www.tiktok.com/@carla_viaja',
    'https://www.youtube.com/@carla-viaja',
    'https://www.facebook.com/profile.php?id=100012345678',
    'https://carlaviaja.com.br/blog',
    null,
  ])
  assert.equal(channelHref({ network: 'facebook', value: 'carla.viaja', audience: 'up_to_1k' }), 'https://www.facebook.com/carla.viaja')
  assert.equal(channelHref({ network: 'site', value: 'javascript:alert(1)', audience: null }), null)
  assert.equal(channelHref({ network: 'instagram', value: '../evil?x', audience: 'up_to_1k' }), null, 'not a stored username')
})

test('#1297 contract §4.1: a malformed channel is dropped and a band on site or other is not kept', () => {
  const [row] =
    parsePartnerRequestRows([
      {
        ...V2_RPC_ROWS[0],
        channels: [
          { network: 'myspace', value: 'carla', audience: 'up_to_1k' },
          { network: 'instagram', value: '', audience: 'up_to_1k' },
          { network: 'instagram', value: 'carla', audience: 'a_lot' },
          { network: 'site', value: 'https://a.br', audience: 'over_1m' },
          'instagram',
        ],
      },
    ]) ?? []
  assert.deepEqual(row.channels, [
    { network: 'instagram', value: 'carla', audience: null },
    { network: 'site', value: 'https://a.br', audience: null },
  ])
})

test('BR-USUARIO-052 4.a.ii (#1297): the v1 request has every new field null and is not a content request', () => {
  const rows = parsePartnerRequestRows(RPC_ROWS) ?? []
  assert.equal(rows.length, 3)
  for (const row of rows) {
    assert.equal(row.country, null)
    assert.equal(row.createsContent, null)
    assert.equal(row.channels, null)
    assert.equal(row.contentLanguages, null)
    assert.equal(row.contentTopics, null)
    assert.equal(isContentRequest(row), false)
  }
  assert.equal(rows[0].publishesAt, '@ana.souza')
})

test('#1297: the request without the block has the country, no channel and empty lists', () => {
  assert.equal(withoutBlock.country, 'AR')
  assert.equal(withoutBlock.createsContent, false)
  assert.deepEqual(withoutBlock.channels, [])
  assert.deepEqual(withoutBlock.contentLanguages, [])
  assert.deepEqual(withoutBlock.contentTopics, [])
})

test('#1297: country and language names in Portuguese, an unknown code as it came', () => {
  assert.equal(countryName('BR'), 'Brasil')
  assert.equal(countryName('ar'), 'Argentina')
  assert.equal(languageName('en'), 'inglês')
  assert.equal(countryName('1'), '1')
  assert.equal(languageName('not a code'), 'not a code')
})

test('BR-USUARIO-052 4.a.i (#1297): the queue shows the channels, the bands, the languages and the topics', () => {
  const html = render([withBlock])
  assert.ok(html.includes('Brasil · Paraty'))
  for (const label of ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'Blog ou site', 'Outro']) {
    assert.ok(html.includes(`>${label}<`), label)
  }
  assert.ok(html.includes('href="https://www.instagram.com/carla.viaja"'))
  assert.ok(html.includes('>@carla.viaja<'))
  for (const band of ['10 a 100 mil', '1 a 10 mil', 'até 1 mil', 'mais de 1 milhão']) assert.ok(html.includes(band), band)
  assert.ok(html.includes('Idiomas: português, inglês'))
  assert.ok(html.includes('Temas: viagem, gastronomia, viagem econômica'))
  assert.ok(!html.includes('Também cria conteúdo'), 'the creator always creates content; the line is for driver and guide')
})

test('#1297 security review: `site` opens apart without the opener, `other` stays text even when it looks like a link', () => {
  const html = render([withBlock])
  assert.match(html, /<a href="https:\/\/carlaviaja\.com\.br\/blog" target="_blank" rel="noopener noreferrer"/)
  assert.ok(!html.includes('href="https://kwai.com'), 'other is never a link')
  assert.ok(html.includes('https://kwai.com/carla e newsletter'))
})

test('#1297: the guide without the block says it does not create content', () => {
  const html = render([withoutBlock])
  assert.ok(html.includes('Argentina · Mendoza'))
  assert.ok(html.includes('Não cria conteúdo'))
  assert.ok(!html.includes('Idiomas:') && !html.includes('Temas:'))
})

test('BR-USUARIO-052 4.a.ii (#1297): the v1 request is shown as it came, with "onde publica" and the region', () => {
  const html = render(parsePartnerRequestRows(RPC_ROWS) ?? [])
  assert.ok(html.includes('@ana.souza') && html.includes('Paraty'))
  assert.ok(html.includes('href="https://www.instagram.com/viaja.rio"'))
  assert.ok(!html.includes(' · Paraty') && !html.includes('Idiomas:') && !html.includes('Não cria conteúdo'))
})
