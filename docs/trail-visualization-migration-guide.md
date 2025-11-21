# Trail Visualization - Migration Guide

## Problema de Timeout

Se você encontrou erro de timeout ao executar a migration, siga este guia para criar os índices de forma segura.

## Solução: Executar em Etapas

### Opção 1: Executar via Supabase SQL Editor (Recomendado)

1. **Acesse o Supabase Dashboard**
   - Vá para SQL Editor
   - Isso permite executar queries com timeout maior

2. **Execute os índices um por vez:**

```sql
-- ÍNDICE 1: Mais importante - execute primeiro
CREATE INDEX IF NOT EXISTS idx_route_trail_lat_lng 
ON drive.route_trail (latitude, longitude);
```

Aguarde a conclusão (pode levar alguns minutos), depois execute:

```sql
-- ÍNDICE 2
CREATE INDEX IF NOT EXISTS idx_route_trail_user_time_location 
ON drive.route_trail (user_id, timestamp DESC, latitude, longitude);
```

```sql
-- ÍNDICE 3
CREATE INDEX IF NOT EXISTS idx_route_trail_timestamp_global 
ON drive.route_trail (timestamp DESC);
```

```sql
-- ÍNDICE 4
CREATE INDEX IF NOT EXISTS idx_route_trail_trip_location 
ON drive.route_trail (trip_session_id, sequence_order, latitude, longitude);
```

### Opção 2: Usar CONCURRENTLY (Para Produção)

Se você tem tráfego ativo no banco, use `CONCURRENTLY` para evitar bloqueios:

```sql
-- Execute diretamente no SQL Editor (não funciona em transações)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_trail_lat_lng 
ON drive.route_trail (latitude, longitude);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_trail_user_time_location 
ON drive.route_trail (user_id, timestamp DESC, latitude, longitude);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_trail_timestamp_global 
ON drive.route_trail (timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_trail_trip_location 
ON drive.route_trail (trip_session_id, sequence_order, latitude, longitude);
```

**Nota:** `CONCURRENTLY` não pode ser usado dentro de uma transação, então execute diretamente no SQL Editor.

### Opção 3: Aumentar Timeout

Se você precisa executar a migration completa:

1. No Supabase Dashboard, vá em **Settings** → **Database**
2. Aumente o **Statement Timeout** temporariamente
3. Execute a migration
4. Restaure o timeout original

## Verificação

Após criar os índices, verifique se foram criados:

```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'route_trail' AND schemaname = 'drive'
ORDER BY indexname;
```

Você deve ver:
- `idx_route_trail_lat_lng`
- `idx_route_trail_user_time_location`
- `idx_route_trail_timestamp_global`
- `idx_route_trail_trip_location`

## Materialized View (Opcional)

A materialized view para heat map é **opcional**. O sistema funciona sem ela usando agregação em tempo real.

Se quiser criar (melhor performance para heat maps):

```sql
-- Execute separadamente - pode levar 10-30 minutos
CREATE MATERIALIZED VIEW IF NOT EXISTS drive.trail_heatmap_grid AS
SELECT 
  FLOOR(latitude * 1000) / 1000 AS grid_lat,
  FLOOR(longitude * 1000) / 1000 AS grid_lng,
  COUNT(*) AS point_count,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(DISTINCT trip_session_id) AS unique_trips,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen,
  AVG(speed) AS avg_speed,
  SUM(CASE WHEN is_moving THEN 1 ELSE 0 END) AS moving_points
FROM drive.route_trail
WHERE is_moving = true
GROUP BY grid_lat, grid_lng;

CREATE INDEX IF NOT EXISTS idx_heatmap_grid_coords 
ON drive.trail_heatmap_grid (grid_lat, grid_lng);
```

## Tempo Estimado

- **10k-50k linhas**: 1-3 minutos por índice
- **50k-100k linhas**: 3-5 minutos por índice  
- **100k+ linhas**: 5-15 minutos por índice

## Próximos Passos

Após criar os índices:

1. ✅ A página `/trail-visualization` já está funcionando
2. ✅ Os índices melhorarão a performance das queries
3. ⚠️ Se ainda houver timeout nas queries, considere:
   - Reduzir o limite de pontos retornados
   - Filtrar por intervalo de tempo menor
   - Usar a materialized view para heat maps

