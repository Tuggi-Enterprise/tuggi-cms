# Guia de Implementação - Trigger Points Google Migration

## 🚀 Visão Geral da Implementação

Este guia fornece instruções passo a passo para implementar o sistema de trigger points migrado para Google APIs.

## 📋 Pré-requisitos

### 1. Configuração do Ambiente
```bash
# Node.js 18+
node --version  # v18.0.0+

# NPM ou Yarn
npm --version   # 8.0.0+

# Google Cloud Platform account
# Supabase project configurado
```

### 2. APIs Necessárias
- Google Places API
- Google Roads API  
- Google Street View API
- Google Elevation API
- OpenStreetMap Overpass API (fallback)

### 3. Dependências
```json
{
  "@googlemaps/google-maps-services-js": "^3.3.0",
  "@supabase/supabase-js": "^2.38.0",
  "axios": "^1.6.0",
  "node-cache": "^5.1.2"
}
```

## 🏗️ Estrutura do Projeto

```
lib/services/trigger-points-google/
├── core/
│   ├── trigger-point-predictor.ts
│   ├── geographic-analyzer.ts
│   └── boundary-detector.ts
├── analyzers/
│   ├── street-analyzer.ts
│   ├── point-calculator.ts
│   └── validator.ts
├── services/
│   ├── google-apis.service.ts
│   ├── osm-fallback.service.ts
│   └── cache.service.ts
├── types/
│   ├── interfaces.ts
│   └── enums.ts
└── utils/
    ├── calculations.ts
    ├── geometry.ts
    └── helpers.ts
```

## 🔧 Configuração Inicial

### 1. Variáveis de Ambiente
```bash
# .env
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Configurações do sistema
TRIGGER_POINTS_MAX_SEARCH_RADIUS=2000
TRIGGER_POINTS_MIN_QUALITY=0.3
TRIGGER_POINTS_CACHE_TTL=86400
```

### 2. Configuração do Google Maps
```typescript
// lib/services/trigger-points-google/services/google-apis.service.ts
import { Client } from '@googlemaps/google-maps-services-js';

export class GoogleAPIsService {
  private client: Client;
  
  constructor() {
    this.client = new Client({});
  }
  
  get apiKey(): string {
    return process.env.GOOGLE_MAPS_API_KEY!;
  }
}
```

### 3. Configuração do Supabase
```typescript
// lib/services/trigger-points-google/services/supabase.service.ts
import { createClient } from '@supabase/supabase-js';

export class SupabaseService {
  private client;
  
  constructor() {
    this.client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
}
```

## 📝 Implementação Passo a Passo

### Passo 1: Definir Interfaces e Tipos

```typescript
// lib/services/trigger-points-google/types/interfaces.ts
export interface POIData {
  id: string;
  name: string;
  location: {
    lat: number;
    lng: number;
  };
  type: string;
  country: string;
  city: string;
  state?: string;
}

export interface GeographicContext {
  urbanDensity: {
    level: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural';
    score: number;
  };
  elevationContext: {
    type: 'mountainous' | 'hilly' | 'flat';
    variance: number;
  };
  streetPattern: {
    type: 'grid' | 'organic' | 'boulevard' | 'mixed';
    confidence: number;
  };
  infrastructure: {
    transitTypes: string[];
    parkingAvailability: number;
    infrastructureDensity: number;
  };
  region: 'auto_detected';
}

export interface BoundaryData {
  coordinates: Array<{lat: number, lng: number}>;
  center: {lat: number, lng: number};
  area: number;
  confidence: number;
  source: 'google_places' | 'osm' | 'estimated';
}

export interface TriggerPoint {
  id: string;
  location: {lat: number, lng: number};
  radius: number;
  expectedBearing: number;
  bearingThreshold: number;
  type: 'primary' | 'secondary' | 'fallback';
  priority: number;
  confidence: number;
  quality: number;
  street: StreetData;
  distance: number;
}
```

### Passo 2: Implementar Geographic Context Analyzer

