/**
 * #1203: "is this OSM element already in the catalogue?" and "which OSM element is this cadastro?".
 *
 * A match is the same OSM identity (or the same Wikidata item) at any distance, or a cadastro within MATCH_RADIUS_M with a
 * similar name. Similar = same name once accents, case and punctuation are folded, one name
 * contained in the other as whole words, or a bigram Dice coefficient of at least
 * NAME_SIMILARITY_MIN.
 */
import { calculateDistance, distanceToLineSegment } from '../services/trigger-points-google/utils/calculations'
import type { LatLng } from './admin-areas'

export const MATCH_RADIUS_M = 150
export const NAME_SIMILARITY_MIN = 0.6

export function foldName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>()
  const t = s.replace(/ /g, '')
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

export function diceCoefficient(a: string, b: string): number {
  const ga = bigrams(a), gb = bigrams(b)
  let total = 0, shared = 0
  ga.forEach(n => { total += n })
  gb.forEach(n => { total += n })
  ga.forEach((n, g) => { shared += Math.min(n, gb.get(g) ?? 0) })
  return total ? (2 * shared) / total : 0
}

export function isSimilarName(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = foldName(a), fb = foldName(b)
  if (!fa || !fb) return false
  if (fa === fb) return true
  const [short, long] = fa.length <= fb.length ? [fa, fb] : [fb, fa]
  if (short.length >= 4 && ` ${long} `.includes(` ${short} `)) return true
  return diceCoefficient(fa, fb) >= NAME_SIMILARITY_MIN
}

export interface NamedPoint extends LatLng {
  name: string
  altNames?: string[]
}

/** Uniform grid, about 550 m per cell at Santiago's latitude, so a 150 m search reads 3x3 cells. */
export class GridIndex<T extends LatLng> {
  private cells = new Map<string, T[]>()
  constructor(items: T[], private cellDeg = 0.005) {
    for (const it of items) {
      const k = this.key(it.lat, it.lng)
      const list = this.cells.get(k)
      if (list) list.push(it)
      else this.cells.set(k, [it])
    }
  }
  private key(lat: number, lng: number): string {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lng / this.cellDeg)}`
  }
  near(p: LatLng, radiusM: number): T[] {
    const span = Math.ceil(radiusM / (this.cellDeg * 111_000 * Math.cos((p.lat * Math.PI) / 180))) || 1
    const r = Math.floor(p.lat / this.cellDeg), c = Math.floor(p.lng / this.cellDeg)
    const out: T[] = []
    for (let i = r - span; i <= r + span; i++) {
      for (let j = c - span; j <= c + span; j++) {
        const list = this.cells.get(`${i}:${j}`)
        if (list) for (const it of list) if (calculateDistance(p, it) <= radiusM) out.push(it)
      }
    }
    return out
  }
}

/** The nearest item within radiusM whose name (or an alternative name) is similar to target's. */
export function nearestSimilar<T extends NamedPoint>(target: NamedPoint, index: GridIndex<T>, radiusM = MATCH_RADIUS_M): T | null {
  let best: T | null = null, bestD = Infinity
  const names = [target.name, ...(target.altNames ?? [])]
  for (const it of index.near(target, radiusM)) {
    const itNames = [it.name, ...(it.altNames ?? [])]
    if (!names.some(a => itNames.some(b => isSimilarName(a, b)))) continue
    const d = calculateDistance(target, it)
    if (d < bestD) { best = it; bestD = d }
  }
  return best
}

export interface CatalogueEntry extends NamedPoint {
  id: string
  osmType: string | null
  osmId: string | null
  wikidata?: string | null
}

export interface OsmCandidate extends NamedPoint {
  osmType: 'node' | 'way' | 'relation'
  osmId: number
  wikidata?: string | null
}

export function osmKey(type: string | null | undefined, id: string | number | null | undefined): string | null {
  return type && id != null && String(id) !== '' ? `${type}/${id}` : null
}

export class CatalogueMatcher {
  private byOsm = new Map<string, CatalogueEntry>()
  private byWikidata = new Map<string, CatalogueEntry>()
  private grid: GridIndex<CatalogueEntry>
  constructor(entries: CatalogueEntry[]) {
    for (const e of entries) {
      const k = osmKey(e.osmType, e.osmId)
      if (k) this.byOsm.set(k, e)
      if (e.wikidata) this.byWikidata.set(e.wikidata, e)
    }
    this.grid = new GridIndex(entries)
  }
  /** The cadastro that already stands for this OSM element, or null when it is missing. */
  match(c: OsmCandidate): { entry: CatalogueEntry; by: 'osm_id' | 'wikidata' | 'name_and_distance' } | null {
    const same = this.byOsm.get(`${c.osmType}/${c.osmId}`)
    if (same) return { entry: same, by: 'osm_id' }
    const sameWikidata = c.wikidata ? this.byWikidata.get(c.wikidata) : undefined
    if (sameWikidata) return { entry: sameWikidata, by: 'wikidata' }
    const near = nearestSimilar(c, this.grid)
    return near ? { entry: near, by: 'name_and_distance' } : null
  }
}

/** Shortest distance in meters from p to a polyline. */
export function distanceToPolylineM(p: LatLng, line: LatLng[]): number {
  if (line.length === 1) return calculateDistance(p, line[0])
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const d = distanceToLineSegment(p, line[i], line[i + 1])
    if (d < best) best = d
  }
  return best
}
