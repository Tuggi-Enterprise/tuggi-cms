/**
 * LRU cache simples com TTL e size limit.
 *
 * Substituição direta dos `Map<K, V>` estáticos espalhados pelos analyzers
 * (osmDataCache, surroundingHeightCache, obstructionsCache, elevationCache).
 *
 * Por que não usar `lru-cache` (npm)?
 *  - Adicionar dep externa pra ~40 linhas de lógica é overkill
 *  - Implementação inline mantém zero novas deps
 *  - LRU clássica via Map iteration order (insertion order é LRU naturalmente
 *    desde ES2015; basta delete+set pra mover ao final)
 *
 * Comportamento:
 *  - get: retorna entrada se existe E não expirou; senão removes e retorna undefined
 *  - set: insere; se exceder maxEntries, remove o mais antigo (head do Map)
 *  - delete/clear: opcionais pra limpeza manual
 *
 * Características:
 *  - TTL é por-entrada (timestamp salvo no set)
 *  - Eviction de LRU acontece NO SET (não em background)
 *  - Thread-safe? Em Node single-threaded sim. Pra worker_threads, cada worker
 *    tem seu próprio Map (caches são static class fields).
 */

interface LRUEntry<V> {
  value: V;
  expiresAt: number; // ms epoch; Infinity se sem TTL
}

export class LRUCacheWithTTL<K, V> {
  private map: Map<K, LRUEntry<V>>;
  private readonly maxEntries: number;
  private readonly ttlMs: number; // 0 = no TTL

  constructor(maxEntries: number, ttlMs: number = 0) {
    if (maxEntries <= 0) throw new Error('maxEntries must be > 0');
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    // TTL expired?
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }

    // LRU touch: move ao final (delete + set preserva insertion order)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove se já existe (pra atualizar order)
    if (this.map.has(key)) this.map.delete(key);

    // Eviction: se cheio, remove o mais antigo (primeiro do iterator)
    if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }

    const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : Infinity;
    this.map.set(key, { value, expiresAt });
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
