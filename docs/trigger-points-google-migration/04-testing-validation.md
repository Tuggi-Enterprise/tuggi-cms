# Guia de Testes e Validação - Trigger Points Google Migration

## 🧪 Estratégia de Testes

### Tipos de Testes

1. **Testes Unitários**: Componentes individuais
2. **Testes de Integração**: APIs e serviços
3. **Testes de Performance**: Tempo de processamento
4. **Testes de Validação**: Qualidade dos trigger points
5. **Testes de Regressão**: Comparação com sistema atual

## 🔧 Configuração de Testes

### Dependências de Teste
```json
{
  "devDependencies": {
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "supertest": "^6.3.0",
    "nock": "^13.3.0"
  }
}
```

### Configuração Jest
```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'lib/services/trigger-points-google/**/*.ts',
    '!**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

## 📝 Testes Unitários

### 1. Geographic Context Analyzer

```typescript
// __tests__/geographic-analyzer.test.ts
import { GeographicContextAnalyzer } from '@/lib/services/trigger-points-google/core/geographic-analyzer';

describe('GeographicContextAnalyzer', () => {
  let analyzer: GeographicContextAnalyzer;
  
  beforeEach(() => {
    analyzer = new GeographicContextAnalyzer();
  });
  
  describe('analyzeGeographicContext', () => {
    test('should analyze urban density correctly', async () => {
      const poiData = {
        id: 'test-1',
        name: 'Test POI',
        location: { lat: -23.5505, lng: -46.6333 },
        type: 'tourist_attraction',
        country: 'Brazil',
        city: 'São Paulo'
      };
      
      const context = await analyzer.analyzeGeographicContext(poiData);
      
      expect(context.urbanDensity).toBeDefined();
      expect(context.urbanDensity.level).toMatch(/^(very_dense|dense|medium|low|rural)$/);
      expect(context.urbanDensity.score).toBeGreaterThanOrEqual(0);
      expect(context.urbanDensity.score).toBeLessThanOrEqual(1);
    });
    
    test('should handle API errors gracefully', async () => {
      // Mock API error
      jest.spyOn(analyzer['googleAPIs'], 'client').mockRejectedValue(new Error('API Error'));
      
      const poiData = {
        id: 'test-1',
        name: 'Test POI',
        location: { lat: -23.5505, lng: -46.6333 },
        type: 'tourist_attraction',
        country: 'Brazil',
        city: 'São Paulo'
      };
      
      const context = await analyzer.analyzeGeographicContext(poiData);
      
      // Should return fallback values
      expect(context.urbanDensity.level).toBe('medium');
      expect(context.elevationContext.type).toBe('flat');
    });
  });
});
```

### 2. Boundary Detector

```typescript
// __tests__/boundary-detector.test.ts
import { BoundaryDetector } from '@/lib/services/trigger-points-google/core/boundary-detector';