```typescript
// lib/services/trigger-points-google/core/geographic-analyzer.ts
import { GoogleAPIsService } from '../services/google-apis.service';
import { GeographicContext, POIData } from '../types/interfaces';

export class GeographicContextAnalyzer {
  private googleAPIs: GoogleAPIsService;
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
  }
  
  async analyzeGeographicContext(poiData: POIData): Promise<GeographicContext> {
    console.log(`🌍 Analyzing geographic context for: ${poiData.name}`);
    
    // Análise paralela de diferentes aspectos
    const [urbanDensity, elevationContext, streetPattern, infrastructure] = await Promise.all([
      this.calculateUrbanDensity(poiData.location),
      this.analyzeElevation(poiData.location),
      this.analyzeStreetPattern(poiData.location),
      this.analyzeInfrastructure(poiData.location)
    ]);
    
    return {
      urbanDensity,
      elevationContext,
      streetPattern,
      infrastructure,
      region: 'auto_detected'
    };
  }
  
  private async calculateUrbanDensity(location: {lat: number, lng: number}) {
    try {
      // Buscar estabelecimentos em raio de 1km
      const placesResponse = await this.googleAPIs.client.placesNearby({
        params: {
          location,
          radius: 1000,
          type: 'establishment',
          key: this.googleAPIs.apiKey
        }
      });
      
      const buildingCount = placesResponse.data.results.length;
      const buildingDensity = buildingCount / (Math.PI * 1); // por km²
      
      // Classificar densidade
      if (buildingDensity > 1000) {
        return { level: 'very_dense' as const, score: 0.9 };
      } else if (buildingDensity > 500) {
        return { level: 'dense' as const, score: 0.7 };
      } else if (buildingDensity > 200) {
        return { level: 'medium' as const, score: 0.5 };
      } else if (buildingDensity > 50) {
        return { level: 'low' as const, score: 0.3 };
      } else {
        return { level: 'rural' as const, score: 0.1 };
      }
    } catch (error) {
      console.warn('Error calculating urban density:', error);
      return { level: 'medium' as const, score: 0.5 };
    }
  }
  
  private async analyzeElevation(location: {lat: number, lng: number}) {
    try {
      // Buscar elevação em múltiplos pontos
      const elevationPoints = this.generateElevationSamplePoints(location, 5000, 20);
      
      const elevationResponse = await this.googleAPIs.client.elevation({
        params: {
          locations: elevationPoints,
          key: this.googleAPIs.apiKey
        }
      });
      
      const elevations = elevationResponse.data.results.map(r => r.elevation);
      const variance = this.calculateVariance(elevations);
      
      if (variance > 200) {
        return { type: 'mountainous' as const, variance };
      } else if (variance > 50) {
        return { type: 'hilly' as const, variance };
      } else {
        return { type: 'flat' as const, variance };
      }
    } catch (error) {
      console.warn('Error analyzing elevation:', error);
      return { type: 'flat' as const, variance: 0 };
    }
  }
  
  private generateElevationSamplePoints(center: {lat: number, lng: number}, radius: number, count: number) {
    const points = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI;
      const distance = Math.random() * radius;
      const lat = center.lat + (distance / 111000) * Math.cos(angle);
      const lng = center.lng + (distance / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
      points.push({ lat, lng });
    }
    return points;
  }
  
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
}
```

### Passo 3: Implementar Boundary Detector

