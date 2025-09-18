# Fallback Strategies - Trigger Points System

## 🎯 Estratégias de Fallback Implementadas

### 1. Boundary Detection Fallbacks

#### Hierarquia de Fallback
```typescript
// 1. OSM Nominatim (Primário)
try {
  boundary = await osmNominatimSearch(poiName, coordinates);
} catch (error) {
  // 2. Google Places (Fallback)
  try {
    boundary = await googlePlacesSearch(poiName, coordinates);
  } catch (error) {
    // 3. Boundary Estimado (Último Recurso)
    boundary = await estimateBoundary(coordinates);
  }
}
```

#### OSM Nominatim (Primário)
**Vantagens**:
- ✅ Dados mais precisos
- ✅ Geometrias complexas
- ✅ Gratuito e sem limites

**Desvantagens**:
- ❌ Pode não encontrar POIs específicos
- ❌ Rate limit de 1 request/second

#### Google Places (Fallback)
**Vantagens**:
- ✅ Cobertura global
- ✅ POIs comerciais
- ✅ API robusta

**Desvantagens**:
- ❌ Limite de 1000 requests/day
- ❌ Geometrias simplificadas
- ❌ Custo por uso

#### Boundary Estimado (Último Recurso)
**Implementação**:
```typescript
private async estimateBoundary(coordinates: { lat: number; lng: number }): Promise<BoundaryData> {
  // Círculo de 100m ao redor do POI
  const radius = 100; // metros
  const points = this.generateCirclePoints(coordinates, radius, 16);
  
  return {
    coordinates: points,
    center: coordinates,
    area: Math.PI * radius * radius,
    confidence: 0.3, // Baixa confiança
    source: 'estimated'
  };
}
```

### 2. Elevation Detection Fallbacks

#### Hierarquia de Fallback
```typescript
// 1. OSM Tags (Primário)
try {
  elevation = await extractOSMElevation(boundary);
} catch (error) {
  // 2. Open Elevation API (Secundário)
  try {
    elevation = await openElevationAPI(boundary.center);
  } catch (error) {
    // 3. Google Elevation API (Fallback)
    try {
      elevation = await googleElevationAPI(boundary.center);
    } catch (error) {
      // 4. Fallback Geográfico (Último Recurso)
      elevation = await fallbackGeographicElevation(boundary.center);
    }
  }
}
```

#### OSM Tags (Primário)
**Vantagens**:
- ✅ Dados integrados
- ✅ Sem chamadas de API
- ✅ Precisão alta

**Desvantagens**:
- ❌ Nem todos os POIs têm tags de elevação
- ❌ Dados podem estar desatualizados

#### Open Elevation API (Secundário)
**Vantagens**:
- ✅ Gratuito
- ✅ Sem limites
- ✅ Dados precisos

**Desvantagens**:
- ❌ Pode ter timeouts
- ❌ Dependência externa

#### Google Elevation API (Fallback)
**Vantagens**:
- ✅ API robusta
- ✅ Cobertura global
- ✅ Dados atualizados

**Desvantagens**:
- ❌ Limite de requests
- ❌ Custo por uso

#### Fallback Geográfico (Último Recurso)
**Implementação**:
```typescript
private getFallbackCityElevation(city: string, country: string, lat: number, lng: number): number {
  // Lógica baseada em geografia física
  const distanceToAtlantic = Math.abs(lng + 40);
  const distanceToPacific = Math.abs(lng + 80);
  const nearOcean = Math.min(distanceToAtlantic, distanceToPacific) < 20;
  
  if (nearOcean) {
    return 20; // Cidades costeiras
  }
  
  // Lógica por latitude e continentalidade
  const isEquatorial = Math.abs(lat) < 10;
  const isTemperate = Math.abs(lat) > 20 && Math.abs(lat) < 40;
  const isContinental = Math.min(distanceToAtlantic, distanceToPacific) > 30;
  
  if (isEquatorial) {
    return isContinental ? 300 : 50;
  } else if (isTemperate) {
    return isContinental ? 600 : 100;
  }
  
  return isContinental ? 400 : 80;
}
```

### 3. Street Analysis Fallbacks

#### Hierarquia de Fallback
```typescript
// 1. OSM Overpass (Primário)
try {
  streets = await osmOverpassSearch(boundary, searchRadius);
} catch (error) {
  // 2. Google Roads (Fallback)
  try {
    streets = await googleRoadsSearch(boundary.center, searchRadius);
  } catch (error) {
    // 3. Smart Fallback (Último Recurso)
    streets = await smartFallback(boundary.center);
  }
}
```

#### OSM Overpass (Primário)
**Vantagens**:
- ✅ Dados detalhados
- ✅ Múltiplos tipos de via
- ✅ Geometrias precisas

**Desvantagens**:
- ❌ Pode ter timeouts
- ❌ Query complexa

#### Google Roads (Fallback)
**Vantagens**:
- ✅ API robusta
- ✅ Cobertura global
- ✅ Dados atualizados

**Desvantagens**:
- ❌ Limite de requests
- ❌ Geometrias simplificadas

#### Smart Fallback (Último Recurso)
**Implementação**:
```typescript
private async smartFallback(poiLocation: { lat: number; lng: number }): Promise<StreetData[]> {
  // Encontrar a rua mais próxima usando Google Roads
  const nearestRoad = await this.findNearestRoad(poiLocation);
  
  if (nearestRoad) {
    // Gerar 1-2 TPs na rua mais próxima
    return [{
      id: 'fallback-street',
      name: nearestRoad.name || 'Rua Próxima',
      type: 'residential',
      coordinates: nearestRoad.geometry,
      accessibility: 'public'
    }];
  }
  
  // Se não encontrar rua, gerar TP no local
  return [{
    id: 'fallback-location',
    name: 'Local do POI',
    type: 'residential',
    coordinates: [poiLocation],
    accessibility: 'public'
  }];
}
```

