/**
 * Wikidata item -> what it says about an OSM object: its Wikipedia article (sitelinks), its heritage
 * designations (P1435) and whether it has a Wikivoyage page.
 *
 * A national register can mint one Wikidata item per object (the Austrian BDA did for every listed
 * monument, the Czech water register for every pond), so an OSM `wikidata` tag alone does not say
 * anyone wrote about the place. An article does — BR-POI-011 item 0. Used by
 * scripts/refine-pbf-elite-node to fill `wikipedia` and to pass P1435/Wikivoyage to the elite
 * filter (lib/shared/poi-filter#shouldFilterPOI) before it runs.
 */
import fs from 'node:fs'

// Projects that are not an encyclopedia article written by people: cebwiki is bot-generated.
const NOT_AN_ARTICLE = new Set(['commonswiki', 'cebwiki', 'specieswiki', 'wikidatawiki', 'metawiki', 'sourceswiki', 'wikimaniawiki'])
const PREFERRED = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl']
const BATCH = 50 // wbgetentities limit for anonymous clients
const UA = { 'User-Agent': 'TuggiCMS/1.0 (https://tuggi.app)' }

/** Picks the `lang:Title` OSM writes in `wikipedia`, or null when the item has no article. */
export function pickArticle(sitelinks: Record<string, { title: string }>): string | null {
  const wikis = Object.keys(sitelinks).filter(site => /^[a-z_-]+wiki$/.test(site) && !NOT_AN_ARTICLE.has(site))
  if (!wikis.length) return null
  const site = PREFERRED.map(l => `${l}wiki`).find(w => wikis.includes(w)) ?? wikis.sort()[0]
  return `${site.slice(0, -4).replace(/_/g, '-')}:${sitelinks[site].title}`
}

export interface WikidataFacts {
  /** `lang:Title` of the article (pickArticle), or null: no article in any language. */
  article: string | null
  /** P1435 (heritage designation) values. */
  heritage: string[]
  /** The item has a Wikivoyage page in some language. */
  wikivoyage: boolean
  /** Wikipedia titles for the languages asked (`languages`), by language code. */
  titles: Record<string, string>
}

/** One Wikidata entity (wbgetentities, props=claims|sitelinks) -> WikidataFacts. */
export function factsOf(entity: any, languages: readonly string[]): WikidataFacts {
  const sitelinks: Record<string, { title: string }> = entity?.sitelinks ?? {}
  const titles: Record<string, string> = {}
  for (const lang of languages) if (sitelinks[`${lang}wiki`]) titles[lang] = sitelinks[`${lang}wiki`].title
  return {
    article: pickArticle(sitelinks),
    heritage: (entity?.claims?.P1435 ?? []).map((c: any) => c.mainsnak?.datavalue?.value?.id).filter(Boolean),
    wikivoyage: Object.keys(sitelinks).some(site => site.endsWith('wikivoyage')),
    titles,
  }
}

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: UA })
    if (res.ok) return res.json()
    if (attempt >= 6 || (res.status !== 429 && res.status < 500)) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`)
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
  }
}

/**
 * Resolves each Q-id. Throws when Wikidata does not answer: a silent miss would drop every object
 * whose only reference is its article. `cachePath` keeps the answers between runs (JSON by Q-id);
 * a cached item without one of `languages` in its titles is fetched again.
 */
export async function wikidataFacts(
  ids: string[],
  opts: { languages?: readonly string[]; cachePath?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, WikidataFacts>> {
  const languages = [...new Set(['en', 'de', ...(opts.languages ?? [])])]
  const cache: Record<string, WikidataFacts & { langs?: string[] }> =
    opts.cachePath && fs.existsSync(opts.cachePath) ? JSON.parse(fs.readFileSync(opts.cachePath, 'utf8')) : {}
  const unique = [...new Set(ids.filter(id => /^Q\d+$/.test(id)))]
  const missing = unique.filter(id => !cache[id] || !languages.every(l => cache[id].langs?.includes(l)))
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH)
    const body = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims|sitelinks&format=json&ids=${chunk.join('|')}`)
    for (const id of chunk) cache[id] = { ...factsOf(body.entities?.[id], languages), langs: languages }
    opts.onProgress?.(Math.min(i + BATCH, missing.length), missing.length)
    if (opts.cachePath && (i / BATCH) % 40 === 39) fs.writeFileSync(opts.cachePath, JSON.stringify(cache))
  }
  if (opts.cachePath && missing.length) fs.writeFileSync(opts.cachePath, JSON.stringify(cache))
  const out = new Map<string, WikidataFacts>()
  for (const id of unique) {
    const { langs: _langs, ...facts } = cache[id]
    out.set(id, facts)
  }
  return out
}

/** The first Q-id of an OSM `wikidata` value ("Q1;Q2" happens), or null. */
export function firstQid(value: unknown): string | null {
  const q = String(value ?? '').split(';')[0].trim()
  return /^Q\d+$/.test(q) ? q : null
}
