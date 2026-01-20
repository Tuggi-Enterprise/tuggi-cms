# 🔒 Análise de Segurança: Implementação de Autenticação Bearer Token

## 1️⃣ ESTADO ATUAL DA AUTENTICAÇÃO

### ✅ O que já funciona:
- **Supabase Auth**: Utiliza sessões JWT do Supabase com `@supabase/auth-helpers-nextjs`
- **Middleware.ts**: Valida sessão do usuário no servidor (Next.js)
- **Role-Based Access Control**: Sistema de roles (admin, client) via `cms_users` table
- **Session Context**: Disponível no client via `SessionContextProvider`

### ⚠️ Vulnerabilidades Identificadas:

#### Problema 1: Falta de Autenticação em Edge Functions
- **18 Edge Functions** estão completamente ABERTAS (sem validação de token)
- Qualquer pessoa com a URL pode invocar essas funções
- Não há verificação de Authorization header

#### Problema 2: Ausência de Token em Chamadas do Client
- Componentes fazem chamadas via `supabase.functions.invoke()` **sem token explícito**
- Scripts usam `fetch()` diretamente **sem Authorization header**
- Confia apenas no NEXT_PUBLIC_SUPABASE_ANON_KEY (inadequado para operações sensíveis)

#### Problema 3: Inconsistência em Padrões
- Alguns scripts usam SERVICE_ROLE_KEY (correto)
- Client usa anon key (inseguro para operações protegidas)
- Sem validação consistente do lado da edge function

---

## 2️⃣ PLANO DE IMPLEMENTAÇÃO

### Fase 1: Criar Middleware de Autenticação Reutilizável
**Arquivo**: `supabase/functions/_shared/auth-middleware.ts`

```typescript
// Validar token Bearer e retornar usuário
export async function validateAuthHeader(request: Request): Promise<{
  valid: boolean
  userId?: string
  email?: string
  error?: string
}>
```

**Características**:
- Extrai token do header `Authorization: Bearer <token>`
- Valida JWT com Supabase
- Verifica se usuário existe em `cms_users` (opcional)
- Retorna usuário validado ou erro 401

### Fase 2: Adicionar Token às Chamadas do Client
**Locais a modificar**:

1. **Componentes** (`components/poi-management/POIDetailsModal.tsx`):
   ```typescript
   // De:
   const { data } = await supabase.functions.invoke('generate-description', { body: {...} })
   
   // Para:
   const session = await supabase.auth.getSession()
   const token = session.data.session?.access_token
   const { data } = await supabase.functions.invoke('generate-description', {
     body: {...},
     headers: {
       'Authorization': `Bearer ${token}`
     }
   })
   ```

2. **Scripts** (batch processing):
   ```typescript
   // De:
   await fetch(url, { method: 'POST', body: JSON.stringify(...) })
   
   // Para:
   const token = session.access_token // Get from Supabase
   await fetch(url, {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${token}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify(...)
   })
   ```

### Fase 3: Aplicar Validação em Edge Functions
**Padrão a seguir em cada função**:

```typescript
import { validateAuthHeader } from '../_shared/auth-middleware.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  try {
    // 1. Validar token
    const authResult = await validateAuthHeader(req)
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
        { status: 401, headers: corsHeaders }
      )
    }
    
    console.log(`✅ Authorized request from user: ${authResult.email}`)
    
    // 2. Processar requisição
    const body = await req.json()
    // ... resto da lógica
    
  } catch (error) {
    // ... error handling
  }
})
```

---

## 3️⃣ FUNÇÕES SUPABASE A PROTEGER (18 FUNÇÕES)

### 🖼️ GRUPO: Extração de Imagens (5 funções)
| Função | Status | Prioridade | Notas |
|--------|--------|-----------|-------|
| `extract-iphan-images` | ⚠️ Aberta | ALTA | Busca patrimônio histórico |
| `extract-osm-images` | ⚠️ Aberta | ALTA | OSM + Supabase Storage |
| `extract-specialized-images` | ⚠️ Aberta | ALTA | Fontes customizadas |
| `extract-website-images` | ⚠️ Aberta | ALTA | Web scraping |
| `extract-wikidata-images` | ⚠️ Aberta | ALTA | Wikidata API |
| `extract-wikipedia-images` | ⚠️ Aberta | ALTA | Wikipedia API |

### 📝 GRUPO: Geração de Conteúdo (4 funções)
| Função | Status | Prioridade | Notas |
|--------|--------|-----------|-------|
| `generate-description` | ⚠️ Aberta | ALTA | Usa Gemini API |
| `generate-contextual-narration` | ⚠️ Aberta | ALTA | Gemini + TTS |
| `generate-native-narration` | ⚠️ Aberta | ALTA | Google TTS |
| `generate-translated-audio` | ⚠️ Aberta | ALTA | Tradução + TTS |

### 🎯 GRUPO: Processamento Especial (4 funções)
| Função | Status | Prioridade | Notas |
|--------|--------|-----------|-------|
| `city-correction` | ⚠️ Aberta | ALTA | Geocoding APIs |
| `city-correction-monitor` | ⚠️ Aberta | MEDIA | Monitoramento |
| `generate-trigger-points` | ⚠️ Aberta | ALTA | Processamento complexo |
| `verify-batch` | ⚠️ Aberta | ALTA | Verificação de descrições |

