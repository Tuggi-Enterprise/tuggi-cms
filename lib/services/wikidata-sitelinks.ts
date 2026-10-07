/**
 * Wikidata item -> Wikipedia article, from the item's sitelinks.
 *
 * A heritage register can mint one Wikidata item per listed monument (the Austrian BDA did, for
 * every one of them), so an OSM `wikidata` tag alone does not say anyone wrote about the place.
 * An article does. Used by scripts/refine-pbf-elite-node to fill `wikipedia` before the elite
 * filter (lib/shared/poi-filter#touristNoiseReason) reads it.
 */

// Projects that are not an encyclopedia article written by people: cebwiki is bot-generated.
const NOT_AN_ARTICLE = new Set(['commonswiki', 'cebwiki', 'specieswiki', 'wikidatawiki', 'metawiki', 'sourceswiki', 'wikimaniawiki']);
const PREFERRED = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl'];
const BATCH = 50; // wbgetentities limit for anonymous clients

/** Picks the `lang:Title` OSM writes in `wikipedia`, or null when the item has no article. */
export function pickArticle(sitelinks: Record<string, { title: string }>): string | null {
  const wikis = Object.keys(sitelinks).filter(site => /^[a-z_-]+wiki$/.test(site) && !NOT_AN_ARTICLE.has(site));
  if (!wikis.length) return null;
  const site = PREFERRED.map(l => `${l}wiki`).find(w => wikis.includes(w)) ?? wikis.sort()[0];
  return `${site.slice(0, -4).replace(/_/g, '-')}:${sitelinks[site].title}`;
}

/** Resolves each Q-id to its article. Throws when Wikidata does not answer: a silent miss would drop every listed building. */
export async function articlesByWikidata(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(id => /^Q\d+$/.test(id)))];
  for (let i = 0; i < unique.length; i += BATCH) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=sitelinks&format=json&ids=${unique.slice(i, i + BATCH).join('|')}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'TuggiCMS/1.0 (https://tuggi.app)' } });
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
    const body: any = await res.json();
    for (const [id, entity] of Object.entries<any>(body.entities ?? {})) {
      const article = pickArticle(entity.sitelinks ?? {});
      if (article) out.set(id, article);
    }
  }
  return out;
}