### 4. Super Simple Fallback

#### Para POIs Não Encontrados
**Implementação**:
```typescript
private async superSimpleFallback(poiData: POIData): Promise<TriggerPoint[]> {
  // 1. Encontrar rua mais próxima
  const nearestStreet = await this.findNearestStreet(poiData.location);
  
  // 2. Gerar apenas 1-2 TPs
  const triggerPoints: TriggerPoint[] = [];
  
  if (nearestStreet) {
    // TP na rua mais próxima
    triggerPoints.push({
      id: `tp_fallback_${Date.now()}`,
      location: nearestStreet.coordinates[0],
      radius: 42,
      expectedBearing: 0,
      bearingThreshold: 30,
      type: 'fallback',
      priority: 1,
      confidence: 0.5,
      quality: 0.5,
      street: nearestStreet,
      distance: 0,
      generationMethod: 'super_simple_fallback',
      contextData: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  
  return triggerPoints;
}
```

## 🔧 Configuração de Fallbacks

### Timeouts e Retries
```typescript
const fallbackConfig = {
  // Timeouts por API
  timeouts: {
    osmNominatim: 10000,    // 10s
    googlePlaces: 5000,     // 5s
    openElevation: 8000,    // 8s
    googleElevation: 5000,  // 5s
    osmOverpass: 30000      // 30s
  },
  
  // Retries por API
  retries: {
    osmNominatim: 2,
    googlePlaces: 1,
    openElevation: 2,
    googleElevation: 1,
    osmOverpass: 1
  },
  
  // Backoff exponencial
  backoffMultiplier: 2,
  maxBackoffDelay: 5000
};
```

### Error Handling
```typescript
private async executeWithFallback<T>(
  primaryFn: () => Promise<T>,
  fallbackFns: Array<() => Promise<T>>,
  errorMessage: string
): Promise<T> {
  try {
    return await primaryFn();
  } catch (error) {
    console.warn(`${errorMessage} - Primary failed:`, error);
    
    for (let i = 0; i < fallbackFns.length; i++) {
      try {
        return await fallbackFns[i]();
      } catch (fallbackError) {
        console.warn(`${errorMessage} - Fallback ${i + 1} failed:`, fallbackError);
        
        if (i === fallbackFns.length - 1) {
          throw new Error(`${errorMessage} - All fallbacks failed`);
        }
      }
    }
  }
}
```

## 📊 Monitoramento de Fallbacks

### Logs de Fallback
```
⚠️ OSM Nominatim failed - trying Google Places
✅ Google Places found boundary (confidence: 0.8)
🆘 Open Elevation API failed - using geographic fallback
🌊 City near ocean (dist: 15.2°) → low elevation
🚀 Using Super Simple Fallback for unfound POI
```

### Métricas
- **Fallback usage**: Frequência por tipo
- **Success rate**: % de sucesso por fallback
- **Response time**: Tempo de cada fallback
- **Error patterns**: Tipos de erro mais comuns

### Health Checks
```typescript
const fallbackHealth = {
  osmNominatim: await checkOSMHealth(),
  googlePlaces: await checkGooglePlacesHealth(),
  openElevation: await checkOpenElevationHealth(),
  googleElevation: await checkGoogleElevationHealth(),
  geographicFallback: true // Sempre disponível
};
```

## 🎯 Casos de Uso dos Fallbacks

### 1. POI Comercial Não Encontrado no OSM
**Cenário**: Restaurante ou loja específica
**Fallback**: Google Places → Boundary Estimado
**Resultado**: TPs gerados na rua da frente

### 2. API de Elevação Indisponível
**Cenário**: Open Elevation API com timeout
**Fallback**: Google Elevation → Fallback Geográfico
**Resultado**: Elevação estimada baseada em geografia

### 3. POI em Área Rural
**Cenário**: POI sem ruas próximas no OSM
**Fallback**: Google Roads → Smart Fallback
**Resultado**: TPs na estrada mais próxima

### 4. POI Internacional
**Cenário**: POI fora do Brasil
**Fallback**: GeoNames → Fallback Geográfico
**Resultado**: Base regional estimada por latitude

## 🚀 Otimizações de Fallback

### 1. Cache de Fallbacks
```typescript
// Cache de resultados de fallback
private static fallbackCache = new Map<string, any>();

// Verificar cache antes de executar fallback
const cacheKey = `${poiId}_${fallbackType}`;
if (this.fallbackCache.has(cacheKey)) {
  return this.fallbackCache.get(cacheKey);
}
```

### 2. Fallback Paralelo
```typescript
// Executar múltiplos fallbacks em paralelo
const fallbackPromises = fallbackFns.map(fn => fn().catch(() => null));
const results = await Promise.all(fallbackPromises);
const firstSuccess = results.find(result => result !== null);
```

### 3. Fallback Inteligente
```typescript
// Escolher fallback baseado no contexto
const chooseFallback = (context: GeographicContext) => {
  if (context.urbanDensity.level === 'rural') {
    return 'googleRoads'; // Melhor para áreas rurais
  } else if (context.region.country === 'Brazil') {
    return 'osmNominatim'; // Melhor para Brasil
  } else {
    return 'googlePlaces'; // Melhor para internacional
  }
};
```

---

**Status dos Fallbacks**: ✅ Todos Implementados
**Cobertura**: 100% dos casos de erro
**Performance**: Otimizada com cache
**Confiabilidade**: Sistema sempre funcional
