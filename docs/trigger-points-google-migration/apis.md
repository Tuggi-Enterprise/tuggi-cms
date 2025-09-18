# APIs Utilizadas - Trigger Points System

## 🌐 APIs Externas

### 1. OpenStreetMap (OSM) - APIs Primárias

#### Nominatim API
**URL**: `https://nominatim.openstreetmap.org/search`
**Uso**: Busca de boundaries por nome
**Método**: GET
**Rate Limit**: 1 request/second

```typescript
const geonamesUrl = `https://nominatim.openstreetmap.org/search?q=${cityQuery}&lat=${lat}&lon=${lng}&bounded=1&viewbox=${viewbox}&format=json&polygon_geojson=1&addressdetails=1&limit=5`;
```

**Parâmetros**:
- `q`: Nome do POI
- `lat/lng`: Coordenadas do POI
- `bounded=1`: Limitar busca à área
- `polygon_geojson=1`: Retornar geometria
- `addressdetails=1`: Detalhes do endereço

#### Overpass API
**URL**: `https://overpass-api.de/api/interpreter`
**Uso**: Busca de ruas e buildings
**Método**: POST
**Rate Limit**: Sem limite específico

```typescript
const buildingsQuery = `
[out:json][timeout:30];
(
  way["building"](${minLat},${minLng},${maxLat},${maxLng});
  relation["building"](${minLat},${minLng},${maxLat},${maxLng});
);
out geom meta;
`;
```

**Query Types**:
- **Buildings**: `way["building"]` e `relation["building"]`
- **Roads**: `way["highway"]`
- **Geometria**: `out geom meta`

### 2. GeoNames API
**URL**: `http://api.geonames.org/searchJSON`
**Uso**: Coordenadas de cidades
**Método**: GET
**Rate Limit**: 1000 requests/hour

```typescript
const geonamesUrl = `http://api.geonames.org/searchJSON?q=${cityQuery}&country=${countryCode}&maxRows=1&username=${geonamesUsername}`;
```

**Parâmetros**:
- `q`: Nome da cidade
- `country`: Código do país (ISO)
- `maxRows=1`: Apenas o primeiro resultado
- `username`: Usuário GeoNames (obrigatório)

### 3. Open Elevation API
**URL**: `https://api.open-elevation.com/api/v1/lookup`
**Uso**: Dados de elevação
**Método**: GET
**Rate Limit**: Sem limite específico

```typescript
const elevationUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;
```

**Parâmetros**:
- `locations`: Coordenadas lat,lng

**Resposta**:
```json
{
  "results": [
    {
      "latitude": -23.4583,
      "longitude": -46.7656,
      "elevation": 1117.0
    }
  ]
}
```

### 4. Google APIs - Fallbacks

#### Google Places API
**URL**: `https://maps.googleapis.com/maps/api/place/findplacefromtext/json`
**Uso**: Fallback para boundaries
**Método**: GET
**Rate Limit**: 1000 requests/day (gratuito)

```typescript
const placesUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${poiName}&inputtype=textquery&fields=place_id,geometry&locationbias=point:${lat},${lng}&key=${googleApiKey}`;
```

#### Google Roads API
**URL**: `https://roads.googleapis.com/v1/nearestRoads`
**Uso**: Fallback para ruas
**Método**: GET
**Rate Limit**: 2500 requests/day (gratuito)

```typescript
const roadsUrl = `https://roads.googleapis.com/v1/nearestRoads?points=${lat},${lng}&key=${googleApiKey}`;
```

## 🔧 Configuração de APIs

### Variáveis de Ambiente
```bash
# GeoNames (obrigatório)
GEONAMES_USERNAME=your_username

# Google APIs (opcional - fallbacks)
GOOGLE_PLACES_API_KEY=your_key
GOOGLE_ROADS_API_KEY=your_key
GOOGLE_ELEVATION_API_KEY=your_key
```

### Rate Limiting
```typescript
// GeoNames: 1 request/second
await new Promise(resolve => setTimeout(resolve, 1000));

