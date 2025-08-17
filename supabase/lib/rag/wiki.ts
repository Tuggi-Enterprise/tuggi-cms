
import { searchCountrySources, getCountryFromLocation, type SourceResult } from './country-sources.ts';

// Função para buscar fontes dinâmicas do país
async function searchDynamicCountrySources(countryCode: string, queries: string[], supabase: any): Promise<any[]> {
  try {
    console.log(`🔍 Buscando fontes dinâmicas para país: ${countryCode}`);
    
    // Buscar fontes ativas para o país
    const { data: sources, error } = await supabase
      .schema('core')
      .from('country_verification_sources')
      .select(`
        id,
        source_name,
        source_type,
        base_url,
        search_endpoint,
        priority,
        source_search_configs!inner(
          search_type,
          query_template,
          rate_limit_rps,
          timeout_ms,
          cache_ttl_hours
        )
      `)
      .eq('is_active', true)
      .order('priority', { ascending: true });
    
    if (error) {
      console.error('Error fetching dynamic sources:', error);
      return [];
    }
    
    if (!sources || sources.length === 0) {
      console.log(`⚠️ Nenhuma fonte dinâmica encontrada para país: ${countryCode}`);
      return [];
    }
    
    console.log(`✅ Encontradas ${sources.length} fontes dinâmicas para ${countryCode}`);
    
    const results: any[] = [];
    
    // Para cada query, buscar nas fontes prioritárias
    for (const query of queries.slice(0, 2)) { // Limitar a 2 queries
      for (const source of sources.slice(0, 5)) { // Limitar a 5 fontes por query
        try {
          const config = source.source_search_configs;
          if (!config || !config.query_template) {
            console.log(`⚠️ Pulando ${source.source_name}: configuração inválida`);
            continue;
          }
          
          // Construir URL de busca
          const searchUrl = `${source.base_url}${source.search_endpoint}${config.query_template.replace('{query}', encodeURIComponent(query))}`;
          
          console.log(`🔗 Buscando em: ${source.source_name}`);
          
          // TEMPORARIAMENTE DESABILITADO: Buscas dinâmicas precisam de implementação real
          console.log(`⚠️ ${source.source_name}: busca dinâmica desabilitada (mock removido)`);
          
          // Rate limiting básico
          await new Promise(resolve => setTimeout(resolve, Math.max(100, 1000 / config.rate_limit_rps)));
          
        } catch (error) {
          console.warn(`⚠️ Falha em ${source.source_name}: ${error.message}`);
          // Continuar com a próxima fonte sem interromper
        }
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('Error in searchDynamicCountrySources:', error);
    return [];
  }
}

// Cache in-memory para evitar chamadas repetidas
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 dias

interface WikiSearchResult {
  title: string;
  snippet: string;
  pageid: number;
  url: string;
}

interface WikiPageContent {
  title: string;
  extract: string;
  url: string;
  pageid: number;
}

interface WikidataResult {
  id: string;
  label: string;
  description: string;
  claims: any[];
}

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
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.requests.push(now);
  }
}

const wikiRateLimiter = new RateLimiter(5, 1000); // 5 requests por segundo
const wikidataRateLimiter = new RateLimiter(3, 1000); // 3 requests por segundo

async function searchWikipedia(query: string): Promise<WikiSearchResult[]> {
  const cacheKey = `wiki_search:${query}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  await wikiRateLimiter.waitForSlot();

  try {
    const url = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TuggiApp/1.0 (contact@tuggi.app)'
      }
    });

    if (!response.ok) {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.query?.search || [];

    const formattedResults: WikiSearchResult[] = results.map((item: any) => ({
      title: item.title,
      snippet: item.snippet.replace(/<\/?[^>]+(>|$)/g, ''), // Remove HTML tags
      pageid: item.pageid,
      url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(item.title)}`
    }));

    cache.set(cacheKey, { data: formattedResults, timestamp: Date.now() });
    return formattedResults;

  } catch (error) {
    console.error('Error searching Wikipedia:', error);
    return [];
  }
}