describe('BoundaryDetector', () => {
  let detector: BoundaryDetector;
  
  beforeEach(() => {
    detector = new BoundaryDetector();
  });
  
  describe('detectBoundary', () => {
    test('should detect Google boundary successfully', async () => {
      const poiData = {
        id: 'test-1',
        name: 'Copacabana Beach',
        location: { lat: -22.9711, lng: -43.1822 },
        type: 'tourist_attraction',
        country: 'Brazil',
        city: 'Rio de Janeiro'
      };
      
      const context = {
        urbanDensity: { level: 'dense', score: 0.7 },
        elevationContext: { type: 'flat', variance: 10 },
        streetPattern: { type: 'organic', confidence: 0.8 },
        infrastructure: { transitTypes: ['bus'], parkingAvailability: 0.6, infrastructureDensity: 50 },
        region: 'auto_detected'
      };
      
      const boundary = await detector.detectBoundary(poiData, context);
      
      expect(boundary).toBeDefined();
      expect(boundary.coordinates).toBeDefined();
      expect(boundary.coordinates.length).toBeGreaterThan(0);
      expect(boundary.center).toBeDefined();
      expect(boundary.area).toBeGreaterThan(0);
      expect(boundary.confidence).toBeGreaterThanOrEqual(0);
      expect(boundary.source).toMatch(/^(google_places|osm|estimated)$/);
    });
    
    test('should fallback to OSM when Google fails', async () => {
      // Mock Google API failure
      jest.spyOn(detector['googleAPIs'], 'client').mockRejectedValue(new Error('Google API Error'));
      
      const poiData = {
        id: 'test-1',
        name: 'Test POI',
        location: { lat: -23.5505, lng: -46.6333 },
        type: 'tourist_attraction',
        country: 'Brazil',
        city: 'São Paulo'
      };
      
      const context = {
        urbanDensity: { level: 'dense', score: 0.7 },
        elevationContext: { type: 'flat', variance: 10 },
        streetPattern: { type: 'organic', confidence: 0.8 },
        infrastructure: { transitTypes: ['bus'], parkingAvailability: 0.6, infrastructureDensity: 50 },
        region: 'auto_detected'
      };
      
      const boundary = await detector.detectBoundary(poiData, context);
      
      expect(boundary.source).toMatch(/^(osm|estimated)$/);
    });
  });
});
```

### 3. Core Trigger Point Predictor

```typescript
// __tests__/trigger-point-predictor.test.ts
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';

describe('CoreTriggerPointPredictor', () => {
  let predictor: CoreTriggerPointPredictor;
  
  beforeEach(() => {
    predictor = new CoreTriggerPointPredictor();
  });
  
  describe('predictTriggerPoints', () => {
    test('should generate trigger points for valid POI', async () => {
      const poiData = {
        id: 'test-1',
        name: 'Copacabana Beach',
        location: { lat: -22.9711, lng: -43.1822 },
        type: 'tourist_attraction',
        country: 'Brazil',
        city: 'Rio de Janeiro'
      };
      
      const result = await predictor.predictTriggerPoints(poiData);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      
      // Validate trigger point structure
      result.forEach(tp => {
        expect(tp.id).toBeDefined();
        expect(tp.location).toBeDefined();
        expect(tp.location.lat).toBeDefined();
        expect(tp.location.lng).toBeDefined();
        expect(tp.radius).toBeGreaterThan(0);
        expect(tp.confidence).toBeGreaterThanOrEqual(0);
        expect(tp.confidence).toBeLessThanOrEqual(1);
        expect(tp.type).toMatch(/^(primary|secondary|fallback)$/);
        expect(tp.priority).toBeGreaterThan(0);
        expect(tp.quality).toBeGreaterThanOrEqual(0);
        expect(tp.quality).toBeLessThanOrEqual(1);
      });
    });
    
    test('should handle invalid POI data', async () => {
      const invalidPOI = {
        id: 'test-1',
        name: '',
        location: { lat: 0, lng: 0 },
        type: '',
        country: '',
        city: ''
      };
      
      await expect(predictor.predictTriggerPoints(invalidPOI)).rejects.toThrow();
    });
  });
});
```

## 🔗 Testes de Integração

### 1. API Endpoints

```typescript
// __tests__/api/trigger-points.test.ts
import request from 'supertest';
import { app } from '@/app';

