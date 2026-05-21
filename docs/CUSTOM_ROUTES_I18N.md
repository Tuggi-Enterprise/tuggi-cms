# Custom Routes — Sistema de Tradução i18n

**Para o time do app (tuggi-drive-v2)**  
**Data:** 2026-05-21  
**Status:** Backend completo, aguardando implementação no app

---

## 1. Propósito

As rotas customizadas (`custom_routes`) tinham `name` e `description` apenas em pt-BR.
Um usuário americano, francês ou alemão que abre a rota *"Grand Tour de Lisboa — De Oriente a Belém"*
não entende nada.

Este sistema adiciona tradução **lazy (on-demand)** para nome, descrição e áudio das rotas —
o mesmo princípio que já funciona para POIs via `attraction_descriptions`.

**Conceito central:** a tradução só é gerada quando o usuário precisar.
Se já existe → servida instantaneamente.
Se não existe → o app dispara a geração em background e mostra loading.

---

## 2. O que foi criado no backend

### 2.1 Nova tabela `core.custom_route_descriptions`

```sql
id           UUID PRIMARY KEY
route_id     UUID  → FK core.custom_routes(id) ON DELETE CASCADE
language     VARCHAR(10)   -- 'en-us' | 'fr-fr' | 'de-de' etc.
gender       VARCHAR(10)   -- 'male' | 'female'
name         VARCHAR(500)  -- nome da rota traduzido
description  TEXT          -- descrição traduzida
audio_url    TEXT          -- URL do áudio TTS (nullable = ainda não gerado)
status       TEXT          -- 'pending' | 'generating' | 'ready' | 'failed'
manually_edited     BOOLEAN
manually_edited_at  TIMESTAMPTZ
created_at   TIMESTAMPTZ
updated_at   TIMESTAMPTZ

UNIQUE (route_id, language, gender)  -- mesmo padrão de attraction_descriptions
```

**Índices relevantes:**
- `idx_route_descriptions_ready` — partial index `WHERE status = 'ready'` (hot path do RPC)
- `idx_route_descriptions_in_progress` — `WHERE status IN ('generating', 'failed')`

### 2.2 Edge Function `generate-translated-audio` — Route Mode

A EF existente foi **estendida** (não criada nova) com um `routeId` path.

**Invocação:**
```typescript
await supabase.functions.invoke('generate-translated-audio', {
  body: {
    routeId:       '3f8a2d1c-...',   // UUID da rota
    targetLanguage: 'en-us',         // idioma alvo
    voiceGender:   'male',           // 'male' | 'female'
    generateAudio: true,             // false = só texto, sem TTS (default: true)
  }
})
```

**O que a EF faz:**
1. Busca `name` + `description` originais em `custom_routes`
2. Traduz ambos em paralelo via Gemini (`translateWithGemini`)
3. Gera áudio TTS da descrição via Google Cloud TTS (`generateAudioWithTTS`)
4. Faz upload para `travel-app-audios/route-audios/{routeId}/{routeId}-{language}-{gender}.mp3`
5. Upsert em `custom_route_descriptions` com `status = 'ready'`

**Otimistic lock:** enquanto processa, `status = 'generating'`. Em caso de falha, `status = 'failed'`.

**Retorno:**
```typescript
{
  success: true,
  data: {
    name:        "Grand Tour of Lisbon — From East to West",
    description: "A single driving route covering the best of Lisbon...",
    audioUrl:    "https://...supabase.co/storage/v1/.../route-audios/..."
  }
}
```

**Nota:** a EF usa `service role` e portanto **não precisa de autenticação especial** quando chamada do app com a anon key e via RPC pattern — mas precisa de um JWT válido conforme `auth-middleware.ts`.

### 2.3 RPCs atualizados

Ambas as RPCs recebem dois novos parâmetros (com defaults para backward compatibility):

```sql
-- get_nearby_custom_routes
p_user_language TEXT DEFAULT 'en-us'
p_voice_gender  TEXT DEFAULT 'male'

-- get_custom_route_by_id
p_user_language TEXT DEFAULT 'en-us'
p_voice_gender  TEXT DEFAULT 'male'
```

**Novos campos no retorno:**
```
translated_name         VARCHAR(500)  -- NULL se não existe para o idioma solicitado
translated_description  TEXT          -- NULL se não existe
description_audio_url   TEXT          -- NULL se áudio ainda não gerado
translation_status      TEXT          -- 'pending'|'generating'|'ready'|'failed'|NULL
```

**Comportamento:** se não existe tradução para `(language, gender)`, os campos `translated_*` são `NULL`.
O app usa os originais como fallback.

