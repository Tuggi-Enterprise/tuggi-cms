# 🔒 Row Level Security (RLS) Implementation Guide

## 📋 Visão Geral

Este documento descreve a implementação de **Row Level Security** no banco de dados Supabase para proteger dados em nível de linha com base em roles e propriedade.

**Data**: Janeiro 15, 2026  
**Status**: ✅ Implementado  
**Cobertura**: 6 tabelas principais

---

## 🎯 Objetivo

Implementar controle de acesso fino (fine-grained access control) no banco de dados para garantir que:

1. **Admins** podem ver e editar todos os dados
2. **Proprietários** (users) podem ver e editar apenas seus próprios dados
3. **Outros usuários** podem ver apenas dados públicos (POIs aprovados)
4. **Não autenticados** não conseguem acessar dados sensíveis

---

## 📊 Tabelas Protegidas

### 1. `core.pois`
**Pontos de Interesse (POIs)**

| Operação | Admin | Owner | Public |
|----------|-------|-------|--------|
| SELECT | ✅ Todos | ✅ Próprios | ✅ Aprovados |
| INSERT | ✅ | ✅ (como owner) | ❌ |
| UPDATE | ✅ | ✅ (próprios) | ❌ |
| DELETE | ✅ | ❌ | ❌ |

**Políticas**:
- `pois_select_admin`: Admins veem tudo
- `pois_select_owner`: Proprietários veem seus POIs
- `pois_select_approved_public`: Público vê POIs aprovados
- `pois_insert_authenticated`: Usuários autenticados podem criar
- `pois_update_admin`: Apenas admins editam
- `pois_update_owner`: Proprietários editam seus
- `pois_delete_admin`: Apenas admins deletam

---

### 2. `core.attraction_descriptions`
**Descrições de Atrações**

| Operação | Admin | Owner | Public |
|----------|-------|-------|--------|
| SELECT | ✅ Todas | ✅ Próprias | ✅ De POIs aprovados |
| INSERT | ✅ | ✅ (em seus POIs) | ❌ |
| UPDATE | ✅ | ✅ (próprias) | ❌ |
| DELETE | ✅ | ❌ | ❌ |

**Políticas**:
- `descriptions_select_admin`: Admins veem tudo
- `descriptions_select_owner`: Proprietários veem suas descrições
- `descriptions_select_public`: Público vê de POIs aprovados
- `descriptions_insert_owner`: Proprietários inserem em seus POIs
- `descriptions_update_admin`: Apenas admins editam
- `descriptions_update_owner`: Proprietários editam as suas
- `descriptions_delete_admin`: Apenas admins deletam

---

### 3. `core.attraction_audio`
**Áudio (Narração)**

Mesma estrutura de `attraction_descriptions`:
- Audio de admins: Visível apenas para admins
- Audio de owners: Visível para owner + admins
- Audio de POIs aprovados: Visível para público

---

### 4. `core.attraction_images`
**Imagens**

Mesma estrutura de `attraction_descriptions` e `attraction_audio`.

---

### 5. `core.cms_users`
**Usuários CMS**

| Operação | Admin | Self | Public |
|----------|-------|------|--------|
| SELECT | ✅ Todos | ✅ Si mesmo | ❌ |
| UPDATE | ✅ | ✅ Si mesmo | ❌ |

**Políticas**:
- `cms_users_admin_select`: Admins veem todos
- `cms_users_self_select`: Usuários veem a si mesmos
- `cms_users_admin_update`: Admins editam
- `cms_users_self_update`: Usuários editam a si mesmos

---

### 6. `core.clients`
**Clientes**

| Operação | Admin | Owner | Public |
|----------|-------|-------|--------|
| SELECT | ✅ Todos | ✅ Próprio | ❌ |
| UPDATE | ✅ | ✅ (parcial) | ❌ |

**Status**: RLS já implementado em migração anterior  
(Veja: `20251204_create_clients_feature.sql`)

---

## 🔐 Como as Políticas Funcionam

### Exemplo 1: SELECT de POI

```sql
-- Um usuário não-admin tenta: SELECT * FROM pois WHERE id = 'abc-123'

-- Supabase aplica TODAS as políticas com OR:
IF (admin_check) THEN return true      -- ✅ Se é admin
ELSE IF (owner_check) THEN return true -- ✅ Se é dono
ELSE IF (approved_check) THEN return true -- ✅ Se POI está aprovado
ELSE return false                      -- ❌ Bloqueia
END IF
```

### Exemplo 2: UPDATE de Descrição