### 💾 GRUPO: Armazenamento (1 função)
| Função | Status | Prioridade | Notas |
|--------|--------|-----------|-------|
| `store-poi-audio` | ⚠️ Aberta | ALTA | Supabase Storage |

---

## 4️⃣ CHECKLIST DE IMPLEMENTAÇÃO

### ✏️ Criar Middleware Compartilhado
- [ ] Arquivo `supabase/functions/_shared/auth-middleware.ts`
- [ ] Função `validateAuthHeader(request: Request)`
- [ ] Integração com Supabase Auth
- [ ] Logging de acesso

### 🔐 Proteger Edge Functions (por grupo)
**Grupo 1: Extração de Imagens**
- [ ] `extract-iphan-images` - adicionar validação
- [ ] `extract-osm-images` - adicionar validação
- [ ] `extract-specialized-images` - adicionar validação
- [ ] `extract-website-images` - adicionar validação
- [ ] `extract-wikidata-images` - adicionar validação
- [ ] `extract-wikipedia-images` - adicionar validação

**Grupo 2: Geração de Conteúdo**
- [ ] `generate-description` - adicionar validação
- [ ] `generate-contextual-narration` - adicionar validação
- [ ] `generate-native-narration` - adicionar validação
- [ ] `generate-translated-audio` - adicionar validação

**Grupo 3: Processamento Especial**
- [ ] `city-correction` - adicionar validação
- [ ] `city-correction-monitor` - adicionar validação
- [ ] `generate-trigger-points` - adicionar validação
- [ ] `verify-batch` - adicionar validação

**Grupo 4: Armazenamento**
- [ ] `store-poi-audio` - adicionar validação

### 📱 Adicionar Token no Client
**Componentes**
- [ ] `components/poi-management/POIDetailsModal.tsx` - 4 chamadas
- [ ] Criar wrapper/hook para autenticação em chamadas

**Scripts**
- [ ] `scripts/process-brazilian-pois-wikipedia.ts`
- [ ] `scripts/process-brazilian-pois-simple.ts`
- [ ] `scripts/city-correction-runner.ts`
- [ ] `scripts/batch-process-wikimedia.ts`
- [ ] Outros scripts que usam edge functions

### 🧪 Testes
- [ ] Teste sem token (deve retornar 401)
- [ ] Teste com token inválido (deve retornar 401)
- [ ] Teste com token válido (deve funcionar)
- [ ] Teste de rate limiting (opcional)
- [ ] Teste de permissions (opcional)

### 📚 Documentação
- [ ] README com instruções de uso
- [ ] Exemplos de chamadas autenticadas
- [ ] Troubleshooting guia

---

## 5️⃣ CHAMADAS DO CLIENT IDENTIFICADAS

### Componentes (4 invocações)
```typescript
// POIDetailsModal.tsx
supabase.functions.invoke('generate-description', {...})  // 3x
supabase.functions.invoke('generate-native-narration', {...})  // 1x
```

### Scripts (13+ invocações)
```typescript
// process-brazilian-pois-wikipedia.ts
fetch(.../extract-wikipedia-images)
fetch(.../extract-wikidata-images)
fetch(.../extract-website-images)

// process-wikipedia-images-batch.ts
fetch(.../extract-wikipedia-images)

// city-correction-runner.ts
fetch(.../city-correction)

// batch-process-wikimedia.ts
fetch(.../unified-image-processing)

// etc...
```

---

## 6️⃣ FLUXO DE SEGURANÇA (Após Implementação)

```
┌─────────────────┐
│   Client/App    │
└────────┬────────┘
         │
         │ 1. Pega token da sessão Supabase
         │
         ▼
┌─────────────────────────────────────┐
│ Chamada com Authorization Header:   │
│ Authorization: Bearer <jwt_token>   │
└────────┬────────────────────────────┘
         │
         │ 2. HTTP POST para edge function
         │
         ▼
┌──────────────────────────────────────┐
│     Edge Function                    │
│  validateAuthHeader(request)         │
└────────┬─────────────────────────────┘
         │
         ├─ 3a. Token válido? ──> Prossegue
         │
         └─ 3b. Token inválido? ──> Retorna 401
         │
         ▼
┌──────────────────────────────────────┐
│  Processa requisição autenticada     │
│  Log: usuário, ações, tempo          │
└──────────────────────────────────────┘
```

---

## 7️⃣ PRÓXIMOS PASSOS

1. **Confirmar com equipe**:
   - Aceitar Bearer token como padrão?
   - Requer role/permissions específicas?
   - Rate limiting necessário?

2. **Implementação**:
   - Criar auth-middleware.ts
   - Atualizar 18 edge functions
   - Atualizar componentes e scripts
   - Testes

3. **Rollout**:
   - Deploy ao ambiente de homolog
   - Testes de integração
   - Deploy em produção com monitoramento

---

## 📋 Recursos Úteis

- [Supabase Auth Helpers Docs](https://supabase.com/docs/guides/auth/auth-helpers)
- [JWT Validation](https://supabase.com/docs/guides/functions/jwt-claims)
- [CORS em Edge Functions](https://supabase.com/docs/guides/functions/cors)
- [Supabase Edge Functions Security](https://supabase.com/docs/guides/functions/auth)

