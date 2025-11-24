# Análise Profunda: Regras Reais do Sistema de Trigger Points

## Objetivo
Analisar o código sem viés ou suposições, documentando as regras reais que o sistema implementa para processar POIs de todo o Brasil.

---

## 1. CLASSIFICAÇÃO DE POIs (POIClassifierService)

### Regras de Classificação (4 Grupos Universais)

#### GRUPO HIGH (Alta Elevação)
**Critérios:**
- `elevationDiff > 150m` (diferença de elevação relativa à base regional)
- Qualquer altura de estrutura

**Configuração:**
- `searchRadius`: Fórmula `√(elevationDiff) × 200`, min 3000m, max 15000m
- `strategy`: `'circular'` (múltiplas ruas, múltiplas distâncias)
- `maxTriggerPoints`: 50
- `minDistanceBetweenTPs`: 100m
- `visibilityThreshold`: 0.3 (menos restritivo)
- `streetPriority`: ['motorway', 'trunk', 'primary']
- `blockStreets`: ['residential', 'unclassified', 'tertiary', 'secondary']

#### GRUPO MEDIUM (Estrutura Alta)
**Critérios:**
- `elevationDiff <= 150m` (baixa elevação)
- `height > 50m` (estrutura alta)
- `!isDenseArea` (área NÃO densa)

**Configuração:**
- `searchRadius`: Fórmula `height × 15`, min 750m, max 5000m
- `strategy`: `'circular'`
- `maxTriggerPoints`: 35
- `minDistanceBetweenTPs`: 80m
- `visibilityThreshold`: 0.4
- `streetPriority`: ['motorway', 'trunk', 'primary', 'secondary']
- `blockStreets`: [] (não bloqueia)

#### GRUPO CANYON (Canyon Urbano)
**Critérios:**
- `elevationDiff <= 150m` (baixa elevação)
- `(height >= 10m && height <= 50m) || (height > 50m && isDenseArea)` (estrutura média OU alta em área densa)
- `isDenseArea` (área densa ou muito densa)
- `area <= 50000m²` (área pequena/média)

**Configuração:**
- `searchRadius`: `fixed: 75m` (raio fixo muito limitado)
- `strategy`: `'linear'` (prioriza front street)
- `maxTriggerPoints`: 15
- `minDistanceBetweenTPs`: 40m
- `visibilityThreshold`: 0.6 (muito restritivo)
- `streetPriority`: ['primary', 'secondary', 'tertiary']
- `blockStreets`: []
- `specialRules`: `prioritizeFrontStreet: true`, `rigorousVisibilityCheck: true`

#### GRUPO FLAT (Padrão)
**Critérios:**
- Todos os POIs que não se encaixam nos grupos acima
- Geralmente: baixa elevação + baixa altura (<10m) OU estrutura média em área não densa OU elevação muito baixa + área grande

**Configuração:**
- `searchRadius`: `fixed: 180m` (raio fixo)
- `strategy`: `'standard'` (um ponto por rua)
- `maxTriggerPoints`: 40
- `minDistanceBetweenTPs`: 40m
- `visibilityThreshold`: 0.5 (moderado)
- `streetPriority`: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential']
- `blockStreets`: [] (não bloqueia)

---

## 2. DETECÇÃO DE DENSIDADE URBANA (GeographicContextAnalyzer)

### Regras de Classificação

**Fonte de Dados:**
- Google Places API: `type: 'store'` (raio 500m)
- Google Places API: `type: 'transit_station'` (raio 500m)
- Google Places API: `type: 'establishment'` (raio 1000m)

**Cálculo:**
- `totalEstablishments = establishment results.length`
- `areaKm2 = π × 1.0² = 3.14 km²`
- `density = totalEstablishments / areaKm2`

**Thresholds:**
- `very_dense`: `density > 400` OU `businessCount > 15`
- `dense`: `density > 200` OU `businessCount > 10`
- `medium`: `density > 80` OU `businessCount > 5`
- `low`: `density > 20` OU `businessCount > 2`
- `rural`: Caso contrário (default)

**Problema Identificado:**
- Se Google Places API retornar 0 resultados, sistema classifica como `rural`
- Não há fallback usando dados do OSM (prédios encontrados no boundary detection)

---

## 3. CÁLCULO DE RAIO DE BUSCA (StreetAnalyzer.calculateIntelligentRadius)

### Regras de Cálculo (Ordem de Precedência)

#### STEP 1: POIs de Alta Elevação (>150m diferença)
- **Fórmula**: `√(elevationDiff) × 200`
- **Limites**: min 3000m, max 15000m
- **Precedência**: MÁXIMA (sobrescreve tudo)

#### STEP 2: POIs FLAT (elevationDiff <= 50m)
- **Raio fixo**: `100m` (limite fixo do boundary)
- **Precedência**: Alta (sobrescreve configuração do grupo)

#### STEP 3: Base por Densidade Urbana
- `very_dense`: 150m
- `dense`: 200m
- `medium`: 300m
- `low`: 400m
- `rural`: 500m

