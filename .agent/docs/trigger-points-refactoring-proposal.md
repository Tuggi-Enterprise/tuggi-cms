# Plano de Refatoração: generate-trigger-points Edge Function

**Data:** 2026-01-16\
**Status:** Documentação de Referência (SSOT)\
**Princípios:** SSOT, DRY, KISS

---

## 1. Inventário do Código Existente

### 1.1 Estrutura Atual

```
lib/
├── analyzers/
│   ├── directional-analyzer.ts    # Análise direcional de visibilidade
│   ├── point-calculator.ts        # Cálculo de pontos ótimos (estratégias)
│   ├── street-analyzer.ts         # Busca e análise de ruas (OSM + Google Roads)
│   ├── validator.ts               # Validação e ranking de TPs
│   └── visibility-validator.ts    # Verificação de linha de visão 3D
│
├── config/
│   └── trigger-points-config.ts   # Constantes centralizadas (SSOT)
│
├── core/
│   ├── boundary-detector.ts       # Detecção de boundary (OSM + fallback)
│   ├── geographic-analyzer.ts     # Análise de contexto geográfico
│   └── trigger-point-predictor.ts # Orquestrador principal
│
├── services/
│   ├── elevation-service.ts       # Serviço de elevação
│   ├── google-apis.service.ts     # Wrapper Google APIs
│   └── poi-classifier.service.ts  # Classificação em 4 grupos
│
├── types/
│   └── interfaces.ts              # Tipos TypeScript
│
└── utils/
    ├── calculations.ts            # Funções matemáticas (✅ MUITAS ÚTEIS)
    ├── geometry.ts                # Funções geométricas
    ├── scoring.ts                 # Funções de pontuação
    └── street-processing.ts       # Processamento de ruas
```

### 1.2 Funções Reutilizáveis em `calculations.ts`

| Função                             | O que faz                      | Reutilizar? |
| ---------------------------------- | ------------------------------ | ----------- |
| `calculateDistance()`              | Haversine entre 2 pontos       | ✅ SIM      |
| `calculateBearing()`               | Direção entre 2 pontos         | ✅ SIM      |
| `extractBuildingHeight()`          | Extrai altura de tags OSM      | ✅ SIM      |
| `calculatePolygonArea()`           | Área de polígono               | ✅ SIM      |
| `calculatePolygonPerimeter()`      | Perímetro                      | ✅ SIM      |
| `isPointInPolygon()`               | Ponto está dentro do polígono  | ✅ SIM      |
| `calculateDistanceToPolygon()`     | Distância até polígono         | ✅ SIM      |
| `calculateDistanceToLineSegment()` | Distância até segmento         | ✅ SIM      |
| `calculatePolygonCenter()`         | Centro do polígono             | ✅ SIM      |
| `findNearestBoundaryPoint()`       | Ponto mais próximo no boundary | ✅ SIM      |
| `generatePointsFromBoundary()`     | Pontos a distância do boundary | ✅ SIM      |
| `calculateElevationBasedRadius()`  | Raio baseado em elevação       | ✅ SIM      |

### 1.3 O que já existe em `VisibilityValidator`

| Método                            | O que faz                 | Status                                 |
| --------------------------------- | ------------------------- | -------------------------------------- |
| `validateVisibility()`            | Orquestra validação       | ✅ Manter, adaptar                     |
| `validateWithBuildingsAnalysis()` | Busca buildings no OSM    | ⚠️ Refatorar (múltiplas chamadas)      |
| `validateWithElevationAnalysis()` | Analisa elevação          | ✅ Manter                              |
| `analyzeBuildingObstructions()`   | Analisa obstruções        | ✅ Já faz análise 3D!                  |
| `isLineOfSightBlocked()`          | Verifica bloqueio 3D      | ✅ JÁ EXISTE COM ALTURA!               |
| `lineIntersectsPolygon()`         | Interseção linha/polígono | ✅ Manter                              |
| `linesIntersect()`                | Interseção de linhas      | ✅ Manter                              |
| `extractBuildingHeight()`         | Altura de building        | ⚠️ Duplicado (usar de calculations.ts) |

**🎯 DESCOBERTA IMPORTANTE:** O código `isLineOfSightBlocked()` já considera
altura!

---

## 2. Problemas a Resolver

### 2.1 Fluxo Atual vs Fluxo Correto

