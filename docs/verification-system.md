# Sistema de Verificação Factual de Descrições

## Visão Geral

O sistema de verificação factual processa descrições originais (`is_original = true`) para extrair claims factuais, verificar sua precisão contra fontes confiáveis (Wikipedia, Wikidata, IPHAN, UNESCO), calcular scores de qualidade e fornecer um CMS para gerenciamento.

## Arquitetura

### Componentes Principais

1. **APIs Vercel** (`/api/verify/`)
   - `POST /api/verify/schedule` - Agenda verificação em lote
   - `POST /api/verify/reprocess` - Reprocessa IDs específicos

2. **Supabase Edge Function** (`verify-batch`)
   - Processa descrições individualmente
   - Extrai claims, verifica factualidade, calcula scores

3. **Bibliotecas de Verificação** (`lib/`)
   - `claims/extract.ts` - Extração de claims com Gemini 2.0 Flash
   - `claims/check.ts` - Verificação de claims com escalonamento Pro
   - `rag/wiki.ts` - RAG com fontes externas
   - `text/evaluate.ts` - Avaliação de qualidade de texto
   - `score/compute.ts` - Cálculo de scores finais

4. **CMS Interface** (`/verification`)
   - Lista descrições com filtros
   - Drawer de verificação detalhada
   - Ações: aprovar, marcar revisão, reprocessar

## Fluxo de Processamento

### 1. Agendamento (`/api/verify/schedule`)
```typescript
// Seleciona descrições originais sem score ou com hash diferente
const descriptions = await supabase
  .from('attraction_descriptions')
  .select('*')
  .eq('is_original', true)
  .eq('language', 'pt-br')
  .limit(batchSize);

// Calcula hash e filtra mudanças
const descriptionsToVerify = descriptions.filter(desc => {
  const currentHash = sha256(desc.description);
  return !desc.description_hash || desc.description_hash !== currentHash;
});
```

### 2. Processamento (`verify-batch`)
```typescript
// Step 1: Extrair claims
const claims = await extractClaims(description);

// Step 2: Buscar contexto
const context = await getContextForClaims(attractionId, claims);

// Step 3: Verificar cada claim
for (const claim of claims) {
  const result = await checkClaimWithEscalation(claim.text, context);
  // Escalona para Gemini Pro se confidence < 0.7
}

// Step 4: Avaliar qualidade do texto
const textEvaluation = evaluateText(description);

// Step 5: Calcular scores
const scores = await computeVerificationScores(description, claims, textEvaluation);

// Step 6: Salvar resultados
await saveVerificationResults(descriptionId, scores, claims);
```

### 3. Cálculo de Scores

#### Factualidade (40% do peso)
```typescript
const factualityScore = (supportedClaims - contradictedClaims) / totalClaims;
```

#### Coerência (20% do peso)
- Penaliza problemas de texto
- Penaliza claims redundantes
- Bônus para boa estrutura

#### Clareza TTS (20% do peso)
- Comprimento ideal: 20-150 palavras
- Frases: 5-25 palavras cada
- Penaliza pontuação complexa

#### Regras (20% do peso)
- Máximo 200 palavras
- 2-5 frases
- Sem superlativos
- Sem endereços/preços/horários
- Início direcional

## Tabelas do Banco

### `core.description_scores`
```sql
CREATE TABLE core.description_scores (
  id uuid PRIMARY KEY,
  description_id uuid REFERENCES attraction_descriptions(id),
  attraction_id uuid REFERENCES attractions(id),
  lang text DEFAULT 'pt-BR',
  description_hash text NOT NULL,
  score_overall int NOT NULL,
  subscores jsonb NOT NULL,     -- {"rules":..,"tts_clarity":..,"factuality":..,"coherence":..}
  flags text[] NOT NULL,        -- ['contradiction','mentions_city',...]
  verifier_version text NOT NULL,
  llm_model text,
  confidence numeric,
  created_at timestamptz DEFAULT now()
);
```

