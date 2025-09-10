# Solução para Problema de Cache no Vercel

## 🔍 Problema Identificado

No ambiente Vercel, quando um POI tem seu nome alterado ou é excluído, as mudanças não aparecem rapidamente devido ao sistema de cache em memória implementado na aplicação.

## 📊 Análise do Sistema de Cache Atual

### Cache em Memória (MemoryCache)
- **Localização**: `/lib/cache/memory-cache.ts`
- **TTL padrão**: 10 minutos
- **Chaves de cache**: `pois-search:*` e `pois-search-all:*`
- **Limpeza automática**: A cada 5 minutos

### APIs que Modificam POIs
1. **Bulk Delete** (`/api/pois/bulk-delete`) ✅ - **JÁ INVALIDA CACHE**
2. **Update Coordinates** (`/api/pois/update-coordinates`) ❌ - **NÃO INVALIDA CACHE**
3. **Enrich OSM** (`/api/pois/enrich-osm`) ❌ - **NÃO INVALIDA CACHE**
4. **POI Importer** (`/poi-importer/page.tsx`) ❌ - **NÃO INVALIDA CACHE**
5. **POI Management** (`/pois/page.tsx`) ❌ - **NÃO INVALIDA CACHE**

## 🛠️ Soluções Propostas

### 1. Implementar Invalidação de Cache Consistente

Criar uma função utilitária para invalidar cache de POIs:

```typescript
// lib/cache/poi-cache-invalidator.ts
import { memoryCache } from '@/lib/cache/memory-cache'

export function invalidatePOICache(reason?: string) {
  const allKeys = Array.from((memoryCache as any).cache.keys()) as string[]
  let clearedEntries = 0
  
  for (const key of allKeys) {
    if (key.startsWith('pois-search') || key.startsWith('pois-search-all')) {
      memoryCache.delete(key)
      clearedEntries++
    }
  }
  
  console.log(`🧹 Cache invalidated: ${clearedEntries} entries cleared${reason ? ` (${reason})` : ''}`)
  return clearedEntries
}
```

### 2. Adicionar Invalidação nas APIs que Modificam POIs

#### A. Update Coordinates API
```typescript
// Adicionar no final da função POST em /api/pois/update-coordinates/route.ts
import { invalidatePOICache } from '@/lib/cache/poi-cache-invalidator'

// Após sucesso na atualização
invalidatePOICache('POI coordinates updated')
```

#### B. Enrich OSM API
```typescript
// Adicionar no final da função updatePOIWithOSMData em /api/pois/enrich-osm/route.ts
import { invalidatePOICache } from '@/lib/cache/poi-cache-invalidator'

// Após sucesso na atualização
invalidatePOICache('POI enriched with OSM data')
```

#### C. POI Management (Delete)
```typescript
// Adicionar após delete em /pois/page.tsx
// Fazer uma chamada para uma nova API de invalidação
fetch('/api/cache/invalidate-poi', { method: 'POST' })
```

### 3. Criar API de Invalidação de Cache

```typescript
// app/api/cache/invalidate-poi/route.ts
import { NextResponse } from 'next/server'
import { invalidatePOICache } from '@/lib/cache/poi-cache-invalidator'

export async function POST() {
  try {
    const clearedEntries = invalidatePOICache('Manual invalidation')
    
    return NextResponse.json({
      success: true,
      message: `Cache invalidated successfully`,
      clearedEntries
    })
  } catch (error) {
    console.error('Error invalidating cache:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to invalidate cache' },
      { status: 500 }
    )
  }
}
```

### 4. Configurações Adicionais para Vercel

#### A. Reduzir TTL do Cache
```typescript
// Alterar TTL padrão de 10 para 5 minutos em situações de desenvolvimento
const isDevelopment = process.env.NODE_ENV === 'development'
const defaultTTL = isDevelopment ? 2 : 10 // 2 min em dev, 10 min em prod
```

#### B. Adicionar Headers de Cache Control
```typescript
// Em /api/pois/search/route.ts
const response = NextResponse.json(result)
response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
response.headers.set('Pragma', 'no-cache')
response.headers.set('Expires', '0')
return response
```

## 🚀 Implementação Prioritária

### Fase 1 - Correção Imediata
1. ✅ Criar função `invalidatePOICache`
2. ✅ Adicionar invalidação em `update-coordinates`
3. ✅ Adicionar invalidação em `enrich-osm`
4. ✅ Criar API `/api/cache/invalidate-poi`

### Fase 2 - Melhorias
1. Adicionar invalidação no POI Importer
2. Adicionar invalidação no frontend (delete POI)
3. Implementar headers de cache control
4. Reduzir TTL em desenvolvimento

## 🔧 Configurações do Vercel

### Edge Runtime Considerations
- O cache em memória funciona por instância
- No Vercel, cada função serverless é uma instância separada
- Cache pode persistir entre invocações na mesma instância
- Invalidação deve ser feita em todas as operações de modificação

### Alternativas Futuras
1. **Redis Cache**: Para cache distribuído
2. **Revalidation Tags**: Usar Next.js 13+ revalidation
3. **Database Triggers**: Invalidar cache via triggers do Supabase

## 📝 Notas Importantes

- O problema é mais evidente no Vercel devido ao cache persistir entre requests
- A solução atual (bulk-delete) já implementa invalidação corretamente
- Outras APIs precisam seguir o mesmo padrão
- Cache em memória é eficiente mas requer invalidação manual
- Considerar migração para cache distribuído em produção

## 🧪 Testes Recomendados

1. Testar alteração de nome de POI
2. Testar exclusão de POI
3. Testar atualização de coordenadas
4. Verificar se cache é invalidado corretamente
5. Confirmar que dados atualizados aparecem imediatamente

---

**Status**: Solução identificada e pronta para implementação
**Impacto**: Alto - resolve problema de UX crítico
**Complexidade**: Baixa - mudanças pontuais em APIs existentes