# 🚀 Deploy RLS - Problema CLI Resolvido

O CLI teve problema de sincronização com migrações remotas. Sem problema! Aqui está a solução:

## ✅ Opção Recomendada: Deploy Manual via Dashboard

### Passo 1: Abrir Supabase Dashboard
```
https://app.supabase.com → Seu projeto
```

### Passo 2: SQL Editor
```
Left sidebar → SQL Editor → New Query
```

### Passo 3: Copiar & Colar
Abra o arquivo `RLS_DEPLOY_MANUAL.sql` e **copie TODO o conteúdo**.

Cole na aba "New Query" do Supabase Dashboard.

### Passo 4: Executar
Clique em **Run** (ou Cmd+Enter)

Aguarde 2-3 minutos para execução.

### Passo 5: Verificar Sucesso
Se não houver erros em vermelho, está tudo certo! ✅

---

## 🔍 Validar que RLS Foi Ativado

Após executar o script, rode esta validação no SQL Editor:

```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'core' 
ORDER BY tablename;
```

**Resultado esperado:**
```
attraction_audio         | true
attraction_descriptions  | true
attraction_images        | true
cms_users                | true
clients                  | true
pois                     | true
```

Se todos forem `true`, RLS foi ativado com sucesso! 🎉

---

## 🆘 Se der erro no CLI

O problema é que há migrações remotas que não estão no `supabase/migrations` local.

**Solução permanente:**
```bash
# Sincronizar migrações remotas
supabase db pull

# Depois:
supabase db push
```

Mas por enquanto, use o **método manual do Dashboard** que é mais confiável.

---

## 📝 O que o RLS faz

Depois que ativar RLS, sua aplicação terá:

✅ **Admin** vê/edita todos os POIs  
✅ **Proprietários** veem/editam seus POIs  
✅ **Público** vê apenas POIs aprovados  
✅ **Banco bloqueia** acessos não autorizados  

---

## 🎯 Próximo Passo

Após confirmar RLS está ativado (validação acima):

```bash
# Rodar testes de RLS
npx jest tests/rls-security.test.ts
```

Ou mover para:
- **Rate Limiting** (bloquear abuso)
- **Audit Logging** (rastrear operações)
- **Input Validation** (validar dados de entrada)

---

## 📞 Precisa de ajuda?

1. **RLS não ativa?** Verifique se tem erro na execução do SQL
2. **Erro de permissão?** Pode precisar de role de superuser
3. **Timeout?** Espere mais tempo ou tente novamente

Avise quando RLS estiver ativo e vamos para o próximo passo! 👇
