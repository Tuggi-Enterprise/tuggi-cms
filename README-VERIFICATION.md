# Sistema de Verificação Factual - Tuggi CMS

## 🎯 Visão Geral

Sistema completo para verificação factual de descrições originais, incluindo:
- Extração de claims factuais com Gemini 2.0 Flash
- Verificação contra fontes confiáveis (Wikipedia, Wikidata, IPHAN, UNESCO)
- Cálculo de scores de qualidade
- CMS para gerenciamento e aprovação

## 🚀 Instalação e Configuração

### 1. Pré-requisitos
- Tabelas já criadas no Supabase (conforme estrutura existente)
- Node.js 18+
- Supabase CLI

### 2. Variáveis de Ambiente

Adicione ao seu `.env.local`:
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Configurações de verificação
WIKI_USER_AGENT=TuggiApp/1.0 (contact@tuggi.app)
VERIFY_BATCH_SIZE=20
VERIFY_ESCALATE_THRESHOLD=0.7
```

### 3. Deploy da Edge Function

```bash
# Deploy da função verify-batch
supabase functions deploy verify-batch

# Configurar variáveis de ambiente na Edge Function
supabase secrets set GEMINI_API_KEY=your_gemini_api_key
supabase secrets set WIKI_USER_AGENT="TuggiApp/1.0 (contact@tuggi.app)"
```

## 📊 Estrutura do Banco

### Tabelas Principais

#### `core.attraction_descriptions` (modificada)
```sql
-- Colunas adicionadas:
verification_status text DEFAULT 'pending'
last_score_overall int
last_score_version text
last_verified_at timestamptz
is_original boolean DEFAULT false
description_hash text GENERATED ALWAYS AS (encode(digest(description, 'sha256'), 'hex')) STORED
```

#### `core.description_scores`
```sql
CREATE TABLE core.description_scores (
  id uuid PRIMARY KEY,
  description_id uuid REFERENCES attraction_descriptions(id),
  attraction_id uuid REFERENCES attractions(id),
  description_hash text NOT NULL,
  score_overall int NOT NULL,           -- 0-100
  subscores jsonb NOT NULL,            -- {"rules":85,"tts_clarity":90,"factuality":95,"coherence":80}
  flags text[] NOT NULL,               -- ['contradiction','mentions_address']
  verifier_version text NOT NULL,      -- 'v2.0'
  llm_model text,                      -- 'gemini-2.0-flash-thinking'
  confidence numeric,
  created_at timestamptz DEFAULT now()
);
```

#### `core.description_claims`
```sql
CREATE TABLE core.description_claims (
  id uuid PRIMARY KEY,
  description_id uuid REFERENCES attraction_descriptions(id),
  score_id uuid REFERENCES description_scores(id),
  claim_type text NOT NULL,            -- 'year','person','event','restoration'
  slot text,                           -- 'year_built','architect'
  value text,                          -- texto do claim
  status text NOT NULL,                -- 'supported','contradicted','not_found','needs_review'
  weight numeric DEFAULT 1.0,
  created_at timestamptz DEFAULT now()
);
```

#### `core.description_claim_evidence`
```sql
CREATE TABLE core.description_claim_evidence (
  id uuid PRIMARY KEY,
  claim_id uuid REFERENCES description_claims(id),
  source text NOT NULL,                -- 'wikipedia','wikidata','iphan','unesco','gov'
  page text,                           -- título da página
  url text,                            -- URL da fonte
  quote text,                          -- citação (≤200 chars)
  verdict text NOT NULL,               -- 'supported','contradicted','not_found'
  created_at timestamptz DEFAULT now()
);
```

### Configurações

#### `core.verify_settings`
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

## 🔧 Uso

### 1. Acessar o CMS
```
http://localhost:3000/verification
```

### 2. Agendar Verificação
```bash
# Via API
curl -X POST http://localhost:3000/api/verify/schedule \
  -H "Content-Type: application/json" \
  -d '{"batch": 20}'

# Via CMS
# Clicar em "Agendar Verificação"
```

### 3. Reprocessar Descrições Específicas
```bash
curl -X POST http://localhost:3000/api/verify/reprocess \
  -H "Content-Type: application/json" \
  -d '{"description_ids": ["uuid1", "uuid2"]}'
```

## 📈 Fluxo de Processamento

### 1. Agendamento (`/api/verify/schedule`)
- Seleciona descrições originais (`is_original = true`)
- Filtra por mudanças (hash diferente)
- Enfileira para processamento

### 2. Processamento (`verify-batch`)
```
Descrição → Extrair Claims → Buscar Contexto → Verificar Claims → 
Avaliar Texto → Calcular Scores → Salvar Resultados
```

### 3. Cálculo de Scores
- **Factualidade (50%)**: Claims suportados vs contraditos
- **Regras (30%)**: Conformidade com diretrizes
- **Clareza TTS (20%)**: Otimização para áudio
- **Coerência (0%)**: Não usado na configuração atual

### 4. Status de Verificação
- **pending**: Aguardando verificação
- **approved**: Score ≥ 90 e sem contradições
- **needs_review**: Score ≥ 70
- **rejected**: Score < 70

## 🧪 Testes

### Executar Teste de Sistema
```bash
node scripts/test-verification.js
```

### Verificar Estrutura
```bash
# Verificar se as tabelas existem
psql -d your_db -c "\dt core.*"

# Verificar configurações
psql -d your_db -c "SELECT * FROM core.verify_settings;"
```

## 🔍 Monitoramento

### Logs da Edge Function
```bash
supabase functions logs verify-batch
```

### Métricas de Performance
- Rate limiting: 10 requests/second para APIs externas
- Cache: 21 dias para respostas de APIs
- Escalonamento: Gemini Pro para confidence < 0.7

## 🐛 Troubleshooting

### Problemas Comuns

1. **Erro de autenticação**
   ```bash
   # Verificar variáveis de ambiente
   echo $GEMINI_API_KEY
   echo $SUPABASE_SERVICE_ROLE_KEY
   ```

2. **Edge Function não responde**
   ```bash
   # Redeploy da função
   supabase functions deploy verify-batch --no-verify-jwt
   ```

3. **Claims não extraídos**
   - Verificar se a descrição tem conteúdo
   - Verificar logs da Edge Function
   - Testar com descrição mais simples

4. **Scores não calculados**
   - Verificar se `verify_settings` está configurado
   - Verificar se o trigger está funcionando

### Debug

```bash
# Verificar status das descrições
psql -d your_db -c "
SELECT 
  verification_status,
  last_score_overall,
  COUNT(*) as count
FROM core.attraction_descriptions 
WHERE is_original = true 
GROUP BY verification_status, last_score_overall;
"

# Verificar claims extraídos
psql -d your_db -c "
SELECT 
  claim_type,
  status,
  COUNT(*) as count
FROM core.description_claims 
GROUP BY claim_type, status;
"
```

## 📚 Documentação Adicional

- [Documentação Completa](docs/verification-system.md)
- [Estrutura do Banco](supabase/create-verification-tables.sql)
- [Edge Function](supabase/functions/verify-batch/index.ts)

## 🚀 Próximos Passos

1. **Implementar IPHAN API** quando disponível
2. **Adicionar mais fontes** de verificação
3. **Melhorar prompts** do Gemini
4. **Implementar notificações** de mudanças
5. **Adicionar métricas** de performance
6. **Implementar cache distribuído** (Redis)
