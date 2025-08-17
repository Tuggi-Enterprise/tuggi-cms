import { createClient } from '@supabase/supabase-js';

// =========================================
// TIPOS E INTERFACES
// =========================================

export interface Country {
  id: string;
  code: string;
  name: string;
  name_native: string;
  flag_emoji: string;
  language_code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VerificationSource {
  id: string;
  country_id: string;
  source_name: string;
  source_type: 'government' | 'encyclopedia' | 'official' | 'heritage';
  base_url: string;
  search_endpoint?: string;
  api_key_required: boolean;
  priority: number;
  is_active: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface SearchConfig {
  id: string;
  source_id: string;
  search_type: 'keyword' | 'entity' | 'structured' | 'api';
  query_template: string;
  headers: Record<string, string>;
  rate_limit_rps: number;
  timeout_ms: number;
  retry_attempts: number;
  cache_ttl_hours: number;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  source: string;
  title: string;
  content: string;
  url?: string;
  relevance: number;
  priority: 'primary' | 'official' | 'secondary';
}

export interface SearchCache {
  id: string;
  source_id: string;
  query_hash: string;
  query_text: string;
  results: SearchResult[];
  created_at: string;
  expires_at: string;
}

export interface SearchLog {
  id: string;
  source_id: string;
  query_text: string;
  status: 'success' | 'error' | 'timeout';
  response_time_ms?: number;
  results_count: number;
  error_message?: string;
  user_id?: string;
  created_at: string;
}

// =========================================
// SERVIÇO DE FONTES DINÂMICAS
// =========================================

export class DynamicSourceService {
  private supabase;
  private cache = new Map<string, { data: any; expires: number }>();

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  // =========================================
  // MÉTODOS DE PAÍSES
  // =========================================

  /**
   * Obter todos os países ativos
   */
  async getActiveCountries(): Promise<Country[]> {
    const cacheKey = 'active_countries';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .schema('core')
      .from('countries')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Error fetching active countries:', error);
      return [];
    }

    this.setCache(cacheKey, data, 3600000); // 1 hora
    return data || [];
  }

  /**
   * Obter país por código
   */
  async getCountryByCode(code: string): Promise<Country | null> {
    const cacheKey = `country_${code}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .schema('core')
      .from('countries')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .single();

    if (error) {
      console.error(`Error fetching country ${code}:`, error);
      return null;
    }

    this.setCache(cacheKey, data, 3600000); // 1 hora
    return data;
  }

  /**
   * Obter idioma por código do país
   */
  async getLanguageForCountry(countryCode: string): Promise<string> {
    const country = await this.getCountryByCode(countryCode);
    return country?.language_code || 'en-us';
  }

  // =========================================
  // MÉTODOS DE FONTES
  // =========================================

  /**
   * Obter fontes ativas para um país
   */
  async getSourcesForCountry(countryCode: string): Promise<VerificationSource[]> {
    const cacheKey = `sources_${countryCode}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .schema('core')
      .from('country_verification_sources')
      .select(`
        *,
        countries!inner(code, language_code)
      `)
      .eq('countries.code', countryCode)
      .eq('is_active', true)
      .order('priority', { ascending: true });

    if (error) {
      console.error(`Error fetching sources for ${countryCode}:`, error);
      return [];
    }

    this.setCache(cacheKey, data, 1800000); // 30 minutos
    return data || [];
  }

  /**
   * Obter configuração de busca para uma fonte
   */
  async getSearchConfig(sourceId: string): Promise<SearchConfig | null> {
    const cacheKey = `config_${sourceId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .schema('core')
      .from('source_search_configs')
      .select('*')
      .eq('source_id', sourceId)
      .single();

    if (error) {
      console.error(`Error fetching search config for ${sourceId}:`, error);
      return null;
    }

    this.setCache(cacheKey, data, 1800000); // 30 minutos
    return data;
  }

  // =========================================
  // MÉTODOS DE BUSCA
  // =========================================

  /**
   * Buscar em uma fonte específica
   */
  async searchSource(
    source: VerificationSource,
    query: string,
    userId?: string
  ): Promise<SearchResult[]> {
    const startTime = Date.now();
    
    try {
      // Verificar cache primeiro
      const cachedResults = await this.getFromSearchCache(source.id, query);
      if (cachedResults) {
        await this.logSearch(source.id, query, 'success', Date.now() - startTime, cachedResults.length, userId);
        return cachedResults;
      }

      // Obter configuração de busca
      const config = await this.getSearchConfig(source.id);
      if (!config) {
        throw new Error('No search configuration found');
      }

      // Executar busca
      const results = await this.executeSearch(source, config, query);
      
      // Salvar no cache
      await this.saveToSearchCache(source.id, query, results, config.cache_ttl_hours);
      
      // Log da busca
      await this.logSearch(source.id, query, 'success', Date.now() - startTime, results.length, userId);
      
      return results;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.logSearch(source.id, query, 'error', Date.now() - startTime, 0, userId, errorMessage);
      throw error;
    }
  }

  /**
   * Buscar em múltiplas fontes de um país
   */
  async searchCountrySources(
    countryCode: string,
    queries: string[],
    userId?: string
  ): Promise<SearchResult[]> {
    const sources = await this.getSourcesForCountry(countryCode);
    const allResults: SearchResult[] = [];

    for (const source of sources) {
      for (const query of queries) {
        try {
          const results = await this.searchSource(source, query, userId);
          allResults.push(...results);
        } catch (error) {
          console.error(`Error searching ${source.source_name} for "${query}":`, error);
        }
      }
    }

    // Ordenar por relevância e prioridade
    return allResults.sort((a, b) => {
      const priorityOrder = { primary: 3, official: 2, secondary: 1 };
      const aPriority = priorityOrder[a.priority] || 1;
      const bPriority = priorityOrder[b.priority] || 1;
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      return b.relevance - a.relevance;
    });
  }

  // =========================================
  // MÉTODOS DE CACHE
  // =========================================

  /**
   * Obter resultado do cache de busca
   */
  private async getFromSearchCache(sourceId: string, query: string): Promise<SearchResult[] | null> {
    const queryHash = await this.hashQuery(query);
    
    const { data, error } = await this.supabase
      .schema('core')
      .from('source_search_cache')
      .select('results')
      .eq('source_id', sourceId)
      .eq('query_hash', queryHash)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !data) {
      return null;
    }

    return data.results;
  }

  /**
   * Salvar resultado no cache de busca
   */
  private async saveToSearchCache(
    sourceId: string,
    query: string,
    results: SearchResult[],
    ttlHours: number
  ): Promise<void> {
    const queryHash = await this.hashQuery(query);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const { error } = await this.supabase
      .schema('core')
      .from('source_search_cache')
      .upsert({
        source_id: sourceId,
        query_hash: queryHash,
        query_text: query,
        results: results,
        expires_at: expiresAt.toISOString()
      });

    if (error) {
      console.error('Error saving to search cache:', error);
    }
  }

  /**
   * Gerar hash da query
   */
  private async hashQuery(query: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(query);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // =========================================
  // MÉTODOS DE LOG
  // =========================================

  /**
   * Registrar log de busca
   */
  private async logSearch(
    sourceId: string,
    query: string,
    status: 'success' | 'error' | 'timeout',
    responseTimeMs: number,
    resultsCount: number,
    userId?: string,
    errorMessage?: string
  ): Promise<void> {
    const { error } = await this.supabase
      .schema('core')
      .from('source_search_logs')
      .insert({
        source_id: sourceId,
        query_text: query,
        status: status,
        response_time_ms: responseTimeMs,
        results_count: resultsCount,
        error_message: errorMessage,
        user_id: userId
      });

    if (error) {
      console.error('Error logging search:', error);
    }
  }

  // =========================================
  // MÉTODOS DE EXECUÇÃO DE BUSCA
  // =========================================

  /**
   * Executar busca em uma fonte
   */
  private async executeSearch(
    source: VerificationSource,
    config: SearchConfig,
    query: string
  ): Promise<SearchResult[]> {
    const url = this.buildSearchUrl(source, config, query);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'TuggiVerification/1.0 (contact@tuggi.app)',
        ...config.headers
      },
      signal: AbortSignal.timeout(config.timeout_ms)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.text();
    return this.parseSearchResults(source, data, query);
  }

  /**
   * Construir URL de busca
   */
  private buildSearchUrl(source: VerificationSource, config: SearchConfig, query: string): string {
    const baseUrl = source.base_url;
    const endpoint = source.search_endpoint || '';
    const template = config.query_template.replace('{query}', encodeURIComponent(query));
    
    return `${baseUrl}${endpoint}${template}`;
  }

  /**
   * Parsear resultados da busca
   */
  private parseSearchResults(source: VerificationSource, data: string, query: string): SearchResult[] {
    // Implementação básica - pode ser expandida por tipo de fonte
    const results: SearchResult[] = [];
    
    try {
      // Para Wikipedia API
      if (source.source_name.includes('Wikipedia')) {
        const json = JSON.parse(data);
        if (json.query?.search) {
          json.query.search.forEach((item: any) => {
            results.push({
              source: source.source_name.toLowerCase().replace(/\s+/g, '_'),
              title: item.title,
              content: item.snippet,
              url: `https://${source.base_url.replace('https://', '')}/wiki/${encodeURIComponent(item.title)}`,
              relevance: 0.8,
              priority: 'secondary'
            });
          });
        }
      } else {
        // Para outras fontes, implementar parsers específicos
        results.push({
          source: source.source_name.toLowerCase().replace(/\s+/g, '_'),
          title: `${source.source_name} - ${query}`,
          content: data.substring(0, 500),
          url: source.base_url,
          relevance: 0.6,
          priority: source.source_type === 'government' ? 'official' : 'secondary'
        });
      }
    } catch (error) {
      console.error('Error parsing search results:', error);
    }

    return results;
  }

  // =========================================
  // MÉTODOS DE CACHE EM MEMÓRIA
  // =========================================

  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttlMs
    });
  }

  // =========================================
  // MÉTODOS DE UTILIDADE
  // =========================================

  /**
   * Limpar cache expirado
   */
  async cleanupExpiredCache(): Promise<number> {
    const { data, error } = await this.supabase
      .rpc('cleanup_expired_cache');

    if (error) {
      console.error('Error cleaning up cache:', error);
      return 0;
    }

    return data || 0;
  }

  /**
   * Obter estatísticas de uso
   */
  async getUsageStats(): Promise<any[]> {
    const { data, error } = await this.supabase
      .schema('core')
      .from('v_source_usage_stats')
      .select('*');

    if (error) {
      console.error('Error fetching usage stats:', error);
      return [];
    }

    return data || [];
  }
}

// =========================================
// INSTÂNCIA SINGLETON
// =========================================

export const dynamicSourceService = new DynamicSourceService();
