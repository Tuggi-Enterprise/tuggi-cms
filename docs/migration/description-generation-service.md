# Serviço de Geração de Descrições - Migração POI

## Serviço Utilizado

**✅ Serviço Principal:** `DescriptionService` (`lib/services/poi-processing/description.service.ts`)

**Uso no Pipeline de Migração:**
- O pipeline de migração (`lib/services/poi-migration-pipeline.ts`) usa `DescriptionService.generate()` diretamente
- **NÃO** usa o endpoint `/api/descriptions/generate-optimized` (que tem prompt diferente)
- **NÃO** usa a Edge Function `generate-description`

**Localização no Código:**
```typescript
// lib/services/poi-migration-pipeline.ts:275-291
const { DescriptionService } = await import('./poi-processing/description.service')

const result = await DescriptionService.generate(poiData, {
  auto_generate_audio: options.auto_generate_audio,
  persist_verification: true,
  language: 'pt-br'
})
```

## Prompt Organizado

### Estrutura do Prompt

O prompt é construído pelo método `createOptimizedPrompt()` em `DescriptionService`:

**Localização:** `lib/services/poi-processing/description.service.ts:1160-1252`

### Componentes do Prompt

#### 1. **Cabeçalho e Tipo de Descrição**
```
You are an expert travel guide writer. Produce a [detailed, engaging | concise, factual] description in Brazilian Portuguese.
```

**Variáveis:**
- `detailed, engaging`: Para POIs com tipos PRO (tourist_attraction, locality, political, point_of_interest) → 40s de áudio
- `concise, factual`: Para outros tipos → 20s de áudio

#### 2. **Regras Críticas (CRITICAL RULES)**
```
- Use well-known historical facts and verifiable information about the location
- PRIORITIZE the sources below when available, but you may supplement with established historical knowledge
- NEVER INVENT physical features, functions, or services
- NEVER SPECULATE with words like "aproximadamente", "cerca de", "provavelmente", "pode ter"
- ABSOLUTELY FORBIDDEN: "patrimônio histórico", "tombado", "IPHAN", "Ministério da Cultura" unless explicitly in sources
- AVOID unverified claims about current heritage status, specific IPHAN/UNESCO designations
```

#### 3. **Ordem de Prioridade de Fontes (SOURCE PRIORITY ORDER)**
```
1. Official website (if available)
2. User-provided references  
3. City/municipal sources
4. National sources
5. Well-established historical facts (periods/centuries, regional context, common architectural styles)
```

#### 4. **Estrutura e Fluxo (STRUCTURE & FLOW)**
```
- Start with the POI name; never start with the city.
- Include 1–2 visible/observable elements when certain (e.g., material, style, era, original use).
- End with a natural closing line that connects the visitor to the place (no hyperbole).
```

#### 5. **Tom e Engajamento (TONE & ENGAGEMENT)**
```
- Friendly, knowledgeable tour guide voice
- Share interesting historical facts, cultural significance, or local traditions
- Include curious details about architecture, founding, notable events, or local characteristics
- Vivid but factual language; avoid hype; focus on authentic stories
- Warm, engaging tone while maintaining accuracy
```

#### 6. **Política de Conhecimento (KNOWLEDGE POLICY)**
```
- You may use established historical knowledge about Brazilian cities, regions, and landmarks.
- The sources below are trusted references - you may draw reasonable conclusions about the POI
- Do NOT name or cite institutions/sources in the output text.
- Use the source context (official websites, government sources, cultural institutions) to inform your description.
- Distinguish general historical context (allowed) from specific current claims that require source verification.
```

#### 7. **Tarefa (TASK)**
```
TASK (PRO - detailed description for 40s audio | FLASH - concise description for 20s audio):
- Start with: POI name + primary verifiable DATE (year preferred; century/decade if no year).
- Then 2–4 verified or well-established facts (PRO) OR 1–2 verified facts (FLASH)
- Target length: 80-150 words (PRO) OR 30-70 words (FLASH)
- Optionally current function/significance if officially recorded.
- Avoid generic fillers (e.g., "importante cidade", "rica história"); prefer concrete facts.
```

#### 8. **Política de Datas (DATE POLICY)**
```
- Include a year only if confirmed. Otherwise use century/decade.
- Never use "aproximadamente", "cerca de", "provavelmente".
```

