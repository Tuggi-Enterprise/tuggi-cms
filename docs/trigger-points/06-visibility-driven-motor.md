# Visibility-Driven Motor (2026-05)

> Documentação técnica do motor atual de geração de Trigger Points. Substitui a abordagem categórica anterior (HIGH/MEDIUM/CANYON/FLAT com thresholds fixos).

## Princípio fundamental

**TPs só são posicionados onde o POI é fisicamente visível.** Visibilidade é **GATE**, não score — colocar TP onde o POI não pode ser visto é desastre de produto (audio guide tocando sobre nada visível).

Visibilidade é computada via ray-cast 2.5D usando alturas reais dos prédios (do banco local OSM) e elevação do terreno (SRTM offline).

Quando o fan **colapsa** (POI pequeno cercado por prédios altos — Church of the Transfiguration em Manhattan), FAN-WALK gera 0 candidatos. O pipeline cai em `buildFanCollapseFallback`, que emite o **safety net mínimo**:
- 2 TPs frontais simétricos (upstream + downstream) na rua de endereço do POI (Camada 3)
- 1 geofence TP sobre o polígono do boundary

Total típico no fallback: **2-3 TPs**. Suficiente pra disparar audio guide quando o usuário passa pela frente, sem poluir o mapa com TPs em ruas onde o POI não é visível.

Categorias antigas (HIGH/MEDIUM/CANYON/FLAT) viram **rótulos descritivos**, não regras de decisão. Tudo no pipeline opera em **dados locais** (zero rate-limit de Overpass).

---

## Arquitetura — Pipeline em ordem

```
POST /api/trigger-points/google/generate
  ↓
1. validatePOIData                  — sanity check
2. boundaryDetector.detectBoundary  — OSM polygon do POI (LocalOSMFetcher → Overpass fallback)
3. attachEntrancesFromLocalOSM      — adiciona entradas (entrance=main/yes) ao boundary
4. useContainingBuildingHeight      — Camada 1: storefront POIs herdam altura do prédio que os contém
5. attachVisibilityFan              — constrói o "fan" de visibilidade física (ray-cast 2.5D)
6. analyzeGeographicContext         — densidade urbana, elevação, padrão de ruas
7. classifyPOI                      — atribui POIGroup (rótulo descritivo)
8. streetAnalyzer.findAccessibleStreetsWithMetadata
                                    — busca ruas locais (sempre estende ao longo do boundary
                                       quando fan ativo, eliminando pin-bias)
9. pointCalculator.calculateOptimalPoints
                                    — FAN-WALK gera candidatos espaçados por minDistance
                                    — Skip block structure analysis (fan já cuidou)
10. validator.validateAndRankPoints
    a. basicValidation              — quality≥0.3, accessibility
    b. one-way "flagged-only"       — registra mas não descarta em modo fan
    c. classifyCandidatesByPrimaryScore — score 0-1, threshold 0.50 → primary
    d. selectCandidatesWithTypeAwareDedup
                                    — dedup com thresholds diferentes por type
    e. clusterIntersections         — pós-dedup: agrupa TPs em ruas diferentes
                                       dentro de 25m e mantém só o de melhor score
                                       (resolve corner POIs)
    f. Skip post-fan visibility check (fan já validou)
    g. convertToTriggerPoint        — usa candidate.predictedType
11. applyOptions                    — minQuality, maxTriggerPoints
12. buildFrontalArrivalTP           — Camada 3: até 2 TPs frontais garantidos
                                       (upstream + downstream na addr:street ou
                                       closest-street ≤80m do boundary)
13. buildGeofenceTriggerPoint       — 1 TP polygon-based pra qualquer POI com boundary
                                       válido (radius derivado do fan)

Fan-collapse fallback (FAN-WALK gera 0 candidatos por colapso em hiper-densa):
  → buildFanCollapseFallback        — chama Camada 3 (2 TPs frontais) + geofence,
                                       legacy single-TP como último recurso
  ↓
Final: TriggerPoint[]
```

---

## Componentes-chave

### 1. VisibilityMapBuilder (`analyzers/visibility-map-builder.ts`)

Função pura que produz o **visibility fan**: união de polígonos representando onde o POI é fisicamente visível.

