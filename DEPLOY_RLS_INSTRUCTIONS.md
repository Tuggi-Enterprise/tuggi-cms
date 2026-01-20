# 🚀 Deploy RLS - Instruções de Implementação

## Opção 1: Supabase Dashboard (Recomendado)

### Passo 1: Acessar SQL Editor
1. Abra [Supabase Dashboard](https://app.supabase.com)
2. Selecione seu projeto
3. Vá para **SQL Editor**

### Passo 2: Criar Nova Query
1. Clique em **New Query**
2. Dê o nome: `Enable RLS Policies`
3. Cole o conteúdo de `/supabase/migrations/20260115000000_enable_row_level_security.sql`

### Passo 3: Executar
1. Clique em **Run** (ou Cmd+Enter)
2. Aguarde a execução completa
3. Verifique se não há erros

---

## Opção 2: CLI (Após Linkar Projeto)

```bash
# 1. Linkar projeto ao seu workspace local
supabase link --project-ref [SEU_PROJECT_REF]

# 2. Fazer push das migrações
supabase db push

# 3. Verificar status
supabase migration list
```

**Encontrar PROJECT_REF:**
- Supabase Dashboard → Project Settings → General → API → Project Reference

---

## ✅ Verificação Pós-Deploy

Após executar a migração, verifique que RLS foi ativado:

```sql
-- Executar no SQL Editor
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'core' 
ORDER BY tablename;
```

**Resultado esperado:**
```
attraction_audio      | true
attraction_descriptions | true
attraction_images     | true
cms_users             | true
clients               | true
pois                  | true
```

---

## 🧪 Testes Rápidos de RLS

### Teste 1: Usuário não-autenticado tenta ver POI não aprovado
```sql
-- Executar como usuário anônimo (na aba "Authenticated as Anonymous")
SELECT * FROM core.pois WHERE approved = false LIMIT 1;
-- ❌ Esperado: Retorna vazio (não vê dados não aprovados)
```

### Teste 2: Usuário autenticado vê POIs aprovados
```sql
-- Substitua [USER_ID] por um UUID real de user
SELECT id, title, approved FROM core.pois 
WHERE approved = true 
LIMIT 5;
-- ✅ Esperado: Retorna POIs aprovados
```

### Teste 3: Proprietário vê seu próprio POI
```sql
-- Substitua [USER_ID] pelo UUID do owner
SELECT id, title, user_id FROM core.pois 
WHERE user_id = '[USER_ID]'::uuid 
LIMIT 5;
-- ✅ Esperado: Retorna POIs deste usuário
```

### Teste 4: Admin vê tudo
```sql
-- (Execute como admin - usuário com role='admin' em cms_users)
SELECT count(*) FROM core.pois;
-- ✅ Esperado: Retorna contagem total de POIs
```

---

## 🔍 Troubleshooting

### Erro: "row level security violation"
- Significa que a política RLS está bloqueando
- Verifique se o usuário tem permissão
- Pode ser esperado dependendo da operação

### Erro: "relation ... does not exist"
- Significa que a tabela não existe
- Verifique se a migração anterior foi executada
- Schema deve ser `core`, não `public`

### Erro: "permission denied for schema core"
- Usuário não tem acesso ao schema
- Contate o admin do banco
- Pode precisar usar ANON_KEY vs SERVICE_ROLE_KEY

---

## 📊 Política de Segurança Implementada

| Tabela | Select | Insert | Update | Delete |
|--------|--------|--------|--------|--------|
| **cms_users** | Admin + Self | ❌ | Admin + Self | ❌ |
| **pois** | Admin + Owner + Approved | Authenticated | Admin + Owner | Admin |
| **attraction_descriptions** | Admin + Owner + Approved POIs | Owner POI | Admin + Owner | Admin |
| **attraction_audio** | Admin + Owner + Approved POIs | Owner POI | Admin + Owner | Admin |
| **attraction_images** | Admin + Owner + Approved POIs | Owner POI | Admin + Owner | Admin |
| **clients** | Admin + Owner | Authenticated | Admin + Owner | Admin |

---

## 🎓 Como a RLS Funciona

Quando um usuário executa `SELECT * FROM pois`:

```
┌─────────────────────────────────────┐
│ Supabase recebe: SELECT * FROM pois │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Aplica TODAS as políticas com OR:   │
│                                      │
│ 1. pois_select_admin                │
│    → É admin? ✅ RETORNA             │
│                                      │
│ 2. pois_select_owner                │
│    → É owner? ✅ RETORNA             │
│                                      │
│ 3. pois_select_approved_public      │
│    → POI aprovado? ✅ RETORNA        │
│                                      │
│ Não atender nenhuma? ❌ BLOQUEIA     │
└─────────────────────────────────────┘
```

---

## 🚨 Próximas Tarefas

Após verificar que RLS está funcionando:

1. **Testar no app**: Fazer login como usuário, tentar acessar dados
2. **Rate Limiting**: Implementar limite de requisições
3. **Audit Logging**: Registrar operações sensíveis
4. **Input Validation**: Validar inputs nas edge functions

---

## 📞 Suporte

Se encontrar problemas:
1. Verifique os logs: Supabase Dashboard → Logs
2. Verifique as políticas: `SELECT * FROM pg_policies WHERE schemaname = 'core';`
3. Teste com anon_key vs service_role_key diferente

---

**Status**: 🟡 Aguardando deploy  
**Próximo passo**: Opção 2️⃣ - Testar RLS Policies
