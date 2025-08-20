# APIs e Fontes de Dados Existentes para POVs

## 🌐 DESCOBERTAS IMPORTANTES

Após pesquisa extensiva, identifiquei várias fontes de dados existentes que podem **eliminar a necessidade de gerar POVs do zero**. Muitos pontos de observação já estão catalogados!

## 📊 FONTES DE DADOS PRONTAS

### 1. **OpenStreetMap (OSM) - PRINCIPAL DESCOBERTA**
- **Tags específicas para viewpoints:**
  - `tourism=viewpoint` - Mirantes e pontos de observação
  - `amenity=viewpoint` - Pontos de vista públicos
  - `man_made=observation_deck` - Decks de observação
  - `tourism=attraction` + `viewpoint=yes` - Atrações com vista
  - `natural=peak` - Picos naturais com vista

- **API Overpass (Gratuita):**
```javascript
// Exemplo de query para buscar viewpoints próximos
const overpassQuery = `
[out:json][timeout:25];
(
  node["tourism"="viewpoint"](around:5000,${lat},${lng});
  node["amenity"="viewpoint"](around:5000,${lat},${lng});
  node["man_made"="observation_deck"](around:5000,${lat},${lng});
);
out geom;
`;
```

### 2. **Google Places API**
- **Tipos relevantes:**
  - `tourist_attraction` - Atrações turísticas
  - `park` - Parques (muitos com mirantes)
  - `establishment` - Estabelecimentos diversos
  - `point_of_interest` - Pontos de interesse gerais

- **Campos úteis:**
  - `geometry.location` - Coordenadas
  - `types` - Categorias
  - `rating` - Avaliação (qualidade da vista)
  - `photos` - Fotos (para validar vista)

### 3. **GeoNames (Gratuita)**
- **8+ milhões de locais geográficos**
- **Campos úteis:**
  - Feature codes para viewpoints: `OBPT` (observation point)
  - Elevação incluída
  - Nomes em múltiplos idiomas

### 4. **Foursquare Places API**
- **Categorias específicas:**
  - `Scenic Lookout`
  - `Observation Deck`
  - `Bridge` (pontes com vista)
  - `Rooftop` (terraços)

## 🎯 ESTRATÉGIA HÍBRIDA PROPOSTA

### Fase 1: Buscar POVs Existentes (APIs)
```typescript
interface ExistingPOVSource {
  source: 'OSM' | 'Google' | 'GeoNames' | 'Foursquare'
  confidence: number
  data: {
    name: string
    lat: number
    lng: number
    type: string
    rating?: number
    elevation?: number
  }
}

async function findExistingPOVs(poi: POI, radius: number): Promise<ExistingPOVSource[]> {
  const sources = await Promise.all([
    searchOSMViewpoints(poi, radius),
    searchGooglePlaces(poi, radius),
    searchGeoNames(poi, radius),
    searchFoursquare(poi, radius)
  ])
  
  return sources.flat().sort((a, b) => b.confidence - a.confidence)
}
```

### Fase 2: Complementar com Geométrico
```typescript
async function generateCompletePOVs(poi: POI): Promise<POV[]> {
  // 1. Buscar POVs existentes
  const existingPOVs = await findExistingPOVs(poi, 5000)
  
  // 2. Identificar gaps de cobertura angular
  const coverageGaps = analyzeAngularCoverage(existingPOVs)
  
  // 3. Gerar POVs geométricos apenas para gaps
  const geometricPOVs = generateGeometricForGaps(poi, coverageGaps)
  
  // 4. Combinar e otimizar
  return optimizePOVSelection([...existingPOVs, ...geometricPOVs])
}
```

## 🔍 IMPLEMENTAÇÃO ESPECÍFICA

### OpenStreetMap Overpass API
```typescript
class OSMViewpointService {
  async searchViewpoints(lat: number, lng: number, radius: number): Promise<POV[]> {
    const query = `
      [out:json][timeout:25];
      (
        node["tourism"="viewpoint"](around:${radius},${lat},${lng});
        node["amenity"="viewpoint"](around:${radius},${lat},${lng});
        node["man_made"="observation_deck"](around:${radius},${lat},${lng});
        way["tourism"="viewpoint"](around:${radius},${lat},${lng});
      );
      out geom;
    `
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    })
    
    const data = await response.json()
    return this.parseOSMResults(data.elements)
  }
  
  private parseOSMResults(elements: any[]): POV[] {
    return elements.map(element => ({
      name: element.tags?.name || 'Viewpoint',
      lat: element.lat || element.center?.lat,
      lng: element.lon || element.center?.lon,
      access: this.inferAccess(element.tags),
      vantage: this.inferVantage(element.tags),
      visibility_quality: this.inferQuality(element.tags),
      source: 'OSM',
      confidence: 0.9
    }))
  }
}
```

### Google Places Integration
```typescript
class GooglePlacesViewpointService {
  async searchNearbyViewpoints(lat: number, lng: number, radius: number): Promise<POV[]> {
    const types = ['tourist_attraction', 'park', 'establishment']
    const results = []
    
    for (const type of types) {
      const response = await this.googlePlaces.nearbySearch({
        location: { lat, lng },
        radius,
        type,
        keyword: 'viewpoint OR overlook OR observation OR scenic OR vista'
      })
      
      results.push(...response.results)
    }
    
    return this.filterAndParseGoogleResults(results)
  }
  
  private filterAndParseGoogleResults(results: any[]): POV[] {
    return results
      .filter(place => this.hasViewpointKeywords(place))
      .map(place => ({
        name: place.name,
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        access: this.inferAccessFromGoogle(place),
        vantage: this.inferVantageFromGoogle(place),
        visibility_quality: this.ratingToVisibility(place.rating),
        source: 'Google',
        confidence: 0.8
      }))
  }
}
```

## 📈 VANTAGENS DA ABORDAGEM HÍBRIDA

### ✅ Dados Reais vs Teóricos
- **OSM/Google:** Pontos reais, testados por usuários
- **Geométrico:** Cobertura sistemática, sem gaps

### ✅ Qualidade vs Cobertura
- **APIs:** Alta qualidade, nomes reais, avaliações
- **Geométrico:** Cobertura completa, previsível

### ✅ Performance vs Precisão
- **Cache de APIs:** Rápido após primeira busca
- **Fallback geométrico:** Sempre funciona offline

### ✅ Custo vs Benefício
- **OSM/GeoNames:** Gratuitos
- **Google:** Pago, mas dados premium
- **Geométrico:** Zero custo operacional

## 🎯 CASOS DE USO ESPECÍFICOS

### Copan (Urbano Denso)
1. **OSM:** Buscar `tourism=viewpoint` num raio de 2km
2. **Google:** Buscar `tourist_attraction` + keywords "vista", "mirante"
3. **Geométrico:** Preencher gaps angulares < 45°

### Pico do Jaraguá (Natural)
1. **OSM:** `natural=peak`, `tourism=viewpoint` num raio de 10km
2. **GeoNames:** Feature code `OBPT` (observation points)
3. **Geométrico:** Trilhas e acessos não catalogados

## 🚀 IMPLEMENTAÇÃO IMEDIATA

Quer que eu implemente:

1. **OSM Overpass integration** (gratuita, dados reais)
2. **Teste com Copan** (verificar se há viewpoints catalogados)
3. **Sistema híbrido** (APIs + geométrico para gaps)
4. **Comparação tripla** (IA vs Geométrico vs Híbrido)

Esta abordagem pode **revolucionar** o sistema - usar dados reais existentes + complementar matematicamente!