| Etapa | Atual                            | Correto                               |
| ----- | -------------------------------- | ------------------------------------- |
| 1     | Parse body → Validate token      | **Validate token → Parse body**       |
| 2     | Múltiplas chamadas OSM           | **UMA chamada consolidada**           |
| 3     | Fallback silencioso se OSM falha | **Retry com backoff, erro explícito** |
| 4     | Bearing aponta para centro       | **Bearing aponta para boundary**      |
| 5     | Amostragem de 20 pontos          | **TODOS os pontos do boundary**       |

### 2.2 Chamadas OSM Atuais (Problema)

```
1. BoundaryDetector.fetchOSMById()      → Overpass (boundary)
2. BoundaryDetector.fetchOSMByName()    → Overpass (boundary fallback)
3. StreetAnalyzer.getStreetsFromOSM()   → Overpass (ruas)
4. VisibilityValidator.validateWithBuildingsAnalysis() → Overpass (buildings)
   └── Chamado N vezes (1 por candidato!)
```

**Total:** 3 + N chamadas por POI → **504 Gateway Timeout**

---

## 3. Plano de Refatoração

### 3.1 FASE 1: Validação de Token (index.ts)

**Mudança:** Validar JWT ANTES de parsear o body.

```typescript
serve(async (req) => {
    // CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // ═══════════════════════════════════════════════════════════════
    // PASSO 1: VALIDAR TOKEN (ANTES DE QUALQUER COISA)
    // ═══════════════════════════════════════════════════════════════
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
        });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
            status: 401,
        });
    }

    // Verificar role
    const { data: cmsUser } = await supabase
        .schema("core").from("cms_users")
        .select("role").eq("email", user.email).single();

    if (!cmsUser || cmsUser.role !== "admin") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // PASSO 2: AGORA SIM, PARSEAR O BODY (usuário validado)
    // ═══════════════════════════════════════════════════════════════
    const body = await req.json();
    // ... continua
});
```

### 3.2 FASE 2: Query OSM Consolidada (NOVO: OSMDataFetcher)

**Criar:** `lib/services/osm-data-fetcher.ts`

```typescript
interface OSMDataBundle {
    boundary: BoundaryData | null;
    streets: StreetData[];
    buildings: BuildingData[];
    osmTags: Record<string, string>;
}

export class OSMDataFetcher {
    private static MAX_RETRIES = 3;
    private static RETRY_DELAYS = [2000, 5000, 15000]; // ms - PODE ESPERAR

    /**
     * Busca TODOS os dados em UMA chamada Overpass
     */
    async fetchAllRequiredData(
        poiData: POIData,
        streetSearchRadius: number = 250,
    ): Promise<OSMDataBundle> {
        const query = this.buildConsolidatedQuery(poiData, streetSearchRadius);

        for (let attempt = 0; attempt < OSMDataFetcher.MAX_RETRIES; attempt++) {
            try {
                console.log(
                    `🌍 OSM Fetch attempt ${
                        attempt + 1
                    }/${OSMDataFetcher.MAX_RETRIES}...`,
                );
                const result = await this.executeQuery(query);
                console.log(`✅ OSM Fetch successful`);
                return this.parseOSMResponse(result, poiData);
            } catch (error) {
                console.warn(`⚠️ OSM attempt ${attempt + 1} failed: ${error}`);

                if (attempt < OSMDataFetcher.MAX_RETRIES - 1) {
                    const delay = OSMDataFetcher.RETRY_DELAYS[attempt];
                    console.log(`⏳ Waiting ${delay / 1000}s before retry...`);
                    await this.sleep(delay);
                }
            }
        }

        // Todas as tentativas falharam
        throw new Error("OSM_FETCH_FAILED");
    }

    private buildConsolidatedQuery(poiData: POIData, radius: number): string {
        const { lat, lng } = poiData.location;
        const osmIdClause = poiData.osm_id && poiData.osm_type
            ? `${poiData.osm_type}(id:${poiData.osm_id});`
            : "";
        const cleanName = poiData.name.replace(/'/g, "\\'").replace(
            /"/g,
            '\\"',
        );

        // Timeout longo (45s) - PRECISÃO > PERFORMANCE
        return `
      [out:json][timeout:45];
      (
        // 1. Boundary (por ID ou nome)
        ${osmIdClause}
        way["name"~"${cleanName}",i](around:100,${lat},${lng});
        relation["name"~"${cleanName}",i](around:100,${lat},${lng});
        
        // 2. Ruas acessíveis
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]
           ["access"!~"^(no|private)$"]
           ["tunnel"!="yes"]
           (around:${radius},${lat},${lng});
        
        // 3. Buildings (para análise de visibilidade)
        way["building"](around:${radius},${lat},${lng});
        
        // 4. Vegetação densa (bosques, florestas)
        way["natural"="wood"](around:${radius},${lat},${lng});
        way["landuse"="forest"](around:${radius},${lat},${lng});
        
        // 5. Muros altos
        way["barrier"="wall"]["height"](around:${radius},${lat},${lng});
      );
      out geom meta;
    `;
    }
}
```

