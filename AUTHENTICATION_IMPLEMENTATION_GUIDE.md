# 🔐 Guia de Implementação: Bearer Token Authentication

## 📋 Resumo Executivo

Este guia descreve como implementar autenticação Bearer Token em todas as edge functions e componentes do cliente.

**Objetivo**: Proteger 18 edge functions com validação de JWT token via Authorization header.

**Tempo Estimado**: 2-3 horas de implementação + testes

---

## 🚀 Fase 1: Middleware (JÁ IMPLEMENTADO ✅)

### ✅ Arquivos Criados:

1. **`supabase/functions/_shared/auth-middleware.ts`**
   - Valida Authorization header com Bearer token
   - Extrai e verifica JWT com Supabase Auth
   - Opcionalmente busca role do usuário em cms_users
   - Fornece helpers para code mais limpo

2. **`supabase/functions/_shared/AUTH_IMPLEMENTATION_EXAMPLE.ts`**
   - Template com 3 padrões de implementação
   - Exemplos de role-based access control
   - Exemplos de logging de acesso

3. **`lib/hooks/useAuthentication.ts`**
   - Hook React para adicionar tokens automaticamente
   - Trabalha com `supabase.functions.invoke()` e `fetch()`
   - Gerencia token durante sessão

---

## 🔧 Fase 2: Proteger Edge Functions

### Padrão Base (Aplicar em todas as 18 funções):

```typescript
// ✅ 1. Adicionar import no início do arquivo
import { validateAuthHeader, corsHeaders } from '../_shared/auth-middleware.ts'

serve(async (req) => {
  // ✅ 2. Manter verificação CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ✅ 3. NOVO: Validar token PRIMEIRO (antes de processar)
    const authResult = await validateAuthHeader(req)
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
        { status: 401, headers: corsHeaders }
      )
    }

    console.log(`✅ Authorized: ${authResult.email}`)

    // ✅ 4. RESTO DA LÓGICA IGUAL (sem mudanças funcionais)
    const body = await req.json()
    // ... seu código aqui

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: corsHeaders }
    )
  }
})
```

### Funções a Atualizar (18 total):

#### Grupo 1: Image Extraction (6 funções)
```
[ ] extract-iphan-images/index.ts
[ ] extract-osm-images/index.ts
[ ] extract-specialized-images/index.ts
[ ] extract-website-images/index.ts
[ ] extract-wikidata-images/index.ts
[ ] extract-wikipedia-images/index.ts
```

#### Grupo 2: Content Generation (4 funções)
```
[ ] generate-description/index.ts
[ ] generate-contextual-narration/index.ts
[ ] generate-native-narration/index.ts
[ ] generate-translated-audio/index.ts
```

#### Grupo 3: Processing (4 funções)
```
[ ] city-correction/index.ts
[ ] city-correction-monitor/index.ts
[ ] generate-trigger-points/index.ts
[ ] verify-batch/index.ts
```

#### Grupo 4: Storage (1 função)
```
[ ] store-poi-audio/index.ts
```

---

## 💻 Fase 3: Adicionar Token no Client

### 3.1 Componentes React

**Arquivo**: `components/poi-management/POIDetailsModal.tsx`

**Mudança 1** (linha ~1305): Importar hook
```typescript
// Adicionar no topo do arquivo
import { useAuthenticatedInvoke } from '@/lib/hooks/useAuthentication'

// No componente
export function POIDetailsModal(...) {
  const authenticatedInvoke = useAuthenticatedInvoke()
  
  // Resto do código...
}
```

**Mudança 2** (locais onde invoca generate-description):
```typescript
// DE:
const { data: result, error: invokeError } = await supabase.functions.invoke('generate-description', {
  body: {...}
})

// PARA:
const { data: result, error: invokeError } = await authenticatedInvoke('generate-description', {
  body: {...}
})
```

**Locais específicos**:
- Linha ~1305: geração de descrição normal
- Linha ~1677: geração com contexto
- Linha ~1787: atualização de descrição
- Linha ~1852: geração de narração

### 3.2 Scripts Node.js

**Arquivos afetados** (adicionar token em cada chamada fetch):

```typescript
// Adicionar no início do script
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Antes de cada fetch, obter token:
const { data: { session } } = await supabase.auth.admin.getUserById(userId)
const token = session?.access_token

// Adicionar header em cada chamada:
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,  // ✅ NOVO
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({...})
})
```

**Scripts a atualizar**:
- `scripts/process-brazilian-pois-wikipedia.ts`
- `scripts/process-brazilian-pois-simple.ts`
- `scripts/process-website-images-batch.ts`
- `scripts/city-correction-runner.ts`
- `scripts/batch-process-wikimedia.ts`
- Outros scripts com chamadas a edge functions

---

## 🧪 Fase 4: Testes

### 4.1 Teste Manual no Insomnia/Postman

```bash
# 1. SEM TOKEN (deve retornar 401)
POST https://your-supabase-project.functions.supabase.co/functions/v1/generate-description
Content-Type: application/json

{
  "poi_id": "test-id",
  "language": "pt-br"
}

# Resultado esperado:
# Status: 401
# Body: { "error": "Unauthorized", "detail": "Missing Authorization header" }

---

# 2. COM TOKEN INVÁLIDO (deve retornar 401)
POST https://your-supabase-project.functions.supabase.co/functions/v1/generate-description
Content-Type: application/json
Authorization: Bearer invalid.token.here

{
  "poi_id": "test-id",
  "language": "pt-br"
}

# Resultado esperado:
# Status: 401
# Body: { "error": "Unauthorized", "detail": "Invalid or expired token" }

---

# 3. COM TOKEN VÁLIDO (deve funcionar)
POST https://your-supabase-project.functions.supabase.co/functions/v1/generate-description
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "poi_id": "test-id",
  "language": "pt-br"
}

# Resultado esperado:
# Status: 200
# Body: { "success": true, ... }
```

