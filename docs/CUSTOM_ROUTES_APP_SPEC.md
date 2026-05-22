# Custom Routes — Especificação para o App (tuggi-drive-v2)

**Versão:** 2.0  
**Data:** 2026-05-22  
**Status:** Backend completo. Aguardando implementação no app.  
**Substitui:** `CUSTOM_ROUTES_I18N.md` (versão anterior, agora deprecated)

---

## 1. O que são as Custom Routes

Rotas curadas manualmente pelo time Tuggi (via CMS) para oferecer experiências turísticas guiadas.

### Características importantes

- **Não são rotas de navegação turn-by-turn.** São sequências de pontos de interesse.
- **O app abre o Google Maps / Apple Maps** com os waypoints → quem calcula o caminho é o mapa externo.
- **Podem ser de carro, caminhada ou ferry** — o campo `drivability` indica isso:
  - `'easy' | 'moderate' | 'demanding'` = rota de carro
  - `'unknown'` = rota de caminhada / ferry / transporte público (NYC, etc.)
- **São multilíngues:** `name` e `description` têm traduções disponíveis em múltiplos idiomas.

---

## 2. Schema da tabela `core.custom_routes`

Campos relevantes para o app (todos disponíveis via RPC):

```typescript
interface CustomRoute {
  // ─── Identidade ──────────────────────────────────────────────────────────
  id:          string       // UUID
  name:        string       // nome original (idioma de criação)
  description: string|null // descrição original

  // ─── Localização (NOVO — adicionado 2026-05-22) ──────────────────────────
  country:  string|null   // ex: 'Portugal', 'United States', 'Brazil'
  region:   string|null   // ex: 'Lisboa', 'Orlando', 'New York'

  // ─── Geometria e waypoints ───────────────────────────────────────────────
  geometry_coords: LatLng[]          // coordenadas OSRM road-snapped
  waypoints:       RouteWaypoint[]   // lista de POIs a visitar (ver §4)
  stops_count:     number

  // ─── Distância / duração (calculadas pelo OSRM) ─────────────────────────
  metadata: {
    distance:         number    // metros
    duration:         number    // segundos
    source:           'osrm'|'manual'
    content_language: string    // idioma do content base (ex: 'pt-br', 'en-us')
  }

  // ─── Características da experiência ─────────────────────────────────────
  scenic_profile:    ScenicProfile[]   // ver §5
  drivability:       Drivability       // ver §5
  accessibility:     Accessibility     // ver §5
  best_time:         BestTime[]        // ver §5
  road_conditions:   RoadCondition[]   // ver §5
  photogenic_rating: PhotogenicRating  // ver §5

  // ─── Tradução (ver §6) ───────────────────────────────────────────────────
  translated_name:        string|null
  translated_description: string|null
  description_audio_url:  string|null   // URL MP3 da narração (~15-25s)
  translation_status:     TranslationStatus|null

  // ─── Meta ────────────────────────────────────────────────────────────────
  is_active:   boolean
  usage_count: number
  created_at:  string
  updated_at:  string
}
```

---

## 3. RPCs disponíveis

### `core.get_nearby_custom_routes`

```typescript
const { data } = await supabase
  .schema('core')
  .rpc('get_nearby_custom_routes', {
    user_lat:        latitude,
    user_lng:        longitude,
    radius_km:       10,               // sugerir 10km para turistas
    p_user_language: 'en-us',          // idioma do utilizador
    p_voice_gender:  'male',           // 'male' | 'female'
  })
// retorna: RouteRPCRow[]
```

### `core.get_custom_route_by_id`

```typescript
const { data } = await supabase
  .schema('core')
  .rpc('get_custom_route_by_id', {
    p_route_id:      routeId,
    p_user_language: 'en-us',
    p_voice_gender:  'male',
  })
// retorna: RouteRPCRow[]  (array de 1 elemento)
```