describe('Trigger Points API', () => {
  describe('POST /api/trigger-points/generate-google', () => {
    test('should generate trigger points successfully', async () => {
      const poiData = {
        id: 'test-1',
        name: 'Copacabana Beach',
        location: { lat: -22.9711, lng: -43.1822 },
        type: 'tourist_attraction',
        country: 'Brazil',
        city: 'Rio de Janeiro'
      };
      
      const response = await request(app)
        .post('/api/trigger-points/generate-google')
        .send({ poiData })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.poiId).toBe(poiData.id);
      expect(response.body.data.triggerPoints).toBeDefined();
      expect(Array.isArray(response.body.data.triggerPoints)).toBe(true);
      expect(response.body.data.count).toBeGreaterThan(0);
    });
    
    test('should return error for invalid request', async () => {
      const response = await request(app)
        .post('/api/trigger-points/generate-google')
        .send({})
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });
  
  describe('POST /api/trigger-points/generate-batch-google', () => {
    test('should process multiple POIs', async () => {
      const pois = [
        {
          id: 'test-1',
          name: 'POI 1',
          location: { lat: -23.5505, lng: -46.6333 },
          type: 'tourist_attraction',
          country: 'Brazil',
          city: 'São Paulo'
        },
        {
          id: 'test-2',
          name: 'POI 2',
          location: { lat: -22.9711, lng: -43.1822 },
          type: 'tourist_attraction',
          country: 'Brazil',
          city: 'Rio de Janeiro'
        }
      ];
      
      const response = await request(app)
        .post('/api/trigger-points/generate-batch-google')
        .send({ pois })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalProcessed).toBe(2);
      expect(response.body.data.results).toHaveLength(2);
    });
  });
});
```

### 2. Google APIs Integration

```typescript
// __tests__/integration/google-apis.test.ts
import { GoogleAPIsService } from '@/lib/services/trigger-points-google/services/google-apis.service';

describe('Google APIs Integration', () => {
  let googleAPIs: GoogleAPIsService;
  
  beforeEach(() => {
    googleAPIs = new GoogleAPIsService();
  });
  
  describe('Places API', () => {
    test('should search for places successfully', async () => {
      const response = await googleAPIs.client.placesNearby({
        params: {
          location: { lat: -23.5505, lng: -46.6333 },
          radius: 1000,
          type: 'establishment',
          key: process.env.GOOGLE_MAPS_API_KEY!
        }
      });
      
      expect(response.data.status).toBe('OK');
      expect(response.data.results).toBeDefined();
    });
  });
  
  describe('Roads API', () => {
    test('should find nearest roads', async () => {
      const response = await googleAPIs.client.nearestRoads({
        params: {
          points: [
            { lat: -23.5505, lng: -46.6333 },
            { lat: -23.5515, lng: -46.6343 }
          ],
          key: process.env.GOOGLE_MAPS_API_KEY!
        }
      });
      
      expect(response.data.snappedPoints).toBeDefined();
    });
  });
});
```

## ⚡ Testes de Performance

### 1. Performance Benchmarks

```typescript
// __tests__/performance/benchmarks.test.ts
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';

describe('Performance Benchmarks', () => {
  let predictor: CoreTriggerPointPredictor;
  
  beforeEach(() => {
    predictor = new CoreTriggerPointPredictor();
  });
  
  test('should process POI within 30 seconds', async () => {
    const poiData = {
      id: 'perf-test-1',
      name: 'Performance Test POI',
      location: { lat: -23.5505, lng: -46.6333 },
      type: 'tourist_attraction',
      country: 'Brazil',
      city: 'São Paulo'
    };
    
    const startTime = Date.now();
    const result = await predictor.predictTriggerPoints(poiData);
    const endTime = Date.now();
    
    const processingTime = endTime - startTime;
    
    expect(processingTime).toBeLessThan(30000); // 30 seconds
    expect(result.length).toBeGreaterThan(0);
    
    console.log(`Processing time: ${processingTime}ms`);
  });
  
  test('should handle concurrent requests', async () => {
    const pois = Array.from({ length: 5 }, (_, i) => ({
      id: `concurrent-test-${i}`,
      name: `Concurrent Test POI ${i}`,
      location: { 
        lat: -23.5505 + (i * 0.001), 
        lng: -46.6333 + (i * 0.001) 
      },
      type: 'tourist_attraction',
      country: 'Brazil',
      city: 'São Paulo'
    }));
    
    const startTime = Date.now();
    const results = await Promise.all(
      pois.map(poi => predictor.predictTriggerPoints(poi))
    );
    const endTime = Date.now();
    
    const totalTime = endTime - startTime;
    
    expect(results).toHaveLength(5);
    results.forEach(result => {
      expect(result.length).toBeGreaterThan(0);
    });
    
    console.log(`Concurrent processing time: ${totalTime}ms`);
  });
});
```

## ✅ Testes de Validação

### 1. Quality Validation

```typescript
// __tests__/validation/quality.test.ts
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';

