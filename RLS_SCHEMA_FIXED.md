# ✅ Schema Corrigido - RLS Agora Usa Schema `homolog`

## 🔧 Problema Encontrado

A migração RLS estava tentando criar políticas em `core.pois`, mas as tabelas estão em **`homolog`** schema.

```
❌ Antes: ALTER TABLE core.pois ENABLE ROW LEVEL SECURITY;
✅ Depois: ALTER TABLE homolog.pois ENABLE ROW LEVEL SECURITY;
```

## ✅ Corrigido

**Arquivos atualizados:**
1. `/supabase/migrations/20260115000000_enable_row_level_security.sql` - 104 referências corrigidas
2. `/RLS_DEPLOY_MANUAL.sql` - Regenerado com schema homolog

**Tabelas protegidas em `homolog` schema:**
- ✅ homolog.pois
- ✅ homolog.attraction_descriptions
- ✅ homolog.attraction_audio
- ✅ homolog.attraction_images
- ✅ homolog.cms_users
- ✅ homolog.clients

---

## 🚀 Agora Você Pode Fazer Deploy!

### Opção 1: Supabase Dashboard (Recomendado)
1. Abra [app.supabase.com](https://app.supabase.com)
2. Vá para **SQL Editor** → **New Query**
3. Copie TODO o conteúdo de `/RLS_DEPLOY_MANUAL.sql`
4. Cole na aba e clique **Run**

### Opção 2: SQL Direto
Cole este comando para testar:
```sql
ALTER TABLE homolog.pois ENABLE ROW LEVEL SECURITY;

SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'homolog' 
ORDER BY tablename;
```

---

## ✨ Resultado Esperado

Após rodar a migração, você verá:
```
tablename                   | rowsecurity
----------------------------+-------------
attraction_audio            | true
attraction_descriptions     | true
attraction_images           | true
cms_users                   | true
clients                     | true
pois                        | true
(6 rows)
```

---

## 📋 Próximas Ações

1. **Deploy** a migração RLS
2. **Verifique** que RLS foi ativado
3. **Teste** as políticas
4. **Implemente** Rate Limiting ou Audit Logging

**Avise quando o deploy estiver completo! 🚀**