```sql
-- Um usuário tenta: UPDATE attraction_descriptions SET text='...' 
-- WHERE attraction_id = 'poi-123'

-- Supabase aplica a política UPDATE:
IF admin THEN allow
ELSE IF owner_of_poi THEN allow
ELSE deny
END IF
```

---

## 📦 Migração

### Arquivo
`supabase/migrations/20260115000000_enable_row_level_security.sql`

### Aplicar Migração

```bash
# Local (com Supabase CLI)
supabase db push

# Production (via Supabase Dashboard)
1. Ir para SQL Editor
2. Copiar conteúdo do arquivo
3. Executar
```

### Verificar Status

```sql
-- Verificar quais tabelas têm RLS ativado
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'core' 
ORDER BY tablename;

-- Resultado esperado (rowsecurity = true para todas):
pois                      | true
attraction_descriptions   | true
attraction_audio          | true
attraction_images         | true
cms_users                 | true
clients                   | true
```

---

## 🧪 Testes de RLS

### Teste 1: Usuário não-autenticado

```typescript
const supabase = createClient(url, anonKey) // Sem autenticação

const { data, error } = await supabase
  .from('pois')
  .select('*')

// ❌ Esperado: error (não pode ver POIs não aprovados)
```

### Teste 2: Usuário autenticado (proprietário)

```typescript
const supabase = createClient(url, anonKey, {
  auth: { autoRefreshToken: true, persistSession: true }
})

// Após login como user1
const { data, error } = await supabase
  .from('pois')
  .select('*')
  .eq('user_id', user1.id)

// ✅ Esperado: Retorna POIs do user1
```

### Teste 3: Usuário não-proprietário vê POI aprovado

```typescript
// user2 tenta ver POI de user1 (aprovado)
const { data, error } = await supabase
  .from('pois')
  .select('*')
  .eq('id', poiId)
  .eq('approved', true)

// ✅ Esperado: Retorna o POI (porque está aprovado)
```

### Teste 4: Admin vê tudo

```typescript
const admin = await loginAsAdmin()
const { data, error } = await supabase
  .from('pois')
  .select('*')

// ✅ Esperado: Retorna TODOS os POIs (aprovados ou não)
```

---

## ⚠️ Considerações Importantes

### 1. Performance
- RLS pode impactar performance em queries complexas
- **Solução**: Usar índices nas colunas de filtro (user_id, approved, etc)
- Índices já existem para a maioria das colunas

### 2. Service Role Key
- **Edge Functions** usam SERVICE_ROLE_KEY para pular RLS
- ✅ Correto para operações administrativas
- ⚠️ Nunca expor SERVICE_ROLE_KEY no cliente

### 3. Queries Complexas
- JOINs com múltiplas tabelas: RLS é aplicado em cada tabela
- **Cuidado**: Certifique-se que as tabelas relacionadas também têm RLS

### 4. Erro Comum
```typescript
// ❌ NÃO FUNCIONA se POI não existe para o usuário
await supabase
  .from('pois')
  .select('user_id') // RLS bloqueia se não é owner
  .eq('id', 'unknown-poi')
  
// ✅ CORRETO: Faz login, depois acessa
const { data: { user } } = await supabase.auth.getUser()
const pois = await supabase
  .from('pois')
  .select('*')
  .eq('user_id', user.id)
```

---

## 🔄 Fluxo Completo

```
┌─────────────────────────┐
│   Cliente (Browser)     │
│  - Pega token JWT       │
│  - Envia com request    │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Edge Function         │
│  - Valida Bearer Token  │
│  - Passa auth context   │
│  - Query database       │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Banco de Dados        │
│  - Recebe auth.uid()    │
│  - Aplica RLS policies  │
│  - Retorna apenas dados │
│    que user pode ver    │
└─────────────────────────┘
```

---

## 📝 Próximas Melhorias

1. **Rate Limiting**: Limite requisições por usuário/IP
2. **Audit Logging**: Log de todas as operações sensíveis
3. **Soft Deletes**: Manter histórico de deletadas
4. **Temporal Queries**: Ver dados históricos
5. **Encryption**: Criptografar campos sensíveis

---

## 📞 Troubleshooting

### Erro: "row level security violation"
**Causa**: Usuário não tem permissão para acessar os dados  
**Solução**: Verificar role do usuário e políticas RLS

### Erro: "relation ... does not exist"
**Causa**: Tabela não existe ou schema está errado  
**Solução**: Verificar nome da tabela e schema

### Query retorna vazio
**Causa**: RLS está bloqueando todos os registros  
**Solução**: Logar como admin para verificar se dados existem

---

## 🎓 Referências

- [Supabase RLS Docs](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