> **Backward compatible:** `p_user_language` e `p_voice_gender` têm defaults
> (`'en-us'` e `'male'`). RPCs já usadas sem esses parâmetros continuam funcionando.

---

## 4. Waypoints — formato completo

```typescript
interface RouteWaypoint {
  id:  string      // UUID curto (aleatório, uso interno)
  lat: number
  lng: number
  metadata: {
    name:         string|null  // nome do ponto de interesse
    attraction_id: string|null // UUID do POI no banco (se vinculado)
    is_generic:   boolean      // true = ponto genérico, false = POI do banco

    // Recursos neste ponto
    wheelchair_access: 'yes'|'partial'|'no'|'unknown'
    parking:           'yes'|'no'|'unknown'
    restrooms:         'yes'|'no'|'unknown'
    rest_areas:        'yes'|'no'|'unknown'
    photogenic_rating: 'low'|'medium'|'high'|'unknown'
  }
}
```

**Se `attraction_id` não é null:** o ponto está vinculado a um POI do banco Tuggi.
Usar o `attraction_id` para buscar detalhes, áudios e trigger points via as APIs existentes.

---

## 5. Tipos e enums

```typescript
type ScenicProfile    = 'panoramic'|'historical'|'nature'|'urban'|'rural'
type Drivability      = 'easy'|'moderate'|'demanding'|'unknown'
type Accessibility    = 'accessible'|'partial'|'not_accessible'|'unknown'
type BestTime         = 'morning'|'afternoon'|'sunset'|'night'
type RoadCondition    = 'paved'|'dirt'|'steep'|'curves'
type PhotogenicRating = 'low'|'medium'|'high'|'unknown'
type TranslationStatus = 'pending'|'generating'|'ready'|'failed'

// ⚠️ IMPORTANTE: drivability === 'unknown' = rota de caminhada/ferry/transporte público
// (ex: todas as rotas de NYC). Não mostrar UI de "modo de condução" para essas rotas.
```

### Mapeamento `drivability` → UI

| Valor | Significado | Ação no App |
|-------|-------------|-------------|
| `'easy'` | Rota de carro simples | Abrir Google Maps em modo carro |
| `'moderate'` | Rota de carro com curvas/estradas secundárias | Abrir Google Maps modo carro + aviso |
| `'demanding'` | Rota exigente (serrana, terra, etc.) | Abrir Google Maps modo carro + aviso forte |
| `'unknown'` | Caminhada / ferry / metro | Abrir Google Maps em modo **pedestre** ou deixar o utilizador escolher |

---

## 6. Sistema de tradução

### 6.1 Como funciona

As traduções ficam em `core.custom_route_descriptions`:

```sql
(route_id, language, gender) → { name, description, audio_url, status }
```

Os RPCs fazem LEFT JOIN e retornam os campos `translated_*` directamente.

### 6.2 Idiomas suportados

| Código | Idioma | Padrão de fallback |
|--------|--------|--------------------|
| `pt-br` | Português (Brasil) | idioma base das rotas BR |
| `pt-pt` | Português (Portugal) | idioma base das rotas PT |
| `en-us` | English (US) | **fallback padrão global** |
| `en-gb` | English (UK) | — |
| `es-es` | Español | — |
| `fr-fr` | Français | — |
| `de-de` | Deutsch | — |
| `it-it` | Italiano | — |
| `ja-jp` | 日本語 | — |

### 6.3 Lógica de exibição

```typescript
// Sempre use fallback para o original se tradução não disponível
const displayName        = route.translated_name        ?? route.name
const displayDescription = route.translated_description ?? route.description
const hasAudio           = route.description_audio_url !== null
```

### 6.4 Trigger de tradução (fire-and-forget)

Quando `translated_name === null` e o utilizador abre uma rota:

```typescript
const triggerTranslationIfNeeded = async (
  routeId:  string,
  language: string,
  gender:   string = 'male'
) => {
  // Não traduzir se idioma = idioma base da rota (já está em pt-br)
  // Verificar content_language nos metadata da rota
  if (language === route.metadata?.content_language) return
  if (route.translation_status === 'generating') return

  // Fire and forget — não bloquear UI
  supabase.functions.invoke('generate-translated-audio', {
    body: { routeId, targetLanguage: language, voiceGender: gender, generateAudio: true }
  }).catch(console.warn)
}
```

> **Auth:** a EF precisa de um **JWT válido**. Usar o access_token da sessão do utilizador autenticado.  
> Não usar a service key — o formato `sb_secret_...` não é aceito pela EF.

```typescript
// ✅ Correto — JWT do utilizador autenticado
const { data: { session } } = await supabase.auth.getSession()
await supabase.functions.invoke('generate-translated-audio', {
  headers: { Authorization: `Bearer ${session.access_token}` },
  body: { routeId, targetLanguage: language, voiceGender: gender }
})
```

### 6.5 Estados e UI

| `translation_status` | O que mostrar |
|---------------------|---------------|
| `'ready'` | Texto traduzido + botão de áudio (se `audio_url !== null`) |
| `'generating'` | Skeleton loader na descrição |
| `'failed'` | Texto original + botão "Tentar gerar tradução" (opcional) |
| `null` | Texto original + trigger de tradução em background |

### 6.6 Polling após trigger

```typescript
// Opção simples: polling a cada 3s por até 30s
const waitForTranslation = async (routeId: string, language: string, gender: string) => {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const { data } = await supabase.schema('core').rpc('get_custom_route_by_id', {
      p_route_id: routeId, p_user_language: language, p_voice_gender: gender
    })
    if (data?.[0]?.translation_status === 'ready') return data[0]
  }
  return null // timeout após 30s
}
```

---

## 7. Áudio da descrição

Narração de **15-25 segundos** introduzindo a rota. Gerado pelo Google Cloud TTS.

**Path no Storage:** `travel-app-audios/route-audios/{routeId}/{routeId}-{language}-{gender}.mp3`

**UI:**
- Botão de play **só aparece** quando `description_audio_url !== null`
- Usar o `audioCacheService` existente (mesmo padrão dos POIs)
- **Não reproduzir automaticamente** — acção do utilizador

```typescript
const playRouteDescription = async (audioUrl: string, routeId: string, language: string) => {
  const cacheKey = `route-desc-${routeId}-${language}`
  const localPath = await audioCacheService.downloadAndCache(audioUrl, cacheKey)
  await AudioPlayer.play(localPath)
}
```

---

## 8. Tipos TypeScript — copiar para o app

```typescript
// src/modules/customRoutes/types/CustomRouteTypes.ts

export type ScenicProfile    = 'panoramic'|'historical'|'nature'|'urban'|'rural'
export type Drivability      = 'easy'|'moderate'|'demanding'|'unknown'
export type Accessibility    = 'accessible'|'partial'|'not_accessible'|'unknown'
export type BestTime         = 'morning'|'afternoon'|'sunset'|'night'
export type RoadCondition    = 'paved'|'dirt'|'steep'|'curves'
export type PhotogenicRating = 'low'|'medium'|'high'|'unknown'
export type TranslationStatus = 'pending'|'generating'|'ready'|'failed'

export interface RouteWaypointMetadata {
  name?:              string | null
  attraction_id?:     string | null
  is_generic?:        boolean
  wheelchair_access?: 'yes'|'partial'|'no'|'unknown'
  parking?:           'yes'|'no'|'unknown'
  restrooms?:         'yes'|'no'|'unknown'
  rest_areas?:        'yes'|'no'|'unknown'
  photogenic_rating?: 'low'|'medium'|'high'|'unknown'
}

export interface RouteWaypoint {
  id:       string
  lat:      number
  lng:      number
  metadata: RouteWaypointMetadata
}

export interface RouteMetadata {
  distance?:         number   // metros
  duration?:         number   // segundos
  source?:           'osrm'|'manual'
  content_language?: string   // idioma original do conteúdo base
}

export interface CustomRoute {
  id:          string
  name:        string
  description: string | null
  country:     string | null   // ex: 'Portugal', 'United States', 'Brazil'
  region:      string | null   // ex: 'Lisboa', 'New York', 'Orlando'
  is_active:   boolean

  // Geometria
  geometry_coords: Array<{ lat: number; lng: number }>
  waypoints:       RouteWaypoint[]
  stops_count:     number
  metadata:        RouteMetadata

  // Características
  scenic_profile:    ScenicProfile[]
  drivability:       Drivability
  accessibility:     Accessibility
  best_time:         BestTime[]
  road_conditions:   RoadCondition[]
  photogenic_rating: PhotogenicRating

  // Tradução
  translated_name:        string | null
  translated_description: string | null
  description_audio_url:  string | null
  translation_status:     TranslationStatus | null

  // Meta
  usage_count: number
}
```