describe('Quality Validation', () => {
  let predictor: CoreTriggerPointPredictor;
  
  beforeEach(() => {
    predictor = new CoreTriggerPointPredictor();
  });
  
  test('should generate high-quality trigger points', async () => {
    const poiData = {
      id: 'quality-test-1',
      name: 'Copacabana Beach',
      location: { lat: -22.9711, lng: -43.1822 },
      type: 'tourist_attraction',
      country: 'Brazil',
      city: 'Rio de Janeiro'
    };
    
    const result = await predictor.predictTriggerPoints(poiData);
    
    // Validate quality metrics
    const averageQuality = result.reduce((sum, tp) => sum + tp.quality, 0) / result.length;
    const highQualityCount = result.filter(tp => tp.quality > 0.7).length;
    const autoApprovedCount = result.filter(tp => tp.confidence > 0.75).length;
    
    expect(averageQuality).toBeGreaterThan(0.5);
    expect(highQualityCount / result.length).toBeGreaterThan(0.6);
    expect(autoApprovedCount / result.length).toBeGreaterThan(0.5);
  });
  
  test('should generate trigger points with proper distances', async () => {
    const poiData = {
      id: 'distance-test-1',
      name: 'Test POI',
      location: { lat: -23.5505, lng: -46.6333 },
      type: 'tourist_attraction',
      country: 'Brazil',
      city: 'São Paulo'
    };
    
    const result = await predictor.predictTriggerPoints(poiData);
    
    result.forEach(tp => {
      expect(tp.distance).toBeGreaterThan(0);
      expect(tp.distance).toBeLessThan(1000); // Max 1km
      expect(tp.radius).toBeGreaterThan(0);
      expect(tp.radius).toBeLessThan(100); // Max 100m radius
    });
  });
});
```

### 2. Geographic Validation

```typescript
// __tests__/validation/geographic.test.ts
describe('Geographic Validation', () => {
  test('should work in different geographic contexts', async () => {
    const testCases = [
      {
        name: 'Urban Dense - São Paulo',
        location: { lat: -23.5505, lng: -46.6333 },
        expectedDensity: 'dense'
      },
      {
        name: 'Mountainous - Christ the Redeemer',
        location: { lat: -22.9519, lng: -43.2105 },
        expectedDensity: 'low'
      },
      {
        name: 'Coastal - Copacabana',
        location: { lat: -22.9711, lng: -43.1822 },
        expectedDensity: 'dense'
      }
    ];
    
    for (const testCase of testCases) {
      const poiData = {
        id: `geo-test-${testCase.name}`,
        name: testCase.name,
        location: testCase.location,
        type: 'tourist_attraction',
        country: 'Brazil',
        city: 'Test City'
      };
      
      const result = await predictor.predictTriggerPoints(poiData);
      
      expect(result.length).toBeGreaterThan(0);
      console.log(`${testCase.name}: Generated ${result.length} trigger points`);
    }
  });
});
```

## 🔄 Testes de Regressão

### 1. Comparison with Current System

```typescript
// __tests__/regression/comparison.test.ts
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';
import { TriggerPointsService } from '@/lib/services/poi-processing/trigger-points.service';

