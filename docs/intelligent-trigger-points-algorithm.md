# 🧠 Sistema Inteligente de Trigger Points

## 📊 Análise de Contexto Multi-Dimensional

### 1. 🏙️ CONTEXTO URBANO
```typescript
enum UrbanDensity {
  MUITO_DENSO = 'muito_denso',     // Barcelona, Paris, NYC
  DENSO = 'denso',                 // Cidades grandes
  MEDIO = 'medio',                 // Cidades médias  
  BAIXO = 'baixo',                 // Subúrbios
  RURAL = 'rural'                  // Campo aberto
}

const URBAN_LIMITS = {
  muito_denso: { min: 50, max: 200, ideal: 100 },
  denso: { min: 100, max: 400, ideal: 200 },
  medio: { min: 200, max: 800, ideal: 400 },
  baixo: { min: 400, max: 1500, ideal: 800 },
  rural: { min: 800, max: 3000, ideal: 1500 }
}
```

### 2. 🏔️ ELEVAÇÃO DO TERRENO
```typescript
enum TerrainElevation {
  MONTANHA = 'montanha',           // >500m
  COLINA_ALTA = 'colina_alta',     // 200-500m
  COLINA = 'colina',               // 50-200m
  PLANICIE = 'planicie'            // <50m
}

const ELEVATION_MULTIPLIERS = {
  montanha: 3.0,      // 3x distância
  colina_alta: 2.0,   // 2x distância
  colina: 1.5,        // 1.5x distância
  planicie: 1.0       // Distância normal
}
```

### 3. 🏗️ ALTURA DA ESTRUTURA
```typescript
enum StructureHeight {
  ARRANHA_CEU = 'arranha_ceu',     // >150m
  MUITO_ALTO = 'muito_alto',       // 50-150m
  ALTO = 'alto',                   // 20-50m
  MEDIO = 'medio',                 // 5-20m
  BAIXO = 'baixo'                  // <5m
}

const HEIGHT_MULTIPLIERS = {
  arranha_ceu: 2.5,   // 2.5x distância
  muito_alto: 2.0,    // 2x distância
  alto: 1.5,          // 1.5x distância
  medio: 1.2,         // 1.2x distância
  baixo: 1.0          // Distância normal
}
```

### 4. 🏘️ DENSIDADE DE OBSTÁCULOS
```typescript
enum ObstacleDensity {
  MUITO_DENSA = 'muito_densa',     // Centro histórico
  DENSA = 'densa',                 // Área comercial
  MEDIA = 'media',                 // Residencial
  BAIXA = 'baixa',                 // Subúrbios
  ABERTA = 'aberta'                // Parques, campo
}

const OBSTACLE_MODIFIERS = {
  muito_densa: 0.5,   // Reduz 50% distância
  densa: 0.7,         // Reduz 30% distância
  media: 0.9,         // Reduz 10% distância
  baixa: 1.0,         // Distância normal
  aberta: 1.3         // Aumenta 30% distância
}
```

## 🎯 ALGORITMO DE CÁLCULO

### Fórmula Principal:
```typescript
function calculateOptimalTPDistance(poi: POI): TPDistanceConfig {
  // 1. Base urbana
  const urbanLimits = URBAN_LIMITS[poi.urbanDensity]
  
  // 2. Multiplicadores
  const elevationMult = ELEVATION_MULTIPLIERS[poi.terrainElevation]
  const heightMult = HEIGHT_MULTIPLIERS[poi.structureHeight]
  const obstacleMod = OBSTACLE_MODIFIERS[poi.obstacleDensity]
  
  // 3. Cálculo final
  const baseDistance = urbanLimits.ideal
  const adjustedDistance = baseDistance * elevationMult * heightMult * obstacleMod
  
  // 4. Limites finais
  const minDistance = Math.max(urbanLimits.min, 30) // Mínimo absoluto 30m
  const maxDistance = Math.min(adjustedDistance, urbanLimits.max * elevationMult)
  
  return {
    primary_min: minDistance,
    primary_max: Math.min(maxDistance * 0.6, 300), // Primary sempre próximo
    secondary_min: maxDistance * 0.4,
    secondary_max: maxDistance,
    search_radius: maxDistance * 1.5 // Raio de busca
  }
}
```

## 🎯 REGRAS ESPECÍFICAS

### Para Barcelona (Basílica):
```typescript
const basilicaConfig = {
  urbanDensity: 'muito_denso',      // Barcelona centro
  terrainElevation: 'planicie',     // Nível do mar
  structureHeight: 'alto',          // Igreja ~40m
  obstacleDensity: 'muito_densa'    // Centro histórico
}

// Resultado:
// Base: 100m (muito denso)
// Elevação: 1.0x (planície)
// Altura: 1.5x (alto)
// Obstáculos: 0.5x (muito denso)
// = 100 * 1.0 * 1.5 * 0.5 = 75m máximo!
```

### Casos Especiais:
```typescript
// Cristo Redentor (Rio)
const cristoConfig = {
  urbanDensity: 'denso',           // Rio
  terrainElevation: 'montanha',    // 700m altitude
  structureHeight: 'muito_alto',   // 98m
  obstacleDensity: 'baixa'         // Floresta Tijuca
}
// = 200 * 3.0 * 2.0 * 1.0 = 1200m máximo

// Torre Eiffel (Paris)
const torreConfig = {
  urbanDensity: 'muito_denso',     // Paris centro
  terrainElevation: 'planicie',    // Planície
  structureHeight: 'arranha_ceu',  // 330m
  obstacleDensity: 'densa'         // Área turística
}
// = 100 * 1.0 * 2.5 * 0.7 = 175m máximo
```

## 📍 DISTRIBUIÇÃO INTELIGENTE

### Priorização:
1. **TPs Primários (60% da distância)**:
   - Nas ruas mais próximas
   - Com visibilidade direta
   - Máximo 4-6 pontos

2. **TPs Secundários (60-100% da distância)**:
   - Cobertura adicional
   - Acessos alternativos
   - Máximo 6-8 pontos

3. **Densidade Adaptativa**:
   - Cidade densa: Mais TPs próximos, menos distantes
   - Área aberta: Menos TPs próximos, alguns distantes
   - Estrutura alta: TPs em múltiplas direções

## 🔍 DETECÇÃO AUTOMÁTICA

### APIs para Contexto:
- **Elevação**: OpenStreetMap elevation API
- **Densidade urbana**: Overpass building density query  
- **Altura estrutura**: OSM height tags, Wikipedia data
- **Tipo de área**: OSM landuse tags

### Fallbacks:
- Análise de densidade de ruas próximas
- Contagem de edifícios em raio de 500m
- Classificação por coordenadas (centro cidade vs periferia)
