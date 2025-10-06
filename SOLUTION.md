# 🔍 Problema Identificado: Limite do Supabase JS Client

## 📊 Diagnóstico

O RPC `cms_search_pois` está funcionando corretamente no banco de dados:
- ✅ Com `fetch_all=true` retorna **34,803 POIs**
- ✅ Com `fetch_all=false` retorna **1,000 POIs**

Mas o **Supabase JavaScript Client** está limitando a resposta a **1000 registros** mesmo quando o RPC retorna mais.

## 🚨 Causa Raiz

O Supabase JS Client tem um **limite padrão de 1000 registros** por query. Mesmo que o RPC retorne mais dados, o cliente trunca a resposta.

## ✅ Solução

Temos 3 opções:

### Opção 1: Usar Paginação (RECOMENDADO)
Em vez de buscar todos os POIs de uma vez, buscar em lotes:

```typescript
// dashboard-service.ts
const PAGE_SIZE = 1000
const totalPages = Math.ceil(17100 / PAGE_SIZE) // ~18 páginas

const allPOIs = []
for (let page = 1; page <= totalPages; page++) {
  const result = await poiService.search({ 
    limit: PAGE_SIZE, 
    page: page 
  })
  allPOIs.push(...result.data)
}
```

### Opção 2: Usar Query Count (ALTERNATIVA)
Buscar apenas estatísticas agregadas de cidades sem buscar todos os POIs:

```sql
-- Criar novo RPC para estatísticas de cidades
CREATE OR REPLACE FUNCTION core.dashboard_city_stats()
RETURNS TABLE (
  city TEXT,
  poi_count BIGINT
)
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.city,
    COUNT(*) as poi_count
  FROM core.attractions a
  WHERE a.city IS NOT NULL
  GROUP BY a.city
  ORDER BY poi_count DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql;
```

### Opção 3: Aumentar Limite do Client (NÃO RECOMENDADO)
Configurar o Supabase client para aceitar mais registros (pode causar problemas de performance).

## 🎯 Recomendação

**Opção 2** é a melhor solução:
- ✅ Não precisa buscar todos os POIs
- ✅ Mais rápido e eficiente
- ✅ Retorna apenas os dados necessários (contagem por cidade)
- ✅ Não sobrecarrega o frontend com 17k POIs

## 📋 Implementação da Solução Recomendada

Vou criar um novo RPC `dashboard_city_stats` que retorna apenas as estatísticas de cidades.