describe('Regression Tests', () => {
  let newPredictor: CoreTriggerPointPredictor;
  let currentService: TriggerPointsService;
  
  beforeEach(() => {
    newPredictor = new CoreTriggerPointPredictor();
    currentService = new TriggerPointsService();
  });
  
  test('should maintain or improve quality compared to current system', async () => {
    const testPOIs = [
      {
        id: 'regression-1',
        name: 'Copacabana Beach',
        location: { lat: -22.9711, lng: -43.1822 },
        type: 'tourist_attraction',
        country: 'Brazil',
        city: 'Rio de Janeiro'
      },
      {
        id: 'regression-2',
        name: 'Ibirapuera Park',
        location: { lat: -23.5874, lng: -46.6576 },
        type: 'park',
        country: 'Brazil',
        city: 'São Paulo'
      }
    ];
    
    for (const poi of testPOIs) {
      // Generate with new system
      const newResult = await newPredictor.predictTriggerPoints(poi);
      
      // Generate with current system
      const currentResult = await currentService.generateTriggerPoints(poi);
      
      // Compare results
      expect(newResult.length).toBeGreaterThanOrEqual(currentResult.length);
      
      const newAverageQuality = newResult.reduce((sum, tp) => sum + tp.quality, 0) / newResult.length;
      const currentAverageQuality = currentResult.reduce((sum, tp) => sum + tp.quality, 0) / currentResult.length;
      
      expect(newAverageQuality).toBeGreaterThanOrEqual(currentAverageQuality);
      
      console.log(`${poi.name}: New=${newResult.length} (${newAverageQuality.toFixed(2)}) vs Current=${currentResult.length} (${currentAverageQuality.toFixed(2)})`);
    }
  });
});
```

## 📊 Testes de Carga

### 1. Load Testing

```typescript
// __tests__/load/load-test.test.ts
describe('Load Testing', () => {
  test('should handle high volume of requests', async () => {
    const predictor = new CoreTriggerPointPredictor();
    const requests = Array.from({ length: 20 }, (_, i) => ({
      id: `load-test-${i}`,
      name: `Load Test POI ${i}`,
      location: { 
        lat: -23.5505 + (i * 0.01), 
        lng: -46.6333 + (i * 0.01) 
      },
      type: 'tourist_attraction',
      country: 'Brazil',
      city: 'São Paulo'
    }));
    
    const startTime = Date.now();
    const results = await Promise.all(
      requests.map(poi => predictor.predictTriggerPoints(poi))
    );
    const endTime = Date.now();
    
    const totalTime = endTime - startTime;
    const averageTime = totalTime / requests.length;
    
    expect(results).toHaveLength(20);
    expect(averageTime).toBeLessThan(15000); // 15s average per POI
    
    console.log(`Load test: ${requests.length} POIs in ${totalTime}ms (avg: ${averageTime}ms per POI)`);
  });
});
```

## 🚀 Execução de Testes

### Comandos de Teste

```bash
# Executar todos os testes
npm test

# Executar testes unitários
npm run test:unit

# Executar testes de integração
npm run test:integration

# Executar testes de performance
npm run test:performance

# Executar testes de validação
npm run test:validation

# Executar testes de regressão
npm run test:regression

# Executar testes com coverage
npm run test:coverage

# Executar testes em modo watch
npm run test:watch
```

### Scripts do Package.json

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest --testPathPattern=__tests__/unit",
    "test:integration": "jest --testPathPattern=__tests__/integration",
    "test:performance": "jest --testPathPattern=__tests__/performance",
    "test:validation": "jest --testPathPattern=__tests__/validation",
    "test:regression": "jest --testPathPattern=__tests__/regression",
    "test:coverage": "jest --coverage",
    "test:watch": "jest --watch"
  }
}
```

## 📈 Métricas de Qualidade

### Coverage Targets

- **Branches**: 80%
- **Functions**: 80%
- **Lines**: 80%
- **Statements**: 80%

### Performance Targets

- **Processing Time**: < 30s per POI
- **Concurrent Requests**: 5 POIs simultaneously
- **Memory Usage**: < 512MB per process
- **API Response Time**: < 10s per request

### Quality Targets

- **Success Rate**: > 90%
- **Average Quality**: > 0.7
- **Auto-Approval Rate**: > 60%
- **Error Rate**: < 5%

Este guia de testes garante que o sistema de trigger points migrado para Google APIs atenda aos mais altos padrões de qualidade e performance.
