// Country-specific heritage and cultural sources for RAG
export interface CountrySource {
  country: string;
  sources: HeritageSource[];
}

export interface HeritageSource {
  name: string;
  type: 'government' | 'heritage' | 'tourism' | 'academic';
  baseUrl: string;
  searchEndpoint?: string;
  apiKey?: string;
  language: string;
  priority: number; // 1-10, higher = more authoritative
}

export interface SourceResult {
  source: string;
  url: string;
  title: string;
  content: string;
  relevance: number;
  type: string;
}

// Rate limiter for external APIs
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private capacity: number;
  private refillRate: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor(timePassed * this.refillRate / 1000);
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitTime = (1 - this.tokens) * 1000 / this.refillRate;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.tokens = 1;
    }

    this.tokens--;
  }
}

// Cache for source results
const cache = new Map<string, { data: SourceResult[]; timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Rate limiters per source type
const rateLimiters = new Map<string, RateLimiter>();

// Country-specific sources configuration
export const COUNTRY_SOURCES: CountrySource[] = [
  {
    country: 'BR',
    sources: [
      {
        name: 'IPHAN',
        type: 'heritage',
        baseUrl: 'http://portal.iphan.gov.br',
        searchEndpoint: '/buscas',
        language: 'pt-BR',
        priority: 10
      },
      {
        name: 'IBRAM',
        type: 'heritage',
        baseUrl: 'https://www.museus.gov.br',
        language: 'pt-BR',
        priority: 9
      },
      {
        name: 'Fundação Casa de Rui Barbosa',
        type: 'academic',
        baseUrl: 'http://www.casaruibarbosa.gov.br',
        language: 'pt-BR',
        priority: 8
      },
      {
        name: 'Arquivo Nacional',
        type: 'government',
        baseUrl: 'http://www.arquivonacional.gov.br',
        language: 'pt-BR',
        priority: 8
      }
    ]
  },
  {
    country: 'MX',
    sources: [
      {
        name: 'INAH',
        type: 'heritage',
        baseUrl: 'https://www.inah.gob.mx',
        language: 'es-MX',
        priority: 10
      },
      {
        name: 'CONACULTA',
        type: 'heritage',
        baseUrl: 'https://www.gob.mx/cultura',
        language: 'es-MX',
        priority: 9
      }
    ]
  },
  {
    country: 'AR',
    sources: [
      {
        name: 'Comisión Nacional de Monumentos',
        type: 'heritage',
        baseUrl: 'https://www.cultura.gob.ar',
        language: 'es-AR',
        priority: 10
      }
    ]
  },
  {
    country: 'PE',
    sources: [
      {
        name: 'Ministerio de Cultura del Perú',
        type: 'heritage',
        baseUrl: 'https://www.cultura.gob.pe',
        language: 'es-PE',
        priority: 10
      }
    ]
  },
  {
    country: 'CO',
    sources: [
      {
        name: 'Ministerio de Cultura de Colombia',
        type: 'heritage',
        baseUrl: 'https://www.mincultura.gov.co',
        language: 'es-CO',
        priority: 10
      }
    ]
  },
  {
    country: 'CL',
    sources: [
      {
        name: 'Consejo de Monumentos Nacionales',
        type: 'heritage',
        baseUrl: 'https://www.monumentos.gob.cl',
        language: 'es-CL',
        priority: 10
      }
    ]
  },
  {
    country: 'PT',
    sources: [
      {
        name: 'DGPC',
        type: 'heritage',
        baseUrl: 'http://www.patrimoniocultural.gov.pt',
        language: 'pt-PT',
        priority: 10
      }
    ]
  },
  {
    country: 'ES',
    sources: [
      {
        name: 'Ministerio de Cultura y Deporte',
        type: 'heritage',
        baseUrl: 'https://www.culturaydeporte.gob.es',
        language: 'es-ES',
        priority: 10
      },
      {
        name: 'Real Academia de la Historia',
        type: 'academic',
        baseUrl: 'https://www.rah.es',
        language: 'es-ES',
        priority: 9
      }
    ]
  },
  {
    country: 'US',
    sources: [
      {
        name: 'National Park Service',
        type: 'heritage',
        baseUrl: 'https://www.nps.gov',
        language: 'en-US',
        priority: 10
      },
      {
        name: 'Library of Congress',
        type: 'academic',
        baseUrl: 'https://www.loc.gov',
        language: 'en-US',
        priority: 9
      }
    ]
  }
];

// UNESCO World Heritage sites (global)
export const UNESCO_SOURCES: HeritageSource[] = [
  {
    name: 'UNESCO World Heritage Centre',
    type: 'heritage',
    baseUrl: 'https://whc.unesco.org',
    searchEndpoint: '/en/list',
    language: 'en',
    priority: 10
  }
];

export function getSourcesForCountry(country: string): HeritageSource[] {
  const countryData = COUNTRY_SOURCES.find(c => c.country === country);
  const sources = countryData ? countryData.sources : [];
  
  // Always include UNESCO sources
  return [...sources, ...UNESCO_SOURCES].sort((a, b) => b.priority - a.priority);
}

async function searchIPHAN(query: string): Promise<SourceResult[]> {
  const rateLimiter = getRateLimiter('iphan', 2, 1000); // 2 req/s
  await rateLimiter.acquire();
  
  try {
    // IPHAN search simulation - in real implementation, would use their API
    const searchUrl = `http://portal.iphan.gov.br/buscas?busca=${encodeURIComponent(query)}`;
    
    // For now, return mock results that would come from IPHAN
    return [
      {
        source: 'IPHAN',
        url: searchUrl,
        title: `Resultados IPHAN para: ${query}`,
        content: `Informações do patrimônio histórico brasileiro relacionadas a ${query}`,
        relevance: 0.8,
        type: 'heritage'
      }
    ];
  } catch (error) {
    console.error('Error searching IPHAN:', error);
    return [];
  }
}

async function searchGovernmentSource(source: HeritageSource, query: string): Promise<SourceResult[]> {
  const rateLimiter = getRateLimiter(source.name.toLowerCase(), 1, 2000); // 1 req/2s for government sources
  await rateLimiter.acquire();
  
  const cacheKey = `${source.name}-${query}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    // Generic government source search
    const searchUrl = source.searchEndpoint 
      ? `${source.baseUrl}${source.searchEndpoint}?q=${encodeURIComponent(query)}`
      : `${source.baseUrl}/search?q=${encodeURIComponent(query)}`;
    
    // In real implementation, would make HTTP request to the source
    // For now, return mock results
    const results: SourceResult[] = [
      {
        source: source.name,
        url: searchUrl,
        title: `${source.name}: ${query}`,
        content: `Informações oficiais de ${source.name} sobre ${query}`,
        relevance: calculateRelevance(query, `Informações oficiais de ${source.name} sobre ${query}`),
        type: source.type
      }
    ];
    
    cache.set(cacheKey, { data: results, timestamp: Date.now() });
    return results;
    
  } catch (error) {
    console.error(`Error searching ${source.name}:`, error);
    return [];
  }
}

export async function searchCountrySources(country: string, claims: string[]): Promise<SourceResult[]> {
  const sources = getSourcesForCountry(country);
  const allResults: SourceResult[] = [];
  
  for (const claim of claims.slice(0, 3)) { // Limit to 3 claims to avoid timeouts
    for (const source of sources.slice(0, 2)) { // Limit to 2 sources per claim
      try {
        let results: SourceResult[] = [];
        
        if (source.name === 'IPHAN') {
          results = await searchIPHAN(claim);
        } else {
          results = await searchGovernmentSource(source, claim);
        }
        
        allResults.push(...results);
        
        // Add delay between searches
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`Error searching ${source.name} for claim "${claim}":`, error);
      }
    }
  }
  
  // Sort by relevance and priority
  return allResults
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 10); // Limit results
}

function getRateLimiter(key: string, capacity: number, refillRate: number): RateLimiter {
  if (!rateLimiters.has(key)) {
    rateLimiters.set(key, new RateLimiter(capacity, refillRate));
  }
  return rateLimiters.get(key)!;
}

function calculateRelevance(claim: string, content: string): number {
  const claimWords = claim.toLowerCase().split(/\s+/);
  const contentWords = content.toLowerCase().split(/\s+/);
  
  let matches = 0;
  for (const word of claimWords) {
    if (word.length > 3 && contentWords.some(cw => cw.includes(word) || word.includes(cw))) {
      matches++;
    }
  }
  
  return Math.min(matches / claimWords.length, 1.0);
}

export function getCountryFromLocation(city: string, country: string): string {
  // Map country names to ISO codes
  const countryMap: { [key: string]: string } = {
    'Brazil': 'BR',
    'Brasil': 'BR',
    'Mexico': 'MX',
    'México': 'MX',
    'Argentina': 'AR',
    'Peru': 'PE',
    'Perú': 'PE',
    'Colombia': 'CO',
    'Chile': 'CL',
    'Portugal': 'PT',
    'Spain': 'ES',
    'España': 'ES',
    'United States': 'US',
    'USA': 'US'
  };
  
  return countryMap[country] || 'BR'; // Default to Brazil
}