#### 9. **Dados do POI (ATTRACTION DATA)**
```
- Name: ${name}
- Location: ${locationDetails}
- Google: ${googleData}
```

#### 10. **Seções de Dados Enriquecidos**
- `POI DATABASE INFORMATION:` - Dados do banco (enrichedPOISection)
- `SCRAPED CONTENT:` - Conteúdo raspado de fontes (scrapedContentSection)
- `OSM DATA:` - Dados OSM enriquecidos (buildOSMDataSection)
- `TOKENS:` - Tokens verificados (se existirem)
- `EXISTING (for improvement):` - Descrição existente (se for melhoria)

## Tags e Metadados Organizados

### 1. **Tags OSM (OSM Tags)**

**Fonte:** Campo `osm_tags` (JSONB) em `core.attractions`

**Processamento:**
- Tags são extraídas durante o enriquecimento OSM (`OSMEnrichmentService`)
- Armazenadas em `core.attractions.osm_tags` como JSONB
- Usadas no prompt via `buildOSMDataSection()`

**Tags Importantes para Descrições:**
- `name`, `name:pt`, `name:en`
- `description`, `description:pt`, `description:en`
- `historic`, `heritage`, `heritage:operator`
- `architect`, `architect:name`
- `start_date`, `construction_date`, `opening_date`
- `architectural_style`, `building:style`
- `wikidata`, `wikipedia`
- `tourism`, `amenity`, `leisure`, `historic`

**Localização no Código:**
- `lib/services/poi-processing/osm-enrichment.service.ts` - Extração de tags
- `lib/services/poi-processing/description.service.ts:buildOSMDataSection()` - Formatação para prompt

### 2. **Dados Enriquecidos (Enriched POI Data)**

**Fonte:** `OSMEnrichmentService.enrichPOI()`

**Campos Enriquecidos:**
```typescript
interface EnrichedPOIData {
  // OSM Basic
  osm_id?: number
  osm_type?: string
  osm_category?: string
  
  // Heritage
  heritage_status?: string
  unesco_status?: string
  unesco_inscription_date?: string
  unesco_reference?: string
  
  // Architecture
  architectural_style?: string
  architect?: string
  historical_period?: string
  completion_estimated_year?: number
  
  // Cultural
  cultural_significance?: string
  monument_type?: string
  commemorated_event?: string
  commemorated_person?: string
  
  // OSM URLs
  osm_wikipedia_url?: string
  osm_wikidata_id?: string
  osm_description?: string
  
  // Physical
  building_material?: string
  building_colour?: string
  roof_colour?: string
  height?: number
  
  // Museum specific
  museum_type?: string
  collection_focus?: string
  target_audience?: string
  
  // Park/Natural
  park_type?: string
  natural_type?: string
  water_features?: boolean
  
  // Accessibility
  wheelchair_accessible?: boolean
  wheelchair_toilets?: boolean
}
```

**Localização no Código:**
- `lib/services/poi-processing/osm-enrichment.service.ts:131` - Método `enrichPOI()`
- `lib/services/poi-processing/description.service.ts:251` - Busca dados enriquecidos
- `lib/services/poi-processing/description.service.ts:buildEnrichedPOIDataSection()` - Formatação

### 3. **Dados Google (Google Data)**

**Fonte:** Campo `google_types`, `rating`, `user_ratings_total`, etc. em `core.attractions`

**Formatação:**
```typescript
buildGoogleDataSection({
  google_types: string[],
  rating?: number,
  user_ratings_total?: number,
  price_level?: number,
  business_status?: string,
  google_place_id?: string
})
```

**Localização no Código:**
- `lib/services/poi-processing/description.service.ts:buildGoogleDataSection()`

### 4. **Fontes Verificadas (Verified Sources)**

**Fonte:** Sistema de fontes dinâmicas (`DynamicSourcesService`)

**Estrutura:**
```typescript
interface Source {
  source_name: string
  source_type: string
  layer: number (1-4)
  base_url: string
  priority: number
  search_endpoint?: string
  country_code?: string
  city?: string
}
```

**Camadas (Layers):**
1. **Layer 1:** Website oficial do POI
2. **Layer 2:** Fontes municipais (prefeitura, turismo local)
3. **Layer 3:** Fontes nacionais (IPHAN, Ministério do Turismo)
4. **Layer 4:** Fontes internacionais (UNESCO, Wikipedia)

