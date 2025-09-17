# Documentação das APIs - Trigger Points Google Migration

## 📡 Visão Geral das APIs

Este documento descreve todas as APIs utilizadas no sistema de trigger points migrado para Google APIs.

## 🔑 Google APIs

### 1. Google Places API

#### **Places Nearby Search**
```typescript
// Buscar POIs próximos
const response = await googleMapsClient.placesNearby({
  params: {
    location: { lat: -23.5505, lng: -46.6333 },
    radius: 1000,
    type: 'establishment',
    key: apiKey
  }
});
```

**Parâmetros:**
- `location`: Coordenadas do centro da busca
- `radius`: Raio de busca em metros (máximo 50,000)
- `type`: Tipo de estabelecimento
- `name`: Nome específico do POI (opcional)

**Resposta:**
```typescript
interface PlacesNearbyResponse {
  results: Array<{
    place_id: string;
    name: string;
    geometry: {
      location: { lat: number; lng: number };
      viewport: {
        northeast: { lat: number; lng: number };
        southwest: { lat: number; lng: number };
      };
    };
    types: string[];
    rating?: number;
    user_ratings_total?: number;
  }>;
  status: string;
}
```

#### **Place Details**
```typescript
// Buscar detalhes de um lugar específico
const response = await googleMapsClient.placeDetails({
  params: {
    place_id: 'ChIJ...',
    fields: ['geometry', 'name', 'types', 'photos', 'reviews'],
    key: apiKey
  }
});
```

**Campos disponíveis:**
- `geometry`: Coordenadas e viewport
- `name`: Nome do lugar
- `types`: Tipos de estabelecimento
- `photos`: Fotos do lugar
- `reviews`: Avaliações

### 2. Google Roads API

#### **Nearest Roads**
```typescript
// Encontrar ruas mais próximas
const response = await googleMapsClient.nearestRoads({
  params: {
    points: [
      { lat: -23.5505, lng: -46.6333 },
      { lat: -23.5515, lng: -46.6343 }
    ],
    key: apiKey
  }
});
```

**Parâmetros:**
- `points`: Array de coordenadas para snap
- `key`: API key do Google

**Resposta:**
```typescript
interface NearestRoadsResponse {
  snappedPoints: Array<{
    location: { lat: number; lng: number };
    originalIndex: number;
    placeId: string;
  }>;
}
```

#### **Snap to Roads**
```typescript
// Snap de pontos para ruas
const response = await googleMapsClient.snapToRoads({
  params: {
    path: [
      { lat: -23.5505, lng: -46.6333 },
      { lat: -23.5515, lng: -46.6343 }
    ],
    interpolate: true,
    key: apiKey
  }
});
```

### 3. Google Street View API

#### **Street View Metadata**
```typescript
// Verificar disponibilidade de Street View
const response = await googleMapsClient.streetViewMetadata({
  params: {
    location: { lat: -23.5505, lng: -46.6333 },
    heading: 90,
    pitch: 0,
    key: apiKey
  }
});
```

**Parâmetros:**
- `location`: Coordenadas do local
- `heading`: Direção da câmera (0-360°)
- `pitch`: Ângulo vertical (-90 a 90°)

**Resposta:**
```typescript
interface StreetViewMetadataResponse {
  status: string;
  copyright: string;
  date: string;
  location: {
    lat: number;
    lng: number;
    pano_id: string;
  };
  pano_id: string;
}
```

### 4. Google Elevation API

#### **Elevation**
```typescript
// Buscar elevação de pontos
const response = await googleMapsClient.elevation({
  params: {
    locations: [
      { lat: -23.5505, lng: -46.6333 },
      { lat: -23.5515, lng: -46.6343 }
    ],
    key: apiKey
  }
});
```

**Resposta:**
```typescript
interface ElevationResponse {
  results: Array<{
    elevation: number;
    location: { lat: number; lng: number };
    resolution: number;
  }>;
  status: string;
}
```

## 🗺️ OpenStreetMap APIs (Fallback)

### 1. Overpass API

#### **Query de Boundaries**
```typescript
// Buscar boundaries de POIs
const query = `
[out:json][timeout:90];
(
  relation["name"="${poiName}"]["type"="multipolygon"];
  way["name"="${poiName}"]["building"];
  way["name"="${poiName}"]["leisure"];
  way["name"="${poiName}"]["amenity"];
);
out geom;
`;

const response = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: query
});
```

#### **Query de Streets**
```typescript
// Buscar ruas próximas
const query = `
[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|pedestrian|service|footway|path|track)$"](around:${radius},${lat},${lng});
);
out geom;
`;
```

### 2. Nominatim API

