interface AttractionSource {
  type: 'website' | 'reference_link';
  url: string;
  title?: string;
  content?: string;
  relevance: number;
}

interface AttractionInfo {
  id: string;
  name: string;
  website?: string;
  reference_links?: string[];
}

class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 3, windowMs: number = 1000) {
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

const sourceRateLimiter = new RateLimiter(2, 1000); // 2 requests por segundo

// Cache in-memory para evitar chamadas repetidas
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dias

async function fetchWebPage(url: string): Promise<{ title: string; content: string } | null> {
  const cacheKey = `webpage:${url}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  await sourceRateLimiter.waitForSlot();

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TuggiApp/1.0 (contact@tuggi.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      signal: AbortSignal.timeout(10000) // 10 segundos timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extrair título
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extrair conteúdo de texto (remover tags HTML)
    const content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove CSS
      .replace(/<[^>]+>/g, ' ') // Remove tags HTML
      .replace(/\s+/g, ' ') // Normaliza espaços
      .trim()
      .substring(0, 5000); // Limita a 5000 caracteres

    const result = { title, content };
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;

  } catch (error) {
    console.error(`Error fetching webpage ${url}:`, error);
    return null;
  }
}

export async function getAttractionSources(attractionInfo: AttractionInfo): Promise<AttractionSource[]> {
  const sources: AttractionSource[] = [];

  // 1. Website da atração (fonte primária)
  if (attractionInfo.website) {
    console.log(`🔍 Buscando website: ${attractionInfo.website}`);
    const webpage = await fetchWebPage(attractionInfo.website);
    
    if (webpage) {
      sources.push({
        type: 'website',
        url: attractionInfo.website,
        title: webpage.title,
        content: webpage.content,
        relevance: 1.0 // Máxima relevância
      });
    }
  }

  // 2. Links de referência (fontes secundárias)
  if (attractionInfo.reference_links && attractionInfo.reference_links.length > 0) {
    console.log(`🔍 Buscando ${attractionInfo.reference_links.length} links de referência`);
    
    for (const link of attractionInfo.reference_links.slice(0, 5)) { // Máximo 5 links
      try {
        const webpage = await fetchWebPage(link);
        
        if (webpage) {
          sources.push({
            type: 'reference_link',
            url: link,
            title: webpage.title,
            content: webpage.content,
            relevance: 0.8 // Alta relevância
          });
        }
      } catch (error) {
        console.error(`Error fetching reference link ${link}:`, error);
      }
    }
  }

  console.log(`✅ Encontradas ${sources.length} fontes para atração ${attractionInfo.name}`);
  return sources;
}

export async function getContextFromAttractionSources(
  attractionInfo: AttractionInfo, 
  claims: string[]
): Promise<any[]> {
  const sources = await getAttractionSources(attractionInfo);
  const context: any[] = [];

  for (const source of sources) {
    if (!source.content) continue;

    // Calcular relevância para cada claim
    for (const claim of claims) {
      const relevance = calculateClaimRelevance(claim, source.content);
      
      if (relevance > 0.1) { // Só incluir se relevante
        context.push({
          source: source.type,
          title: source.title || source.url,
          content: source.content.substring(0, 1000), // Limitar conteúdo
          url: source.url,
          relevance: relevance * source.relevance, // Ajustar pela relevância da fonte
          claim: claim
        });
      }
    }
  }

  // Ordenar por relevância e limitar
  return context
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 10); // Máximo 10 contextos
}

function calculateClaimRelevance(claim: string, content: string): number {
  const claimWords = claim.toLowerCase().split(/\s+/).filter(word => word.length > 2);
  const contentLower = content.toLowerCase();
  
  let matches = 0;
  for (const word of claimWords) {
    if (contentLower.includes(word)) {
      matches++;
    }
  }
  
  return matches / claimWords.length;
}

// Função para validar URLs
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Função para limpar URLs
export function cleanUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}