**Algoritmo:**
- Sample N pontos ao longo do perímetro do boundary (1-12, proporcional ao tamanho)
- Pra POIs gigantes (área > 1 km²): adiciona até 16 pontos em grade interior (4×4 filtrada pelo polígono). Pontos interiores capturam obstáculos DENTRO do próprio POI — pra um aeroporto, ray do centro dum terminal bate em outros terminais antes de escapar, gerando fan fisicamente correto.
- Pra cada sample, ray-cast em 72 direções (5° de resolução)
- Cada ray "caminha" pra fora em passos de 100m
- A cada passo, verifica se algum building entre POI top altitude e observer eye altitude bloqueia (interseção 2D + comparação 3D usando alturas reais)
- Para no primeiro bloqueio
- Resultado por direção: distância máxima visível

**Outputs:**
- `polygons[]`: 1 polígono por sample point (estrelado, 72 vértices cada)
- `maxDistanceM`, `meanDistanceM`, `minDistanceM`
- `coverageAreaM2`

**Performance:** 8000 building cap, paralelização de direções via `Promise.all`. ~1-3s por POI típico.

**Cap de horizonte:** auto-escalado por altura do POI: `max(2km, min(15km, poiTop × 15))`. Cristo Redentor (730m) → 10.9km. Pier 97 (3m) → 2km.

### 2. Containing-Building Lookup (Camada 1, `predictor.useContainingBuildingHeight`)

Storefront POIs (museus, lojas) frequentemente têm `height=0` no OSM (altura semântica do POI, não da estrutura). Isso colapsa o fan.

Fix: procurar entre `boundary.buildings` o polígono que contém o centroide do POI. Usar sua altura (tag `height`, ou `building:levels × 3.5`, ou fallback `defaultHouseHeight=6m`). Substitui apenas se for maior que a altura semântica.

Pra Museum of Ice Cream: building da Broadway 558 tem 12m → fan pode operar.

**Threshold de área (refinado 2026-05)**: Camada 1 é skipada quando `boundary.area_m2 > 5000 m²`. Pra POIs grandes (aeroportos, parques, campus), o POI **É** a área — não está embedded num prédio. Pegar altura do edifício mais próximo do centroide infla artificialmente o `POI top` (JFK pegava 30m de um terminal específico vs aeroporto que é 99% pista 0m), gerando fan exagerado e TPs em bairros que não veem o POI.

### 3. FAN-WALK Strategy (`point-calculator.calculateFanWalkStrategy`)

Substitui as estratégias categóricas (`circular`, `linear`, `standard`) quando fan ativo.

**Pra cada rua que passou pelo filtro do fan:**
1. Mantém só os pontos da rua que estão DENTRO de algum polígono do fan, ou DENTRO do boundary, ou ≤30m da aresta (safety net mínimo).
2. Caminha pela polilinha da rua acumulando distância.
3. A cada `minDistanceBetweenTPs` (default 40m) acumulados, solta um candidato.

Quality 100% física: `streetClass + proximityToBoundary + confidence`. Sem bônus categóricos de urbanDensity/elevationType.

### 4. Score-based Primary Classification (`validator.classifyCandidatesByPrimaryScore`)

Cada candidato recebe um `primaryScore` (0-1) computado a partir de propriedades **intrínsecas**:

| Componente | Faixa | Critério |
|---|---|---|
| **Street class** | 0.02-0.30 | motorway: 0.30, primary: 0.20, secondary: 0.15, residential: 0.05 |
| **Proximity to edge** | 0.05-0.15 | ≤30m: 0.15, ≤100m: 0.10, ≤500m: 0.05 (distância à aresta do polígono, 0 se dentro) |
| **Intersection** | 0/0.20 | Pelo menos 1 outro candidato com `street.id` diferente em raio de 30m |
| **addr:street match** | 0/0.20 | Nome da rua = `boundary.address.street` (rua de endereço do POI no OSM) |

**Threshold:** `score ≥ 0.50` → primary. Senão → secondary.

Substitui o `determineTriggerType` legado baseado em índice no array.

### 5. Type-aware Dedup (`validator.selectCandidatesWithTypeAwareDedup`)

Dedup com thresholds **diferentes por combinação de types**:

| Combinação | Distance | Bearing diff | Quality gap? |
|---|---|---|---|
| **Qualquer par** | < 15m | — | **Sempre dropa** (hard floor, radii sobrepostos) |
| **Primary + Primary** | 30m | 45° | Sim (≥0.05) |
| **Secondary + Secondary** | 70m | 60° | Sim (≥0.05) |
| **Primary vs Secondary** (absorção) | 70m | 60° | Primary **sempre vence** |
| **Primary vs Secondary** (avaliação reversa) | — | — | Primary **sempre passa** |