**Localização no Código:**
- `lib/services/dynamic-sources.ts` - Gerenciamento de fontes
- `lib/services/poi-processing/description.service.ts:fetchSources()` - Busca fontes

### 5. **Conteúdo Raspado (Scraped Content)**

**Fonte:** Sistema de scraping de fontes verificadas

**Estrutura:**
```typescript
interface ScrapedContent {
  source_url: string
  content: string
  extracted_facts: string[]
  relevance_score: number
}
```

**Localização no Código:**
- `lib/services/poi-processing/description.service.ts:scrapeSources()` - Scraping
- `lib/services/poi-processing/description.service.ts:buildScrapedContentSection()` - Formatação

### 6. **Tokens Verificados (Verified Tokens)**

**Fonte:** Sistema RAG (Retrieval-Augmented Generation)

**Tipos de Tokens:**
- **Temporal Tokens:** Anos, décadas, séculos (ex: "1947", "século XIX")
- **Entity Tokens:** Pessoas, arquitetos, eventos (ex: "Oscar Niemeyer", "Semana de Arte Moderna")
- **Fact Tokens:** Fatos verificáveis (ex: "tombado pelo IPHAN", "inaugurado em")

**Estrutura:**
```typescript
interface Token {
  token: string
  weight: number (0-1)
  type: 'temporal' | 'entity' | 'fact'
  source: string
  verified: boolean
}
```

**Localização no Código:**
- `lib/services/poi-processing/description.service.ts:extractTemporalTokens()`
- `lib/services/poi-processing/description.service.ts:extractEntityTokens()`
- `lib/services/poi-processing/description.service.ts:extractVerifiedFacts()`

## Configuração do Modelo Gemini

### Modelo Utilizado

**Sempre Flash Models:**
1. **Primário:** `gemini-2.5-flash-lite`
2. **Fallback:** `gemini-2.5-flash`

**Localização:** `lib/services/poi-processing/description.service.ts:1285-1341`

### Parâmetros de Geração

```typescript
generationConfig: {
  temperature: 0.7,        // Consistência
  topK: 40,                // Foco
  topP: 0.8,              // Precisão factual
  maxOutputTokens: 350,   // Limite de tokens
  candidateCount: 1       // Resposta única
}
```

## Verificação de Qualidade

### Prompt de Verificação

**Localização:** `lib/services/poi-processing/description.service.ts:1346-1441`

**Critérios:**
1. **Presença de Datas:** Data ou período histórico (desejável)
2. **Fatos Verificáveis:** Pelo menos 1 fato verificável
3. **Estilo de Guia:** Tom amigável
4. **Proibições:** Sem endereços, horários, preços, direções
5. **Adequação para Áudio:** Frases adequadas para TTS
6. **Português Brasileiro:** Texto correto

**Pontuação:**
- Mínima: 60 (se tiver pelo menos 1 fato verificável)
- Variada: 65, 70, 75, 80, 85, 90, 95 (baseada na qualidade real)
- Aprovação: `pontuacao >= 75` e `aprovada === true`

## Resumo para Migração

### ✅ O que está sendo usado:

1. **Serviço:** `DescriptionService.generate()` (mesmo usado em `/pois`)
2. **Prompt:** `createOptimizedPrompt()` em `DescriptionService`
3. **Tags OSM:** Via `osm_tags` JSONB + `OSMEnrichmentService`
4. **Dados Enriquecidos:** Via `OSMEnrichmentService.enrichPOI()`
5. **Fontes:** Via `DynamicSourcesService`
6. **Modelo:** Gemini 2.5 Flash-Lite (com fallback Flash)
7. **Verificação:** `verifyGeneratedDescription()` com critérios brandos

### ⚠️ O que NÃO está sendo usado:

1. ❌ Endpoint `/api/descriptions/generate-optimized` (tem prompt diferente)
2. ❌ Edge Function `generate-description` (legacy)
3. ❌ Prompt de `/api/descriptions/generate-optimized` (diferente do DescriptionService)

### 📝 Recomendações:

1. **Manter consistência:** Usar sempre `DescriptionService` para garantir mesmo prompt
2. **Organizar tags:** Tags OSM já estão organizadas via `OSMEnrichmentService`
3. **Verificar fontes:** Sistema de fontes dinâmicas já está integrado
4. **Monitorar qualidade:** Verificação automática com critérios brandos (score >= 75)

