# ⚡ Quick Start: Bearer Token Authentication Implementation

## 📄 Leitura Rápida (5 minutos)

### O Problema
18 Edge Functions estão abertas para a internet sem nenhuma autenticação.

### A Solução
Adicionar 3 linhas de código em cada função para validar Bearer token.

### Resultado
Apenas usuários autenticados podem chamar as funções.

---

## 🎯 3 Passos Para Implementar

### Passo 1: Middleware (JÁ FEITO ✅)
Arquivo: `supabase/functions/_shared/auth-middleware.ts`

Este arquivo JÁ existe e contém:
```typescript
export async function validateAuthHeader(request: Request)
export async function requireAuth(request: Request)
export function isAdmin(role)
```

### Passo 2: Proteger 18 Edge Functions (3 LINHAS CADA)

**Template para CADA função**:
```typescript
// ✅ 1. Adicionar import no topo
import { validateAuthHeader, corsHeaders } from '../_shared/auth-middleware.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  try {
    // ✅ 2. Adicionar validação (logo depois CORS check)
    const authResult = await validateAuthHeader(req)
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
        { status: 401, headers: corsHeaders }
      )
    }
    
    // ✅ 3. Resto da função fica IGUAL
    const body = await req.json()
    // ... seu código ...
  } catch (error) {
    // ... error handling ...
  }
})
```

**Funções a atualizar**:
```
[ ] extract-iphan-images/index.ts
[ ] extract-osm-images/index.ts
[ ] extract-specialized-images/index.ts
[ ] extract-website-images/index.ts
[ ] extract-wikidata-images/index.ts
[ ] extract-wikipedia-images/index.ts
[ ] generate-description/index.ts
[ ] generate-contextual-narration/index.ts
[ ] generate-native-narration/index.ts
[ ] generate-translated-audio/index.ts
[ ] city-correction/index.ts
[ ] city-correction-monitor/index.ts
[ ] generate-trigger-points/index.ts
[ ] verify-batch/index.ts
[ ] store-poi-audio/index.ts
```

### Passo 3: Adicionar Token no Client (2 LUGARES)

#### Local 1: React Component
Arquivo: `components/poi-management/POIDetailsModal.tsx`

**Adicionar import** (no topo):
```typescript
import { useAuthenticatedInvoke } from '@/lib/hooks/useAuthentication'
```

**Usar no componente**:
```typescript
export function POIDetailsModal(...) {
  const authenticatedInvoke = useAuthenticatedInvoke()
  
  // Ao invés de:
  // const { data } = await supabase.functions.invoke('generate-description', {...})
  
  // Use:
  const { data } = await authenticatedInvoke('generate-description', {...})
}
```

**Linhas a mudar**:
- Linha ~1305: chamar `authenticatedInvoke()` em vez de `supabase.functions.invoke()`
- Linha ~1677: chamar `authenticatedInvoke()` em vez de `supabase.functions.invoke()`
- Linha ~1787: chamar `authenticatedInvoke()` em vez de `supabase.functions.invoke()`
- Linha ~1852: chamar `authenticatedInvoke()` em vez de `supabase.functions.invoke()`

#### Local 2: Scripts Node.js
Ficheiros como: `scripts/city-correction-runner.ts`, `scripts/batch-process-wikimedia.ts`, etc.

**Antes**:
```typescript
const response = await fetch(`${supabaseUrl}/functions/v1/function-name`, {
  method: 'POST',
  body: JSON.stringify({...})
})
```

**Depois**:
```typescript
const token = session?.access_token

const response = await fetch(`${supabaseUrl}/functions/v1/function-name`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,  // ✅ NOVA LINHA
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({...})
})
```

---

## 🧪 Como Testar

### Teste 1: Sem Token (deve falhar com 401)
```bash
curl -X POST \
  https://your-project.functions.supabase.co/functions/v1/generate-description \
  -H "Content-Type: application/json" \
  -d '{"poi_id": "test"}'

# Esperado: 401 Unauthorized
```

### Teste 2: Com Token Inválido (deve falhar com 401)
```bash
curl -X POST \
  https://your-project.functions.supabase.co/functions/v1/generate-description \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid.token" \
  -d '{"poi_id": "test"}'

# Esperado: 401 Unauthorized
```

### Teste 3: Com Token Válido (deve funcionar)
```bash
# 1. Pegar token
TOKEN=$(deno eval "
  const supabase = (await import('@supabase/supabase-js')).createClient(...)
  const { data: { session } } = await supabase.auth.getSession()
  console.log(session.access_token)
")

# 2. Fazer request
curl -X POST \
  https://your-project.functions.supabase.co/functions/v1/generate-description \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"poi_id": "test"}'

# Esperado: 200 OK (ou erro de validação de dados, mas não 401)
```

### Teste 4: Script Automatizado
```bash
deno run --allow-net --allow-env scripts/test-auth-bearer-tokens.ts
```

---