#### STEP 4: Ajustes por Elevação Absoluta
- `elevation > 1000m`: `+((elevation - 1000) × 10 + 2000)m` (max 4000m)
- `elevation > 800m`: `+((elevation - 800) × 6 + 1200)m` (max 2500m)
- `elevation > 400m`: `+((elevation - 400) × 2)m` (max 800m)

#### STEP 5: Ajustes por Elevação Relativa (Interna)
- `elevationDiff > 50m`: `+(elevationDiff × 8)m` (max 400m)
- `elevationDiff > 20m`: `+(elevationDiff × 5)m`
- `elevationDiff < -20m`: `-(|elevationDiff| × 3)m` (min 150m)

#### STEP 6: Ajustes por Altura do POI
- `height > 10m`: `+(height × 6)m` (max 300m)

#### STEP 7: Ajustes por Altura Relativa (em áreas densas)
- **Área densa + altura relativa > 100m**: Raio baseado na diferença (substitui base)
- **Área densa + altura relativa > 50m**: Raio baseado na diferença (substitui base)
- **Área densa + altura relativa > 20m**: Raio baseado na diferença (substitui base)
- **Área densa + altura relativa > 0m**: Raio baseado na diferença (substitui base)
- **Área densa + altura relativa <= 0m**: `20-30m base + (|diff| × 0.5)m`

#### STEP 8: Ajustes por Tipo de Terreno
- `mountainous`: `× 1.4`
- `hilly`: `× 1.2`

#### STEP 9: Limites de Segurança
- Min: 150m (da configuração)
- Max: 8000m (da configuração)
- Aplicar: `Math.max(min, Math.min(calculated, max))`

**IMPORTANTE:** Para POIs FLAT, o STEP 2 (100m fixo) tem precedência sobre STEP 3-9.

---

## 4. ESTRATÉGIAS DE GERAÇÃO DE TPs (OptimalPointCalculator)

### Estratégia CIRCULAR (HIGH, MEDIUM)
- Gera múltiplos TPs em múltiplas ruas
- Usa múltiplas distâncias do boundary: [300m, 800m, 1500m, 2500m, 4000m, 8000m]
- Para cada rua, tenta encontrar pontos em cada distância alvo

### Estratégia LINEAR (CANYON)
- Prioriza front street (rua mais próxima do boundary)
- Usa distâncias curtas: [50m, 100m, 150m, 200m, 300m]
- Bonus de qualidade para front street: `+0.3`

### Estratégia STANDARD (FLAT)
- **REGRA CRÍTICA**: `One point per street`
- Para cada rua encontrada, gera 1 candidato
- Distância alvo: baseada em `urbanDensityLimits`:
  - `very_dense`: 80m
  - `dense`: 100m
  - `medium`: 120m
  - `low`: 150m
  - `rural`: 180m

**PROBLEMA IDENTIFICADO:**
- Se encontrar 12 ruas, gera 12 candidatos
- Não há limite de ruas a processar
- Não há priorização de ruas principais

---

## 5. VALIDAÇÃO E SELEÇÃO FINAL (TriggerPointValidator)

### Passos de Validação

#### STEP 1: Validação Básica
- Distância do boundary (deve estar fora)
- Qualidade mínima (threshold configurável)
- Acessibilidade da rua

#### STEP 2: Validação de Visibilidade
- Line of sight do TP para o boundary
- `visibilityThreshold` do grupo (0.3-0.6)
- Percentual mínimo de boundary visível: 20%
- Obstruções: prédios, vegetação, barreiras

#### STEP 3: Filtro de Distância Mínima
- **Função**: `selectTriggerPointsWithMinDistance`
- Garante `minDistanceBetweenTPs` entre TPs selecionados
- Ordena por: front street primeiro, depois qualidade
- Seleciona greedy: pega melhor, remove próximos, repete

#### STEP 4: Limite Dinâmico
- Base: `candidates.length × basePercentage` (20% padrão)
- Ajustes por altura: 5-20% dependendo da altura
- Ajustes por área: 12-15% para áreas grandes
- Ajustes por elevação: 8% para landmarks altos
- Limites: min 10, max 200 (da configuração)

**RESULTADO FINAL:**
- 12 candidatos → 8 TPs finais (após filtro de distância mínima de 40m)

---

## 6. ANÁLISE DO CASO DO MUSEU

### Dados do POI
- **Nome**: Museu Municipal Oswaldo Russomano
- **Height**: 0m
- **Elevation**: 846.5m
- **Elevation diff**: -76.5m (POI abaixo da base regional)
- **Area**: 8360m²
- **Density**: `rural` (INCORRETO - deveria ser `dense`)

### Classificação Aplicada
1. ❌ HIGH: `elevationDiff = -76.5m` (não > 150m)
2. ❌ CANYON: `height = 0m` (não >= 10m) OU `!isDenseArea` (rural ≠ dense)
3. ❌ MEDIUM: `height = 0m` (não > 50m)
4. ✅ FLAT: Default (todos os outros)

### Configuração FLAT Aplicada
- `searchRadius`: 180m (fixo)
- `strategy`: `'standard'` → **One point per street**
- `minDistanceBetweenTPs`: 40m