async function getWikipediaPage(pageId: number): Promise<WikiPageContent | null> {
  const cacheKey = `wiki_page:${pageId}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  await wikiRateLimiter.waitForSlot();

  try {
    const url = `https://pt.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&pageids=${pageId}&format=json`;
    
    const response = await fetch(url, {
        headers: {
        'User-Agent': 'TuggiApp/1.0 (contact@tuggi.app)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }
    
    const data = await response.json();
    const page = data.query?.pages?.[pageId];

    if (!page || !page.extract) {
      return null;
    }

    const result: WikiPageContent = {
      title: page.title,
      extract: page.extract,
      url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
      pageid: pageId
    };

    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;

  } catch (error) {
    console.error('Error fetching Wikipedia page:', error);
    return null;
  }
}

async function searchWikidata(query: string): Promise<WikidataResult[]> {
  const cacheKey = `wikidata_search:${query}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  await wikidataRateLimiter.waitForSlot();

  try {
    const sparqlQuery = `
      SELECT ?item ?itemLabel ?itemDescription WHERE {
        ?item rdfs:label ?itemLabel .
        ?item schema:description ?itemDescription .
        FILTER(LANG(?itemLabel) = "pt")
        FILTER(LANG(?itemDescription) = "pt")
        FILTER(CONTAINS(LCASE(?itemLabel), LCASE("${query}")))
      }
      LIMIT 5
    `;
    
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;
    
    const response = await fetch(url, {
        headers: {
        'User-Agent': 'TuggiApp/1.0 (contact@tuggi.app)',
        'Accept': 'application/sparql-results+json'
        },
      signal: AbortSignal.timeout(10000) // 10 segundos de timeout
    });
    
    if (!response.ok) {
      if (response.status === 504 || response.status === 503 || response.status === 502) {
        console.warn(`Wikidata SPARQL temporarily unavailable (${response.status}), skipping...`);
        return [];
      }
      throw new Error(`Wikidata API error: ${response.status}`);
    }
    
    const data = await response.json();
    const results: WikidataResult[] = [];

    for (const binding of data.results.bindings) {
      const itemId = binding.item.value.split('/').pop();
      
      // Buscar claims básicos
      const claims = await getWikidataClaims(itemId);
      
      results.push({
        id: itemId,
        label: binding.itemLabel.value,
        description: binding.itemDescription.value,
        claims
      });
    }

    cache.set(cacheKey, { data: results, timestamp: Date.now() });
    return results;

  } catch (error) {
    console.error('Error searching Wikidata:', error);
    return [];
  }
}

async function getWikidataClaims(entityId: string): Promise<any[]> {
  const cacheKey = `wikidata_claims:${entityId}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  await wikidataRateLimiter.waitForSlot();

  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&format=json&props=claims`;
    
    const response = await fetch(url, {
        headers: {
        'User-Agent': 'TuggiApp/1.0 (contact@tuggi.app)'
      },
      signal: AbortSignal.timeout(8000) // 8 segundos de timeout
    });
    
    if (!response.ok) {
      if (response.status === 504 || response.status === 503 || response.status === 502) {
        console.warn(`Wikidata entity API temporarily unavailable (${response.status}), skipping...`);
        return [];
      }
      throw new Error(`Wikidata API error: ${response.status}`);
    }

    const data = await response.json();
    const entity = data.entities?.[entityId];
    
    if (!entity || !entity.claims) {
      return [];
    }

    const claims = Object.values(entity.claims).flat();
    cache.set(cacheKey, { data: claims, timestamp: Date.now() });
    return claims;

  } catch (error) {
    console.error('Error fetching Wikidata claims:', error);
    return [];
  }
}

export async function getContextForClaims(
  claims: string[], 
  attractionName?: string,
  attractionSources?: any[],
  attractionInfo?: { city?: string; country?: string },
  supabase?: any
): Promise<any[]> {
  const context: any[] = [];
  
  // 1. PRIMEIRO: Usar fontes primárias da atração (se disponíveis)
  if (attractionSources && attractionSources.length > 0) {
    console.log(`🔍 Usando ${attractionSources.length} fontes primárias da atração`);
    
    for (const source of attractionSources) {
      for (const claim of claims) {
        const relevance = calculateRelevance(claim, source.content);
        
        if (relevance > 0.1) {
          context.push({
            source: source.type,
            title: source.title || source.url,
            content: source.content.substring(0, 1000),
            url: source.url,
            relevance: relevance * source.relevance, // Ajustar pela relevância da fonte
            priority: 'primary'
          });
        }
      }
    }
  }
  
  // 2. SEGUNDO: Buscar em fontes dinâmicas governamentais/patrimoniais por país
  if (attractionInfo?.country && context.length < 5) {
    console.log(`🏛️ Buscando fontes dinâmicas oficiais do país: ${attractionInfo.country}`);
    
    try {
      const countryCode = getCountryFromLocation(attractionInfo.city || '', attractionInfo.country);
      
      // Primeiro tentar fontes dinâmicas (não interromper se falhar)
      let dynamicResults = [];
      try {
        dynamicResults = await searchDynamicCountrySources(countryCode, claims.slice(0, 2), supabase);
        
        if (dynamicResults.length > 0) {
          console.log(`✅ Encontrados ${dynamicResults.length} resultados de fontes dinâmicas`);
          
          for (const result of dynamicResults) {
            context.push({
              source: result.source.toLowerCase().replace(/\s+/g, '_'),
              title: result.title,
              content: result.content,
              url: result.url,
              relevance: result.relevance * 1.2, // Boost maior para fontes dinâmicas
              priority: 'official'
            });
          }
        }
      } catch (error) {
        console.warn(`⚠️ Fontes dinâmicas falharam para ${countryCode}: ${error.message}`);
        // Continuar sem interromper
      }
      
      // Se fontes dinâmicas falharam ou não retornaram resultados, usar fallback
      if (dynamicResults.length === 0) {
        try {
          console.log(`🔄 Fallback para fontes estáticas`);
          const countryResults = await searchCountrySources(countryCode, claims.slice(0, 2));
          
          for (const result of countryResults) {
            context.push({
              source: result.source.toLowerCase().replace(/\s+/g, '_'),
              title: result.title,
              content: result.content,
              url: result.url,
              relevance: result.relevance * 1.1, // Boost para fontes oficiais
              priority: 'official'
            });
          }
          console.log(`✅ Fontes estáticas: ${countryResults.length} resultados`);
        } catch (error) {
          console.warn(`⚠️ Fontes estáticas também falharam para ${countryCode}: ${error.message}`);
          // Continuar sem interromper - outras fontes ainda podem funcionar
        }
      }
    } catch (error) {
      console.error('Error searching country sources:', error);
    }
  }
  
  // 3. TERCEIRO: Buscar em fontes externas (Wikipedia/Wikidata) apenas se necessário
  if (context.length < 5) { // Só buscar externamente se não temos contexto suficiente
    console.log(`🔍 Complementando com fontes externas (${context.length} contextos primários encontrados)`);
    
    for (const claim of claims) {
      // Buscar no Wikipedia (não interromper se falhar)
      try {
        const wikiResults = await searchWikipedia(claim);
        for (const result of wikiResults) {
          context.push({
            source: 'wikipedia',
            title: result.title,
            content: result.snippet,
            url: result.url,
            relevance: calculateRelevance(claim, result.snippet) * 0.6, // Menor relevância
            priority: 'secondary'
          });
        }
        console.log(`✅ Wikipedia: ${wikiResults.length} resultados para "${claim}"`);
      } catch (error) {
        console.warn(`⚠️ Wikipedia falhou para "${claim}": ${error.message}`);
        // Continuar sem interromper
      }

      // Buscar no Wikidata (não interromper se falhar)
      try {
        const wikidataResults = await searchWikidata(claim);
        for (const result of wikidataResults) {
          context.push({
            source: 'wikidata',
            title: result.label,
            content: result.description,
            url: `https://www.wikidata.org/wiki/${result.id}`,
            claims: result.claims,
            relevance: calculateRelevance(claim, result.description) * 0.5, // Menor relevância
            priority: 'secondary'
          });
        }
        console.log(`✅ Wikidata: ${wikidataResults.length} resultados para "${claim}"`);
      } catch (error) {
        console.warn(`⚠️ Wikidata falhou para "${claim}": ${error.message}`);
        // Continuar sem interromper
      }

      // Buscar contexto específico da atração (não interromper se falhar)
      if (attractionName) {
        try {
          const attractionWikiResults = await searchWikipedia(`${attractionName} ${claim}`);
          for (const result of attractionWikiResults) {
            context.push({
              source: 'wikipedia_attraction',
              title: result.title,
              content: result.snippet,
              url: result.url,
              relevance: calculateRelevance(claim, result.snippet) * 0.7, // Relevância média
              priority: 'secondary'
            });
          }
          console.log(`✅ Wikipedia específico: ${attractionWikiResults.length} resultados para "${attractionName} ${claim}"`);
        } catch (error) {
          console.warn(`⚠️ Wikipedia específico falhou para "${attractionName} ${claim}": ${error.message}`);
          // Continuar sem interromper
        }
      }
    }
  }

  // Resumo das fontes utilizadas
  const sourcesSummary = context.reduce((acc, ctx) => {
    acc[ctx.priority] = (acc[ctx.priority] || 0) + 1;
    return acc;
  }, {});
  
  console.log(`📊 Resumo das fontes encontradas:`, sourcesSummary);
  console.log(`🎯 Total de contextos coletados: ${context.length}`);

  // Ordenar por relevância e prioridade, limitar
  const sortedContext = context
    .sort((a, b) => {
      // Priorizar fontes primárias
      if (a.priority === 'primary' && b.priority !== 'primary') return -1;
      if (a.priority !== 'primary' && b.priority === 'primary') return 1;
      // Depois por relevância
      return b.relevance - a.relevance;
    })
    .slice(0, 15); // Máximo 15 contextos

  console.log(`✅ Contextos finais selecionados: ${sortedContext.length}`);
  return sortedContext;
}

function calculateRelevance(claim: string, content: string): number {
  const claimWords = claim.toLowerCase().split(/\s+/);
  const contentLower = content.toLowerCase();
  
  let score = 0;
  for (const word of claimWords) {
    if (word.length > 2 && contentLower.includes(word)) {
      score += 1;
    }
  }
  
  return score / claimWords.length;
}

// Funções exportadas já estão implementadas acima
