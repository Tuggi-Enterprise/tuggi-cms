/**
 * #957, BR-COMUNICACAO-020: the five tourist e-mails, rendered in the five languages.
 * Copy: `docs/design/copy-notificacoes-e-email-turista-2026-10.md` §3 (criteria of done at the end
 * of the section). The module is Deno source loaded by a path built at runtime, so `tsc` does not
 * follow it (see `testar-edge-function-no-cms`).
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FN = (name: string) =>
  pathToFileURL(resolve(import.meta.dirname, `../../supabase/functions/_shared/${name}`)).href

let mod: any
let layout: any

before(async () => {
  mod = await import(FN('tourist-email.ts'))
  layout = await import(FN('emailLayout.ts'))
})

const NOW = new Date('2026-10-18T12:00:00Z')
const LANGS = ['pt', 'en', 'es', 'fr', 'it'] as const

const DATA = {
  tourist_hours_earned: { minutes: 300, expires_at: '2026-12-17T15:00:00Z', nickname: 'Bia' },
  tourist_hours_expiring: { minutes: 45, expires_at: '2026-10-21T11:00:00Z' },
  tourist_reengagement_7: { balance_minutes: 90 },
  tourist_reengagement_14: {},
  tourist_reengagement_30: {},
} as const

function all(rendered: any): string {
  return [
    rendered.content.subject,
    rendered.content.preheader,
    ...rendered.content.paragraphs,
    rendered.content.cta_label,
    rendered.footerNote,
    rendered.unsubscribeLabel ?? '',
  ].join('\n')
}

test('BR-COMUNICACAO-020 item 6: every type renders in the five languages, with no placeholder left', () => {
  for (const type of mod.TOURIST_EMAIL_TYPES) {
    for (const lang of LANGS) {
      const rendered = mod.renderTouristEmail(type, lang, (DATA as any)[type], NOW)
      assert.ok(rendered, `${type}/${lang} did not render`)
      assert.doesNotMatch(all(rendered), /\{\{|\}\}/, `${type}/${lang} left a placeholder`)
      assert.equal(rendered.content.cta_url, 'https://tuggi.app/download')
    }
  }
})

test('the profile language reaches the e-mail: pt-br is pt, an unknown one is English', () => {
  assert.equal(mod.normalizeTouristLang('pt-br'), 'pt')
  assert.equal(mod.normalizeTouristLang('fr-CA'), 'fr')
  assert.equal(mod.normalizeTouristLang('de'), 'en')
  assert.equal(mod.normalizeTouristLang(null), 'en')
})

test('spec §3.2: hours earned names the friend, sums the duration and dates the validity', () => {
  const pt = mod.renderTouristEmail('tourist_hours_earned', 'pt', DATA.tourist_hours_earned, NOW)
  assert.equal(pt.content.subject, 'Você ganhou 5 h no Tuggi')
  assert.equal(pt.content.paragraphs[0], 'Olá,')
  assert.equal(pt.content.paragraphs[1], 'Bia usou seu código, e 5 h entraram no seu saldo.')
  assert.equal(pt.content.paragraphs[2], 'São horas grátis e valem até 17 de dezembro.')

  // Without a nickname the generic line, and without an expiry the validity line leaves.
  const generic = mod.renderTouristEmail('tourist_hours_earned', 'pt', { minutes: 45 }, NOW)
  assert.equal(generic.content.paragraphs[1], 'Somamos 45 min ao seu saldo.')
  assert.equal(generic.content.paragraphs.length, 3)

  // No number of hours, no e-mail.
  assert.equal(mod.renderTouristEmail('tourist_hours_earned', 'pt', {}, NOW), null)
})

test('spec §3.3: hours expiring counts the days, and refuses the singular it has no copy for', () => {
  const pt = mod.renderTouristEmail('tourist_hours_expiring', 'pt', DATA.tourist_hours_expiring, NOW)
  assert.equal(pt.content.subject, 'Suas horas grátis vencem em 3 dias')
  assert.equal(pt.content.paragraphs[1], 'Você tem 45 min em horas grátis, e elas vencem em 21 de outubro.')
  const fr = mod.renderTouristEmail('tourist_hours_expiring', 'fr', DATA.tourist_hours_expiring, NOW)
  assert.equal(fr.content.subject, 'Tes heures gratuites expirent dans 3 jours')
  assert.equal(
    mod.renderTouristEmail('tourist_hours_expiring', 'pt', { minutes: 45, expires_at: '2026-10-19T06:00:00Z' }, NOW),
    null
  )
})

test('spec §3.4: the 7-day one shows the balance only when there is one; the 30-day one never talks of hours', () => {
  const withBalance = mod.renderTouristEmail('tourist_reengagement_7', 'pt', { balance_minutes: 90 }, NOW)
  assert.ok(withBalance.content.paragraphs.includes('Você tem 1 h 30 min guardadas na sua conta.'))
  const without = mod.renderTouristEmail('tourist_reengagement_7', 'pt', { balance_minutes: 0 }, NOW)
  assert.equal(without.content.paragraphs.length, 2)
  for (const lang of LANGS) {
    const last = all(mod.renderTouristEmail('tourist_reengagement_30', lang, {}, NOW))
    assert.doesNotMatch(last, /\b(horas?|hours?|heures?|ore)\b/iu, `the 30-day ${lang} speaks of hours`)
  }
})

test('spec §3.4: French puts a no-break space before the question mark', () => {
  const fr = mod.renderTouristEmail('tourist_reengagement_7', 'fr', {}, NOW)
  assert.equal(fr.content.subject, 'Tu pars bientôt ?')
})

test('spec §3.1: the footer says which class the reader is in', () => {
  const service = mod.renderTouristEmail('tourist_hours_earned', 'pt', DATA.tourist_hours_earned, NOW)
  assert.equal(service.footerNote, 'Você recebe este e-mail porque tem uma conta no Tuggi.')
  assert.equal(service.unsubscribeLabel, 'Não quero mais avisos sobre minhas horas')
  const promo = mod.renderTouristEmail('tourist_reengagement_14', 'pt', {}, NOW)
  assert.equal(promo.footerNote, 'Você recebe este e-mail porque pediu novidades e lembretes do Tuggi.')
  assert.equal(promo.unsubscribeLabel, undefined)

  // The layout prints both, and `FOOTER_LABELS` gained `fr`.
  const html = layout.renderEmail(promo.content, {
    unsubscribeUrl: 'https://www.tuggi.app/en/unsubscribe?e=x&s=y&lang=fr',
    locale: 'fr',
    footerNote: 'NOTE',
  })
  assert.match(html, /NOTE/)
  assert.match(html, /Se désinscrire/)
  assert.match(html, /Tous droits réservés/)
})

test('spec §3, criteria of done: pt subjects fit 50 characters, and no forbidden promise appears', () => {
  for (const type of mod.TOURIST_EMAIL_TYPES) {
    const pt = mod.renderTouristEmail(type, 'pt', (DATA as any)[type], NOW)
    assert.ok(pt.content.subject.length <= 50, `${type}: "${pt.content.subject}" is over 50`)
    for (const lang of LANGS) {
      const text = all(mod.renderTouristEmail(type, lang, (DATA as any)[type], NOW))
      // BR-MONETIZACAO-062 and DS-COPY-073: no Premium, no "free days", and nothing "never expires".
      assert.doesNotMatch(text, /premium|dias grátis|não expira|free days|never expire/iu, `${type}/${lang}`)
    }
  }
})

test('the date is long, in the reader zone, without year; an unknown zone falls back to São Paulo', () => {
  assert.equal(mod.formatLongDate('2026-10-18T02:00:00Z', 'pt', 'America/Sao_Paulo'), '17 de outubro')
  assert.equal(mod.formatLongDate('2026-10-18T02:00:00Z', 'pt', 'Not/AZone'), '17 de outubro')
  assert.equal(mod.formatLongDate('2026-10-18T12:00:00Z', 'en', null), 'October 18')
  assert.equal(mod.formatDuration(300), '5 h')
  assert.equal(mod.formatDuration(45), '45 min')
  assert.equal(mod.formatDuration(0), null)
})