---

## 9. Mapeamento RPC → tipo

```typescript
// src/modules/customRoutes/services/CustomRouteService.ts

const mapRPCRowToRoute = (row: any): CustomRoute => ({
  id:          row.id,
  name:        row.name,
  description: row.description,
  country:     row.country     ?? null,
  region:      row.region      ?? null,
  is_active:   row.is_active   ?? true,

  geometry_coords: row.geometry_json?.coordinates?.map(([lng, lat]: [number, number]) =>
    ({ lat, lng })) ?? [],
  waypoints:   row.waypoints   ?? [],
  stops_count: row.stops_count ?? 0,
  metadata:    row.route_metadata ?? {},

  scenic_profile:    row.scenic_profile    ?? [],
  drivability:       row.drivability       ?? 'unknown',
  accessibility:     row.accessibility     ?? 'unknown',
  best_time:         row.best_time         ?? [],
  road_conditions:   row.road_conditions   ?? [],
  photogenic_rating: row.photogenic_rating ?? 'unknown',

  // Tradução — campos novos
  translated_name:        row.translated_name        ?? null,
  translated_description: row.translated_description ?? null,
  description_audio_url:  row.description_audio_url  ?? null,
  translation_status:     row.translation_status      ?? null,

  usage_count: row.usage_count ?? 0,
})
```

---

## 10. Filtros no RPC (sugerido para futura implementação)

Os RPCs actuais retornam todas as rotas dentro do raio. Para filtrar no app:

```typescript
// Filtros client-side (enquanto RPCs não têm parâmetros de filtro)
const filteredRoutes = routes.filter(r => {
  if (filters.country    && r.country    !== filters.country)    return false
  if (filters.drivability && r.drivability !== filters.drivability) return false
  if (filters.scenic && !r.scenic_profile.some(s => filters.scenic.includes(s))) return false
  return true
})
```

---

## 11. SQLite cache — colunas a adicionar

```sql
ALTER TABLE custom_routes_cache
  ADD COLUMN IF NOT EXISTS country                TEXT,
  ADD COLUMN IF NOT EXISTS region                 TEXT,
  ADD COLUMN IF NOT EXISTS translated_name        TEXT,
  ADD COLUMN IF NOT EXISTS translated_description TEXT,
  ADD COLUMN IF NOT EXISTS description_audio_url  TEXT,
  ADD COLUMN IF NOT EXISTS translation_status     TEXT,
  ADD COLUMN IF NOT EXISTS translation_language   TEXT,
  ADD COLUMN IF NOT EXISTS translation_gender     TEXT,
  ADD COLUMN IF NOT EXISTS content_language       TEXT;
```

---

## 12. Fluxo de UI completo