**Ordem de processamento:** primaries primeiro (quality desc), depois secondaries. Primaries ocupam o "espaço" antes dos secondaries serem avaliados, então a regra "primary absorve secondary" funciona corretamente.

### 5b. Intersection Clustering (`validator.clusterIntersections`)

Pós-dedup. Resolve um caso edge específico: o type-aware dedup é bearing-aware, então TPs próximos em ruas diferentes (90°+ de diferença angular) sobrevivem ambos. Em **corner POIs** (ex: Madison Square Park, cantos da Av. Paulista), o mesmo cruzamento é representado no OSM por 3-4 segmentos com `street.id` diferentes — todos viram TPs separados a menos de 25m uns dos outros.

**Algoritmo:**
- Ordena por (primary > secondary, primaryScore desc, quality desc)
- Greedy: pra cada candidato, descarta se houver outro já selecionado **em rua diferente** (`street.id` distinto) dentro de `radiusM` (default 25m)
- **Não toca** TPs próximos na mesma rua (spacing legítimo do FAN-WALK)

**Default:** ON em modo fan. Desligável via `options.clusterIntersections=false`. Raio configurável via `options.intersectionClusterRadiusM` (5-100m).

### 6. Frontal TPs (Camada 3, `predictor.buildFrontalArrivalTP`)

Garantia mínima: até **2 TPs na rua de frente do POI** (upstream + downstream).

**Estratégia 1**: usa `boundary.address.street` (OSM `addr:street`). Procura match em ruas acessíveis.

**Estratégia 2 (fallback)**: closest accessible street ≤80m do boundary. Pura física — qualquer rua tão perto provavelmente tem line-of-sight direto à fachada. Limiar 80m (bump de 50m em 2026-05) cobre storefronts em hiper-densa Manhattan onde o polígono semântico do POI está dentro de prédios maiores e a rua frontal é off-center.

**Geração dos 2 TPs:**
1. `closestPointOnPolyline(boundary.center, street.coordinates)` → projeta o centro do POI na polilinha, achando o ponto exato mais próximo (interpolado, não vértice).
2. `walkAlongPolyline(coords, projection, ±25m)` → caminha a polilinha em ambos os sentidos por 25m.
3. Emite 1 TP por flanco. Cada TP tem `expectedBearing = bearing(TP → POI)` — quando o user passa pelo TP indo em direção ao POI, dispara como "front".

**Por que 2 TPs?** Como NÃO validamos `oneway direction` no motor (decisão de design: dados OSM ruidosos, app filtra `direction=back` em runtime), TPs simétricos garantem que pelo menos UM dispare como "front" independente do sentido de tráfego ou da direção de aproximação. Antes disso, fallback de 1 TP frequentemente caía downstream do POI → user sempre tinha o POI no `back` → audio nunca tocava.

**Skip** se um TP do FAN-WALK já cobre o flanco (≤30m do ponto computado). Se polilinha é muito curta (upstream e downstream coincidem em ≤10m), emite só 1.

**Acionamento:** roda tanto no happy path (fim do pipeline) quanto no **fan-collapse fallback** (quando FAN-WALK gera 0 candidatos por colapso do fan em hiper-densa).

### 7. Geofence TP (`predictor.buildGeofenceTriggerPoint`)

1 TP do tipo `geofence` por POI com boundary OSM válido. Polígono do boundary inteiro como zona de disparo. `radius` derivado de `fan.maxDistanceM` (com piso 500m). Skip pra boundaries `estimated`, `manual`, `manual_drawing`.

App `tuggi-drive-v2` faz point-in-polygon detection com esse polígono — dispara quando o usuário entra (mesmo andando, sem direção).

### 8. Boundary-sampling Street Fetcher (`LocalOSMFetcher.fetchStreetsAlongBoundary`)

Quando o fan está ativo, sempre buscar streets via amostragem ao longo do boundary (não centrado no pin do POI). Isso elimina o bias do pin pra POIs longos/elongados (pontes, parques) cujo pin frequentemente está num canto.

**Algoritmo:**
- Sample N pontos no perímetro (1-12 proporcional ao tamanho)
- Pra cada sample: query streets no bbox `[fan.maxDistanceM]` ao redor
- Merge único por `street.id`

---

## Dados locais (`data/local_osm.db`)

SQLite ~8.4GB com 3 tabelas:

| Tabela | Conteúdo | Usado por |
|---|---|---|
| `streets` | OSM ways com `highway=*` **ou rotas multi-modais** (ferry, waterway, railway, aerialway) | Street analysis |
| `buildings` | OSM polygons tagged `building=*` com `height` e tags | Visibility ray-cast |
| `pois` | OSM elements taggeados como POI (museum, restaurant, peak, etc.) | Boundary lookup, entrances |

Bbox indices em `min_lat/max_lat/min_lng/max_lng` pra spatial queries rápidas.

**Multi-modal routes:** rotas marítimas, ferroviárias e aeroviárias também ficam na tabela `streets` para que `LocalOSMFetcher.queryStreets` as inclua automaticamente. `isStreetAccessible` aceita os novos tipos. Ver [HANDOFF-2026-05-18.md](./HANDOFF-2026-05-18.md) §Multi-modal routes.

**SRTM:** `data/srtm-cache/*.hgt` — tiles offline pra elevação do terreno. Usado pelo `SRTMLocalService`. Diretório está no `.gitignore` (baixado on demand via SRTMLocalService).

---

## Configuração (`config/trigger-points-config.ts`)

### Constantes globais (`TRIGGER_POINTS_CONSTANTS`)

```typescript
triggerPoint: {
  defaultBearingThreshold: 30,    // graus — alinhado com zona "front" do app
  fallbackBearingThreshold: 60,
  gpsPingWindowSec: 3,            // janela GPS típica
  gpsPingSafetyFactor: 2,         // multiplicador de segurança
  minRadiusM: 15,                 // floor pra qualquer TP
  maxRadiusM: 150,                // ceiling global (refinado por grupo)
  eyeHeightCarM: 1.5,             // pra ray-cast 2.5D
  eyeHeightPedestrianM: 1.7,
}
```

### Per-group caps (`GROUP_CONFIGS`)

| Grupo | minDistanceBetweenTPs | maxTPRadiusM | searchRadius |
|---|---|---|---|
| HIGH | 100m | 100m | sqrt(elevDiff)×200, [3km, 15km] |
| MEDIUM | 80m | 60m | height × 15, [750m, 5km] |
| CANYON | 40m | 40m | fixed 300m |
| FLAT | 40m | 50m | fixed 120m |

Note: no modo visibility-driven, `searchRadius` categórico é **substituído** pelo `fan.maxDistanceM`. Os outros valores ainda dirigem espacamento e radius cap.

---

## API

### POST `/api/trigger-points/google/generate`

Request:
```json
{
  "poiData": { /* POIData */ },
  "options": {
    "useVisibilityMap": true,        // default ON
    "visibilityMaxHorizonM": 5000,   // optional override
    "simulateApproach": false,        // OSRM-based, opt-in
    "validateCorridor": false,        // OSRM-based, opt-in
    "clusterIntersections": true,     // default ON em modo fan
    "intersectionClusterRadiusM": 25, // raio do clustering (5-100m)
    "minQuality": 0.3,
    "maxTriggerPoints": 500
  }
}
```

Response: `{ success, data: { triggerPoints[], boundary, context, metadata } }`

### Fan é obrigatório

O motor visibility-driven é o único path desde Tier 3.1 (2026-05-18). A opção `useVisibilityMap` e o caminho categórico legado foram removidos. Todo POI passa pelo ray-cast 2.5D.

---

## Casos de uso cobertos

| POI | Caso | Comportamento |
|---|---|---|
| **Cristo Redentor** | HIGH alto, pequeno boundary | Fan estende 5-10km, TPs em Botafogo/Copacabana |
| **Queensboro Bridge** | Longo, baixo | 8-12 sample points ao longo da ponte, TPs assimétricos (Brooklyn ok, Manhattan limitado por buildings) |
| **Madison Square Park** | Grande, vários cantos | TPs distribuídos nas 4 esquinas + perimeter, type-aware dedup limpa cluster nas esquinas |
| **Pier 97** | Pequeno, baixo | Fan limitado, frontal TP garante coverage local |
| **Museum of Ice Cream** | Storefront em prédio | Camada 1 detecta prédio container (12m), Camada 3 garante TP frontal na Broadway |

---

## Limitações conhecidas

1. **One-way validation desligada em modo fan**: dados OSM têm inconsistências de direção (alguns segmentos de 5th Ave drawn south-to-north com `oneway=yes`). Logamos rejeições potenciais mas não aplicamos. App `tuggi-drive-v2` filtra direction=back em runtime.