### Raio de Busca Real
- STEP 1: `elevationDiff = -76.5m` (não > 150m) → não aplica
- STEP 2: `elevationDiff = -76.5m` (não <= 50m) → não aplica
- STEP 3: Base `rural` = 500m
- STEP 4-9: Ajustes aplicados
- **MAS**: STEP 2 do `calculateIntelligentRadius` verifica `elevationDiff <= 50` e retorna 100m fixo
- **CONFLITO**: Configuração FLAT diz 180m, mas `calculateIntelligentRadius` retorna 100m

**RESULTADO**: Sistema usou 100m (do `calculateIntelligentRadius`), não 180m (da configuração FLAT)

### Ruas Encontradas
- 12 ruas encontradas em raio de 100m
- Estratégia STANDARD: 1 TP por rua = 12 candidatos

### Validação Final
- 12 candidatos → 12 passaram validação básica
- 12 passaram validação de visibilidade
- Filtro de distância mínima (40m): 12 → 8 TPs finais

---

## 7. PROBLEMAS IDENTIFICADOS (Sem Viés)

### Problema 1: Densidade Urbana Incorreta
**Causa Real:**
- Google Places API retornou 0 estabelecimentos
- Sistema não tem fallback usando dados do OSM
- Classificou como `rural` quando deveria ser `dense` ou `very_dense`

**Impacto:**
- Afeta raio de busca base (500m ao invés de 200m)
- Afeta distância alvo dos TPs (180m ao invés de 100m)
- Afeta classificação CANYON (não detecta como canyon urbano)

### Problema 2: Conflito de Raio de Busca
**Causa Real:**
- `calculateIntelligentRadius` tem STEP 2 que retorna 100m fixo para POIs FLAT
- Configuração FLAT diz 180m fixo
- Sistema usa 100m (do `calculateIntelligentRadius`), não 180m

**Impacto:**
- Raio menor = menos ruas encontradas (mas ainda encontrou 12)
- Comportamento inconsistente entre configuração e implementação

### Problema 3: Estratégia STANDARD Sem Limite de Ruas
**Causa Real:**
- Estratégia STANDARD: "One point per street"
- Não há limite de quantas ruas processar
- Não há priorização de ruas principais

**Impacto:**
- 12 ruas = 12 candidatos = 8 TPs finais
- Para POI pequeno em rua apertada, deveria ter apenas 1 TP na rua principal

### Problema 4: Filtro de Distância Mínima Insuficiente
**Causa Real:**
- Filtro de 40m remove apenas 4 dos 12 candidatos
- Para POI pequeno (8360m²), 8 TPs ainda é muito

**Impacto:**
- Muitos TPs para POI pequeno
- Não considera tamanho do POI no limite final

---

## 8. REGRAS REAIS DO SISTEMA (Resumo)

### Regras de Classificação
1. HIGH: `elevationDiff > 150m` → raio 3-15km, estratégia circular
2. MEDIUM: `height > 50m && !dense` → raio 750-5000m, estratégia circular
3. CANYON: `(10m <= height <= 50m || height > 50m && dense) && dense && area <= 50000m²` → raio 75m, estratégia linear
4. FLAT: Todos os outros → raio 100m (do `calculateIntelligentRadius`) ou 180m (da config), estratégia standard

### Regras de Raio de Busca
1. Alta elevação (>150m diff): `√(diff) × 200` (3-15km)
2. FLAT (<=50m diff): 100m fixo (do `calculateIntelligentRadius`)
3. Base por densidade: 150-500m
4. Ajustes por elevação/altura: múltiplos cálculos
5. Limites: min 150m, max 8000m

### Regras de Geração
1. CIRCULAR: múltiplas ruas, múltiplas distâncias
2. LINEAR: front street prioritária, distâncias curtas
3. STANDARD: **1 ponto por rua encontrada** (sem limite)

### Regras de Validação
1. Visibilidade: line of sight, threshold 0.3-0.6
2. Distância mínima: 40-100m entre TPs (por grupo)
3. Limite dinâmico: 20% dos candidatos (ajustado por características)
4. Limites finais: min 10, max 200 TPs

---

## 9. CONCLUSÃO

O sistema tem regras bem definidas, mas há inconsistências e problemas:

1. **Densidade urbana** depende apenas de Google Places API (sem fallback)
2. **Raio de busca** tem conflito entre configuração FLAT (180m) e `calculateIntelligentRadius` (100m)
3. **Estratégia STANDARD** não limita número de ruas processadas
4. **Filtro de distância mínima** não considera tamanho do POI

**Para POIs pequenos em ruas apertadas:**
- Sistema gera muitos TPs porque:
  - Encontra muitas ruas (raio de 100m)
  - Estratégia STANDARD gera 1 TP por rua
  - Filtro de distância mínima (40m) não é suficiente para POIs pequenos

**Solução não deve ser específica para este POI, mas:**
- Adicionar fallback de densidade urbana usando OSM
- Resolver conflito de raio de busca
- Limitar número de ruas processadas na estratégia STANDARD
- Ajustar filtro de distância mínima baseado no tamanho do POI