#### **Reverse Geocoding**
```typescript
// Buscar informações por coordenadas
const response = await fetch(
  `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
);
```

#### **Search by Name**
```typescript
// Buscar por nome
const response = await fetch(
  `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&limit=1&addressdetails=1`
);
```

## 🔧 Nossas APIs Internas

### 1. Trigger Points Generation API

#### **POST /api/trigger-points/generate-google**

**Request:**
```typescript
interface GenerateTriggerPointsRequest {
  poiData: {
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
  };
  options?: {
    maxSearchRadius?: number;
    minQuality?: number;
    maxTriggerPoints?: number;
  };
}
```

**Response:**
```typescript
interface GenerateTriggerPointsResponse {
  success: boolean;
  data: {
    poiId: string;
    triggerPoints: Array<{
      id: string;
      location: { lat: number; lng: number };
      radius: number;
      expectedBearing: number;
      bearingThreshold: number;
      type: 'primary' | 'secondary' | 'fallback';
      priority: number;
      confidence: number;
      quality: number;
      street: {
        id: string;
        type: string;
        coordinates: Array<{lat: number, lng: number}>;
        accessibility: string;
        confidence: number;
      };
      distance: number;
    }>;
    count: number;
    generatedAt: string;
    processingTime: number;
    context: {
      urbanDensity: string;
      elevationContext: string;
      streetPattern: string;
      boundarySource: string;
    };
  };
  error?: string;
}
```

**Exemplo de uso:**
```typescript
const response = await fetch('/api/trigger-points/generate-google', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    poiData: {
      id: 'poi-123',
      name: 'Copacabana Beach',
      location: { lat: -22.9711, lng: -43.1822 },
      type: 'tourist_attraction',
      country: 'Brazil',
      city: 'Rio de Janeiro'
    },
    options: {
      maxSearchRadius: 1000,
      minQuality: 0.5,
      maxTriggerPoints: 10
    }
  })
});

const result = await response.json();
```

### 2. Batch Processing API

#### **POST /api/trigger-points/generate-batch-google**

**Request:**
```typescript
interface BatchGenerateRequest {
  pois: Array<{
    id: string;
    name: string;
    location: { lat: number; lng: number };
    type: string;
    country: string;
    city: string;
  }>;
  options?: {
    maxConcurrent?: number;
    maxSearchRadius?: number;
    minQuality?: number;
  };
}
```

**Response:**
```typescript
interface BatchGenerateResponse {
  success: boolean;
  data: {
    totalProcessed: number;
    successful: number;
    failed: number;
    results: Array<{
      poiId: string;
      success: boolean;
      triggerPoints?: TriggerPoint[];
      error?: string;
      processingTime: number;
    }>;
    totalProcessingTime: number;
  };
}
```

### 3. Geographic Context API

#### **POST /api/trigger-points/analyze-context**

**Request:**
```typescript
interface AnalyzeContextRequest {
  location: {
    lat: number;
    lng: number;
  };
  poiName?: string;
}
```

**Response:**
```typescript
interface AnalyzeContextResponse {
  success: boolean;
  data: {
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
  };
}
```

## 📊 Rate Limits e Quotas

### Google APIs
| API | Quota Diária | Quota por Minuto | Custo |
|-----|--------------|------------------|-------|
| Places API | 100,000 | 1,000 | $0.017/request |
| Roads API | 100,000 | 1,000 | $0.005/request |
| Street View API | 100,000 | 1,000 | $0.007/request |
| Elevation API | 100,000 | 1,000 | $0.005/request |

### OpenStreetMap APIs
| API | Rate Limit | Custo |
|-----|------------|-------|
| Overpass API | 1 request/segundo | Gratuito |
| Nominatim API | 1 request/segundo | Gratuito |

## 🔒 Autenticação

### Google APIs
```typescript
// Configurar API key
const client = new Client({});
const apiKey = process.env.GOOGLE_MAPS_API_KEY;

// Usar em requests
const response = await client.placesNearby({
  params: {
    location: { lat, lng },
    radius: 1000,
    key: apiKey
  }
});
```

### Nossas APIs
```typescript
// Headers necessários
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`, // Se autenticação necessária
  'X-API-Key': process.env.INTERNAL_API_KEY // Para APIs internas
};
```

## 🚨 Tratamento de Erros

### Google APIs
```typescript
interface GoogleAPIError {
  error_message: string;
  status: 'INVALID_REQUEST' | 'OVER_QUERY_LIMIT' | 'REQUEST_DENIED' | 'UNKNOWN_ERROR';
  results?: any[];
}
```

### Nossas APIs
```typescript
interface APIError {
  success: false;
  error: string;
  details?: string;
  code?: string;
  timestamp: string;
}
```

## 📈 Monitoramento

### Métricas de API
```typescript
interface APIMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  quotaUsage: {
    google: number;
    osm: number;
  };
  errorRate: number;
}
```

### Health Check
```typescript
// GET /api/health/trigger-points
interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    googleAPIs: 'up' | 'down';
    osmAPIs: 'up' | 'down';
    database: 'up' | 'down';
  };
  lastCheck: string;
}
```

## 🔧 Configuração

### Variáveis de Ambiente
```bash
# Google APIs
GOOGLE_MAPS_API_KEY=your_api_key_here

# Rate Limiting
GOOGLE_API_RATE_LIMIT=1000
OSM_API_RATE_LIMIT=1

# Timeouts
GOOGLE_API_TIMEOUT=10000
OSM_API_TIMEOUT=15000

# Cache
CACHE_TTL_GEOGRAPHIC=86400
CACHE_TTL_BOUNDARY=604800
CACHE_TTL_STREETS=3600
```

### Configuração de Cliente
```typescript
const clientConfig = {
  google: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    timeout: parseInt(process.env.GOOGLE_API_TIMEOUT || '10000'),
    retries: 3
  },
  osm: {
    baseUrl: 'https://overpass-api.de/api/interpreter',
    timeout: parseInt(process.env.OSM_API_TIMEOUT || '15000'),
    retries: 2
  }
};
```

Esta documentação fornece todas as informações necessárias para integrar e usar as APIs do sistema de trigger points migrado para Google APIs.