---

## 3. Contrato completo do RPC

### `core.get_nearby_custom_routes`

```typescript
const { data } = await supabase
  .schema('core')
  .rpc('get_nearby_custom_routes', {
    user_lat:        latitude,
    user_lng:        longitude,
    radius_km:       2,
    p_user_language: currentLanguage,   // ex: 'en-us'
    p_voice_gender:  currentGender,     // ex: 'male'
  })
```

### `core.get_custom_route_by_id`

```typescript
const { data } = await supabase
  .schema('core')
  .rpc('get_custom_route_by_id', {
    p_route_id:      routeId,
    p_user_language: currentLanguage,
    p_voice_gender:  currentGender,
  })
```

### Shape completo do retorno (por rota)

```typescript
interface RouteRPCRow {
  id:                     string
  name:                   string          // original pt-BR
  description:            string | null   // original pt-BR
  translated_name:        string | null   // traduzido, ou null se não disponível
  translated_description: string | null   // traduzido, ou null se não disponível
  description_audio_url:  string | null   // URL TTS, ou null
  translation_status:     'pending' | 'generating' | 'ready' | 'failed' | null
  geometry_json:          object
  waypoints:              object[]
  route_metadata:         object
  stops_count:            number
  accessibility:          string
  drivability:            string
  scenic_profile:         string[]
  best_time:              string[]
  road_conditions:        string[]
  photogenic_rating:      string
  resources:              object
  usage_count:            number
}
```

---

## 4. Idiomas suportados

O sistema herda os mesmos idiomas da EF de POIs:

| Código | Idioma |
|---|---|
| `pt-br` | Português (Brasil) |
| `pt-pt` | Português (Portugal) |
| `en-us` | Inglês (EUA) — **default de fallback** |
| `en-gb` | Inglês (Reino Unido) |
| `es-es` | Espanhol (Espanha) |
| `es-us` | Espanhol (EUA/Latino) |
| `de-de` | Alemão |
| `fr-fr` | Francês |
| `it-it` | Italiano |
| `ja-jp` | Japonês |
| `cmn-cn` | Chinês (Mandarim) |
| `ko-kr` | Coreano |
| `ru-ru` | Russo |

---

## 5. Implementação no App — Guia passo a passo

### 5.1 Atualizar `CustomRouteTypes.ts`

```typescript
// src/modules/customRoutes/types/CustomRouteTypes.ts

interface CustomRoute {
  id: string
  name: string
  description: string | null

  // ─── Novos campos de tradução ────────────────────────────────
  translatedName:        string | null
  translatedDescription: string | null
  descriptionAudioUrl:   string | null
  translationStatus:     'pending' | 'generating' | 'ready' | 'failed' | null
  // ─────────────────────────────────────────────────────────────

  geometryCoords:   LatLng[]
  waypoints:        CustomRouteWaypoint[]
  stopsCount:       number
  usageCount:       number
  distanceMeters:   number
  durationSeconds:  number
  metadata:         CustomRouteMetadata
}
```

### 5.2 Atualizar `CustomRouteService.ts`

**Ao fazer fetch das rotas próximas:**
```typescript
// src/modules/customRoutes/services/CustomRouteService.ts

const { data, error } = await supabase
  .schema('core')
  .rpc('get_nearby_custom_routes', {
    user_lat:        latitude,
    user_lng:        longitude,
    radius_km:       radiusKm,
    p_user_language: currentLanguage,  // de TTSLanguageContext
    p_voice_gender:  currentGender,    // de TTSLanguageContext
  })
```

**No mapeamento DB → tipo app**, adicionar os novos campos:
```typescript
const mapRPCRowToRoute = (row: RouteRPCRow): CustomRoute => ({
  // ... campos existentes ...
  translatedName:        row.translated_name        ?? null,
  translatedDescription: row.translated_description ?? null,
  descriptionAudioUrl:   row.description_audio_url  ?? null,
  translationStatus:     row.translation_status      ?? null,
})
```

**Trigger de tradução** — chamar a EF quando o idioma não está disponível:
```typescript
const triggerTranslationIfNeeded = async (
  route: CustomRoute,
  language: string,
  gender: string
) => {
  // Só disparar se: não tem tradução E não está gerando E idioma não é pt-br (original)
  if (
    route.translatedName === null &&
    route.translationStatus !== 'generating' &&
    language !== 'pt-br'
  ) {
    // Fire-and-forget — não bloquear a UI
    supabase.functions.invoke('generate-translated-audio', {
      body: {
        routeId:        route.id,
        targetLanguage: language,
        voiceGender:    gender,
        generateAudio:  true,
      }
    }).catch(console.warn)
  }
}
```

