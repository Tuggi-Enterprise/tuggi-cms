# 🏢 Implementação: Hierarquia de Clientes e Ownership de POIs

**Data:** 2 de Fevereiro de 2025  
**Status:** ✅ Completo  
**Versão:** 1.0

---

## 📋 Resumo Executivo

Esta implementação estabelece uma estrutura hierárquica de clientes no CMS Tuggi, permitindo que:
- Múltiplos usuários pertençam a uma mesma empresa/cliente
- POIs sejam proprietários de clientes (não apenas de usuários individuais)
- Controle de acesso granular baseado em ownership de cliente
- Rastreabilidade completa (quem criou, qual cliente é o dono)

---

## 🗂️ Mudanças Implementadas

### 1. **Migration SQL** (`20260202_add_client_hierarchy.sql`)

#### 1.1 - Adicionar `client_id` em `cms_users`

```sql
ALTER TABLE core.cms_users
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES core.clients(id) ON DELETE SET NULL;
```

**Características:**
- Referencia a tabela `clients` (FK)
- Nullable (apenas preenchido para users com role='client')
- Índice criado para performance: `idx_cms_users_client_id`

**Validação:**
- Trigger automático: se role='client', client_id deve estar preenchido
- Se role≠'client', client_id é anulado automaticamente

#### 1.2 - Adicionar `owner_id` em `attractions`

```sql
ALTER TABLE core.attractions
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES core.clients(id) ON DELETE SET NULL;
```

**Características:**
- Referencia a tabela `clients` (FK)
- Indica qual cliente é o proprietário do POI
- Preenchido automaticamente via trigger a partir de `created_by`
- Índice: `idx_attractions_owner_id`

**Migração de dados:**
```sql
UPDATE core.attractions a
SET owner_id = cu.client_id
FROM core.cms_users cu
WHERE a.created_by = cu.id AND cu.client_id IS NOT NULL;
```

#### 1.3 - Triggers Automáticos

**Validação de `client_id` em CMS Users:**
```
core.validate_cms_user_client_id()
```
- Enforce: cliente users precisam de client_id
- Enforce: non-cliente users não podem ter client_id

**Auto-population de `owner_id`:**
```
core.set_attraction_owner_on_insert()
```
- Quando uma attraction é criada por um cms_user, `owner_id` é preenchido com `client_id` do usuário
- Se usuário não tiver client_id, owner_id fica NULL

### 2. **RLS Policies** (Row Level Security)

Novas policies para attractions:

#### Policy 1: Admin Full Access
```sql
CREATE POLICY "attractions_admin_full_access" ON core.attractions
  -- Admin (role IN ('admin','super_admin')) podem fazer tudo
```

#### Policy 2: Creator Manage
```sql
CREATE POLICY "attractions_creator_manage" ON core.attractions
  -- Quem criou (created_by = current_user_id) pode fazer tudo
```

#### Policy 3: **Client Ownership Manage** (NOVO)
```sql
CREATE POLICY "attractions_client_manage_owned" ON core.attractions
```
Permite acesso a POIs para:
- Usuários cuja `client_id` = POI's `owner_id`
- Usuários linked via `client_cms_users` com role 'owner' ou 'manager'

#### Policy 4: Public Read
```sql
CREATE POLICY "attractions_public_read_approved" ON core.attractions
  -- Anônimos podem ler apenas POIs aprovados
```

---

## 📊 Estrutura de Dados

### Antes (Estrutura Antiga)

```
cms_users
├─ id (UUID)
├─ email
├─ role (admin, client, editor, viewer)
└─ is_active

attractions
├─ id (UUID)
├─ name
├─ created_by → cms_users.id
└─ ... outros campos
```

### Depois (Estrutura Nova)

```
clients
├─ id (UUID)
├─ name
├─ email
├─ status (pending, approved, rejected)
├─ cms_user_id → cms_users.id
└─ ... outros campos

cms_users
├─ id (UUID)
├─ email
├─ role (admin, client, editor, viewer)
├─ client_id → clients.id (NOVO - apenas para role='client')
└─ is_active

client_cms_users (junction table)
├─ id
├─ client_id → clients.id
├─ cms_user_id → cms_users.id
└─ client_role (owner, manager, viewer)

attractions
├─ id (UUID)
├─ name
├─ created_by → cms_users.id (quem criou)
├─ owner_id → clients.id (NOVO - qual cliente é dono)
└─ ... outros campos
```

### Relacionamentos

