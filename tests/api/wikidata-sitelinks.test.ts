/**
 * lib/services/wikidata-sitelinks#pickArticle: which sitelink counts as a Wikipedia article for the
 * elite filter's listed-building gate (poi-filter#touristNoiseReason).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickArticle } from '../../lib/services/wikidata-sitelinks'

describe('pickArticle', () => {
  it('ignores Commons and the bot-generated Cebuano wiki', () => {
    assert.equal(pickArticle({ commonswiki: { title: 'Category:X' }, cebwiki: { title: 'X' } }), null)
  })

  it('prefers English, then German, then any wiki', () => {
    assert.equal(pickArticle({ dewiki: { title: 'Majolikahaus' }, enwiki: { title: 'Majolika House' } }), 'en:Majolika House')
    assert.equal(pickArticle({ dewiki: { title: 'Schloss Goldenstein' }, svwiki: { title: 'S' } }), 'de:Schloss Goldenstein')
    assert.equal(pickArticle({ cswiki: { title: 'Leopoldovo křídlo' } }), 'cs:Leopoldovo křídlo')
  })
})
