# 🔄 FLUXO COMPLETO: Geração de Trigger Points

## 📊 Diagrama ASCII do Fluxo

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        🚀 ENTRADA: POI Data                            │
│  { name, location: {lat, lng}, osm_id?, osm_type?, ... }              │
└──────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  📊 STEP 1: Geographic Context Analysis                                │
│  ────────────────────────────────────────────────────────────────────  │
│  GeographicContextAnalyzer.analyzeGeographicContext()                  │
│                                                                         │
│  • Urban Density (very_dense, dense, medium, low, rural)               │
│  • Elevation Context (mountainous, hilly, flat)                        │
│  • Street Pattern (grid, organic, mixed)                               │
│  • Infrastructure (metro, highways, etc.)                               │
└──────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  🔍 STEP 2: Boundary Detection                                          │
│  ────────────────────────────────────────────────────────────────────  │
│  BoundaryDetector.detectBoundary()                                     │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 2.1: Query OSM (by ID or by name)                            │     │
│  │   • Busca boundary no OpenStreetMap                           │     │
│  │   • Extrai: coordinates, area, height, elevation              │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 2.2: 🎯 CLASSIFICAÇÃO DO POI (CRÍTICO!)                      │     │
│  │   POIClassifierService.classifyPOI()                         │     │
│  │                                                               │     │
│  │   INPUT:                                                     │     │
│  │   • Height (do OSM)                                          │     │
│  │   • Elevation (do OSM)                                       │     │
│  │   • Area (do boundary)                                       │     │
│  │   • Context (urban density, etc.)                            │     │
│  │                                                               │     │
│  │   PROCESSAMENTO:                                              │     │
│  │   ┌─────────────────────────────────────────────────────┐   │     │
│  │   │ 1. Calcula elevationDiff (POI - base regional)      │   │     │
│  │   │ 2. Classifica altura: HIGH (>50m), MEDIUM (10-50m), │   │     │
│  │   │    LOW (<10m)                                        │   │     │
│  │   │ 3. Classifica elevação: HIGH (>150m), LOW (≤150m)   │   │     │
│  │   │ 4. Classifica densidade: DENSE, NORMAL               │   │     │
│  │   │ 5. Classifica área: LARGE (>50k m²), NORMAL          │   │     │
│  │   └─────────────────────────────────────────────────────┘   │     │
│  │                                                               │     │
│  │   DECISÃO (IF/ELSE em ordem de prioridade):                  │     │
│  │                                                               │     │
│  │   IF (isHighElevation)                                       │     │
│  │     → GROUP: HIGH                                            │     │
│  │     → searchRadius: √elevationDiff × 200 (min 3km, max 15km)│     │
│  │     → strategy: 'circular'                                   │     │
│  │     → maxTriggerPoints: 200                                  │     │
│  │                                                               │     │
│  │   ELSE IF (isLowElevation && (isMediumStructure ||          │     │
│  │            (isHighStructure && isDenseArea)) &&             │     │
│  │            isDenseArea && !isLargeArea)                     │     │
│  │     → GROUP: CANYON                                          │     │
│  │     → searchRadius: 75m (FIXO)                              │     │
│  │     → strategy: 'linear'                                     │     │
│  │     → maxTriggerPoints: 15                                   │     │
│  │                                                               │     │
│  │   ELSE IF (isLowElevation && isHighStructure && !isDenseArea)│     │
│  │     → GROUP: MEDIUM                                          │     │
│  │     → searchRadius: height × 15 (min 200m, max 800m)       │     │
│  │     → strategy: 'circular'                                   │     │
│  │     → maxTriggerPoints: 100                                  │     │
│  │                                                               │     │
│  │   ELSE                                                        │     │
│  │     → GROUP: FLAT                                            │     │
│  │     → searchRadius: 120m (FIXO)                             │     │
│  │     → strategy: 'standard'                                   │     │
│  │     → maxTriggerPoints: 40                                   │     │
│  │                                                               │     │
│  │   OUTPUT: POIClassification {                                │     │
│  │     group: 'high' | 'medium' | 'canyon' | 'flat',           │     │
│  │     searchRadius: number,                                    │     │
│  │     strategy: 'circular' | 'linear' | 'standard',           │     │
│  │     maxTriggerPoints: number,                                │     │
│  │     minDistanceBetweenTPs: number,                           │     │
│  │     visibilityThreshold: number,                            │     │
│  │     streetPriority: string[],                               │     │
│  │     metadata: { reasoning, ... }                             │     │
│  │   }                                                           │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 2.3: Armazena classificação em boundary.classification       │     │
│  │   boundary = {                                                │     │
│  │     coordinates: [...],                                       │     │
│  │     area: number,                                             │     │
│  │     height: number,                                           │     │
│  │     elevation: {...},                                         │     │
│  │     classification: POIClassification  ← AQUI!               │     │
│  │   }                                                            │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
└──────────────────────────┼───────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  🛣️ STEP 3: Street Analysis                                             │
│  ────────────────────────────────────────────────────────────────────  │
│  StreetAnalyzer.findAccessibleStreetsWithMetadata()                     │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 3.1: 🧮 CALCULA RAIO DE BUSCA (PROBLEMA AQUI!)              │     │
│  │   calculateIntelligentRadius(boundary, context, poiData)     │     │
│  │                                                               │     │
│  │   ❌ PROBLEMA ANTERIOR:                                       │     │
│  │   • Ignorava boundary.classification                         │     │
│  │   • Calculava raio dinâmico baseado em altura                │     │
│  │   • Para Copan (118m): calculava 300m+                       │     │
│  │                                                               │     │
│  │   ✅ CORREÇÃO IMPLEMENTADA:                                  │     │
│  │   IF (boundary.classification?.group === 'canyon')           │     │
│  │     → return 75m (ou até 100m para POIs >100m)               │     │
│  │     → IGNORA cálculos dinâmicos                              │     │
│  │                                                               │     │
│  │   ELSE IF (boundary.classification?.group === 'flat')        │     │
│  │     → return 120m (da classificação)                        │     │
│  │                                                               │     │
│  │   ELSE IF (elevationDiff > 150)                              │     │
│  │     → return √elevationDiff × 200 (HIGH)                     │     │
│  │                                                               │     │
│  │   ELSE                                                        │     │
│  │     → Calcula raio dinâmico baseado em:                      │     │
│  │       • Base radius (por densidade urbana)                   │     │
│  │       • Height bonus                                         │     │
│  │       • Relative height (POI vs prédios vizinhos)            │     │
│  │       • Elevation adjustments                                │     │
│  │                                                               │     │
│  │   OUTPUT: searchRadius (number)                              │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 3.2: Busca ruas no OSM dentro do raio                        │     │
│  │   getRoadsAroundBoundary(boundary, searchRadius)              │     │
│  │                                                               │     │
│  │   • Query OSM Overpass API                                    │     │
│  │   • Filtra por: highway tags, accessibility                   │     │
│  │   • Remove: tunnels, private roads                            │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 3.3: Filtra ruas acessíveis                                  │     │
│  │   isStreetAccessible(road, context)                          │     │
│  │                                                               │     │
│  │   OUTPUT: StreetData[]                                       │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
└──────────────────────────┼───────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  🎯 STEP 4: Optimal Points Calculation                                  │
│  ────────────────────────────────────────────────────────────────────  │
│  OptimalPointCalculator.calculateOptimalPoints()                        │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 4.1: Lê boundary.classification                              │     │
│  │   • group: 'high' | 'medium' | 'canyon' | 'flat'             │     │
│  │   • strategy: 'circular' | 'linear' | 'standard'             │     │
│  │   • searchRadius: number (da classificação)                 │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 4.2: Filtra ruas pelo raio da classificação                  │     │
│  │   filterStreetsByRadius(streets, boundary,                   │     │
│  │                         classification.searchRadius)          │     │
│  │                                                               │     │
│  │   • Remove ruas fora do raio correto                         │     │
│  │   • Exemplo: Se CANYON (75m), remove ruas >75m               │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 4.3: Calcula pontos baseado na estratégia                    │     │
│  │                                                               │     │
│  │   IF (strategy === 'circular')  // HIGH, MEDIUM              │     │
│  │     → Múltiplas distâncias do boundary                       │     │
│  │     → [50m, 100m, 200m, 300m, ...] até searchRadius         │     │
│  │                                                               │     │
│  │   ELSE IF (strategy === 'linear')  // CANYON                 │     │
│  │     → Distâncias curtas (50m, 100m, 150m, 200m, 300m)       │     │
│  │     → Prioriza front street                                  │     │
│  │                                                               │     │
│  │   ELSE  // FLAT                                              │     │
│  │     → Estratégia padrão                                      │     │
│  │                                                               │     │
│  │   OUTPUT: TriggerPointCandidate[]                            │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
└──────────────────────────┼───────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ✅ STEP 5: Validation                                                  │
│  ────────────────────────────────────────────────────────────────────  │
│  TriggerPointValidator.validateAndRankPoints()                          │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 5.1: Validação de visibilidade                               │     │
│  │   • Verifica obstruções (buildings, vegetation)               │     │
│  │   • Usa boundary.classification.visibilityThreshold          │     │
│  │   • CANYON: threshold 0.6 (mais rigoroso)                     │     │
│  │   • HIGH: threshold 0.4 (menos rigoroso)                      │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 5.2: Ranking por qualidade                                   │     │
│  │   • Calcula score para cada candidato                        │     │
│  │   • Usa boundary.classification para determinar tipo         │     │
│  │     (primary, secondary, fallback)                            │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 5.3: Seleção com espaçamento mínimo                          │     │
│  │   • Usa boundary.classification.minDistanceBetweenTPs         │     │
│  │   • CANYON: 40m                                               │     │
│  │   • HIGH: 100m                                                │     │
│  │   • Calcula distância entre BORDAS dos ranges (20m cada)      │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │ 5.4: Limite máximo de TPs                                    │     │
│  │   • Usa boundary.classification.maxTriggerPoints              │     │
│  │   • CANYON: 15                                               │     │
│  │   • HIGH: 200                                                │     │
│  │   • OU calcula dinamicamente baseado em área de cobertura    │     │
│  └───────────────────────┬───────────────────────────────────────┘     │
│                          │                                               │
└──────────────────────────┼───────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  🎉 STEP 6: Final Trigger Points                                        │
│  ────────────────────────────────────────────────────────────────────  │
│  OUTPUT: TriggerPoint[]                                                 │
│                                                                         │
│  [                                                                      │
│    {                                                                   │
│      location: {lat, lng},                                             │
│      type: 'primary' | 'secondary' | 'fallback',                       │
│      expected_bearing: number,                                         │
│      confidence_score: number,                                         │
│      radius_meters: 20,                                                │
│      ...                                                                │
│    },                                                                  │
│    ...                                                                 │
│  ]                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## 🔑 Pontos Críticos do Fluxo