```
┌─────────────┐
│  clients    │
└──────┬──────┘
       │ (1:many)
       ├──────────────────────────────┐
       │                              │
  cms_user_id                   client_id (in cms_users)
       │                              │
       │                         ┌────▼──────┐
       │                         │ cms_users  │
       │                         └────┬───────┘
       │                              │
       │                         (1:many)
       │                              │
       │                     ┌────────▼────────┐
       │                     │ attractions    │
       │                     │ (owner_id)     │
       │                     └────────────────┘
       │
  (1:many via client_cms_users)
       │
  ┌────▼──────────────────┐
  │ client_cms_users       │
  │ (linking cms_users)    │
  └────────────────────────┘
```

---

## 🔐 Controle de Acesso

### Cenário 1: Admin
- ✅ Pode ver/editar/deletar POIs de qualquer cliente
- ✅ Pode gerenciar todos os clientes

### Cenário 2: Cliente User (role='client', com client_id)
- ✅ Pode ver POIs do seu cliente (owner_id = seu client_id)
- ✅ Pode criar novos POIs para seu cliente
- ✅ Pode editar/deletar POIs do seu cliente
- ❌ Não pode acessar POIs de outro cliente

### Cenário 3: Cliente User Linked (via client_cms_users)
- ✅ Pode acessar POIs do cliente linkado (conforme seu client_role)
- 'owner' / 'manager' → CRUD completo
- 'viewer' → Apenas leitura

### Cenário 4: Editor/Viewer (não-cliente)
- ✅ Pode acessar POIs públicos (approved=true)
- ❌ Não pode acessar POIs de clientes

---

## 💾 Tipos TypeScript Atualizados

### `lib/supabase.ts`

```typescript
export interface CmsUser {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'client' | 'editor' | 'viewer'
  is_active: boolean
  created_at: string
  last_login_at?: string
  /** FK to clients - apenas para role='client' */
  client_id?: string
  updated_at?: string
  company_name?: string
  address?: string
  city?: string
  country?: string
}

export interface Attraction {
  id: string
  name: string
  city: string
  country: string
  approved: boolean
  created_at: string
  updated_at: string
  /** Qual cliente é dono desta attraction */
  owner_id?: string
  /** Qual cms_user criou (para auditoria) */
  created_by?: string
  /** Alias para created_by */
  user_id?: string
  // ... outros campos
}
```

### `types/clients.ts`

```typescript
export interface ClientWithUsers extends Client {
  cms_users?: ClientCmsUser[]
  pois_count?: number
}
```

### `lib/core/poi-service.ts`

```typescript
export interface POI {
  id: string
  // ...
  /** Qual cliente é dono */
  owner_id?: string
  /** Quem criou (auditoria) */
  created_by?: string
  // ... outros campos
}
```

---

## 🔌 Endpoints API

### GET `/api/clients/pois`
**Lista POIs de um cliente**

Query Parameters:
- `clientId` - UUID (obrigatório se não admin)
- `page` - Número da página (padrão: 1)
- `limit` - Itens por página (padrão: 20)
- `search` - Termo de busca
- `approved` - Filtro (true/false/all)

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "POI Name",
      "city": "São Paulo",
      "country": "Brazil",
      "owner_id": "client-uuid",
      "created_by": "user-uuid",
      "approved": false,
      "created_at": "2025-02-02T10:00:00Z",
      // ...
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

### POST `/api/clients/pois`
**Criar novo POI para um cliente**

Request Body:
```json
{
  "clientId": "uuid (opcional - usa client do user)",
  "name": "Nome do POI",
  "city": "São Paulo",
  "country": "Brazil",
  "state": "SP",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "description": "Descrição",
  "formatted_address": "Endereço completo",
  "google_types": ["museum", "point_of_interest"]
}
```

Response:
```json
{
  "success": true,
  "poi": {
    "id": "uuid",
    "name": "Nome do POI",
    "owner_id": "client-uuid",
    "created_by": "user-uuid"
  }
}
```

---

### PATCH `/api/clients/pois/[poiId]`
**Atualizar POI**

Campos permitidos:
- `name`
- `city`
- `state`
- `formatted_address`
- `website`
- `contact_phone`
- `description`

Validação:
- ✅ Admin pode atualizar qualquer POI
- ✅ Criador pode atualizar seu próprio POI
- ✅ Cliente owner (client_id = owner_id) pode atualizar
- ✅ Cliente user com role 'owner'/'manager' pode atualizar

---

### DELETE `/api/clients/pois/[poiId]`
**Deletar POI**

Permissões:
- ✅ Admin
- ✅ Criador
- ✅ Cliente owner
- ✅ Cliente user com role 'owner'/'manager'

---

## 📝 Exemplo de Uso

### Caso 1: Criar um Cliente

