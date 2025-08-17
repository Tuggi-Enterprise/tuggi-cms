// Simplified version for Deno Edge Functions
export interface WikiContext {
  source: 'wikipedia' | 'wikidata' | 'iphan' | 'unesco';
  title: string;
  url: string;
  content: string;
  relevance_score: number;
}

export interface ContextResult {
  contexts: WikiContext[];
  total_contexts: number;
}

// Simple in-memory cache for development
const contextCache = new Map<string, { data: ContextResult; timestamp: number }>();
const CACHE_TTL = 21 * 24 * 60 * 60 * 1000; // 21 days in milliseconds

export async function getContextForClaims(
  attractionId: string,
  claims: string[]
): Promise<ContextResult> {
  try {
    // For now, return a simple mock context
    // In a real implementation, this would search Wikipedia, Wikidata, etc.
    
    const contexts: WikiContext[] = [];
    
    // Add some mock contexts based on claims
    claims.forEach((claim, index) => {
      if (claim.toLowerCase().includes('ano') || claim.toLowerCase().includes('19') || claim.toLowerCase().includes('20')) {
        contexts.push({
          source: 'wikipedia',
          title: 'História da Atração',
          url: 'https://pt.wikipedia.org/wiki/example',
          content: `Informações históricas sobre ${claim}. Este é um contexto de exemplo para verificação factual.`,
          relevance_score: 0.8
        });
      }
      
      if (claim.toLowerCase().includes('pessoa') || claim.toLowerCase().includes('nome')) {
        contexts.push({
          source: 'wikidata',
          title: 'Dados da Pessoa',
          url: 'https://www.wikidata.org/wiki/example',
          content: `Dados biográficos e informações sobre ${claim}. Contexto para verificação de pessoas mencionadas.`,
          relevance_score: 0.7
        });
      }
    });
    
    // Add a general context if no specific ones were added
    if (contexts.length === 0) {
      contexts.push({
        source: 'wikipedia',
        title: 'Informações Gerais',
        url: 'https://pt.wikipedia.org/wiki/example',
        content: 'Contexto geral para verificação de afirmações sobre a atração turística.',
        relevance_score: 0.5
      });
    }
    
    return {
      contexts,
      total_contexts: contexts.length
    };
  } catch (error) {
    console.error('Error getting context for claims:', error);
    return {
      contexts: [],
      total_contexts: 0
    };
  }
}

export async function searchWikipedia(query: string): Promise<WikiContext[]> {
  // Mock implementation - in real version would use Wikipedia API
  return [{
    source: 'wikipedia',
    title: `Resultado para: ${query}`,
    url: 'https://pt.wikipedia.org/wiki/example',
    content: `Conteúdo de exemplo para a busca: ${query}`,
    relevance_score: 0.6
  }];
}

export async function searchWikidata(query: string): Promise<WikiContext[]> {
  // Mock implementation - in real version would use Wikidata SPARQL
  return [{
    source: 'wikidata',
    title: `Dados para: ${query}`,
    url: 'https://www.wikidata.org/wiki/example',
    content: `Dados estruturados para: ${query}`,
    relevance_score: 0.7
  }];
}

export function validateWikiContext(context: WikiContext): boolean {
  return (
    ['wikipedia', 'wikidata', 'iphan', 'unesco'].includes(context.source) &&
    typeof context.title === 'string' &&
    context.title.length > 0 &&
    typeof context.url === 'string' &&
    context.url.length > 0 &&
    typeof context.content === 'string' &&
    context.content.length > 0 &&
    typeof context.relevance_score === 'number' &&
    context.relevance_score >= 0 &&
    context.relevance_score <= 1
  );
}