### 4.2 Teste Programático

```typescript
// test-auth.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

async function testAuth() {
  console.log('🧪 Testing Bearer Token Authentication')

  // 1. Get a valid session token
  const { data: { user } } = await supabase.auth.admin.createUser({
    email: 'test@example.com',
    password: 'test-password-123'
  })

  if (!user) throw new Error('Could not create test user')

  const { data: { session } } = await supabase.auth.signInWithPassword({
    email: 'test@example.com',
    password: 'test-password-123'
  })

  const token = session?.access_token

  // 2. Test without token
  console.log('\\n1️⃣ Testing without token...')
  const res1 = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-description`,
    { method: 'POST' }
  )
  console.log(`   Status: ${res1.status} (expected 401)`)

  // 3. Test with invalid token
  console.log('\\n2️⃣ Testing with invalid token...')
  const res2 = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-description`,
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer invalid.token' }
    }
  )
  console.log(`   Status: ${res2.status} (expected 401)`)

  // 4. Test with valid token
  console.log('\\n3️⃣ Testing with valid token...')
  const res3 = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-description`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        poi_id: 'test-id',
        language: 'pt-br'
      })
    }
  )
  console.log(`   Status: ${res3.status} (expected 200 or 400 if data invalid)`)
  const body = await res3.text()
  console.log(`   Response: ${body.substring(0, 100)}...`)

  console.log('\\n✅ Auth tests completed!')
}

testAuth().catch(console.error)
```

---

## 📊 Checklist de Implementação

### Preparação
- [x] Análise de segurança completada
- [x] Middleware auth-middleware.ts criado
- [x] Exemplo de implementação criado
- [x] Hook useAuthentication criado

### Implementação Edge Functions (18)

**Grupo 1: Image Extraction**
- [ ] extract-iphan-images
- [ ] extract-osm-images
- [ ] extract-specialized-images
- [ ] extract-website-images
- [ ] extract-wikidata-images
- [ ] extract-wikipedia-images

**Grupo 2: Content Generation**
- [ ] generate-description
- [ ] generate-contextual-narration
- [ ] generate-native-narration
- [ ] generate-translated-audio

**Grupo 3: Processing**
- [ ] city-correction
- [ ] city-correction-monitor
- [ ] generate-trigger-points
- [ ] verify-batch

**Grupo 4: Storage**
- [ ] store-poi-audio

### Implementação Client

**React Components**
- [ ] POIDetailsModal.tsx - adicionar import hook
- [ ] POIDetailsModal.tsx - atualizar 4 chamadas invoke

**Node.js Scripts**
- [ ] process-brazilian-pois-wikipedia.ts
- [ ] process-brazilian-pois-simple.ts
- [ ] process-website-images-batch.ts
- [ ] city-correction-runner.ts
- [ ] batch-process-wikimedia.ts
- [ ] Outros scripts com edge function calls

### Testes
- [ ] Teste sem token (esperado 401)
- [ ] Teste com token inválido (esperado 401)
- [ ] Teste com token válido (esperado sucesso)
- [ ] Teste em homolog antes do prod
- [ ] Validar logs de acesso

### Documentação
- [ ] README de autenticação
- [ ] Exemplos de uso
- [ ] Troubleshooting

---

## 🚨 Rollout Strategy

### Fase Alpha (Homolog)
1. Atualizar 1-2 funções menos críticas
2. Testar com real requests
3. Monitorar logs
4. Ajustar se necessário

### Fase Beta (Mais Funções)
1. Atualizar funções de processamento de imagens
2. Testar batch operations
3. Monitorar performance

### Fase Produção (Rollout Completo)
1. Atualizar todas as 18 funções
2. Atualizar todos os clientes (componentes + scripts)
3. Monitorar por 24h
4. Estar pronto para rollback

### Rollback Plan
Se houver problemas:
1. Remover validação auth-middleware (comentar linhas de validação)
2. Deploy das versões anteriores
3. Investigar logs
4. Tentar novamente

---

## 📚 Referências

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [JWT Claims](https://supabase.com/docs/guides/functions/jwt-claims)
- [Authorization Header Format](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Authorization)

---

## ❓ FAQ

**P: Será que o token vai expirar?**
R: Sim, tokens JWT expiram. O hook useAuthentication revela um novo token a cada chamada, então está tudo bem.

**P: E se o usuário deslogar?**
R: A sessão será null e o hook não adicionará token. A edge function retornará 401.

**P: Preciso atualizar RPC calls?**
R: Não, RPCs usam o cliente Supabase que maneja autenticação automaticamente.

**P: Posso fazer rollback?**
R: Sim! Basta remover as linhas de validação auth-middleware das funções.

**P: Quem pode chamar as funções agora?**
R: Qualquer usuário autenticado no Supabase. Se quiser restringir por role, veja o exemplo 3 em AUTH_IMPLEMENTATION_EXAMPLE.ts

---

## 📞 Suporte

Para dúvidas ou problemas:
1. Verificar SECURITY_ANALYSIS.md
2. Verificar auth-middleware.ts para compreender validação
3. Verificar AUTH_IMPLEMENTATION_EXAMPLE.ts para padrões
4. Checar logs na console da edge function