### `core.description_claims`
```sql
CREATE TABLE core.description_claims (
  id uuid PRIMARY KEY,
  description_id uuid REFERENCES attraction_descriptions(id),
  score_id uuid REFERENCES description_scores(id),
  claim_type text NOT NULL,     -- 'year','person','event','restoration'
  slot text,                    -- 'year_built','architect',...
  value text,
  status text NOT NULL,         -- 'supported','contradicted','not_found','needs_review'
  weight numeric DEFAULT 1.0,
  created_at timestamptz DEFAULT now()
);
```

### `core.description_claim_evidence`
```sql
CREATE TABLE core.description_claim_evidence (
  id uuid PRIMARY KEY,
  claim_id uuid REFERENCES description_claims(id),
  source text NOT NULL,         -- 'wikipedia','wikidata','iphan','unesco','gov'
  page text,
  url text,
  quote text,                   -- <= 200 chars
  verdict text NOT NULL,        -- 'supported','contradicted','not_found'
  created_at timestamptz DEFAULT now()
);
```

## Configurações

### `core.verify_settings`
```json
{
  "scorer_weights": {
    "factuality": 0.5,
    "coherence": 0.0,
    "tts_clarity": 0.2,
    "rules": 0.3
  },
  "factuality_thresholds": {
    "approve": 90,
    "review": 70
  }
}
```

## Variáveis de Ambiente

```bash
GEMINI_API_KEY=your_gemini_api_key
WIKI_USER_AGENT=TuggiApp/1.0 (contact@tuggi.app)
VERIFY_BATCH_SIZE=20
VERIFY_ESCALATE_THRESHOLD=0.7
```

## Uso do CMS

### 1. Lista Principal
- Filtros por status, score, tipo de descrição
- Estatísticas em tempo real
- Botão "Agendar Verificação" para processar lote

### 2. Drawer de Verificação
- Mostra descrição completa
- Scores detalhados (geral, factualidade, coerência, TTS)
- Lista de claims com status
- Evidências para cada claim
- Ações: aprovar, marcar revisão, reprocessar

### 3. Ações Disponíveis
- **Aprovar**: Marca como `verified`
- **Marcar Revisão**: Marca como `needs_review`
- **Reprocessar**: Força nova verificação

## Qualidade e Resiliência

### Rate Limiting
- Token bucket: 10 requests/second para APIs externas
- Backoff exponencial para 429/5xx
- Cache local com TTL 14-30 dias

### Idempotência
- Hash SHA256 da descrição para detecção de mudanças
- Evita reprocessamento desnecessário

### Logging
- Logs mínimos para performance
- Métricas de throughput
- Rastreamento de erros

## Exemplo de Uso

```bash
# 1. Executar migração das tabelas
psql -d your_db -f supabase/create-verification-tables.sql

# 2. Deploy da Edge Function
supabase functions deploy verify-batch

# 3. Configurar variáveis de ambiente
# GEMINI_API_KEY, WIKI_USER_AGENT, etc.

# 4. Acessar CMS
# http://localhost:3000/verification

# 5. Agendar verificação
curl -X POST /api/verify/schedule \
  -H "Content-Type: application/json" \
  -d '{"batch": 20}'

# 6. Reprocessar específicos
curl -X POST /api/verify/reprocess \
  -H "Content-Type: application/json" \
  -d '{"description_ids": ["uuid1", "uuid2"]}'
```

## Status de Verificação

- **pending**: Aguardando verificação
- **approved**: Aprovado automaticamente ou manualmente
- **needs_review**: Requer revisão manual
- **rejected**: Rejeitado por baixa qualidade

## Próximos Passos

1. Implementar IPHAN API quando disponível
2. Adicionar mais fontes de verificação
3. Melhorar prompts do Gemini
4. Implementar notificações de mudanças
5. Adicionar métricas de performance
6. Implementar cache distribuído (Redis)