### 1. **Classificação (STEP 2.2)**
- **QUANDO**: Durante boundary detection
- **ONDE**: `BoundaryDetector.detectOSMBoundary()` → `POIClassifierService.classifyPOI()`
- **INPUT**: Height, Elevation, Area, Context
- **OUTPUT**: `POIClassification` armazenado em `boundary.classification`
- **DECISÃO**: IF/ELSE baseado em características físicas (NÃO tipo de POI)

### 2. **Uso da Classificação**
A classificação é usada em **TODOS** os passos subsequentes:

- **STEP 3.1**: `calculateIntelligentRadius()` 
  - ✅ **CORRIGIDO**: Agora verifica `boundary.classification.group` PRIMEIRO
  - Se CANYON → retorna 75m (ignora cálculos dinâmicos)
  
- **STEP 4.1**: `calculateOptimalPoints()`
  - Lê `boundary.classification.strategy`
  - Lê `boundary.classification.searchRadius`
  - Filtra ruas pelo raio correto
  
- **STEP 5**: `validateAndRankPoints()`
  - Usa `boundary.classification.visibilityThreshold`
  - Usa `boundary.classification.minDistanceBetweenTPs`
  - Usa `boundary.classification.maxTriggerPoints`

## ⚠️ Problema Identificado e Corrigido

