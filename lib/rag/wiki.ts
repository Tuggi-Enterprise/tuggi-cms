import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface WikiSearchResult {
  title: string;
  snippet: string;
  url: string;
  source: 'wikipedia' | 'wikidata' | 'iphan' | 'unesco';
}

export interface EntityLink {
  entity_type: 'wikipedia' | 'wikidata' | 'iphan' | 'unesco';
  entity_id: string;
  entity_name: string;
  confidence: number;
}

// Simple in-memory cache with TTL
const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();

function getCacheKey(key: string): string {
  return `wiki_rag_${key}`;
}

function getCached<T>(key: string): T | null {
  const cacheKey = getCacheKey(key);
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data as T;
  }
  
  if (cached) {
    cache.delete(cacheKey);
  }
  
  return null;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  const cacheKey = getCacheKey(key);
  cache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    ttl: ttlMs
  });
}

export async function searchWikipedia(query: string, lang: string = 'pt'): Promise<WikiSearchResult[]> {
  const cacheKey = `wikipedia_${lang}_${query}`;
  const cached = getCached<WikiSearchResult[]>(cacheKey);
  if (cached) return cached;
  
  try {
    const response = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': process.env.WIKI_USER_AGENT || 'TuggiApp/1.0 (contact@tuggi.app)'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const result: WikiSearchResult = {
      title: data.title,
      snippet: data.extract || '',
      url: data.content_urls?.desktop?.page || '',
      source: 'wikipedia'
    };
    
    setCached(cacheKey, [result], 30 * 24 * 60 * 60 * 1000); // 30 days
    return [result];
  } catch (error) {
    console.error('Wikipedia search error:', error);
    return [];
  }
}

export async function searchWikidata(query: string): Promise<WikiSearchResult[]> {
  const cacheKey = `wikidata_${query}`;
  const cached = getCached<WikiSearchResult[]>(cacheKey);
  if (cached) return cached;
  
  try {
    // Simple SPARQL query to find entities
    const sparqlQuery = `
      SELECT ?item ?itemLabel ?description WHERE {
        ?item rdfs:label ?itemLabel .
        FILTER(LANG(?itemLabel) = "pt")
        FILTER(CONTAINS(LCASE(?itemLabel), LCASE("${query}")))
        OPTIONAL { ?item schema:description ?description . FILTER(LANG(?description) = "pt") }
      }
      LIMIT 5
    `;
    
    const response = await fetch(
      'https://query.wikidata.org/sparql',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-query',
          'Accept': 'application/sparql-results+json',
          'User-Agent': process.env.WIKI_USER_AGENT || 'TuggiApp/1.0 (contact@tuggi.app)'
        },
        body: sparqlQuery
      }
    );
    
    if (!response.ok) {
      throw new Error(`Wikidata API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const results: WikiSearchResult[] = data.results.bindings.map((binding: any) => ({
      title: binding.itemLabel?.value || '',
      snippet: binding.description?.value || '',
      url: `https://www.wikidata.org/wiki/${binding.item.value.split('/').pop()}`,
      source: 'wikidata'
    }));
    
    setCached(cacheKey, results, 30 * 24 * 60 * 60 * 1000); // 30 days
    return results;
  } catch (error) {
    console.error('Wikidata search error:', error);
    return [];
  }
}

export async function searchIPHAN(query: string): Promise<WikiSearchResult[]> {
  const cacheKey = `iphan_${query}`;
  const cached = getCached<WikiSearchResult[]>(cacheKey);
  if (cached) return cached;
  
  try {
    // IPHAN doesn't have a public API, so we'll simulate with basic search
    // In a real implementation, you might use web scraping or a third-party service
    
    const results: WikiSearchResult[] = [];
    
    // For now, return empty results
    // TODO: Implement IPHAN search when API becomes available
    
    setCached(cacheKey, results, 30 * 24 * 60 * 60 * 1000); // 30 days
    return results;
  } catch (error) {
    console.error('IPHAN search error:', error);
    return [];
  }
}

