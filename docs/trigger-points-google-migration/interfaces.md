# TypeScript Interfaces - Trigger Points System

## 🎯 Interfaces Principais

### 1. POIData
**Arquivo**: `types/interfaces.ts`

```typescript
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
  description?: string;
  metadata?: {
    [key: string]: any;
  };
}
```

**Propriedades**:
- `id`: Identificador único do POI
- `name`: Nome do POI
- `location`: Coordenadas lat/lng
- `type`: Tipo do POI (building, monument, natural_feature, etc.)
- `country`: País do POI
- `city`: Cidade do POI
- `description`: Descrição opcional
- `metadata`: Dados adicionais opcionais

### 2. BoundaryData
**Arquivo**: `types/interfaces.ts`

```typescript
export interface BoundaryData {
  coordinates: Array<{
    lat: number;
    lng: number;
  }>;
  center: {
    lat: number;
    lng: number;
  };
  area: number;
  confidence: number;
  source: 'google_places' | 'osm' | 'estimated';
  elevation?: {
    center: number;
    min: number;
    max: number;
    variance: number;
  };
}
```

**Propriedades**:
- `coordinates`: Array de pontos do boundary
- `center`: Centro geométrico do boundary
- `area`: Área em metros quadrados
- `confidence`: Confiança na detecção (0-1)
- `source`: Fonte dos dados (google_places, osm, estimated)
- `elevation`: Dados de elevação opcionais

### 3. TriggerPoint
**Arquivo**: `types/interfaces.ts`

```typescript
export interface TriggerPoint {
  id: string;
  location: {
    lat: number;
    lng: number;
  };
  radius: number;
  expectedBearing: number;
  bearingThreshold: number;
  type: 'primary' | 'secondary' | 'tertiary' | 'fallback';
  priority: number;
  confidence: number;
  quality: number;
  street: StreetData;
  distance: number;
  generationMethod: 'google_apis' | 'osm' | 'super_simple_fallback';
  contextData: {
    urbanDensity: UrbanDensity;
    elevationContext: ElevationContext;
    streetPattern: StreetPattern;
    infrastructure: Infrastructure;
    region: Region;
  };
  createdAt: string;
  updatedAt: string;
}
```

**Propriedades**:
- `id`: Identificador único do TP
- `location`: Coordenadas do TP
- `radius`: Raio de ativação em metros
- `expectedBearing`: Direção esperada do POI
- `bearingThreshold`: Tolerância de direção
- `type`: Tipo do TP (primary, secondary, tertiary, fallback)
- `priority`: Prioridade (1-50)
- `confidence`: Confiança na qualidade (0-1)
- `quality`: Score de qualidade (0-1)
- `street`: Dados da rua
- `distance`: Distância do POI em metros
- `generationMethod`: Método de geração
- `contextData`: Dados de contexto geográfico
- `createdAt`: Data de criação
- `updatedAt`: Data de atualização

### 4. StreetData
**Arquivo**: `types/interfaces.ts`

```typescript
export interface StreetData {
  id: string;
  name: string;
  type: string;
  coordinates: Array<{
    lat: number;
    lng: number;
  }>;
  accessibility: 'public' | 'private' | 'no';
  surface?: string;
  width?: number;
  lanes?: number;
  maxSpeed?: number;
  metadata?: {
    [key: string]: any;
  };
}
```

**Propriedades**:
- `id`: Identificador único da rua
- `name`: Nome da rua
- `type`: Tipo de via (motorway, primary, residential, etc.)
- `coordinates`: Array de pontos da rua
- `accessibility`: Nível de acesso
- `surface`: Tipo de superfície
- `width`: Largura em metros
- `lanes`: Número de faixas
- `maxSpeed`: Velocidade máxima
- `metadata`: Dados adicionais

## 🌍 Interfaces de Contexto

### 5. GeographicContext
**Arquivo**: `types/interfaces.ts`

```typescript
export interface GeographicContext {
  urbanDensity: UrbanDensity;
  elevationContext: ElevationContext;
  streetPattern: StreetPattern;
  infrastructure: Infrastructure;
  region: Region;
}
```

### 6. UrbanDensity
**Arquivo**: `types/interfaces.ts`

```typescript
export interface UrbanDensity {
  level: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural';
  score: number;
  buildingDensity: number;
  populationDensity?: number;
  characteristics: string[];
}
```

**Níveis**:
- `very_dense`: Centro de metrópole (São Paulo, Rio)
- `dense`: Cidade grande (Brasília, Belo Horizonte)
- `medium`: Cidade média (Campinas, Santos)
- `low`: Cidade pequena (Petrópolis, Campos)
- `rural`: Área rural (fazendas, sítios)

### 7. ElevationContext
**Arquivo**: `types/interfaces.ts`

```typescript
export interface ElevationContext {
  type: 'flat' | 'hilly' | 'mountainous' | 'coastal' | 'plateau';
  variance: number;
  minElevation: number;
  maxElevation: number;
  averageElevation: number;
  characteristics: string[];
}
```

**Tipos**:
- `flat`: Planícies (Campinas, Santos)
- `hilly`: Colinas (São Paulo, Belo Horizonte)
- `mountainous`: Montanhas (Petrópolis, Campos do Jordão)
- `coastal`: Litoral (Rio de Janeiro, Santos)
- `plateau`: Planaltos (Brasília, Goiânia)

### 8. StreetPattern
**Arquivo**: `types/interfaces.ts`

```typescript
export interface StreetPattern {
  type: 'grid' | 'organic' | 'radial' | 'mixed' | 'rural';
  density: number;
  averageBlockSize: number;
  connectivity: number;
  characteristics: string[];
}
```

