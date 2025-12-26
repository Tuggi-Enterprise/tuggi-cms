### API Quick Reference: Contextual Audio

**Endpoint:** `POST .../functions/v1/generate-contextual-narration`

#### 1. Trigger "Intro" (400m / Contextual Bridge)
Call this when the user hits the outer radius (e.g. 400m).

**Body:**
```json
{
  "action": "generate_intro",
  "poi_id": "UUID_DO_POI_ATUAL",
  "language": "pt-br",
  "bearing": 180.5,
  "poi_type": "tug", // "tug" | "client" | "ad"
  "travel_mode": "drive",
  "last_poi_id": "UUID_DO_ULTIMO_POI",
  "last_visit_timestamp": "2023-10-27T10:00:00Z",
  "next_poi_id": "UUID_DO_PROXIMO_POI_PROVAVEL" // Opcional
}
```
**Response:** `{ "intro_audio_url": "...", "intro_text": "..." }`

---

#### 2. Trigger "Content" (Arrival / Main Description)
Call this when the user gets closer or after the Intro finishes.

**Body:**
```json
{
  "action": "generate_content",
  "poi_id": "UUID_DO_POI_ATUAL",
  "language": "pt-br"
}
```
**Response:** `{ "content_audio_url": "...", "content_text": "..." }`

---

### 3. JIT Native Audio (The "Race" Strategy)
**Endpoint:** `POST .../functions/v1/generate-native-narration`

Use this for Just-in-Time generation at the Trigger Point (~20m).

**Body:**
```json
{
  "poi_id": "UUID_DO_POI",
  "language": "pt-br",
  "travel_mode": "drive",
  "user_context": {
    "heading": 90,
    "bearing": 180.5,
    "previous_poi_id": "UUID_POI_ANTERIOR",
    "next_poi_id": "UUID_PROXIMO_POI",
    "next_poi_bearing": 270.0,
    "last_visit_timestamp": "2023-10-27T10:00:00Z",
    "current_location": { "lat": -23.5505, "lng": -46.6333 },
    "last_poi_location": { "lat": -23.5510, "lng": -46.6340 },
    "next_poi_location": { "lat": -23.5600, "lng": -46.6400 }
  },
  "voice_name": "charon" // Optional: puck, charon, kore, fenrir
}
```

### Response

O endpoint é otimizado para **latência mínima** e suporta dois modos de resposta:

#### 1. Cache Hit (JSON)
Se o áudio já estiver no cache JIT ou for o áudio Master (sem contexto), retorna JSON padrão.
```json
{
  "success": true,
  "data": {
    "audio_url": "https://...",
    "text_content": "A sua direita...",
    "meta": { "cache": "hit", "type": "jit" }
  }
}
```

#### 2. Cache Miss / Streaming (Audio Body)
Para minimizar a latência, se o backend precisar gerar áudio novo, ele retorna o **corpo da resposta como um stream de bytes** (`audio/mpeg`). Os metadados são enviados via **Custom Headers**:

- `X-Narration-Status`: miss
- `X-Narration-Type`: jit | master
- `X-Narration-Text`: [Base64 Encoded UTF-8 Text] (O transcript gerado)
- `X-Gemini-Latency`: Tempo de geração em ms.

**Nota para o App:** Se o `Content-Type` for `audio/mpeg`, o app deve tocar o corpo da resposta diretamente e decodificar o header `X-Narration-Text` para o transcript.

#### 3. Fallback Automático (JSON)
Caso ocorra qualquer erro na geração JIT, o backend tentará retornar o conteúdo Master como fallback para garantir que o usuário não fique sem áudio.
```json
{
  "success": true,
  "data": {
    "audio_url": "https://ur_master",
    "text_content": "...",
    "meta": { "fallback": true }
  }
}
```

#### Cache Key Hashing (Client-Side Guidance)
To ensure the client can check for a local or remote cache hit before calling the generation, the hash must follow this exact format:

**Algorithm:** SHA-256
**Input String Pattern:**
`${poi_id}:${language}:${travel_mode}:${direction_bucket}:${previous_poi_id || 'none'}:${next_poi_id || 'none'}`

**Components:**
- `poi_id`: UUID of the POI.
- `language`: lowercase (e.g., `pt-br`).
- `travel_mode`: `drive` or `walk`.
- `direction_bucket`: calculated based on heading/bearing (`ahead`, `right`, `left`, `behind`).
- `previous_poi_id`: UUID of the last played POI or `'none'`.
- `next_poi_id`: UUID of the next likely POI or `'none'`.

**Direction Bucket Logic:**
```typescript
const diff = ((bearing - heading + 180) % 360) - 180;
if (diff > 45 && diff < 135) return "right";
if (diff < -45 && diff > -135) return "left";
if (Math.abs(diff) >= 135) return "behind";
return "ahead";
```