### **ANTES (PROBLEMA)**:
```
STEP 3.1: calculateIntelligentRadius()
  ❌ Ignorava boundary.classification
  ❌ Calculava raio dinâmico: height × multipliers
  ❌ Para Copan (118m em canyon): 300m+ (ERRADO!)
```

### **DEPOIS (CORRIGIDO)**:
```
STEP 3.1: calculateIntelligentRadius()
  ✅ Verifica boundary.classification.group PRIMEIRO
  ✅ Se CANYON → retorna 75m (ou até 100m para POIs >100m)
  ✅ Ignora cálculos dinâmicos para CANYON
  ✅ Para Copan: 75-100m (CORRETO!)
```

## 📋 Resumo da Arquitetura

1. **Classificação é AGNÓSTICA**: Baseada apenas em física (elevação, altura, densidade, área)
2. **Classificação é ARMAZENADA**: Em `boundary.classification` após boundary detection
3. **Classificação é USADA**: Em todos os passos subsequentes (raio, estratégia, validação)
4. **Classificação é PRIORITÁRIA**: Deve ser verificada ANTES de cálculos dinâmicos

## 🎯 Regra de Ouro

> **A classificação determina TUDO**: raio, estratégia, quantidade, espaçamento, threshold.
> 
> **NUNCA** calcular raio dinamicamente se a classificação já definiu um raio fixo.
> 
> **SEMPRE** verificar `boundary.classification` antes de fazer cálculos dinâmicos.