**Tipos**:
- `grid`: Grade regular (Brasília, Manhattan)
- `organic`: Orgânico (centros históricos)
- `radial`: Radial (Paris, Moscou)
- `mixed`: Misto (São Paulo, Rio)
- `rural`: Rural (estradas rurais)

### 9. Infrastructure
**Arquivo**: `types/interfaces.ts`

```typescript
export interface Infrastructure {
  roads: {
    primary: number;
    secondary: number;
    residential: number;
    total: number;
  };
  publicTransport: {
    bus: boolean;
    metro: boolean;
    train: boolean;
    ferry: boolean;
  };
  amenities: {
    hospitals: number;
    schools: number;
    shopping: number;
    restaurants: number;
  };
}
```

### 10. Region
**Arquivo**: `types/interfaces.ts`

```typescript
export interface Region {
  country: string;
  state?: string;
  city: string;
  timezone: string;
  language: string;
  currency: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  boundaries?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}
```

## 🔧 Interfaces de Validação

### 11. TriggerPointCandidate
**Arquivo**: `types/interfaces.ts`

```typescript
export interface TriggerPointCandidate {
  location: {
    lat: number;
    lng: number;
  };
  expectedBearing: number;
  confidence: number;
  quality: number;
  street: StreetData;
  distance: number;
  accessibility: boolean;
  visibility: boolean;
  metadata?: {
    [key: string]: any;
  };
}
```

### 12. ValidationResult
**Arquivo**: `types/interfaces.ts`

```typescript
export interface ValidationResult {
  isValid: boolean;
  score: number;
  reasons: string[];
  metadata?: {
    [key: string]: any;
  };
}
```

## 📊 Interfaces de Resultado

### 13. TriggerPointPredictionResult
**Arquivo**: `types/interfaces.ts`

```typescript
export interface TriggerPointPredictionResult {
  triggerPoints: TriggerPoint[];
  boundary: BoundaryData;
  context: GeographicContext;
  processingTime: number;
  metadata: {
    boundarySource: 'google_places' | 'osm' | 'estimated';
    boundaryConfidence: number;
    streetCount: number;
    optimalPointsFound: number;
    validatedPoints: number;
    finalPoints: number;
    fallbackUsed: boolean;
    searchRadius: number;
    elevationAnalysis?: {
      poiElevation: number;
      baseElevation: number;
      elevationDiff: number;
      isHighVisibility: boolean;
    } | null;
  };
}
```

### 14. APIResponse
**Arquivo**: `types/interfaces.ts`

```typescript
export interface APIResponse {
  success: boolean;
  count: number;
  triggerPoints: TriggerPoint[];
  statistics: {
    totalCandidates: number;
    basicValidationPassed: number;
    visibilityValidationPassed: number;
    distanceFilterPassed: number;
    finalPoints: number;
    processingTime: number;
    successRate: number;
  };
  metadata: {
    boundarySource: string;
    boundaryConfidence: number;
    streetCount: number;
    searchRadius: number;
    elevationAnalysis?: {
      poiElevation: number;
      baseElevation: number;
      elevationDiff: number;
      isHighVisibility: boolean;
    } | null;
    fallbackUsed: boolean;
  };
  error?: string;
}
```

## 🎨 Interfaces de Frontend

### 15. TriggerPointResult (Frontend)
**Arquivo**: `app/test-trigger-points-google/page.tsx`

```typescript
interface TriggerPointResult {
  success: boolean;
  count: number;
  triggerPoints: TriggerPoint[];
  statistics: {
    totalCandidates: number;
    basicValidationPassed: number;
    visibilityValidationPassed: number;
    distanceFilterPassed: number;
    finalPoints: number;
    processingTime: number;
    successRate: number;
  };
  metadata?: {
    boundarySource: string;
    boundaryConfidence: number;
    streetCount: number;
    searchRadius: number;
    elevationAnalysis?: {
      poiElevation: number;
      baseElevation: number;
      elevationDiff: number;
      isHighVisibility: boolean;
    } | null;
    fallbackUsed: boolean;
  };
  error?: string;
}
```

### 16. MapCircle (Frontend)
**Arquivo**: `app/test-trigger-points-google/page.tsx`

```typescript
interface MapCircle {
  id: string;
  center: {
    lat: number;
    lng: number;
  };
  radius: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
  fillColor: string;
  fillOpacity: number;
}
```

## 🔍 Interfaces de Debug

### 17. DebugInfo
**Arquivo**: `types/interfaces.ts`

```typescript
export interface DebugInfo {
  timestamp: string;
  poiId: string;
  processingSteps: Array<{
    step: string;
    duration: number;
    success: boolean;
    details?: any;
  }>;
  apiCalls: Array<{
    api: string;
    url: string;
    duration: number;
    success: boolean;
    responseSize?: number;
  }>;
  errors: Array<{
    step: string;
    error: string;
    timestamp: string;
  }>;
  performance: {
    totalTime: number;
    apiTime: number;
    processingTime: number;
    validationTime: number;
  };
}
```

## 📚 Interfaces de Configuração

### 18. SystemConfig
**Arquivo**: `types/interfaces.ts`

```typescript
export interface SystemConfig {
  maxTriggerPoints: number;
  minDistanceBetweenTPs: number;
  proximityThreshold: number;
  maxSearchRadius: number;
  minSearchRadius: number;
  elevationThresholds: {
    high: number;
    medium: number;
    low: number;
  };
  validationRules: {
    minQuality: number;
    minConfidence: number;
    maxDistance: number;
  };
  apiConfig: {
    timeouts: {
      [key: string]: number;
    };
    retries: {
      [key: string]: number;
    };
  };
}
```

---

**Status das Interfaces**: ✅ Todas Definidas
**Cobertura**: 100% do sistema
**Type Safety**: Completa
**Documentação**: Detalhada