## ✅ Checklist de Implementação

### Preparação
- [x] Ler este documento
- [x] Ler AUTHENTICATION_IMPLEMENTATION_GUIDE.md
- [x] Revisar auth-middleware.ts

### Implementação (18 funções)
- [ ] Proteger extract-iphan-images
- [ ] Proteger extract-osm-images
- [ ] Proteger extract-specialized-images
- [ ] Proteger extract-website-images
- [ ] Proteger extract-wikidata-images
- [ ] Proteger extract-wikipedia-images
- [ ] Proteger generate-description
- [ ] Proteger generate-contextual-narration
- [ ] Proteger generate-native-narration
- [ ] Proteger generate-translated-audio
- [ ] Proteger city-correction
- [ ] Proteger city-correction-monitor
- [ ] Proteger generate-trigger-points
- [ ] Proteger verify-batch
- [ ] Proteger store-poi-audio

### Client
- [ ] Atualizar POIDetailsModal.tsx (4 chamadas)
- [ ] Atualizar scripts de batch processing

### Testes
- [ ] Teste manual sem token
- [ ] Teste manual com token inválido
- [ ] Teste manual com token válido
- [ ] Executar script de teste automatizado
- [ ] Testar em homolog
- [ ] Testar em produção

---

## 📚 Arquivos de Referência

```
├─ auth-middleware.ts                    (middleware base)
├─ AUTH_IMPLEMENTATION_EXAMPLE.ts        (3 padrões)
├─ useAuthentication.ts                  (hook React)
├─ test-auth-bearer-tokens.ts            (testes)
│
├─ SECURITY_SUMMARY.md                   (este arquivo - rápido)
├─ SECURITY_ANALYSIS.md                  (detalhado)
├─ SECURITY_ARCHITECTURE.md              (diagramas)
└─ AUTHENTICATION_IMPLEMENTATION_GUIDE.md (passo-a-passo)
```

---

## 🚀 Deployment Strategy

### Fase 1: Teste em 1 Função (1 hora)
1. Escolha `generate-description` (função crítica)
2. Adicione validação
3. Teste em homolog
4. Se OK → próxima fase

### Fase 2: Teste em 3-5 Funções (2 horas)
1. Implemente em mais funções
2. Atualize POIDetailsModal.tsx
3. Teste e-2-e em homolog
4. Se OK → próxima fase

### Fase 3: Implemente em Todas (1 hora)
1. Proteja restantes 10-12 funções
2. Atualize todos os scripts
3. Deploy em produção

### Rollback (Se necessário - 5 min)
Basta remover as 3 linhas de validação de cada função.

---

## 🆘 Troubleshooting

### Problema: "Missing Authorization header"
```
❌ Você está fazendo request SEM enviar Authorization header

✅ Solução: Adicione header na sua chamada
   curl -H "Authorization: Bearer <seu_token>" ...
   
   OU use useAuthenticatedInvoke() no React
```

### Problema: "Invalid or expired token"
```
❌ Seu token é inválido ou expirou

✅ Solução: 
   1. Faça login novamente para pegar novo token
   2. Use o novo token
   3. Se usar hook React, ele atualiza automaticamente
```

### Problema: 401 mesmo com token válido
```
❌ Pode haver erro no middleware

✅ Solução:
   1. Verifique console logs da edge function
   2. Cheque se import está correto
   3. Cheque se validateAuthHeader() está sendo chamado
   4. Compare com AUTH_IMPLEMENTATION_EXAMPLE.ts
```

---

## ⏱️ Tempo Estimado

| Tarefa | Tempo |
|--------|-------|
| Proteger 1 função | 5 min |
| Proteger 5 funções | 25 min |
| Proteger 18 funções | 90 min |
| Atualizar React component | 10 min |
| Atualizar scripts | 30 min |
| Testes | 30 min |
| **Total** | **3 horas** |

---

## 📞 Suporte Rápido

**Dúvida sobre middleware?**  
→ Ver `auth-middleware.ts` (bem comentado)

**Qual padrão usar?**  
→ Ver `AUTH_IMPLEMENTATION_EXAMPLE.ts` (3 opções)

**Como testar?**  
→ Ver `test-auth-bearer-tokens.ts`

**Passo-a-passo completo?**  
→ Ver `AUTHENTICATION_IMPLEMENTATION_GUIDE.md`

---

## ✨ Summary

```
┌────────────────────────────────────────┐
│                                        │
│  3 linhas de código                    │
│  × 18 funções                          │
│  = Toda a segurança                    │
│                                        │
│  Tempo: 2-3 horas                      │
│  Risco: Muito baixo                    │
│  Impacto: Crítico                      │
│                                        │
│  Status: ✅ PRONTO PARA IMPLEMENTAÇÃO  │
│                                        │
└────────────────────────────────────────┘
```

---

**Próximo passo**: Ler `AUTHENTICATION_IMPLEMENTATION_GUIDE.md` para instruções detalhadas.

