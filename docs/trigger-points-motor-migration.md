# 🔄 Migração para Motor Único de Trigger Points

**Data**: 2025-02-01  
**Objetivo**: Remover motor antigo e manter apenas `CoreTriggerPointPredictor` (SSOT)

---

## 📊 Status Atual

### ✅ **Motor Novo (Mantido)**
- **`CoreTriggerPointPredictor`** (`lib/services/trigger-points-google/core/trigger-point-predictor.ts`)
- **Usado em**:
  - ✅ `/api/trigger-points/google/generate` - API principal
  - ✅ `/trigger-points-single` - Página de teste
  - ✅ `/trigger-points-generation` - Via `ProcessingService` (chama API)
  - ✅ Pipeline de migração (já corrigido)

### ❌ **Motor Antigo (Para Remover)**
- **`TriggerPointsService`** (`lib/services/poi-processing/trigger-points.service.ts`)
- **Status**: Não usado mais após correção do pipeline

### ⚠️ **Funções Utilitárias (Manter se necessário)**
- **`lib/services/trigger-points-generation.ts`** - Funções auxiliares (enhanceTriggerPoints, calculatePOIConfidenceScore)
- **Usado em**: `app/api/poi-boundaries/detect/route.ts`
- **Ação**: Verificar se este endpoint ainda é usado

---

## 🔍 Verificações Necessárias

1. ✅ Pipeline de migração - **CORRIGIDO** - usa `CoreTriggerPointPredictor`
2. ✅ `/trigger-points-single` - **OK** - usa `CoreTriggerPointPredictor` via API
3. ✅ `/trigger-points-generation` - **OK** - usa `ProcessingService` que chama API
4. ⚠️ `/pois` - **VERIFICAR** - não gera TPs diretamente, apenas filtra
5. ⚠️ `app/api/poi-boundaries/detect/route.ts` - **VERIFICAR** se ainda é usado

---

## 📝 Plano de Ação

1. Verificar se `app/api/poi-boundaries/detect/route.ts` ainda é usado
2. Se não usado, remover
3. Remover `lib/services/poi-processing/trigger-points.service.ts`
4. Verificar e remover outras dependências do motor antigo