```
Utilizador abre lista de rotas
│
├── RPC get_nearby_custom_routes (com p_user_language)
│   └── retorna rotas com translated_* preenchidos (se disponível)
│
├── Listar rotas:
│   - Mostrar displayName = translated_name ?? name
│   - Mostrar country/region como subtítulo (ex: "Lisboa · Portugal")
│   - Badge dificuldade (se drivability !== 'unknown')
│   - Ícone caminhada (se drivability === 'unknown')
│
└── Utilizador selecciona uma rota
    │
    ├── Abrir RouteExplorerSheet
    │
    ├── Mostrar:
    │   - displayName + displayDescription com fallback
    │   - Botão de áudio (se description_audio_url !== null)
    │   - Skeleton na descrição (se translation_status === 'generating')
    │   - Waypoints com nomes (metadata.name)
    │
    ├── Se translation_status === null e idioma ≠ content_language:
    │   └── Trigger EF em background + polling
    │
    └── Botão "Iniciar Rota"
        ├── drivability !== 'unknown' → Google Maps modo carro com waypoints
        └── drivability === 'unknown' → Google Maps modo pedestre com waypoints
```

---

## 13. Checklist de implementação

### Prioridade 1 — Tipos e mapeamento
```
[ ] Adicionar tipos RouteWaypoint, RouteWaypointMetadata, CustomRoute (§8)
[ ] Atualizar mapRPCRowToRoute para mapear todos os novos campos (§9)
[ ] Atualizar RPCs para passar p_user_language e p_voice_gender (§3)
```

### Prioridade 2 — UI básica
```
[ ] RouteExplorerSheet: usar displayName e displayDescription com fallback
[ ] RouteExplorerSheet: mostrar country/region (ex: "Lisboa · Portugal")
[ ] RouteExplorerSheet: distinguir rota de carro vs caminhada (§5)
[ ] RouteExplorerSheet: botão "Iniciar Rota" → Google Maps no modo correcto
```

### Prioridade 3 — Tradução
```
[ ] Trigger triggerTranslationIfNeeded ao abrir RouteExplorerSheet
[ ] Skeleton loading quando translation_status === 'generating'
[ ] Polling após trigger (§6.6)
[ ] Botão de áudio quando description_audio_url !== null
```

### Prioridade 4 — Cache
```
[ ] SQLite: adicionar colunas (§11)
[ ] Guardar country, region, translated_* no cache
[ ] Verificar cache antes de trigger de tradução
```

### Prioridade 5 — Filtros (lista de rotas)
```
[ ] Filtro por country/region
[ ] Filtro por drivability (carro vs caminhada)
[ ] Filtro por scenic_profile
```

---

## 14. Teste end-to-end

```bash
# 1. Verificar rotas disponíveis no banco
# Rota "Grand Tour de Lisboa" (pt-br original)
SELECT id, name, country, region, stops_count
FROM core.custom_routes
WHERE name ILIKE '%Grand Tour%' AND is_active = true;

# 2. Chamar EF para gerar tradução
curl -X POST https://tysnkzmljlmmqpbotkxv.supabase.co/functions/v1/generate-translated-audio \
  -H "Authorization: Bearer {USER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{
    "routeId": "a2cc3567-0a18-41e5-97a5-4c7b69d4abe7",
    "targetLanguage": "en-us",
    "voiceGender": "male",
    "generateAudio": true
  }'

# 3. Verificar tradução no banco
SELECT language, gender, status, LEFT(name, 50) AS translated_name,
       audio_url IS NOT NULL AS has_audio
FROM core.custom_route_descriptions
WHERE route_id = 'a2cc3567-0a18-41e5-97a5-4c7b69d4abe7';

# 4. Chamar RPC como faria o app
SELECT id, name, translated_name, translated_description,
       description_audio_url IS NOT NULL AS has_audio,
       translation_status, country, region
FROM core.get_custom_route_by_id(
  'a2cc3567-0a18-41e5-97a5-4c7b69d4abe7',
  'en-us',
  'male'
);
```

---

## 15. Rotas disponíveis no banco (por região)