### 5.3 Atualizar `RouteExplorerSheet.tsx`

```typescript
// src/modules/customRoutes/components/RouteExplorerSheet.tsx

// 1. Usar tradução quando disponível, fallback para original
const displayName        = route.translatedName        || route.name
const displayDescription = route.translatedDescription || route.description

// 2. Disparar tradução ao abrir o sheet
useEffect(() => {
  triggerTranslationIfNeeded(route, currentLanguage, currentGender)
}, [route.id])

// 3. Loading state enquanto gera
const isGenerating = route.translationStatus === 'generating'
const hasTranslation = route.translationStatus === 'ready'
```

**UI de loading** (skeleton na descrição):
```tsx
{/* Nome da rota */}
<Text style={styles.routeName}>{displayName}</Text>

{/* Descrição com loading state */}
{isGenerating && !route.translatedDescription ? (
  <SkeletonLoader lines={2} />  // componente existente do projeto
) : (
  <Text style={styles.description}>{displayDescription}</Text>
)}

{/* Botão de áudio — só aparece quando disponível */}
{route.descriptionAudioUrl && (
  <TouchableOpacity onPress={() => playRouteDescription(route.descriptionAudioUrl!)}>
    <Icon name="play-circle" />
    <Text>Ouvir descrição</Text>
  </TouchableOpacity>
)}
```

### 5.4 Atualizar SQLite cache

```sql
-- Adicionar à tabela custom_routes_cache
ALTER TABLE custom_routes_cache
  ADD COLUMN IF NOT EXISTS translated_name        TEXT,
  ADD COLUMN IF NOT EXISTS translated_description TEXT,
  ADD COLUMN IF NOT EXISTS description_audio_url  TEXT,
  ADD COLUMN IF NOT EXISTS translation_status     TEXT,
  ADD COLUMN IF NOT EXISTS translation_language   TEXT,
  ADD COLUMN IF NOT EXISTS translation_gender     TEXT;
```

No `CustomRouteService.ts`, salvar e recuperar os campos de tradução no cache SQLite junto com os demais dados da rota.

---

## 6. Fluxo completo — diagrama

```
Usuário abre RouteExplorerSheet
          │
          ▼
  RPC retorna route com
  translated_* fields
          │
   ┌──────┴────────────┐
   │ translated_name   │
   │ não é null?       │
   └──────┬────────────┘
          │
     ┌────┴────┐
     │   SIM   │ → Exibir tradução imediatamente ✓
     └─────────┘

     ┌────┴────┐
     │   NÃO   │
     └────┬────┘
          │
          ▼
  translation_status === 'generating'?
          │
     ┌────┴────┐
     │   SIM   │ → Mostrar skeleton loading
     │         │   Polling a cada 3s (ou Realtime subscription)
     └─────────┘

     ┌────┴────┐
     │   NÃO   │
     └────┬────┘
          │
          ▼
  Invocar EF (fire-and-forget)
  generate-translated-audio
  { routeId, targetLanguage, voiceGender }
          │
          ▼
  Mostrar skeleton loading
  (EF leva ~3-8s para traduzir + TTS)
          │
          ▼
  Re-fetch da rota após ~8s
  (ou usar Supabase Realtime no status)
          │
          ▼
  Exibir tradução + botão de áudio ✓
```

---

## 7. Áudio da descrição da rota

O áudio é uma narração de **15-25 segundos** apresentando a rota.
Exemplo do que o TTS gera para "Grand Tour of Lisbon — From East to West" em inglês:

> *"Welcome to the Grand Tour of Lisbon. Over the next 43 kilometers, you'll journey
> from the modern Parque das Nações, through historic Alfama and the Castle of São Jorge,
> down to the riverside Praça do Comércio, and all the way to the Age of Discoveries
> monuments in Belém. Enjoy the ride."*

**Reprodução:**
- Usar o `audioCacheService` existente para baixar e cachear localmente
- Reproduzir quando o usuário toca no botão "Ouvir descrição" no `RouteExplorerSheet`
- **Não** reproduzir automaticamente — é uma ação do usuário

**Cache de áudio local:**
```typescript
// Usar o padrão existente de audioCacheService
const localPath = await audioCacheService.downloadAndCache(
  route.descriptionAudioUrl,
  `route-desc-${route.id}-${language}-${gender}`
)
await AudioPlayer.play(localPath)
```

---

## 8. Considerações de performance

