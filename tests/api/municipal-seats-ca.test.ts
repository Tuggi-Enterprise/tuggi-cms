/**
 * BR-POI-010 item 4 and BR-POI-011 item 8 at import, Canada (measured 2026-10-26): no OSM admin level means
 * "municipality" across the provinces. Level 8 is the community in Nova Scotia and PEI and the civil parish in New
 * Brunswick; level 6 is the municipality in NS, PE and NB but also a First Nation, a national park or a rural district;
 * level 9 is the community in NB. A relation at level 6 to 9 is a municipality only when its Wikidata item is an
 * instance of municipality (Q15284). No name takes part.
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
// item a "town in Nova Scotia". Halifax Regional Municipality (NS): level 6, "regional municipality in Canada".
const EAST_CHEZZETCOOK: SeatRelation = { id: 1, level: 8, qid: 'Q5328927', seats: [node(10)] }
const WOLFVILLE: SeatRelation = { id: 2, level: 8, qid: 'Q2304245', seats: [node(20)] }
const NO_ITEM: SeatRelation = { id: 3, level: 8, qid: null, seats: [node(30)] }
const HALIFAX: SeatRelation = { id: 4, level: 6, qid: 'Q2141', seats: [node(40, 'admin_centre')] }
// New Brunswick: Kingsclear Parish (level 8, "parish of New Brunswick"), Nackawic (level 9, "town in New Brunswick"),
// a level-6 county or rural district with no item.
const NB_PARISH: SeatRelation = { id: 5, level: 8, qid: 'Q6413778', seats: [node(50)] }
const NB_MUNICIPALITY_9: SeatRelation = { id: 6, level: 9, qid: 'Q835359', seats: [node(60)] }
const NB_COUNTY_6: SeatRelation = { id: 7, level: 6, qid: null, seats: [node(70, 'admin_centre')] }
const MUNICIPAL_ITEMS = new Set(['Q2304245', 'Q2141', 'Q835359'])

describe('BR-POI-010 item 4 / BR-POI-011 item 8 — in Canada a level 6 to 9 relation is a municipality only by its Wikidata class', () => {
  it('CA: levels 6 to 9 by the item, none always; any other country keeps its municipal levels, with no class check', () => {
    assert.deepEqual(municipalSeatLevels('CA'), { levels: [], byWikidataClass: [6, 7, 8, 9] })
    assert.deepEqual(municipalSeatLevels('ca'), municipalSeatLevels('CA'))
    assert.deepEqual(municipalSeatLevels('PT'), { levels: municipalityAdminLevels('PT'), byWikidataClass: [] })
    assert.deepEqual(municipalSeatLevels('AT'), { levels: [8, 6, 4], byWikidataClass: [] })
    assert.equal(MUNICIPALITY_WIKIDATA_CLASS, 'Q15284')
  })

  it('NS: a community at level 8 is not a seat (its village goes through item 8); a town at level 8 and a regional municipality at level 6 are', () => {
    const { seats } = seatsOf([EAST_CHEZZETCOOK, WOLFVILLE, HALIFAX], municipalSeatLevels('CA'), MUNICIPAL_ITEMS)
    assert.equal(seats.has('node/10'), false)
    assert.equal(seats.has('node/20'), true)
    assert.equal(seats.has('node/40'), true)
  })

  it('NB: the civil parish at level 8 is not a seat, the municipality at level 9 is, the level-6 county with no municipal item is not', () => {
    const { seats } = seatsOf([NB_PARISH, NB_MUNICIPALITY_9, NB_COUNTY_6], municipalSeatLevels('CA'), MUNICIPAL_ITEMS)
    assert.deepEqual([...seats], ['node/60'])
  })

  it('a relation without an item is not a municipality: no item, no seat', () => {
    assert.equal(seatsOf([NO_ITEM, NB_COUNTY_6], municipalSeatLevels('CA'), MUNICIPAL_ITEMS).seats.size, 0)
  })

  it('the label member takes the relation item (the same place); the admin_centre does not (a county seat is another place)', () => {
    const { inherited } = seatsOf([EAST_CHEZZETCOOK, WOLFVILLE, NO_ITEM, HALIFAX, NB_MUNICIPALITY_9], municipalSeatLevels('CA'), MUNICIPAL_ITEMS)
    assert.deepEqual([...inherited].sort(), [['node/10', 'Q5328927'], ['node/20', 'Q2304245'], ['node/60', 'Q835359']])
  })

  it('elsewhere every relation at the municipal level is a municipality, item or not (Portugal: concelho 7, freguesia 8 is not)', () => {
    const concelho: SeatRelation = { id: 8, level: 7, qid: null, seats: [node(80, 'admin_centre')] }
    const freguesia: SeatRelation = { id: 9, level: 8, qid: null, seats: [node(90, 'admin_centre')] }
    const { seats, inherited } = seatsOf([concelho, freguesia], municipalSeatLevels('PT'), new Set())
    assert.deepEqual([...seats], ['node/80'])
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