```typescript
// lib/services/trigger-points-google/core/boundary-detector.ts
import { GoogleAPIsService } from '../services/google-apis.service';
import { OSMFallbackService } from '../services/osm-fallback.service';
import { BoundaryData, POIData, GeographicContext } from '../types/interfaces';

export class BoundaryDetector {
  private googleAPIs: GoogleAPIsService;
  private osmFallback: OSMFallbackService;
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
    this.osmFallback = new OSMFallbackService();
  }
  
  async detectBoundary(poiData: POIData, context: GeographicContext): Promise<BoundaryData> {
    console.log(`🔍 Detecting boundary for: ${poiData.name}`);
    
    // Estratégia 1: Google Places API
    try {
      const googleBoundary = await this.detectGoogleBoundary(poiData);
      if (googleBoundary && googleBoundary.confidence > 0.7) {
        console.log('✅ Found boundary via Google Places API');
        return { ...googleBoundary, source: 'google_places' };
      }
    } catch (error) {
      console.warn('Google Places boundary detection failed:', error);
    }
    
    // Estratégia 2: OSM Fallback
    try {
      const osmBoundary = await this.detectOSMBoundary(poiData);
      if (osmBoundary && osmBoundary.confidence > 0.5) {
        console.log('✅ Found boundary via OSM');
        return { ...osmBoundary, source: 'osm' };
      }
    } catch (error) {
      console.warn('OSM boundary detection failed:', error);
    }
    
    // Estratégia 3: Estimated Boundary
    console.log('⚠️ Using estimated boundary');
    const estimatedBoundary = await this.createEstimatedBoundary(poiData, context);
    return { ...estimatedBoundary, source: 'estimated' };
  }
  
  private async detectGoogleBoundary(poiData: POIData): Promise<BoundaryData | null> {
    try {
      // Buscar POI no Google Places
      const searchResponse = await this.googleAPIs.client.placesNearby({
        params: {
          location: poiData.location,
          radius: 100,
          name: poiData.name,
          key: this.googleAPIs.apiKey
        }
      });
      
      if (searchResponse.data.results.length === 0) {
        return null;
      }
      
      const place = searchResponse.data.results[0];
      
      // Buscar detalhes com geometry
      const detailsResponse = await this.googleAPIs.client.placeDetails({
        params: {
          place_id: place.place_id,
          fields: ['geometry', 'name', 'types'],
          key: this.googleAPIs.apiKey
        }
      });
      
      const geometry = detailsResponse.data.result.geometry;
      if (!geometry?.viewport) {
        return null;
      }
      
      // Converter viewport para polygon
      const coordinates = this.convertViewportToPolygon(geometry.viewport);
      const center = geometry.location;
      const area = this.calculatePolygonArea(coordinates);
      
      return {
        coordinates,
        center,
        area,
        confidence: 0.9
      };
    } catch (error) {
      console.error('Error in Google boundary detection:', error);
      return null;
    }
  }
  
  private convertViewportToPolygon(viewport: any): Array<{lat: number, lng: number}> {
    const { northeast, southwest } = viewport;
    return [
      { lat: northeast.lat, lng: southwest.lng },
      { lat: northeast.lat, lng: northeast.lng },
      { lat: southwest.lat, lng: northeast.lng },
      { lat: southwest.lat, lng: southwest.lng },
      { lat: northeast.lat, lng: southwest.lng }
    ];
  }
  
  private calculatePolygonArea(coordinates: Array<{lat: number, lng: number}>): number {
    // Implementar cálculo de área usando fórmula de Shoelace
    let area = 0;
    const n = coordinates.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += coordinates[i].lng * coordinates[j].lat;
      area -= coordinates[j].lng * coordinates[i].lat;
    }
    
    return Math.abs(area) / 2;
  }
}
```

### Passo 4: Implementar Street Analyzer

