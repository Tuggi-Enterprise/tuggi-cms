# Código Morto Identificado - Limpeza Necessária

**Data**: 2025-01-XX  
**Objetivo**: Identificar e remover código não utilizado após consolidação do sistema de trigger points

---

## 🔴 CÓDIGO MORTO CONFIRMADO (Pode ser removido)

### 1. **DataDrivenTriggerPointsService** ❌ **NÃO USADO**

**Arquivo**: `lib/services/poi-processing/trigger-points-data-driven.service.ts` (1327 linhas)

**Evidências**:
- ✅ Nenhuma importação encontrada no código
- ✅ Nenhuma chamada a `DataDrivenTriggerPointsService.generate()` ou `new DataDrivenTriggerPointsService()`
- ✅ Sistema atual usa `CoreTriggerPointPredictor` como SSOT

**Ação**: **REMOVER** arquivo completo

---

### 2. **Backups da Edge Function** ❌ **NÃO NECESSÁRIOS**

**Arquivos**:
- `supabase/functions/generate-trigger-points/index-legacy-backup.ts`
- `supabase/functions/generate-trigger-points/index-hybrid-backup.ts`
- `supabase/functions/generate-trigger-points/index-broken-backup.ts`
- `supabase/functions/generate-trigger-points/legacy-functions.ts` (se existir)

**Evidências**:
- ✅ São apenas backups históricos
- ✅ Não são usados em produção
- ✅ Sistema atual usa `CoreTriggerPointPredictor` via API routes

**Ação**: **REMOVER** todos os arquivos de backup

---

## 🟡 CÓDIGO POTENCIALMENTE MORTO (Verificar antes de remover)

### 3. **Edge Function Principal** ⚠️ **VERIFICAR USO**

**Arquivo**: `supabase/functions/generate-trigger-points/index.ts` (~4685 linhas)

**Evidências**:
- ⚠️ Não encontradas chamadas diretas via `supabase.functions.invoke('generate-trigger-points')`
- ⚠️ Apenas referências em comentários de outros arquivos:
  - `app/api/pois/update-boundary/route.ts` (comentário)
  - `lib/services/trigger-points-google/utils/osm-validation.ts` (comentário)
- ✅ Sistema atual usa `CoreTriggerPointPredictor` via `/api/trigger-points/google/generate`

**Ação**: 
1. Verificar logs do Supabase para confirmar se Edge Function é chamada
2. Se não for usada, **DEPRECAR** e depois **REMOVER**

---

### 4. **TriggerPointsService (trigger-points-generation.ts)** ⚠️ **VERIFICAR FUNÇÕES ESPECÍFICAS**

**Arquivo**: `lib/services/trigger-points-generation.ts` (~957 linhas)

**Status**: Arquivo tem funções que podem estar sendo usadas

**Funções que PODEM estar sendo usadas**:
- ✅ `filterTriggerPointsBySpacing()` - Pode ser útil para fallback
- ✅ `enhanceTriggerPoints()` - Usado apenas na Edge Function (código morto)
- ✅ `calculatePOIConfidenceScore()` - Usado apenas na Edge Function (código morto)
- ✅ `calculateBearingToBoundary()` - Usado internamente no arquivo
- ✅ `findClosestPointOnBoundary()` - **DUPLICADO** (já existe versão melhorada em `calculations.ts`)

**Funções que SÃO DUPLICADAS**:
- ❌ `findClosestPointOnBoundary()` - Já existe em `lib/services/trigger-points-google/utils/calculations.ts` (versão melhorada)
- ❌ `calculatePolygonArea()` - Já existe em `calculations.ts`
- ❌ `isPointInPolygon()` - Já existe em `calculations.ts`

**Ação**:
1. Verificar se `filterTriggerPointsBySpacing()` é usado
2. Se não for usado, **REMOVER** funções não utilizadas
3. **REMOVER** funções duplicadas (usar versões de `calculations.ts`)

---

## 📋 RESUMO DE AÇÕES

### 🔴 Remover Imediatamente

1. ✅ `lib/services/poi-processing/trigger-points-data-driven.service.ts` (1327 linhas)
2. ✅ `supabase/functions/generate-trigger-points/index-legacy-backup.ts`
3. ✅ `supabase/functions/generate-trigger-points/index-hybrid-backup.ts`
4. ✅ `supabase/functions/generate-trigger-points/index-broken-backup.ts`

### 🟡 Verificar e Deprecar

5. ⚠️ `supabase/functions/generate-trigger-points/index.ts` - Verificar uso antes de remover
6. ⚠️ `lib/services/trigger-points-generation.ts` - Remover funções duplicadas e não utilizadas

---

## 💾 ESTIMATIVA DE REDUÇÃO

- **Código morto confirmado**: ~2000+ linhas
- **Código potencialmente morto**: ~5000+ linhas (Edge Function)
- **Total potencial de limpeza**: ~7000+ linhas

---

## ⚠️ NOTAS IMPORTANTES

1. **Edge Function**: Antes de remover, verificar:
   - Logs do Supabase para chamadas recentes
   - Se há integrações externas que podem estar usando
   - Se há scripts de migração que dependem dela

2. **trigger-points-generation.ts**: 
   - Manter apenas funções realmente úteis
   - Remover duplicações (usar `calculations.ts` como SSOT)
   - Se arquivo ficar muito pequeno, considerar mover funções restantes para local apropriado

3. **Backups**: 
   - Se houver necessidade histórica, mover para pasta `archive/` ou `backup/`
   - Não manter em pasta de código ativo

---

## ✅ PRÓXIMOS PASSOS

1. ✅ **CONCLUÍDO**: Remover código morto confirmado
   - ✅ `DataDrivenTriggerPointsService` removido
   - ✅ Backups da Edge Function removidos
2. ⚠️ Verificar uso da Edge Function antes de remover
3. ⚠️ Limpar duplicações em `trigger-points-generation.ts` (se necessário)
4. ⚠️ Atualizar documentação removendo referências a código morto

---

## ✅ LIMPEZA REALIZADA

**Arquivos Removidos**:
- ✅ `lib/services/poi-processing/trigger-points-data-driven.service.ts` (1327 linhas)
- ✅ `supabase/functions/generate-trigger-points/index-legacy-backup.ts`
- ✅ `supabase/functions/generate-trigger-points/index-hybrid-backup.ts`
- ✅ `supabase/functions/generate-trigger-points/index-broken-backup.ts`

**Total Removido**: ~1400+ linhas de código morto