### Portugal — Lisboa
| Rota | Tipo | Km | Stops |
|------|------|----|-------|
| Descubra Lisboa Histórica | 🚗 Carro | 6.5km | 6 |
| Grand Tour de Lisboa — De Oriente a Belém | 🚗 Carro | 43km | 20 |
| Elétrico 28 — Pelos Morros de Lisboa | 🚗 Carro | 15km | 15 |
| Sintra — Palácios, Castelos e Mistério | 🚗 Carro | 90km | 10 |
| Outro Lado do Tejo — Cristo Rei e Almada | 🚗 Carro | 41km | 8 |

### United States — Orlando
| Rota | Tipo | Km | Stops |
|------|------|----|-------|
| I-Drive Shopping — Outlets e Lojas | 🚗 Carro | 82km | 12 |
| Disney Sem Ingressos — Um Dia Inteiro | 🚗 Carro | 60km | 14 |
| Orlando até a NASA — A Rota do Espaço | 🚗 Carro | 310km | 13 |

### United States — Atlanta
| Rota | Tipo | Km | Stops |
|------|------|----|-------|
| Atlanta Clássica — Olimpíadas, Coca-Cola | 🚗 Carro | 36km | 14 |
| Stone Mountain & Parques | 🚗 Carro | 164km | 14 |
| Kennesaw & Marietta — Guerra Civil | 🚗 Carro | 86km | 12 |

### United States — New York
| Rota | Tipo | Km | Stops |
|------|------|----|-------|
| East River Ferry — E90th St a Pier 11 | 🚶 Ferry+Walk | 40km | 10 |
| Friends (com episódios!) | 🚶 Caminhada | 18km | 10 |
| NY no Cinema — Ghostbusters, Vingadores, Madagascar | 🚶 Caminhada | 30km | 12 |
| Wall Street, o Touro e o 11 de Setembro | 🚶 Caminhada | 25km | 12 |
| Estátua da Liberdade, Ellis Island + Jersey | ⛴️ Ferry | 42km | 9 |
| Central Park — Sul ao Norte | 🚶 Caminhada | 13km | 12 |
| Brooklyn e Queens | 🚶 Metrô+Walk | 27km | 10 |
| Midtown Icons — Hop-On Hop-Off | 🚶 Caminhada | 18km | 12 |

### Brazil — Rio de Janeiro
| Rota | Tipo | Km | Stops |
|------|------|----|-------|
| Barra da Tijuca — Web Summit | 🚗 Carro | 112km | 12 |
| As Maravilhas Cariocas em Um Dia | 🚗 Carro | 81km | 14 |
| Rota das Praias — Botafogo a Grumari | 🚗 Carro | 99km | 13 |
| Rio Boêmio — Samba, Lapa, Santa Teresa | 🚗 Carro | 42km | 12 |

### Brazil — São Paulo
| Rota | Tipo | Km | Stops |
|------|------|----|-------|
| Avenida Paulista e Arredores | 🚗 Carro | 52km | 14 |
| São Paulo para Crianças | 🚗 Carro | 99km | 12 |
| São Paulo à Noite | 🚗 Carro | 30km | 12 |
| São Paulo Esportiva — Estádios | 🚗 Carro | 201km | 10 |

---

## 16. Mudanças no backend desde a versão anterior

| Data | Mudança |
|------|---------|
| 2026-05-21 | Criada tabela `core.custom_route_descriptions` |
| 2026-05-21 | EF `generate-translated-audio` estendida com route mode |
| 2026-05-21 | RPCs `get_nearby_custom_routes` e `get_custom_route_by_id` actualizados |
| 2026-05-22 | Colunas `country` e `region` adicionadas a `custom_routes` |
| 2026-05-22 | Campo `content_language` guardado em `metadata.content_language` |
| 2026-05-22 | 25 rotas criadas (5 PT, 3 Orlando, 3 Atlanta, 8 NY, 4 RJ, 4 SP) |