```typescript
// lib/services/trigger-points-google/analyzers/street-analyzer.ts
import { GoogleAPIsService } from '../services/google-apis.service';
import { StreetData, POIData, BoundaryData, GeographicContext } from '../types/interfaces';

export class StreetAnalyzer {
  private googleAPIs: GoogleAPIsService;
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
  }
  
  async findAccessibleStreets(
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<StreetData[]> {
    console.log(`🛣️ Finding accessible streets for: ${poiData.name}`);
    
    const searchRadius = this.calculateSearchRadius(context);
    const roads = await this.getRoadsInRadius(poiData.location, searchRadius);
    
    // Filtrar ruas acessíveis
    const accessibleStreets = roads.filter(road => 
      this.isStreetAccessible(road, context)
    );
    
    // Calcular pontos mais próximos ao boundary
    const streetPoints = accessibleStreets.map(street => 
      this.findClosestPointToBoundary(street, boundary)
    );
    
    console.log(`✅ Found ${streetPoints.length} accessible street points`);
    return streetPoints;
  }
  
  private calculateSearchRadius(context: GeographicContext): number {
    const baseRadius = 500; // metros
    
    switch (context.urbanDensity.level) {
      case 'very_dense':
        return baseRadius * 0.8;
      case 'dense':
        return baseRadius * 0.9;
      case 'medium':
        return baseRadius;
      case 'low':
        return baseRadius * 1.2;
      case 'rural':
        return baseRadius * 2;
      default:
        return baseRadius;
    }
  }
  
  private async getRoadsInRadius(location: {lat: number, lng: number}, radius: number) {
    try {
      // Usar Google Roads API para encontrar ruas
      const response = await this.googleAPIs.client.roads({
        params: {
          path: this.generateSearchPath(location, radius),
          key: this.googleAPIs.apiKey
        }
      });
      
      return response.data.snappedPoints.map(point => ({
        id: point.originalIndex?.toString() || Math.random().toString(),
        type: 'road',
        coordinates: [{ lat: point.location.lat, lng: point.location.lng }],
        accessibility: 'public',
        confidence: 0.8
      }));
    } catch (error) {
      console.warn('Error getting roads:', error);
      return [];
    }
  }
  
  private generateSearchPath(center: {lat: number, lng: number}, radius: number) {
    // Gerar pontos em círculo para buscar ruas
    const points = [];
    const steps = 16;
    
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const lat = center.lat + (radius / 111000) * Math.cos(angle);
      const lng = center.lng + (radius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
      points.push({ lat, lng });
    }
    
    return points;
  }
  
  private isStreetAccessible(road: any, context: GeographicContext): boolean {
    // Verificar se a rua é acessível
    const accessibleRoadTypes = ['primary', 'secondary', 'tertiary', 'residential', 'living_street'];
    
    if (!accessibleRoadTypes.includes(road.type)) {
      return false;
    }
    
    // Verificar restrições de acesso
    if (road.accessibility === 'private' || road.accessibility === 'no') {
      return false;
    }
    
    return true;
  }
  
  private findClosestPointToBoundary(street: StreetData, boundary: BoundaryData): StreetData {
    // Encontrar ponto na rua mais próximo ao boundary
    let closestPoint = street.coordinates[0];
    let minDistance = this.calculateDistance(street.coordinates[0], boundary.center);
    
    for (const point of street.coordinates) {
      const distance = this.calculateDistance(point, boundary.center);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    }
    
    return {
      ...street,
      coordinates: [closestPoint],
      distance: minDistance
    };
  }
  
  private calculateDistance(point1: {lat: number, lng: number}, point2: {lat: number, lng: number}): number {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLng = (point2.lng - point1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}
```

### Passo 5: Implementar Core Trigger Point Predictor

```typescript
// lib/services/trigger-points-google/core/trigger-point-predictor.ts
import { GeographicContextAnalyzer } from './geographic-analyzer';
import { BoundaryDetector } from './boundary-detector';
import { StreetAnalyzer } from '../analyzers/street-analyzer';
import { OptimalPointCalculator } from '../analyzers/point-calculator';
import { TriggerPointValidator } from '../analyzers/validator';
import { POIData, TriggerPoint } from '../types/interfaces';

export class CoreTriggerPointPredictor {
  private geographicAnalyzer: GeographicContextAnalyzer;
  private boundaryDetector: BoundaryDetector;
  private streetAnalyzer: StreetAnalyzer;
  private pointCalculator: OptimalPointCalculator;
  private validator: TriggerPointValidator;
  
  constructor() {
    this.geographicAnalyzer = new GeographicContextAnalyzer();
    this.boundaryDetector = new BoundaryDetector();
    this.streetAnalyzer = new StreetAnalyzer();
    this.pointCalculator = new OptimalPointCalculator();
    this.validator = new TriggerPointValidator();
  }
  
  async predictTriggerPoints(poiData: POIData): Promise<TriggerPoint[]> {
    console.log(`🚀 Starting trigger point prediction for: ${poiData.name}`);
    const startTime = Date.now();
    
    try {
      // 1. Análise automática do contexto geográfico
      console.log('📊 Step 1: Analyzing geographic context...');
      const context = await this.geographicAnalyzer.analyzeGeographicContext(poiData);
      
      // 2. Detecção de boundary
      console.log('🔍 Step 2: Detecting boundary...');
      const boundary = await this.boundaryDetector.detectBoundary(poiData, context);
      
      // 3. Análise de ruas acessíveis
      console.log('🛣️ Step 3: Finding accessible streets...');
      const accessibleStreets = await this.streetAnalyzer.findAccessibleStreets(poiData, boundary, context);
      
      // 4. Cálculo de pontos ótimos
      console.log('🎯 Step 4: Calculating optimal points...');
      const optimalPoints = await this.pointCalculator.calculateOptimalPoints(poiData, accessibleStreets, boundary, context);
      
      // 5. Validação e ranking
      console.log('✅ Step 5: Validating and ranking points...');
      const validatedPoints = await this.validator.validateAndRankPoints(optimalPoints, poiData, context);
      
      const processingTime = Date.now() - startTime;
      console.log(`🎉 Generated ${validatedPoints.length} trigger points in ${processingTime}ms`);
      
      return validatedPoints;
      
    } catch (error) {
      console.error('Error in trigger point prediction:', error);
      throw new Error(`Failed to generate trigger points: ${error.message}`);
    }
  }
}
```

