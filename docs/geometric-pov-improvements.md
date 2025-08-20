# Melhorias Geométricas para POV Generation

## 🔍 PROBLEMAS IDENTIFICADOS

### 1. Falta de Diversidade de Vantage Types
- **Atual:** Principalmente `street` e `square`
- **Necessário:** `building_top`, `overlook`, `trail`, `bridge`

### 2. Classificação Access Simplista
- **Atual:** Baseada apenas em distância
- **Necessário:** Considerar topografia e tipo de terreno

### 3. Sem Análise de Visibilidade Real
- **Atual:** Não considera obstáculos (prédios, morros)
- **Necessário:** Cálculo de linha de visão

## 🧮 MODELOS MATEMÁTICOS APLICÁVEIS

### 1. **Análise de Isovistas**
- **Conceito:** Área visível a partir de um ponto específico
- **Aplicação:** Determinar se um POV tem linha de visão clara para o POI
- **Implementação:** Raycasting 2D considerando obstáculos urbanos

### 2. **Fator de Visão do Céu (Sky View Factor)**
- **Conceito:** Proporção do céu visível de um ponto
- **Aplicação:** Identificar pontos elevados vs ruas estreitas
- **Implementação:** Cálculo baseado em densidade urbana estimada

### 3. **Modelo Digital de Elevação (DEM)**
- **Conceito:** Altura do terreno em coordenadas específicas
- **Aplicação:** Identificar pontos naturalmente elevados
- **APIs Disponíveis:** Open-Elevation, SRTM, ASTER GDEM

### 4. **Triangulação de Delaunay**
- **Conceito:** Malha de triângulos otimizada
- **Aplicação:** Distribuição espacial otimizada de POVs
- **Implementação:** Evitar clustering, maximizar cobertura

## 🛠️ IMPLEMENTAÇÃO PROPOSTA

### Fase 1: Integração de Dados de Elevação
```typescript
interface ElevationData {
  elevation: number      // Altura em metros
  source: 'SRTM' | 'ASTER' | 'estimated'
}

async function getElevation(lat: number, lng: number): Promise<ElevationData>
```

### Fase 2: Classificação Inteligente de Vantage
```typescript
function classifyVantage(
  distance: number, 
  elevation: number, 
  elevationDiff: number,
  environment: Environment
): VantageType {
  // Lógica baseada em:
  // - Diferença de elevação (elevado = overlook/building_top)
  // - Distância (próximo = street, longe = trail)
  // - Ambiente (urbano = building_top, natural = overlook)
}
```

### Fase 3: Análise de Visibilidade
```typescript
function calculateVisibility(
  povLat: number, povLng: number, povElevation: number,
  poiLat: number, poiLng: number, poiElevation: number,
  environment: Environment
): VisibilityQuality {
  // Considera:
  // - Diferença de elevação
  // - Distância
  // - Densidade urbana estimada
  // - Obstáculos prováveis
}
```

### Fase 4: Otimização Espacial
```typescript
function optimizePOVDistribution(candidates: POVCandidate[]): POVCandidate[] {
  // Aplicar Delaunay triangulation
  // Maximizar cobertura angular
  // Evitar clustering
  // Priorizar diversidade de vantage types
}
```

## 🌐 APIs DE ELEVAÇÃO GRATUITAS

### 1. Open-Elevation API
```
GET https://api.open-elevation.com/api/v1/lookup?locations=lat,lng
```
- **Limite:** Sem rate limit oficial
- **Precisão:** ~30m (SRTM)
- **Cobertura:** Global

### 2. USGS Elevation Point Query Service
```
GET https://nationalmap.gov/epqs/pqs.php?x=lng&y=lat&units=Meters&output=json
```
- **Limite:** Razoável para uso moderado
- **Precisão:** ~10m
- **Cobertura:** Principalmente EUA

### 3. Estimativa por Densidade Urbana
```typescript
// Para quando APIs não estão disponíveis
function estimateElevation(lat: number, lng: number, environment: Environment): number {
  // Heurísticas baseadas em:
  // - Proximidade ao centro da cidade (menor elevação)
  // - Tipo de ambiente (natural = maior variação)
  // - Coordenadas geográficas (padrões regionais)
}
```

## 🎯 REGRAS APRIMORADAS

### Classificação de Vantage por Elevação
```typescript
const VANTAGE_RULES = {
  // Diferença de elevação POV vs POI
  building_top: { minElevDiff: 20, environment: 'urban', maxDistance: 2000 },
  overlook: { minElevDiff: 50, environment: 'natural', maxDistance: 5000 },
  bridge: { minElevDiff: 10, environment: 'any', maxDistance: 1000 },
  trail: { minElevDiff: 5, environment: 'natural', maxDistance: 3000 },
  square: { maxElevDiff: 5, environment: 'urban', maxDistance: 500 },
  street: { maxElevDiff: 2, environment: 'urban', maxDistance: 300 }
}
```

### Classificação de Access por Topografia
```typescript
function classifyAccess(
  distance: number,
  elevationDiff: number, 
  vantage: VantageType
): AccessType {
  // building_top: sempre walk (elevador/escada)
  // overlook: walk se elevationDiff > 30m
  // street: both se elevationDiff < 5m
  // trail: walk se elevationDiff > 10m
}
```

### Cálculo de Visibilidade Aprimorado
```typescript
function calculateAdvancedVisibility(
  pov: POVCandidate,
  poi: POIInput,
  environment: Environment
): VisibilityQuality {
  const elevationDiff = pov.elevation - poi.elevation
  const distance = pov.distance_m
  
  // Fórmula baseada em:
  // 1. Altura relativa (maior = melhor)
  // 2. Distância (muito próximo ou muito longe = pior)
  // 3. Densidade urbana (urbano denso = pior para ground level)
  
  if (environment === 'dense_urban') {
    if (elevationDiff > 50) return 'excellent'
    if (elevationDiff > 20) return 'good'
    if (distance < 100) return 'limited' // Muito próximo, obstáculos
    return 'moderate'
  }
  
  // Lógica para outros ambientes...
}
```

## 📊 MÉTRICAS DE QUALIDADE

### Diversidade de Vantage Types
```typescript
function calculateVantageDiversity(povs: POVItem[]): number {
  const types = new Set(povs.map(p => p.vantage))
  return types.size / TOTAL_VANTAGE_TYPES // 0-1 score
}
```

### Cobertura Altimétrica
```typescript
function calculateElevationCoverage(povs: POVItem[]): number {
  const elevations = povs.map(p => p.elevation)
  const range = Math.max(...elevations) - Math.min(...elevations)
  return Math.min(range / 100, 1) // Normalizado 0-1
}
```

## 🚀 PRÓXIMOS PASSOS

1. **Implementar integração com Open-Elevation API**
2. **Adicionar classificação inteligente de vantage**
3. **Melhorar cálculo de visibilidade**
4. **Testar com Copan e Pico do Jaraguá**
5. **Comparar resultados com IA**

## 💡 BENEFÍCIOS ESPERADOS

- ✅ POVs `building_top` e `overlook` em locais apropriados
- ✅ Classificação `access` mais precisa
- ✅ Melhor `visibility_quality` baseada em topografia
- ✅ Distribuição espacial otimizada
- ✅ Adaptação automática ao ambiente (urbano/natural)
