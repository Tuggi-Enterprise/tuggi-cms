# 🚀 QUICK START - DEPLOY CLIENT HIERARCHY

**Implementação:** Hierarquia de Clientes e Ownership de POIs  
**Data:** 2 de Fevereiro de 2025  
**Status:** ✅ Pronto para Deploy

---

## 📋 O que foi implementado?

✅ Tabela `clients` (já existia)  
✅ Tabela `client_cms_users` (já existia)  
✅ Coluna `client_id` em `cms_users`  
✅ Coluna `owner_id` em `attractions`  
✅ Triggers de validação e auto-population  
✅ RLS policies atualizadas  
✅ Tipos TypeScript atualizados  
✅ Endpoints API implementados  

---

## 🔥 Deploy em 5 Passos

### **PASSO 1: Executar Migration no Supabase**

1. Ir para [Supabase Dashboard](https://app.supabase.com)
2. Selecionar o projeto
3. Ir para **SQL Editor**
4. Criar nova query
5. Copiar conteúdo de: `supabase/migrations/20260202_add_client_hierarchy.sql`
6. Executar (**Ctrl+Enter** ou click em **Run**)
7. ✅ Verificar que não há erros

**Tempo esperado:** 5-10 segundos

---

### **PASSO 2: Verificar que tudo foi criado**

Rodar estas queries no SQL Editor:

```sql
-- Verificar colunas
SELECT 
  EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name='cms_users' AND column_name='client_id') as cms_users_ok,
  EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name='attractions' AND column_name='owner_id') as attractions_ok;
-- Esperado: true, true

-- Verificar indexes
SELECT COUNT(*) as index_count FROM pg_indexes 
WHERE (indexname LIKE '%client_id%' OR indexname LIKE '%owner_id%')
AND schemaname = 'core';
-- Esperado: >= 2

-- Verificar triggers
SELECT COUNT(*) as trigger_count FROM information_schema.triggers
WHERE event_object_schema='core' 
AND (event_object_table='cms_users' OR event_object_table='attractions');
-- Esperado: >= 2

-- Verificar RLS policies
SELECT COUNT(*) as policy_count FROM pg_policies
WHERE tablename='attractions' AND schemaname='core';
-- Esperado: >= 4
```

---

### **PASSO 3: Deploy da Aplicação**

```bash
# Pull latest code (inclui novos endpoints)
git pull origin main

# Instalar dependências (se houve mudanças)
npm install

# Testar localmente
npm run dev
# Verificar que não há erros de compilação

# Fazer deploy (via Vercel ou seu provider)
git push origin main
```

---

### **PASSO 4: Testar Endpoints**

#### **Test 1: GET /api/clients/pois (Listar POIs)**

```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:3000/api/clients/pois?page=1&limit=10&approved=false"

# Esperado (200):
# {
#   "data": [...POIs...],
#   "pagination": { "page": 1, "limit": 10, "total": 50, "totalPages": 5 }
# }

# Esperado (401 sem token):
# { "error": "Unauthorized" }
```

#### **Test 2: POST /api/clients/pois (Criar POI)**

```bash
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Museu do Ipiranga",
    "city": "São Paulo",
    "country": "Brazil",
    "state": "SP",
    "latitude": -23.5944,
    "longitude": -46.6277,
    "description": "Museu histórico"
  }' \
  "http://localhost:3000/api/clients/pois"

# Esperado (201):
# {
#   "success": true,
#   "poi": {
#     "id": "uuid",
#     "name": "Museu do Ipiranga",
#     "owner_id": "client-uuid",
#     "created_by": "user-uuid"
#   }
# }
```

#### **Test 3: RLS Policies**

```bash
# Via Supabase SQL Editor

-- Admin user vê todos os POIs
SELECT COUNT(*) as pois_count FROM core.attractions;
-- Esperado: número total de POIs

-- Client user vê apenas POIs do seu cliente
SELECT COUNT(*) as client_pois FROM core.attractions 
WHERE owner_id = 'seu-client-id';
-- Esperado: apenas POIs do client

-- Public user vê apenas POIs aprovados
SELECT COUNT(*) as approved_count FROM core.attractions 
WHERE approved = true;
-- Esperado: número de POIs aprovados
```

---

### **PASSO 5: Monitorar & Validar**

1. **Logs de Erro:** Verificar se há erros nas funções
   ```bash
   # Terminal da aplicação deve estar limpo
   npm run dev
   ```

2. **Performance:** Verificar se queries estão rápidas
   - GET `/api/clients/pois` deve retornar em < 500ms
   - POST `/api/clients/pois` deve retornar em < 1s

3. **Dados Existentes:** Verificar se POIs antigos funcionam
   ```sql
   -- POIs antigos (sem owner_id) devem estar acessíveis para admins
   SELECT COUNT(*) as legacy_pois FROM core.attractions WHERE owner_id IS NULL;
   ```

---

## 🆘 Troubleshooting

### Erro: "column 'client_id' does not exist"
- Migration não foi executada
- **Solução:** Rodar migration no Supabase SQL Editor

### Erro: "CMS access denied" ao criar POI
- Usuário não existe em `cms_users`
- **Solução:** Criar usuário no CMS primeiro

### Erro: "You must belong to a client to create POIs"
- Usuário não tem `client_id` preenchido
- **Solução:** 
  ```sql
  UPDATE core.cms_users SET client_id = 'uuid-do-client'
  WHERE id = 'uuid-do-user' AND role = 'client';
  ```

### POI não aparece após criação
- Trigger de `owner_id` não executou
- **Solução:** Verificar se trigger existe e executa

### 401 Unauthorized em todos os endpoints
- Token inválido ou expirado
- **Solução:** Gerar novo token de auth

---

## 📖 Documentação Completa

Para mais detalhes, ver:

1. **Implementation Guide:** `docs/CLIENT_HIERARCHY_IMPLEMENTATION.md`
2. **Summary:** `IMPLEMENTATION_SUMMARY_CLIENT_HIERARCHY.md`
3. **Tests:** `CLIENT_HIERARCHY_TESTS.sh`
4. **Clients Feature:** `docs/CLIENTS_FEATURE.md`

---

## 🎯 Casos de Uso

### Caso 1: Cliente criar POI
```typescript
const response = await fetch('/api/clients/pois', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    name: 'Nova Atração',
    city: 'São Paulo',
    country: 'Brazil',
    latitude: -23.5505,
    longitude: -46.6333
  })
})
// owner_id é auto-preenchido com client_id do usuário!
```

### Caso 2: Admin listar POIs de um cliente
```typescript
const response = await fetch('/api/clients/pois?clientId=abc123', {
  headers: { 'Authorization': `Bearer ${token}` }
})
// Retorna apenas POIs do cliente específico
```

### Caso 3: Cliente listar seus POIs
```typescript
const response = await fetch('/api/clients/pois', {
  headers: { 'Authorization': `Bearer ${token}` }
})
// Retorna apenas POIs de seu próprio cliente (via RLS)
```

### Caso 4: Cliente user vinculado (via client_cms_users)
- Manager pode editar POIs do cliente
- Viewer pode apenas ler POIs do cliente
- Owner pode fazer tudo (CRUD)

---

## ✅ Checklist Pós-Deploy

- [ ] Migration executada com sucesso
- [ ] Colunas criadas e visíveis no banco
- [ ] Triggers criados e funcionando
- [ ] RLS policies aplicadas
- [ ] Endpoints testados com tokens válidos
- [ ] POIs antigos (owner_id=NULL) ainda acessíveis
- [ ] POIs novos criados com owner_id correto
- [ ] Clientes conseguem criar POIs
- [ ] Admins conseguem acessar POIs de qualquer cliente
- [ ] Logs em produção sem erros

---

## 📞 Suporte

Se encontrar problemas:

1. Verificar logs da aplicação
2. Executar queries de verificação no SQL Editor
3. Consultar documentação completa em `docs/CLIENT_HIERARCHY_IMPLEMENTATION.md`
4. Verificar tipos TypeScript em `lib/supabase.ts` e `types/clients.ts`

---

## 🎉 Pronto!

Sua hierarquia de clientes está funcionando!

- ✅ Múltiplos usuários por cliente
- ✅ Ownership de POIs por cliente
- ✅ Controle de acesso granular
- ✅ RLS policies funcionando
- ✅ Endpoints API prontos

**Tempo de deploy total:** ~10-15 minutos

---

**Última atualização:** 2025-02-02