// OSM: Sem limite específico, mas respeitar servidor
// Google: Limites diários, usar apenas como fallback
```

## 📊 Estratégia de APIs

### Hierarquia de Prioridade

#### 1. Boundary Detection
1. **OSM Nominatim** (primário)
2. **Google Places** (fallback)
3. **Boundary estimado** (último recurso)

#### 2. Street Analysis
1. **OSM Overpass** (primário)
2. **Google Roads** (fallback)
3. **Smart Fallback** (último recurso)

#### 3. Elevation Data
1. **OSM tags** (primário)
2. **Open Elevation** (secundário)
3. **Google Elevation** (fallback)
4. **Fallback geográfico** (último recurso)

### Fallback Chain
```typescript
// Boundary Detection
try {
  boundary = await osmNominatimSearch(poiName);
} catch (error) {
  try {
    boundary = await googlePlacesSearch(poiName);
  } catch (error) {
    boundary = await estimateBoundary(poiLocation);
  }
}

// Elevation Detection
try {
  elevation = await extractOSMElevation(boundary);
} catch (error) {
  try {
    elevation = await openElevationAPI(boundary.center);
  } catch (error) {
    try {
      elevation = await googleElevationAPI(boundary.center);
    } catch (error) {
      elevation = await fallbackGeographicElevation(boundary.center);
    }
  }
}
```

## 🚀 Otimizações de API

### 1. Cache Inteligente
```typescript
// Cache de elevações por cidade
private static elevationCache = new Map<string, number>();

// Verificação antes da chamada
if (this.elevationCache.has(cacheKey)) {
  return this.elevationCache.get(cacheKey)!;
}
```

### 2. Batch Processing
```typescript
// 1 chamada OSM para todos os buildings
const buildingsQuery = `
[out:json][timeout:30];
(
  way["building"](${minLat},${minLng},${maxLat},${maxLng});
  relation["building"](${minLat},${minLng},${maxLat},${maxLng});
);
out geom meta;
`;
```

### 3. Error Handling
```typescript
try {
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }
  return await response.json();
} catch (error) {
  console.warn(`API call failed: ${error.message}`);
  return fallbackStrategy();
}
```

## 📈 Monitoramento de APIs

### Logs de API
```
🌐 Fetching city coordinates: Barcelona, Spain
📍 Nominatim found 1 results
🏙️ City elevation: 763m
🌐 Fetching ALL buildings in region with single OSM call...
🏢 Successfully fetched 1250 buildings from OSM in single call
```

### Métricas
- **API calls**: Contagem por tipo
- **Success rate**: % de sucesso por API
- **Response time**: Tempo de resposta
- **Fallback usage**: Frequência de fallbacks

### Health Checks
```typescript
// Verificar saúde das APIs
const healthChecks = {
  osmNominatim: await checkOSMHealth(),
  openElevation: await checkOpenElevationHealth(),
  geoNames: await checkGeoNamesHealth(),
  googleAPIs: await checkGoogleAPIsHealth()
};
```

## 🔒 Segurança e Limites

### Rate Limiting
- **GeoNames**: 1000 requests/hour
- **Google APIs**: Limites diários
- **OSM**: Respeitar servidor (sem limite específico)

### Error Handling
```typescript
// Retry com backoff exponencial
const retryWithBackoff = async (fn, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
};
```

### Timeouts
```typescript
// Timeout para chamadas de API
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000);

try {
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  return response;
} catch (error) {
  clearTimeout(timeoutId);
  throw error;
}
```

## 📚 Documentação das APIs

### OSM Nominatim
- **Documentação**: https://nominatim.org/release-docs/develop/api/Overview/
- **Exemplos**: https://nominatim.org/release-docs/develop/api/Search/

### OSM Overpass
- **Documentação**: https://wiki.openstreetmap.org/wiki/Overpass_API
- **Query Builder**: https://overpass-turbo.eu/

### GeoNames
- **Documentação**: http://www.geonames.org/export/web-services.html
- **Registro**: http://www.geonames.org/login

### Open Elevation
- **Documentação**: https://open-elevation.com/
- **Exemplos**: https://github.com/Jorl17/open-elevation

### Google APIs
- **Places API**: https://developers.google.com/maps/documentation/places/web-service
- **Roads API**: https://developers.google.com/maps/documentation/roads
- **Elevation API**: https://developers.google.com/maps/documentation/elevation

---

**Status das APIs**: ✅ Todas Funcionando
**Fallbacks**: ✅ Implementados
**Rate Limiting**: ✅ Respeitado
**Error Handling**: ✅ Robusto