### 3.3 FASE 3: Adaptar Fluxo Principal

**Modificar:** `trigger-point-predictor.ts`

```typescript
async predictTriggerPointsComplete(poiData: POIData, options = {}) {
  const startTime = Date.now();

  // ═══════════════════════════════════════════════════════════════
  // PASSO 1: BUSCAR DADOS OSM (UMA CHAMADA, COM RETRY)
  // ═══════════════════════════════════════════════════════════════
  const osmFetcher = new OSMDataFetcher();
  const searchRadius = this.calculateInitialSearchRadius(poiData);
  
  let osmBundle: OSMDataBundle;
  try {
    osmBundle = await osmFetcher.fetchAllRequiredData(poiData, searchRadius);
  } catch (error) {
    // OSM falhou após todas as tentativas - ERRO, não silencia
    throw new Error(`Unable to fetch geographic data: ${error.message}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PASSO 2: PROCESSAR BOUNDARY
  // ═══════════════════════════════════════════════════════════════
  const boundary = osmBundle.boundary 
    ? await this.boundaryDetector.enrichBoundaryData(osmBundle.boundary, poiData)
    : this.boundaryDetector.constructFallbackBoundary(poiData);

  // ═══════════════════════════════════════════════════════════════
  // PASSO 3: CLASSIFICAR POI
  // ═══════════════════════════════════════════════════════════════
  const context = await this.geographicAnalyzer.analyzeContext(poiData, boundary);
  const classification = await this.poiClassifier.classifyPOI(...);
  
  // ═══════════════════════════════════════════════════════════════
  // PASSO 4: SE FLAT + GRANDE → BUSCA EXTENDIDA
  // ═══════════════════════════════════════════════════════════════
  if (classification.group === 'flat' && boundary.area > 50000) {
    const extendedRadius = classification.searchRadius; // Já calculado
    try {
      const moreStreets = await osmFetcher.fetchExtendedStreets(boundary.center, extendedRadius);
      osmBundle.streets = [...osmBundle.streets, ...moreStreets];
    } catch (e) {
      console.warn('Extended search failed, continuing with initial data');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PASSO 5: CALCULAR PONTOS (usa dados do bundle, SEM novas chamadas)
  // ═══════════════════════════════════════════════════════════════
  const candidates = await this.pointCalculator.calculateOptimalPoints(
    poiData, osmBundle.streets, boundary, context
  );

  // ═══════════════════════════════════════════════════════════════
  // PASSO 6: VALIDAR (usa buildings do bundle, SEM novas chamadas)
  // ═══════════════════════════════════════════════════════════════
  const validatedPoints = await this.validator.validateAndRankPoints(
    candidates, poiData, context, boundary,
    osmBundle.buildings // <- PASSAR OS BUILDINGS JÁ BUSCADOS
  );

  return { triggerPoints: validatedPoints, boundary, context, metadata: {...} };
}
```

### 3.4 FASE 4: Processamento Sequencial por Setores (NOVO)

Para evitar `WORKER_LIMIT` e garantir cobertura 360°, o POI é dividido em
setores geográficos:

1. **Setor Norte (315° - 45°)**
2. **Setor Leste (45° - 135°)**
3. **Setor Sul (135° - 225°)**
4. **Setor Oeste (225° - 315°)**

O predicto itera sequencialmente:

- Filtra ruas daquele quadrante.
- Gera candidatos para aquele quadrante.
- Valida visibilidade (com o cache de prédios já filtrado por BBox).
- Acumula os melhores resultados de cada setor.

### 3.5 FASE 5: Bearing para o Boundary

**Já existe:** `findNearestBoundaryPoint()` em `calculations.ts`

```typescript
// Em TriggerPointValidator.convertToTriggerPoint() ou similar:

function calculateBearingToBoundary(
    tpLocation: { lat: number; lng: number },
    boundary: BoundaryData,
): number {
    // REUTILIZAR função existente
    const nearestPoint = findNearestBoundaryPoint(
        tpLocation,
        boundary.coordinates,
    );
    return calculateBearing(tpLocation, nearestPoint);
}
```

### 3.6 FASE 6: Visibilidade com TODOS os pontos

**Modificar:** `VisibilityValidator.analyzeBuildingObstructions()`

```typescript
analyzeBuildingObstructions(
  tpLocation: { lat; lng },
  boundary: BoundaryData,
  buildings: any[],
  poiHeight: number
): VisibilityAnalysisResult {
  
  // USAR TODOS OS PONTOS DO BOUNDARY (não amostrar)
  const boundaryPoints = boundary.coordinates;
  
  let visibleCount = 0;
  const obstructions: string[] = [];
  
  for (const boundaryPoint of boundaryPoints) {
    const isBlocked = this.isLineOfSightBlocked( // ✅ JÁ EXISTE COM 3D!
      tpLocation,
      boundaryPoint,
      buildings,
      poiHeight
    );
    
    if (!isBlocked) {
      visibleCount++;
    }
  }
  
  const visiblePercentage = (visibleCount / boundaryPoints.length) * 100;
  
  return {
    isValid: visiblePercentage >= 30, // Mínimo 30% visível
    visibleBoundaryPercentage: visiblePercentage,
    // ...
  };
}
```

---

## 4. Regras de Negócio Consolidadas

### 4.1 Validação de Token

- ✅ Validar JWT ANTES de ler o body
- ✅ Verificar role = 'admin'
- ✅ Se inválido: retornar 401/403

### 4.2 Busca de Dados OSM

- ✅ UMA chamada consolidada (boundary + streets + buildings)
- ✅ Retry: 3 tentativas (2s, 5s, 15s de delay)
- ✅ Se falhar: retornar erro 503 (não silenciar)
- ✅ PRECISÃO > PERFORMANCE (pode demorar)

### 4.3 Raio de Busca

- ✅ Raio calculado dinamicamente por `calculateIntelligentRadius()` (JÁ EXISTE)
- ✅ Casos especiais (FLAT + grande) já tratados no classificador
- ✅ Não limitar a 1km fixo - usar o que o código calcula

### 4.4 Visibilidade

- ✅ Usar TODOS os pontos do boundary (não amostrar)
- ✅ Mínimo 30% do boundary visível
- ✅ Altura do POI considerada no cálculo 3D (JÁ EXISTE em
  `isLineOfSightBlocked`)

### 4.5 Bearing

- ✅ Apontar para o PONTO MAIS PRÓXIMO do boundary (não centro)
- ✅ Usar `findNearestBoundaryPoint()` (JÁ EXISTE)

---

## 5. Checklist de Implementação

```
[✅] FASE 1: Reordenar validação de token em index.ts
[✅] FASE 2: Criar OSMDataFetcher com query consolidada
[✅] FASE 3: Adaptar CoreTriggerPointPredictor para usar OSMDataBundle
[✅] FASE 4: Modificar VisibilityValidator para receber buildings como parâmetro
[✅] FASE 5: Garantir bearing aponta para boundary (implementado em correctBearingsToBoundary)
[✅] FASE 6: Remover amostragem, usar todos os pontos do boundary
[✅] FASE 7: Tornar enrichBoundaryData e constructFallbackBoundary públicos
[✅] FASE 8: Deploy realizado
[ ] FASE 9: Teste com Edifício Copan (Aguardando usuário)
[ ] FASE 10: Teste com POI grande (Parque Ibirapuera)
[ ] FASE 11: Teste com POI alto (Pico do Jaraguá)
```

---

## 6. Funções a REUTILIZAR (DRY)

| Função                       | Arquivo                 | Uso                            |
| ---------------------------- | ----------------------- | ------------------------------ |
| `calculateDistance`          | calculations.ts         | Distância entre pontos         |
| `calculateBearing`           | calculations.ts         | Direção do TP para boundary    |
| `findNearestBoundaryPoint`   | calculations.ts         | Ponto mais próximo do boundary |
| `extractBuildingHeight`      | calculations.ts         | Altura de building OSM         |
| `isLineOfSightBlocked`       | visibility-validator.ts | Verificação 3D com altura      |
| `lineIntersectsPolygon`      | visibility-validator.ts | Interseção linha/polígono      |
| `calculateIntelligentRadius` | street-analyzer.ts      | Raio dinâmico                  |

---

## 7. Arquivos a NÃO DUPLICAR

- ❌ Não criar nova função de distância
- ❌ Não criar nova função de bearing
- ❌ Não criar nova função de extração de altura
- ❌ Não criar nova classe de classificação

**Usar o que já existe, apenas adaptar o fluxo.**
