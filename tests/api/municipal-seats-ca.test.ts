/**
 * BR-POI-010 item 4 and BR-POI-011 item 8 at import, Canada (measured 2026-10-26): OSM level 8 is the community in
 * Nova Scotia, PEI and New Brunswick and the municipality in Quebec, Ontario and BC. Read as "municipality", it made a
 * seat of 1,917 Nova Scotia villages and item 8 cut none. A level-8 relation is a municipality only when its Wikidata
 * item is an instance of municipality (Q15284); level 6 always is. No name takes part.
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { municipalSeatLevels, municipalityAdminLevels, MUNICIPALITY_WIKIDATA_CLASS } from '../../lib/services/admin-boundaries'
import { instancesOfClass } from '../../lib/services/wikidata-sitelinks'
import { seatsOf, type SeatRelation } from '../../scripts/refine-pbf-elite-node'

const node = (id: number, role: 'admin_centre' | 'label' = 'label') => ({ type: 'node' as const, id, role })
// East Chezzetcook (NS): a community at level 8, its item a "human settlement". Wolfville: a town at level 8 (NS), its
// item a "town in Nova Scotia". Chester District Municipality: level 6, no wikidata tag.
const EAST_CHEZZETCOOK: SeatRelation = { id: 1, level: 8, qid: 'Q5328927', seats: [node(10)] }
const WOLFVILLE: SeatRelation = { id: 2, level: 8, qid: 'Q2304245', seats: [node(20)] }
const NO_ITEM: SeatRelation = { id: 3, level: 8, qid: null, seats: [node(30)] }
const CHESTER_DISTRICT: SeatRelation = { id: 4, level: 6, qid: null, seats: [node(40, 'admin_centre')] }
const MUNICIPAL_ITEMS = new Set(['Q2304245'])

describe('BR-POI-010 item 4 / BR-POI-011 item 8 — in Canada the level-8 relation is a municipality only by its Wikidata class', () => {
  it('CA: level 6 always, level 8 by the item; any other country keeps its municipal levels, with no class check', () => {
    assert.deepEqual(municipalSeatLevels('CA'), { levels: [6], byWikidataClass: [8] })
    assert.deepEqual(municipalSeatLevels('ca'), municipalSeatLevels('CA'))
    assert.deepEqual(municipalSeatLevels('PT'), { levels: municipalityAdminLevels('PT'), byWikidataClass: [] })
    assert.deepEqual(municipalSeatLevels('AT'), { levels: [8, 6, 4], byWikidataClass: [] })
    assert.equal(MUNICIPALITY_WIKIDATA_CLASS, 'Q15284')
  })

  it('a community at level 8 is not a seat (its village goes through item 8); a town at level 8 is (BR-POI-010 item 4)', () => {
    const { seats } = seatsOf([EAST_CHEZZETCOOK, WOLFVILLE, CHESTER_DISTRICT], municipalSeatLevels('CA'), MUNICIPAL_ITEMS)
    assert.equal(seats.has('node/10'), false)
    assert.equal(seats.has('node/20'), true)
    assert.equal(seats.has('node/40'), true, 'level 6 is a municipality in NS/PE/NB/AB, with or without wikidata')
  })

  it('a level-8 relation without an item is not a municipality: no item, no seat', () => {
    assert.equal(seatsOf([NO_ITEM], municipalSeatLevels('CA'), MUNICIPAL_ITEMS).seats.size, 0)
  })

  it('the centre member of a level-8 relation takes its item (the same place); the level-6 one does not', () => {
    const { inherited } = seatsOf([EAST_CHEZZETCOOK, WOLFVILLE, NO_ITEM, CHESTER_DISTRICT], municipalSeatLevels('CA'), MUNICIPAL_ITEMS)
    assert.deepEqual([...inherited].sort(), [['node/10', 'Q5328927'], ['node/20', 'Q2304245']])
  })

  it('elsewhere every relation at the municipal level is a municipality, item or not (Portugal: concelho 7, freguesia 8 is not)', () => {
    const concelho: SeatRelation = { id: 5, level: 7, qid: null, seats: [node(50, 'admin_centre')] }
    const freguesia: SeatRelation = { id: 6, level: 8, qid: null, seats: [node(60, 'admin_centre')] }
    const { seats, inherited } = seatsOf([concelho, freguesia], municipalSeatLevels('PT'), new Set())
    assert.deepEqual([...seats], ['node/50'])
    assert.equal(inherited.size, 0)
  })
})

describe('instancesOfClass — the municipality list comes from Wikidata (P31/P279*), not from a page of names', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  it('asks P31/P279* of the class for the given items, keeps the answer per class, and asks only the new ones', async () => {
    const queries: string[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const query = decodeURIComponent(String(init?.body).replace(/^query=/, ''))
      queries.push(query)
      const hit = query.includes('wd:Q2304245') ? [{ item: { value: 'http://www.wikidata.org/entity/Q2304245' } }] : []
      return new Response(JSON.stringify({ results: { bindings: hit } }), { status: 200 })
    }) as typeof fetch
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wd-class-')), 'cache.json')

    const first = await instancesOfClass(['Q2304245', 'Q5328927', 'not-a-qid'], 'Q15284', { cachePath })
    assert.deepEqual([...first], ['Q2304245'])
    assert.equal(queries.length, 1)
    assert.match(queries[0], /wdt:P31\/wdt:P279\* wd:Q15284/)

    const again = await instancesOfClass(['Q2304245', 'Q5328927'], 'Q15284', { cachePath })
    assert.deepEqual([...again], ['Q2304245'])
    assert.equal(queries.length, 1, 'both answers come from the cache')
  })

  it('throws when the Query Service does not answer: a silent miss would cut every Canadian town as a mere village', async () => {
    globalThis.fetch = (async () => new Response('', { status: 400 })) as typeof fetch
    await assert.rejects(instancesOfClass(['Q1'], 'Q15284'), /HTTP 400/)
  })
})
