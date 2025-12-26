### API Quick Reference: Contextual Audio (Stable & Optimized)

Este endpoint utiliza o fluxo de custo otimizado: **Gemini 1.5 Flash-8b** para o roteiro e **Google TTS WaveNet** para o áudio.

**Endpoint:** `POST .../functions/v1/generate-contextual-narration`

---

#### 📌 Fluxo de Chamada

O app deve agrupar as localizações fixas (âncoras) dentro do nó de cada POI. No caso do `next_poi`, o `bearing` e `type` são essenciais para a inteligência da IA e para o Cache.

##### 1. Etapa de Script (Trigger 400m)
**Action:** `generate_text`

---

### 🧠 Lógica de Cache e Hash

Para garantir que o app aproveite o cache local e remoto, o cálculo do Hash (SHA-256) deve seguir este padrão exato. **IDs e Tipos de POIs são preferidos em vez de coordenadas para estabilidade absoluta.**

**Input String para o Hash:**
`${poi_id}:${poi_type}:${language}:${travel_mode}:${direction_bucket}:${prev_poi_id || 'none'}:${next_poi_id || 'none'}:${next_poi_type || 'none'}`

**Componentes:**
- `poi_id`: ID do POI alvo atual.
- `poi_type`: Tipo do POI atual (ex: `tug`, `ad`, `client`).
- `language`: ex: `pt-br`.
- `travel_mode`: `drive` ou `walk`.
- `direction_bucket`: Categoria de direção (`ahead`, `right`, `left`, `behind`).
- `prev_poi_id`: ID do último POI tocado ou `'none'`.
- `next_poi_id`: ID do próximo POI ou `'none'`.
- `next_poi_type`: Tipo do próximo POI ou `'none'`.

---

### 🎙️ Inteligência Contextual
Com o `type` e `bearing` do próximo POI, a IA consegue diferenciar:
- *"Logo à sua frente temos o Lago do Taboão, e se você seguir em frente, poderá visitar o Lago dos Padres."*
- *"Aproveite o Lago do Taboão, pois logo mais à sua direita teremos uma oferta especial no Posto Rede Sul."* (Se for tipo Ad).