- **Não bloquear a UI** — o trigger da EF é sempre fire-and-forget
- **Cache SQLite** — guardar traduções localmente para não re-buscar
- **pt-BR não precisa de tradução** — se `currentLanguage === 'pt-br'`, não invocar a EF
- **Polling vs Realtime** — para atualização do status após trigger:
  - Opção simples: polling a cada 3s por 30s (máximo 10 tentativas)
  - Opção ideal: Supabase Realtime subscription em `custom_route_descriptions` filtrado por `route_id`

```typescript
// Exemplo de polling simples
const waitForTranslation = async (routeId: string, language: string, gender: string) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 3000)) // aguarda 3s
    const { data } = await supabase
      .schema('core')
      .rpc('get_custom_route_by_id', {
        p_route_id:      routeId,
        p_user_language: language,
        p_voice_gender:  gender,
      })
    if (data?.[0]?.translation_status === 'ready') {
      return data[0] // tradução pronta, atualizar state
    }
  }
}
```

---

## 9. Checklist de implementação

```
[ ] CustomRouteTypes.ts — adicionar translatedName, translatedDescription,
                          descriptionAudioUrl, translationStatus

[ ] CustomRouteService.ts — passar p_user_language e p_voice_gender no RPC
[ ] CustomRouteService.ts — mapear translated_* do retorno do RPC
[ ] CustomRouteService.ts — implementar triggerTranslationIfNeeded()
[ ] CustomRouteService.ts — salvar campos de tradução no cache SQLite

[ ] RouteExplorerSheet.tsx — usar displayName e displayDescription com fallback
[ ] RouteExplorerSheet.tsx — mostrar skeleton quando status === 'generating'
[ ] RouteExplorerSheet.tsx — botão de áudio quando descriptionAudioUrl !== null
[ ] RouteExplorerSheet.tsx — chamar triggerTranslationIfNeeded() no useEffect

[ ] SQLite schema — adicionar colunas de tradução em custom_routes_cache

[ ] Testar — abrir rota com device em en-US, verificar que tradução é disparada
[ ] Testar — segunda abertura deve ser instantânea (cache hit)
[ ] Testar — botão de áudio aparece após tradução completar
```

---

## 10. Teste end-to-end

Para verificar que o backend está funcionando antes de implementar o app:

```bash
# 1. Chamar a EF manualmente (substituir UUIDs reais)
curl -X POST https://tysnkzmljlmmqpbotkxv.supabase.co/functions/v1/generate-translated-audio \
  -H "Authorization: Bearer [SUPABASE_ANON_KEY]" \
  -H "Content-Type: application/json" \
  -d '{
    "routeId": "a2cc3567-0a18-41e5-97a5-4c7b69d4abe7",
    "targetLanguage": "en-us",
    "voiceGender": "male",
    "generateAudio": true
  }'

# Retorno esperado:
# { "success": true, "data": { "name": "...", "description": "...", "audioUrl": "..." } }

# 2. Verificar no banco
SELECT language, gender, status, LEFT(name, 50), audio_url IS NOT NULL AS has_audio
FROM core.custom_route_descriptions
WHERE route_id = 'a2cc3567-0a18-41e5-97a5-4c7b69d4abe7';

# 3. Chamar RPC com idioma
SELECT id, name, translated_name, translation_status, description_audio_url IS NOT NULL
FROM core.get_custom_route_by_id(
  'a2cc3567-0a18-41e5-97a5-4c7b69d4abe7',
  'en-us',
  'male'
);
```

O `routeId` acima é a rota "Grand Tour de Lisboa — De Oriente a Belém" já existente no banco.

---

## 11. Arquivos modificados no backend (para referência)

| Arquivo | Tipo | O que mudou |
|---|---|---|
| `supabase/migrations/20260521_create_route_descriptions.sql` | Migration | Nova tabela `core.custom_route_descriptions` |
| `supabase/migrations/20260521_add_gender_to_route_descriptions.sql` | Migration | Adicionou coluna `gender` + unique constraint |
| `supabase/migrations/20260521_update_route_rpcs_with_translations.sql` | Migration | RPCs com `p_user_language`, `p_voice_gender`, LEFT JOIN |
| `supabase/migrations/20260521_route_descriptions_perf_security.sql` | Migration | Indexes parciais + RLS policies |
| `supabase/functions/generate-translated-audio/index.ts` | Edge Function | Route mode adicionado (`routeId` path) |
| `supabase/functions/_shared/validation-schemas.ts` | Shared | `GenerateTranslatedAudioSchema` aceita `routeId` |