2. **POIs sem altura nem prédio container**: fallback de `defaultHouseHeight=10m`. Fan ainda pode colapsar em áreas hiper-densas. Camada 3 (closest-street) compensa.

3. **TPs "going away from POI"**: o motor não distingue segmentos one-way que afastam vs aproximam. Esses TPs são gerados mas runtime do app filtra. Custo: visualmente parece haver TPs extras em alguns cruzamentos.

4. **Pin-bias da POI location**: o pin do banco pode não coincidir com o centroide do boundary (caso Madison Square Park). O motor internamente usa `boundary.center` pra cálculos, mas o pin é mostrado na UI. Detectamos mismatch nos logs.

5. ~~**Intersection clustering em corner POIs**~~ — **resolvido em 2026-05-17**. Passagem `clusterIntersections` (default ON em modo fan) agrupa TPs em ruas diferentes dentro de 25m e mantém só o melhor score. Ver §5b acima.

---

## Migrações de banco aplicadas

```bash
supabase/migrations/20260515_add_geofence_trigger_type.sql
supabase/migrations/20260515_trigger_point_events_feedback.sql
supabase/migrations/20260518_replace_trigger_points_atomic_rpc.sql  # ← Aplicar antes do batch
```

Schema relevante:
- `core.attraction_trigger_points.type` agora aceita `'geofence'`
- `core.attraction_trigger_points.geometry_geojson` armazena polígono do geofence
- `core.trigger_point_events` recebe analytics do app (DIRECTION_BACK, TRIGGER_DETECTED, etc.)
- View `core.trigger_point_health` agrega métricas por TP nos últimos 30 dias
- `core.replace_trigger_points_atomic(p_attraction_id, p_trigger_points)` — DELETE+INSERT atômicos

---

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `lib/services/trigger-points-google/core/trigger-point-predictor.ts` | Orquestrador principal |
| `lib/services/trigger-points-google/analyzers/visibility-map-builder.ts` | Ray-cast 2.5D + fan polygons |
| `lib/services/trigger-points-google/analyzers/point-calculator.ts` | FAN-WALK strategy + filterStreetsByRadius |
| `lib/services/trigger-points-google/analyzers/validator.ts` | Score classification + type-aware dedup |
| `lib/services/trigger-points-google/analyzers/street-analyzer.ts` | Street fetching + extension along boundary + isStreetAccessible |
| `lib/services/trigger-points-google/services/local-osm-fetcher.ts` | SQLite queries pra streets/buildings/pois/entrances |
| `lib/services/trigger-points-google/config/trigger-points-config.ts` | Constantes globais + GROUP_CONFIGS + memory caps |
| `lib/services/trigger-points-google/utils/logger.ts` | TPLogger com TP_LOG_LEVEL |
| `lib/services/trigger-points-google/utils/deterministic.ts` | deterministicTPId + seededRng |
| `lib/services/trigger-points-google/utils/lru-cache.ts` | LRUCacheWithTTL<K,V> |
| `lib/geometry/index.ts` | SSOT pra cálculos geométricos (Haversine, bearing, direction zones, etc.) |
| `lib/services/osm-local-data-service.ts` | Importação PBF → SQLite (inclui rotas multi-modais) |
| `scripts/manage-osm.ts` | CLI: import PBF, cleanup cache |

---

## Decisões de design importantes

1. **Visibility-driven > categorical**: thresholds fixos por categoria falhavam em casos edge (POI em rua expressa de 80km/h, ponte de 41m que não vira MEDIUM). Física unifica todos os casos.

2. **Centroide vs pin do POI**: motor usa `boundary.center` (centroide computado do polígono) pra cálculos. Pin do banco pode estar offset (caso Madison Square Park) — corrigido só na geração, não no banco.

3. **App runtime > pre-filter**: motor não pré-rejeita por one-way devido a dados OSM ruidosos. Confia que o app filtra direction=back em runtime.

4. **"Errar por mais"**: dedup conservador. Empate de quality mantém ambos. Apenas redundância claramente provada (distance + bearing + quality gap) descarta.

5. **Camadas KISS sobre a física**:
   - Camada 1 (containing building) — corrige altura pra storefront POIs
   - Camada 2 (safety net 30m) — calçada perimetral sempre entra
   - Camada 3 (frontal TP) — garante 1 TP na rua de frente independente do fan