```typescript
// Admin cria um cliente
const client = await supabase
  .schema('core')
  .from('clients')
  .insert({
    name: 'ACME Tours',
    email: 'contact@acme.com',
    phone: '11999999999',
    company_name: 'ACME Tours LTDA',
    city: 'São Paulo',
    country: 'Brazil',
    status: 'pending'
  })
  .select()
  .single()
```

### Caso 2: Linkar Usuário ao Cliente

```typescript
// Admin linkaa usuário como owner do cliente
const link = await supabase
  .schema('core')
  .from('client_cms_users')
  .insert({
    client_id: clientId,
    cms_user_id: userId,
    client_role: 'owner',
    linked_by: adminUserId
  })
```

### Caso 3: Cliente Criar POI

```typescript
// Cliente (com client_id) cria um POI
const poi = await fetch('/api/clients/pois', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    // clientId não é necessário - usa o client_id do usuário
    name: 'Museu do Ipiranga',
    city: 'São Paulo',
    country: 'Brazil',
    latitude: -23.5944,
    longitude: -46.6277
  })
})

// Resultado:
// - POI criado com owner_id = client_id do usuário
// - POI criado com created_by = id do usuário
```

### Caso 4: Listar POIs de um Cliente

```typescript
// Cliente lista seus próprios POIs
const response = await fetch('/api/clients/pois?approved=false', {
  headers: { Authorization: 'Bearer token' }
})

// Admin lista POIs de um cliente específico
const response = await fetch('/api/clients/pois?clientId=uuid123&approved=false', {
  headers: { Authorization: 'Bearer token' }
})
```

---

## 🔄 Fluxo Completo

```
1. Empresa Registra como Cliente
   └─ POST /api/clients/register
   └─ Status: 'pending'

2. Admin Aprova Cliente
   └─ POST /api/clients/[clientId]/approve
   └─ Status: 'approved'
   └─ CMS User criado com role='client'
   └─ cms_user.client_id ← cliente.id

3. Cliente Owner Linka Outros Usuários
   └─ POST /api/clients/[clientId]/link-user
   └─ Cria entrada em client_cms_users

4. Cliente ou Seus Usuários Criam POIs
   └─ POST /api/clients/pois
   └─ attractions.owner_id ← cms_user.client_id
   └─ attractions.created_by ← cms_user.id

5. Múltiplos Usuários do Cliente Gerenciam POIs
   └─ GET /api/clients/pois
   └─ PATCH /api/clients/pois/[id]
   └─ DELETE /api/clients/pois/[id]
   └─ RLS garante acesso apenas a POIs do próprio cliente
```

---

## ✅ Checklist de Implementação

- [x] Migration SQL criada (20260202_add_client_hierarchy.sql)
- [x] Tabela `clients` já existia
- [x] Tabela `client_cms_users` já existia
- [x] Coluna `client_id` adicionada em `cms_users`
- [x] Coluna `owner_id` adicionada em `attractions`
- [x] Triggers de validação criados
- [x] RLS policies atualizadas
- [x] Tipos TypeScript atualizados
- [x] Endpoint GET `/api/clients/pois` implementado
- [x] Endpoint POST `/api/clients/pois` implementado
- [x] Endpoint PATCH `/api/clients/pois/[poiId]` atualizado
- [x] Endpoint DELETE `/api/clients/pois/[poiId]` atualizado

---

## 🚀 Próximos Passos

1. **Deploy da Migration**
   ```bash
   # Na console Supabase
   # Executar: supabase/migrations/20260202_add_client_hierarchy.sql
   ```

2. **Testes**
   ```bash
   # Testar endpoints com curl ou Postman
   # Validar RLS policies
   # Testar fluxos de diferentes roles
   ```

3. **Documentação no Frontend**
   - Atualizar componentes de UI para suportar ownership de cliente
   - Adicionar seletores de cliente onde necessário
   - Atualizar dashboards

4. **Auditoria**
   - Verificar se existem POIs sem `owner_id` (NULL)
   - Considerar população manual se necessário

---

## 📚 Referências

- **Migration File:** `supabase/migrations/20260202_add_client_hierarchy.sql`
- **API Endpoints:** `app/api/clients/pois/`
- **Types:** `lib/supabase.ts`, `types/clients.ts`, `lib/core/poi-service.ts`
- **RLS Policies:** Configuradas na migration SQL

---

## 🆘 Troubleshooting

### "CMS access denied" ao criar POI
- Verificar se usuário existe em `cms_users`
- Verificar se `is_active = true`

### POI não aparece após criação
- Verificar se trigger de `owner_id` foi executado
- Validar RLS policies com `select` direto no banco

### Erro "You must belong to a client to create POIs"
- Se não-admin, usuário precisa ter `client_id` preenchido
- Verifica role='client' na tabela `cms_users`

---

**Última atualização:** 2025-02-02