export async function searchUNESCO(query: string): Promise<WikiSearchResult[]> {
  const cacheKey = `unesco_${query}`;
  const cached = getCached<WikiSearchResult[]>(cacheKey);
  if (cached) return cached;
  
  try {
    // UNESCO World Heritage API
    const response = await fetch(
      `https://whc.unesco.org/en/list/?search=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': process.env.WIKI_USER_AGENT || 'TuggiApp/1.0 (contact@tuggi.app)'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`UNESCO API error: ${response.status}`);
    }
    
    // Parse HTML response to extract relevant information
    const html = await response.text();
    
    // Simple regex-based extraction (in production, use proper HTML parsing)
    const results: WikiSearchResult[] = [];
    
    // Extract site names and descriptions from HTML
    const siteMatches = html.match(/<h3[^>]*>([^<]+)<\/h3>/g);
    if (siteMatches) {
      siteMatches.slice(0, 5).forEach(match => {
        const title = match.replace(/<[^>]*>/g, '').trim();
        if (title.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            title,
            snippet: 'UNESCO World Heritage Site',
            url: 'https://whc.unesco.org/en/list/',
            source: 'unesco'
          });
        }
      });
    }
    
    setCached(cacheKey, results, 30 * 24 * 60 * 60 * 1000); // 30 days
    return results;
  } catch (error) {
    console.error('UNESCO search error:', error);
    return [];
  }
}

export async function searchAllSources(query: string): Promise<WikiSearchResult[]> {
  const [wikipedia, wikidata, iphan, unesco] = await Promise.allSettled([
    searchWikipedia(query),
    searchWikidata(query),
    searchIPHAN(query),
    searchUNESCO(query)
  ]);
  
  const results: WikiSearchResult[] = [];
  
  if (wikipedia.status === 'fulfilled') results.push(...wikipedia.value);
  if (wikidata.status === 'fulfilled') results.push(...wikidata.value);
  if (iphan.status === 'fulfilled') results.push(...iphan.value);
  if (unesco.status === 'fulfilled') results.push(...unesco.value);
  
  return results;
}

export async function getOrCreateEntityLinks(
  attractionId: string, 
  attractionName: string
): Promise<EntityLink[]> {
  // Check if we already have entity links for this attraction
  const { data: existingLinks } = await supabase
    .schema('core')
    .from('attraction_entity_links')
    .select('*')
    .eq('attraction_id', attractionId);
  
  if (existingLinks && existingLinks.length > 0) {
    return existingLinks.map(link => ({
      entity_type: link.entity_type,
      entity_id: link.entity_id,
      entity_name: link.entity_name,
      confidence: link.confidence
    }));
  }
  
  // Search for entity links
  const searchResults = await searchAllSources(attractionName);
  
  const entityLinks: EntityLink[] = searchResults.map(result => ({
    entity_type: result.source,
    entity_id: result.url.split('/').pop() || result.title,
    entity_name: result.title,
    confidence: 0.8 // Default confidence
  }));
  
  // Store entity links in database
  if (entityLinks.length > 0) {
    const { error } = await supabase
      .schema('core')
      .from('attraction_entity_links')
      .insert(
        entityLinks.map(link => ({
          attraction_id: attractionId,
          entity_type: link.entity_type,
          entity_id: link.entity_id,
          entity_name: link.entity_name,
          confidence: link.confidence
        }))
      );
    
    if (error) {
      console.error('Error storing entity links:', error);
    }
  }
  
  return entityLinks;
}

export async function getContextForClaims(
  attractionId: string,
  claims: string[]
): Promise<string> {
  // Get entity links for the attraction
  const { data: attraction } = await supabase
    .schema('core')
    .from('attractions')
    .select('name')
    .eq('id', attractionId)
    .single();
  
  if (!attraction) {
    return '';
  }
  
  const entityLinks = await getOrCreateEntityLinks(attractionId, attraction.name);
  
  // Search for context related to the claims
  const contextPromises = claims.map(async (claim) => {
    const searchResults = await searchAllSources(claim);
    return searchResults.map(result => `${result.title}: ${result.snippet}`).join(' ');
  });
  
  const contexts = await Promise.all(contextPromises);
  
  // Combine all context
  const combinedContext = contexts.join(' ').trim();
  
  return combinedContext;
}

// Rate limiting utilities
class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;
  
  constructor(maxRequests: number = 10, windowMs: number = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }
  
  async waitForSlot(): Promise<void> {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    // If we're at the limit, wait
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForSlot();
    }
    
    // Add current request
    this.requests.push(now);
  }
}

// Global rate limiter for external APIs
const apiRateLimiter = new RateLimiter(10, 1000); // 10 requests per second

export async function rateLimitedSearch<T>(
  searchFunction: () => Promise<T>
): Promise<T> {
  await apiRateLimiter.waitForSlot();
  return searchFunction();
}
