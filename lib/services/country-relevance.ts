/**
 * BR-POI-011 items 8 and 9: a village or a neighbourhood that is not a municipal seat (BR-POI-010
 * item 4) enters only with a strong signal — having an article is not one. Operator, 2026-10-09:
 * "ter wikipedia não diz se é importante, ainda mais para vilarejo".
 *
 * The signals that need the network (article prose length, pageviews of the local wiki) are fetched
 * here; the Wikidata ones (P1435, Wikivoyage, titles) come from lib/services/wikidata-sitelinks.
 * Used by scripts/refine-pbf-elite-node, after the elite filter.
 */
import fs from 'node:fs'

export const VILLAGE_PLACES = ['village', 'hamlet', 'isolated_dwelling', 'locality']
export const NEIGHBOURHOOD_PLACES = ['suburb', 'neighbourhood', 'quarter']

/** BR-POI-011 item 8: prose (TextExtracts plain text, infobox stripped) of the en / de article. */
export const VILLAGE_MIN_EN_PROSE = 2000
export const VILLAGE_MIN_DE_PROSE = 7500
/**
 * BR-POI-011 item 9: the pageview cut is measured again in each country, over the extract's own
 * villages. Czechia: 100/month ≈ p96 of the villages with an article (p90 61, p95 84). Without
 * `--village-pv-cut`, the refine takes this percentile of the country's distribution.
 */
export const VILLAGE_PAGEVIEW_PERCENTILE = 0.96

/**
 * Wikipedia language of each country's own wiki (pageviews, BR-POI-011 item 9) and of its place
 * names (border exception, item 6). Countries imported so far, plus their neighbours.
 */
export const COUNTRY_LANGUAGE: Readonly<Record<string, string>> = {
  AT: 'de', BE: 'nl', BR: 'pt', CH: 'de', CZ: 'cs', DE: 'de', DK: 'da', ES: 'es', FR: 'fr', HR: 'hr',
  HU: 'hu', IS: 'is', IT: 'it', LU: 'fr', NL: 'nl', PL: 'pl', PT: 'pt', SI: 'sl', SK: 'sk', US: 'en',
}

export type Strength = 'seat' | 'heritage' | 'tourism' | 'historic' | 'P1435' | 'wikivoyage' | 'en-article' | 'de-article' | 'pageviews'

export interface VillageSignals {
  p1435: boolean
  wikivoyage: boolean
  /** Prose characters of the en / de article; 0 = none. */
  enProse: number
  deProse: number
  /** Monthly average pageviews of the local-wiki article over the last 12 complete months; 0 = none. */
  pageviews: number
}

/** 'village' | 'neighbourhood' when the object is one, else null. */
export function placeClass(props: any): 'village' | 'neighbourhood' | null {
  if (VILLAGE_PLACES.includes(String(props.place))) return 'village'
  if (NEIGHBOURHOOD_PLACES.includes(String(props.place))) return 'neighbourhood'
  return null
}

/** The tag signals of item 8, no network: null = needs the network signals. */
export function tagStrength(props: any, isSeat: boolean): Strength | null {
  if (isSeat) return 'seat'
  if (props.heritage) return 'heritage'
  if (props.tourism) return 'tourism'
  if (props.historic) return 'historic'
  return null
}

/** Item 8 on the network signals: the strength that keeps it, or null (it does not enter). */
export function signalStrength(s: VillageSignals | undefined, pageviewCut: number): Strength | null {
  if (!s) return null
  if (s.p1435) return 'P1435'
  if (s.wikivoyage) return 'wikivoyage'
  if (s.enProse >= VILLAGE_MIN_EN_PROSE) return 'en-article'
  if (s.deProse >= VILLAGE_MIN_DE_PROSE) return 'de-article'
  if (s.pageviews >= pageviewCut) return 'pageviews'
  return null
}

/** Nearest-rank percentile of the values (0 when empty). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
}

const UA = { 'User-Agent': 'TuggiCMS/1.0 (https://tuggi.app)' }
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: UA })
    if (res.ok) return res.json()
    if (res.status === 404) return null
    if (attempt >= 6 || (res.status !== 429 && res.status < 500)) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`)
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
  }
}
const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

/** Plain-text prose length per title (TextExtracts): the infobox inflates wikitext bytes, not this. */
export async function proseLengths(lang: string, titles: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const c of chunks([...new Set(titles)], 20)) {
    let cont = ''
    for (;;) {
      const j = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=extracts&explaintext=1&exlimit=20&titles=${encodeURIComponent(c.join('|'))}${cont}`)
      const back = new Map<string, string>(c.map(t => [t, t]))
      for (const n of [...(j?.query?.normalized ?? []), ...(j?.query?.redirects ?? [])]) back.set(n.to, back.get(n.from) ?? n.from)
      for (const pg of j?.query?.pages ?? []) if (pg.extract !== undefined) out.set(back.get(pg.title) ?? pg.title, pg.extract.length)
      if (!j?.continue?.excontinue) break
      cont = `&excontinue=${j.continue.excontinue}`
    }
  }
  return out
}

/** The 12 complete months before `now`, as the REST pageviews range (YYYYMMDD00). */
export function lastTwelveMonths(now: Date): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)) // last day of the previous month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1))
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}00`
  return { start: fmt(start), end: fmt(end) }
}

/** Monthly average user pageviews of each title (months without data count as 0). Cached by `lang:title`. */
export async function monthlyPageviews(lang: string, titles: string[], opts: { cachePath?: string; now?: Date } = {}): Promise<Map<string, number>> {
  const cache: Record<string, number> = opts.cachePath && fs.existsSync(opts.cachePath) ? JSON.parse(fs.readFileSync(opts.cachePath, 'utf8')) : {}
  const { start, end } = lastTwelveMonths(opts.now ?? new Date())
  const todo = [...new Set(titles)].filter(t => !(`${lang}:${t}` in cache))
  let i = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (i < todo.length) {
      const t = todo[i++]
      const j = await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${encodeURIComponent(t.replace(/ /g, '_'))}/monthly/${start}/${end}`)
      cache[`${lang}:${t}`] = Math.round((j?.items ?? []).reduce((s: number, x: any) => s + x.views, 0) / 12)
    }
  }))
  if (opts.cachePath && todo.length) fs.writeFileSync(opts.cachePath, JSON.stringify(cache))
  return new Map([...new Set(titles)].map(t => [t, cache[`${lang}:${t}`] ?? 0]))
}

/**
 * BR-POI-011 item 6 exception: a name in the country's language — the name itself, or one half of
 * a bilingual "Sněžka / Śnieżka", equals `name:<lang>`, or (Czech) reads as Czech by its letters.
 */
const LOOKS_LIKE: Record<string, (s: string) => boolean> = {
  cs: s => /[ěřůčďňťáíéýúšž]/i.test(s) && !/[łśźżąęńóöüäßľĺôŕ]/i.test(s),
}
export function nameInCountryLanguage(props: any, lang: string | undefined): boolean {
  if (!lang) return false
  const local = String(props[`name:${lang}`] ?? '').trim()
  return String(props.name ?? '').split(/ \/ | - | \+ /).map(s => s.trim()).some(part =>
    (!!local && part === local) || !!LOOKS_LIKE[lang]?.(part))
}