### Passo 6: Integrar com API Route

```typescript
// app/api/trigger-points/generate-google/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';

export async function POST(request: NextRequest) {
  try {
    const { poiData } = await request.json();
    
    if (!poiData || !poiData.id || !poiData.name || !poiData.location) {
      return NextResponse.json(
        { error: 'Invalid POI data provided' },
        { status: 400 }
      );
    }
    
    const predictor = new CoreTriggerPointPredictor();
    const triggerPoints = await predictor.predictTriggerPoints(poiData);
    
    return NextResponse.json({
      success: true,
      data: {
        poiId: poiData.id,
        triggerPoints,
        count: triggerPoints.length,
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
```

## 🧪 Testes

### Teste Unitário
```typescript
// __tests__/trigger-points-google.test.ts
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';

describe('CoreTriggerPointPredictor', () => {
  const predictor = new CoreTriggerPointPredictor();
  
  const mockPOI = {
    id: 'test-poi-1',
    name: 'Test POI',
    location: { lat: -23.5505, lng: -46.6333 },
    type: 'tourist_attraction',
    country: 'Brazil',
    city: 'São Paulo'
  };
  
  test('should generate trigger points for valid POI', async () => {
    const result = await predictor.predictTriggerPoints(mockPOI);
    
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    
    // Verificar estrutura dos trigger points
    result.forEach(tp => {
      expect(tp.id).toBeDefined();
      expect(tp.location).toBeDefined();
      expect(tp.location.lat).toBeDefined();
      expect(tp.location.lng).toBeDefined();
      expect(tp.radius).toBeGreaterThan(0);
      expect(tp.confidence).toBeGreaterThanOrEqual(0);
      expect(tp.confidence).toBeLessThanOrEqual(1);
    });
  });
});
```

## 🚀 Deploy

### 1. Build do Projeto
```bash
npm run build
```

### 2. Testes de Integração
```bash
npm run test:integration
```

### 3. Deploy para Produção
```bash
npm run deploy:production
```

## 📊 Monitoramento

### Logs Estruturados
```typescript
// Adicionar logs estruturados em cada etapa
console.log('Trigger Point Generation', {
  poiId: poiData.id,
  poiName: poiData.name,
  step: 'geographic_analysis',
  duration: Date.now() - startTime,
  context: context
});
```

### Métricas de Performance
```typescript
// Coletar métricas de performance
const metrics = {
  processingTime: Date.now() - startTime,
  triggerPointsGenerated: result.length,
  averageQuality: result.reduce((sum, tp) => sum + tp.quality, 0) / result.length,
  apiCalls: {
    google: googleAPICalls,
    osm: osmAPICalls
  }
};
```

Este guia fornece uma implementação completa e testável do sistema de trigger points migrado para Google APIs.
